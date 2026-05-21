// validate.js — pure prop validation against a propsSchema (FR32).
//
// A single pure function: `validateProps(resolvedProps, propsSchema)` →
// `Array<{ prop, reason }>`.
//
// "Failed" means the resolved prop value violates its declared schema
// constraint — required-but-absent, wrong type, value not in options list,
// or numeric value outside min/max bounds.
//
// ── Why this lives in `core` ──────────────────────────────────────────────────
// Both the studio badge and any future CLI tooling need to evaluate the same
// validation logic against the same four-tier-resolved props. Keeping it in
// `core` preserves the package's role as the environment-agnostic source of
// truth and lets both consumers import without coupling.
//
// ── Purity contract ──────────────────────────────────────────────────────────
//   • No DOM APIs.
//   • No Node built-ins.
//   • No module loading or side effects.
//   • Synchronous and deterministic for a given set of inputs.
//   • Never throws (malformed schema fragments are skipped, not fatal).
//
// ── Conservative by design ───────────────────────────────────────────────────
// Only constraints explicitly declared in the schema are checked. Type aliases,
// coercions, or inferred constraints NOT present in the schema descriptor are
// never enforced — this matches the FormControl validator's scope and avoids
// surprising developers over valid-but-undeclared usage.
//
// Note on `required`: a `required` field with a schema `default` will never be
// absent in resolved props (tier-3 fills it). We still check it — if someone
// passes a synthetic resolved-props object with the key absent, the badge
// should flag it faithfully. The check is `resolvedProps[k] === undefined` to
// match "truly absent after full resolution".

/**
 * A single failed-prop record returned by {@link validateProps}.
 *
 * @typedef {object} FailedProp
 * @property {string} prop    The schema key that failed.
 * @property {string} reason  Human-readable explanation; always non-empty.
 */

/**
 * Validate resolved props against a `propsSchema` and return the list of
 * fields that fail their declared constraints.
 *
 * Failure conditions checked (in order for each field):
 *  1. `required` is `true` AND `resolvedProps[prop] === undefined` → absent.
 *  2. Type mismatch — `type` is 'string', 'number', 'boolean', or 'select'
 *     and the resolved value is present but of the wrong JS type.
 *  3. `select` — value not in `options` array.
 *  4. `number` — value below `min` or above `max`.
 *
 * Only constraints explicitly declared in the schema descriptor are enforced.
 * A schema descriptor with an unknown `type` produces no type-mismatch
 * failure. A non-object descriptor is silently skipped (NFR8).
 *
 * Pure — see module header for the full purity contract.
 *
 * @param {Record<string, unknown>} resolvedProps
 *   The output of `resolveProps(…)` — a plain object of all resolved values.
 *   `undefined` means the prop was absent from all four tiers.
 *
 * @param {Record<string, unknown>} propsSchema
 *   The `meta.propsSchema` object carried by `parseMeta`. Each key is a prop
 *   name; each value is a prop-descriptor object:
 *   `{ type, default?, required?, options?, min?, max?, … }`.
 *
 * @returns {Array<FailedProp>}
 *   An array of `{ prop, reason }` records for each failing field, in
 *   `propsSchema` key order. An empty array means all props pass (or the
 *   schema is empty/absent).
 */
export function validateProps(resolvedProps, propsSchema) {
  // Both arguments must be non-null plain objects; anything else → no failures.
  if (
    resolvedProps === null ||
    typeof resolvedProps !== 'object' ||
    Array.isArray(resolvedProps)
  ) {
    return [];
  }
  if (
    propsSchema === null ||
    typeof propsSchema !== 'object' ||
    Array.isArray(propsSchema)
  ) {
    return [];
  }

  /** @type {Array<FailedProp>} */
  const failures = [];

  for (const prop of Object.keys(propsSchema)) {
    const descriptor = propsSchema[prop];

    // A non-object descriptor is a malformed schema fragment — skip it
    // silently so one bad entry doesn't suppress all other validations (NFR8).
    if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      continue;
    }

    const desc = /** @type {Record<string, unknown>} */ (descriptor);
    const value = resolvedProps[prop];
    const absent = value === undefined;

    // ── 1. required check ────────────────────────────────────────────────────
    if (desc.required === true && absent) {
      failures.push({ prop, reason: 'Required prop is absent.' });
      continue; // No further checks needed for an absent prop.
    }

    // If absent and not required — no further validation.
    if (absent) {
      continue;
    }

    const type = desc.type;

    // ── 2. Type mismatch ─────────────────────────────────────────────────────
    switch (type) {
      case 'string': {
        if (typeof value !== 'string') {
          failures.push({
            prop,
            reason: `Expected a string value; got ${Array.isArray(value) ? 'array' : typeof value}.`,
          });
          continue;
        }
        break;
      }

      case 'number': {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          failures.push({ prop, reason: 'Expected a finite number.' });
          continue;
        }
        // ── 4. numeric bounds ────────────────────────────────────────────────
        if (typeof desc.min === 'number' && value < desc.min) {
          failures.push({ prop, reason: `Value must be at least ${desc.min}.` });
          continue;
        }
        if (typeof desc.max === 'number' && value > desc.max) {
          failures.push({ prop, reason: `Value must be at most ${desc.max}.` });
          continue;
        }
        break;
      }

      case 'boolean': {
        if (typeof value !== 'boolean') {
          failures.push({ prop, reason: 'Expected a boolean value.' });
          continue;
        }
        break;
      }

      case 'select': {
        // Type check: the value must be a string that exists in options.
        const options = Array.isArray(desc.options) ? desc.options : [];
        if (!options.includes(value)) {
          const listed = options.length
            ? `Expected one of: ${options.join(', ')}.`
            : 'No options defined for this field.';
          failures.push({ prop, reason: listed });
          continue;
        }
        break;
      }

      default:
        // Unknown type — no type constraint to enforce.
        break;
    }
  }

  return failures;
}
