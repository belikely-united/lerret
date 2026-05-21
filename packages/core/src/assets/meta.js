// meta.js — parse an asset module's `export const meta` into the canonical
// asset-metadata shape (FR11).
//
// An asset file may declare metadata about itself:
//
//   export const meta = {
//     dimensions: { width: 320, height: 200 },
//     label: 'Primary button',
//     tags: ['button', 'cta'],
//     propsSchema: { label: { type: 'string', default: 'Click me' } },
//   };
//
// The runtime reads that object to size the artboard, label it, carry tags,
// and validate props. This function is the single parser for it.
//
// ── Why this lives in `core` and is PURE ───────────────────────────────────
// Like `variants.js`, this is environment-agnostic: the asset-runtime loads the
// module and passes the already-evaluated `meta` value in. This function only
// inspects that plain value — no DOM, no Node built-ins, no module loading — so
// the same parsing holds for every deploy mode and core purity is preserved.
//
// ── Well-known keys are read by EXACT camelCase name (the contract) ─────────
// The architecture fixes the data-format naming: `meta`'s well-known keys are
// spelled exactly as the PRD defines — `dimensions`, `label`, `tags`,
// `propsSchema` — and are NOT reinterpreted (no snake_case alias, no `size` for
// `dimensions`, etc.). This module reads precisely those four keys.
//
// ── Missing / partial / malformed `meta` is never fatal (NFR8) ──────────────
// A missing `meta`, or a `meta` with some fields absent, is normal — it falls
// back to sensible defaults. A *malformed* `meta` (not an object, or a getter
// that throws when read) must not break the asset, and must not affect any
// other asset: this parser catches the failure, returns defaults, and reports
// it as a per-asset `error` field the caller can surface. `propsSchema` is
// merely read and carried here; validating props against it lives elsewhere.

/**
 * Artboard dimensions parsed from `meta.dimensions`.
 *
 * @typedef {object} AssetDimensions
 * @property {number | undefined} width
 *   Artboard width in CSS pixels, when `meta.dimensions.width` is a positive
 *   finite number; otherwise `undefined` (the canvas uses its default width).
 * @property {number | undefined} height
 *   Artboard height in CSS pixels, when `meta.dimensions.height` is a positive
 *   finite number; otherwise `undefined` (the canvas uses its default height).
 */

/**
 * The canonical parsed shape of an asset's `meta` export. Every field is always
 * present so callers never branch on `undefined` at the top level — absent or
 * invalid source fields are normalized to the documented defaults.
 *
 * @typedef {object} AssetMeta
 * @property {AssetDimensions} dimensions
 *   Parsed `meta.dimensions`. `{ width: undefined, height: undefined }` when
 *   `meta.dimensions` is absent or not an object — the canvas then falls back
 *   to its default artboard size.
 * @property {string | undefined} label
 *   Parsed `meta.label` — a non-empty string, trimmed. `undefined` when absent
 *   or not a usable string; the caller then falls back to a name derived from
 *   the file / export.
 * @property {string[]} tags
 *   Parsed `meta.tags` — string entries only, trimmed, empties dropped. `[]`
 *   when `meta.tags` is absent or not an array.
 * @property {Record<string, unknown> | undefined} propsSchema
 *   Parsed `meta.propsSchema` — carried through verbatim when it is an object.
 *   `undefined` when absent or not an object. Read and exposed here only;
 *   validating props against it lives in the props validator.
 * @property {boolean} hasMeta
 *   `true` iff the module actually exported a usable `meta` object. `false`
 *   for a missing `meta` AND for a malformed one — distinguishes "user wrote
 *   metadata" from "defaults".
 * @property {string | null} error
 *   A human-readable message when `meta` was present but malformed (not an
 *   object, or reading it threw); `null` otherwise. The caller may surface this
 *   per-asset without it affecting any other asset.
 */

/**
 * The default {@link AssetMeta} — the result for an asset with no `meta`
 * export. A fresh object is built per call so callers can never mutate shared
 * state.
 *
 * @returns {AssetMeta}
 */
function defaultMeta() {
  return {
    dimensions: { width: undefined, height: undefined },
    label: undefined,
    tags: [],
    propsSchema: undefined,
    hasMeta: false,
    error: null,
  };
}

/**
 * Coerce a candidate dimension value to a positive, finite pixel number, or
 * `undefined` when it is not usable (negative, zero, `NaN`, a string, …).
 *
 * @param {unknown} value
 * @returns {number | undefined}
 */
function toDimension(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

/**
 * Parse the `dimensions` field of a `meta` object into {@link AssetDimensions}.
 * A missing or non-object `dimensions`, or individually invalid width/height
 * values, fall back to `undefined` per axis — never an error (NFR8).
 *
 * @param {unknown} dimensions  The raw `meta.dimensions` value.
 * @returns {AssetDimensions}
 */
function parseDimensions(dimensions) {
  if (dimensions == null || typeof dimensions !== 'object') {
    return { width: undefined, height: undefined };
  }
  return {
    width: toDimension(/** @type {Record<string, unknown>} */ (dimensions).width),
    height: toDimension(/** @type {Record<string, unknown>} */ (dimensions).height),
  };
}

/**
 * Parse the `label` field of a `meta` object. A usable label is a non-empty
 * string (trimmed); anything else yields `undefined` so the caller applies its
 * file/export-derived fallback.
 *
 * @param {unknown} label  The raw `meta.label` value.
 * @returns {string | undefined}
 */
function parseLabel(label) {
  if (typeof label === 'string') {
    const trimmed = label.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Parse the `tags` field of a `meta` object into a clean string array. A
 * non-array yields `[]`; within an array, only non-empty string entries are
 * kept (trimmed) — non-string entries are dropped rather than erroring.
 *
 * @param {unknown} tags  The raw `meta.tags` value.
 * @returns {string[]}
 */
function parseTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }
  /** @type {string[]} */
  const clean = [];
  for (const tag of tags) {
    if (typeof tag === 'string') {
      const trimmed = tag.trim();
      if (trimmed.length > 0) {
        clean.push(trimmed);
      }
    }
  }
  return clean;
}

/**
 * Parse the `propsSchema` field of a `meta` object. It is carried through
 * verbatim when it is a (non-array) object; anything else yields `undefined`.
 * No validation of its internal shape happens here — `propsSchema`-driven
 * prop validation lives in the props validator; this parser only reads and
 * exposes the field.
 *
 * @param {unknown} propsSchema  The raw `meta.propsSchema` value.
 * @returns {Record<string, unknown> | undefined}
 */
function parsePropsSchema(propsSchema) {
  if (propsSchema != null && typeof propsSchema === 'object' && !Array.isArray(propsSchema)) {
    return /** @type {Record<string, unknown>} */ (propsSchema);
  }
  return undefined;
}

/**
 * Parse an asset module's `meta` export into the canonical {@link AssetMeta}
 * shape (FR11).
 *
 * Pure: it inspects the plain value the asset-runtime hands in after loading
 * the module — it loads nothing itself.
 *
 * Behaviour:
 *   - `meta` absent (`undefined`/`null`) → the documented defaults, `hasMeta:
 *     false`, `error: null`. A missing `meta` is never an error (NFR8).
 *   - `meta` is a plain object → its `dimensions`, `label`, `tags`,
 *     `propsSchema` keys are read by those EXACT names; any individually
 *     missing/invalid field falls back to its default. `hasMeta: true`.
 *   - `meta` is malformed — not an object, or reading a field throws (a getter
 *     that throws, a hostile proxy) → the defaults are returned with `hasMeta:
 *     false` and a non-null `error` string. The failure is contained to this
 *     one asset; it never propagates to break sibling assets.
 *
 * This function itself never throws.
 *
 * @param {unknown} meta  The asset module's raw `meta` export value.
 * @returns {AssetMeta}
 */
export function parseMeta(meta) {
  // No `meta` export at all — the common case. Plain defaults, not an error.
  if (meta === undefined || meta === null) {
    return defaultMeta();
  }

  // A `meta` that is present but not an object is malformed: the user exported
  // something under `meta`, but it cannot be metadata. Defaults + an error.
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    const result = defaultMeta();
    result.error = `\`meta\` export must be an object; got ${
      Array.isArray(meta) ? 'an array' : typeof meta
    }.`;
    return result;
  }

  // A well-formed object — read each well-known key by its exact name. Reading
  // a field can still throw (a getter that throws, an exotic proxy); contain
  // that so one bad asset cannot break others.
  try {
    const source = /** @type {Record<string, unknown>} */ (meta);
    return {
      dimensions: parseDimensions(source.dimensions),
      label: parseLabel(source.label),
      tags: parseTags(source.tags),
      propsSchema: parsePropsSchema(source.propsSchema),
      hasMeta: true,
      error: null,
    };
  } catch (thrown) {
    const result = defaultMeta();
    result.error = `failed to read \`meta\` export: ${
      thrown instanceof Error ? thrown.message : String(thrown)
    }`;
    return result;
  }
}
