// asset-data-registry.js — which co-located data file each asset actually has,
// as reported by the server.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The studio cannot stat the filesystem, so `fetchDataValue` used to discover
// an asset's data file empirically: import `<Name>.data.js`, and when that
// 404s fall through to `<Name>.data.json`. A `.data.js` is the rare form, so
// the common case was a guaranteed 404 on every artboard — repeated on every
// auto-refresh tick, which for a 1s-refresh asset means one 404 per second.
// Console noise for a file nobody expected to exist.
//
// The server does know. `@lerret/cli`'s plugin runs core's `loadAssetData`
// (which reads each asset's folder and applies the `.data.js`-over-
// `.data.json` precedence of FR22) and ships the answer in the virtual
// module as `assetDataEntries`, refreshing it on every `lerret:change`.
// `cli-project-source.jsx` registers it here.
//
// With the map registered, an asset with a data file costs exactly ONE
// request, and an asset without one costs NONE.
//
// Registry rather than React context because the consumer — `fetchDataValue`
// in `components/canvas/artboard-kebab.jsx` — is a plain async function called
// from deep in the tree, and already reads the hosted reader this same way
// (see `runtime/hosted-data-reader.js`).
//
// Unregistered (hosted mode, the standalone fixture harness, or an older CLI
// whose virtual module predates `assetDataEntries`) `getAssetDataPath` returns
// `undefined`, and the caller keeps its original probing behaviour. That
// fallback is what makes a studio bundle safe to serve from any CLI version.

/** @type {Map<string, string> | null} */
let assetDataMap = null;

/**
 * Register (or clear, with a non-array) the server's per-asset data-file map.
 *
 * @param {Array<[string, string]> | null} entries
 *   `Array<[assetPath, dataPath]>` from the virtual module or a `lerret:change`
 *   payload. Assets with no data file are absent from the list.
 * @returns {void}
 */
export function setAssetDataEntries(entries) {
  assetDataMap = Array.isArray(entries) ? new Map(entries) : null;
}

/**
 * The data-file path for `assetPath`.
 *
 * Three outcomes, and the caller must tell them apart:
 *   - a string  → this asset HAS that data file; fetch exactly it.
 *   - `null`    → the server answered, and this asset has NO data file;
 *                 fetch nothing.
 *   - `undefined` → no map is registered; the server has not answered, so the
 *                 caller should fall back to probing.
 *
 * @param {string} assetPath
 * @returns {string | null | undefined}
 */
export function getAssetDataPath(assetPath) {
  if (!assetDataMap) return undefined;
  return assetDataMap.get(assetPath) ?? null;
}
