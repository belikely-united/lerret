// formats.js — Export format registry and resolver (FR38)
//
// Every export route (single, bulk, CLI) calls `resolveFormat` to canonicalize
// the caller's format string into a { format, mimeType, extension } descriptor.
// `captureArtboard` consumes the resolved descriptor to select the
// correct html-to-image function and MIME type for the output Blob.

// ─────────────────────────────────────────────────────────────────────────────
// Supported format definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Definitive map of supported export formats.
 *
 * Keys are canonical format names; values carry the MIME type and file
 * extension every export route uses when naming the download and setting the
 * Blob type.
 *
 * @type {Record<string, { mimeType: string, extension: string }>}
 */
export const exportFormats = {
 png: { mimeType: 'image/png', extension: '.png' },
 jpg: { mimeType: 'image/jpeg', extension: '.jpg' },
};

/** Aliases that map to a canonical format key. */
const FORMAT_ALIASES = {
 jpeg: 'jpg',
};

/** Sorted list of supported format names for error messages. */
const SUPPORTED_FORMATS = Object.keys(exportFormats).sort().join(', ');

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a caller-supplied format string to a canonical descriptor.
 *
 * - `undefined` / no argument → defaults to `png` (FR38).
 * - `'jpeg'` → alias for `'jpg'`.
 * - Any unrecognized value → throws a caller-catchable `Error` naming the
 * unsupported value and listing the supported formats.
 *
 * @param {string} [requested] The format string from the caller (e.g. 'png',
 * 'jpg', 'jpeg'). Omit or pass `undefined` to use the default.
 * @returns {{ format: string, mimeType: string, extension: string }}
 * `format` — canonical lowercase key (e.g. `'png'`, `'jpg'`).
 * `mimeType` — IANA MIME type (e.g. `'image/png'`, `'image/jpeg'`).
 * `extension` — dot-prefixed file extension (e.g. `'.png'`, `'.jpg'`).
 * @throws {Error} When `requested` is a non-empty string not in `exportFormats`
 * and not a known alias.
 */
export function resolveFormat(requested) {
 // Default to png when no format is provided (FR38).
 if (requested === undefined || requested === null || requested === '') {
 const format = 'png';
 return { format, ...exportFormats[format] };
 }

 const lower = String(requested).toLowerCase();

 // Resolve aliases first (e.g. 'jpeg' → 'jpg').
 const canonical = FORMAT_ALIASES[lower] ?? lower;

 if (!exportFormats[canonical]) {
 throw new Error(
 `captureArtboard: unsupported format "${requested}". Supported formats: ${SUPPORTED_FORMATS}.`,
 );
 }

 return { format: canonical, ...exportFormats[canonical] };
}
