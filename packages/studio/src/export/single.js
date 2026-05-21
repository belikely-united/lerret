// single.js — Single-artboard export helper (FR35, FR38)
//
// `exportArtboard` is the one function every per-artboard PNG/JPG download
// button calls. It:
// 1. Calls `captureArtboard` with the resolved format.
// 2. Derives a `<ComponentName>-<purpose>.<ext>` filename from the asset and,
// for a variant, its named-export identifier.
// 3. Triggers a browser anchor-click download — no side effects beyond that.
// 4. Returns a result object `{ ok, unembeddedFonts, error }` so the caller
// can surface inline failure / font notices without catching.
//
// Error-state disabling is enforced by the caller (DCArtboardFrame) — this
// module never attempts a capture when the artboard is in an error state.
//
// Filename convention (<ComponentName>-<purpose>.<ext>):
// • `assetName` is the component file's stem (e.g. `HeroBanner` from
// `HeroBanner.jsx`). It is already the stem — callers must strip the
// extension before passing.
// • `variantName` is the named export identifier for a variant artboard
// (e.g. `Ghost` for the `Ghost` export of `BadgeVariants.jsx`), or
// `'default'` / absent for the primary export.
// • When `variantName` is absent, `'default'`, or `undefined`, the filename
// is `<assetName>-default.<ext>` (e.g. `HeroBanner-default.png`).
// • When `variantName` is a real variant identifier, the filename is
// `<assetName>-<variantName>.<ext>` (e.g. `BadgeVariants-Ghost.png`).
// • Unsafe FS characters are stripped; the stem is capped at 120 chars.

import { captureArtboard } from './capture.js';
import { resolveFormat } from './formats.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip characters that are illegal in common OS file systems and collapse
 * internal whitespace. Never returns an empty string (falls back to 'artboard').
 *
 * @param {string} text
 * @returns {string}
 */
function safeName(text) {
 return (
 (text || 'artboard')
 .toString()
 .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '') // eslint-disable-line no-control-regex
 .replace(/\s+/g, ' ')
 .trim()
 .slice(0, 120) || 'artboard'
 );
}

/**
 * Build the download filename from the asset stem and variant name.
 *
 * Convention: `<ComponentName>-<purpose>.<ext>`
 * - `HeroBanner-default.png`
 * - `BadgeVariants-Ghost.png`
 *
 * @param {string} assetName
 * The component's file stem (no extension), e.g. `'HeroBanner'`.
 * @param {string | undefined} variantName
 * The named-export identifier, `'default'`, or `undefined` for the primary.
 * @param {string} extension
 * Dot-prefixed extension from `resolveFormat`, e.g. `'.png'`.
 * @returns {string} e.g. `'HeroBanner-default.png'`
 */
export function buildFilename(assetName, variantName, extension) {
 const stem = safeName(assetName || 'artboard');
 const purpose =
 !variantName || variantName === 'default'
 ? 'default'
 : safeName(variantName);
 return `${stem}-${purpose}${extension}`;
}

/**
 * Trigger a browser file download from a `Blob`.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
function triggerDownload(blob, filename) {
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 a.click();
 // Revoke asynchronously so the browser has time to start the download.
 setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export a single artboard as an image and trigger a browser download.
 *
 * Calls `captureArtboard` with the caller's `format`, derives a
 * `<ComponentName>-<purpose>.<ext>` filename (FR35), and triggers a download
 * via a temporary anchor click.
 *
 * Never throws — all failures are returned in the result so the caller can
 * surface a calm inline message without a try/catch at the call site.
 *
 * @param {HTMLElement} artboardEl
 * The artboard's inner card DOM node to rasterize.
 * @param {object} options
 * @param {'png' | 'jpg'} [options.format='png']
 * Image format — resolved via `resolveFormat` .
 * @param {string} [options.assetName]
 * The component file stem (e.g. `'HeroBanner'`). Used in the filename.
 * @param {string} [options.variantName]
 * Named-export identifier for a variant, or `'default'` / `undefined` for
 * the primary export. Appended as the `<purpose>` in the filename.
 * @param {Function | null} [options.fontResolver]
 * Custom-font resolver — forwarded directly to `captureArtboard`.
 * @param {number} [options.quality]
 * JPEG quality 0–1 — forwarded to `captureArtboard`.
 *
 * @returns {Promise<{
 * ok: boolean,
 * filename: string | null,
 * unembeddedFonts: string[],
 * error: Error | null
 * }>}
 * `ok` — `true` when the download was triggered successfully.
 * `filename` — the filename used, or `null` on capture failure.
 * `unembeddedFonts` — families `captureArtboard` could not embed (may be
 * non-empty even on success — surface as a calm notice).
 * `error` — the caught `Error` on capture failure, else `null`.
 */
export async function exportArtboard(artboardEl, options = {}) {
 const { format, assetName, variantName, fontResolver = null, quality } = options;

 // Resolve the format descriptor up front so we can build the filename even
 // before capture. An invalid format string resolves as an error.
 let resolved;
 try {
 resolved = resolveFormat(format);
 } catch (err) {
 return { ok: false, filename: null, unembeddedFonts: [], error: err instanceof Error ? err : new Error(String(err)) };
 }

 const { extension } = resolved;
 const filename = buildFilename(assetName, variantName, extension);

 // Capture — non-throwing; failures surface in the return value.
 let blob;
 let unembeddedFonts = [];
 try {
 const result = await captureArtboard(artboardEl, {
 format,
 fontResolver,
 ...(quality !== undefined ? { quality } : {}),
 });
 blob = result.blob;
 unembeddedFonts = result.unembeddedFonts || [];
 } catch (err) {
 return {
 ok: false,
 filename,
 unembeddedFonts: [],
 error: err instanceof Error ? err : new Error(String(err)),
 };
 }

 // Trigger the download.
 triggerDownload(blob, filename);
 return { ok: true, filename, unembeddedFonts, error: null };
}
