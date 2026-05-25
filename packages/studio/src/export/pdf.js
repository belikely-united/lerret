// pdf.js — request a TRUE-VECTOR PDF of a Markdown asset and download it.
//
// The studio no longer rasterizes anything for PDF. It POSTs the asset's path
// to the CLI's `/__lerret/export-pdf` endpoint, which renders the asset
// headlessly (Chromium `page.pdf()`) and streams back a real vector PDF —
// selectable text, sharp at any zoom. Here we just save those bytes.
//
// Never throws: every failure comes back in the result so the caller
// (DCArtboardFrame) can show a calm inline message, exactly like the PNG/JPG
// path's contract.

import { buildFilename, triggerDownload } from './single.js';
import { EXPORT_PDF_ENDPOINT } from '../runtime/write-client.js';

/**
 * Export one Markdown asset as a vector PDF via the CLI endpoint, then trigger
 * a browser download.
 *
 * @param {object} options
 * @param {string} options.assetPath  The asset's {@link LerretPath}.
 * @param {string} [options.assetName]  File stem — used in the filename.
 * @param {string} [options.variantName]  Variant id / `'default'`.
 * @param {typeof fetch} [options.fetch]  Injected fetch (tests pass a fake).
 * @returns {Promise<{ ok: boolean, filename: string, unembeddedFonts: string[], error: Error | null }>}
 */
export async function exportArtboardPdf(options = {}) {
 const { assetPath, assetName, variantName } = options;
 const filename = buildFilename(assetName, variantName, '.pdf');

 if (typeof assetPath !== 'string' || assetPath.length === 0) {
 return { ok: false, filename, unembeddedFonts: [], error: new Error('exportArtboardPdf: assetPath is required') };
 }

 const fetchImpl = options.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
 if (typeof fetchImpl !== 'function') {
 return { ok: false, filename, unembeddedFonts: [], error: new Error('no fetch implementation available') };
 }

 let response;
 try {
 response = await fetchImpl(EXPORT_PDF_ENDPOINT, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ assetPath }),
 });
 } catch (err) {
 return { ok: false, filename, unembeddedFonts: [], error: err instanceof Error ? err : new Error(String(err)) };
 }

 if (!response.ok) {
 // The endpoint sends a JSON error body on failure.
 let message = `PDF export failed (${response.status})`;
 try {
 const j = await response.json();
 if (j && j.error) message = j.error;
 } catch {
 // Non-JSON error body — keep the status-based message.
 }
 return { ok: false, filename, unembeddedFonts: [], error: new Error(message) };
 }

 let blob;
 try {
 blob = await response.blob();
 } catch (err) {
 return { ok: false, filename, unembeddedFonts: [], error: err instanceof Error ? err : new Error(String(err)) };
 }

 triggerDownload(blob, filename);
 return { ok: true, filename, unembeddedFonts: [], error: null };
}
