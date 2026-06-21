// Tests for `artboard-kebab.jsx` — the `fetchDataValue` helper plus the
// `ComponentArtboardKebab` data-resolution + live-reload behavior.
//
// Regression coverage for the 2026-05-22 fix that moved `.data.json` loading
// from `fetch()` to dynamic `import()`. Background: Vite's `resolve.alias`
// (declared by `vite-plugin-lerret-project.js` for `/@lerret-project` and by
// the standalone fixture wiring for `/@fixture-lerret`) is honored by module
// imports but NOT by raw HTTP fetches. The previous `fetch()`-based
// implementation silently fell through to the studio's SPA index.html (200
// text/html) on every CLI dev run, so Tier-1 data was never applied. The fix
// uses `import()` so the alias takes effect; these tests pin that contract.
//
// The `.data.js`-precedence suite (and the `ComponentArtboardKebab` block at
// the bottom) cover the 2026-06-19 fix: the canvas previously loaded only
// `<Name>.data.json` and silently ignored `<Name>.data.js`, contradicting
// core's documented `.data.js`-wins precedence (FR22,
// `core/src/data/loader.js`). The fix builds BOTH candidate paths, tries
// `.data.js` first, and subscribes whichever variant actually resolved to the
// CLI live-reload event.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Opt into React's act() environment so async state updates flushed inside
// `act(async () => …)` don't log the "not configured to support act(...)"
// warning. Matches the convention used across `src/ai/*.test.jsx`.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the CLI live-reload bridge so a test can capture the registered
// `onLerretChange` subscriber and fire a synthetic `lerret:change` payload —
// standing in for the chokidar watcher reporting a `.data.js` / `.data.json`
// edit. Each `onLerretChange` call pushes its handler; `emitLerretChange`
// fans a payload out to all live handlers, exactly like the real bridge.
const lerretChangeHandlers = new Set();
function emitLerretChange(payload) {
 for (const handler of Array.from(lerretChangeHandlers)) handler(payload);
}
vi.mock('../../runtime/cli-hmr.js', () => ({
 onLerretChange: (handler) => {
 lerretChangeHandlers.add(handler);
 return () => lerretChangeHandlers.delete(handler);
 },
}));

import { fetchDataValue, liveRefreshIntervalFor, ComponentArtboardKebab } from './artboard-kebab.jsx';

describe('fetchDataValue', () => {
 it('uses dynamic import against the /@lerret-project base for a .lerret/-rooted path', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 return { default: { headline: 'Designs are just files.' } };
 });

 const { value, resolvedPath } = await fetchDataValue(
 '/abs/proj/.lerret/samples/landing-hero.data.json',
 { importModule },
 );

 expect(value).toEqual({ headline: 'Designs are just files.' });
 expect(resolvedPath).toBe('/abs/proj/.lerret/samples/landing-hero.data.json');
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

 const { value } = await fetchDataValue(
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
 const { value, resolvedPath } = await fetchDataValue(
 '/abs/proj/.lerret/samples/landing-hero.data.json',
 { importModule },
 );
 expect(value).toEqual({});
 expect(resolvedPath).toBeNull();
 expect(importModule).toHaveBeenCalledTimes(2);
 });

 it('handles modules that expose the value at the top level (no .default)', async () => {
 const importModule = vi.fn(async () => ({ headline: 'Top-level value' }));
 const { value } = await fetchDataValue(
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
 const { value } = await fetchDataValue(
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
 const { value } = await fetchDataValue('relative/data.json', { importModule });
 expect(value).toEqual({ ok: true });
 expect(urls[0]).toMatch(/^\/@lerret-project\/relative\/data\.json\?t=\d+$/);
 });

 // ── `.data.js` precedence (FR22) ───────────────────────────────────────────
 // The candidate list is `[<Name>.data.js, <Name>.data.json]`; the first that
 // loads to an object wins. The studio can't stat the filesystem, so the
 // 404-on-import of a missing higher-precedence file is what drives fallback.
 describe('.data.js precedence', () => {
 const jsPath = '/abs/proj/.lerret/samples/landing-hero.data.js';
 const jsonPath = '/abs/proj/.lerret/samples/landing-hero.data.json';

 it('resolves a `.data.js` candidate and reports it as the resolvedPath', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 return { default: { headline: 'From a JS module' } };
 });

 const { value, resolvedPath } = await fetchDataValue([jsPath, jsonPath], { importModule });

 expect(value).toEqual({ headline: 'From a JS module' });
 expect(resolvedPath).toBe(jsPath);
 // The very first import attempted is the `.data.js` candidate.
 expect(urls[0]).toMatch(/^\/@lerret-project\/samples\/landing-hero\.data\.js\?t=\d+$/);
 });

 it('lets `.data.js` win over `.data.json` when both could load', async () => {
 // Both files "exist": every import resolves. The loader must stop at the
 // FIRST candidate (`.data.js`) and never even attempt the `.data.json`.
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 if (url.includes('.data.js?')) return { default: { from: 'js' } };
 return { default: { from: 'json' } };
 });

 const { value, resolvedPath } = await fetchDataValue([jsPath, jsonPath], { importModule });

 expect(value).toEqual({ from: 'js' });
 expect(resolvedPath).toBe(jsPath);
 // Only the `.data.js` candidate was ever imported — the `.data.json` URL
 // never appears, proving precedence short-circuits.
 expect(urls.every((u) => u.includes('.data.js?'))).toBe(true);
 expect(urls.some((u) => u.includes('.data.json?'))).toBe(false);
 });

 it('falls back to `.data.json` when no `.data.js` exists (both bases 404)', async () => {
 const urls = [];
 const importModule = vi.fn(async (url) => {
 urls.push(url);
 if (url.includes('.data.js?')) throw new Error('404'); // no .data.js anywhere
 return { default: { from: 'json' } };
 });

 const { value, resolvedPath } = await fetchDataValue([jsPath, jsonPath], { importModule });

 expect(value).toEqual({ from: 'json' });
 expect(resolvedPath).toBe(jsonPath);
 // Tried both bases for `.data.js` (2 rejects), then the `.data.json`.
 expect(urls.filter((u) => u.includes('.data.js?'))).toHaveLength(2);
 expect(urls.some((u) => u.includes('.data.json?'))).toBe(true);
 });

 it('does NOT fall through to `.data.json` when `.data.js` loads a non-object', async () => {
 // A present-but-malformed `.data.js` (primitive default) must not silently
 // hand control to a stale `.data.json`. resolvedPath is still the `.data.js`
 // (it is the file that exists); value degrades to {}.
 const importModule = vi.fn(async (url) => {
 if (url.includes('.data.js?')) return { default: 42 };
 return { default: { from: 'json' } };
 });

 const { value, resolvedPath } = await fetchDataValue([jsPath, jsonPath], { importModule });

 expect(value).toEqual({});
 expect(resolvedPath).toBe(jsPath);
 });

 it('accepts a `.data.js` module that exposes data at the top level (no .default)', async () => {
 const importModule = vi.fn(async (url) => {
 if (url.includes('.data.js?')) return { headline: 'top-level js data' };
 throw new Error('404');
 });

 const { value, resolvedPath } = await fetchDataValue([jsPath, jsonPath], { importModule });

 expect(value).toEqual({ headline: 'top-level js data' });
 expect(resolvedPath).toBe(jsPath);
 });
 });

 it('prefers the hosted data reader (FSA backend) over the dynamic import in hosted mode', async () => {
 const importModule = vi.fn(); // must NOT be reached when a hosted reader is set
 const reader = async (p) => (p.endsWith('.data.json') ? { headline: 'from FSA' } : null);
 const { value, resolvedPath } = await fetchDataValue(
 ['/p/.lerret/social/A.data.js', '/p/.lerret/social/A.data.json'],
 { hostedDataReader: reader, importModule },
 );
 expect(value).toEqual({ headline: 'from FSA' });
 expect(resolvedPath).toBe('/p/.lerret/social/A.data.json');
 expect(importModule).not.toHaveBeenCalled();
 });

 it('forwards the autoRefresh `bust` nonce to the hosted reader (so live data re-resolves)', async () => {
 const calls = [];
 const reader = async (p, opts) => {
 calls.push([p, opts]);
 return p.endsWith('.data.js') ? { tick: opts && opts.bust } : null;
 };
 const { value } = await fetchDataValue(
 ['/p/.lerret/live/Ticker.data.js'],
 { hostedDataReader: reader, bust: 7 },
 );
 // The reader received the candidate AND the bust; the value reflects the tick.
 expect(calls[0]).toEqual(['/p/.lerret/live/Ticker.data.js', { bust: 7 }]);
 expect(value).toEqual({ tick: 7 });
 });
});

// B.S regression — `liveRefreshIntervalFor` must gate on assetKind. A stale
// `autoRefresh` on a markdown asset's config would otherwise enable the ANIM
// export button on a card that can never animate (the live-refresh-manager
// only registers timers for component assets).
//
// Per ADR-003, the interval is read from the asset's own `Name.config.json`,
// surfaced per asset-path via the `getAssetConfig` accessor — no folder lookup,
// no name-matching.
describe('liveRefreshIntervalFor — assetKind gating', () => {
 // A `getAssetConfig` stub that returns `cfg` for `path` and `{}` otherwise.
 const configFor = (path, cfg) => (assetPath) => (assetPath === path ? cfg : {});

 it('returns the interval for a COMPONENT entry whose config sets autoRefresh', () => {
 const entry = {
 assetKind: 'component',
 asset: { name: 'clock', path: '/proj/.lerret/live/clock.jsx' },
 };
 const getAssetConfig = configFor('/proj/.lerret/live/clock.jsx', { autoRefresh: 1000 });
 const result = liveRefreshIntervalFor(entry, getAssetConfig);
 expect(result).toBe(1000);
 });

 it('returns undefined for a MARKDOWN entry even when its config sets autoRefresh', () => {
 const entry = {
 assetKind: 'markdown',
 asset: { name: 'about-live-refresh', path: '/proj/.lerret/live/about-live-refresh.md' },
 };
 const getAssetConfig = configFor('/proj/.lerret/live/about-live-refresh.md', { autoRefresh: 1000 });
 const result = liveRefreshIntervalFor(entry, getAssetConfig);
 expect(result).toBeUndefined();
 });

 it('returns undefined for a COMPONENT entry whose config has no autoRefresh', () => {
 const entry = {
 assetKind: 'component',
 asset: { name: 'broken', path: '/proj/.lerret/live/broken.jsx' },
 status: 'error',
 };
 // Asset has no config (empty `{}`) → undefined.
 const result = liveRefreshIntervalFor(entry, () => ({}));
 expect(result).toBeUndefined();
 });
});

// ── ComponentArtboardKebab — `.data.js` resolution + live reload ─────────────
//
// End-to-end (component-level) coverage of the 2026-06-19 fix. These render the
// real `ComponentArtboardKebab` with a fake `importModule` (the test-only seam)
// and a fake `renderComponent` that stamps the resolved `headline` prop into the
// DOM, then assert on what the component rendered. The mocked `cli-hmr.js`
// (top of file) lets us fire a synthetic `lerret:change` to prove a data edit
// re-renders the canvas.
describe('ComponentArtboardKebab — data resolution', () => {
 // Build the runtime AssetEntry for a component at /proj/.lerret/home/Hero.jsx.
 // No propsSchema → a plain-object data value is passed through verbatim as
 // props (see resolveProps tier-1 / resolveVariantData shared mode).
 const makeEntry = () => ({
 id: '/proj/.lerret/home/Hero.jsx',
 assetKind: 'component',
 variantName: 'default',
 asset: { kind: 'asset', name: 'Hero', fileName: 'Hero.jsx', path: '/proj/.lerret/home/Hero.jsx' },
 meta: {},
 Component: () => null,
 status: 'ok',
 });

 // A render-prop that records the LAST resolved props it was called with and
 // renders the `headline` prop so the test can read it back from the DOM.
 function makeRenderComponent() {
 const calls = [];
 const renderComponent = (props) => {
 calls.push(props);
 return <div data-testid="hero-headline">{String(props.headline ?? '∅')}</div>;
 };
 renderComponent.calls = calls;
 return renderComponent;
 }

 let container;
 let root;

 beforeEach(() => {
 lerretChangeHandlers.clear();
 container = document.createElement('div');
 document.body.appendChild(container);
 root = createRoot(container);
 });

 afterEach(() => {
 act(() => root.unmount());
 container.remove();
 lerretChangeHandlers.clear();
 });

 const headline = () => container.querySelector('[data-testid="hero-headline"]').textContent;

 // Flush the post-mount async data fetch (a microtask chain inside the effect).
 async function flush() {
 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });
 }

 it('resolves a `.data.js` companion and renders its data as props', async () => {
 // Only `.data.js` exists — `.data.json` import rejects (404).
 const importModule = vi.fn(async (url) => {
 if (url.includes('Hero.data.js?')) return { default: { headline: 'From JS module' } };
 throw new Error('404');
 });
 const renderComponent = makeRenderComponent();

 await act(async () => {
 root.render(
 <ComponentArtboardKebab
 entry={makeEntry()}
 renderComponent={renderComponent}
 importModule={importModule}
 />,
 );
 });
 await flush();

 expect(headline()).toBe('From JS module');
 // The first URL attempted is the `.data.js` candidate (precedence).
 expect(importModule.mock.calls[0][0]).toMatch(/Hero\.data\.js\?t=\d+$/);
 });

 it('lets `.data.js` take precedence over `.data.json` when both exist', async () => {
 // BOTH files resolve. The component must render the `.data.js` value and
 // never import the `.data.json`.
 const importModule = vi.fn(async (url) => {
 if (url.includes('Hero.data.js?')) return { default: { headline: 'JS wins' } };
 return { default: { headline: 'JSON loses' } };
 });
 const renderComponent = makeRenderComponent();

 await act(async () => {
 root.render(
 <ComponentArtboardKebab
 entry={makeEntry()}
 renderComponent={renderComponent}
 importModule={importModule}
 />,
 );
 });
 await flush();

 expect(headline()).toBe('JS wins');
 const importedUrls = importModule.mock.calls.map((c) => c[0]);
 expect(importedUrls.some((u) => u.includes('Hero.data.json?'))).toBe(false);
 });

 it('falls back to `.data.json` when there is no `.data.js`', async () => {
 const importModule = vi.fn(async (url) => {
 if (url.includes('Hero.data.js?')) throw new Error('404');
 return { default: { headline: 'JSON fallback' } };
 });
 const renderComponent = makeRenderComponent();

 await act(async () => {
 root.render(
 <ComponentArtboardKebab
 entry={makeEntry()}
 renderComponent={renderComponent}
 importModule={importModule}
 />,
 );
 });
 await flush();

 expect(headline()).toBe('JSON fallback');
 });

 it('re-renders when the resolved `.data.js` is edited (live reload)', async () => {
 // First load returns v1; after the edit, the SAME `.data.js` URL returns v2.
 let jsVersion = { headline: 'JS v1' };
 const importModule = vi.fn(async (url) => {
 if (url.includes('Hero.data.js?')) return { default: jsVersion };
 throw new Error('404');
 });
 const renderComponent = makeRenderComponent();

 await act(async () => {
 root.render(
 <ComponentArtboardKebab
 entry={makeEntry()}
 renderComponent={renderComponent}
 importModule={importModule}
 />,
 );
 });
 await flush();
 expect(headline()).toBe('JS v1');

 // Simulate the user editing Hero.data.js: the watcher emits lerret:change
 // for that path, the subscription re-fetches, and the canvas updates.
 jsVersion = { headline: 'JS v2' };
 await act(async () => {
 emitLerretChange({ event: { type: 'change', path: '/proj/.lerret/home/Hero.data.js' } });
 });
 await flush();

 expect(headline()).toBe('JS v2');
 });

 it('ignores a `lerret:change` for an unrelated file (no spurious re-fetch)', async () => {
 const importModule = vi.fn(async (url) => {
 if (url.includes('Hero.data.js?')) return { default: { headline: 'JS only' } };
 throw new Error('404');
 });
 const renderComponent = makeRenderComponent();

 await act(async () => {
 root.render(
 <ComponentArtboardKebab
 entry={makeEntry()}
 renderComponent={renderComponent}
 importModule={importModule}
 />,
 );
 });
 await flush();
 const callsAfterMount = importModule.mock.calls.length;

 await act(async () => {
 emitLerretChange({ event: { type: 'change', path: '/proj/.lerret/home/Other.data.js' } });
 });
 await flush();

 // No additional imports were attempted for the unrelated path.
 expect(importModule.mock.calls.length).toBe(callsAfterMount);
 });
});
