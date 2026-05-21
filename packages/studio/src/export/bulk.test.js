// bulk.test.js: Bulk export orchestrator
//
// Test matrix:
// (a) Non-empty scope → blob is returned (non-null).
// (b) Empty scope (collectArtboards returns []) → blob is null.
// (c) Progress callbacks: onProgress called with (0, total, '') before capture
// and (total, total, 'done') after.
// (d) Skipped items from buildArchive are propagated in the result.
// (e) DOM-missing artboards are pushed to skipped with a descriptive reason.
// (f) filename is derived from the scope name (.zip extension).
// (g) unembeddedFonts from buildArchive are propagated.
// (h) collectArtboards RangeError → blob: null, no throw.
// (i) All artboards DOM-missing → blob: null.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock @lerret/core (collectArtboards) ────────────────────────────────────

const mockCollectArtboards = vi.fn();

vi.mock('@lerret/core', () => ({
 collectArtboards: (...args) => mockCollectArtboards(...args),
}));

// ─── Mock ./zip.js (buildArchive) ────────────────────────────────────────────

const mockBuildArchive = vi.fn();

vi.mock('./zip.js', () => ({
 buildArchive: (...args) => mockBuildArchive(...args),
}));

import { runBulkExport } from './bulk.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal ProjectNode for testing. */
function makeProject(name = 'My Project', pages = []) {
 return { name, path: '/project/.lerret', pages };
}

/** Minimal PageNode for testing. */
function makePageNode(name = 'Page One', path = '/project/.lerret/page-one') {
 return { name, path, assets: [], groups: [] };
}

/** Minimal Artboard record (from collectArtboards). */
function makeArtboard(assetName = 'button', assetPath = '/project/.lerret/page-one/button.jsx') {
 return {
 asset: { name: assetName, path: assetPath },
 assetPath,
 pagePath: '/project/.lerret/page-one',
 groupPath: null,
 locationPath: '',
 locationSegments: [],
 };
}

/** A tiny PNG Blob for mocking buildArchive responses. */
function fakePngBlob() {
 return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
}

/**
 * Install a DOM element that `_findArtboardElement` can locate by
 * `data-asset-id` attribute. Returns a cleanup function.
 *
 * @param {string} assetPath
 * @returns {{ el: HTMLElement, cleanup: () => void }}
 */
function mountArtboardEl(assetPath) {
 const el = document.createElement('div');
 el.setAttribute('data-asset-id', assetPath);
 document.body.appendChild(el);
 return {
 el,
 cleanup: () => {
 if (el.parentNode) el.parentNode.removeChild(el);
 },
 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Global setup
// ─────────────────────────────────────────────────────────────────────────────

const origCreateElement = document.createElement.bind(document);
let clickedAnchors = [];

beforeEach(() => {
 vi.clearAllMocks();
 clickedAnchors = [];

 // Stub URL.createObjectURL so triggerBulkDownload doesn't throw in jsdom.
 vi.stubGlobal('URL', {
 createObjectURL: vi.fn(() => 'blob:stub-url'),
 revokeObjectURL: vi.fn(),
 });

 // Intercept anchor clicks to verify download is triggered.
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

// ─────────────────────────────────────────────────────────────────────────────
// (a) Non-empty scope → blob is returned
// ─────────────────────────────────────────────────────────────────────────────

describe('(a) runBulkExport — non-empty scope returns a blob', () => {
 it('returns a non-null blob when artboards are found and captured', async () => {
 const artboard = makeArtboard('button', '/project/.lerret/page-one/button.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({
 blob: fakePngBlob(),
 skipped: [],
 unembeddedFonts: [],
 });

 const { el, cleanup } = mountArtboardEl('/project/.lerret/page-one/button.jsx');
 const project = makeProject('My Project', [makePageNode()]);

 const result = await runBulkExport({
 project,
 scope: { kind: 'project' },
 format: 'png',
 });

 cleanup();

 expect(result.blob).toBeInstanceOf(Blob);
 expect(result.blob).not.toBeNull();
 });

 it('calls buildArchive with the paired { artboard, element } items', async () => {
 const artboard = makeArtboard('logo', '/project/.lerret/page-one/logo.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({ blob: fakePngBlob(), skipped: [], unembeddedFonts: [] });

 const { el, cleanup } = mountArtboardEl('/project/.lerret/page-one/logo.jsx');
 const project = makeProject('My Project', [makePageNode()]);

 await runBulkExport({ project, scope: { kind: 'project' }, format: 'png' });

 cleanup();

 expect(mockBuildArchive).toHaveBeenCalledOnce();
 const [items, options] = mockBuildArchive.mock.calls[0];
 expect(items).toHaveLength(1);
 expect(items[0].artboard).toBe(artboard);
 expect(items[0].element).toBeInstanceOf(HTMLElement);
 expect(options.format).toBe('png');
 });

 it('passes flat=true to buildArchive when requested', async () => {
 const artboard = makeArtboard('icon', '/project/.lerret/page-one/icon.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({ blob: fakePngBlob(), skipped: [], unembeddedFonts: [] });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/icon.jsx');
 const project = makeProject('My Project', [makePageNode()]);

 await runBulkExport({ project, scope: { kind: 'project' }, format: 'png', flat: true });

 cleanup();

 const [, options] = mockBuildArchive.mock.calls[0];
 expect(options.flat).toBe(true);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Empty scope → blob is null
// ─────────────────────────────────────────────────────────────────────────────

describe('(b) runBulkExport — empty scope returns null blob', () => {
 it('returns blob: null when collectArtboards returns an empty array', async () => {
 mockCollectArtboards.mockReturnValue([]);

 const project = makeProject('Empty Project', []);
 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.blob).toBeNull();
 expect(mockBuildArchive).not.toHaveBeenCalled();
 });

 it('returns empty skipped and unembeddedFonts arrays for empty scope', async () => {
 mockCollectArtboards.mockReturnValue([]);

 const project = makeProject();
 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.skipped).toEqual([]);
 expect(result.unembeddedFonts).toEqual([]);
 });

 it('still returns a filename even for empty scope', async () => {
 mockCollectArtboards.mockReturnValue([]);

 const project = makeProject('Dashboard');
 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.filename).toBe('Dashboard.zip');
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Progress callbacks
// ─────────────────────────────────────────────────────────────────────────────

describe('(c) runBulkExport — progress callbacks', () => {
 it('calls onProgress with (0, total, "") before capture', async () => {
 const artboard = makeArtboard('a', '/project/.lerret/page-one/a.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({ blob: fakePngBlob(), skipped: [], unembeddedFonts: [] });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/a.jsx');
 const project = makeProject();
 const onProgress = vi.fn();

 await runBulkExport({ project, scope: { kind: 'project' }, onProgress });

 cleanup();

 // First call should be (0, 1, '')
 const firstCall = onProgress.mock.calls[0];
 expect(firstCall[0]).toBe(0);
 expect(firstCall[1]).toBe(1);
 expect(firstCall[2]).toBe('');
 });

 it('calls onProgress with (total, total, "done") after capture', async () => {
 const artboard = makeArtboard('b', '/project/.lerret/page-one/b.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({ blob: fakePngBlob(), skipped: [], unembeddedFonts: [] });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/b.jsx');
 const project = makeProject();
 const onProgress = vi.fn();

 await runBulkExport({ project, scope: { kind: 'project' }, onProgress });

 cleanup();

 // Last call should be (1, 1, 'done')
 const calls = onProgress.mock.calls;
 const lastCall = calls[calls.length - 1];
 expect(lastCall[0]).toBe(1);
 expect(lastCall[1]).toBe(1);
 expect(lastCall[2]).toBe('done');
 });

 it('does not throw when onProgress is undefined', async () => {
 mockCollectArtboards.mockReturnValue([]);
 const project = makeProject();

 await expect(
 runBulkExport({ project, scope: { kind: 'project' } }),
 ).resolves.not.toThrow();
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Skipped items from buildArchive are propagated
// ─────────────────────────────────────────────────────────────────────────────

describe('(d) runBulkExport — skipped artboards propagated', () => {
 it('merges buildArchive skipped into the result skipped array', async () => {
 const artboard = makeArtboard('card', '/project/.lerret/page-one/card.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);

 const buildSkipped = [{ artboard, reason: 'capture failed: canvas lost' }];
 mockBuildArchive.mockResolvedValue({
 blob: null, // all skipped, so null
 skipped: buildSkipped,
 unembeddedFonts: [],
 });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/card.jsx');
 const project = makeProject();

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 cleanup();

 expect(result.skipped).toHaveLength(1);
 expect(result.skipped[0].reason).toMatch(/capture failed/);
 });

 it('includes both DOM-missing and buildArchive skipped in result.skipped', async () => {
 const ab1 = makeArtboard('found', '/project/.lerret/page-one/found.jsx');
 const ab2 = makeArtboard('missing', '/project/.lerret/page-one/missing.jsx');
 mockCollectArtboards.mockReturnValue([ab1, ab2]);

 const buildSkipped = [{ artboard: ab1, reason: 'render error' }];
 mockBuildArchive.mockResolvedValue({
 blob: null,
 skipped: buildSkipped,
 unembeddedFonts: [],
 });

 // Only mount element for ab1 (ab2 is DOM-missing)
 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/found.jsx');
 const project = makeProject();

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 cleanup();

 // skipped = 1 DOM-missing + 1 from buildArchive
 expect(result.skipped).toHaveLength(2);
 const reasons = result.skipped.map((s) => s.reason);
 expect(reasons.some((r) => r.includes('DOM element not found'))).toBe(true);
 expect(reasons.some((r) => r.includes('render error'))).toBe(true);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) DOM-missing artboards go to skipped
// ─────────────────────────────────────────────────────────────────────────────

describe('(e) runBulkExport — DOM-missing artboards skipped', () => {
 it('skips artboards whose element is not found in the DOM', async () => {
 const artboard = makeArtboard('ghost', '/project/.lerret/page-two/ghost.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 // No DOM element mounted for this asset path.

 const project = makeProject();
 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 // blob is null because all items are DOM-missing
 expect(result.blob).toBeNull();
 expect(result.skipped).toHaveLength(1);
 expect(result.skipped[0].reason).toMatch(/DOM element not found/);
 expect(mockBuildArchive).not.toHaveBeenCalled();
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) filename derived from scope name
// ─────────────────────────────────────────────────────────────────────────────

describe('(f) runBulkExport — filename derivation', () => {
 it('uses the project name for a project-scope export', async () => {
 mockCollectArtboards.mockReturnValue([]);
 const project = makeProject('Brand Assets');

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.filename).toBe('Brand Assets.zip');
 });

 it('uses the page name for a page-scope export', async () => {
 mockCollectArtboards.mockReturnValue([]);
 const pagePath = '/project/.lerret/marketing';
 const project = makeProject('My App', [
 { name: 'Marketing', path: pagePath, assets: [], groups: [] },
 ]);

 const result = await runBulkExport({
 project,
 scope: { kind: 'page', path: pagePath },
 });

 expect(result.filename).toBe('Marketing.zip');
 });

 it('uses the group name for a group-scope export', async () => {
 mockCollectArtboards.mockReturnValue([]);
 const groupPath = '/project/.lerret/home/buttons';
 const project = makeProject('My App', [
 {
 name: 'Home',
 path: '/project/.lerret/home',
 assets: [],
 groups: [
 { name: 'Buttons', path: groupPath, assets: [], groups: [] },
 ],
 },
 ]);

 const result = await runBulkExport({
 project,
 scope: { kind: 'group', path: groupPath },
 });

 expect(result.filename).toBe('Buttons.zip');
 });

 it('strips unsafe characters from the project name', async () => {
 mockCollectArtboards.mockReturnValue([]);
 const project = makeProject('My/Project:Test');

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.filename).not.toMatch(/[\\/:*?"<>|]/);
 expect(result.filename).toBe('MyProjectTest.zip');
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (g) unembeddedFonts propagated
// ─────────────────────────────────────────────────────────────────────────────

describe('(g) runBulkExport — unembeddedFonts propagated', () => {
 it('propagates unembeddedFonts from buildArchive', async () => {
 const artboard = makeArtboard('text', '/project/.lerret/page-one/text.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({
 blob: fakePngBlob(),
 skipped: [],
 unembeddedFonts: ['Space Grotesk', 'Inter'],
 });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/text.jsx');
 const project = makeProject();

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 cleanup();

 expect(result.unembeddedFonts).toContain('Space Grotesk');
 expect(result.unembeddedFonts).toContain('Inter');
 });

 it('returns empty unembeddedFonts when all fonts embedded', async () => {
 const artboard = makeArtboard('text2', '/project/.lerret/page-one/text2.jsx');
 mockCollectArtboards.mockReturnValue([artboard]);
 mockBuildArchive.mockResolvedValue({
 blob: fakePngBlob(),
 skipped: [],
 unembeddedFonts: [],
 });

 const { cleanup } = mountArtboardEl('/project/.lerret/page-one/text2.jsx');
 const project = makeProject();

 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 cleanup();

 expect(result.unembeddedFonts).toHaveLength(0);
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (h) collectArtboards throws → blob: null, no throw
// ─────────────────────────────────────────────────────────────────────────────

describe('(h) runBulkExport — collectArtboards error handled gracefully', () => {
 it('returns blob: null and does not throw when collectArtboards throws RangeError', async () => {
 mockCollectArtboards.mockImplementation(() => {
 throw new RangeError('scope "/bad/path" not found in model');
 });

 const project = makeProject();
 const result = await runBulkExport({
 project,
 scope: { kind: 'group', path: '/bad/path' },
 });

 expect(result.blob).toBeNull();
 expect(result.skipped).toEqual([]);
 expect(mockBuildArchive).not.toHaveBeenCalled();
 });
});

// ─────────────────────────────────────────────────────────────────────────────
// (i) All artboards DOM-missing → blob: null
// ─────────────────────────────────────────────────────────────────────────────

describe('(i) runBulkExport — all DOM-missing artboards → blob: null', () => {
 it('returns blob: null when no DOM elements are found for any artboard', async () => {
 const ab1 = makeArtboard('a', '/project/.lerret/page-one/a.jsx');
 const ab2 = makeArtboard('b', '/project/.lerret/page-one/b.jsx');
 mockCollectArtboards.mockReturnValue([ab1, ab2]);
 // No DOM elements mounted.

 const project = makeProject();
 const result = await runBulkExport({ project, scope: { kind: 'project' } });

 expect(result.blob).toBeNull();
 expect(result.skipped).toHaveLength(2);
 expect(mockBuildArchive).not.toHaveBeenCalled();
 });
});
