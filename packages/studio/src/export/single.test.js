// single.test.js: Single-artboard export helper
//
// Test matrix:
// (a) exportArtboard — success path: PNG download triggered.
// (b) exportArtboard — success path: JPG download triggered.
// (c) buildFilename — default variant (no variantName / 'default').
// (d) buildFilename — named variant (e.g. 'Ghost').
// (e) buildFilename — primary variant name 'default' is treated as default.
// (f) exportArtboard — capture failure (captureArtboard rejects) returns ok:false.
// (g) exportArtboard — unembedded-fonts surfaced in the result (ok:true).
// (h) exportArtboard — unsupported format returns ok:false without calling capture.
// (i) buildFilename — unsafe characters are stripped.
// (j) exportArtboard — returned filename matches buildFilename convention.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock captureArtboard before importing single.js ─────────────────────────
// We mock the whole export/capture module so tests run without html-to-image.

vi.mock('./capture.js', () => ({
 captureArtboard: vi.fn(),
}));

import { exportArtboard, buildFilename } from './single.js';
import { captureArtboard } from './capture.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal artboard-like element. */
function makeEl() {
 const el = document.createElement('div');
 document.body.appendChild(el);
 return el;
}

/** Tiny PNG blob. */
function pngBlob() {
 return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

/** Tiny JPEG blob. */
function jpgBlob() {
 return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
}

// ─── Global setup ─────────────────────────────────────────────────────────────

let clickedAnchors = [];

// Intercept the anchor-click download path: spy on body.appendChild and
// anchor.click so we can assert a download was triggered with the right filename
// and href, without needing a real browser navigation.
//
// Strategy: before each test, install a spy on document.body.appendChild that
// intercepts <a> elements before their click — because triggerDownload creates
// the anchor, sets href/download, then calls .click(). We override click on the
// real anchor element to capture it instead.
const origCreateElement = document.createElement.bind(document);

beforeEach(() => {
 vi.clearAllMocks();
 clickedAnchors = [];

 // Stub URL.createObjectURL / revokeObjectURL — jsdom doesn't support blob URLs.
 vi.stubGlobal('URL', {
 createObjectURL: vi.fn(() => 'blob:stub-url'),
 revokeObjectURL: vi.fn(),
 });

 // Intercept createElement('a') to capture click calls.
 vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
 const el = origCreateElement(tag, ...rest);
 if (tag === 'a') {
 el.click = function () {
 clickedAnchors.push({ href: el.href, download: el.download });
 // No real navigation in jsdom — just record the click.
 };
 }
 return el;
 });
});

afterEach(() => {
 vi.restoreAllMocks();
 vi.unstubAllGlobals();
});

// ─── Suite A/B: success path ──────────────────────────────────────────────────

describe('exportArtboard — success path', () => {
 it('(a) PNG: returns ok:true and triggers a download', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'HeroBanner' });

 expect(result.ok).toBe(true);
 expect(result.error).toBeNull();
 expect(result.unembeddedFonts).toEqual([]);
 // A download was triggered (anchor.click() was called).
 expect(clickedAnchors).toHaveLength(1);
 });

 it('(b) JPG: returns ok:true and triggers a download', async () => {
 captureArtboard.mockResolvedValue({ blob: jpgBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'jpg', assetName: 'Card' });

 expect(result.ok).toBe(true);
 expect(result.error).toBeNull();
 expect(clickedAnchors).toHaveLength(1);
 });

 it('(a) captureArtboard is called with the correct format option', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 await exportArtboard(el, { format: 'png', assetName: 'Foo' });

 expect(captureArtboard).toHaveBeenCalledOnce();
 const [, opts] = captureArtboard.mock.calls[0];
 expect(opts.format).toBe('png');
 });

 it('(b) JPG: captureArtboard is called with format jpg', async () => {
 captureArtboard.mockResolvedValue({ blob: jpgBlob(), unembeddedFonts: [] });
 const el = makeEl();

 await exportArtboard(el, { format: 'jpg', assetName: 'Badge' });

 const [, opts] = captureArtboard.mock.calls[0];
 expect(opts.format).toBe('jpg');
 });
});

// ─── Suite C/D/E: filename convention ────────────────────────────────────────

describe('buildFilename — filename convention', () => {
 it('(c) no variantName → <assetName>-default.<ext>', () => {
 expect(buildFilename('HeroBanner', undefined, '.png')).toBe('HeroBanner-default.png');
 });

 it('(c) empty variantName → <assetName>-default.<ext>', () => {
 expect(buildFilename('HeroBanner', '', '.png')).toBe('HeroBanner-default.png');
 });

 it('(d) named variant → <assetName>-<variantName>.<ext>', () => {
 expect(buildFilename('BadgeVariants', 'Ghost', '.png')).toBe('BadgeVariants-Ghost.png');
 });

 it('(d) named variant with JPG extension', () => {
 expect(buildFilename('BadgeVariants', 'Ghost', '.jpg')).toBe('BadgeVariants-Ghost.jpg');
 });

 it('(e) variantName "default" → treated as default purpose', () => {
 expect(buildFilename('HeroBanner', 'default', '.png')).toBe('HeroBanner-default.png');
 });

 it('(i) unsafe FS characters are stripped from assetName', () => {
 const name = buildFilename('Hero/Banner:Test', undefined, '.png');
 expect(name).not.toMatch(/[\\/:*?"<>|]/);
 expect(name).toBe('HeroBannerTest-default.png');
 });

 it('(i) unsafe characters stripped from variantName too', () => {
 const name = buildFilename('Badge', 'Ghost/Dark', '.png');
 expect(name).not.toMatch(/[\\/:*?"<>|]/);
 expect(name).toBe('Badge-GhostDark.png');
 });
});

// ─── Suite J: filename in exportArtboard result ───────────────────────────────

describe('exportArtboard — returned filename', () => {
 it('(j) filename follows <ComponentName>-<purpose>.<ext> for default', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'HeroBanner' });

 expect(result.filename).toBe('HeroBanner-default.png');
 });

 it('(j) filename uses the variantName for named variants', async () => {
 captureArtboard.mockResolvedValue({ blob: jpgBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'jpg', assetName: 'BadgeVariants', variantName: 'Ghost' });

 expect(result.filename).toBe('BadgeVariants-Ghost.jpg');
 });

 it('(j) download anchor receives the constructed filename', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 await exportArtboard(el, { format: 'png', assetName: 'HeroBanner' });

 expect(clickedAnchors[0].download).toBe('HeroBanner-default.png');
 });
});

// ─── Suite F: capture failure ─────────────────────────────────────────────────

describe('exportArtboard — capture failure', () => {
 it('(f) captureArtboard rejection → ok:false with an error, no download', async () => {
 captureArtboard.mockRejectedValue(new Error('html-to-image exploded'));
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'Broken' });

 expect(result.ok).toBe(false);
 expect(result.error).toBeInstanceOf(Error);
 expect(result.error.message).toMatch(/html-to-image/i);
 // No download should have been triggered
 expect(clickedAnchors).toHaveLength(0);
 });

 it('(f) exportArtboard itself does not throw on capture failure', async () => {
 captureArtboard.mockRejectedValue(new Error('network error'));
 const el = makeEl();

 await expect(exportArtboard(el, { format: 'png', assetName: 'Foo' })).resolves.toMatchObject({
 ok: false,
 });
 });

 it('(f) filename is still set on capture failure (for error-surface use)', async () => {
 captureArtboard.mockRejectedValue(new Error('boom'));
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'Widget' });

 expect(result.filename).toBe('Widget-default.png');
 });
});

// ─── Suite G: unembedded fonts surfaced ──────────────────────────────────────

describe('exportArtboard — unembedded fonts', () => {
 it('(g) ok:true when fonts not embedded — download still fires', async () => {
 captureArtboard.mockResolvedValue({
 blob: pngBlob(),
 unembeddedFonts: ['Space Grotesk', 'JetBrains Mono'],
 });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'Card' });

 expect(result.ok).toBe(true);
 expect(result.unembeddedFonts).toEqual(['Space Grotesk', 'JetBrains Mono']);
 // Download still triggered
 expect(clickedAnchors).toHaveLength(1);
 });

 it('(g) empty unembeddedFonts array when all fonts embedded', async () => {
 captureArtboard.mockResolvedValue({ blob: pngBlob(), unembeddedFonts: [] });
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'png', assetName: 'Card' });

 expect(result.unembeddedFonts).toHaveLength(0);
 });
});

// ─── Suite H: unsupported format ─────────────────────────────────────────────

describe('exportArtboard — unsupported format', () => {
 it('(h) unsupported format → ok:false, captureArtboard NOT called', async () => {
 const el = makeEl();

 const result = await exportArtboard(el, { format: 'svg', assetName: 'Icon' });

 expect(result.ok).toBe(false);
 expect(result.error).toBeInstanceOf(Error);
 expect(captureArtboard).not.toHaveBeenCalled();
 expect(clickedAnchors).toHaveLength(0);
 });

 it('(h) exportArtboard does not throw for unsupported format', async () => {
 const el = makeEl();

 await expect(exportArtboard(el, { format: 'webp', assetName: 'Icon' })).resolves.toMatchObject({
 ok: false,
 });
 });
});
