// config/resolve-props.js — Four-tier prop resolution for a single artboard
// variant (FR24).
//
// Every artboard's final props come from exactly ONE place: this function.
// The studio and CLI both call it; neither assembles props ad hoc (the
// canonical-shape rule). Because this function is the single source of truth,
// the props validator can rely on its output shape and on the `propsSchema`
// default-extraction convention documented below.
//
// ── Four tiers (highest precedence first) ────────────────────────────────────
//
//  Tier 1 — DATA  (`data` argument)
//    The resolved data value for this variant, already narrowed by
//    `resolveVariantData`:
//      • When the variant had `source: 'keyed'`  → pass `variantRecord.value`
//        (the sub-object under the matching export key).
//      • When the variant had `source: 'shared'` → pass `variantRecord.value`
//        (the whole shared data object).
//      • When the variant had `source: 'absent'` → pass `undefined` or `null`.
//    If `data` is not a non-null plain object (null, array, primitive, or
//    `undefined`) it contributes NOTHING to prop resolution — the tier is
//    silently skipped, not an error. This lets callers pass the raw
//    `VariantDataRecord.value` without pre-checking its shape.
//
//  Tier 2 — VARS  (`vars` argument)
//    The effective `vars` block from the cascaded config for the asset's
//    folder: `cascadedConfig.get(folderPath).vars`. Pass `undefined` or omit
//    when the folder has no `vars` block. Non-plain-object values are treated
//    as empty (skipped).
//
//  Tier 3 — SCHEMA DEFAULT  (`propsSchema` argument)
//    The `propsSchema` object from `parseMeta(module.meta).propsSchema`. Pass
//    `undefined` or omit when the asset has no `meta`.
//
//    ── propsSchema default-extraction convention ──────────────────────────────
//    `propsSchema` is a plain object whose keys are prop names and whose values
//    are prop-descriptor objects. A prop-descriptor carries an optional
//    `default` property; this is the tier-3 value for that prop:
//
//      propsSchema = {
//        title:    { type: 'string',  default: 'Untitled' },
//        count:    { type: 'number',  default: 0          },
//        visible:  { type: 'boolean', default: true       },
//        color:    { type: 'string'   },  // ← no default; tier 3 silent for 'color'
//      }
//
//    ONLY the `default` key inside each prop-descriptor is read here; `type`
//    and any other descriptor keys are ignored by this function (they are
//    consumed by the props validator, which relies on this same convention).
//    A prop-descriptor that lacks `default` (or whose entry is not a plain
//    object at all) contributes nothing at tier 3 for that prop — the prop
//    simply falls through to tier 4 (component default).
//
//    The validator should use `'default' in descriptor` (hasOwnProperty) to
//    distinguish "explicitly set to undefined" from "no default declared".
//
//  Tier 4 — COMPONENT DEFAULT  (not a parameter; the function's non-action)
//    When a prop is not supplied by any of tiers 1–3, it is OMITTED from the
//    returned object entirely. React then applies the component's own default
//    parameter (`function Foo({ title = 'Untitled' }) { … }`). The resolver
//    never invents a value.
//
// ── Per-prop independence ─────────────────────────────────────────────────────
//
// Each prop is resolved independently: it takes its value from the FIRST (i.e.
// highest-precedence) tier that supplies it. A single call may return some
// props from data, others from vars, others from schema defaults — all mixed.
//
// ── Purity ───────────────────────────────────────────────────────────────────
//
// This function is PURE:
//   • No DOM APIs.
//   • No Node built-ins.
//   • No module loading.
//   • No side-effects beyond the return value (no console output).
//   • Synchronous and deterministic for a given set of inputs.

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return `true` if `v` is a non-null plain object (not an array, not `null`).
 *
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the final props for a single variant artboard by merging all four
 * tiers in fixed precedence (FR24). The function is PURE — see module header.
 *
 * **Precedence (highest first):**
 *  1. `data` — the variant's resolved data value (from `resolveVariantData`).
 *  2. `vars` — the folder's effective cascaded config `vars` block.
 *  3. `propsSchema` defaults — the `default` inside each prop-descriptor.
 *  4. Component default — not a parameter; the prop is simply omitted so
 *     React's own default parameter (`function Foo({ x = … }) {}`) applies.
 *
 * **Per-prop independence:** each prop independently takes its value from the
 * highest tier that supplies it. A single result may include props from
 * different tiers simultaneously.
 *
 * **Non-object tier values:** `data` and `vars` that are not non-null plain
 * objects (e.g. `null`, an array, a primitive, `undefined`) are treated as
 * empty — the tier is skipped for all props, no error is thrown.
 *
 * **All tiers absent/empty:** returns `{}` — the component renders on its own
 * defaults, no error (NFR8).
 *
 * @param {object} params
 *
 * @param {unknown} [params.data]
 *   The resolved data tier value for this variant. Pass the `value` field from
 *   the `VariantDataRecord` returned by `resolveVariantData`:
 *   - `'keyed'`  source → pass `record.value` (the per-variant sub-object).
 *   - `'shared'` source → pass `record.value` (the shared object).
 *   - `'absent'` source → pass `undefined` (or omit).
 *   Non-plain-object values (null, array, primitive) are treated as empty.
 *
 * @param {unknown} [params.vars]
 *   The effective `vars` object from the cascaded config for this asset's
 *   folder: `cascadedConfig.get(folderPath)?.vars`. Pass `undefined` when the
 *   folder has no `vars` block. Non-plain-object values are treated as empty.
 *
 * @param {unknown} [params.propsSchema]
 *   The `propsSchema` object from `parseMeta(module.meta).propsSchema`. Each
 *   key is a prop name; each value is a prop-descriptor object. Only the
 *   `default` key inside each descriptor is read here (see module header for
 *   the full convention). Pass `undefined` when the asset has no `meta`.
 *
 * @returns {Record<string, unknown>}
 *   A plain object of resolved props. Props absent from all three tiers are
 *   omitted so the component's own default parameter (tier 4) applies.
 *   Never throws. Always returns a plain object (possibly `{}`).
 */
export function resolveProps({ data, vars, propsSchema } = {}) {
  /** @type {Record<string, unknown>} */
  const result = {};

  // Coerce each tier to a plain object or null (null ≡ "tier contributes nothing").
  const dataTier = isPlainObject(data) ? /** @type {Record<string, unknown>} */ (data) : null;
  const varsTier = isPlainObject(vars) ? /** @type {Record<string, unknown>} */ (vars) : null;
  const schemaTier = isPlainObject(propsSchema)
    ? /** @type {Record<string, unknown>} */ (propsSchema)
    : null;

  // Collect the union of all prop names that any tier supplies.
  // A prop not mentioned by any tier is never added to `result`.
  const propNames = new Set([
    ...(dataTier ? Object.keys(dataTier) : []),
    ...(varsTier ? Object.keys(varsTier) : []),
    ...(schemaTier ? Object.keys(schemaTier) : []),
  ]);

  for (const prop of propNames) {
    // Tier 1: data
    if (dataTier !== null && Object.prototype.hasOwnProperty.call(dataTier, prop)) {
      result[prop] = dataTier[prop];
      continue;
    }

    // Tier 2: vars
    if (varsTier !== null && Object.prototype.hasOwnProperty.call(varsTier, prop)) {
      result[prop] = varsTier[prop];
      continue;
    }

    // Tier 3: propsSchema default
    if (schemaTier !== null && Object.prototype.hasOwnProperty.call(schemaTier, prop)) {
      const descriptor = schemaTier[prop];
      if (isPlainObject(descriptor) && Object.prototype.hasOwnProperty.call(descriptor, 'default')) {
        result[prop] = /** @type {Record<string, unknown>} */ (descriptor)['default'];
        // prop is set — move to next prop (tier 4 is component's own default,
        // handled by omission).
        continue;
      }
      // Descriptor exists but has no `default` — contribute nothing for this
      // prop at tier 3; fall through to tier 4 (omit from result).
    }

    // Tier 4: component default — omit the prop from `result` entirely.
    // (No action needed; the `for` loop moves on.)
  }

  return result;
}
