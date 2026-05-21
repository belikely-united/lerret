// sucrase-runtime.js — the hosted-mode implementation of the asset-runtime
// interface (`asset-runtime.js`, AR4).
//
// In hosted mode the studio runs in a Chromium browser tab with no Vite server
// behind it: the user picks their project folder via `window.showDirectoryPicker`
// ('s `fsa-backend.js`), and from that point on every asset file is
// read through the FSA, transformed with Sucrase (`sucrase-transform.js`),
// pre-registered with the service worker (`module-sw.js`), and dynamic-imported
// through the SW's intercepted URL. This file is the orchestrator of that
// pipeline.
//
// ── Same shape as the Vite runtime ────────────────────────────────────────
// The exported runtime returns the same `AssetEntry[]` shape `vite-runtime.js`
// returns — same id, same `assetKind`, same `Component`, same `meta` /
// `dimensions` / `tags`. The studio canvas (Epics 1–4) doesn't branch on the
// deploy mode (AR4): it sees a runtime, calls `loadAsset(asset)`, and renders
// whatever entries it gets back.
//
// Reuses the same resolution chain from `@lerret/core`:
// - `resolveVariants(mod)` → one `AssetEntry` per component-valued export.
// - `parseMeta(mod.meta)` → parsed `meta` shared across variants.
// And the same record constructors from `asset-runtime.js`:
// - `makeVariantEntry`, `makeMarkdownEntry`, `makeErrorEntry`, `toAssetError`.
//
// ── Per-asset error containment (NFR8) ────────────────────────────────────
// Three failure phases, each contained as an `AssetError` carried by a
// one-element `'error'` `AssetEntry`:
// - 'load' — the FSA `readFile` rejected (missing file, permission
// lapsed) OR the Sucrase transform threw (syntax error).
// - 'evaluate' — the dynamic `import()` of the SW URL rejected (module
// top-level threw, or no module was registered).
// - 'render' — caught later by `AssetErrorBoundary` at the artboard
// level. The runtime is not involved in render-time
// containment.
//
// ── Service-worker registration failure ───────────────────────────────────
// If the browser blocks the SW (private mode, an enterprise policy, an older
// browser), the runtime cannot serve modules — but it must NOT silently fail
// or blank the canvas. The factory's setup is async; if SW registration
// rejects, the factory exposes that failure as `runtime.swError` so the entry
// layer can show a guided error screen rather than mounting a
// dead canvas. The studio's `cli-project-source.jsx` already has the
// equivalent "no project" placeholder pattern; the hosted source layer
// branches on `swError` the same way.
//
// ── notifyChange reload mechanism ─────────────────────────────────────────
// The contract is the same: `notifyChange(path)` bumps the asset's
// reload token, every subscriber is informed, and the next `loadAsset(asset)`
// uses a fresh content-hash URL so the SW serves a new module — React unmounts
// and re-mounts the component (full remount, per the spike findings).
//
// In hosted mode the token is the SHA-256 content hash from
// `sucrase-transform.js`, NOT a monotonic counter: an idempotent re-write
// produces the same hash, so a no-diff save is a no-op without the runtime
// having to compare bytes itself.

import { resolveVariants, parseMeta } from '@lerret/core';

import {
 makeVariantEntry,
 makeMarkdownEntry,
 makeErrorEntry,
 toAssetError,
} from './asset-runtime.js';
import {
 transformJsx,
 createTransformCache,
 fileExtensionIsTransformable,
 hashSource,
} from './sucrase-transform.js';

/**
 * @typedef {import('./asset-runtime.js').AssetRuntime} AssetRuntime
 * @typedef {import('./asset-runtime.js').AssetEntry} AssetEntry
 * @typedef {import('../../../core/src/loader/model.js').AssetNode} AssetNode
 * @typedef {import('../../../core/src/loader/model.js').ProjectNode} ProjectNode
 * @typedef {import('../../../core/src/fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('@lerret/core').FilesystemAccess} FilesystemAccess
 */

// ---------------------------------------------------------------------------
// SW URL scheme — must match `module-sw.js`
// ---------------------------------------------------------------------------

/**
 * URL prefix the service worker intercepts. Kept identical to the
 * `ASSET_URL_PREFIX` constant in `module-sw.js` — when one changes, both
 * must change together.
 */
export const HOSTED_ASSET_URL_PREFIX = '/__lerret/asset/';

/**
 * Build the SW-served URL for an asset's transformed module. The path
 * embeds the asset's project-relative location (so relative imports inside
 * the asset resolve sensibly against it), and the query carries the content
 * hash so a new transform produces a new URL.
 *
 * Example:
 * asset path: `/proj/.lerret/home/Hero.jsx`
 * project path: `/proj/.lerret`
 * hash: `abc123…`
 * → `/__lerret/asset/home/Hero.jsx?h=abc123…`
 *
 * @param {AssetNode} asset The asset to locate.
 * @param {ProjectNode} project The project model (its `path` is the root).
 * @param {string} hash The content hash of the asset's source.
 * @returns {string} The URL to register with and import from.
 */
export function hostedAssetModuleUrl(asset, project, hash) {
 const root = (project && project.path) || '';
 let rel = asset.path;
 if (root && rel.startsWith(root)) {
 rel = rel.slice(root.length);
 }
 rel = rel.replace(/^\/+/, '');
 const base = HOSTED_ASSET_URL_PREFIX + rel;
 if (hash) {
 return base + '?h=' + encodeURIComponent(hash);
 }
 return base;
}

// ---------------------------------------------------------------------------
// Import-map management — bare specifiers → bundled-React URLs
// ---------------------------------------------------------------------------

/**
 * The id of the placeholder `<script type="importmap">` in the studio's
 * `index.html`. The hosted entry layer calls
 * {@link setReactImportMap} to populate it with the URLs of the studio's
 * own React copy BEFORE any asset module is dynamically imported — so
 * Sucrase-output `import "react/jsx-runtime"` lines resolve to the same
 * React instance as the studio's own.
 *
 * @type {string}
 */
export const LERRET_IMPORT_MAP_ID = 'lerret-import-map';

/**
 * Populate the studio's import map with the URLs the hosted runtime should
 * use for `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and
 * `react-dom`. Call this exactly once — BEFORE the first dynamic asset
 * import — so the browser parses the import map before resolving any bare
 * specifier in a SW-served module (Chrome 89+ propagates page import maps
 * into SW-served module fetches).
 *
 * Replacing the inner HTML of an already-parsed import map element is a
 * no-op in modern Chromium — but the placeholder element in the studio's
 * `index.html` is empty (`{"imports": {}}`), so calling this once at boot
 * succeeds. If the page has already started using import maps (a violation
 * of the contract) the call is a no-op and the existing map sticks.
 *
 * @param {object} urls
 * @param {string} urls.react URL of the studio's `react` module.
 * @param {string} urls.jsxRuntime URL of `react/jsx-runtime`.
 * @param {string} [urls.jsxDevRuntime] URL of `react/jsx-dev-runtime`
 * (optional — only needed if dev builds use the dev JSX runtime).
 * @param {string} [urls.reactDom] URL of `react-dom`.
 * @param {string} [urls.reactDomClient] URL of `react-dom/client`.
 * @returns {boolean} Whether the import map element was found and updated.
 */
export function setReactImportMap(urls) {
 if (typeof document === 'undefined') return false;
 const el = document.getElementById(LERRET_IMPORT_MAP_ID);
 if (!el) return false;
 /** @type {Record<string, string>} */
 const imports = {};
 if (urls.react) imports.react = urls.react;
 if (urls.jsxRuntime) imports['react/jsx-runtime'] = urls.jsxRuntime;
 if (urls.jsxDevRuntime) imports['react/jsx-dev-runtime'] = urls.jsxDevRuntime;
 if (urls.reactDom) imports['react-dom'] = urls.reactDom;
 if (urls.reactDomClient) imports['react-dom/client'] = urls.reactDomClient;
 el.textContent = JSON.stringify({ imports });
 return true;
}

// ---------------------------------------------------------------------------
// Service-worker registration + messaging
// ---------------------------------------------------------------------------

/**
 * The shape the runtime expects from the studio's service-worker bridge — a
 * thin wrapper over `navigator.serviceWorker` so tests can mock it. The
 * production factory (`createHostedRuntime`) builds a real one out of
 * `navigator.serviceWorker`; tests pass their own.
 *
 * @typedef {object} ServiceWorkerBridge
 * @property {(message: object) => void} postMessage
 * Send a message to the active SW.
 * @property {() => Promise<void>} ready
 * Resolve when the SW has activated and is controlling the page.
 */

/**
 * Build a {@link ServiceWorkerBridge} backed by the real
 * `navigator.serviceWorker`. The caller must have already invoked
 * `navigator.serviceWorker.register(...)` and awaited
 * `navigator.serviceWorker.ready`.
 *
 * @returns {ServiceWorkerBridge}
 */
export function createNavigatorServiceWorkerBridge() {
 return {
 postMessage(message) {
 if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
 // No SW available — drop silently. The next import will hit the SW
 // miss path and surface a 404 stub message as an asset error.
 return;
 }
 const controller = navigator.serviceWorker.controller;
 if (controller) {
 controller.postMessage(message);
 }
 },
 async ready() {
 if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
 throw new Error('Service workers are not supported in this environment.');
 }
 await navigator.serviceWorker.ready;
 },
 };
}

/**
 * The URL of the service worker (`module-sw.js`) that the self-host build
 * emits at the root of the deployment.
 *
 * ── Why not `new URL('./module-sw.js', import.meta.url)` ────────────────────
 * The previous approach used Vite's asset-URL idiom, which emitted the SW into
 * `assets/` with a content-hash filename (e.g. `assets/module-sw-D8Y6cifA.js`).
 * Two problems:
 * 1. `assets/` is deeper than the page — a SW there can only control the
 * `assets/` scope, NOT the studio page itself. SW registration from
 * `index.html` at `/lerret/` to `/lerret/assets/module-sw-XXX.js` would
 * fail (the SW script is outside the page's scope).
 * 2. The hashed name is non-deterministic at build time — callers cannot
 * hardcode it, and the registration call must know the URL before the
 * SW can intercept any dynamic import.
 *
 * 's `lerretSelfHostPlugin` (vite.config.js) copies `module-sw.js`
 * to the ROOT of the build output as a stable, unhashed file alongside
 * `index.html`. The SW URL is therefore always:
 *
 * <base-url>module-sw.js
 *
 * where `<base-url>` is `import.meta.env.BASE_URL` — Vite replaces this
 * constant at build time with the configured `base` (default `./`). In dev it
 * is `/`, so the SW is at `/src/runtime/module-sw.js` via the dev-server alias;
 * in the production build with `base: './'` it becomes `./module-sw.js`.
 *
 * When registered from `index.html` at e.g. `https://host/lerret/`, the URL
 * resolves to `https://host/lerret/module-sw.js` and the scope is
 * `https://host/lerret/` — exactly the directory the studio page occupies,
 * so the SW can intercept `/__lerret/asset/…` fetches from that page.
 *
 * In dev, `import.meta.env.BASE_URL` is `/` (Vite default), which gives
 * `/module-sw.js` — served by the Vite dev server as a static file from
 * `src/runtime/module-sw.js` via the `publicDir` or the dev-server's
 * module resolution (the dev flow uses the unbuilt source directly, not the
 * SW registration path).
 *
 * Tests pass an explicit `swUrl` to {@link registerHostedServiceWorker}, so
 * the fallback value here is purely diagnostic.
 *
 * @type {string}
 */
export const HOSTED_SERVICE_WORKER_URL = (() => {
 try {
 // `import.meta.env.BASE_URL` is replaced at build time by Vite.
 // In dev it is '/', in the self-host build it is './' (from vite.config.js
 // `base: './'`). Concatenating 'module-sw.js' gives a URL that resolves
 // to the top-level module-sw.js relative to the current page, regardless
 // of whether the build is hosted at a domain root or a sub-path.
 const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
 return base + 'module-sw.js';
 } catch {
 // Fallback for unusual test envs where import.meta.env is unavailable.
 return '/module-sw.js';
 }
})();

/**
 * Register the hosted runtime's service worker and wait for it to be
 * controlling the page. Returns a bridge ready for `postMessage`s.
 *
 * Throws on registration failure so the caller (the entry layer / )
 * can surface a guided error rather than mounting a dead canvas. Three failure
 * modes share one error class:
 * - The browser lacks Service Worker support entirely.
 * - Registration was refused (private mode, enterprise policy, file://).
 * - The SW activated but never claimed the page within a timeout.
 *
 * @param {object} [options]
 * @param {string} [options.swUrl]
 * URL of the SW script — defaults to {@link HOSTED_SERVICE_WORKER_URL}, the
 * build-emitted asset URL of `module-sw.js`. Tests pass an explicit URL.
 * @param {string} [options.scope]
 * SW scope. Defaults to `'./'` — relative to the SW script's location,
 * which the self-host build places at the root of the deployment alongside
 * `index.html`. Using `'./'` (rather than `'/'`) makes the scope relative
 * so the SW covers the same directory as the page, regardless of whether
 * the build is hosted at a domain root or a sub-path (e.g. `/lerret/`).
 * Passing an absolute scope such as `'/'` would restrict the SW to the
 * domain root even when the studio is mounted at a sub-path.
 * @returns {Promise<ServiceWorkerBridge>}
 * @throws {ServiceWorkerRegistrationError}
 */
export async function registerHostedServiceWorker(options = {}) {
 const swUrl = options.swUrl || HOSTED_SERVICE_WORKER_URL;
 // Default scope: './' (the same directory as the SW script / index.html).
 // Explicit callers can override — e.g. tests pass '/'.
 const scope = options.scope !== undefined ? options.scope : './';
 if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
 throw new ServiceWorkerRegistrationError(
 'This browser does not support service workers, which the hosted Lerret studio requires to run.',
 );
 }
 try {
 await navigator.serviceWorker.register(swUrl, { scope, type: 'module' });
 // Tell the SW to claim immediately. The first activate handler's
 // `clients.claim()` covers most cases, but the explicit message handles
 // a rare race where the page started a fetch before activation.
 if (navigator.serviceWorker.controller) {
 navigator.serviceWorker.controller.postMessage({ type: 'CLAIM' });
 }
 await navigator.serviceWorker.ready;
 return createNavigatorServiceWorkerBridge();
 } catch (err) {
 const message =
 err && err.message
 ? `Could not register the hosted runtime's service worker: ${err.message}`
 : 'Could not register the hosted runtime\'s service worker.';
 throw new ServiceWorkerRegistrationError(message, { cause: err });
 }
}

/**
 * Typed error raised when the hosted-mode service worker cannot be
 * registered. The entry layer branches on this class to show a
 * guided error screen instead of letting an unhandled rejection bubble.
 *
 * Mirrors `PermissionDeniedError` from `fsa-backend.js` — the same "typed
 * error → guided UX" pattern established.
 */
export class ServiceWorkerRegistrationError extends Error {
 /**
 * @param {string} message
 * @param {{ cause?: unknown }} [options]
 */
 constructor(message, options) {
 super(message);
 this.name = 'ServiceWorkerRegistrationError';
 if (options && 'cause' in options) {
 // Carry the underlying error for diagnostic logging without exposing
 // it as part of the user-facing message.
 this.cause = options.cause;
 }
 }
}

// ---------------------------------------------------------------------------
// Internal: read + transform + register one asset module
// ---------------------------------------------------------------------------

/**
 * Read the source of an asset (or any module path) from the FSA, transform
 * it with Sucrase, register it with the SW, and return the URL to import.
 *
 * @param {string} lerretPath
 * The full LerretPath of the file (forward-slash, project-rooted as the
 * loader reported it).
 * @param {object} ctx
 * @param {FilesystemAccess} ctx.fs Underlying FSA-backed filesystem.
 * @param {ProjectNode} ctx.project For URL derivation.
 * @param {ServiceWorkerBridge} ctx.sw Bridge to `navigator.serviceWorker`.
 * @param {ReturnType<typeof createTransformCache>} ctx.cache
 * @returns {Promise<{ url: string, hash: string }>}
 */
async function transformAndRegister(lerretPath, ctx) {
 const source = await ctx.fs.readFile(lerretPath);
 if (typeof source !== 'string') {
 throw new Error(`hosted runtime: expected utf-8 text for "${lerretPath}"`);
 }
 let transformed;
 if (fileExtensionIsTransformable(lerretPath)) {
 transformed = await transformJsx(source, lerretPath, { cache: ctx.cache });
 } else {
 // Pass through as-is — already JS / CSS / JSON. Still compute a hash so
 // the SW URL carries a cache-bust segment.
 const hash = await hashSource(source);
 transformed = { code: source, hash, cached: false };
 }
 // Build the SW URL using a synthetic AssetNode-ish locator: only `path` is
 // used by `hostedAssetModuleUrl`. We construct a minimal one here so the
 // helper stays focused.
 const url = hostedAssetModuleUrl({ path: lerretPath }, ctx.project, transformed.hash);
 ctx.sw.postMessage({ type: 'REGISTER_MODULE', url, code: transformed.code });
 return { url, hash: transformed.hash };
}

// ---------------------------------------------------------------------------
// loadAssetModule — the component asset loader
// ---------------------------------------------------------------------------

/**
 * Load one `.jsx`/`.tsx` asset and resolve it to its `AssetEntry[]`.
 *
 * Failure modes (each contained — this function never rejects):
 * - FSA read fails → `'load'` error (missing file / permission denied).
 * - Sucrase throws → `'load'` error (syntax error in the source).
 * - Dynamic import rejects → `'evaluate'` error (top-level throw).
 * - Module has no component export → `'evaluate'` error (no default,
 * no component-valued named export).
 *
 * @param {AssetNode} asset
 * @param {ProjectNode} project
 * @param {object} ctx
 * @param {FilesystemAccess} ctx.fs
 * @param {ServiceWorkerBridge} ctx.sw
 * @param {ReturnType<typeof createTransformCache>} ctx.cache
 * @param {(url: string) => Promise<any>} ctx.importModule
 * @returns {Promise<AssetEntry[]>}
 */
async function loadAssetModule(asset, project, ctx) {
 let url;
 try {
 const reg = await transformAndRegister(asset.path, {
 fs: ctx.fs,
 project,
 sw: ctx.sw,
 cache: ctx.cache,
 });
 url = reg.url;
 } catch (thrown) {
 // Read or transform failed. Both are "could not even attempt to evaluate
 // the module" — phase 'load'.
 return [makeErrorEntry(asset, toAssetError(thrown, 'load'))];
 }

 let mod;
 try {
 mod = await ctx.importModule(url);
 } catch (thrown) {
 return [makeErrorEntry(asset, toAssetError(thrown, 'evaluate'))];
 }

 const variants = resolveVariants(mod);
 if (variants.length === 0) {
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

 const meta = parseMeta(mod && mod.meta);
 return variants.map((variant) => makeVariantEntry(asset, variant, meta));
}

// ---------------------------------------------------------------------------
// loadMarkdownAsset — the markdown asset loader
// ---------------------------------------------------------------------------

/**
 * Load one `.md` asset and resolve it to its `AssetEntry[]`.
 * The FSA backend reads the file's raw text; we wrap it in a markdown entry.
 * No transform, no SW round-trip — markdown is read as text and rendered as
 * a document card.
 *
 * @param {AssetNode} asset
 * @param {ProjectNode} _project Unused — kept for signature parity.
 * @param {object} ctx
 * @param {FilesystemAccess} ctx.fs
 * @returns {Promise<AssetEntry[]>}
 */
async function loadMarkdownAsset(asset, _project, ctx) {
 let text;
 try {
 text = await ctx.fs.readFile(asset.path);
 } catch (thrown) {
 return [makeErrorEntry(asset, toAssetError(thrown, 'load'))];
 }
 return [makeMarkdownEntry(asset, typeof text === 'string' ? text : '')];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the hosted-mode {@link AssetRuntime} for a project model.
 *
 * The studio is handed this factory in hosted mode (wires it),
 * calls it once with the scanned {@link ProjectNode} + the FSA backend, and
 * then talks only to the returned runtime — never branching on deploy mode
 * (AR4).
 *
 * The runtime is asynchronous to construct only in its SW dependency: the
 * factory itself is synchronous, but the SW must already be registered and
 * ready before `loadAsset` is called. The studio's entry layer
 * awaits {@link registerHostedServiceWorker} before invoking this factory.
 *
 * @param {ProjectNode} project The scanned project model.
 * @param {object} options
 * @param {FilesystemAccess} options.fs
 * The FSA-backed filesystem. The runtime reads every asset
 * source through it — never via `fetch`, never via `import()` direct from
 * the disk URL.
 * @param {ServiceWorkerBridge} options.sw
 * The service-worker bridge — produced by {@link registerHostedServiceWorker}
 * in production, mocked by tests.
 * @param {(url: string) => Promise<any>} [options.importModule]
 * Override the dynamic-import function — injected by tests. Defaults to a
 * real dynamic `import()`.
 * @returns {AssetRuntime}
 */
export function createHostedRuntime(project, options) {
 if (!options || typeof options !== 'object') {
 throw new TypeError('createHostedRuntime: options.fs and options.sw are required');
 }
 const { fs, sw } = options;
 if (!fs || typeof fs.readFile !== 'function') {
 throw new TypeError('createHostedRuntime: options.fs must be a FilesystemAccess');
 }
 if (!sw || typeof sw.postMessage !== 'function') {
 throw new TypeError('createHostedRuntime: options.sw must be a ServiceWorkerBridge');
 }

 const importModule =
 options.importModule || ((url) => import(/* @vite-ignore */ url));

 // Per-runtime transform cache. A fresh content hash is computed on every
 // read; a repeated read of an unchanged file returns the cached transform
 // without re-running Sucrase (spike mitigation: cold-JIT cost).
 const cache = createTransformCache();

 // contract: change-signal subscribers. The hosted runtime does
 // NOT need a per-asset cache-bust counter the way `vite-runtime.js` does —
 // the SW URL itself embeds the source's content hash, so an unchanged file
 // produces the same URL (no re-evaluation needed) and an edited file
 // produces a new URL (browser fetches a fresh module).
 /** @type {Set<(changedPath: LerretPath) => void>} */
 const listeners = new Set();

 let disposed = false;

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

 // Branch on asset kind, NOT deploy mode (AR4). Same pattern as
 // `vite-runtime.js` — markdown is text + a card, components are
 // modules + variants.
 if (asset.assetKind === 'markdown') {
 return loadMarkdownAsset(asset, project, { fs });
 }
 return loadAssetModule(asset, project, { fs, sw, cache, importModule });
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
 * Signal that the file at `changedPath` has been written. In hosted mode
 * the SW serves the URL identified by content hash, so an unchanged file
 * produces the same URL (idempotent: the browser's module cache returns
 * the same instance). A real edit produces a new hash, a new URL, and
 * the browser fetches a fresh module. Either way the runtime invalidates
 * its transform-cache mapping for the file (so the new hash is recomputed
 * on next read) and fans the path to subscribers.
 *
 * @param {LerretPath} changedPath
 */
 notifyChange(changedPath) {
 if (disposed) return;
 if (typeof changedPath !== 'string' || changedPath.length === 0) return;
 // Drop any in-memory transform cache entry for this path's previous
 // content. We don't know the old source's hash here, but clearing the
 // cache entirely on every change is unnecessary — the new transform
 // simply produces (or hits) a fresh entry by its new hash. The cache
 // grows unbounded only if hundreds of distinct sources cycle through
 // a single file, which is implausible in interactive editing.
 // (The Map prunes when the source goes; nothing to do here.)
 for (const listener of listeners) {
 try {
 listener(changedPath);
 } catch (err) {
 console.error('[hosted-runtime] subscribe listener threw:', err);
 }
 }
 },

 dispose() {
 disposed = true;
 listeners.clear();
 cache.clear();
 // Best-effort: tell the SW to drop every cached module under this
 // runtime's prefix so a re-mounted project doesn't serve stale code.
 try {
 sw.postMessage({ type: 'INVALIDATE_PREFIX', prefix: HOSTED_ASSET_URL_PREFIX });
 } catch {
 // SW already gone — nothing to clean up.
 }
 },
 };

 return runtime;
}

/**
 * The hosted-mode runtime factory, named to match the
 * {@link import('./asset-runtime.js').AssetRuntimeFactory} role. An alias of
 * {@link createHostedRuntime} — the studio's hosted entry layer
 * hands one of these to the studio.
 *
 * @type {import('./asset-runtime.js').AssetRuntimeFactory}
 */
export const hostedRuntimeFactory = createHostedRuntime;

// The canvas imports `AssetErrorBoundary` directly from `asset-runtime.js`;
// this module is the runtime backend only — the canvas wraps the entries it
// receives (whatever runtime they came from) in that shared boundary.
