// variants.js — resolve an asset module's component-valued exports into the
// set of *variant artboards* it yields (FR10).
//
// One asset `.jsx` / `.tsx` file can declare more than one component: a default
// export plus any number of named exports. Each component-valued export is a
// *variant* — it gets its own artboard on the canvas. So a single file yields
// 1..N artboards, and the user controls that count purely by what they export.
//
// ── Why this lives in `core` and is PURE ───────────────────────────────────
// `core` is environment-agnostic shared logic — no DOM, no Node built-ins, no
// module loading. This function therefore does NOT `import()` anything: the
// studio's asset-runtime loads the module (through Vite, or the hosted
// transformer) and hands the already-evaluated exports object in. This function
// only inspects that plain object. The same resolution rule then holds for
// every deploy mode, and the Story-1.2 core-purity test stays green.
//
// ── What counts as a variant ───────────────────────────────────────────────
// A React component is a function or a class — at the value level both are
// `typeof === 'function'`. So a variant is any export whose value is a
// function. Non-function exports (the `meta` object, a re-exported constant, a
// number) are skipped here — `meta` is parsed separately by `meta.js`.
//
// The `default` export, when it is component-valued, is the **primary**
// variant: it is the artboard shown for the file when nothing selects a
// specific variant, and the source the loader treats as "the asset itself".

/**
 * The export name reserved for an asset's metadata object. It is never treated
 * as a variant even though a user could (wrongly) export a function under it.
 *
 * @type {'meta'}
 */
const META_EXPORT_NAME = 'meta';

/**
 * The export name of a module's default export, as it appears as a key on the
 * exports object produced by an ES-module `import()`.
 *
 * @type {'default'}
 */
const DEFAULT_EXPORT_NAME = 'default';

/**
 * A single resolved variant artboard — one component-valued export of an asset
 * module.
 *
 * @typedef {object} AssetVariant
 * @property {string} exportName
 *   The export this variant came from: `'default'` for the default export, or
 *   the named-export identifier (e.g. `'Dark'`, `'Compact'`) otherwise.
 * @property {string} variantName
 *   The human-facing variant name. For the default export this is `'default'`;
 *   for a named export it is the export identifier. Callers use it to derive a
 *   per-variant artboard id (`"<assetPath>#<variantName>"`) and as a label
 *   fallback when no `meta.label` is given.
 * @property {boolean} isPrimary
 *   `true` for exactly the default-export variant — the primary artboard for
 *   the file. `false` for every named-export variant. When a file has no
 *   default export, no variant is primary.
 * @property {Function} component
 *   The component value itself (a function or class). Guaranteed callable —
 *   non-function exports are not turned into variants.
 */

/**
 * Resolve an asset module's exports object into its ordered set of variant
 * artboards (FR10).
 *
 * Pure: it inspects the plain `{ default, ...named }` object the asset-runtime
 * hands in after loading the module — it loads nothing itself.
 *
 * Resolution rule:
 *   - Every export whose value is a function (a React component — function or
 *     class) becomes one {@link AssetVariant}.
 *   - The `default` export, when component-valued, is the **primary** variant
 *     and is placed first.
 *   - Named component exports follow, in the order the exports object
 *     enumerates them. The reserved `meta` export is always skipped (it is
 *     metadata, parsed by `meta.js`).
 *   - A module with no component-valued export yields an empty array — the
 *     caller surfaces that as a per-asset "no component to render" error.
 *
 * This function never throws for a malformed input: a `null`/`undefined` or
 * non-object `exports` simply yields an empty array.
 *
 * @param {Record<string, unknown> | null | undefined} exports
 *   The asset module's exports object — `{ default, ...named }`.
 * @returns {AssetVariant[]}
 *   The variant artboards, primary (default export) first; possibly empty.
 */
export function resolveVariants(exports) {
  if (exports == null || typeof exports !== 'object') {
    return [];
  }

  /** @type {AssetVariant[]} */
  const variants = [];

  // 1. The default export, if it is component-valued, is the primary variant
  //    and leads the list.
  const defaultExport = exports[DEFAULT_EXPORT_NAME];
  if (typeof defaultExport === 'function') {
    variants.push({
      exportName: DEFAULT_EXPORT_NAME,
      variantName: DEFAULT_EXPORT_NAME,
      isPrimary: true,
      component: defaultExport,
    });
  }

  // 2. Every other component-valued export becomes a (non-primary) variant, in
  //    enumeration order. `default` is already handled; `meta` is metadata.
  for (const exportName of Object.keys(exports)) {
    if (exportName === DEFAULT_EXPORT_NAME || exportName === META_EXPORT_NAME) {
      continue;
    }
    const value = exports[exportName];
    if (typeof value !== 'function') {
      continue;
    }
    variants.push({
      exportName,
      variantName: exportName,
      isPrimary: false,
      component: value,
    });
  }

  return variants;
}
