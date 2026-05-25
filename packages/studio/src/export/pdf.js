// pdf.js — Single-artboard PDF export (one-click, raster).
//
// A Markdown asset is a *document*, so it wants a PDF rather than a PNG. This
// route reuses the existing image-capture pipeline: `captureArtboard`
// rasterizes the card (so fonts/styles match the PNG/JPG export exactly), then
// the bitmap is placed on a single jsPDF page sized to the card. The text is
// therefore rasterized, not selectable — a deliberate trade for a one-click
// download that behaves like the PNG/JPG buttons beside it.
//
// Like `exportArtboard`, this never throws: every failure is returned in the
// result so the caller (DCArtboardFrame) can show a calm inline message.

import { jsPDF } from 'jspdf';

import { captureArtboard } from './capture.js';
import { buildFilename, triggerDownload } from './single.js';

// Capture at 2× so the embedded bitmap stays crisp; the PDF page is sized to
// the card's CSS dimensions (raw image px / this ratio) so the document prints
// at a sane scale while the image itself is high-resolution.
const PIXEL_RATIO = 2;

/**
 * Read a `Blob` as a base64 data URL (for jsPDF.addImage).
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
 return new Promise((resolve, reject) => {
 const reader = new FileReader();
 reader.onload = () => resolve(/** @type {string} */ (reader.result));
 reader.onerror = () => reject(reader.error || new Error('failed to read captured image'));
 reader.readAsDataURL(blob);
 });
}

/**
 * Decode a data URL to read its natural pixel dimensions.
 *
 * @param {string} dataUrl
 * @returns {Promise<{ width: number, height: number }>}
 */
function imageNaturalSize(dataUrl) {
 return new Promise((resolve, reject) => {
 const img = new Image();
 img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
 img.onerror = () => reject(new Error('failed to decode captured image'));
 img.src = dataUrl;
 });
}

/**
 * Export a single artboard as a one-page PDF and trigger a browser download.
 *
 * Mirrors {@link exportArtboard}'s contract (never throws; returns a result),
 * so a caller can swap formats by branching on `'pdf'` without special-casing
 * error handling.
 *
 * @param {HTMLElement} artboardEl The artboard's inner card DOM node.
 * @param {object} [options]
 * @param {string} [options.assetName] Component file stem — used in the filename.
 * @param {string} [options.variantName] Variant identifier / `'default'`.
 * @param {Function | null} [options.fontResolver] Forwarded to `captureArtboard`.
 * @returns {Promise<{ ok: boolean, filename: string, unembeddedFonts: string[], error: Error | null }>}
 */
export async function exportArtboardPdf(artboardEl, options = {}) {
 const { assetName, variantName, fontResolver = null } = options;
 const filename = buildFilename(assetName, variantName, '.pdf');

 // 1. Rasterize through the shared capture pipeline (PNG, 2×).
 let pngBlob;
 let unembeddedFonts = [];
 try {
 const result = await captureArtboard(artboardEl, {
 format: 'png',
 pixelRatio: PIXEL_RATIO,
 fontResolver,
 });
 pngBlob = result.blob;
 unembeddedFonts = result.unembeddedFonts || [];
 } catch (err) {
 return { ok: false, filename, unembeddedFonts: [], error: err instanceof Error ? err : new Error(String(err)) };
 }

 // 2. Wrap the bitmap on a single PDF page sized to the card.
 try {
 const dataUrl = await blobToDataUrl(pngBlob);
 const { width: rawW, height: rawH } = await imageNaturalSize(dataUrl);
 const pageW = Math.max(1, Math.round(rawW / PIXEL_RATIO));
 const pageH = Math.max(1, Math.round(rawH / PIXEL_RATIO));
 const pdf = new jsPDF({
 orientation: pageW >= pageH ? 'landscape' : 'portrait',
 unit: 'px',
 format: [pageW, pageH],
 compress: true,
 });
 // Use the realized page size (jsPDF may reorder dims by orientation) so the
 // image always fills the page exactly, with no letterboxing.
 const realW = pdf.internal.pageSize.getWidth();
 const realH = pdf.internal.pageSize.getHeight();
 pdf.addImage(dataUrl, 'PNG', 0, 0, realW, realH);
 const pdfBlob = pdf.output('blob');
 triggerDownload(pdfBlob, filename);
 return { ok: true, filename, unembeddedFonts, error: null };
 } catch (err) {
 return { ok: false, filename, unembeddedFonts, error: err instanceof Error ? err : new Error(String(err)) };
 }
}
