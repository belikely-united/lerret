// Tests for the studio-side data loader (`data-loader.js`).
//
// This suite drives the studio's `resolveAssetData` and `resolveAllAssetData`
// functions with injectable `importModule` overrides — no live Vite server
// required.
//
// Coverage (, studio-side ACs):
// - source='json' → value passes through unchanged.
// - source='js' → dynamic import called, default export returned.
// - source='js' → default export absent; module namespace returned.
// - source='js' → import rejects; absent + warning, isolated.
// - source='absent' → value is undefined, no import called.
// - reloadToken appended to URL for cache-busting.
// - resolveAllAssetData resolves whole map in parallel.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { resolveAssetData, resolveAllAssetData } from './data-loader.js';

// ---------------------------------------------------------------------------
// Spy on console.warn
// ---------------------------------------------------------------------------

let warnSpy;
beforeEach(() => {
 warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
 warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** @type {import('@lerret/core/src/data/loader.js').AssetData} */
const jsonRecord = {
 source: 'json',
 value: { label: 'Click me', count: 42 },
 dataPath: '/proj/.lerret/home/Button.data.json',
};

/** @type {import('@lerret/core/src/data/loader.js').AssetData} */
const jsRecord = {
 source: 'js',
 value: undefined,
 dataPath: '/proj/.lerret/home/Button.data.js',
};

/** @type {import('@lerret/core/src/data/loader.js').AssetData} */
const absentRecord = { source: 'absent' };

// ---------------------------------------------------------------------------
// resolveAssetData
// ---------------------------------------------------------------------------

describe('resolveAssetData', () => {
 // ── JSON source ──────────────────────────────────────────────────────────
 describe("source='json'", () => {
 it('returns the pre-parsed value without calling importModule', async () => {
 const importModule = vi.fn();
 const result = await resolveAssetData(jsonRecord, { importModule });

 expect(result.value).toEqual({ label: 'Click me', count: 42 });
 expect(importModule).not.toHaveBeenCalled();
 });
 });

 // ── JS source — happy path ───────────────────────────────────────────────
 describe("source='js' — module loads successfully", () => {
 it('calls importModule with the dataPath and returns the default export', async () => {
 const importModule = vi.fn().mockResolvedValue({ default: { dynamic: true } });
 const result = await resolveAssetData(jsRecord, { importModule });

 expect(importModule).toHaveBeenCalledOnce();
 expect(importModule.mock.calls[0][0]).toContain('Button.data.js');
 expect(result.value).toEqual({ dynamic: true });
 });

 it('returns the module namespace when there is no default export', async () => {
 const ns = { foo: 'bar' }; // no `default` key
 const importModule = vi.fn().mockResolvedValue(ns);
 const result = await resolveAssetData(jsRecord, { importModule });

 expect(result.value).toBe(ns);
 });

 it('appends ?t=<token> when reloadToken is provided', async () => {
 const importModule = vi.fn().mockResolvedValue({ default: {} });
 await resolveAssetData(jsRecord, { importModule, reloadToken: 7 });

 const url = importModule.mock.calls[0][0];
 expect(url).toContain('?t=7');
 });

 it('does NOT append a query when reloadToken is absent', async () => {
 const importModule = vi.fn().mockResolvedValue({ default: {} });
 await resolveAssetData(jsRecord, { importModule });

 const url = importModule.mock.calls[0][0];
 expect(url).not.toContain('?t=');
 });
 });

 // ── JS source — import rejects ───────────────────────────────────────────
 describe("source='js' — import rejects", () => {
 it('returns { value: undefined } and emits a console.warn', async () => {
 const importModule = vi.fn().mockRejectedValue(new Error('Module not found'));
 const result = await resolveAssetData(jsRecord, { importModule });

 expect(result.value).toBeUndefined();
 expect(warnSpy).toHaveBeenCalledOnce();
 const msg = warnSpy.mock.calls[0][0];
 expect(msg).toContain('Button.data.js');
 });

 it('never rejects — always resolves even on import failure', async () => {
 const importModule = vi.fn().mockRejectedValue(new Error('syntax error'));
 await expect(resolveAssetData(jsRecord, { importModule })).resolves.toBeDefined();
 });
 });

 // ── Absent source ────────────────────────────────────────────────────────
 describe("source='absent'", () => {
 it('returns { value: undefined } without calling importModule', async () => {
 const importModule = vi.fn();
 const result = await resolveAssetData(absentRecord, { importModule });

 expect(result.value).toBeUndefined();
 expect(importModule).not.toHaveBeenCalled();
 });

 it('returns { value: undefined } when assetData is null/undefined', async () => {
 const result = await resolveAssetData(null, {});
 expect(result.value).toBeUndefined();
 });
 });
});

// ---------------------------------------------------------------------------
// resolveAllAssetData
// ---------------------------------------------------------------------------

describe('resolveAllAssetData', () => {
 it('resolves every entry in the map', async () => {
 const pathJson = '/proj/.lerret/home/Alpha.jsx';
 const pathJs = '/proj/.lerret/home/Beta.jsx';
 const pathAbsent = '/proj/.lerret/home/Gamma.jsx';

 const map = new Map([
 [pathJson, jsonRecord],
 [pathJs, jsRecord],
 [pathAbsent, absentRecord],
 ]);

 const importModule = vi.fn().mockResolvedValue({ default: { dyn: true } });
 const result = await resolveAllAssetData(map, { importModule });

 expect(result.size).toBe(3);
 expect(result.get(pathJson)).toEqual({ label: 'Click me', count: 42 });
 expect(result.get(pathJs)).toEqual({ dyn: true });
 expect(result.get(pathAbsent)).toBeUndefined();
 });

 it('returns an empty map when given a non-Map', async () => {
 const result = await resolveAllAssetData(null, {});
 expect(result.size).toBe(0);
 });

 it('isolates a failing .data.js — other assets still resolve', async () => {
 const pathGood = '/a.jsx';
 const pathBad = '/b.jsx';

 const map = new Map([
 [pathGood, { source: 'json', value: { ok: true } }],
 [pathBad, { source: 'js', dataPath: '/b.data.js' }],
 ]);

 const importModule = vi.fn().mockRejectedValue(new Error('boom'));
 const result = await resolveAllAssetData(map, { importModule });

 expect(result.get(pathGood)).toEqual({ ok: true });
 expect(result.get(pathBad)).toBeUndefined();
 });
});
