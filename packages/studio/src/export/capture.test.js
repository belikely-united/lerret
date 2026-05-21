// capture.test.js: Generalized full-font-embedding capture core
//
// Test matrix:
// (a) captureArtboard returns a Blob with the correct MIME type per format.
// (b) unembeddedFonts lists font families that fail to fetch (mocked fetch).
// (c) A custom font registered via fontResolver is inlined (resolved & fetched).
// (d) Deterministic output — two captures of an unchanged DOM yield the same
// blob bytes (same length as a proxy for byte-identity in jsdom).
// (e) Capture completes without throwing on the failure path (missing font).
//
// All DOM-heavy html-to-image internals are mocked so tests run fast and
// deterministically in jsdom without a real browser.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock html-to-image before importing capture.js ──────────────────────────
// html-to-image renders real DOM nodes to a canvas, which jsdom doesn't support
// fully. We mock its `toBlob` and `toJpeg` to return deterministic values
// so we can unit-test the font-embedding pipeline independently.

vi.mock('html-to-image', () => {
 return {
 // toBlob returns a tiny 1×1 PNG-like blob (stable bytes)
 toBlob: vi.fn(async (_el, _opts) => {
 return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
 }),
 // toJpeg returns a data URL for a tiny JPEG-like payload
 toJpeg: vi.fn(async (_el, _opts) => {
 // Minimal valid JPEG data URL (the bytes don't need to be a real JPEG for
 // unit tests; only the MIME type and round-tripping matter).
 const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
 const b64 = btoa(String.fromCharCode(...bytes));
 return `data:image/jpeg;base64,${b64}`;
 }),
 };
});

import { captureArtboard } from './capture.js';
import * as htmlToImage from 'html-to-image';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a minimal artboard-like DOM element. */
function makeArtboard(width = 100, height = 100) {
 const el = document.createElement('div');
 el.style.width = `${width}px`;
 el.style.height = `${height}px`;
 el.style.fontFamily = 'system-ui, sans-serif';
 // Attach to body so getComputedStyle can resolve styles.
 document.body.appendChild(el);
 return el;
}

/** Tiny fake font file as an ArrayBuffer (4 bytes). */
function fakeFontBuffer() {
 return new Uint8Array([0x77, 0x4f, 0x46, 0x32]).buffer; // "WOFF2" magic-ish
}

/** Build a base64 string that capture.js would build from fakeFontBuffer(). */
function fakeFontB64() {
 const bytes = new Uint8Array(fakeFontBuffer());
 return btoa(String.fromCharCode(...bytes));
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('captureArtboard', () => {
 let artboard;

 beforeEach(() => {
 // Reset mocks between tests
 vi.clearAllMocks();

 artboard = makeArtboard();

 // Default: fetch returns 404 for everything (overridden per-test as needed)
 vi.stubGlobal('fetch', async (url) => {
 return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
 });

 // Stub document.fonts.ready so the await in captureArtboard settles quickly
 Object.defineProperty(document, 'fonts', {
 configurable: true,
 value: { ready: Promise.resolve() },
 });

 // offsetWidth/offsetHeight aren't set by jsdom layout engine
 Object.defineProperty(artboard, 'offsetWidth', { configurable: true, value: 100 });
 Object.defineProperty(artboard, 'offsetHeight', { configurable: true, value: 100 });
 });

 afterEach(() => {
 artboard.remove();
 vi.unstubAllGlobals();
 });

 // ── (a) Correct MIME type per format ────────────────────────────────────

 it('(a) returns a PNG Blob for format=png', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'png' });
 expect(blob).toBeInstanceOf(Blob);
 expect(blob.type).toBe('image/png');
 expect(htmlToImage.toBlob).toHaveBeenCalledOnce();
 });

 it('(a) returns a JPEG Blob for format=jpg', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'jpg' });
 expect(blob).toBeInstanceOf(Blob);
 expect(blob.type).toBe('image/jpeg');
 expect(htmlToImage.toJpeg).toHaveBeenCalledOnce();
 });

 it('(a) treats format=jpeg as an alias for jpg', async () => {
 const { blob } = await captureArtboard(artboard, { format: 'jpeg' });
 expect(blob).toBeInstanceOf(Blob);
 expect(blob.type).toBe('image/jpeg');
 });

 it('(a) throws for an unsupported format', async () => {
 await expect(
 captureArtboard(artboard, { format: 'svg' }),
 ).rejects.toThrow(/unsupported format/);
 });

 // ── (b) unembeddedFonts lists families that fail to fetch ────────────────

 it('(b) lists a custom font in unembeddedFonts when fetch returns 404', async () => {
 // fontResolver resolves "BrandFont" but the fetch of its URL will fail
 const fontResolver = vi.fn((family) => {
 if (family === 'BrandFont') return { url: 'http://localhost/fonts/Brand.woff2', format: 'woff2' };
 return null;
 });

 // Inject "BrandFont" into the artboard's computed style
 artboard.style.fontFamily = '"BrandFont", sans-serif';

 const { unembeddedFonts } = await captureArtboard(artboard, { fontResolver });

 expect(unembeddedFonts).toContain('BrandFont');
 });

 it('(b) unembeddedFonts is empty when no custom fonts fail', async () => {
 // No fontResolver → no custom fonts → nothing can "fail" a custom font fetch
 const { unembeddedFonts } = await captureArtboard(artboard);
 expect(unembeddedFonts).toHaveLength(0);
 });

 // ── (c) Custom font is inlined via fontResolver ──────────────────────────

 it('(c) inlines a custom font as a base64 data-URI @font-face rule', async () => {
 artboard.style.fontFamily = '"MyCustomFont", sans-serif';

 const fontResolver = vi.fn((family) => {
 if (family === 'MyCustomFont')
 return { url: 'http://localhost/fonts/MyCustomFont.woff2', format: 'woff2' };
 return null;
 });

 // Override fetch so the font file "succeeds"
 vi.stubGlobal('fetch', async (url) => {
 if (url === 'http://localhost/fonts/MyCustomFont.woff2') {
 return { ok: true, arrayBuffer: async () => fakeFontBuffer() };
 }
 return { ok: false, status: 404 };
 });

 await captureArtboard(artboard, { fontResolver });

 // Verify toBlob was called with fontEmbedCSS that includes the data-URI
 const callOpts = htmlToImage.toBlob.mock.calls[0][1];
 expect(callOpts.fontEmbedCSS).toBeDefined();
 expect(callOpts.fontEmbedCSS).toContain('MyCustomFont');
 expect(callOpts.fontEmbedCSS).toContain('data:font/woff2;base64,');
 expect(callOpts.fontEmbedCSS).toContain(fakeFontB64());
 });

 it('(c) fontResolver is called with parsed family names (no surrounding quotes)', async () => {
 artboard.style.fontFamily = '"QuotedFont"';
 const fontResolver = vi.fn(() => null);

 await captureArtboard(artboard, { fontResolver });

 // The resolver must have been called with the unquoted name
 const calledWith = fontResolver.mock.calls.map(([f]) => f);
 expect(calledWith).toContain('QuotedFont');
 });

 // ── (d) Deterministic output (NFR10) ────────────────────────────────────

 it('(d) two captures of an unchanged artboard call toBlob with identical fontEmbedCSS', async () => {
 artboard.style.fontFamily = '"Alpha", "Beta", sans-serif';

 // Two fonts, both fetchable
 const fontResolver = (family) => {
 const map = {
 Alpha: { url: 'http://localhost/fonts/Alpha.woff2', format: 'woff2' },
 Beta: { url: 'http://localhost/fonts/Beta.woff2', format: 'woff2' },
 };
 return map[family] || null;
 };

 vi.stubGlobal('fetch', async (url) => {
 if (url.includes('Alpha.woff2') || url.includes('Beta.woff2')) {
 return { ok: true, arrayBuffer: async () => fakeFontBuffer() };
 }
 return { ok: false, status: 404 };
 });

 await captureArtboard(artboard, { fontResolver });
 await captureArtboard(artboard, { fontResolver });

 const [call1, call2] = htmlToImage.toBlob.mock.calls;
 expect(call1[1].fontEmbedCSS).toBe(call2[1].fontEmbedCSS);
 });

 it('(d) font rules are emitted in sorted family-name order', async () => {
 artboard.style.fontFamily = '"Zebra", "Apple", sans-serif';

 const fontResolver = (family) => {
 const map = {
 Zebra: { url: 'http://localhost/fonts/Zebra.woff2', format: 'woff2' },
 Apple: { url: 'http://localhost/fonts/Apple.woff2', format: 'woff2' },
 };
 return map[family] || null;
 };

 vi.stubGlobal('fetch', async () => ({
 ok: true,
 arrayBuffer: async () => fakeFontBuffer(),
 }));

 await captureArtboard(artboard, { fontResolver });

 const css = htmlToImage.toBlob.mock.calls[0][1].fontEmbedCSS;
 const appleIdx = css.indexOf('Apple');
 const zebraIdx = css.indexOf('Zebra');
 expect(appleIdx).toBeGreaterThanOrEqual(0);
 expect(zebraIdx).toBeGreaterThanOrEqual(0);
 // "Apple" should appear before "Zebra" (sorted)
 expect(appleIdx).toBeLessThan(zebraIdx);
 });

 // ── (e) No throw on failure path ─────────────────────────────────────────

 it('(e) does not throw when a custom font fetch fails — returns unembeddedFonts', async () => {
 artboard.style.fontFamily = '"FailingFont"';

 const fontResolver = () => ({
 url: 'http://localhost/fonts/FailingFont.woff2',
 format: 'woff2',
 });

 // fetch throws (network error)
 vi.stubGlobal('fetch', async () => { throw new Error('Network failure'); });

 // Call directly — must not throw
 const result = await captureArtboard(artboard, { fontResolver });

 expect(result.unembeddedFonts).toContain('FailingFont');
 expect(result.blob).toBeInstanceOf(Blob);
 });

 it('(e) does not throw when fontResolver itself throws', async () => {
 artboard.style.fontFamily = '"BrokenResolver"';

 const fontResolver = () => { throw new Error('resolver exploded'); };

 // Call directly — must not throw
 const result = await captureArtboard(artboard, { fontResolver });

 // The family is not added to unembeddedFonts (resolver threw before we
 // could confirm it's a custom font), but the capture still completes.
 expect(result.blob).toBeInstanceOf(Blob);
 });

 it('(e) does not throw when Google Fonts CSS fetch fails', async () => {
 // Inject a fake Google Fonts link so _googleFontsCssUrls picks it up
 const link = document.createElement('link');
 link.rel = 'stylesheet';
 link.href = 'https://fonts.googleapis.com/css2?family=Roboto&display=swap';
 document.head.appendChild(link);

 vi.stubGlobal('fetch', async () => { throw new Error('Network down'); });

 // Call directly — must not throw
 const result = await captureArtboard(artboard);

 expect(result.blob).toBeInstanceOf(Blob);

 link.remove();
 });

 // ── Additional edge cases ─────────────────────────────────────────────────

 it('returns correct result shape { blob, unembeddedFonts }', async () => {
 const result = await captureArtboard(artboard);
 expect(result).toHaveProperty('blob');
 expect(result).toHaveProperty('unembeddedFonts');
 expect(Array.isArray(result.unembeddedFonts)).toBe(true);
 });

 it('applies white backgroundColor for jpg format', async () => {
 await captureArtboard(artboard, { format: 'jpg' });
 const opts = htmlToImage.toJpeg.mock.calls[0][1];
 expect(opts.backgroundColor).toBe('#ffffff');
 });

 it('does not set backgroundColor for png format by default', async () => {
 await captureArtboard(artboard, { format: 'png' });
 const opts = htmlToImage.toBlob.mock.calls[0][1];
 expect(opts.backgroundColor).toBeUndefined();
 });

 it('respects caller-supplied backgroundColor', async () => {
 await captureArtboard(artboard, { format: 'png', backgroundColor: '#ff0000' });
 const opts = htmlToImage.toBlob.mock.calls[0][1];
 expect(opts.backgroundColor).toBe('#ff0000');
 });
});
