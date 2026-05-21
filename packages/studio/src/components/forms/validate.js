// validate.js — schema-value validation helper for form controls.
//
// A single pure function: `validateField(value, schema)` → `{ valid, message }`.
//
// "Invalid" means the value violates the declared schema constraint — wrong
// type, out-of-enum, numeric bounds breach, or required-but-absent.
//
// The control NEVER blocks input based on this result — it only annotates.
// Validation is always lenient in the type-coercion direction so that ephemeral
// partial input (e.g. a half-typed number) doesn't immediately flag as invalid.

/**
 * The result of validating a single field value.
 *
 * @typedef {object} ValidationResult
 * @property {boolean} valid `true` when the value satisfies the schema.
 * @property {string | null} message Human-readable reason when `!valid`, `null` when valid.
 */

/**
 * A schema fragment describing a single field — the shape adopts.
 *
 * @typedef {object} FieldSchema
 * @property {'string' | 'number' | 'boolean' | 'select' | 'array' | 'object'} type
 * @property {unknown} [default]
 * @property {boolean} [required]
 * @property {string} [description]
 * @property {string[]} [options] — required when type is 'select'
 * @property {number} [min] — numeric lower bound (inclusive)
 * @property {number} [max] — numeric upper bound (inclusive)
 * @property {FieldSchema} [itemSchema] — schema for each item when type is 'array'
 * @property {Record<string, FieldSchema>} [properties] — sub-schemas when type is 'object'
 */

/**
 * Validate a field value against its schema fragment.
 *
 * Rules (all non-blocking — the control annotates, never prevents):
 * - `required` + empty/absent value → invalid.
 * - `string`: must be a string (or absent).
 * - `number`: must be a finite number (or absent); `min`/`max` checked.
 * - `boolean`: must be a boolean (or absent).
 * - `select`: must be one of `schema.options` (or absent).
 * - `array`: must be an array (or absent).
 * - `object`: must be a plain object (or absent).
 *
 * `null` and `undefined` are treated as "absent" and only trigger invalid
 * when `required` is set — this keeps partial / blank states non-alarming.
 *
 * @param {unknown} value
 * @param {FieldSchema} schema
 * @returns {ValidationResult}
 */
export function validateField(value, schema) {
 if (!schema || typeof schema !== 'object') {
 return { valid: true, message: null };
 }

 const absent = value === null || value === undefined || value === '';

 // required check
 if (schema.required && absent) {
 return { valid: false, message: 'This field is required.' };
 }

 // If absent and not required — no further validation needed.
 if (absent) {
 return { valid: true, message: null };
 }

 switch (schema.type) {
 case 'string': {
 if (typeof value !== 'string') {
 return { valid: false, message: `Expected a text value, got ${typeof value}.` };
 }
 return { valid: true, message: null };
 }

 case 'number': {
 if (typeof value !== 'number' || !Number.isFinite(value)) {
 return { valid: false, message: 'Expected a valid number.' };
 }
 if (schema.min !== undefined && value < schema.min) {
 return { valid: false, message: `Value must be at least ${schema.min}.` };
 }
 if (schema.max !== undefined && value > schema.max) {
 return { valid: false, message: `Value must be at most ${schema.max}.` };
 }
 return { valid: true, message: null };
 }

 case 'boolean': {
 if (typeof value !== 'boolean') {
 return { valid: false, message: 'Expected a boolean (on/off) value.' };
 }
 return { valid: true, message: null };
 }

 case 'select': {
 const options = Array.isArray(schema.options) ? schema.options : [];
 if (!options.includes(/** @type {string} */ (value))) {
 return {
 valid: false,
 message: options.length
 ? `Expected one of: ${options.join(', ')}.`
 : 'No options defined for this field.',
 };
 }
 return { valid: true, message: null };
 }

 case 'array': {
 if (!Array.isArray(value)) {
 return { valid: false, message: 'Expected a list of values.' };
 }
 return { valid: true, message: null };
 }

 case 'object': {
 if (value === null || typeof value !== 'object' || Array.isArray(value)) {
 return { valid: false, message: 'Expected a set of named fields.' };
 }
 return { valid: true, message: null };
 }

 default:
 return { valid: true, message: null };
 }
}
