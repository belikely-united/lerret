// vite-runtime.js — the CLI / self-host implementation of the asset-runtime
// interface (`asset-runtime.js`, AR4).
//
// In CLI mode `lerret dev` runs a Vite dev server pointed at the user's
// project folder. Vite is a real bundler: it natively transforms `.jsx`/`.tsx`,
// resolves relative imports (including `import logo from './logo.png'`), and
// serves each file as an ES module. So this runtime does not transform or
// resolve anything itself — it asks Vite for the asset's module with a dynamic
// `import()` and reads the module's **default export** as the asset's React
// component (FR8).
//
// Why dynamic `import()` and not a static import map: the asset set is only
// known at runtime, after the project model is scanned — there is no build-time
// list. A runtime `import(url)` is exactly the escape hatch for "load a module
// whose path I computed". Vite intercepts it, transforms the target file
// (TS/JSX → JS — so a `.tsx` asset needs zero TS config in the user's
// `.lerret/` folder), and resolves the file's own relative imports as further
// module requests.
//
// Markdown assets go through the SAME dynamic `import()`, but with
// Vite's `?raw` import suffix: `import(url + '?raw')` asks Vite to hand back
// the file's **raw text** as the module's default export instead of executing
// it. The runtime then wraps that text in a Markdown document-card entry — a
// `.md` file is rendered, never run.
//
// ── What is real runtime vs. what the CLI replaces ──────────────────────────
// REAL runtime (kept as-is by the CLI): everything in this file — the
// `loadAsset` / `subscribe` / `dispose` implementation, the per-asset error
// containment, the `LerretPath → module URL` mapping through a base URL.
//
// TEMPORARY (the CLI swaps it): only the *base URL* a caller passes in.
// The fixture path has no real `lerret dev` server over the user's folder, so
// the dev harness serves a fixture project via a Vite alias and passes that
// alias as the base URL. The CLI stands up the real server over the real user
// folder and passes its URL instead — this file does not change.
//
// Module-evaluation and render-time throws are contained per asset (the ACs):
// a `loadAsset` failure resolves to an `'error'` entry (never rejects), and the
// caller wraps each `Component` in `AssetErrorBoundary` for render throws. One
// broken asset can never crash the runtime or blank the canvas.

import { resolveVariants, parseMeta } from '@lerret/core';

import {
 makeVariantEntry,
 makeMarkdownEntry,
 makeErrorEntry,
 toAssetError,
} from './asset-runtime.js';

/**
 * @typedef {import('./asset-runtime.js').AssetRuntime} AssetRuntime
 * @typedef {import('./asset-runtime.js').AssetEntry} AssetEntry
 * @typedef {import('../../../core/src/loader/model.js').AssetNode} AssetNode
 * @typedef {import('../../../core/src/loader/model.js').ProjectNode} ProjectNode
 * @typedef {import('../../../core/src/fs/filesystem.js').LerretPath} LerretPath
 */

// ---------------------------------------------------------------------------
// Module-URL resolution
// ---------------------------------------------------------------------------

/**
 * Turn an asset's project-model {@link LerretPath} into the URL the Vite dev
 * server serves that file's module from.
 *
 * An asset's `path` is its full `.lerret/` path as the filesystem backend
 * reported it (forward-slash, possibly OS-absolute). What the dev server needs
 * is a URL it can map back onto a file it is configured to serve. Two cases:
 *
 * 1. `assetBaseUrl` is set — the asset's path is rebased onto it relative to
 * the project root (`.lerret/`). This is the dev-harness / fixture path
 * and the shape the CLI's real server will also use.
 * 2. No base URL — the asset path is used as-is (an absolute `/…` URL the
 * server is already configured, via `server.fs.allow`, to serve).
 *
 * A `?t=` cache-busting query is appended when `reloadToken` is set so a
 * re-load after an edit fetches a fresh module instance; omitted
 * on first load so the import is cacheable.
 *
 * @param {AssetNode} asset The asset to locate.
 * @param {ProjectNode} project The project model (its `path` is the
 * `.lerret/` root the asset path is relative to).
 * @param {string} [assetBaseUrl] Base URL the project's files are served
 * under (no trailing slash), or unset for an already-absolute asset path.
 * @param {string | number} [reloadToken] Cache-bust token; omit on first load.
 * @returns {string} A URL string suitable for a dynamic `import()`.
 */
export function assetModuleUrl(asset, project, assetBaseUrl, reloadToken) {
 let url;
 if (assetBaseUrl) {
 const root = (project && project.path) || '';
 // Strip the `.lerret/` root prefix so the remainder is project-relative,
 // then hang it off the base URL.
 let rel = asset.path;
 if (root && rel.startsWith(root)) {
 rel = rel.slice(root.length);
 }
 rel = rel.replace(/^\/+/, '');
 url = assetBaseUrl.replace(/\/+$/, '') + '/' + rel;
 } else {
 // No base URL: the asset path is itself the URL the server serves.
 url = asset.path;
 }
 if (reloadToken !== undefined && reloadToken !== null) {
 url += (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(String(reloadToken));
 }
 return url;
}

// ---------------------------------------------------------------------------
// Asset loading
// ---------------------------------------------------------------------------

/**
 * Dynamically import one asset module and resolve it to its `AssetEntry[]`.
 *
 * The import goes through the Vite dev server, which transforms the `.jsx` /
 * `.tsx` file and resolves its relative imports. Once the module is loaded the
 * runtime hands its exports to `core`'s pure resolvers:
 * - `resolveVariants` turns every component-valued export — the default
 * export plus any named exports — into a variant artboard, so ONE asset
 * file yields **1..N** entries (FR8 / FR10).
 * - `parseMeta` parses the module's `export const meta` into `dimensions`,
 * `label`, `tags`, and `propsSchema` (FR11); that parsed `meta` is shared
 * by every variant of the file and populates each entry.
 *
 * Failure modes are contained — this function never rejects:
 * - the dynamic `import()` rejects (missing file, an unresolved import
 * specifier, or a top-level throw in the asset's module code) → a
 * one-element `'error'` array;
 * - the module loads but exports no component at all (no default and no
 * component-valued named export) → a one-element `'error'` array.
 * A missing or malformed `meta` is NOT a failure (NFR8): `parseMeta` already
 * contains it and yields defaults, so the asset still renders.
 *
 * @param {AssetNode} asset The asset node to load.
 * @param {ProjectNode} project The project model.
 * @param {object} ctx
 * @param {string} [ctx.assetBaseUrl] Base URL the project is served under.
 * @param {(url: string) => Promise<any>} ctx.importModule
 * The dynamic-import function. Defaults to a real `import()`; injectable so
 * tests can drive `loadAsset` without a live Vite server.
 * @param {string | number} [ctx.reloadToken] Cache-bust token.
 * @returns {Promise<AssetEntry[]>}
 * Always resolves; one entry per variant on success (1..N), or a one-element
 * `'error'` array on failure.
 */
async function loadAssetModule(asset, project, ctx) {
 const url = assetModuleUrl(asset, project, ctx.assetBaseUrl, ctx.reloadToken);

 let mod;
 try {
 mod = await ctx.importModule(url);
 } catch (thrown) {
 // The dynamic import rejected. Vite reports both an unresolved import
 // specifier and a top-level throw in the asset's module code this way —
 // both are genuinely "the module did not evaluate", so `'evaluate'` is the
 // honest phase. (A flat-out missing file also lands here.)
 return [makeErrorEntry(asset, toAssetError(thrown, 'evaluate'))];
 }

 // Resolve the module's component-valued exports into variant artboards. The
 // default export, when present, is the primary variant; each component-
 // valued named export is its own variant (FR10).
 const variants = resolveVariants(mod);
 if (variants.length === 0) {
 // The module evaluated but exposes no renderable component — neither a
 // default export nor a component-valued named export. (A non-component
 // default, e.g. `export default {}`, is also caught here: it is not a
 // function, so `resolveVariants` does not count it.)
 return [
 makeErrorEntry(
 asset,
 toAssetError(
 new Error(
 `Asset "${asset.fileName}" exports no React component. A component ` +
 `asset must \`export default\` a component, or export one or more ` +
 `component-valued named exports as variants.`,
 ),
 'evaluate',
 ),
 ),
 ];
 }

 // Parse the asset's `meta` export once — it is shared by every variant of the
 // file. A missing or malformed `meta` is contained by `parseMeta` (NFR8): it
 // returns sensible defaults, so the asset still renders.
 const meta = parseMeta(mod && mod.meta);

 // One `AssetEntry` per variant — each carrying the parsed `meta` (dimensions,
 // label, tags). This is how one file becomes 1..N artboards.
 return variants.map((variant) => makeVariantEntry(asset, variant, meta));
}

/**
 * Load one markdown (`.md`) asset and resolve it to its `AssetEntry[]`.
 *
 * A `.md` file is a *document*, not a module — it must be rendered, not
 * executed. So the runtime fetches its **raw text** by appending Vite's
 * `?raw` query to the asset URL: `import(url + '?raw')` resolves to a module
 * whose default export is the file's contents as a string. That text becomes
 * a single {@link makeMarkdownEntry} document-card entry.
 *
 * Always one entry per `.md` file (markdown has no variants). An **empty**
 * `.md` is NOT a failure — it yields an `'ok'` entry whose card renders an
 * empty document. The only `'error'` path is the raw import
 * itself rejecting (a missing file), contained exactly like a component load.
 *
 * @param {AssetNode} asset The markdown asset node to load.
 * @param {ProjectNode} project The project model.
 * @param {object} ctx
 * @param {string} [ctx.assetBaseUrl] Base URL the project is served under.
 * @param {(url: string) => Promise<any>} ctx.importModule Dynamic-import fn.
 * @param {string | number} [ctx.reloadToken] Cache-bust token.
 * @returns {Promise<AssetEntry[]>} Always resolves; exactly one entry.
 */
async function loadMarkdownAsset(asset, project, ctx) {
 // Base URL first, then the `?raw` query so Vite serves the file's text.
 const base = assetModuleUrl(asset, project, ctx.assetBaseUrl, ctx.reloadToken);
 const url = base + (base.includes('?') ? '&raw' : '?raw');

 let mod;
 try {
 mod = await ctx.importModule(url);
 } catch (thrown) {
 // The raw import rejected — a genuinely missing `.md` file. Contained as a
 // per-asset error, never a runtime crash.
 return [makeErrorEntry(asset, toAssetError(thrown, 'load'))];
 }

 // A `?raw` import resolves to a module whose default export is the file's
 // text. Tolerate a bare string too, so an injected test importer can return
 // either shape. A missing/empty file → an empty document, not an error.
 const text =
 mod && typeof mod === 'object' && 'default' in mod
 ? mod.default
 : typeof mod === 'string'
 ? mod
 : '';
 return [makeMarkdownEntry(asset, typeof text === 'string' ? text : '')];
}

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------

/**
 * Create the CLI / self-host {@link AssetRuntime} for a project model.
 *
 * This is the {@link import('./asset-runtime.js').AssetRuntimeFactory} for
 * CLI mode. The studio is handed this factory, calls it once with the scanned
 * {@link ProjectNode}, and then talks only to the returned runtime — never
 * branching on deploy mode (AR4).
 *
 * @param {ProjectNode} project The scanned project model.
 * @param {object} [options]
 * @param {string} [options.assetBaseUrl]
 * Base URL the project's files are served under by the Vite dev server (no
 * trailing slash). In the CLI this is the real `lerret dev` server URL
 * over the user's folder; in the dev harness it is a Vite alias to the
 * fixture project. Omit if asset paths are already absolute server URLs.
 * @param {(url: string) => Promise<any>} [options.importModule]
 * Override the dynamic-import function — injected by tests to exercise the
 * runtime without a live server. Defaults to a real dynamic `import()`.
 * @returns {AssetRuntime}
 */
export function createViteRuntime(project, options = {}) {
 const assetBaseUrl = options.assetBaseUrl;
 // A real dynamic `import()`, wrapped so Vite cannot statically analyze the
 // specifier (the URL is computed at runtime — there is no module list to
 // pre-bundle). Tests pass their own `importModule` instead.
 const importModule =
 options.importModule || ((url) => import(/* @vite-ignore */ url));

 // Change-signal listeners. The runtime fans out a path to
 // every `subscribe`d listener whenever `notifyChange(path)` fires; the
 // studio canvas listens and re-loads the affected entries in place.
 /** @type {Set<(changedPath: LerretPath) => void>} */
 const listeners = new Set();

 // Per-asset cache-bust tokens. The first `loadAsset` for a
 // path is uncached (`undefined`); after a `notifyChange(path)`, the next
 // `loadAsset` for that path appends `?t=<counter>` so the dynamic import
 // bypasses Vite's module cache and re-evaluates the file. We use a single
 // monotonic counter shared across paths (rather than per-path) — a fresh
 // value per change is all the dynamic import needs to skip the cache.
 /** @type {Map<string, number>} */
 const reloadTokens = new Map();
 let reloadCounter = 0;

 let disposed = false;

 /**
 * The current cache-bust token for `assetPath`, or `undefined` if the
 * asset has never been notified (its first load should hit the cache).
 *
 * @param {string} assetPath
 * @returns {number | undefined}
 */
 function tokenFor(assetPath) {
 return reloadTokens.get(assetPath);
 }

 const runtime = {
 /**
 * @param {AssetNode} asset
 * @returns {Promise<AssetEntry[]>}
 */
 async loadAsset(asset) {
 if (disposed) {
 return [
 makeErrorEntry(
 asset,
 toAssetError(new Error('asset runtime has been disposed'), 'load'),
 ),
 ];
 }
 if (asset == null || typeof asset.path !== 'string') {
 return [
 makeErrorEntry(
 asset || { kind: 'asset', name: '?', fileName: '?', path: '?', assetKind: 'component', ext: '' },
 toAssetError(new Error('loadAsset: expected an AssetNode with a path'), 'load'),
 ),
 ];
 }
 const reloadToken = tokenFor(asset.path);
 // Branch on the asset's kind, not the deploy mode (AR4): a markdown
 // (`.md`) asset is read as raw text and rendered as a document card
 // ; a component (`.jsx`/`.tsx`) asset is imported as a
 // module and rendered as 1..N artboards.
 if (asset.assetKind === 'markdown') {
 return loadMarkdownAsset(asset, project, { assetBaseUrl, importModule, reloadToken });
 }
 return loadAssetModule(asset, project, { assetBaseUrl, importModule, reloadToken });
 },

 /**
 * @param {(changedPath: LerretPath) => void} listener
 * @returns {() => void}
 */
 subscribe(listener) {
 if (typeof listener === 'function') {
 listeners.add(listener);
 }
 return () => listeners.delete(listener);
 },

 /**
 * Signal that the file at `changedPath` has been written. Bumps that
 * path's cache-bust token so the *next* `loadAsset` for it returns a
 * fresh module instance, then fans out to every subscriber. Safe to
 * call with a path the runtime doesn't track — listeners simply ignore
 * paths they don't care about (the canvas re-load is a no-op for an
 * asset not on the current page).
 *
 * @param {LerretPath} changedPath
 */
 notifyChange(changedPath) {
 if (disposed) return;
 if (typeof changedPath !== 'string' || changedPath.length === 0) return;
 reloadCounter += 1;
 reloadTokens.set(changedPath, reloadCounter);
 // Fan out to every subscriber. A throwing listener must not block the
 // others — wrap each call so one broken consumer cannot break the
 // live-edit loop for the rest.
 for (const listener of listeners) {
 try {
 listener(changedPath);
 } catch (err) {
 // Diagnostic only — listeners are studio-internal and a throw here
 // would be a bug, but the runtime should not propagate it.
 console.error('[vite-runtime] subscribe listener threw:', err);
 }
 }
 },

 dispose() {
 disposed = true;
 listeners.clear();
 reloadTokens.clear();
 },
 };

 return runtime;
}

/**
 * The CLI / self-host runtime factory, named to match the
 * {@link import('./asset-runtime.js').AssetRuntimeFactory} role. An alias of
 * {@link createViteRuntime} — the app entry hands one of these to the studio.
 *
 * @type {import('./asset-runtime.js').AssetRuntimeFactory}
 */
export const viteRuntimeFactory = createViteRuntime;
