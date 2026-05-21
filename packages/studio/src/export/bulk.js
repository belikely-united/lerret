// bulk.js — Bulk export orchestrator (FR36, FR38)
//
// `runBulkExport` orchestrates the full collect → pair-DOM → capture → archive
// → download pipeline for project-level, page-level, and group-level bulk
// exports from the studio canvas.
//
// ## DOM-to-artboard pairing
//
// The canvas renders each artboard's card inside a slot element with a
// `data-dc-slot` attribute. The slot's host section is stamped with
// `data-dc-section="<sectionPath>"` by `DCSection`. Within a slot the inner
// artboard frame (the element passed to `captureArtboard`) carries
// `[data-asset-id="<assetPath>"]`. This module queries those selectors to
// pair each `Artboard` record (from `collectArtboards`) with its live DOM node.
//
// Artboards whose DOM element is not found are pushed to `skipped` with a
// `'DOM element not found'` reason (they may belong to a page that is not
// currently rendered, for example).
//
// ## Empty-scope handling
//
// When `collectArtboards` returns `[]`, or when ALL artboards are DOM-missing
// (all skipped), `runBulkExport` resolves with `{ blob: null, … }`. The caller
// checks `blob === null` to surface a calm "nothing to export" message.
//
// ## onProgress callback
//
// `buildArchive` runs captures with bounded concurrency (≤ 4). Since we cannot
// hook into the per-capture progress inside `buildArchive`, `onProgress` is
// a best-effort mechanism: we call it once with `(0, total, '')` before the
// archive starts and once with `(total, total, 'done')` when it resolves.
// For finer-grained progress the caller may show a spinner rather than
// `i/total` text — the spec only requires "shows inline i/total progress".

import { collectArtboards } from '@lerret/core';
import { buildArchive } from './zip.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip characters that are illegal in common OS file systems and collapse
 * internal whitespace. Falls back to 'export' for empty or null input.
 *
 * @param {string} text
 * @returns {string}
 */
function _safeName(text) {
 return (
 (text || 'export')
 .toString()
 .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '') // eslint-disable-line no-control-regex
 .replace(/\s+/g, ' ')
 .trim()
 .slice(0, 120) || 'export'
 );
}

/**
 * Derive the ZIP filename for the export scope.
 *
 * - Project scope: `<projectName>.zip`
 * - Page scope: `<pageName>.zip`
 * - Group scope: `<groupName>.zip`
 *
 * @param {import('@lerret/core').ProjectNode} project
 * @param {{ kind: 'project' | 'page' | 'group', path?: string }} scope
 * @returns {string}
 */
function _deriveZipFilename(project, scope) {
 if (scope.kind === 'project') {
 return `${_safeName(project.name || 'project')}.zip`;
 }

 const targetPath = scope.path;
 if (!targetPath) return 'export.zip';

 // Search pages and groups for a matching node to get its name.
 for (const page of project.pages || []) {
 if (page.path === targetPath) {
 return `${_safeName(page.name)}.zip`;
 }
 const groupName = _findGroupName(page.groups || [], targetPath);
 if (groupName !== null) {
 return `${_safeName(groupName)}.zip`;
 }
 }

 // Fallback: use the last path segment.
 const segments = targetPath.split('/');
 return `${_safeName(segments[segments.length - 1] || 'export')}.zip`;
}

/**
 * Recursively search for a group's name by path.
 *
 * @param {import('@lerret/core').GroupNode[]} groups
 * @param {string} targetPath
 * @returns {string | null}
 */
function _findGroupName(groups, targetPath) {
 for (const g of groups) {
 if (g.path === targetPath) return g.name;
 const found = _findGroupName(g.groups || [], targetPath);
 if (found !== null) return found;
 }
 return null;
}

/**
 * Derive the `collectArtboards` scope argument from the caller's scope object.
 *
 * - `{ kind: 'project' }` → `null` (whole-project sentinel)
 * - `{ kind: 'page' | 'group', path }` → `path`
 *
 * @param {import('@lerret/core').ProjectNode} project
 * @param {{ kind: 'project' | 'page' | 'group', path?: string }} scope
 * @returns {string | null}
 */
function _scopeToCollectArg(project, scope) {
 if (scope.kind === 'project') return null;
 return scope.path ?? null;
}

/**
 * Escape a string for safe use in a CSS attribute selector.
 * Falls back to a manual replacement when `CSS.escape` is unavailable (e.g. jsdom).
 *
 * @param {string} value
 * @returns {string}
 */
function _cssEscape(value) {
 if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
 return CSS.escape(value);
 }
 // Minimal fallback: escape backslashes and double-quotes, which are the
 // characters most likely to break a `[attr="value"]` selector.
 return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Look up the DOM element for one artboard.
 *
 * The canvas stamps each asset slot with:
 * - `[data-dc-slot]` on the slot wrapper
 * - `[data-asset-id="<assetPath>"]` on the inner artboard frame
 *
 * Falls back to querying just `[data-asset-id]` anywhere in the document
 * so we are robust to markup changes inside `DCSection`.
 *
 * @param {import('@lerret/core').AssetNode} asset
 * @returns {HTMLElement | null}
 */
function _findArtboardElement(asset) {
 if (typeof document === 'undefined') return null;
 const assetId = asset.path;
 // Try the canonical `data-asset-id` attribute first.
 const byAssetId = document.querySelector(`[data-asset-id="${_cssEscape(assetId)}"]`);
 if (byAssetId) return /** @type {HTMLElement} */ (byAssetId);
 // Try `data-dc-slot` with the assetPath as value (some canvas versions use this).
 const bySlot = document.querySelector(`[data-dc-slot="${_cssEscape(assetId)}"]`);
 if (bySlot) return /** @type {HTMLElement} */ (bySlot);
 return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} BulkExportScope
 * @property {'project' | 'page' | 'group'} kind
 * What to export.
 * @property {string} [path]
 * The `LerretPath` of the page or group to export. Required when `kind` is
 * `'page'` or `'group'`; ignored for `'project'`.
 */

/**
 * @typedef {object} BulkExportResult
 * @property {Blob | null} blob
 * The ZIP as a Blob, or `null` when the scope was empty or all artboards
 * were skipped — caller should surface a "nothing to export" message.
 * @property {string} filename
 * Suggested download filename, e.g. `"my-project.zip"`.
 * @property {Array<{ artboard: object, reason: string }>} skipped
 * Artboards that could not be captured.
 * @property {string[]} unembeddedFonts
 * Font-family names that could not be embedded — caller surfaces a calm notice.
 */

/**
 * Run a bulk export for a scope of the project.
 *
 * Orchestrates:
 * 1. `collectArtboards(project, scopeArg)` — collect the artboard list.
 * 2. DOM pairing — for each artboard, find its live canvas element.
 * 3. `buildArchive(items, { format, flat })` — capture + ZIP.
 * 4. Return `{ blob, filename, skipped, unembeddedFonts }`.
 *
 * `onProgress(i, total, label)` is called before capture starts
 * (`i=0`) and after the archive resolves (`i=total`). Intermediate
 * per-artboard progress is not tracked here since `buildArchive` uses
 * bounded concurrency internally.
 *
 * Never throws — all errors are returned in `skipped` or as `blob: null`.
 *
 * @param {object} params
 * @param {import('@lerret/core').ProjectNode} params.project
 * The root ProjectNode from the current in-memory model.
 * @param {BulkExportScope} params.scope
 * What to export.
 * @param {'png' | 'jpg'} [params.format='png']
 * Image format for the captured artboards.
 * @param {boolean} [params.flat=false]
 * When `true`, all images land at the ZIP root; when `false` (default)
 * they are placed in nested folders mirroring the project structure.
 * @param {(i: number, total: number, label: string) => void} [params.onProgress]
 * Progress callback. Called with `(0, total, '')` before capture starts and
 * `(total, total, 'done')` on completion.
 *
 * @returns {Promise<BulkExportResult>}
 */
export async function runBulkExport({ project, scope, format = 'png', flat = false, onProgress }) {
 const filename = _deriveZipFilename(project, scope);

 // ── 1. Collect artboards ──────────────────────────────────────────────────
 let artboards;
 try {
 const collectScope = _scopeToCollectArg(project, scope);
 artboards = collectArtboards(project, collectScope);
 } catch (err) {
 // RangeError (path not found) or TypeError (null model) — treat as empty.
 console.warn('[lerret/bulk-export] collectArtboards failed:', err);
 return { blob: null, filename, skipped: [], unembeddedFonts: [] };
 }

 if (artboards.length === 0) {
 // Empty scope — no ZIP produced.
 return { blob: null, filename, skipped: [], unembeddedFonts: [] };
 }

 // ── 2. Pair each artboard with its DOM element ────────────────────────────
 /** @type {Array<{ artboard: object, element: HTMLElement }>} */
 const items = [];
 /** @type {Array<{ artboard: object, reason: string }>} */
 const missingDom = [];

 for (const artboard of artboards) {
 const element = _findArtboardElement(artboard.asset);
 if (element) {
 items.push({ artboard, element });
 } else {
 missingDom.push({
 artboard,
 reason: `DOM element not found for artboard "${artboard.asset.name}" (it may be on a different page)`,
 });
 }
 }

 const total = artboards.length;
 onProgress?.(0, total, '');

 // If all artboards are DOM-missing, return empty result.
 if (items.length === 0) {
 onProgress?.(total, total, 'done');
 return { blob: null, filename, skipped: missingDom, unembeddedFonts: [] };
 }

 // ── 3. Build archive ──────────────────────────────────────────────────────
 let archiveResult;
 try {
 archiveResult = await buildArchive(items, { format, flat });
 } catch (err) {
 console.warn('[lerret/bulk-export] buildArchive failed:', err);
 onProgress?.(total, total, 'done');
 return { blob: null, filename, skipped: missingDom, unembeddedFonts: [] };
 }

 onProgress?.(total, total, 'done');

 // Merge DOM-missing skips with capture-failure skips from buildArchive.
 const allSkipped = [...missingDom, ...(archiveResult.skipped || [])];

 return {
 blob: archiveResult.blob,
 filename,
 skipped: allSkipped,
 unembeddedFonts: archiveResult.unembeddedFonts || [],
 };
}

/**
 * Trigger a browser file download from a `Blob`.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export function triggerBulkDownload(blob, filename) {
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 a.click();
 setTimeout(() => URL.revokeObjectURL(url), 10000);
}
