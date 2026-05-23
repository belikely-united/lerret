import { describe, it, expect } from 'vitest';
import {
    isFolderExcludedFromExport,
    isArtboardExcludedFromExport,
    partitionByExclusion,
    excludedFolderPaths,
} from './filter-excluded.js';

const makeArtboard = (overrides = {}) => ({
    asset: { path: '/p/asset.jsx', name: 'asset' },
    assetPath: '/p/asset.jsx',
    pagePath: '/p',
    groupPath: null,
    locationPath: '',
    locationSegments: [],
    ...overrides,
});

describe('isFolderExcludedFromExport', () => {
    it('returns false when the folder is not in the cascade map', () => {
        const get = () => undefined;
        expect(isFolderExcludedFromExport('/unknown', get)).toBe(false);
    });

    it('returns false when excludeFromExport is absent', () => {
        const get = (p) => (p === '/page' ? {} : undefined);
        expect(isFolderExcludedFromExport('/page', get)).toBe(false);
    });

    it('returns false when excludeFromExport is explicitly false', () => {
        const get = (p) => (p === '/page' ? { excludeFromExport: false } : undefined);
        expect(isFolderExcludedFromExport('/page', get)).toBe(false);
    });

    it('returns true when excludeFromExport is the literal boolean true', () => {
        const get = (p) => (p === '/page' ? { excludeFromExport: true } : undefined);
        expect(isFolderExcludedFromExport('/page', get)).toBe(true);
    });

    it('returns false for truthy non-boolean values (only literal true excludes)', () => {
        for (const value of [1, 'true', 'yes', {}, [], 'no']) {
            const get = (p) => (p === '/page' ? { excludeFromExport: value } : undefined);
            expect(
                isFolderExcludedFromExport('/page', get),
                `value=${JSON.stringify(value)}`,
            ).toBe(false);
        }
    });
});

describe('isArtboardExcludedFromExport', () => {
    it('checks the most specific containing folder (group if present)', () => {
        const get = (p) => {
            if (p === '/p/g') return { excludeFromExport: true };
            if (p === '/p') return {};
            return undefined;
        };
        const a = makeArtboard({ pagePath: '/p', groupPath: '/p/g' });
        expect(isArtboardExcludedFromExport(a, get)).toBe(true);
    });

    it('falls back to the page when groupPath is null', () => {
        const get = (p) => (p === '/p' ? { excludeFromExport: true } : undefined);
        const a = makeArtboard({ pagePath: '/p', groupPath: null });
        expect(isArtboardExcludedFromExport(a, get)).toBe(true);
    });

    it('respects child-overrides-parent semantics (cascade resolves before the filter sees it)', () => {
        // Cascade has already been computed: the child group's effective config
        // has excludeFromExport: false even though the parent page has true.
        const get = (p) => {
            if (p === '/p/g') return { excludeFromExport: false };
            if (p === '/p') return { excludeFromExport: true };
            return undefined;
        };
        const a = makeArtboard({ pagePath: '/p', groupPath: '/p/g' });
        expect(isArtboardExcludedFromExport(a, get)).toBe(false);
    });
});

describe('partitionByExclusion', () => {
    it('splits artboards into kept and excluded preserving input order', () => {
        const get = (p) => {
            if (p === '/intro') return { excludeFromExport: true };
            return {};
        };
        const artboards = [
            makeArtboard({ assetPath: '/landing/a', pagePath: '/landing' }),
            makeArtboard({ assetPath: '/intro/x', pagePath: '/intro' }),
            makeArtboard({ assetPath: '/social/b', pagePath: '/social' }),
            makeArtboard({ assetPath: '/intro/y', pagePath: '/intro' }),
        ];
        const { kept, excluded } = partitionByExclusion(artboards, get);
        expect(kept.map((a) => a.assetPath)).toEqual(['/landing/a', '/social/b']);
        expect(excluded.map((a) => a.assetPath)).toEqual(['/intro/x', '/intro/y']);
    });

    it('returns everything in kept when nothing is excluded', () => {
        const get = () => ({});
        const artboards = [
            makeArtboard({ assetPath: '/a/1', pagePath: '/a' }),
            makeArtboard({ assetPath: '/b/2', pagePath: '/b' }),
        ];
        const { kept, excluded } = partitionByExclusion(artboards, get);
        expect(kept).toHaveLength(2);
        expect(excluded).toHaveLength(0);
    });

    it('returns everything in excluded when every page is excluded', () => {
        const get = () => ({ excludeFromExport: true });
        const artboards = [
            makeArtboard({ assetPath: '/a/1', pagePath: '/a' }),
            makeArtboard({ assetPath: '/b/2', pagePath: '/b' }),
        ];
        const { kept, excluded } = partitionByExclusion(artboards, get);
        expect(kept).toHaveLength(0);
        expect(excluded).toHaveLength(2);
    });

    it('handles an empty input cleanly', () => {
        const { kept, excluded } = partitionByExclusion([], () => ({}));
        expect(kept).toEqual([]);
        expect(excluded).toEqual([]);
    });
});

describe('excludedFolderPaths', () => {
    it('returns unique containing folder paths in first-seen order', () => {
        const artboards = [
            makeArtboard({ pagePath: '/intro' }),
            makeArtboard({ pagePath: '/intro' }),
            makeArtboard({ pagePath: '/drafts' }),
            makeArtboard({ pagePath: '/intro' }),
        ];
        expect(excludedFolderPaths(artboards)).toEqual(['/intro', '/drafts']);
    });

    it('uses groupPath when present, page otherwise', () => {
        const artboards = [
            makeArtboard({ pagePath: '/p', groupPath: '/p/g' }),
            makeArtboard({ pagePath: '/p', groupPath: null }),
        ];
        expect(excludedFolderPaths(artboards)).toEqual(['/p/g', '/p']);
    });

    it('returns an empty array for an empty input', () => {
        expect(excludedFolderPaths([])).toEqual([]);
    });
});
