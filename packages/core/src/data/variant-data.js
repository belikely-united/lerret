// data/variant-data.js — per-variant data keying for named exports (FR22,
// FR23).
//
// Given the `AssetData` record produced by `loadAssetData` and an array of
// export names produced by `resolveVariants`, this module decides which data
// value — if any — applies to each variant artboard.
//
// ── Resolution algorithm ─────────────────────────────────────────────────────
//
//  When `assetData.source === 'absent'`
//    → Every variant gets `{ source: 'absent' }`. Nothing to resolve.
//
//  When `assetData.value` is a non-null plain object AND at least one of its
//  keys matches a variant export name (case-sensitive):
//    → MODE: keyed.
//    Variants whose export name exists as a key in the data object get
//    `{ source: 'keyed', value: data[exportName] }`.
//    Variants without a matching key get `{ source: 'absent' }` — they fall
//    through to lower-precedence tiers (four-tier prop resolution wires these
//    up).
//    Any key in the data object that does NOT correspond to an export name is
//    a "stray key" — it is silently ignored and a `console.warn` records it.
//
//  When `assetData.value` is a non-null plain object AND none of its keys
//  match any variant export name:
//    → MODE: shared.
//    The entire value is applied as shared data to every variant:
//    `{ source: 'shared', value: assetData.value }`.
//    This preserves the single-artboard behaviour of the shared form.
//
//  Any other value shape (null, array, primitive, etc.) — treat as shared data
//  because there is nothing key-like to match against.
//
// ── Purity ───────────────────────────────────────────────────────────────────
//
// This function is PURE beyond the documented `console.warn` side-effect:
//   • No DOM APIs.
//   • No Node built-ins.
//   • No module loading.
//   • It is synchronous and deterministic for a given set of inputs.
//
// The function does not distinguish between `source === 'json'` and
// `source === 'js'` — in both cases the resolved `value` has already been
// placed into the `AssetData` record by the time this function is called. The
// studio's runtime data-loader is responsible for populating the JS module's
// value before invoking this function.

/* global console */
//
// `console` is a universal global available in every JS environment (Node,
// browser, Deno, etc.) and is used here only for `console.warn` on stray keys.
// The ESLint config sets `globals: {}` for core to prevent DOM / Node built-in
// leaks; this directive re-permits only `console`.

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/**
 * The resolved data for a single variant after per-variant keying.
 *
 * @typedef {object} VariantDataRecord
 * @property {'keyed' | 'shared' | 'absent'} source
 *   How this variant's data was resolved:
 *   - `'keyed'`  — the data object had an exact match for this variant's export
 *                  name; `value` is the sub-object under that key.
 *   - `'shared'` — the data object had no per-variant keys at all; `value` is
 *                  the whole data object, shared across every variant.
 *   - `'absent'` — no data is available for this variant at this tier (either
 *                  the asset data source was absent, or other variants got keyed
 *                  data but this one had no matching key).
 * @property {unknown} [value]
 *   The resolved data value. Present for `'keyed'` and `'shared'`; absent
 *   (`undefined`) for `'absent'`.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return `true` if `v` is a non-null plain object (not an array, not `null`).
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve per-variant data from an asset's `AssetData` record.
 *
 * Pure function (no DOM, no Node built-ins). The only observable side-effect
 * beyond the return value is `console.warn` emitted when a key in the data
 * object does not correspond to any variant export name ("stray key").
 *
 * @param {import('./loader.js').AssetData} assetData
 *   The resolved data record for the asset — the output of `loadAssetData` for
 *   this asset. For `source === 'js'`, `value` must have been populated by the
 *   studio-side runtime before this function is called.
 *
 * @param {string[]} variantExportNames
 *   The array of export names for the asset's variants — typically
 *   `resolveVariants(exports).map(v => v.exportName)`. Includes `'default'`
 *   when the asset has a default export.
 *
 * @param {{ assetPath?: string }} [options]
 *   Optional metadata forwarded to warning messages.
 *   - `assetPath` — the asset's path string, used to identify the asset in
 *     `console.warn` output. Omitting it produces a less informative warning.
 *
 * @returns {Map<string, VariantDataRecord>}
 *   A `Map` from variant `exportName` → `VariantDataRecord`. Every name in
 *   `variantExportNames` has an entry. Extra keys in the data object that do
 *   not match any export name are recorded via `console.warn` and ignored.
 */
export function resolveVariantData(assetData, variantExportNames, { assetPath } = {}) {
  /** @type {Map<string, VariantDataRecord>} */
  const result = new Map();

  const names = Array.isArray(variantExportNames) ? variantExportNames : [];

  // ── Case 1: no data available at all ──────────────────────────────────────
  if (!assetData || assetData.source === 'absent') {
    for (const name of names) {
      result.set(name, { source: 'absent' });
    }
    return result;
  }

  const dataValue = assetData.value;

  // ── Case 2: value is not a plain object — treat as shared ─────────────────
  //
  // null, arrays, primitives — nothing to match against; apply to all variants.
  if (!isPlainObject(dataValue)) {
    for (const name of names) {
      result.set(name, { source: 'shared', value: dataValue });
    }
    return result;
  }

  // `dataValue` is a non-null plain object from here on.

  const dataObject = /** @type {Record<string, unknown>} */ (dataValue);
  const exportNameSet = new Set(names);

  // Check whether at least one key in the data object matches an export name.
  const dataKeys = Object.keys(dataObject);
  const hasAnyKeyedMatch = dataKeys.some((k) => exportNameSet.has(k));

  if (!hasAnyKeyedMatch) {
    // ── Case 3: flat/shared object — no keys match any export name ───────────
    for (const name of names) {
      result.set(name, { source: 'shared', value: dataValue });
    }
    // No stray-key check in shared mode — none of the keys were "intended" to
    // be per-variant, so there is nothing stray about them.
    return result;
  }

  // ── Case 4: keyed mode — at least one key matches an export name ──────────

  // Warn about stray keys (keys in data that don't correspond to any export).
  for (const key of dataKeys) {
    if (!exportNameSet.has(key)) {
      const assetLabel = assetPath ? `"${assetPath}"` : '(unknown asset)';
      console.warn(
        `[lerret/data] Asset ${assetLabel}: data file key "${key}" does not ` +
          `match any export name — it will be ignored. ` +
          `Known exports: ${names.length ? names.map((n) => `"${n}"`).join(', ') : '(none)'}.`,
      );
    }
  }

  // Assign per-variant records.
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(dataObject, name)) {
      result.set(name, { source: 'keyed', value: dataObject[name] });
    } else {
      result.set(name, { source: 'absent' });
    }
  }

  return result;
}
