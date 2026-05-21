// zip.js — Structured ZIP archive builder with flat-output option (FR36, FR38)
//
// Exports `buildArchive(items, { format, flat })` — captures a set of artboards
// and packages them into a single ZIP Blob. The ZIP's internal folder layout
// either mirrors the project's page/group hierarchy (default) or collapses
// everything to the root with disambiguated file names (flat mode).
//
// ## Layout modes
//
// flat: false (default)
// Each image is placed at `<locationSegments.join('/')>/<filename>`.
// An asset directly in a page (locationSegments = []) lands at the ZIP root.
// e.g. icons/button.png, icons/toggle.png, tokens/color-swatch.png
//
// flat: true
// All images land at the ZIP root. When two items would produce the same
// base filename, the locationSegments are joined with '-' and prepended:
// e.g. icons-button.png, tokens-button.png
// Items whose locationSegments are empty and whose filename is unique are
// written without any prefix (no leading '-').
//
// ## Concurrency
// captureArtboard calls are run with bounded concurrency of ≤ 4 at a time
// (NFR5 — total time scales roughly linearly with artboard count).
//
// ## Failure isolation (NFR8)
// A capture failure never aborts the archive. Failed items appear in the
// returned `skipped` array. An item with `artboard.skipReason` set is skipped
// immediately without attempting capture.
//
// ## Empty-input handling
// When `items` is empty, `buildArchive` resolves with `{ blob: null, skipped: [], unembeddedFonts: [] }`.
// Callers check `result.blob === null` to detect "nothing to export" and
// surface an empty-selection message to the user. No ZIP file is created.

import { zipSync } from 'fflate';
import { captureArtboard } from './capture.js';
import { resolveFormat } from './formats.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the filename for one artboard inside the ZIP.
 *
 * Formula (matching the brand-naming convention ):
 * `<asset.name>[-<variantName>].<extension>`
 *
 * @param {object} artboard Artboard record 's `collectArtboards`.
 * @param {string|undefined} artboard.variantName
 * @param {{ name: string }} artboard.asset
 * @param {string} extension Dot-prefixed extension e.g. '.png'.
 * @returns {string}
 */
function _deriveFilename(artboard, extension) {
 const base = artboard.asset.name;
 const variant = artboard.variantName;
 return variant ? `${base}-${variant}${extension}` : `${base}${extension}`;
}

/**
 * Derive the full ZIP entry path for one item.
 *
 * Structured mode: `[...locationSegments, filename].join('/')`
 * Flat mode: uses the pre-disambiguated flat key passed in.
 *
 * @param {string[]} locationSegments
 * @param {string} filename
 * @returns {string}
 */
function _structuredPath(locationSegments, filename) {
 return locationSegments.length > 0
 ? `${locationSegments.join('/')}/${filename}`
 : filename;
}

/**
 * Run an array of async tasks with bounded concurrency (≤ `limit` at a time).
 *
 * @template T
 * @param {Array<() => Promise<T>>} tasks Zero-arg async factories.
 * @param {number} limit Max concurrent in-flight tasks (NFR5).
 * @returns {Promise<T[]>} Results in original order.
 */
async function _runBounded(tasks, limit) {
 const results = new Array(tasks.length);
 let next = 0;

 async function worker() {
 while (next < tasks.length) {
 const i = next++;
 results[i] = await tasks[i]();
 }
 }

 const workers = [];
 for (let w = 0; w < Math.min(limit, tasks.length); w++) {
 workers.push(worker());
 }
 await Promise.all(workers);
 return results;
}

/**
 * Convert a Blob to a Uint8Array (for fflate's synchronous zipSync).
 *
 * @param {Blob} blob
 * @returns {Promise<Uint8Array>}
 */
async function _blobToUint8Array(blob) {
 const buf = await blob.arrayBuffer();
 return new Uint8Array(buf);
}

/**
 * Build a map of base-filename → count from a list of base filenames.
 * Used to detect collisions in flat mode.
 *
 * @param {string[]} filenames
 * @returns {Map<string, number>}
 */
function _countFilenames(filenames) {
 const counts = new Map();
 for (const name of filenames) {
 counts.set(name, (counts.get(name) ?? 0) + 1);
 }
 return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ArchiveItem
 * @property {object} artboard An `Artboard` record 's `collectArtboards`,
 * optionally enriched with a `variantName` string by the caller for per-variant
 * exports. Must have: `artboard.asset.name`, `artboard.locationSegments`,
 * and optionally `artboard.skipReason` (string) when the artboard is in an
 * error state.
 * @property {HTMLElement} element The on-canvas DOM node passed to `captureArtboard`.
 */

/**
 * @typedef {object} Skipped
 * @property {object} artboard The artboard record that was skipped.
 * @property {string} reason Human-readable explanation of why it was skipped.
 */

/**
 * @typedef {object} ArchiveResult
 * @property {Blob|null} blob
 * The ZIP as a Blob (`application/zip`), or `null` when `items` was empty
 * (caller should surface an "empty selection" message rather than saving a
 * file).
 * @property {Skipped[]} skipped
 * Items that could not be captured — due to a pre-existing `artboard.skipReason`
 * or a runtime capture failure. Always an array (may be empty).
 * @property {string[]} unembeddedFonts
 * Deduplicated list of font-family names that `captureArtboard` could not
 * embed (failed fetches). Callers can surface a calm, non-blocking warning.
 */

/**
 * Capture a set of artboards and package them into a ZIP Blob.
 *
 * @param {ArchiveItem[]} items
 * Pairs of `{ artboard, element }`. The `artboard` is an `Artboard` record
 * from (plus optional `variantName`); `element` is the on-canvas
 * DOM node to capture. Pass an empty array to receive a "nothing to export"
 * result (`blob: null`).
 *
 * @param {object} [options]
 * @param {'png'|'jpg'|'jpeg'} [options.format='png']
 * Image format passed to `captureArtboard` (and `resolveFormat`).
 * @param {boolean} [options.flat=false]
 * - `false` (default): images placed in nested folders mirroring
 * `artboard.locationSegments`.
 * - `true`: all images at the ZIP root; name collisions disambiguated by
 * prefixing the `locationSegments` joined with `-`.
 *
 * @returns {Promise<ArchiveResult>}
 */
export async function buildArchive(items, options = {}) {
 const { format: requestedFormat, flat = false } = options;

 // Resolve format once — throws early for unknown formats, same as captureArtboard.
 const { extension } = resolveFormat(requestedFormat);

 // ── Empty-input fast path ──────────────────────────────────────────────────
 if (!items || items.length === 0) {
 return { blob: null, skipped: [], unembeddedFonts: [] };
 }

 // ── Pre-check: items with a pre-existing skipReason are skipped immediately ─
 const toCapture = [];
 const skipped = [];

 for (const item of items) {
 if (item.artboard.skipReason) {
 skipped.push({ artboard: item.artboard, reason: item.artboard.skipReason });
 } else {
 toCapture.push(item);
 }
 }

 // ── Determine ZIP entry paths ──────────────────────────────────────────────
 // Build base filenames first (needed for flat-mode collision detection).
 const baseFilenames = toCapture.map((item) =>
 _deriveFilename(item.artboard, extension),
 );

 let entryPaths;

 if (flat) {
 // Detect collisions: if the same base filename appears more than once,
 // prefix with the locationSegments joined by '-'.
 const counts = _countFilenames(baseFilenames);

 entryPaths = toCapture.map((item, i) => {
 const filename = baseFilenames[i];
 if (counts.get(filename) > 1) {
 // Disambiguate: prefix segments joined with '-', then the filename.
 const { locationSegments } = item.artboard;
 const prefix = locationSegments.length > 0 ? locationSegments.join('-') : null;
 return prefix ? `${prefix}-${filename}` : filename;
 }
 return filename;
 });
 } else {
 entryPaths = toCapture.map((item, i) => {
 const { locationSegments } = item.artboard;
 return _structuredPath(locationSegments, baseFilenames[i]);
 });
 }

 // ── Capture with bounded concurrency (≤ 4 at a time, NFR5) ───────────────
 const CONCURRENCY_LIMIT = 4;

 // Each task captures one item and returns the result or marks it skipped.
 const captureResults = [];

 const tasks = toCapture.map((item, i) => async () => {
 try {
 const result = await captureArtboard(item.element, { format: requestedFormat });
 return { ok: true, index: i, blob: result.blob, unembeddedFonts: result.unembeddedFonts };
 } catch (err) {
 return {
 ok: false,
 index: i,
 artboard: item.artboard,
 reason: err instanceof Error ? err.message : String(err),
 };
 }
 });

 const rawResults = await _runBounded(tasks, CONCURRENCY_LIMIT);

 // Partition into successes and failures.
 const captured = []; // { entryPath, bytes }
 const allUnembeddedFonts = new Set();

 for (const res of rawResults) {
 if (res.ok) {
 const bytes = await _blobToUint8Array(res.blob);
 captured.push({ entryPath: entryPaths[res.index], bytes });
 for (const font of res.unembeddedFonts) {
 allUnembeddedFonts.add(font);
 }
 } else {
 skipped.push({ artboard: res.artboard, reason: res.reason });
 }
 captureResults.push(res);
 }

 // ── Build ZIP ─────────────────────────────────────────────────────────────
 // If every item was skipped (either pre-check or capture failure), return
 // blob: null so the caller can surface "nothing to export".
 if (captured.length === 0) {
 return { blob: null, skipped, unembeddedFonts: [...allUnembeddedFonts] };
 }

 // fflate's zipSync takes a Record<path, Uint8Array | [Uint8Array, ZipOptions]>.
 const zipFiles = {};
 for (const { entryPath, bytes } of captured) {
 zipFiles[entryPath] = bytes;
 }

 const zipped = zipSync(zipFiles);
 const blob = new Blob([zipped], { type: 'application/zip' });

 return {
 blob,
 skipped,
 unembeddedFonts: [...allUnembeddedFonts],
 };
}
