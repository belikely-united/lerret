// vite-plugin-lerret-project.js — the Vite plugin that exposes the user's
// `.lerret/` project to the studio in `@lerret/cli dev` mode.
//
// ── Why a Vite plugin ──────────────────────────────────────────────────────
// `@lerret/cli dev` boots a Node-side Vite dev server pointed at the studio source
// (`packages/studio/`). The studio is a normal Vite-served SPA. To swap from
// the studio's standalone fixture project to a real user folder we need four
// things, and a Vite plugin owns all of them in one place:
//
//   1. The scanned project model — handed to the studio as data, NOT scanned
//      in the browser. We expose it through a **virtual module**, so the
//      studio writes `import { project, assetBaseUrl } from 'virtual:lerret-
//      project'` and Vite resolves it via this plugin.
//   2. The user's files — served through Vite so the asset-runtime's dynamic
//      `import()` can fetch each `.jsx`/`.tsx`/`.md`. We add the project root
//      to `server.fs.allow` and alias a stable URL prefix to it so the asset
//      URLs the runtime composes resolve to real files.
//   3. The live-edit signal — when a file under `.lerret/` changes, the
//      studio must know. We run the chokidar watcher on the user
//      folder and forward each normalized `WatchEvent` over Vite's HMR
//      custom-events channel (`server.hot.send('lerret:change', …)`).
//   4. A clean "no project" path — when the CLI couldn't resolve a project,
//      the plugin still exposes the virtual module (so the studio's CLI-mode
//      detection still succeeds) but with `project: null`; the studio renders
//      its no-folder placeholder.
//
// ── Contract (the public face of this plugin) ─────────────────────────────
//
//   Virtual module:  'virtual:lerret-project'
//     export project       — the ProjectNode (or null if no project resolved)
//     export assetBaseUrl  — '/@lerret-project' (or null with no project)
//     export projectRoot   — the project root path (or null)
//     export lerretDir     — the `.lerret/` directory path (or null)
//     export mode          — the string 'cli', so the studio can branch
//
//   Asset URL base: '/@lerret-project'
//     The plugin aliases this prefix to the project root, so an asset path
//     like `<lerretDir>/ui-components/StatCard.jsx` resolves to
//     `/@lerret-project/.lerret/ui-components/StatCard.jsx`. The asset
//     runtime already does the rebasing (`assetModuleUrl`).
//
//   HMR custom event: 'lerret:change'
//     payload: { event: WatchEvent, project: ProjectNode | null }
//     Sent on every file-system change under `.lerret/`. The studio's
//     CLI-mode source bridges this into `runtime.notifyChange(event.path)`
//     and, when `project` differs from the previously-mounted model, re-
//     renders with the new project (handles add / remove / rename of files
//     and folders — `applyWatchEvent` patches the model server-
//     side so the client never has to re-scan).
//
// ── Boundaries kept ───────────────────────────────────────────────────────
// `core` stays pure: this plugin runs in Node and is the one that imports the
// scan/watch helpers and the Node `fs` backend. The studio sees only data
// (the project JSON) and the HMR event — it never imports `node:fs`.
//
// The plugin NEVER writes into the user's `.lerret/` (separation invariant
// NFR13). The chokidar watcher and the dev server only read.

import { resolve as resolvePath } from 'node:path';

import {
  scan,
  applyWatchEvent,
  makeWatchEvent,
  computeCascadedConfig,
  loadAssetConfigs,
  collectAssets,
  validateEntryName,
} from '@lerret/core';

import {
  createNodeBackend,
  createEntry,
  deleteEntry,
  duplicateEntry,
  moveEntry,
  renameEntry,
  revealEntry,
  tryReadConfig,
  // Host-level recent-projects persistence lives in node-backend (the only
  // file allowed to touch `fs`); the recents file is in the user's home, not
  // inside any project's `.lerret/`.
  readRecentProjects,
  recordRecentProject,
} from './fs/node-backend.js';
import { startWatcher } from './watcher.js';
import { resolveProject } from './resolve-project.js';

// Re-export the recents helpers so the plugin stays the single import surface
// for its tests and the studio-facing endpoints.
export { readRecentProjects, recordRecentProject };

// ── Cascade-override helpers ─────────────────────────────────────────────────
//
// When `--config` is supplied to `@lerret/cli export`, its value is deep-merged
// into every entry of the cascade (the `cascadeEntries` the plugin exposes
// via the virtual module). We replicate the same deep-merge semantics that
// `computeCascadedConfig`'s internal `deepMerge` uses:
//   • Both sides plain object → recurse.
//   • Either side array, or mixed types → child wins wholesale.
//   • Missing child keys → inherited from parent.
//
// This keeps the behaviour consistent with FR21 (config-override
// arrays replace wholesale, scalars and nested objects merge).

/**
 * Deep-merge `child` onto `parent` (same rules as cascade.js's `deepMerge`).
 * Neither argument is mutated. Returns a fresh plain object.
 *
 * @param {Record<string, unknown>} parent
 * @param {Record<string, unknown>} child
 * @returns {Record<string, unknown>}
 */
function deepMergeConfig(parent, child) {
  const result = Object.assign({}, parent);
  for (const key of Object.keys(child)) {
    const pv = result[key];
    const cv = child[key];
    if (
      pv !== null && typeof pv === 'object' && !Array.isArray(pv) &&
      cv !== null && typeof cv === 'object' && !Array.isArray(cv)
    ) {
      result[key] = deepMergeConfig(
        /** @type {Record<string, unknown>} */ (pv),
        /** @type {Record<string, unknown>} */ (cv),
      );
    } else {
      result[key] = cv;
    }
  }
  return result;
}

/**
 * Apply a `configOverride` to every entry in a serialized cascade array.
 * Returns a new array — does not mutate `cascadeEntries`.
 *
 * @param {Array<[string, object]>} cascadeEntries
 * @param {Record<string, unknown>} configOverride
 * @returns {Array<[string, object]>}
 */
function applyConfigOverrideToCascade(cascadeEntries, configOverride) {
  return cascadeEntries.map(([path, config]) => [
    path,
    deepMergeConfig(/** @type {Record<string, unknown>} */ (config), configOverride),
  ]);
}

/**
 * The studio writes `import { project, assetBaseUrl } from
 * 'virtual:lerret-project'`. This plugin owns the resolution.
 *
 * @type {string}
 */
export const VIRTUAL_MODULE_ID = 'virtual:lerret-project';

/**
 * Vite recommends prefixing the resolved id of a virtual module with `\0` so
 * other plugins (and tools that walk the module graph) know to leave it
 * alone. See https://vitejs.dev/guide/api-plugin.html#virtual-modules-convention.
 *
 * @type {string}
 */
const RESOLVED_VIRTUAL_MODULE_ID = '\0' + VIRTUAL_MODULE_ID;

/**
 * The URL prefix the user's project root is served under. Stable so the
 * studio's asset-runtime can compose URLs against it the same way the
 * fixture dev-harness composes them against its alias.
 *
 * @type {string}
 */
export const PROJECT_ASSET_BASE_URL = '/@lerret-project';

/**
 * The HMR custom event name pushed on every file-system change. The studio's
 * CLI-mode source listens for this event.
 *
 * @type {string}
 */
export const HMR_CHANGE_EVENT = 'lerret:change';

/**
 * The write-endpoint URL the CLI plugin exposes for the studio→CLI write path.
 * Reused across the lifecycle and data-editor endpoints below.
 *
 * Contract:
 *   POST {WRITE_ENDPOINT}
 *   Body  : { "path": "<LerretPath>", "content": "<utf-8 string>" }
 *   200   : { "ok": true }
 *   4xx/5xx: { "ok": false, "error": "<reason>" }
 *
 * Path safety: the endpoint REJECTS any path that does not start with the
 * project's `.lerret/` tree. Writes outside `.lerret/` are an immediate 400.
 *
 * @type {string}
 */
export const WRITE_ENDPOINT = '/__lerret/write';

/**
 * Lifecycle endpoints for rename / duplicate / delete / reveal.
 * Each accepts a POST with a small JSON body and returns the same calm
 * `{ ok, error? }` shape the write endpoint uses. Every path passed in is run
 * through {@link checkWritePath} before any filesystem call.
 */
export const RENAME_ENDPOINT = '/__lerret/rename';
export const DUPLICATE_ENDPOINT = '/__lerret/duplicate';
export const DELETE_ENDPOINT = '/__lerret/delete';
export const REVEAL_ENDPOINT = '/__lerret/reveal';
export const MOVE_ENDPOINT = '/__lerret/move';
export const CREATE_ENDPOINT = '/__lerret/create';
export const READ_CONFIG_ENDPOINT = '/__lerret/read-config';

/**
 * Runtime folder-switch endpoint. `POST` `{ folder: <os path> | null }`:
 *   • a path  → connect the studio to that folder (must resolve to a `.lerret/`
 *               project); re-scans, restarts the watcher, bumps the cache-bust
 *               epoch, and broadcasts the new model — no CLI restart.
 *   • `null`  → close the current project (return the studio to the connect
 *               screen).
 * Response: 200 `{ ok, project, projectRoot, lerretDir, epoch }` |
 *           400 `{ ok:false, error }` (no `.lerret/` found / bad input).
 */
export const SWITCH_FOLDER_ENDPOINT = '/__lerret/switch-folder';

/**
 * Recent-projects list. `GET` → `{ ok, recent: Array<{ path, name }> }`. The
 * list is persisted under the user's home dir and updated on each successful
 * switch so the connect screen can offer one-click re-open.
 */
export const RECENT_PROJECTS_ENDPOINT = '/__lerret/recent-projects';

/**
 * Serialize a `Map<string, object>` cascade to a JSON-safe
 * `Array<[string, object]>` that the studio can rehydrate into a `Map`.
 *
 * `Map` is not JSON-stringify-able across a virtual-module boundary, so we
 * serialize it as an array of `[key, value]` pairs — identical to the form
 * `Map.prototype.entries()` produces, and directly consumable by
 * `new Map(entries)` on the studio side.
 *
 * @param {Map<string, object> | null} cascade
 * @returns {Array<[string, object]>}
 */
function serializeCascade(cascade) {
  if (!cascade || cascade.size === 0) return [];
  return Array.from(cascade.entries());
}

/**
 * Serialize the per-asset config map (`Map<assetPath, ConfigObject>` from
 * `loadAssetConfigs`) to an `Array<[assetPath, config]>` — rehydrated to a Map
 * studio-side by `AssetConfigProvider` (ADR-003).
 *
 * @param {Map<string, object> | null | undefined} assetConfigs
 * @returns {Array<[string, object]>}
 */
function serializeAssetConfigs(assetConfigs) {
  if (!assetConfigs || assetConfigs.size === 0) return [];
  return Array.from(assetConfigs.entries());
}

/**
 * Compute the serialized per-asset config entries for a scanned project.
 * Never throws — a failure logs and yields `[]` so the studio still mounts.
 *
 * @param {object | null} project
 * @param {import('@lerret/core').FilesystemAccess} backend
 * @returns {Promise<Array<[string, object]>>}
 */
async function computeAssetConfigEntries(project, backend) {
  if (!project) return [];
  try {
    const map = await loadAssetConfigs(collectAssets(project), backend);
    return serializeAssetConfigs(map);
  } catch (err) {
    console.error(
      '[lerret] asset-config load failed:',
      err && err.message ? err.message : err,
    );
    return [];
  }
}

/**
 * Build the JS source the virtual module returns. The project model is
 * serialized to JSON and frozen into the module's exports — the studio gets
 * the same plain-data tree it would get from a browser-side scan, just
 * computed server-side.
 *
 * Using `JSON.stringify` is safe because the project model is pure plain
 * data: only strings, numbers, booleans, arrays, and plain objects.
 * The cascaded config is serialized as an `Array<[path, config]>` (a Map
 * cannot be JSON-stringify'd directly — this form is rehydrated to a Map
 * studio-side by `CascadedConfigProvider`).
 *
 * The `overrides` field carries the optional in-memory
 * `dataOverride` and `configOverride` values from `--data` / `--config`. The
 * studio runtime reads `overrides.data` to shadow the data tier (tier 1) of
 * `resolveProps`, and reads `overrides.config` (already deep-merged into the
 * cascade server-side) to ensure the studio's config-provider is consistent.
 * Neither value is ever written to `.lerret/` (NFR13).
 *
 * @param {object} payload
 * @param {object | null} payload.project    The scanned project (or null).
 * @param {string | null} payload.assetBaseUrl
 * @param {string | null} payload.projectRoot
 * @param {string | null} payload.lerretDir
 * @param {Array<[string, object]>} payload.cascadeEntries
 *   Serialized cascade — `Array<[folderPath, effectiveConfig]>`.
 * @param {{ data: object | null, config: object | null }} payload.overrides
 *   In-memory overrides from `--data` / `--config`. Both fields
 *   are `null` when the corresponding flag was not supplied.
 * @returns {string}  The module's source code.
 */
function buildVirtualModuleSource({ project, assetBaseUrl, projectRoot, lerretDir, epoch, cascadeEntries, assetConfigEntries, overrides }) {
  return [
    '// AUTO-GENERATED by `vite-plugin-lerret-project`. Do not edit.',
    `export const project = ${JSON.stringify(project)};`,
    `export const assetBaseUrl = ${JSON.stringify(assetBaseUrl)};`,
    `export const projectRoot = ${JSON.stringify(projectRoot)};`,
    `export const lerretDir = ${JSON.stringify(lerretDir)};`,
    // epoch: bumps on every runtime folder switch. The studio appends it as a
    // `?v=<epoch>` cache-bust to asset imports so switching folders never
    // serves a stale cached module (e.g. when two folders share a rel path).
    `export const epoch = ${JSON.stringify(typeof epoch === 'number' ? epoch : 0)};`,
    // cascadeEntries: Array<[LerretPath, ConfigObject]> — rehydrated to a Map
    // in the studio's CascadedConfigProvider.
    `export const cascadeEntries = ${JSON.stringify(cascadeEntries)};`,
    // assetConfigEntries: Array<[assetPath, ConfigObject]> — per-asset
    // Name.config.json, rehydrated to a Map in the studio's AssetConfigProvider.
    `export const assetConfigEntries = ${JSON.stringify(assetConfigEntries || [])};`,
    // overrides: { data, config } — in-memory export-time overrides.
    // `data`   → the studio runtime merges this at tier 1 of resolveProps.
    // `config` → already deep-merged into cascadeEntries above; exposed here
    //            so the studio can detect that an override is active if needed.
    `export const overrides = ${JSON.stringify(overrides)};`,
    `export const mode = 'cli';`,
    `export default { project, assetBaseUrl, projectRoot, lerretDir, epoch, cascadeEntries, assetConfigEntries, overrides, mode };`,
    '',
  ].join('\n');
}

/**
 * Convert an OS path to the forward-slash form `core`'s loader/watcher use.
 *
 * @param {string} osPath
 * @returns {string}
 */
function toLerretPath(osPath) {
  return osPath.replaceAll('\\', '/');
}

/**
 * Decide whether a write target is safe — i.e. inside the project's `.lerret/`
 * tree. This is the server-side gate the studio→CLI write path
 * runs every request through.
 *
 * Rules (all must hold):
 *   1. `lerretDir` is set (no writes without a resolved project).
 *   2. The path is a non-empty string with no `\0` bytes.
 *   3. The path does not contain a `..` segment (no traversal).
 *   4. Normalized to forward slashes, the path starts with `lerretDir` + `/`
 *      or equals `lerretDir` itself (and no `.lerret` segment is reached
 *      via a non-`/`-bounded match).
 *
 * The rejection is intentionally calm — we return a short string the client
 * surfaces to the user. No 5xx, no stack trace, no project-internals leak.
 *
 * @param {string} requestPath  The client-supplied path (LerretPath form).
 * @param {string | null} lerretDir  The project's `.lerret/` path.
 * @returns {{ ok: true, normalized: string } | { ok: false, error: string }}
 */
export function checkWritePath(requestPath, lerretDir) {
  if (!lerretDir) {
    return { ok: false, error: 'no project is loaded — writes are not available' };
  }
  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    return { ok: false, error: 'path must be a non-empty string' };
  }
  if (requestPath.includes('\0')) {
    return { ok: false, error: 'path contains an illegal NUL byte' };
  }
  const normalized = requestPath.replaceAll('\\', '/');
  // Reject any `..` segment — never resolve, just refuse.
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      return { ok: false, error: 'path traversal (..) is not allowed' };
    }
  }
  // Must live under `<lerretDir>/`. Equality (writing to the directory itself)
  // is also a rejection — writes are to files, not the directory entry.
  const root = lerretDir.replace(/\/+$/, '');
  if (!normalized.startsWith(root + '/')) {
    return { ok: false, error: 'path is outside the project .lerret/ tree' };
  }
  return { ok: true, normalized };
}

/**
 * Create the `@lerret/cli dev` / `@lerret/cli export` Vite plugin.
 *
 * @param {object} opts
 * @param {string | null} opts.projectRoot
 *   The user's project root — the folder that directly contains `.lerret/`,
 *   or `null` if `@lerret/cli dev` was invoked outside any project (no-folder
 *   fallback).
 * @param {string | null} opts.lerretDir
 *   The user's `.lerret/` directory path, or `null` matching `projectRoot`.
 * @param {Record<string, unknown> | undefined} [opts.dataOverride]
 *   Optional in-memory data override from `--data`. When supplied,
 *   the value is exposed via the virtual module's `overrides.data` export so
 *   the studio runtime can merge it at tier 1 of `resolveProps`. Never written
 *   to disk (NFR13).
 * @param {Record<string, unknown> | undefined} [opts.configOverride]
 *   Optional in-memory config override from `--config`. When
 *   supplied, it is deep-merged (using `computeCascadedConfig`'s `deepMerge`
 *   semantics — child keys win, arrays replaced wholesale) into EVERY entry of
 *   the cascade before the virtual module is built. This makes the override
 *   visible to the studio's `CascadedConfigProvider` immediately at startup.
 *   Never written to disk (NFR13).
 * @returns {import('vite').Plugin}
 */
export function lerretProjectPlugin({ projectRoot, lerretDir, dataOverride, configOverride }) {
  // The single source of truth for the current project model — the watcher
  // keeps it patched, the virtual module emits a serialized snapshot, and
  // the HMR event carries a fresh snapshot on each change so the client
  // never has to recompute from scratch.
  /** @type {object | null} */
  let currentProject = null;

  // The serialized cascade — kept in sync with `currentProject`. Recomputed
  // whenever the project model is rebuilt (initial scan + every watcher event
  // that changes a config.json or affects a page/group structure). The studio
  // reads it from the virtual module on boot and re-receives it on every
  // `lerret:change` HMR event as `payload.cascadeEntries`.
  /** @type {Array<[string, object]>} */
  let currentCascadeEntries = [];
  let currentAssetConfigEntries = [];

  /** @type {import('./watcher.js').WatcherHandle | null} */
  let watcherHandle = null;

  // ── Mutable project binding (enables runtime folder switching) ──────────────
  // The folder the studio is connected to is NOT fixed for the server's
  // lifetime. `POST /__lerret/switch-folder` re-points `state.projectRoot` /
  // `state.lerretDir` at a different folder (or null to "close" the project),
  // re-scans, restarts the watcher, and broadcasts the new model — all without
  // restarting the CLI. Every hook below reads through `state` (never the
  // boot-time params) so a switch takes effect immediately:
  //   • `resolveId` rebases `/@lerret-project/*` onto `state.lerretDir`
  //     dynamically (this REPLACES the old static `resolve.alias`, which could
  //     only ever point at one folder).
  //   • the lifecycle middlewares read `state.lerretDir` via `getLerretDir`.
  //   • `load` / `hotUpdate` read `state.projectRoot` / `state.lerretDir`.
  // `epoch` bumps on every switch; the studio appends it as a cache-bust query
  // to asset imports so a switch never serves a stale cached module.
  const state = {
    /** @type {string | null} */ projectRoot: projectRoot || null,
    /** @type {string | null} */ lerretDir: lerretDir || null,
    epoch: 0,
  };

  /** Whether a real user folder is currently connected. */
  const isProjectLoaded = () => !!(state.projectRoot && state.lerretDir);

  /** The stable asset URL prefix when a project is loaded, else null. */
  const currentAssetBaseUrl = () => (isProjectLoaded() ? PROJECT_ASSET_BASE_URL : null);

  /** Live getter handed to the lifecycle middlewares so each request sees the
   *  currently-connected folder rather than the boot-time one. */
  const getLerretDir = () => state.lerretDir;

  // The plugin works in two modes, and can move between them at runtime:
  //   - "project mode": a real user folder is connected.
  //   - "no-project mode": the virtual module still exists but exports
  //     `project: null` so the studio's CLI-mode source can render its
  //     connect/placeholder screen. No watcher in that case.

  return {
    name: 'lerret:project',

    /**
     * Extend the resolved Vite config so the user's project files are
     * (a) served by the dev server even though they live outside the
     * studio root, and (b) reachable at our stable URL prefix.
     */
    config() {
      // Asset resolution is handled DYNAMICALLY by `resolveId` (below), which
      // rebases `/@lerret-project/*` onto the *currently-connected* folder. A
      // static `resolve.alias` cannot do that — it would freeze the mapping to
      // the boot-time folder — so we no longer set one. This is what lets the
      // studio switch to a different folder without restarting the CLI.
      //
      // `server.fs.strict = false`: the studio can be pointed at ANY folder on
      // the user's machine at runtime (POST /__lerret/switch-folder), and those
      // folders are unknown at boot, so an allow-list can't enumerate them up
      // front. Lerret is a LOCAL, localhost-bound design tool serving the
      // user's OWN files, so relaxing the dev-server file-serving guard is the
      // honest configuration here. Safety is preserved where it matters: the
      // plugin NEVER writes outside `.lerret/` (every write goes through
      // `checkWritePath`), and the switch endpoint validates the target is a
      // real Lerret project before connecting to it.
      return {
        server: { fs: { strict: false } },
      };
    },

    /**
     * Resolve `'virtual:lerret-project'` to a synthetic module id (per
     * Vite's virtual-module convention).
     */
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
      // Dynamic replacement for the old static `/@lerret-project` alias.
      // Rebase the stable URL prefix onto the CURRENTLY-connected `.lerret/`
      // folder, preserving everything after the prefix (the sub-path plus any
      // query such as `?t=…` live-reload busting, `?v=…` switch-epoch busting,
      // or `?raw` for markdown). Returning a real on-disk path lets Vite's
      // normal pipeline transform `.jsx`/`.tsx` and serve `.md?raw`, exactly as
      // the alias used to. Because this reads `state.lerretDir` on every call,
      // a folder switch immediately re-points every subsequent asset import —
      // which a static alias could never do.
      if (state.lerretDir && id.startsWith(PROJECT_ASSET_BASE_URL + '/')) {
        return state.lerretDir + id.slice(PROJECT_ASSET_BASE_URL.length);
      }
      return null;
    },

    /**
     * Inject a tiny inline script into the served `index.html` so the
     * studio's `main.jsx` can synchronously detect that it is running
     * under `@lerret/cli dev`. Without this signal the studio would have to
     * try a dynamic import of `virtual:lerret-project` — which the
     * browser refuses with a CORS error (the bare specifier isn't a URL).
     *
     * The flag is the contract the studio reads; it is also written into
     * the standalone-studio build path (where its absence keeps the
     * fixture path as the fallback).
     */
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'application/javascript' },
          children:
            'window.__LERRET_CLI_MODE__ = true;',
          injectTo: 'head-prepend',
        },
      ];
    },

    /**
     * Own HMR for files inside the user's project — and tell Vite to do
     * nothing for them.
     *
     * A user asset (`.jsx`/`.tsx`/`.md`/`config.json`/`*.data.json` under the
     * project root) is NOT an HMR-accepting module. Left to Vite's default,
     * editing one escalates to a FULL PAGE RELOAD. That is wrong for the studio
     * twice over:
     *   1. A reload throws away viewport / scroll / per-artboard state — the
     *      opposite of the live-edit feel the watcher path is built to deliver.
     *   2. In the pre-built `dist-studio` path (the published CLI) a user-file
     *      reload also kicks Vite's dep-optimizer, whose follow-on reload
     *      cascade has been observed to leave the studio on a hard 404.
     *
     * The studio already has a purpose-built live path: the chokidar watcher
     * below emits `lerret:change`, the runtime cache-busts the changed module
     * and re-imports it in place, and structural edits swap the project model.
     * So for any file under the project root we return an empty module list —
     * "nothing for Vite to update here" — and let the watcher own it.
     *
     * Studio source files (source-mode dev) live OUTSIDE the project root, so
     * they keep their normal React Fast Refresh; only the user's folder is
     * claimed here.
     *
     * @param {import('vite').HotUpdateOptions} options
     * @returns {[] | undefined}  `[]` to suppress, `undefined` for Vite default.
     */
    hotUpdate(options) {
      // Only the browser (client) environment drives the studio's HMR.
      if (this.environment && this.environment.name !== 'client') return undefined;
      if (!state.projectRoot) return undefined;
      const changed = toLerretPath(options.file);
      const root = state.projectRoot.replace(/\/+$/, '');
      if (changed === root || changed.startsWith(root + '/')) {
        return [];
      }
      return undefined;
    },

    /**
     * Emit the virtual module's source — the project model as a frozen
     * JSON snapshot plus the stable asset base URL. Live updates come in
     * through the `lerret:change` HMR event below; this is just the
     * starting state the studio mounts with.
     */
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return null;
      // Apply the in-memory config override (if any) on top of
      // the cascade. The override is deep-merged into every cascade entry so
      // the studio's CascadedConfigProvider sees it from the first render
      // without any HMR round-trip. The watcher still delivers live updates
      // for the real .lerret/ config files; the override just adds on top.
      const effectiveCascadeEntries = configOverride
        ? applyConfigOverrideToCascade(currentCascadeEntries, configOverride)
        : currentCascadeEntries;
      return buildVirtualModuleSource({
        project: currentProject,
        assetBaseUrl: currentAssetBaseUrl(),
        projectRoot: state.projectRoot,
        lerretDir: state.lerretDir,
        epoch: state.epoch,
        cascadeEntries: effectiveCascadeEntries,
        assetConfigEntries: currentAssetConfigEntries,
        // Expose the override objects to the studio so it can apply the data
        // override at tier 1 of resolveProps. null sentinel for
        // absent overrides so the studio can check truthiness simply.
        overrides: {
          data: dataOverride !== undefined ? dataOverride : null,
          config: configOverride !== undefined ? configOverride : null,
        },
      });
    },

    /**
     * Once the dev server is configured, do the initial project scan and
     * stand up the chokidar watcher that keeps the model in sync. We also
     * register a `closeBundle`-style hook (`buildEnd`) so the watcher is
     * torn down when Vite shuts down.
     */
    async configureServer(server) {
      // One Node backend for the whole server lifetime (stateless, safe to
      // reuse across scans and watcher recomputes).
      const backend = createNodeBackend();

      // ── Reusable: scan the currently-connected folder into the model ───────
      // Used at boot AND on every runtime folder switch. Reads `state.lerretDir`
      // so it always targets the folder we're connected to right now.
      async function rescanCurrentProject() {
        if (!state.lerretDir) {
          currentProject = null;
          currentCascadeEntries = [];
          currentAssetConfigEntries = [];
          return;
        }
        try {
          currentProject = await scan(backend, toLerretPath(state.lerretDir));
          try {
            const cascadeMap = await computeCascadedConfig(currentProject, backend);
            currentCascadeEntries = serializeCascade(cascadeMap);
          } catch (cascadeErr) {
            console.error('[lerret] cascade computation failed:', cascadeErr && cascadeErr.message ? cascadeErr.message : cascadeErr);
            currentCascadeEntries = [];
          }
          currentAssetConfigEntries = await computeAssetConfigEntries(currentProject, backend);
        } catch (err) {
          // A failed scan is rare (the loader is forgiving) but possible — e.g.
          // the `.lerret/` directory vanished. Surface a clear log, keep the
          // server running with `project: null` so the studio still mounts.
          console.error('[lerret] project scan failed:', err && err.message ? err.message : err);
          currentProject = null;
          currentCascadeEntries = [];
          currentAssetConfigEntries = [];
        }
      }

      // ── Reusable: drop the cached virtual module so the NEXT load() is fresh ─
      // Live updates ride the `lerret:change` broadcast (below), but that only
      // patches the running studio's React state — it does NOT re-run `load()`.
      // Without invalidation a full browser reload would re-serve the cached
      // boot-time snapshot, losing any model/cascade/asset-config change made
      // since boot (e.g. a `Name.config.json` created at runtime → auto-refresh
      // silently gone after a reload). Invalidating the virtual module makes a
      // subsequent reload re-run `load()` against the live in-memory state. It
      // does NOT itself trigger a reload (the `hotUpdate` hook returns `[]`).
      function invalidateProjectModule() {
        try {
          const graph =
            (server.environments &&
              server.environments.client &&
              server.environments.client.moduleGraph) ||
            server.moduleGraph;
          if (!graph || typeof graph.getModuleById !== 'function') return;
          const mod = graph.getModuleById(RESOLVED_VIRTUAL_MODULE_ID);
          if (mod) graph.invalidateModule(mod);
        } catch {
          // The module graph can be torn down mid-shutdown — ignore.
        }
      }

      // ── Reusable: broadcast the current model over the HMR channel ─────────
      // `server.hot.send` is Vite's HMR custom-events channel — the studio
      // listens on `lerret:change` and bridges into the runtime. The payload
      // also carries `epoch` + `assetBaseUrl` so a folder switch can cache-bust
      // asset imports and flip the connected/no-project UI in one message.
      function broadcastChange(event) {
        // Keep the cached virtual module in step with what we are about to
        // broadcast, so a later reload re-serves this same state, not boot's.
        invalidateProjectModule();
        try {
          server.hot.send(HMR_CHANGE_EVENT, {
            event,
            project: currentProject,
            cascadeEntries: currentCascadeEntries,
            assetConfigEntries: currentAssetConfigEntries,
            epoch: state.epoch,
            assetBaseUrl: currentAssetBaseUrl(),
          });
        } catch (err) {
          // The HMR channel can be torn down mid-shutdown. Ignore.
          if (!String(err && err.message).includes('closed')) {
            console.error('[lerret] hot.send failed:', err && err.message ? err.message : err);
          }
        }
      }

      // ── Reusable: (re)start the chokidar watcher on the current folder ─────
      // Closes any existing watcher first, then watches `state.lerretDir`. Each
      // change patches the model + recomputes the cascade + broadcasts. Called
      // at boot and again on every switch (so the watcher always follows the
      // connected folder).
      async function restartProjectWatcher() {
        if (watcherHandle) {
          await watcherHandle.close().catch(() => {});
          watcherHandle = null;
        }
        if (!state.lerretDir) return;
        watcherHandle = startWatcher({
          root: toLerretPath(state.lerretDir),
          onEvent: async (event) => {
            try {
              currentProject = applyWatchEvent(currentProject, event);
            } catch (err) {
              console.error('[lerret] applyWatchEvent threw:', err && err.message ? err.message : err);
            }
            if (currentProject) {
              try {
                const cascadeMap = await computeCascadedConfig(currentProject, backend);
                currentCascadeEntries = serializeCascade(cascadeMap);
              } catch (cascadeErr) {
                console.error('[lerret] cascade recompute failed:', cascadeErr && cascadeErr.message ? cascadeErr.message : cascadeErr);
              }
              currentAssetConfigEntries = await computeAssetConfigEntries(currentProject, backend);
            }
            broadcastChange(event);
          },
          onError: (err) => {
            console.error('[lerret watcher]', err && err.message ? err.message : err);
          },
        });
        try {
          await watcherHandle.ready;
        } catch (err) {
          console.error('[lerret] watcher failed to start:', err && err.message ? err.message : err);
        }
      }

      // Serve the connected folder's files at the stable `/@lerret-project/*`
      // URL. This REPLACES what the old static `resolve.alias` did for raw GETs
      // (the `resolveId` above only covers module imports, NOT the direct
      // url()-fetches CSS makes for fonts/images). Rewrites to Vite's `/@fs/`
      // so the dev server serves from the CURRENT folder — re-pointing live on a
      // switch. Registered first so it runs before Vite's transform/SPA-fallback.
      server.middlewares.use(createProjectAssetMiddleware({ getLerretDir }));

      // Register the studio→CLI write + lifecycle endpoints. Each is handed a
      // LIVE `getLerretDir` getter (not the boot-time path) so after a folder
      // switch every write/rename/delete targets the newly-connected `.lerret/`.
      // They live BEFORE any no-project early-return so a stray POST in
      // no-project mode still gets a calm JSON 400 rather than Vite's HTML 404.
      //
      // The data-editor flows reuse the write endpoint — please do not shape it
      // around the data-editor's specific payload.
      server.middlewares.use(WRITE_ENDPOINT, createWriteMiddleware({ getLerretDir }));
      server.middlewares.use(RENAME_ENDPOINT, createRenameMiddleware({ getLerretDir }));
      server.middlewares.use(DUPLICATE_ENDPOINT, createDuplicateMiddleware({ getLerretDir }));
      server.middlewares.use(MOVE_ENDPOINT, createMoveMiddleware({ getLerretDir }));
      server.middlewares.use(CREATE_ENDPOINT, createCreateMiddleware({ getLerretDir }));
      server.middlewares.use(DELETE_ENDPOINT, createDeleteMiddleware({ getLerretDir }));
      server.middlewares.use(REVEAL_ENDPOINT, createRevealMiddleware({ getLerretDir }));
      server.middlewares.use(READ_CONFIG_ENDPOINT, createReadConfigMiddleware({ getLerretDir }));

      // Recent-projects list (persisted under the user's home) — read by the
      // studio's connect screen so re-opening a folder is one click.
      server.middlewares.use(RECENT_PROJECTS_ENDPOINT, createRecentProjectsMiddleware());

      // The runtime folder-switch endpoint. Re-points `state`, re-scans,
      // restarts the watcher, bumps the cache-bust epoch, records the recent
      // project, and broadcasts the new model — all without restarting the CLI.
      server.middlewares.use(
        SWITCH_FOLDER_ENDPOINT,
        createSwitchFolderMiddleware({
          state,
          rescan: rescanCurrentProject,
          restartWatcher: restartProjectWatcher,
          broadcast: broadcastChange,
        }),
      );

      // Initial connect (if the CLI was launched inside a project). A no-folder
      // launch skips this and waits for the studio to POST a switch.
      if (isProjectLoaded()) {
        await rescanCurrentProject();
        await restartProjectWatcher();
      }
    },

    /**
     * Close the chokidar watcher when the dev server shuts down. Without
     * this the CLI process never exits on Ctrl-C — chokidar holds open
     * `fs.watch` handles.
     */
    async closeBundle() {
      if (watcherHandle) {
        await watcherHandle.close().catch(() => {});
        watcherHandle = null;
      }
    },
  };
}

/**
 * Resolve a `--folder` argument (or null) to absolute, normalized paths the
 * plugin and `resolveProject` consume. Pure path arithmetic — no fs access.
 *
 * Exposed so `dev.js` and tests share one normalization helper.
 *
 * @param {string} folder
 * @param {string} [cwd=process.cwd()]
 * @returns {string}  An absolute path with forward slashes.
 */
export function normalizeFolderArg(folder, cwd = process.cwd()) {
  return toLerretPath(resolvePath(cwd, folder));
}

/**
 * Helper to push the synthetic `lerret:change` event payload, used in tests
 * that want to verify the studio-side bridge without spinning up chokidar.
 *
 * @param {string} type
 * @param {string} path
 * @returns {{ type: string, path: string }}
 */
export function buildChangeEvent(type, path) {
  return makeWatchEvent(type, path);
}

// ── Studio→CLI write endpoint middleware ──────────────────────────────────────

/**
 * Max size for a single write payload, in bytes. Keeps a runaway request from
 * exhausting memory or filling the project tree. A data file, config edit, or
 * asset rename never approaches this — 5 MB is conservative for the editors
 * that legitimately call this endpoint.
 *
 * @type {number}
 */
const MAX_WRITE_BYTES = 5 * 1024 * 1024;

/**
 * Read the body of a Connect request as a UTF-8 string, bounded by
 * `MAX_WRITE_BYTES`. Rejects with a string error on overflow / unreadable input.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_WRITE_BYTES) {
        reject(new Error(`payload exceeds ${MAX_WRITE_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Write a JSON response and end the request. Always exits with a `{ ok, error? }`
 * shape so the studio's write-client doesn't have to sniff for surprises.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {{ ok: boolean, error?: string }} body
 */
function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Resolve the currently-connected `.lerret/` path from a middleware's options.
 *
 * Supports two shapes so a single factory works for both call sites:
 *   • `{ getLerretDir }` — a LIVE getter (the dev server passes this) so each
 *     request sees the folder we're connected to *right now*, surviving runtime
 *     folder switches.
 *   • `{ lerretDir }`    — a fixed string (tests pass this) for a one-shot
 *     middleware bound to a known folder.
 *
 * @param {{ lerretDir?: string | null, getLerretDir?: () => (string | null) }} opts
 * @returns {string | null}
 */
function resolveLerretDir(opts) {
  if (opts && typeof opts.getLerretDir === 'function') return opts.getLerretDir();
  return (opts && opts.lerretDir) || null;
}

/**
 * Build the Connect-style middleware that serves the studio→CLI write
 * endpoint. Exposed (not just inlined) so tests can drive it directly with a
 * mocked req/res pair — no need to boot Vite.
 *
 * The middleware:
 *   - accepts POST only (other methods → 405)
 *   - parses the JSON body into `{ path, content }`
 *   - runs the path through {@link checkWritePath} (rejects traversal, paths
 *     outside `.lerret/`, missing project)
 *   - writes via the Node backend's safe-write (atomic temp+rename, NFR9)
 *   - returns `{ ok: true }` on success, `{ ok: false, error }` otherwise
 *
 * Failure modes return a calm JSON body even on 4xx/5xx — the studio never
 * sees an HTML error page, so a write failure is always actionable text.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 *   The user's `.lerret/` path, or null in no-project mode.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createWriteMiddleware(opts) {
  // One Node backend per middleware instance — the backend is stateless so
  // this is fine to share across requests.
  const backend = createNodeBackend();

  return function writeMiddleware(req, res /* , next */) {
    const lerretDir = resolveLerretDir(opts);
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed (use POST)' });
      return;
    }

    readRequestBody(req)
      .then(async (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: `invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        if (!parsed || typeof parsed !== 'object') {
          sendJson(res, 400, { ok: false, error: 'body must be a JSON object' });
          return;
        }

        const { path: requestPath, content } = parsed;

        if (typeof content !== 'string') {
          sendJson(res, 400, { ok: false, error: 'content must be a string' });
          return;
        }

        const check = checkWritePath(requestPath, lerretDir);
        if (!check.ok) {
          sendJson(res, 400, { ok: false, error: check.error });
          return;
        }

        try {
          await backend.writeFile(check.normalized, content, { encoding: 'utf-8' });
          sendJson(res, 200, { ok: true });
        } catch (err) {
          // Surface the message, not the stack — the studio displays this
          // string to the user (calm, actionable; no raw stack).
          const message = err instanceof Error ? err.message : String(err);
          console.error('[lerret] write failed:', message);
          sendJson(res, 500, { ok: false, error: `write failed: ${message}` });
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 400, { ok: false, error: message });
      });
  };
}

// ── Lifecycle endpoint middlewares ────────────────────────────────────────────
//
// All four (rename / duplicate / delete / reveal) share the same accept-POST-
// parse-JSON-then-gate skeleton. The shared `withJsonBody` helper keeps each
// middleware down to its actual semantics.

/**
 * Shared wrapper: accepts POST only, parses the JSON body, runs the supplied
 * `handler` with the parsed body. On any framing error returns a calm
 * `{ ok: false, error }` JSON response. The handler is responsible for the
 * domain-specific path-safety check and disk call.
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: Record<string, unknown>) => Promise<void> | void} handler
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
function withJsonBody(handler) {
  return function middleware(req, res /* , next */) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed (use POST)' });
      return;
    }
    readRequestBody(req)
      .then(async (raw) => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: `invalid JSON body: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        if (!parsed || typeof parsed !== 'object') {
          sendJson(res, 400, { ok: false, error: 'body must be a JSON object' });
          return;
        }
        await handler(req, res, parsed);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, 400, { ok: false, error: message });
      });
  };
}

/**
 * `POST /__lerret/rename` — body `{ from: LerretPath, to: LerretPath }`.
 *
 * Both paths are gated through {@link checkWritePath} so neither escapes the
 * project's `.lerret/` tree. The source must exist; the destination must NOT
 * exist (so a typo never clobbers an unrelated file). The chokidar watcher
 * fans the resulting rename out as an `add` + `remove` pair.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createRenameMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { from, to } = body;
    if (typeof from !== 'string' || typeof to !== 'string') {
      sendJson(res, 400, { ok: false, error: 'from and to must be strings' });
      return;
    }
    const fromCheck = checkWritePath(from, lerretDir);
    if (!fromCheck.ok) {
      sendJson(res, 400, { ok: false, error: `from: ${fromCheck.error}` });
      return;
    }
    const toCheck = checkWritePath(to, lerretDir);
    if (!toCheck.ok) {
      sendJson(res, 400, { ok: false, error: `to: ${toCheck.error}` });
      return;
    }
    try {
      await renameEntry(fromCheck.normalized, toCheck.normalized);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[lerret] rename failed:', message);
      sendJson(res, 500, { ok: false, error: `rename failed: ${message}` });
    }
  });
}

/**
 * `POST /__lerret/duplicate` — body `{ path: LerretPath }`.
 *
 * Produces a sibling copy of the file or folder at `path`, naming it with a
 * `(copy)` / `(copy N)` suffix until a free name is found. The response
 * carries the new path so the caller can highlight it.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createDuplicateMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { path: requestPath } = body;
    if (typeof requestPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'path must be a string' });
      return;
    }
    const check = checkWritePath(requestPath, lerretDir);
    if (!check.ok) {
      sendJson(res, 400, { ok: false, error: check.error });
      return;
    }
    try {
      const result = await duplicateEntry(check.normalized);
      sendJson(res, 200, { ok: true, path: result.path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[lerret] duplicate failed:', message);
      sendJson(res, 500, { ok: false, error: `duplicate failed: ${message}` });
    }
  });
}

/**
 * `POST /__lerret/move` — body
 *   `{ fromPath: LerretPath, toFolderPath: LerretPath }`.
 *
 * Moves a file or folder from `fromPath` into the destination folder
 * `toFolderPath` (keeping the source's basename — collisions are refused with
 * `409` since move is a reparent, not a copy). Both paths are gated through
 * {@link checkWritePath} server-side; cycle moves and missing-source paths are
 * `400` (not `500`) so the picker can surface them inline.
 *
 * The handler delegates to {@link moveEntry} for the actual filesystem dance:
 * companion-file discovery (including the asset's `Name.config.json`), EXDEV
 * fallback, and atomic rollback on partial failure.
 *
 * Response shape (always JSON):
 *   • 200 `{ ok: true, newPath: <LerretPath> }`
 *   • 400 `{ ok: false, error: <message> }` — cycle / missing source /
 *         outside .lerret/.
 *   • 409 `{ ok: false, error: <message> }` — destination collision.
 *   • 500 `{ ok: false, error: <message> }` — unrecognized fs failure.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createMoveMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { fromPath, toFolderPath } = body;
    if (typeof fromPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'fromPath must be a string' });
      return;
    }
    if (typeof toFolderPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'toFolderPath must be a string' });
      return;
    }
    const fromCheck = checkWritePath(fromPath, lerretDir);
    if (!fromCheck.ok) {
      sendJson(res, 400, { ok: false, error: `fromPath: ${fromCheck.error}` });
      return;
    }
    // For the destination folder we allow equality with the .lerret/ root
    // (moving a folder to the top-level page list is a valid case per the
    // spec's row #21). `checkWritePath` refuses the bare .lerret/ path, so
    // we hand-roll the destination check.
    const toCheck = validateMoveDest(toFolderPath, lerretDir);
    if (!toCheck.ok) {
      sendJson(res, 400, { ok: false, error: `toFolderPath: ${toCheck.error}` });
      return;
    }
    try {
      const result = await moveEntry(fromCheck.normalized, toCheck.normalized);
      sendJson(res, 200, {
        ok: true,
        newPath: result.path,
      });
    } catch (err) {
      const code = err && err.code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'cycle' || code === 'missing-source' || code === 'missing-dest') {
        sendJson(res, 400, { ok: false, error: message });
        return;
      }
      if (code === 'collision') {
        sendJson(res, 409, { ok: false, error: message });
        return;
      }
      console.error('[lerret] move failed:', message);
      sendJson(res, 500, { ok: false, error: `move failed: ${message}` });
    }
  });
}

/**
 * Validate the `toFolderPath` payload for the move endpoint. Mirrors
 * {@link checkWritePath} but allows the bare `.lerret/` directory (moving a
 * folder to the project root is a legitimate move).
 *
 * @param {string} requestPath
 * @param {string | null} lerretDir
 * @returns {{ ok: true, normalized: string } | { ok: false, error: string }}
 */
function validateMoveDest(requestPath, lerretDir) {
  if (!lerretDir) {
    return { ok: false, error: 'no project is loaded — writes are not available' };
  }
  if (typeof requestPath !== 'string' || requestPath.length === 0) {
    return { ok: false, error: 'path must be a non-empty string' };
  }
  if (requestPath.includes('\0')) {
    return { ok: false, error: 'path contains an illegal NUL byte' };
  }
  const normalized = requestPath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  for (const seg of segments) {
    if (seg === '..') {
      return { ok: false, error: 'path traversal (..) is not allowed' };
    }
  }
  const root = lerretDir.replace(/\/+$/, '');
  if (normalized === root) {
    return { ok: true, normalized };
  }
  if (!normalized.startsWith(root + '/')) {
    return { ok: false, error: 'destination must be inside .lerret/' };
  }
  return { ok: true, normalized };
}

/**
 * `POST /__lerret/delete` — body `{ path: LerretPath }`.
 *
 * Removes the file or folder. Folders are deleted recursively. The watcher
 * fires a `remove` event so the canvas reflects the change automatically.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createDeleteMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { path: requestPath } = body;
    if (typeof requestPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'path must be a string' });
      return;
    }
    const check = checkWritePath(requestPath, lerretDir);
    if (!check.ok) {
      sendJson(res, 400, { ok: false, error: check.error });
      return;
    }
    try {
      await deleteEntry(check.normalized);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[lerret] delete failed:', message);
      sendJson(res, 500, { ok: false, error: `delete failed: ${message}` });
    }
  });
}

/**
 * `POST /__lerret/read-config` — body `{ path: LerretPath }` (a folder's
 * `config.json` path inside `.lerret/`). Reads and safe-parses the folder's
 * OWN config.json so the studio's Config editor can show its current values.
 *
 * Why this exists: a plain GET of the file can't be used — the dev server's
 * SPA fallback returns index.html (text/html) for any unknown path, so the
 * editor could never tell "missing" apart from "present" without it.
 *
 * Response (always JSON):
 *   • 200 `{ ok: true, value }`                     — parsed config object.
 *   • 200 `{ ok: true, missing: true, value: {} }`  — no config.json yet.
 *   • 200 `{ ok: false, error }`                    — present but invalid JSON.
 *   • 400 `{ ok: false, error }`                    — bad / escaping path.
 *   • 500 `{ ok: false, error }`                    — unexpected read failure.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createReadConfigMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { path: requestPath } = body;
    if (typeof requestPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'path must be a string' });
      return;
    }
    const check = checkWritePath(requestPath, lerretDir);
    if (!check.ok) {
      sendJson(res, 400, { ok: false, error: check.error });
      return;
    }
    try {
      const result = await tryReadConfig(check.normalized);
      if (result.kind === 'missing') {
        sendJson(res, 200, { ok: true, missing: true, value: {} });
        return;
      }
      if (result.kind === 'malformed') {
        sendJson(res, 200, { ok: false, error: 'config.json is not valid JSON' });
        return;
      }
      sendJson(res, 200, { ok: true, value: result.value });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[lerret] read-config failed:', message);
      sendJson(res, 500, { ok: false, error: `read failed: ${message}` });
    }
  });
}

/**
 * `POST /__lerret/reveal` — body `{ path: LerretPath, target: 'editor'|'finder' }`.
 *
 * Shells out to the OS to reveal the path in the user's editor (`code <path>`)
 * or file manager (`open -R` on macOS, `explorer.exe /select,` on Windows,
 * `xdg-open` on Linux). Missing binaries report a calm string the studio can
 * show; the endpoint NEVER throws.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createRevealMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { path: requestPath, target } = body;
    if (typeof requestPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'path must be a string' });
      return;
    }
    if (target !== 'editor' && target !== 'finder') {
      sendJson(res, 400, { ok: false, error: 'target must be "editor" or "finder"' });
      return;
    }
    const check = checkWritePath(requestPath, lerretDir);
    if (!check.ok) {
      sendJson(res, 400, { ok: false, error: check.error });
      return;
    }
    const result = await revealEntry(check.normalized, target);
    if (result.ok) {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 500, { ok: false, error: result.error || 'reveal failed' });
    }
  });
}

/**
 * `POST /__lerret/create` — body
 *   `{ parentPath, name, kind: 'folder'|'asset', assetKind?: 'component'|'markdown' }`.
 *
 * Creates a new page/group folder (parent === `.lerret/` → page; deeper →
 * group) or a starter asset file inside `parentPath`. The parent is validated
 * with {@link validateMoveDest} (which allows the bare `.lerret/` root, so a new
 * top-level page is permitted); the name is validated with the shared
 * `validateEntryName` from `@lerret/core` — the same rules the studio dialog
 * uses, so client and server never disagree.
 *
 * Response shape (always JSON):
 *   • 200 `{ ok: true, path: <LerretPath> }` — the created entry.
 *   • 400 `{ ok: false, error }` — bad parent / name / kind.
 *   • 409 `{ ok: false, error }` — a sibling of that name already exists
 *     (case-insensitive).
 *   • 500 `{ ok: false, error }` — unexpected filesystem failure.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createCreateMiddleware(opts) {
  return withJsonBody(async (_req, res, body) => {
    const lerretDir = resolveLerretDir(opts);
    const { parentPath, name, kind, assetKind } = body;
    if (typeof parentPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'parentPath must be a string' });
      return;
    }
    if (typeof name !== 'string') {
      sendJson(res, 400, { ok: false, error: 'name must be a string' });
      return;
    }
    if (kind !== 'folder' && kind !== 'asset') {
      sendJson(res, 400, { ok: false, error: 'kind must be "folder" or "asset"' });
      return;
    }
    if (
      kind === 'asset' &&
      assetKind !== undefined &&
      assetKind !== 'component' &&
      assetKind !== 'markdown'
    ) {
      sendJson(res, 400, { ok: false, error: 'assetKind must be "component" or "markdown"' });
      return;
    }

    // Validate the parent folder (allows the bare `.lerret/` root for pages).
    const parentCheck = validateMoveDest(parentPath, lerretDir);
    if (!parentCheck.ok) {
      sendJson(res, 400, { ok: false, error: `parentPath: ${parentCheck.error}` });
      return;
    }

    // Derive the name-validation kind: a folder directly under the project root
    // is a page; a deeper folder is a group; otherwise an asset. This drives the
    // reserved-name rules (e.g. leading `_` is reserved for folders).
    const root = (lerretDir || '').replace(/\/+$/, '');
    const isRoot = parentCheck.normalized === root;
    const nameKind = kind === 'asset' ? 'asset' : isRoot ? 'page' : 'group';
    const nameCheck = validateEntryName(name, { kind: nameKind });
    if (!nameCheck.ok) {
      sendJson(res, 400, { ok: false, error: nameCheck.error });
      return;
    }

    try {
      const result = await createEntry(parentCheck.normalized, nameCheck.name, kind, { assetKind });
      sendJson(res, 200, { ok: true, path: result.path });
    } catch (err) {
      const code = err && err.code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'collision') {
        sendJson(res, 409, { ok: false, error: message });
        return;
      }
      if (code === 'missing-parent' || code === 'invalid-kind') {
        sendJson(res, 400, { ok: false, error: message });
        return;
      }
      console.error('[lerret] create failed:', message);
      sendJson(res, 500, { ok: false, error: `create failed: ${message}` });
    }
  });
}

// ── Project-asset serving (dynamic replacement for the old static alias) ──────

/**
 * Build the middleware that serves the connected folder's files at the stable
 * `/@lerret-project/*` URL by rewriting each request to Vite's `/@fs/<abs>`.
 *
 * The old implementation used a static `resolve.alias`, which (a) could only
 * ever point at the boot-time folder and (b) covered both module imports and the
 * raw GETs CSS makes via `url()` for fonts/images. We replaced the alias with a
 * dynamic `resolveId` for module imports — but `resolveId` does NOT run for a
 * plain font/image GET, so those would fall through to the SPA fallback (and a
 * font would "load" as `index.html`, failing to decode). This middleware closes
 * that gap: it rewrites `GET /@lerret-project/<rest>` →
 * `/@fs/<currentLerretDir>/<rest>`, so Vite serves the file from whatever folder
 * is connected RIGHT NOW — transforming `.jsx`/`.tsx`/`.md` and serving fonts/
 * images statically, with the query (`?v=`, `?t=`, `?raw`) preserved. `fs.strict
 * = false` (set in `config()`) lets `/@fs/` reach any connected folder.
 *
 * @param {{ getLerretDir: () => (string | null) }} opts
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createProjectAssetMiddleware({ getLerretDir }) {
  return function projectAssetMiddleware(req, res, next) {
    const lerretDir = getLerretDir();
    if (!lerretDir) return next();
    const url = req.url || '';
    if (!url.startsWith(PROJECT_ASSET_BASE_URL + '/')) return next();
    // Everything after the prefix — the leading '/' AND the query string.
    const rest = url.slice(PROJECT_ASSET_BASE_URL.length);
    req.url = '/@fs' + lerretDir.replace(/\/+$/, '') + rest;
    return next();
  };
}

// ── Recent-projects endpoint ──────────────────────────────────────────────────
//
// The persistence (`readRecentProjects` / `recordRecentProject`) lives in
// node-backend (the only file allowed to touch `fs`); it stores the list at
// `~/.lerret/recent-projects.json` (overridable via `LERRET_CONFIG_DIR`), which
// is host-level config, NOT inside any project's `.lerret/` — NFR13 untouched.

/**
 * `GET /__lerret/recent-projects` → `{ ok: true, recent: [{ path, name }] }`.
 * Always 200 with a (possibly empty) list — the connect screen treats an empty
 * list as "no recents yet", never an error.
 *
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createRecentProjectsMiddleware() {
  return function recentProjectsMiddleware(req, res /* , next */) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method not allowed (use GET)' });
      return;
    }
    readRecentProjects()
      .then((recent) => sendJson(res, 200, { ok: true, recent }))
      .catch(() => sendJson(res, 200, { ok: true, recent: [] }));
  };
}

// ── Runtime folder-switch endpoint ────────────────────────────────────────────

/**
 * Validate + normalize a `switch-folder` request body's `folder` field into a
 * clear intent. Pure (no fs) so it's unit-testable.
 *
 * @param {unknown} folder
 * @returns {{ kind: 'close' } | { kind: 'connect', folder: string } | { kind: 'error', error: string }}
 */
export function classifySwitchFolder(folder) {
  if (folder === null || folder === undefined || folder === '') return { kind: 'close' };
  if (typeof folder !== 'string') {
    return { kind: 'error', error: 'folder must be a string path or null' };
  }
  return { kind: 'connect', folder };
}

/**
 * `POST /__lerret/switch-folder` — re-point the studio at a different folder
 * (or close the current project) WITHOUT restarting the CLI.
 *
 * Body `{ folder }`:
 *   • a path → `resolveProject` walks up to find `.lerret/`; on success we
 *     re-point `state`, re-scan, restart the watcher, bump the cache-bust epoch,
 *     record the recent project, and broadcast the new model.
 *   • `null` / `''` → close the current project (studio returns to the connect
 *     screen).
 *
 * The new model reaches the studio over the existing `lerret:change` broadcast
 * (which already carries `project` + `cascadeEntries`, now also `epoch` +
 * `assetBaseUrl`); this HTTP response is the acknowledgement.
 *
 * @param {object} deps
 * @param {{ projectRoot: string|null, lerretDir: string|null, epoch: number }} deps.state
 * @param {() => Promise<void>} deps.rescan          Re-scan `state.lerretDir`.
 * @param {() => Promise<void>} deps.restartWatcher  (Re)start the watcher.
 * @param {(event: { type: string, path: string }) => void} deps.broadcast
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createSwitchFolderMiddleware({ state, rescan, restartWatcher, broadcast }) {
  return withJsonBody(async (_req, res, body) => {
    const intent = classifySwitchFolder(body.folder);

    if (intent.kind === 'error') {
      sendJson(res, 400, { ok: false, error: intent.error });
      return;
    }

    if (intent.kind === 'close') {
      state.projectRoot = null;
      state.lerretDir = null;
      state.epoch += 1;
      await rescan();          // → currentProject = null
      await restartWatcher();  // → closes the watcher (no folder to watch)
      broadcast({ type: 'switch', path: '' });
      sendJson(res, 200, { ok: true, projectRoot: null, lerretDir: null, epoch: state.epoch });
      return;
    }

    // intent.kind === 'connect'
    let resolution;
    try {
      resolution = await resolveProject(intent.folder);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 400, { ok: false, error: `could not access "${intent.folder}": ${message}` });
      return;
    }
    if (!resolution.found) {
      sendJson(res, 400, {
        ok: false,
        error: `no .lerret/ project found at or above "${intent.folder}"`,
      });
      return;
    }

    state.projectRoot = resolution.projectRoot;
    state.lerretDir = resolution.lerretDir;
    state.epoch += 1;
    await rescan();
    await restartWatcher();
    const recent = await recordRecentProject(resolution.projectRoot);
    broadcast({ type: 'switch', path: resolution.lerretDir });

    sendJson(res, 200, {
      ok: true,
      projectRoot: resolution.projectRoot,
      lerretDir: resolution.lerretDir,
      epoch: state.epoch,
      recent,
    });
  });
}
