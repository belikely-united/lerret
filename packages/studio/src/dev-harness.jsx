// dev-harness.jsx — TEMPORARY fixture-scan seam. NOT studio rendering code.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ THIS WHOLE FILE IS DEV-HARNESS / FIXTURE WIRING. ║
// ║ The `lerret dev` CLI replaces it: the real CLI stands up a Vite ║
// ║ dev server over the *user's* `.lerret/` folder and scans that folder ║
// ║ with the Node `fs` backend. Everything below — and ONLY this file — is ║
// ║ the seam that swap touches. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ── What this harness still does ────────────────────────────────────────────
// Its job has shrunk to a few small steps:
// 1. Scan the bundled fixture project → a real `@lerret/core` `ProjectNode`.
// 2. Create the real CLI-mode `vite-runtime` for it, then hand the model +
// runtime to `<ProjectStudio>` — the real studio composition root, which
// owns page routing, the dock + page picker, and the canvas rendering.
// 3. Wire the dev-mode change signal:
// • Vite's React Fast Refresh handles in-place updates of `.jsx`/`.tsx`
// component code; the harness adds an `import.meta.hot` listener so
// any *fixture file* update also triggers `runtime.notifyChange(...)`,
// which causes the canvas to re-load that asset's entries (so a
// `meta` change re-runs `parseMeta` and re-sizes the artboard, and
// a markdown edit re-renders the document card).
// • In `lerret dev` this same `notifyChange` API is called by the
// chokidar-driven CLI watcher — the runtime side of the contract is
// already in place; the CLI swaps the dev-harness HMR source for the
// real watcher source.
//
// The canvas rendering, the page picker, the page routing — all moved into
// real studio code (`project-studio.jsx`, `components/canvas/*`,
// `components/dock/*`). This file no longer renders anything itself; it only
// produces the `{ project, runtime }` pair from the fixture (plus the
// fixture-only HMR → notifyChange wiring above).
//
// ── What is REAL (and NOT replaced by the CLI) ──────────────────────────────
// - `src/runtime/asset-runtime.js` — the asset-runtime interface (AR4)
// - `src/runtime/vite-runtime.js` — the CLI-mode runtime implementation
// - `@lerret/core`'s `scan()` — the real project-model loader
// - `src/project-studio.jsx` + `components/{canvas,dock}/*` — the studio
// This harness only *drives* those real pieces with a fixture project.
//
// The fixture project lives at `packages/studio/fixtures/sample-project/` — a
// real Lerret project (`.lerret/` with multiple pages, a deeply nested group
// (a group inside a group), `.jsx` + a `.tsx`, a local-image import, two
// deliberately-broken assets, and `.md` document assets).

import React from 'react';

import { scan, computeCascadedConfig } from '@lerret/core';

import { createViteRuntime } from './runtime/vite-runtime.js';
import { ProjectStudio } from './project-studio.jsx';
import { CascadedConfigProvider } from './components/canvas/cascade-context.jsx';

// ───────────────────────────────────────────────────────────────────────────
// Fixture filesystem — DEV-HARNESS ONLY.
//
// The fixture project's `.lerret/` folder is OUTSIDE `src/`, at
// `packages/studio/fixtures/sample-project/.lerret/`. Vite's `import.meta.glob`
// enumerates it at dev time (eager: false → the asset modules themselves are
// loaded lazily, by the runtime, through the dev server). The keys are file
// paths relative to this module; we build an in-memory `FilesystemAccess` tree
// from them so the real `scan()` can walk it. The CLI swaps this for the
// Node `fs` backend over the user folder.
// ───────────────────────────────────────────────────────────────────────────

// Match EVERY file under the fixture's `.lerret/` (assets, images, anything)
// so `scan()` sees the true tree — including the reserved `_assets/` folder
// and non-asset files it must exclude.
const FIXTURE_GLOB = import.meta.glob('../fixtures/sample-project/.lerret/**/*', {
 query: '?url',
 import: 'default',
 eager: true,
});

// Pull in all config.json files as raw strings so `computeCascadedConfig`
// can read them via `makeFixtureFs().readFile`. This is the dev-harness
// mirror of the CLI plugin's Node-backend `readFile`.
const FIXTURE_CONFIG_GLOB = import.meta.glob('../fixtures/sample-project/.lerret/**/config.json', {
 query: '?raw',
 import: 'default',
 eager: true,
});

// The fixture's `.lerret/` path, as a synthetic forward-slash `LerretPath`.
// `scan()` only does string work on these — they need to be consistent, not
// real OS paths.
const FIXTURE_LERRET_ROOT = '/sample-project/.lerret';

// The Vite alias the fixture's `.lerret/` is served under (see vite.config.js).
// The asset runtime and the font registry both rebase project file
// paths onto this base URL. The CLI swaps it for the real `lerret dev` URL.
const FIXTURE_ASSET_BASE_URL = '/@fixture-lerret';

/**
 * Build the synthetic in-memory directory tree the harness FS serves, from the
 * `import.meta.glob` keys. Each key like
 * `../fixtures/sample-project/.lerret/ui-components/StatCard.jsx` becomes a
 * leaf under `FIXTURE_LERRET_ROOT`.
 *
 * @returns {{ tree: object }}
 */
function buildFixtureTree() {
 const PREFIX = '../fixtures/sample-project/.lerret/';
 /** @type {object} */
 const tree = {};
 for (const key of Object.keys(FIXTURE_GLOB)) {
 if (!key.startsWith(PREFIX)) continue;
 const rel = key.slice(PREFIX.length); // e.g. "ui-components/buttons/X.jsx"
 const segments = rel.split('/');
 let node = tree;
 for (let i = 0; i < segments.length; i++) {
 const seg = segments[i];
 const isLeaf = i === segments.length - 1;
 if (isLeaf) {
 node[seg] = '<file>'; // marker — file content is irrelevant to scan()
 } else {
 node[seg] = node[seg] || {};
 node = node[seg];
 }
 }
 }
 return { tree };
}

/**
 * Build a map from synthetic LerretPath → raw config.json content string,
 * derived from the `import.meta.glob` of `config.json` files in the fixture.
 *
 * The glob keys look like
 * `../fixtures/sample-project/.lerret/ui-components/config.json`
 * and map to the file's raw string content. We convert each key to the
 * synthetic LerretPath form so `makeFixtureFs().readFile(path)` can serve them.
 *
 * @returns {Map<string, string>}
 */
function buildConfigContentMap() {
 const PREFIX = '../fixtures/sample-project/.lerret/';
 /** @type {Map<string, string>} */
 const map = new Map();
 for (const [key, content] of Object.entries(FIXTURE_CONFIG_GLOB)) {
 if (!key.startsWith(PREFIX)) continue;
 const rel = key.slice(PREFIX.length); // e.g. "ui-components/config.json"
 const lerretPath = `${FIXTURE_LERRET_ROOT}/${rel}`;
 map.set(lerretPath, /** @type {string} */ (content));
 }
 return map;
}

/**
 * A minimal in-memory `FilesystemAccess` over the fixture tree — DEV-HARNESS
 * ONLY. Implements the two methods `scan()` actually calls (`readDir`,
 * `readFile`) plus stubs for the rest so it structurally satisfies the
 * contract. The real CLI uses `@lerret/cli`'s Node `fs` backend.
 *
 * `readFile` also serves the raw content of `config.json` files
 * so `computeCascadedConfig` can read them for the cascade computation. All
 * other files still return `''` (scan() does not read asset contents).
 *
 * @returns {import('@lerret/core').FilesystemAccess}
 */
function makeFixtureFs() {
 const { tree } = buildFixtureTree();
 const configContents = buildConfigContentMap();

 /** Resolve a `LerretPath` to its node in `tree`, or `undefined`. */
 function resolve(path) {
 const norm = path.replace(/\/+$/, '');
 if (norm === FIXTURE_LERRET_ROOT) return tree;
 if (!norm.startsWith(FIXTURE_LERRET_ROOT + '/')) return undefined;
 const rest = norm.slice(FIXTURE_LERRET_ROOT.length + 1);
 let node = tree;
 for (const seg of rest.split('/')) {
 if (node == null || typeof node !== 'object' || !(seg in node)) return undefined;
 node = node[seg];
 }
 return node;
 }

 return {
 async readDir(dirPath) {
 const node = resolve(dirPath);
 if (node == null || typeof node !== 'object') {
 throw new Error(`readDir: not a directory: ${dirPath}`);
 }
 const base = dirPath.replace(/\/+$/, '');
 return Object.keys(node).map((name) => {
 const child = node[name];
 const isDirectory = child != null && typeof child === 'object';
 return {
 name,
 path: `${base}/${name}`,
 kind: isDirectory ? 'directory' : 'file',
 isDirectory,
 isFile: !isDirectory,
 };
 });
 },
 async readFile(filePath) {
 // Serve config.json content so the cascade can be computed.
 // The configContents map is keyed by the same synthetic LerretPath
 // the fixture tree uses. All other files (assets, fonts, images) return
 // '' — scan() does not need their contents.
 const norm = filePath.replace(/\/+$/, '');
 if (configContents.has(norm)) {
 return configContents.get(norm);
 }
 const node = resolve(filePath);
 if (node == null || typeof node === 'object') {
 throw new Error(`readFile: not a file: ${filePath}`);
 }
 return ''; // scan() does not read non-config asset contents
 },
 async writeFile() {
 throw new Error('fixture fs is read-only');
 },
 watch() {
 return { close() {} };
 },
 capabilities: { canWrite: false, canWatch: false, canReveal: false },
 };
}

/**
 * Map a Vite HMR `path` (a server-relative URL like
 * `/@fixture-lerret/ui-components/StatCard.jsx` or a module-graph path the
 * harness's `import.meta.glob` produced) back to the matching fixture asset
 * path — the `LerretPath` the runtime knows.
 *
 * Returns `null` if the update path is not a fixture asset (e.g. a studio
 * source file the harness should ignore).
 *
 * @param {string} updatePath
 * @returns {string | null}
 */
function fixturePathFromHmrUpdate(updatePath) {
 if (typeof updatePath !== 'string') return null;
 // Vite serves the fixture under the alias `/@fixture-lerret` (see
 // `vite.config.js`), so an HMR update to a fixture file arrives with that
 // prefix. Translate back to the synthetic `FIXTURE_LERRET_ROOT` paths the
 // scan + runtime use.
 const ALIAS = FIXTURE_ASSET_BASE_URL;
 if (updatePath.startsWith(ALIAS + '/')) {
 return FIXTURE_LERRET_ROOT + '/' + updatePath.slice(ALIAS.length + 1);
 }
 // The `import.meta.glob` keys are file paths relative to this module — e.g.
 // `../fixtures/sample-project/.lerret/ui-components/StatCard.jsx`. Vite's
 // module-graph path for the same file may resolve to an absolute or
 // workspace-relative shape; match the trailing `.lerret/…` segment.
 const lerretIdx = updatePath.indexOf('/.lerret/');
 if (lerretIdx !== -1) {
 return FIXTURE_LERRET_ROOT + updatePath.slice(lerretIdx + '/.lerret'.length);
 }
 return null;
}

/**
 * The harness root: scans the fixture, builds the runtime, and hands the
 * `{ project, runtime }` pair to the real `<ProjectStudio>`.
 *
 * The CLI replaces the body of the effect below — the fixture scan + the
 * fixture `assetBaseUrl` — with the real `lerret dev` user-folder wiring. The
 * `<ProjectStudio>` render is unchanged: it is real studio code.
 */
export function DevHarness() {
 // `{ project, runtime, cascadeEntries }` once the fixture scan + runtime
 // creation + cascade computation resolve.
 const [loaded, setLoaded] = React.useState(null);
 const [fatal, setFatal] = React.useState(null);

 React.useEffect(() => {
 let cancelled = false;
 let runtime;
 (async () => {
 try {
 // ── DEV-HARNESS / FIXTURE WIRING — replaced by the CLI ─────────────
 // 1. REAL loader over the fixture FS → project model.
 const fixtureFs = makeFixtureFs();
 const project = await scan(fixtureFs, FIXTURE_LERRET_ROOT);
 // 2. Compute the cascade over the fixture FS. The fixture
 // FS now serves config.json content (see `makeFixtureFs`), so the
 // cascade can be computed in-browser using the same `readFile`
 // path that `@lerret/core`'s cascade.js uses.
 let cascadeEntries = [];
 try {
 const cascadeMap = await computeCascadedConfig(project, fixtureFs);
 cascadeEntries = Array.from(cascadeMap.entries());
 } catch (cascadeErr) {
 // A cascade failure is non-fatal: the studio still renders with
 // default backgrounds. Log so the developer can diagnose.
 console.error('[lerret/dev-harness] cascade computation failed:', cascadeErr);
 }
 // 3. REAL CLI-mode runtime. `assetBaseUrl` is the Vite alias the
 // fixture's `.lerret/` is served under (see vite.config.js). The
 // CLI passes the real `lerret dev` server URL here instead.
 runtime = createViteRuntime(project, { assetBaseUrl: FIXTURE_ASSET_BASE_URL });

 // 3. DEV-HARNESS HMR → notifyChange bridge (harness only; the CLI
 // swaps this for the real chokidar watcher → notifyChange).
 // Vite delivers per-module HMR events on `import.meta.hot`; we
 // pick out the fixture-asset updates and call `notifyChange` on
 // the runtime so the canvas re-loads those assets in place
 // (React Fast Refresh handles the component-tree update inside
 // the artboard; the runtime call re-evaluates `meta` and reports
 // the change to the canvas for the re-render cue).
 if (typeof import.meta !== 'undefined' && import.meta.hot) {
 const hot = import.meta.hot;
 const handleUpdate = (payload) => {
 // payload is { type, updates: Array<{ acceptedPath, path, ... }> }
 const updates = (payload && payload.updates) || [];
 const seen = new Set();
 for (const update of updates) {
 const candidate = update.acceptedPath || update.path;
 const mapped = fixturePathFromHmrUpdate(candidate);
 if (mapped && !seen.has(mapped)) {
 seen.add(mapped);
 runtime.notifyChange(mapped);
 }
 }
 };
 hot.on('vite:afterUpdate', handleUpdate);
 // Best-effort: also listen on beforeUpdate so the canvas can start
 // its re-evaluation as soon as Vite knows the new module exists.
 // afterUpdate is the canonical "modules have been re-evaluated"
 // signal; running notifyChange there is sufficient on its own.
 }
 // ── END FIXTURE WIRING ────────────────────────────────────────────
 if (!cancelled) setLoaded({ project, runtime, cascadeEntries });
 } catch (err) {
 // A *harness* failure (the scan itself) — distinct from a per-asset
 // error, which the runtime contains. Should not happen.
 if (!cancelled) setFatal(err);
 }
 })();
 return () => {
 cancelled = true;
 if (runtime) runtime.dispose();
 };
 }, []);

 if (fatal) {
 return (
 <div style={{ padding: 40, fontFamily: 'monospace', color: '#7f1d1d' }}>
 Dev-harness scan failed: {String(fatal && fatal.message)}
 </div>
 );
 }
 if (!loaded) {
 return (
 <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#6e6960' }}>
 Loading fixture project through the Vite runtime…
 </div>
 );
 }

 // Hand the model + runtime to the real studio. Everything from here down is
 // real studio code (page routing, dock, canvas) — NOT replaced by the CLI.
 // `assetBaseUrl` lets the studio resolve custom-font `src` URLs;
 // the CLI passes the real `lerret dev` server URL in its place.
 //
 // Wrap with `CascadedConfigProvider` so the canvas's sections
 // can read the effective config for each folder (e.g. bg color). The dev-
 // harness mirror of the `CliProjectSource` wrapping.
 return (
 <CascadedConfigProvider cascadeEntries={loaded.cascadeEntries}>
 <ProjectStudio
 project={loaded.project}
 runtime={loaded.runtime}
 assetBaseUrl={FIXTURE_ASSET_BASE_URL}
 />
 </CascadedConfigProvider>
 );
}
