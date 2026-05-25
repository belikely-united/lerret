// pdf.test.js — Markdown PDF export (fetches the CLI's /__lerret/export-pdf
// endpoint and downloads the returned vector PDF).
//
// Test matrix:
// (a) success: endpoint 200 + PDF blob → ok:true, .pdf download triggered.
// (b) filename follows <ComponentName>-<purpose>.pdf and uses the variant name.
// (c) missing assetPath → ok:false, no request made.
// (d) the request POSTs { assetPath } to EXPORT_PDF_ENDPOINT.
// (e) endpoint error (non-2xx JSON) → ok:false surfacing the server message.
// (f) network failure (fetch rejects) → ok:false, no download.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { exportArtboardPdf } from './pdf.js';
import { EXPORT_PDF_ENDPOINT } from '../runtime/write-client.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pdfBlob() {
 return new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' });
}

/** A fake `fetch` that resolves to a PDF response. */
function okFetch() {
 return vi.fn(async () => ({
 ok: true,
 status: 200,
 blob: async () => pdfBlob(),
 }));
}

// ─── Global setup ─────────────────────────────────────────────────────────────

let clickedAnchors = [];
const origCreateElement = document.createElement.bind(document);

beforeEach(() => {
 vi.clearAllMocks();
 clickedAnchors = [];

 vi.stubGlobal('URL', {
 createObjectURL: vi.fn(() => 'blob:stub-url'),
 revokeObjectURL: vi.fn(),
 });

 vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
 const el = origCreateElement(tag, ...rest);
 if (tag === 'a') {
 el.click = function () {
 clickedAnchors.push({ href: el.href, download: el.download });
 };
 }
 return el;
 });
});

afterEach(() => {
 vi.restoreAllMocks();
 vi.unstubAllGlobals();
});

// ─── Suite A/D: success path ──────────────────────────────────────────────────

describe('exportArtboardPdf — success path', () => {
 it('(a) returns ok:true and triggers a .pdf download', async () => {
 const fetch = okFetch();
 const result = await exportArtboardPdf({
 assetPath: '/proj/.lerret/demo/Notes.md',
 assetName: 'Notes',
 fetch,
 });

 expect(result.ok).toBe(true);
 expect(result.error).toBeNull();
 expect(clickedAnchors).toHaveLength(1);
 expect(clickedAnchors[0].download).toBe('Notes-default.pdf');
 });

 it('(d) POSTs { assetPath } to the export-pdf endpoint', async () => {
 const fetch = okFetch();
 await exportArtboardPdf({ assetPath: '/proj/.lerret/demo/Notes.md', assetName: 'Notes', fetch });

 expect(fetch).toHaveBeenCalledOnce();
 const [url, init] = fetch.mock.calls[0];
 expect(url).toBe(EXPORT_PDF_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(JSON.parse(init.body)).toEqual({ assetPath: '/proj/.lerret/demo/Notes.md' });
 });
});

// ─── Suite B: filename convention ─────────────────────────────────────────────

describe('exportArtboardPdf — filename', () => {
 it('(b) default purpose → <assetName>-default.pdf', async () => {
 const result = await exportArtboardPdf({
 assetPath: '/p/.lerret/x/ReadMe.md',
 assetName: 'ReadMe',
 fetch: okFetch(),
 });
 expect(result.filename).toBe('ReadMe-default.pdf');
 });

 it('(b) named variant → <assetName>-<variantName>.pdf', async () => {
 const result = await exportArtboardPdf({
 assetPath: '/p/.lerret/x/Spec.md',
 assetName: 'Spec',
 variantName: 'V2',
 fetch: okFetch(),
 });
 expect(result.filename).toBe('Spec-V2.pdf');
 });
});

// ─── Suite C: guard ───────────────────────────────────────────────────────────

describe('exportArtboardPdf — missing assetPath', () => {
 it('(c) returns ok:false and never calls fetch', async () => {
 const fetch = okFetch();
 const result = await exportArtboardPdf({ assetName: 'Notes', fetch });

 expect(result.ok).toBe(false);
 expect(result.error).toBeInstanceOf(Error);
 expect(fetch).not.toHaveBeenCalled();
 expect(clickedAnchors).toHaveLength(0);
 });
});

// ─── Suite E/F: failures ──────────────────────────────────────────────────────

describe('exportArtboardPdf — failures', () => {
 it('(e) endpoint error → ok:false with the server message, no download', async () => {
 const fetch = vi.fn(async () => ({
 ok: false,
 status: 500,
 json: async () => ({ ok: false, error: 'PDF export failed: no Chrome' }),
 }));
 const result = await exportArtboardPdf({ assetPath: '/p/.lerret/x/A.md', assetName: 'A', fetch });

 expect(result.ok).toBe(false);
 expect(result.error.message).toMatch(/no Chrome/i);
 expect(clickedAnchors).toHaveLength(0);
 });

 it('(f) network failure → ok:false, does not throw, no download', async () => {
 const fetch = vi.fn(async () => {
 throw new Error('network down');
 });
 const result = await exportArtboardPdf({ assetPath: '/p/.lerret/x/A.md', assetName: 'A', fetch });

 expect(result).toMatchObject({ ok: false });
 expect(result.error.message).toMatch(/network down/i);
 expect(result.filename).toBe('A-default.pdf');
 expect(clickedAnchors).toHaveLength(0);
 });
});
