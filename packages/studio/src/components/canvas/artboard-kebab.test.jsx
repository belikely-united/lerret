// Tests for `artboard-kebab.jsx` — narrowly, the `fetchDataValue` helper.
//
// Regression coverage for the 2026-05-22 fix that moved `.data.json` loading
// from `fetch()` to dynamic `import()`. Background: Vite's `resolve.alias`
// (declared by `vite-plugin-lerret-project.js` for `/@lerret-project` and by
// the standalone fixture wiring for `/@fixture-lerret`) is honored by module
// imports but NOT by raw HTTP fetches. The previous `fetch()`-based
// implementation silently fell through to the studio's SPA index.html (200
// text/html) on every CLI dev run, so Tier-1 data was never applied. The fix
// uses `import()` so the alias takes effect; these tests pin that contract.

import { describe, expect, it, vi } from 'vitest';

import { fetchDataValue } from './artboard-kebab.jsx';

describe('fetchDataValue', () => {
 it('uses dynamic import against the /@lerret-project base for a .lerret/-rooted path', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 return { default: { headline: 'Designs are just files.' } };
 });

 const value = await fetchDataValue(
 '/abs/proj/.lerret/samples/landing-hero.data.json',
 { importModule },
 );

 expect(value).toEqual({ headline: 'Designs are just files.' });
 expect(urls).toHaveLength(1);
 expect(urls[0]).toMatch(/^\/@lerret-project\/samples\/landing-hero\.data\.json\?t=\d+$/);
 });

 it('falls back to /@fixture-lerret when the project base rejects', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 if (url.startsWith('/@lerret-project')) {
 throw new Error('404');
 }
 return { default: { headline: 'Fixture data' } };
 });

 const value = await fetchDataValue(
 '/abs/proj/.lerret/samples/landing-hero.data.json',
 { importModule },
 );

 expect(value).toEqual({ headline: 'Fixture data' });
 expect(urls).toHaveLength(2);
 expect(urls[0]).toMatch(/^\/@lerret-project\//);
 expect(urls[1]).toMatch(/^\/@fixture-lerret\//);
 });

 it('returns {} when both bases reject (no data file anywhere)', async () => {
 const importModule = vi.fn(async () => { throw new Error('404'); });
 const value = await fetchDataValue(
 '/abs/proj/.lerret/samples/landing-hero.data.json',
 { importModule },
 );
 expect(value).toEqual({});
 expect(importModule).toHaveBeenCalledTimes(2);
 });

 it('handles modules that expose the value at the top level (no .default)', async () => {
 const importModule = vi.fn(async () => ({ headline: 'Top-level value' }));
 const value = await fetchDataValue(
 '/abs/proj/.lerret/samples/x.data.json',
 { importModule },
 );
 // Treats the module object itself as the value when there is no `default`
 // key. Defensive — Vite always emits `.default` for JSON, but other
 // bundlers may not.
 expect(value).toEqual({ headline: 'Top-level value' });
 });

 it('returns {} when the imported value is not an object (e.g. number, null)', async () => {
 // Defensive: a malformed module could resolve to a primitive. The caller
 // expects an object, so fall back to {}.
 const importModule = vi.fn(async () => ({ default: 42 }));
 const value = await fetchDataValue(
 '/abs/proj/.lerret/samples/x.data.json',
 { importModule },
 );
 expect(value).toEqual({});
 });

 it('handles a path with no /.lerret/ marker by using the path as-is', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 return { default: { ok: true } };
 });
 const value = await fetchDataValue('relative/data.json', { importModule });
 expect(value).toEqual({ ok: true });
 expect(urls[0]).toMatch(/^\/@lerret-project\/relative\/data\.json\?t=\d+$/);
 });
});
