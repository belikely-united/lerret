// formats.test.js: Export format registry and resolver
//
// Test matrix:
// (a) resolveFormat — canonical cases (png, jpg, jpeg alias).
// (b) resolveFormat — default when no argument supplied.
// (c) resolveFormat — throws for unrecognized formats.
// (d) exportFormats — shape contract.
// (e) captureArtboard integration — JPEG produces the correct Blob MIME type
// with white-matte backgroundColor; PNG preserves transparency (no bg set).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock html-to-image before importing modules that use it ─────────────────

vi.mock('html-to-image', () => ({
 toBlob: vi.fn(async (_el, _opts) =>
 new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }),
 ),
 toJpeg: vi.fn(async (_el, _opts) => {
 const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
 const b64 = btoa(String.fromCharCode(...bytes));
 return `data:image/jpeg;base64,${b64}`;
 }),
}));

import { exportFormats, resolveFormat } from './formats.js';
import { captureArtboard } from './capture.js';
import * as htmlToImage from 'html-to-image';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeArtboard(width = 100, height = 100) {
 const el = document.createElement('div');
 el.style.width = `${width}px`;
 el.style.height = `${height}px`;
 el.style.fontFamily = 'system-ui, sans-serif';
 document.body.appendChild(el);
 return el;
}

// ─── Suite A: resolveFormat canonical cases ───────────────────────────────────

describe('resolveFormat — canonical cases', () => {
 it('(a) resolves "png" to the png descriptor', () => {
 const result = resolveFormat('png');
 expect(result.format).toBe('png');
 expect(result.mimeType).toBe('image/png');
 expect(result.extension).toBe('.png');
 });

 it('(a) resolves "jpg" to the jpg descriptor', () => {
 const result = resolveFormat('jpg');
 expect(result.format).toBe('jpg');
 expect(result.mimeType).toBe('image/jpeg');
 expect(result.extension).toBe('.jpg');
 });

 it('(a) resolves "jpeg" as an alias — returns the jpg shape', () => {
 const result = resolveFormat('jpeg');
 // Alias must resolve to the canonical jpg descriptor (not a separate entry)
 expect(result.format).toBe('jpg');
 expect(result.mimeType).toBe('image/jpeg');
 expect(result.extension).toBe('.jpg');
 });
});

// ─── Suite B: resolveFormat default ──────────────────────────────────────────

describe('resolveFormat — default format', () => {
 it('(b) defaults to png when called with no argument', () => {
 const result = resolveFormat();
 expect(result.format).toBe('png');
 expect(result.mimeType).toBe('image/png');
 expect(result.extension).toBe('.png');
 });

 it('(b) defaults to png when called with undefined', () => {
 const result = resolveFormat(undefined);
 expect(result.format).toBe('png');
 });
});

// ─── Suite C: resolveFormat throws for unrecognized formats ──────────────────

describe('resolveFormat — unsupported formats', () => {
 it('(c) throws for "svg" with a message naming the unsupported value', () => {
 expect(() => resolveFormat('svg')).toThrow(/svg/i);
 });

 it('(c) error for "webp" lists supported formats (png, jpg)', () => {
 let caughtMessage = '';
 try {
 resolveFormat('webp');
 } catch (err) {
 caughtMessage = err.message;
 }
 // The error must name the unsupported value and list supported formats
 expect(caughtMessage).toMatch(/webp/i);
 expect(caughtMessage).toMatch(/png/i);
 expect(caughtMessage).toMatch(/jpg/i);
 });

 it('(c) throws a plain Error (caller-catchable)', () => {
 expect(() => resolveFormat('bmp')).toThrow(Error);
 });
});

// ─── Suite D: exportFormats shape ────────────────────────────────────────────

describe('exportFormats — shape contract', () => {
 it('(d) has a png entry with the correct mimeType and extension', () => {
 expect(exportFormats.png).toBeDefined();
 expect(exportFormats.png.mimeType).toBe('image/png');
 expect(exportFormats.png.extension).toBe('.png');
 });

 it('(d) has a jpg entry with the correct mimeType and extension', () => {
 expect(exportFormats.jpg).toBeDefined();
 expect(exportFormats.jpg.mimeType).toBe('image/jpeg');
 expect(exportFormats.jpg.extension).toBe('.jpg');
 });

 it('(d) does not expose jpeg as a separate entry (it is only an alias)', () => {
 // jpeg must NOT be a top-level key in exportFormats; it is an alias resolved
 // by resolveFormat before hitting the map.
 expect(exportFormats).not.toHaveProperty('jpeg');
 });
});

// ─── Suite E: captureArtboard integration ────────────────────────────────────

describe('captureArtboard — format & quality integration', () => {
 let artboard;

 beforeEach(() => {
 vi.clearAllMocks();

 artboard = makeArtboard();

 vi.stubGlobal('fetch', async () => ({
 ok: false,
 status: 404,
 arrayBuffer: async () => new ArrayBuffer(0),
 }));

 Object.defineProperty(document, 'fonts', {
 configurable: true,
 value: { ready: Promise.resolve() },
 });

 Object.defineProperty(artboard, 'offsetWidth', { configurable: true, value: 100 });
 Object.defineProperty(artboard, 'offsetHeight', { configurable: true, value: 100 });
 });

 afterEach(() => {
 artboard.remove();
 vi.unstubAllGlobals();
 });

 it('(e) JPEG blob has MIME type image/jpeg', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'jpg' });
 expect(blob).toBeInstanceOf(Blob);
 expect(blob.type).toBe('image/jpeg');
 });

 it('(e) JPEG uses white-matte backgroundColor (#ffffff) under transparent regions', async () => {
 await captureArtboard(artboard, { format: 'jpg' });
 const opts = htmlToImage.toJpeg.mock.calls[0][1];
 // White matte is applied via the backgroundColor option passed to html-to-image
 expect(opts.backgroundColor).toBe('#ffffff');
 });

 it('(e) JPEG alias "jpeg" also produces image/jpeg blob with white matte', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'jpeg' });
 expect(blob.type).toBe('image/jpeg');
 const opts = htmlToImage.toJpeg.mock.calls[0][1];
 expect(opts.backgroundColor).toBe('#ffffff');
 });

 it('(e) PNG blob has MIME type image/png', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'png' });
 expect(blob).toBeInstanceOf(Blob);
 expect(blob.type).toBe('image/png');
 });

 it('(e) PNG preserves transparency — no backgroundColor set by default', async () => {
 await captureArtboard(artboard, { format: 'png' });
 const opts = htmlToImage.toBlob.mock.calls[0][1];
 // PNG must NOT have a white matte applied; backgroundColor should be undefined
 expect(opts.backgroundColor).toBeUndefined();
 });

 it('(e) captureArtboard throws for an unrecognized format (routes through resolveFormat)', async () => {
 await expect(
 captureArtboard(artboard, { format: 'svg' }),
 ).rejects.toThrow(/svg/i);
 });

 it('(e) defaults to PNG when format is not specified', async () => {
 const { blob } = await captureArtboard(artboard);
 expect(blob.type).toBe('image/png');
 expect(htmlToImage.toBlob).toHaveBeenCalledOnce();
 expect(htmlToImage.toJpeg).not.toHaveBeenCalled();
 });

 it('(e) passes quality value to toJpeg for JPEG captures', async () => {
 await captureArtboard(artboard, { format: 'jpg', quality: 0.75 });
 const opts = htmlToImage.toJpeg.mock.calls[0][1];
 expect(opts.quality).toBe(0.75);
 });
});
