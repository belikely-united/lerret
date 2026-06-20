// module-sw.js — the production service worker for hosted-mode asset modules.
//
// This SW participates in the hosted runtime as the module-graph layer:
// the main thread reads asset files via the FSA backend, transforms them with
// Sucrase (`sucrase-transform.js`), then pre-registers the transformed source
// with this SW via `postMessage`. When the main thread issues a dynamic
// `import()` for the module's virtual URL, this SW's `fetch` handler
// intercepts it and serves the cached source as `text/javascript`.
//
// ── Why a service worker ─────────────────────────────────────────────────
// A blob URL module cannot reliably resolve relative `import` specifiers
// against other blob URLs — the URL is opaque. A service worker, scoped over
// the studio's origin, intercepts ANY `fetch` (including dynamic `import`)
// inside that scope, so we can serve a coherent module graph where each
// asset's `./logo.png` or `../shared/Card.jsx` resolves to another SW-served
// URL. This was validated by the spike.
//
// ── Pre-register protocol (validated by the spike, refined for production) ──
// The main thread sends one of these messages:
//
// { type: 'PING', id }
// A handshake the main thread uses to confirm the SW is alive and
// responding. The SW replies with `{ type: 'PONG', id }` via the
// `event.source` MessagePort. Optional but useful for entry-screen
// diagnostics.
//
// { type: 'REGISTER_MODULE', url, code, contentType? }
// Pre-register a transformed asset module's source at `url`. The next
// dynamic `import(url)` will be served the cached `code`. `contentType`
// defaults to `'text/javascript'`; the runtime overrides it for non-JS
// resources (e.g. CSS sources served as `'text/css'`).
//
// { type: 'INVALIDATE', url }
// Drop a single cached URL — used when the runtime knows a URL was
// replaced by a new cache-busted one.
//
// { type: 'INVALIDATE_PREFIX', prefix }
// Drop every cached URL whose key starts with `prefix`. Used when the
// project is unmounted / re-mounted to clear stale entries en masse.
//
// { type: 'CLAIM' }
// Force this SW to claim all clients in scope immediately. The main
// thread sends this once after `register()` resolves, so the very first
// transformed module the page imports is intercepted (otherwise the
// uncontrolled-page race lets the first fetch bypass the SW).
//
// ── Module URL scheme ────────────────────────────────────────────────────
// Modules are served under `/__lerret/asset/<path>?h=<hash>`. The leading
// `/__lerret/` segment makes interception unambiguous and keeps SW concerns
// from colliding with the studio's own routes. The `?h=<hash>` cache-buster
// is added by the runtime (content-hash from `sucrase-transform.js`); a new
// transform produces a new URL so the browser re-fetches a fresh module
// instance (full remount on reload — see FINDINGS §4.3).
//
// ── Eviction ─────────────────────────────────────────────────────────────
// The spike noted that cached URLs accumulate forever — fine for a spike, not
// for a long-running session. This SW caps the in-memory map at MAX_MODULES.
// When full, the oldest registered entry is evicted (FIFO via Map iteration
// order — Map preserves insertion order in JS). A session with hundreds of
// edits stays at a bounded memory footprint.
//
// ── Globals ──────────────────────────────────────────────────────────────
// Service workers run in a special global scope where `self`, `clients`,
// `skipWaiting` are defined by the SW spec. ESLint's `no-undef` doesn't know
// about them. The block below declares them for the linter.

/* global clients */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * URL prefix the SW intercepts. Any fetch for a URL containing this prefix
 * is treated as a request for a registered asset module. The leading
 * `/__lerret/` segment is unlikely to collide with anything in the studio's
 * own routes (the studio is a single-page app under `/`).
 */
const ASSET_URL_PREFIX = '/__lerret/asset/';

/**
 * The broader prefix the SW intercepts so an asset's `<img src="…/logo.png">`
 * is served too. An `<img>` relative URL resolves against the asset's
 * `/__lerret/asset/…` module URL, so depending on its `../` depth it lands
 * under `/__lerret/asset/…` OR escapes to `/__lerret/…`; intercepting at
 * `/__lerret/` covers both (image lookup is by the path tail, so the depth does
 * not matter — see `imageKeyFromPath`).
 */
const LERRET_PREFIX = '/__lerret/';

/**
 * Maximum number of registered modules to keep in memory before FIFO
 * eviction kicks in. A realistic project has ≤200 assets × ≤a-handful of
 * cache-busted versions; 2000 is generous and bounds the memory footprint.
 */
const MAX_MODULES = 2000;

// ---------------------------------------------------------------------------
// In-memory module store
// ---------------------------------------------------------------------------

/**
 * @typedef {{ code: string, contentType: string, registeredAt: number }} ModuleEntry
 */

/** @type {Map<string, ModuleEntry>} */
const moduleStore = new Map();

/**
 * Binary asset (image) store, keyed by the file's project-relative path
 * (e.g. `_assets/logo.png`, `social/card-logo.png`) — NOT the full request URL,
 * so the lookup tolerates the `../` depth in the `<img src>` that produced it.
 *
 * @type {Map<string, { bytes: Uint8Array, contentType: string }>}
 */
const binaryStore = new Map();

/**
 * Insert `entry` for `url`, evicting the oldest entry if the store would
 * exceed {@link MAX_MODULES}.
 *
 * @param {string} url
 * @param {ModuleEntry} entry
 */
function storeModule(url, entry) {
 // If the URL is already present, delete-then-set so the entry moves to the
 // end (most-recent) of Map iteration order.
 if (moduleStore.has(url)) {
 moduleStore.delete(url);
 } else if (moduleStore.size >= MAX_MODULES) {
 // FIFO eviction: the first key in iteration order is the oldest.
 const oldestKey = moduleStore.keys().next().value;
 if (oldestKey !== undefined) {
 moduleStore.delete(oldestKey);
 }
 }
 moduleStore.set(url, entry);
}

// ---------------------------------------------------------------------------
// Lifecycle handlers
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
 // Skip waiting so the new SW activates immediately — the studio's hosted
 // entry layer is the only caller, and it expects this SW to
 // be live by the time it tries to register the first module.
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
 // Claim all clients in this scope so the very first fetch the page makes
 // after activation is intercepted — without `claim()`, the uncontrolled
 // page would bypass the SW on its first dynamic import.
 event.waitUntil(clients.claim());
});

// ---------------------------------------------------------------------------
// Message handler — pre-register protocol
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
 const data = event.data;
 if (!data || typeof data !== 'object') return;

 switch (data.type) {
 case 'PING': {
 // Reply to the sender with a PONG carrying the same id. Used by the
 // entry layer to confirm the SW is alive before mounting
 // the hosted runtime.
 if (event.source && typeof event.source.postMessage === 'function') {
 event.source.postMessage({ type: 'PONG', id: data.id });
 }
 break;
 }
 case 'REGISTER_MODULE': {
 if (typeof data.url !== 'string' || typeof data.code !== 'string') return;
 const contentType =
 typeof data.contentType === 'string' && data.contentType.length > 0
 ? data.contentType
 : 'text/javascript';
 storeModule(data.url, {
 code: data.code,
 contentType,
 registeredAt: Date.now(),
 });
 break;
 }
 case 'REGISTER_BINARY': {
 // A binary asset (image) keyed by its project-relative path. `bytes` is a
 // Uint8Array (structured-cloned across postMessage); served verbatim.
 if (typeof data.key !== 'string' || !data.bytes) return;
 binaryStore.set(data.key, {
 bytes: data.bytes,
 contentType:
 typeof data.contentType === 'string' && data.contentType.length > 0
 ? data.contentType
 : 'application/octet-stream',
 });
 break;
 }
 case 'INVALIDATE': {
 if (typeof data.url !== 'string') return;
 moduleStore.delete(data.url);
 break;
 }
 case 'INVALIDATE_PREFIX': {
 if (typeof data.prefix !== 'string' || data.prefix.length === 0) return;
 // Iterate the snapshot of keys (don't mutate during iteration).
 const toDelete = [];
 for (const key of moduleStore.keys()) {
 if (key.startsWith(data.prefix)) toDelete.push(key);
 }
 for (const key of toDelete) moduleStore.delete(key);
 // A prefix invalidation means the project is unmounting/remounting; its
 // images are stale too, so clear them wholesale (re-registered on remount).
 binaryStore.clear();
 break;
 }
 case 'CLAIM': {
 // Idempotent — the page may call this multiple times after a reload.
 // `clients.claim()` returns a Promise; we don't `event.waitUntil` here
 // because `message` events don't support it. The Promise is fire-and-
 // forget — the page will retry register-and-import if a race loses.
 try {
 clients.claim();
 } catch {
 // Older browsers may not allow `claim()` outside the activate handler;
 // the studio gracefully degrades to whatever interception the page
 // already had.
 }
 break;
 }
 default:
 // Unknown type — ignore. Future protocol evolution stays additive.
 break;
 }
});

// ---------------------------------------------------------------------------
// Fetch handler — intercept dynamic import() of asset URLs
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
 const url = event.request.url;
 // Cheap substring check first to avoid URL parsing for every studio fetch.
 if (url.indexOf(LERRET_PREFIX) === -1) return;

 // The pathname is the lookup key (origin / scheme are runtime-specific).
 let pathname;
 let pathAndQuery;
 try {
 const parsed = new URL(url);
 pathname = parsed.pathname;
 pathAndQuery = parsed.pathname + parsed.search;
 } catch {
 return;
 }
 if (pathname.indexOf(LERRET_PREFIX) !== 0) return;

 // A registered JS module is keyed by the FULL URL (incl. the `?h=` cache-bust).
 if (moduleStore.has(pathAndQuery)) {
 event.respondWith(serveModule(pathAndQuery));
 return;
 }
 // Otherwise, maybe a binary asset (image): look it up by its project-relative
 // tail so the `<img src>`'s `../` depth doesn't matter.
 const key = imageKeyFromPath(pathname);
 if (key && binaryStore.has(key)) {
 event.respondWith(serveBinary(key));
 return;
 }
 // Module miss — serve the JS stub so the import rejects cleanly.
 event.respondWith(serveModule(pathAndQuery));
});

/**
 * Reduce a `/__lerret/…` request pathname to a binary-store key: the path after
 * `/__lerret/asset/` or, when the `<img>`'s `../` escaped that base, after
 * `/__lerret/`. Both collapse to the same project-relative tail.
 *
 * @param {string} pathname
 * @returns {string | null}
 */
function imageKeyFromPath(pathname) {
 let rest;
 if (pathname.indexOf(ASSET_URL_PREFIX) === 0) {
 rest = pathname.slice(ASSET_URL_PREFIX.length);
 } else if (pathname.indexOf(LERRET_PREFIX) === 0) {
 rest = pathname.slice(LERRET_PREFIX.length);
 } else {
 return null;
 }
 if (!rest) return null;
 try {
 return decodeURIComponent(rest);
 } catch {
 return rest;
 }
}

/**
 * Serve a registered binary asset (image) by its project-relative key.
 *
 * @param {string} key
 * @returns {Promise<Response>}
 */
async function serveBinary(key) {
 const entry = binaryStore.get(key);
 if (!entry) {
 return new Response('', { status: 404, headers: { 'Cache-Control': 'no-store' } });
 }
 return new Response(entry.bytes, {
 status: 200,
 headers: {
 'Content-Type': entry.contentType,
 'Cache-Control': 'no-store',
 },
 });
}

/**
 * Serve a registered module by URL. A miss returns a JavaScript stub that
 * throws on evaluation — the dynamic `import()` then rejects with the same
 * stub message, which the runtime catches and surfaces as a per-asset error
 * (NFR8). The stub is JavaScript so the browser parses it as a module rather
 * than reporting a low-level network failure.
 *
 * @param {string} key The pathname-plus-search the runtime registered.
 * @returns {Promise<Response>}
 */
async function serveModule(key) {
 const entry = moduleStore.get(key);
 if (entry) {
 return new Response(entry.code, {
 status: 200,
 headers: {
 'Content-Type': entry.contentType,
 // The SW is the source of truth for cache-busting; never let the
 // HTTP cache hold a stale copy.
 'Cache-Control': 'no-store',
 },
 });
 }
 // Miss — emit a JS stub so the import rejects cleanly with a readable
 // message rather than a generic network error.
 const safeKey = JSON.stringify(key);
 const body =
 `// Lerret hosted runtime: no module registered at ${safeKey}.\n` +
 `throw new Error(${JSON.stringify(`Hosted runtime: no module registered at ${key}`)});`;
 return new Response(body, {
 status: 404,
 headers: {
 'Content-Type': 'text/javascript',
 'Cache-Control': 'no-store',
 },
 });
}

// ---------------------------------------------------------------------------
// Documented exports — for the build to detect the file is a valid module
// ---------------------------------------------------------------------------
//
// A service worker file is loaded by `navigator.serviceWorker.register(url)`,
// not by `import`, so this file is normally side-effect-only. Vite's
// production build, however, doesn't know to copy a side-effect-only
// `.js` file into the dist/ output unless it is referenced. The runtime's
// `sucrase-runtime.js` imports the URL of this file with Vite's `?worker&url`
// idiom (`import swUrl from './module-sw.js?worker&url'`), so the bundler
// emits it to a stable hashed URL. No re-export is needed here.
