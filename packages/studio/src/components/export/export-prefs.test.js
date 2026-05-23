// export-prefs.test.js — per-asset memory of the animated-export settings.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadExportPrefs, saveExportPrefs, sanitizeSettings } from './export-prefs.js';

beforeEach(() => {
    localStorage.clear();
});
afterEach(() => {
    localStorage.clear();
});

describe('sanitizeSettings', () => {
    it('fills defaults for an empty/garbage object', () => {
        expect(sanitizeSettings(null)).toEqual({
            durationMs: 3000,
            fps: 24,
            format: 'webp',
            scale: 1,
            loop: 'infinite',
        });
        expect(sanitizeSettings({ junk: true })).toEqual({
            durationMs: 3000,
            fps: 24,
            format: 'webp',
            scale: 1,
            loop: 'infinite',
        });
    });

    it('clamps duration and fps to the dialog bounds', () => {
        expect(sanitizeSettings({ durationMs: 999999 }).durationMs).toBe(60000);
        expect(sanitizeSettings({ durationMs: 1 }).durationMs).toBe(100);
        expect(sanitizeSettings({ fps: 999 }).fps).toBe(60);
        expect(sanitizeSettings({ fps: 0 }).fps).toBe(1);
    });

    it('rejects unknown format / loop, keeps valid ones', () => {
        expect(sanitizeSettings({ format: 'tiff' }).format).toBe('webp');
        expect(sanitizeSettings({ format: 'mp4' }).format).toBe('mp4');
        expect(sanitizeSettings({ loop: 'weird' }).loop).toBe('infinite');
        expect(sanitizeSettings({ loop: 'once' }).loop).toBe('once');
        expect(sanitizeSettings({ loop: 3 }).loop).toBe(3);
    });

    it('always forces scale to 1× (Scale control was removed)', () => {
        // Even a previously-stored 2×/3× must be neutralized.
        expect(sanitizeSettings({ scale: 2 }).scale).toBe(1);
        expect(sanitizeSettings({ scale: 3 }).scale).toBe(1);
        expect(sanitizeSettings({}).scale).toBe(1);
    });
});

describe('load/save round-trip', () => {
    const KEY = '/proj/.lerret/live/clock.jsx';

    it('returns sanitized defaults when nothing is stored', () => {
        expect(loadExportPrefs(KEY)).toEqual({
            durationMs: 3000,
            fps: 24,
            format: 'webp',
            scale: 1,
            loop: 'infinite',
        });
    });

    it('remembers settings per asset (scale always normalizes to 1×)', () => {
        saveExportPrefs(KEY, { durationMs: 5000, fps: 30, format: 'mp4', scale: 2, loop: 'once', filename: 'IGNORED.mp4' });
        const loaded = loadExportPrefs(KEY);
        expect(loaded).toEqual({ durationMs: 5000, fps: 30, format: 'mp4', scale: 1, loop: 'once' });
        // filename is NOT persisted (derived from asset name at open time).
        expect('filename' in loaded).toBe(false);
    });

    it('per-asset entry takes precedence over the global fallback', () => {
        saveExportPrefs('/other.jsx', { durationMs: 1000, fps: 10, format: 'gif', scale: 1, loop: 'infinite' });
        saveExportPrefs(KEY, { durationMs: 7000, fps: 60, format: 'apng', scale: 3, loop: 'infinite' });
        expect(loadExportPrefs(KEY).durationMs).toBe(7000);
        expect(loadExportPrefs(KEY).format).toBe('apng');
    });

    it('a never-exported asset inherits the global "last used"', () => {
        // Export asset A → sets the global fallback.
        saveExportPrefs('/a.jsx', { durationMs: 4000, fps: 30, format: 'gif', scale: 2, loop: 'once' });
        // Asset B has no per-asset entry → should read the global fallback.
        const b = loadExportPrefs('/b-never-exported.jsx');
        expect(b).toEqual({ durationMs: 4000, fps: 30, format: 'gif', scale: 1, loop: 'once' });
    });

    it('bulk (null key) reads/writes only the global fallback', () => {
        saveExportPrefs(null, { durationMs: 2000, fps: 15, format: 'webp', scale: 1, loop: 'infinite' });
        expect(loadExportPrefs(null).fps).toBe(15);
        // And a fresh per-asset load falls back to that global value.
        expect(loadExportPrefs('/fresh.jsx').fps).toBe(15);
    });

    it('survives a corrupt stored value (returns defaults)', () => {
        localStorage.setItem('lerret:anim-export:v1:' + KEY, '{ this is not json');
        expect(loadExportPrefs(KEY)).toEqual({
            durationMs: 3000,
            fps: 24,
            format: 'webp',
            scale: 1,
            loop: 'infinite',
        });
    });
});
