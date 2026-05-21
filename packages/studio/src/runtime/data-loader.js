// data-loader.js — studio-side data loading that extends core's co-located
// data file discovery with `.data.js` dynamic module loading via Vite.
//
// This module is the studio-side complement to
// `@lerret/core/src/data/loader.js`. Core discovers data files and reads
// `.data.json` statically; this module handles the runtime half:
//
// - For `source === 'json'` → passes `value` through unchanged (core
// already parsed it).
// - For `source === 'js'` → dynamically imports the `.data.js` module
// via Vite (`import(url)`) and reads its **default export** as the data
// object. A cache-busting token is accepted so live-reload re-evaluates
// the module after it changes.
// - For `source === 'absent'` → returns `undefined` (no data at this tier).
//
// Failure isolation: if a `.data.js` module throws on load (import rejects, or
// the module evaluates but has no usable default export), the failure is
// contained: `console.warn` records the file path + error and `undefined` is
// returned for that asset. The rest of the canvas keeps running.
//
// Orchestrator integration point:
// `resolveAssetData(assetData, options?)` is the entry point the orchestrator
// wires into the runtime. It accepts the `AssetData` record returned by
// `core`'s `loadAssetData` for a single asset plus an optional `importModule`
// override (for tests). It returns `Promise<{ value: unknown }>` so the caller
// always gets a consistent shape regardless of the source tier.
//
// For bulk resolution of a whole map (from `loadAssetData`), use
// `resolveAllAssetData(map, options?)` which returns a parallel
// `Map<LerretPath, unknown>` of resolved values.

/**
 * @typedef {import('../../../core/src/data/loader.js').AssetData} AssetData
 * @typedef {import('../../../core/src/fs/filesystem.js').LerretPath} LerretPath
 */

// ---------------------------------------------------------------------------
// Default dynamic importer — swapped to a fake in tests.
// ---------------------------------------------------------------------------

/**
 * The real dynamic import. Wrapped with `@vite-ignore` so Vite does not
 * pre-bundle it (the URL is computed at runtime).
 *
 * @param {string} url
 * @returns {Promise<unknown>}
 */
const defaultImportModule = (url) => import(/* @vite-ignore */ url);

// ---------------------------------------------------------------------------
// Single-asset resolution
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link resolveAssetData} and {@link resolveAllAssetData}.
 *
 * @typedef {object} ResolveOptions
 * @property {(url: string) => Promise<unknown>} [importModule]
 * Override the dynamic-import function. Defaults to a real `import()`.
 * Inject a fake in tests to exercise the loader without a live Vite server.
 * @property {string | number} [reloadToken]
 * Cache-busting token appended to `.data.js` module URLs as `?t=<token>`.
 * Omit on first load (no query appended); pass a fresh value after a file
 * change so Vite re-evaluates the module instead of returning the cached one.
 */

/**
 * Resolve one `AssetData` record to its concrete value.
 *
 * The orchestrator calls this after `loadAssetData` (core) has produced the
 * `AssetData` map. For `'json'` records the value is already in memory; for
 * `'js'` records this function performs the dynamic import. For `'absent'`
 * records it returns `{ value: undefined }` immediately.
 *
 * This function **never rejects** — all failure modes are contained as
 * warnings; the returned object always has a `value` key (which may be
 * `undefined` on absence or failure).
 *
 * @param {AssetData} assetData
 * The `AssetData` record from `loadAssetData` for a single asset.
 * @param {ResolveOptions} [options]
 * Optional overrides — `importModule` for test injection, `reloadToken` for
 * live-edit cache-busting.
 * @returns {Promise<{ value: unknown }>}
 * Resolves with `{ value }` — the loaded data object, or `undefined` when
 * no data is available or loading failed.
 */
export async function resolveAssetData(assetData, options = {}) {
 const importModule = options.importModule || defaultImportModule;
 const reloadToken = options.reloadToken;

 if (!assetData || assetData.source === 'absent') {
 return { value: undefined };
 }

 if (assetData.source === 'json') {
 // Core already parsed the JSON — pass it through unchanged.
 return { value: assetData.value };
 }

 if (assetData.source === 'js') {
 const path = assetData.dataPath;
 if (!path) {
 console.warn('[lerret/data-loader] .data.js record is missing dataPath — treating as absent.');
 return { value: undefined };
 }

 // Build the module URL, appending a cache-bust token if provided.
 let url = path;
 if (reloadToken !== undefined && reloadToken !== null) {
 const sep = url.includes('?') ? '&' : '?';
 url = `${url}${sep}t=${encodeURIComponent(String(reloadToken))}`;
 }

 let mod;
 try {
 mod = await importModule(url);
 } catch (err) {
 console.warn(
 `[lerret/data-loader] Failed to import data module "${path}": ` +
 `${err instanceof Error ? err.message : String(err)}. Asset data will be treated as absent.`,
 );
 return { value: undefined };
 }

 // The module's default export is the data object. A module that exports
 // only named exports without a default is not a failure — treat it as
 // the whole module namespace for flexibility.
 if (mod !== null && typeof mod === 'object' && 'default' in mod) {
 return { value: mod.default };
 }

 // If there is no `default` export but the module is an object, return the
 // module namespace itself so named-export data shapes still work.
 if (mod !== null && typeof mod === 'object') {
 return { value: mod };
 }

 // A module that is neither an object nor has a default export is treated
 // as absent (unlikely from a `.data.js` but handled defensively).
 console.warn(
 `[lerret/data-loader] Data module "${path}" has no default export and is ` +
 `not an object. Asset data will be treated as absent.`,
 );
 return { value: undefined };
 }

 // Unknown source discriminant — defensive fallback.
 return { value: undefined };
}

// ---------------------------------------------------------------------------
// Bulk resolution
// ---------------------------------------------------------------------------

/**
 * Resolve an entire `Map<LerretPath, AssetData>` (as returned by
 * `loadAssetData`) into a `Map<LerretPath, unknown>` of concrete values.
 *
 * Runs all resolutions in parallel via `Promise.all`. Each asset's resolution
 * is independent — a failure for one asset does not affect the others.
 *
 * @param {Map<LerretPath, AssetData>} assetDataMap
 * The map returned by `core`'s `loadAssetData`.
 * @param {ResolveOptions} [options]
 * Optional overrides shared across all resolutions.
 * @returns {Promise<Map<LerretPath, unknown>>}
 * A `Map` from asset `path` → resolved data value (may be `undefined` for
 * absent or failed assets).
 */
export async function resolveAllAssetData(assetDataMap, options = {}) {
 /** @type {Map<LerretPath, unknown>} */
 const result = new Map();

 if (!(assetDataMap instanceof Map)) {
 return result;
 }

 await Promise.all(
 Array.from(assetDataMap.entries()).map(async ([path, assetData]) => {
 const { value } = await resolveAssetData(assetData, options);
 result.set(path, value);
 }),
 );

 return result;
}
