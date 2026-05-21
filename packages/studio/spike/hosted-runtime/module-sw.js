// SPIKE — throwaway prototype. Excluded from vite build.
// Superseded by the real hosted runtime. Do not import from production code.
//
// module-sw.js — service worker for the hosted-mode live-edit spike.
//
// DESIGN (validated by this spike):
//
// 1. The main thread reads a .jsx file from the FSA directory handle.
// 2. It posts the transformed JS source to this SW via `postMessage`.
// 3. When a dynamic `import('/spike-asset/<path>')` fires, this SW intercepts
// it and responds with the cached transformed source as a JS module.
// 4. On edit, the main thread sends a new transformed source and a new
// cache-bust URL. The main thread re-imports the new URL, forcing
// re-evaluation. The old Blob URL is revoked.
//
// BARE IMPORT RESOLUTION:
// `react` and `react/jsx-runtime` are rewritten in the transformed source
// by the main thread (see spike-canvas.js) to absolute /__lerret_react__/*
// URLs before the source is posted here. The SW intercepts those URLs and
// redirects them to the page's own React import (re-exported by the SW from
// a blob URL). This gives the asset the same React instance as the host page.
//
// WHY SERVICE WORKER (rather than blob URLs directly):
// A blob URL module cannot itself import() other blob URLs with relative paths.
// A SW that controls the scope intercepts ANY fetch, including dynamic import(),
// which lets us build a proper module graph with relative imports resolved from
// the directory handle. This spike validates that the SW interception of
// dynamic import() works in practice and is fast enough.
//
// SCOPE: registered at /spike/ — does not affect the studio's main scope.
//
// Note: service workers run in a special global scope where `clients`,
// `self`, and `skipWaiting` are defined by the SW spec (not the browser
// window). ESLint's `no-undef` doesn't know about SW globals, so we
// declare them here for the linter.

/* global clients */

// SCOPE constant is documentation-only (the actual scope is set at registration).
const _SCOPE = '/spike/hosted-runtime/';
const ASSET_PREFIX = '/spike-asset/';

// ---------------------------------------------------------------------------
// In-memory module cache
// Cache maps virtual URL → transformed JS source string.
// Keyed by the exact URL string the main thread sends (including cache-bust).
// ---------------------------------------------------------------------------

/** @type {Map<string, string>} */
const moduleCache = new Map();

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
 // Skip waiting so the new SW activates immediately (spike only — in
 // production the runtime should coordinate with open tabs).
 event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
 event.waitUntil(clients.claim());
});

// ---------------------------------------------------------------------------
// Message handler — receive transformed source from main thread
// ---------------------------------------------------------------------------

/**
 * Main thread sends:
 * { type: 'REGISTER_MODULE', url: string, code: string }
 * to pre-register a transformed module source before the import() call.
 *
 * Also handles INVALIDATE to clear a stale cache entry.
 */
self.addEventListener('message', (event) => {
 const { type, url, code } = event.data || {};
 if (type === 'REGISTER_MODULE' && typeof url === 'string' && typeof code === 'string') {
 moduleCache.set(url, code);
 } else if (type === 'INVALIDATE' && typeof url === 'string') {
 moduleCache.delete(url);
 }
});

// ---------------------------------------------------------------------------
// Fetch handler — intercept dynamic import() of spike-asset URLs
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
 const url = event.request.url;

 // Only intercept our spike-asset URLs
 if (url.includes(ASSET_PREFIX)) {
 event.respondWith(handleAssetFetch(url));
 return;
 }

 // Pass through everything else (studio's own assets, etc.)
 // No default fetch — SW should not intercept studio requests.
});

/**
 * Serve a pre-registered transformed JS module source as a fetch response.
 *
 * @param {string} url
 * @returns {Promise<Response>}
 */
async function handleAssetFetch(url) {
 const source = moduleCache.get(url);
 if (source) {
 return new Response(source, {
 status: 200,
 headers: {
 'Content-Type': 'text/javascript',
 // No caching — cache-busting is done via URL query params.
 'Cache-Control': 'no-store',
 },
 });
 }

 // Not found in cache — return 404 with diagnostic info.
 return new Response(
 `// [module-sw.js] No module registered for: ${url}\n` +
 `throw new Error('[spike SW] module not found: ${JSON.stringify(url)}');`,
 {
 status: 404,
 headers: { 'Content-Type': 'text/javascript' },
 },
 );
}
