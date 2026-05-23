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

import { scan, applyWatchEvent, makeWatchEvent, computeCascadedConfig } from '@lerret/core';

import {
  createNodeBackend,
  deleteEntry,
  duplicateEntry,
  moveEntry,
  renameEntry,
  revealEntry,
} from './fs/node-backend.js';
import { startWatcher } from './watcher.js';

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
function buildVirtualModuleSource({ project, assetBaseUrl, projectRoot, lerretDir, cascadeEntries, overrides }) {
  return [
    '// AUTO-GENERATED by `vite-plugin-lerret-project`. Do not edit.',
    `export const project = ${JSON.stringify(project)};`,
    `export const assetBaseUrl = ${JSON.stringify(assetBaseUrl)};`,
    `export const projectRoot = ${JSON.stringify(projectRoot)};`,
    `export const lerretDir = ${JSON.stringify(lerretDir)};`,
    // cascadeEntries: Array<[LerretPath, ConfigObject]> — rehydrated to a Map
    // in the studio's CascadedConfigProvider.
    `export const cascadeEntries = ${JSON.stringify(cascadeEntries)};`,
    // overrides: { data, config } — in-memory export-time overrides.
    // `data`   → the studio runtime merges this at tier 1 of resolveProps.
    // `config` → already deep-merged into cascadeEntries above; exposed here
    //            so the studio can detect that an override is active if needed.
    `export const overrides = ${JSON.stringify(overrides)};`,
    `export const mode = 'cli';`,
    `export default { project, assetBaseUrl, projectRoot, lerretDir, cascadeEntries, overrides, mode };`,
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

  /** @type {import('./watcher.js').WatcherHandle | null} */
  let watcherHandle = null;

  // The plugin works in two modes:
  //   - "project mode": a real user folder was resolved.
  //   - "no-project mode": the virtual module still exists but exports
  //     `project: null` so the studio's CLI-mode source can render its
  //     placeholder. No watcher in that case — there's nothing to watch.
  const hasProject = !!(projectRoot && lerretDir);
  const assetBaseUrl = hasProject ? PROJECT_ASSET_BASE_URL : null;

  return {
    name: 'lerret:project',

    /**
     * Extend the resolved Vite config so the user's project files are
     * (a) served by the dev server even though they live outside the
     * studio root, and (b) reachable at our stable URL prefix.
     */
    config(userConfig) {
      if (!hasProject) {
        // No project to serve — keep Vite's defaults untouched. The virtual
        // module still resolves below.
        return {};
      }

      // We MERGE — not replace — `server.fs.allow`: Vite resolves the
      // existing list down to the workspace root (which contains the
      // studio source `dev.js` boots), and we add the user's project root
      // on top so a request for an asset under it is allowed. Mutating an
      // existing array would override `dev.js`'s entries; returning a
      // partial config (Vite merges arrays for `fs.allow`) keeps both.
      const existingAllow = ((userConfig && userConfig.server && userConfig.server.fs && userConfig.server.fs.allow) || []);

      return {
        resolve: {
          alias: {
            // Alias the stable URL prefix to the user's `.lerret/`
            // directory — the scan root the runtime composes paths from.
            // The asset-runtime emits URLs of the shape
            //   `<assetBaseUrl>/<rel>`
            // where `<rel>` is the asset's path *relative to the scan
            // root* (`assetModuleUrl` already strips `project.path` from
            // the asset path). So a runtime dynamic `import()` of
            //   `/@lerret-project/ui-components/StatCard.jsx`
            // resolves through this alias to the same file on disk, and
            // Vite transforms `.jsx`/`.tsx` on the fly (and `.md?raw`).
            //
            // (Mirrors the studio's standalone-dev fixture wiring, which
            // aliases `/@fixture-lerret` → the fixture's `.lerret/` for
            // exactly the same reason.)
            [PROJECT_ASSET_BASE_URL]: lerretDir,
          },
        },
        server: {
          fs: {
            // Append the user's project root to whatever `dev.js` already
            // allowed (workspace root, studio root, etc.). We allow the
            // PROJECT root, not just `.lerret/`, so a font/image whose
            // relative-import path inside an asset escapes the scan root
            // (e.g. `import logo from '../../assets/logo.png'`) is still
            // serveable. The plugin never writes here.
            allow: [...existingAllow, projectRoot],
          },
        },
      };
    },

    /**
     * Resolve `'virtual:lerret-project'` to a synthetic module id (per
     * Vite's virtual-module convention).
     */
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
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
        assetBaseUrl,
        projectRoot,
        lerretDir,
        cascadeEntries: effectiveCascadeEntries,
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
      // Register the studio→CLI write endpoint as a Vite
      // middleware. Lives BEFORE the no-project early-return so a stray
      // POST in no-project mode still gets a calm JSON 400 instead of
      // falling through to Vite's HTML 404 page.
      //
      // The data-editor flows reuse this same endpoint — please do not
      // shape it around the data-editor's specific payload.
      server.middlewares.use(WRITE_ENDPOINT, createWriteMiddleware({ lerretDir }));

      // Lifecycle endpoints for the per-entity kebab menus.
      // Each is the same calm POST-JSON shape as the write endpoint, gated
      // through `checkWritePath` server-side so a malicious or buggy caller
      // cannot escape the `.lerret/` tree.
      server.middlewares.use(RENAME_ENDPOINT, createRenameMiddleware({ lerretDir }));
      server.middlewares.use(DUPLICATE_ENDPOINT, createDuplicateMiddleware({ lerretDir }));
      server.middlewares.use(MOVE_ENDPOINT, createMoveMiddleware({ lerretDir }));
      server.middlewares.use(DELETE_ENDPOINT, createDeleteMiddleware({ lerretDir }));
      server.middlewares.use(REVEAL_ENDPOINT, createRevealMiddleware({ lerretDir }));

      if (!hasProject) {
        // No watcher needed in no-project mode; the virtual module already
        // exports `project: null`.
        return;
      }

      // Initial scan — feeds the first virtual-module load. The studio
      // boots already knowing the project; the watcher only ever pushes
      // *incremental* updates from here on.
      const backend = createNodeBackend();
      try {
        currentProject = await scan(backend, toLerretPath(lerretDir));
        // Compute the initial cascade immediately after scanning. This is the
        // server-side computation that avoids any filesystem access in the
        // browser. A failed cascade falls back to empty (safe default).
        try {
          const cascadeMap = await computeCascadedConfig(currentProject, backend);
          currentCascadeEntries = serializeCascade(cascadeMap);
        } catch (cascadeErr) {
          console.error('[lerret] initial cascade computation failed:', cascadeErr && cascadeErr.message ? cascadeErr.message : cascadeErr);
          currentCascadeEntries = [];
        }
      } catch (err) {
        // A failed initial scan is rare (the loader is forgiving) but
        // possible — e.g. the `.lerret/` directory was deleted between CLI
        // start-up and plugin init. Surface a clear log, keep the server
        // running with `project: null` so the studio at least mounts.
        console.error('[lerret] initial project scan failed:', err && err.message ? err.message : err);
        currentProject = null;
        currentCascadeEntries = [];
      }

      // Start the watcher on the user's `.lerret/`. Each chokidar change is
      // already normalized by `startWatcher` to a `WatchEvent`; we patch
      // the model with `applyWatchEvent` and broadcast a `lerret:change`
      // payload that carries both the event and the new full model.
      watcherHandle = startWatcher({
        root: toLerretPath(lerretDir),
        onEvent: async (event) => {
          // Patch the in-memory model — pure, idempotent (`applyWatchEvent`
          // owns the FR2-7 mapping rules). On a no-op event (e.g. a
          // `_assets/` image change) the model is returned unchanged; we
          // still ship the event downstream so the runtime can bump its
          // cache-bust for that file path.
          try {
            currentProject = applyWatchEvent(currentProject, event);
          } catch (err) {
            // applyWatchEvent should not throw on a validated event, but a
            // bug here must not take down the live-edit loop. Log and keep
            // the previous model.
            console.error('[lerret] applyWatchEvent threw:', err && err.message ? err.message : err);
          }

          // Recompute the cascade whenever the model changes. This covers
          // both config.json edits (which `applyWatchEvent` marks as a
          // change event for the config path) and structural add/remove/
          // rename events (which may alter which folders have cascade entries).
          // A cascade failure is non-fatal — keep the prior entries.
          if (currentProject) {
            try {
              const cascadeMap = await computeCascadedConfig(currentProject, backend);
              currentCascadeEntries = serializeCascade(cascadeMap);
            } catch (cascadeErr) {
              console.error('[lerret] cascade recompute failed:', cascadeErr && cascadeErr.message ? cascadeErr.message : cascadeErr);
              // Keep previous cascade entries — better to show stale bg than crash.
            }
          }

          // Push to the studio. `server.hot.send` is Vite 8's HMR custom-
          // events channel — the studio listens on `import.meta.hot.on(
          // 'lerret:change', …)` and bridges into the runtime.
          try {
            server.hot.send(HMR_CHANGE_EVENT, {
              event,
              project: currentProject,
              // The recomputed cascade so the studio's CascadedConfigProvider
              // can update immediately when a config.json changes (FR18 live
              // update — the section bg responds without a full reload).
              cascadeEntries: currentCascadeEntries,
            });
          } catch (err) {
            // The HMR channel can be torn down mid-shutdown. Ignore.
            if (!String(err && err.message).includes('closed')) {
              console.error('[lerret] hot.send failed:', err && err.message ? err.message : err);
            }
          }
        },
        onError: (err) => {
          // Watcher errors are non-fatal — log and keep running.
          console.error('[lerret watcher]', err && err.message ? err.message : err);
        },
      });

      // Wait for the watcher's initial scan so the dev server is genuinely
      // live when we hand control back to Vite. `ready` resolves once
      // chokidar's silent first walk completes.
      try {
        await watcherHandle.ready;
      } catch (err) {
        // A pre-ready chokidar failure — the watcher won't deliver events
        // but the server can still serve the initial project. Log so the
        // user sees why live-edit isn't firing.
        console.error('[lerret] watcher failed to start:', err && err.message ? err.message : err);
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
export function createWriteMiddleware({ lerretDir }) {
  // One Node backend per middleware instance — the backend is stateless so
  // this is fine to share across requests.
  const backend = createNodeBackend();

  return function writeMiddleware(req, res /* , next */) {
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
export function createRenameMiddleware({ lerretDir }) {
  return withJsonBody(async (_req, res, body) => {
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
export function createDuplicateMiddleware({ lerretDir }) {
  return withJsonBody(async (_req, res, body) => {
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
 *   `{ fromPath: LerretPath, toFolderPath: LerretPath, carryLiveRefresh?: boolean }`.
 *
 * Moves a file or folder from `fromPath` into the destination folder
 * `toFolderPath` (keeping the source's basename — collisions are refused with
 * `409` since move is a reparent, not a copy). Both paths are gated through
 * {@link checkWritePath} server-side; cycle moves and missing-source paths are
 * `400` (not `500`) so the picker can surface them inline.
 *
 * The handler delegates to {@link moveEntry} for the actual filesystem dance:
 * companion-file discovery, EXDEV fallback, atomic rollback on partial
 * failure, and optional liveRefresh carry-over.
 *
 * Response shape (always JSON):
 *   • 200 `{ ok: true, newPath: <LerretPath>, rewroteLiveRefresh: <tag> }`
 *   • 400 `{ ok: false, error: <message> }` — cycle / missing source /
 *         outside .lerret/ / malformed dest config when carrying.
 *   • 409 `{ ok: false, error: <message> }` — destination collision.
 *   • 500 `{ ok: false, error: <message> }` — unrecognized fs failure.
 *
 * @param {object} opts
 * @param {string | null} opts.lerretDir
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void) => void}
 */
export function createMoveMiddleware({ lerretDir }) {
  return withJsonBody(async (_req, res, body) => {
    const { fromPath, toFolderPath, carryLiveRefresh } = body;
    if (typeof fromPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'fromPath must be a string' });
      return;
    }
    if (typeof toFolderPath !== 'string') {
      sendJson(res, 400, { ok: false, error: 'toFolderPath must be a string' });
      return;
    }
    if (carryLiveRefresh !== undefined && typeof carryLiveRefresh !== 'boolean') {
      sendJson(res, 400, { ok: false, error: 'carryLiveRefresh must be a boolean' });
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
      const result = await moveEntry(fromCheck.normalized, toCheck.normalized, {
        carryLiveRefresh: carryLiveRefresh === true,
      });
      sendJson(res, 200, {
        ok: true,
        newPath: result.path,
        rewroteLiveRefresh: result.rewroteLiveRefresh,
      });
    } catch (err) {
      const code = err && err.code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'cycle' || code === 'missing-source' || code === 'missing-dest' || code === 'malformed-dest-config') {
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
export function createDeleteMiddleware({ lerretDir }) {
  return withJsonBody(async (_req, res, body) => {
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
export function createRevealMiddleware({ lerretDir }) {
  return withJsonBody(async (_req, res, body) => {
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
