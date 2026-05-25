// pdf.test.js — Single-artboard PDF export (one-click, raster).
//
// Test matrix:
// (a) success: capture resolves → ok:true, .pdf download triggered, jsPDF used.
// (b) filename follows <ComponentName>-<purpose>.pdf and uses the variant name.
// (c) capture failure → ok:false with an error, no download.
// (d) the capture goes through the shared pipeline as PNG (matches PNG/JPG).
//
// The capture module and jsPDF are mocked so the test runs without
// html-to-image or a real PDF engine; `Image` is stubbed because jsdom never
// fires `img.onload` for a data URL.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mocks (must be hoisted before importing pdf.js) ─────────────────────────

vi.mock('./capture.js', () => ({
 captureArtboard: vi.fn(),
}));

vi.mock('jspdf', () => ({
 jsPDF: vi.fn(function jsPDF() {
 this.internal = { pageSize: { getWidth: () => 240, getHeight: () => 800 } };
 this.addImage = vi.fn();
 this.output = vi.fn(() => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }));
 }),
}));

import { exportArtboardPdf } from './pdf.js';
import { captureArtboard } from './capture.js';
import { jsPDF } from 'jspdf';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEl() {
 const el = document.createElement('div');
 document.body.appendChild(el);
 return el;
}

function pngBlob() {
 return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
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

 // jsdom never loads images — stub Image so onload fires with known dims.
 vi.stubGlobal('Image', class FakeImage {
 set src(v) {
 this._src = v;
 this.naturalWidth = 480;
 this.naturalHeight = 1600;
 if (typeof this.onload === 'function') setTimeout(() => this.onload(), 0);
 }
 get src() { return this._src; }
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

// ─── Suite A: success path ────────────────────────────────────────────────────

describe('exportArtboardPdf — success path', () => {
 it('(a) returns ok:true, triggers a .pdf download, and builds a PDF', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'Notes' });

 expect(result.ok).toBe(true);
 expect(result.error).toBeNull();
 expect(clickedAnchors).toHaveLength(1);
 expect(clickedAnchors[0].download).toBe('Notes-default.pdf');
 // The PDF engine was driven: one doc, one image placed, one blob output.
 expect(jsPDF).toHaveBeenCalledOnce();
 const instance = jsPDF.mock.instances[0];
 expect(instance.addImage).toHaveBeenCalledOnce();
 expect(instance.output).toHaveBeenCalledWith('blob');
 });

 it('(d) captures through the shared pipeline as PNG (matches PNG/JPG export)', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 await exportArtboardPdf(el, { assetName: 'Notes' });

 expect(captureArtboard).toHaveBeenCalledOnce();
 const [, opts] = captureArtboard.mock.calls[0];
 expect(opts.format).toBe('png');
 });

 it('(g) surfaces unembedded fonts on success', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: ['Space Grotesk'] });
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'Notes' });

 expect(result.ok).toBe(true);
 expect(result.unembeddedFonts).toEqual(['Space Grotesk']);
 });
});

// ─── Suite B: filename convention ─────────────────────────────────────────────

describe('exportArtboardPdf — filename', () => {
 it('(b) default purpose → <assetName>-default.pdf', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'ReadMe' });

 expect(result.filename).toBe('ReadMe-default.pdf');
 });

 it('(b) named variant → <assetName>-<variantName>.pdf', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'Spec', variantName: 'V2' });

 expect(result.filename).toBe('Spec-V2.pdf');
 });
});

// ─── Suite C: capture failure ─────────────────────────────────────────────────

describe('exportArtboardPdf — capture failure', () => {
 it('(c) capture rejection → ok:false with an error, no download', async () => {
 captureArtboard.mockRejectedValue(new Error('html-to-image exploded'));
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'Broken' });

 expect(result.ok).toBe(false);
 expect(result.error).toBeInstanceOf(Error);
 expect(result.error.message).toMatch(/html-to-image/i);
 expect(clickedAnchors).toHaveLength(0);
 });

 it('(c) does not throw on capture failure; filename still set', async () => {
 captureArtboard.mockRejectedValue(new Error('boom'));
 const el = makeEl();

 const result = await exportArtboardPdf(el, { assetName: 'Widget' });

 expect(result).toMatchObject({ ok: false });
 expect(result.filename).toBe('Widget-default.pdf');
 });
});
