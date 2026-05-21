// sucrase-transform.js — per-file JSX/TSX → JS transform for the hosted runtime
//. In hosted mode there is no Vite dev server: assets are compiled
// entirely in the browser by Sucrase before the service-worker module graph
// serves them as ES modules.
//
// This file is the production transform — informed by the spike
// (`packages/studio/spike/hosted-runtime/FINDINGS.md`). It MUST NOT import
// anything from the spike directory; the spike is reference only.
//
// ── Transform options (validated by the spike) ────────────────────────────
// transforms: ['jsx', 'typescript'] — covers both .jsx and .tsx assets.
// jsxRuntime: 'automatic' — React 19's automatic JSX runtime.
// production: true — emits `react/jsx-runtime`, NOT
// `react/jsx-dev-runtime`. The shipped
// artifact loads the production JSX
// runtime (smaller, faster, no
// source-location instrumentation).
// disableESTransforms: true — keep `import` / `export` statements
// intact so the SW serves the file as
// a real ES module that participates
// in the browser's module graph.
//
// ── Content-hash transform cache (spike mitigation) ────────────────────────
// First transform after JIT warm-up is ~2–5 ms; cold-start hits 10–15 ms. To
// avoid re-paying that cost on the live-edit loop when the source has not
// actually changed (e.g. an editor saves with no text diff), every transform
// is keyed by the SHA-256 of its source. A repeated call with the same source
// returns the cached output without re-invoking Sucrase. The hash uses the
// Web Crypto API (`crypto.subtle.digest`) which is available in browsers and
// in modern Node test runners.
//
// ── Error handling ────────────────────────────────────────────────────────
// Sucrase throws on syntax errors. The thrown error carries a useful message
// pointing at the offending location. `transformJsx` re-throws it; the calling
// runtime (`sucrase-runtime.js`) catches and surfaces it as an `AssetError`
// with phase `'load'` (FR8 / NFR8). The cache is NEVER populated for a failed
// transform — the next attempt re-runs Sucrase so the user sees the same
// diagnostic again after fixing nothing else.

import { transform } from 'sucrase';

// ---------------------------------------------------------------------------
// Production transform options
// ---------------------------------------------------------------------------

/**
 * Sucrase transform options for the hosted runtime. These are the production
 * settings the spike's findings recommend — `production: true` so
 * Sucrase emits the production JSX runtime; `disableESTransforms: true` so the
 * service-worker module graph receives real ES modules.
 *
 * Exported (frozen) so tests can assert the exact options the runtime ships.
 *
 * @type {Readonly<import('sucrase').Options>}
 */
export const HOSTED_TRANSFORM_OPTIONS = Object.freeze({
 transforms: ['jsx', 'typescript'],
 jsxRuntime: 'automatic',
 production: true,
 disableESTransforms: true,
});

// ---------------------------------------------------------------------------
// Content-hash transform cache
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hex digest of `source` using the Web Crypto API. Returned
 * as a hex string of 64 chars — short enough to use as a Map key, long enough
 * to be collision-free for practical purposes.
 *
 * Falls back to a simple FNV-1a 32-bit hash when `crypto.subtle` is missing
 * (some pre-Chrome 89 contexts; not a real-world worry — the FSA API requires
 * Chrome 86+). The fallback's collision risk is negligible at the scale of a
 * single user's project (a few hundred asset files at most) but keeps the
 * module side-effect-free in the rare environment without Web Crypto.
 *
 * @param {string} source
 * @returns {Promise<string>}
 */
export async function hashSource(source) {
 if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
 const bytes = new TextEncoder().encode(source);
 const digest = await crypto.subtle.digest('SHA-256', bytes);
 const view = new Uint8Array(digest);
 let hex = '';
 for (let i = 0; i < view.length; i += 1) {
 hex += view[i].toString(16).padStart(2, '0');
 }
 return hex;
 }
 // Fallback: FNV-1a 32-bit, hex-encoded (8 chars). Documented as a fallback
 // only — the production path always uses SHA-256.
 let hash = 0x811c9dc5;
 for (let i = 0; i < source.length; i += 1) {
 hash ^= source.charCodeAt(i);
 hash = Math.imul(hash, 0x01000193) >>> 0;
 }
 return hash.toString(16).padStart(8, '0');
}

/**
 * Build a transform cache. Each cache instance is independent — the runtime
 * keeps one per session; tests can create their own to avoid cross-test
 * pollution.
 *
 * The cache stores `code` keyed by the source's SHA-256 hash. A bounded LRU is
 * NOT necessary in — a single user's project rarely exceeds 200
 * asset files, and each transform output is a few KB. If memory pressure ever
 * becomes a concern the cache can be capped by adding eviction on size.
 *
 * @returns {{
 * get: (hash: string) => string | undefined,
 * set: (hash: string, code: string) => void,
 * clear: () => void,
 * size: () => number,
 * }}
 */
export function createTransformCache() {
 /** @type {Map<string, string>} */
 const cache = new Map();
 return {
 get(hash) {
 return cache.get(hash);
 },
 set(hash, code) {
 cache.set(hash, code);
 },
 clear() {
 cache.clear();
 },
 size() {
 return cache.size;
 },
 };
}

// ---------------------------------------------------------------------------
// transformJsx — the production transform function
// ---------------------------------------------------------------------------

/**
 * Transform JSX/TSX source → plain ES-module JavaScript using the production
 * Sucrase options. Cache hits return immediately; misses run Sucrase and
 * populate the cache.
 *
 * On a Sucrase syntax error this re-throws; the calling runtime translates the
 * throw into a per-asset `AssetError` (phase `'load'`) so a single broken file
 * never blanks the canvas (NFR8).
 *
 * @param {string} source
 * Raw JSX or TSX source text.
 * @param {string} filePath
 * File path — used only in error messages (Sucrase doesn't take it).
 * @param {object} [options]
 * @param {ReturnType<typeof createTransformCache>} [options.cache]
 * Optional content-hash cache. When omitted the transform always runs.
 * @returns {Promise<{ code: string, hash: string, cached: boolean }>}
 * - `code`: the transformed JavaScript;
 * - `hash`: the content-hash key (caller can use it as a cache-bust token);
 * - `cached`: whether the result came from the cache.
 * @throws {Error}
 * If Sucrase fails (syntax error). The thrown error's `message` is preserved.
 */
export async function transformJsx(source, filePath, options = {}) {
 if (typeof source !== 'string') {
 throw new TypeError(`transformJsx: source must be a string (got ${typeof source}) for "${filePath}"`);
 }
 const cache = options.cache;
 const hash = await hashSource(source);

 if (cache) {
 const hit = cache.get(hash);
 if (hit !== undefined) {
 return { code: hit, hash, cached: true };
 }
 }

 const result = transform(source, HOSTED_TRANSFORM_OPTIONS);
 if (!result || typeof result.code !== 'string' || result.code.length === 0) {
 throw new Error(`sucrase-transform: empty output for "${filePath}"`);
 }

 if (cache) {
 cache.set(hash, result.code);
 }
 return { code: result.code, hash, cached: false };
}

// ---------------------------------------------------------------------------
// fileExtensionIsTransformable — quick predicate
// ---------------------------------------------------------------------------

/**
 * Test whether `filePath`'s extension is one this transform handles — `.jsx`
 * or `.tsx`. The runtime branches on this to decide whether to call
 * {@link transformJsx} or hand the file straight through as-is (e.g. a CSS
 * import or a `.js` file with no JSX).
 *
 * Bare `.js` is NOT transformed — modern asset files use `.jsx`/`.tsx`, and
 * a `.js` file with embedded JSX would be a user error. Bare `.ts` IS
 * transformed because TypeScript strip is cheap and a `.ts` file is just as
 * likely to ship in a user's project as a `.tsx` file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function fileExtensionIsTransformable(filePath) {
 if (typeof filePath !== 'string') return false;
 const lower = filePath.toLowerCase();
 return lower.endsWith('.jsx') || lower.endsWith('.tsx') || lower.endsWith('.ts');
}
