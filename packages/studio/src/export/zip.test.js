// zip.test.js: Structured ZIP archive builder with flat-output option
//
// Test matrix:
// (a) Structured ZIP (flat: false) — items in nested locations land in matching
// nested folders inside the archive.
// (b) Flat mode (flat: true) — items at root; name collisions disambiguated by
// prefixing locationSegments joined with '-'.
// (c) One item fails capture (mock) → skipped, others still produce a valid ZIP.
// (d) Empty items → blob: null ("nothing to export" result).
// (e) unembeddedFonts from successful captures are aggregated and deduplicated.
// (f) Items with a pre-existing artboard.skipReason are skipped immediately.
// (g) variantName is appended to the filename when present.
//
// captureArtboard and resolveFormat are mocked so these are pure unit tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock captureArtboard BEFORE importing zip.js ────────────────────────────
// The mock returns a tiny Blob by default and can be overridden per-test.

const mockCaptureArtboard = vi.fn();

vi.mock('./capture.js', () => ({
 captureArtboard: (...args) => mockCaptureArtboard(...args),
}));

// ─── Mock fflate ──────────────────────────────────────────────────────────────
// zipSync returns the input keys serialized as bytes so we can inspect paths
// without running real DEFLATE in jsdom.

vi.mock('fflate', () => ({
 zipSync: vi.fn((files) => {
 // Encode the entry paths as a JSON byte sequence for inspection.
 // Tests decode this to verify which paths ended up in the archive.
 const paths = Object.keys(files);
 return new TextEncoder().encode(JSON.stringify(paths));
 }),
}));

import { buildArchive } from './zip.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal ArchiveItem for testing.
 *
 * @param {string} assetName e.g. 'button'
 * @param {string[]} locationSegs e.g. ['icons'] or []
 * @param {string} [variantName] e.g. 'dark' (optional)
 * @param {string} [skipReason] set to simulate pre-skipped artboard
 */
function makeItem(assetName, locationSegs = [], variantName, skipReason) {
 return {
 artboard: {
 asset: { name: assetName },
 locationSegments: [...locationSegs],
 variantName,
 skipReason,
 },
 element: document.createElement('div'), // jsdom element (not actually rendered)
 };
}

/**
 * Tiny 4-byte Blob that represents a captured PNG for test purposes.
 * MIME type must match what captureArtboard would return.
 */
function fakePngBlob() {
 return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

/**
 * Read the paths encoded in the fake zipSync output blob.
 * (Our mock JSON-encodes the list of paths in the Uint8Array returned by zipSync.)
 *
 * @param {Blob} blob
 * @returns {Promise<string[]>}
 */
async function decodePaths(blob) {
 const text = await blob.text();
 return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Default mock setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
 vi.clearAllMocks();
 // Default: every capture succeeds with no unembedded fonts.
 mockCaptureArtboard.mockResolvedValue({ blob: fakePngBlob(), unembeddedFonts: [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) Structured ZIP — nested folders mirror locationSegments
// ─────────────────────────────────────────────────────────────────────────────

describe('(a) buildArchive — structured mode (flat: false)', () => {
 it('places a root-level artboard (empty locationSegments) directly at the ZIP root', async () => {
 const items = [makeItem('logo', [])];
 const result = await buildArchive(items, { format: 'png' });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('logo.png');
 });

 it('places an artboard in a single-segment location inside the matching folder', async () => {
 const items = [makeItem('button', ['icons'])];
 const result = await buildArchive(items, { format: 'png' });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('icons/button.png');
 });

 it('places artboards in deeply nested locations', async () => {
 const items = [makeItem('chip', ['ui', 'components'])];
 const result = await buildArchive(items, { format: 'png' });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('ui/components/chip.png');
 });

 it('correctly distributes multiple artboards across different nested folders', async () => {
 const items = [
 makeItem('button', ['icons']),
 makeItem('swatch', ['tokens']),
 makeItem('header', []),
 ];
 const result = await buildArchive(items, { format: 'png' });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('icons/button.png');
 expect(paths).toContain('tokens/swatch.png');
 expect(paths).toContain('header.png');
 });

 it('uses jpg extension when format is jpg', async () => {
 const items = [makeItem('card', ['ui'])];
 const result = await buildArchive(items, { format: 'jpg' });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('ui/card.jpg');
 });

 it('returns a Blob of type application/zip', async () => {
 const items = [makeItem('icon', [])];
 const result = await buildArchive(items);
 expect(result.blob).toBeInstanceOf(Blob);
 expect(result.blob.type).toBe('application/zip');
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Flat mode — items at root, collisions disambiguated
// ─────────────────────────────────────────────────────────────────────────────

describe('(b) buildArchive — flat mode (flat: true)', () => {
 it('places all items at the ZIP root when there are no name collisions', async () => {
 const items = [
 makeItem('button', ['icons']),
 makeItem('swatch', ['tokens']),
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('button.png');
 expect(paths).toContain('swatch.png');
 // No folder separators
 expect(paths.every((p) => !p.includes('/'))).toBe(true);
 });

 it('disambiguates colliding filenames by prefixing locationSegments joined with "-"', async () => {
 const items = [
 makeItem('button', ['icons']), // would clash
 makeItem('button', ['tokens']), // would clash
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('icons-button.png');
 expect(paths).toContain('tokens-button.png');
 });

 it('disambiguates collisions in deeply nested paths using all segments joined with "-"', async () => {
 const items = [
 makeItem('icon', ['ui', 'light']),
 makeItem('icon', ['ui', 'dark']),
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('ui-light-icon.png');
 expect(paths).toContain('ui-dark-icon.png');
 });

 it('does not prefix a root-level item that has no location segments when it is not colliding', async () => {
 const items = [
 makeItem('logo', []), // unique filename, no segments
 makeItem('button', ['ui']),
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 // 'logo' is unique → no prefix
 expect(paths).toContain('logo.png');
 expect(paths).toContain('button.png');
 });

 it('handles a mix of colliding and non-colliding names correctly', async () => {
 const items = [
 makeItem('button', ['primary']),
 makeItem('button', ['secondary']),
 makeItem('logo', ['brand']), // unique — no disambiguation needed
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('primary-button.png');
 expect(paths).toContain('secondary-button.png');
 expect(paths).toContain('logo.png');
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) One item fails capture → skipped; others still produce a valid ZIP
// ─────────────────────────────────────────────────────────────────────────────

describe('(c) buildArchive — failure isolation (NFR8)', () => {
 it('skips a failing item and still produces a ZIP from the remaining items', async () => {
 // First call succeeds, second throws.
 mockCaptureArtboard
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: [] })
 .mockRejectedValueOnce(new Error('render failure'));

 const items = [
 makeItem('button', ['icons']), // succeeds
 makeItem('broken', ['icons']), // fails
 ];

 const result = await buildArchive(items, { format: 'png' });

 // The ZIP blob must still be present (the successful item was captured).
 expect(result.blob).toBeInstanceOf(Blob);

 // The failing item must appear in skipped.
 expect(result.skipped).toHaveLength(1);
 expect(result.skipped[0].artboard.asset.name).toBe('broken');
 expect(result.skipped[0].reason).toMatch(/render failure/);
 });

 it('includes the failed item reason in skipped[].reason', async () => {
 mockCaptureArtboard.mockRejectedValueOnce(new Error('canvas context lost'));

 const items = [makeItem('widget', [])];
 const result = await buildArchive(items);

 expect(result.skipped).toHaveLength(1);
 expect(result.skipped[0].reason).toContain('canvas context lost');
 });

 it('returns blob: null when ALL items fail capture', async () => {
 mockCaptureArtboard.mockRejectedValue(new Error('all fail'));

 const items = [
 makeItem('a', []),
 makeItem('b', []),
 ];

 const result = await buildArchive(items);
 expect(result.blob).toBeNull();
 expect(result.skipped).toHaveLength(2);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Empty items → "nothing to export" result
// ─────────────────────────────────────────────────────────────────────────────

describe('(d) buildArchive — empty input', () => {
 it('returns blob: null for an empty items array', async () => {
 const result = await buildArchive([]);
 expect(result.blob).toBeNull();
 });

 it('returns empty skipped array for empty input', async () => {
 const result = await buildArchive([]);
 expect(result.skipped).toEqual([]);
 });

 it('returns empty unembeddedFonts array for empty input', async () => {
 const result = await buildArchive([]);
 expect(result.unembeddedFonts).toEqual([]);
 });

 it('does not call captureArtboard for empty input', async () => {
 await buildArchive([]);
 expect(mockCaptureArtboard).not.toHaveBeenCalled();
 });

 it('handles undefined items gracefully (returns nothing-to-export result)', async () => {
 const result = await buildArchive(undefined);
 expect(result.blob).toBeNull();
 expect(result.skipped).toEqual([]);
 expect(result.unembeddedFonts).toEqual([]);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) unembeddedFonts aggregated and deduplicated
// ─────────────────────────────────────────────────────────────────────────────

describe('(e) buildArchive — unembeddedFonts aggregation', () => {
 it('aggregates unembeddedFonts from all successful captures', async () => {
 mockCaptureArtboard
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: ['Roboto'] })
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: ['Inter'] });

 const items = [makeItem('a', []), makeItem('b', [])];
 const result = await buildArchive(items);

 expect(result.unembeddedFonts).toContain('Roboto');
 expect(result.unembeddedFonts).toContain('Inter');
 });

 it('deduplicates repeated font names across captures', async () => {
 mockCaptureArtboard
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: ['Roboto', 'Inter'] })
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: ['Roboto'] }); // duplicate

 const items = [makeItem('a', []), makeItem('b', [])];
 const result = await buildArchive(items);

 // Roboto should appear only once
 const robotoCount = result.unembeddedFonts.filter((f) => f === 'Roboto').length;
 expect(robotoCount).toBe(1);
 expect(result.unembeddedFonts).toContain('Inter');
 });

 it('returns empty unembeddedFonts when all captures embed fonts successfully', async () => {
 mockCaptureArtboard
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: [] })
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: [] });

 const items = [makeItem('a', []), makeItem('b', [])];
 const result = await buildArchive(items);

 expect(result.unembeddedFonts).toHaveLength(0);
 });

 it('does not include unembeddedFonts from skipped (failed) captures', async () => {
 // First item fails → its fonts are irrelevant (we don't have them)
 // Second item succeeds with a font warning.
 mockCaptureArtboard
 .mockRejectedValueOnce(new Error('fail'))
 .mockResolvedValueOnce({ blob: fakePngBlob(), unembeddedFonts: ['Raleway'] });

 const items = [makeItem('a', []), makeItem('b', [])];
 const result = await buildArchive(items);

 // Only fonts from successful captures are included.
 expect(result.unembeddedFonts).toEqual(['Raleway']);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) Pre-existing artboard.skipReason → immediate skip
// ─────────────────────────────────────────────────────────────────────────────

describe('(f) buildArchive — pre-existing skipReason', () => {
 it('skips an artboard with skipReason without calling captureArtboard', async () => {
 const items = [
 makeItem('ok', [], undefined, undefined),
 makeItem('broken', [], undefined, 'artboard is in error state'),
 ];

 const result = await buildArchive(items);

 // Only the non-skipped item triggers a capture call.
 expect(mockCaptureArtboard).toHaveBeenCalledTimes(1);
 // The broken artboard appears in skipped.
 expect(result.skipped).toHaveLength(1);
 expect(result.skipped[0].artboard.asset.name).toBe('broken');
 expect(result.skipped[0].reason).toBe('artboard is in error state');
 });

 it('returns blob: null when the only item has skipReason', async () => {
 const items = [makeItem('broken', [], undefined, 'error state')];
 const result = await buildArchive(items);
 expect(result.blob).toBeNull();
 expect(result.skipped).toHaveLength(1);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) variantName appended to filename
// ─────────────────────────────────────────────────────────────────────────────

describe('(g) buildArchive — variantName in filename', () => {
 it('appends variantName to the filename with a dash separator', async () => {
 const items = [makeItem('button', ['icons'], 'dark')];
 const result = await buildArchive(items);
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('icons/button-dark.png');
 });

 it('does not append any suffix when variantName is undefined', async () => {
 const items = [makeItem('button', ['icons'])];
 const result = await buildArchive(items);
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('icons/button.png');
 // Make sure no stray dash is added.
 expect(paths.some((p) => p.includes('undefined'))).toBe(false);
 });

 it('includes variant in the flat-mode filename collision check', async () => {
 // Same asset name + variant → same filename → should NOT collide.
 // Different variants → different filenames → no disambiguation needed.
 const items = [
 makeItem('icon', ['light'], 'filled'),
 makeItem('icon', ['dark'], 'outline'),
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 // These are distinct filenames, so no prefix needed.
 expect(paths).toContain('icon-filled.png');
 expect(paths).toContain('icon-outline.png');
 });

 it('disambiguates flat mode when variant+name still collides', async () => {
 // Same asset name AND same variant from two different locations → collision.
 const items = [
 makeItem('icon', ['a'], 'dark'),
 makeItem('icon', ['b'], 'dark'),
 ];
 const result = await buildArchive(items, { flat: true });
 const paths = await decodePaths(result.blob);
 expect(paths).toContain('a-icon-dark.png');
 expect(paths).toContain('b-icon-dark.png');
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Result shape contract
// ─────────────────────────────────────────────────────────────────────────────

describe('buildArchive — result shape contract', () => {
 it('always returns the three expected keys: blob, skipped, unembeddedFonts', async () => {
 const result = await buildArchive([makeItem('x', [])]);
 expect(result).toHaveProperty('blob');
 expect(result).toHaveProperty('skipped');
 expect(result).toHaveProperty('unembeddedFonts');
 expect(Array.isArray(result.skipped)).toBe(true);
 expect(Array.isArray(result.unembeddedFonts)).toBe(true);
 });

 it('empty-input result also has all three keys', async () => {
 const result = await buildArchive([]);
 expect(result).toHaveProperty('blob');
 expect(result).toHaveProperty('skipped');
 expect(result).toHaveProperty('unembeddedFonts');
 });
});
