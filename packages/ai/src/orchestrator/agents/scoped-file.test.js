// Tests for the shared selection-scoped file reader (Planner + Inspector).

import { describe, it, expect } from 'vitest';

import {
    readScopedFile,
    elementPinpoint,
    toProjectRelativeLerretPath,
    describeScopedFile,
    selectionWritePaths,
    SCOPED_FILE_CHAR_CAP,
} from './scoped-file.js';

function makeSandbox(files) {
    return {
        exists: async (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFile: async (p) => files[p],
    };
}

describe('readScopedFile', () => {
    it('returns null without a sandbox, scope, or file-kind scope', async () => {
        const sandbox = makeSandbox({ '.lerret/a.jsx': 'A' });
        expect(await readScopedFile({ kind: 'file', filePath: 'a.jsx' }, undefined)).toBeNull();
        expect(await readScopedFile(undefined, sandbox)).toBeNull();
        expect(await readScopedFile({ kind: 'page', label: 'kit page' }, sandbox)).toBeNull();
        expect(await readScopedFile({ kind: 'file', filePath: '' }, sandbox)).toBeNull();
    });

    it('reads the `.lerret/`-prefixed candidate for a project-relative chip path', async () => {
        const sandbox = makeSandbox({ '.lerret/social/card.jsx': 'CARD' });
        const r = await readScopedFile({ kind: 'file', filePath: 'social/card.jsx' }, sandbox);
        expect(r).toMatchObject({ path: '.lerret/social/card.jsx', content: 'CARD' });
    });

    it('accepts an already-prefixed path verbatim', async () => {
        const sandbox = makeSandbox({ '.lerret/a.jsx': 'A' });
        const r = await readScopedFile({ kind: 'file', filePath: '.lerret/a.jsx' }, sandbox);
        expect(r).toMatchObject({ path: '.lerret/a.jsx', content: 'A' });
    });

    it('returns null when no candidate exists and caps oversized content', async () => {
        const sandbox = makeSandbox({ '.lerret/big.jsx': 'x'.repeat(SCOPED_FILE_CHAR_CAP + 100) });
        expect(await readScopedFile({ kind: 'file', filePath: 'missing.jsx' }, sandbox)).toBeNull();
        const r = await readScopedFile({ kind: 'file', filePath: 'big.jsx' }, sandbox);
        expect(r.content).toHaveLength(SCOPED_FILE_CHAR_CAP);
        expect(r.truncated).toBe(true);
    });

    it('adds the companion data file, artboard size, and selected variant', async () => {
        const src = 'export const meta = { dimensions: { width: 1080, height: 1920 } };';
        const sandbox = makeSandbox({
            '.lerret/store/hero.jsx': src,
            '.lerret/store/hero.data.json': '{ "headline": "Hi" }',
        });
        const r = await readScopedFile({ kind: 'file', filePath: 'store/hero.jsx', variant: 'Dark' }, sandbox);
        expect(r).toMatchObject({
            truncated: false,
            dimensions: { width: 1080, height: 1920 },
            variant: 'Dark',
            data: { path: '.lerret/store/hero.data.json', content: '{ "headline": "Hi" }' },
        });
        const text = describeScopedFile(r);
        expect(text).toContain('Artboard size: 1080×1920px.');
        expect(text).toContain('"Dark" variant');
        expect(text).toContain('--- .lerret/store/hero.data.json (current content) ---');
    });

    it('has no data context when the asset has no data file', async () => {
        const sandbox = makeSandbox({ '.lerret/a.jsx': 'A' });
        const r = await readScopedFile({ kind: 'file', filePath: 'a.jsx' }, sandbox);
        expect(r.data).toBeNull();
        expect(r.dimensions).toBeNull();
        expect(describeScopedFile(r)).toBe('');
    });

    it('decodes binary reads to text', async () => {
        const sandbox = makeSandbox({ '.lerret/a.jsx': new TextEncoder().encode('BYTES') });
        const r = await readScopedFile({ kind: 'file', filePath: 'a.jsx' }, sandbox);
        expect(r.content).toBe('BYTES');
    });

    it('reads an ABSOLUTE chip path via the normalized .lerret/ candidate (CLI runtime shape)', async () => {
        const sandbox = makeSandbox({ '.lerret/kit/banner.jsx': 'BANNER' });
        const r = await readScopedFile(
            { kind: 'file', filePath: '/private/tmp/proj/.lerret/kit/banner.jsx' },
            sandbox,
        );
        expect(r).toMatchObject({ path: '.lerret/kit/banner.jsx', content: 'BANNER' });
    });
});

describe('toProjectRelativeLerretPath', () => {
    it('strips everything through /.lerret/ from absolute CLI-runtime paths', () => {
        expect(toProjectRelativeLerretPath('/private/tmp/proj/.lerret/kit/banner.jsx')).toBe(
            'kit/banner.jsx',
        );
    });

    it('strips a bare .lerret/ prefix and passes project-relative paths through', () => {
        expect(toProjectRelativeLerretPath('.lerret/kit/banner.jsx')).toBe('kit/banner.jsx');
        expect(toProjectRelativeLerretPath('kit/banner.jsx')).toBe('kit/banner.jsx');
    });

    it('returns undefined for non-strings and empty strings', () => {
        expect(toProjectRelativeLerretPath(undefined)).toBeUndefined();
        expect(toProjectRelativeLerretPath('')).toBeUndefined();
        expect(toProjectRelativeLerretPath(42)).toBeUndefined();
    });
});

describe('elementPinpoint', () => {
    it('returns empty without a usable element', () => {
        expect(elementPinpoint(undefined)).toBe('');
        expect(elementPinpoint({ kind: 'file' })).toBe('');
        expect(elementPinpoint({ element: { text: '   ' } })).toBe('');
    });

    it('names the clicked element with tag and truncated text', () => {
        const s = elementPinpoint({ element: { text: '$79', tag: 'span' } });
        expect(s).toContain('<span> element containing "$79"');
        const long = elementPinpoint({ element: { text: 'y'.repeat(120) } });
        expect(long).toContain(`"${'y'.repeat(80)}"`);
    });
});

describe('selectionWritePaths', () => {
    it('allows the selected asset and its data files only', () => {
        const paths = selectionWritePaths({ kind: 'file', filePath: '/abs/proj/.lerret/store/hero.jsx' });
        expect([...paths]).toEqual([
            '.lerret/store/hero.jsx',
            '.lerret/store/hero.data.json',
            '.lerret/store/hero.data.js',
        ]);
    });

    it('is null (unrestricted) without a single-file selection', () => {
        expect(selectionWritePaths({ kind: 'page', label: 'kit page' })).toBeNull();
        expect(selectionWritePaths(undefined)).toBeNull();
    });
});
