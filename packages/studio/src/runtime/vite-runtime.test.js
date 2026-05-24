// Tests for the CLI-mode asset runtime (`vite-runtime.js`) and the shared
// asset-runtime interface (`asset-runtime.js`).
//
// The `vite-runtime` takes an injectable `importModule` (its only real
// dependency is the dynamic `import()`), so this suite drives it with a fake
// importer — no live Vite dev server needed. The fake stands in for "Vite
// transformed the asset file and handed back its ES module", letting us assert
// the runtime's contract: a good module yields an `'ok'` entry, every failure
// mode yields a contained `'error'` entry, and `loadAsset` NEVER rejects.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

import { createAssetNode, createProjectNode } from '@lerret/core';

import {
 createViteRuntime,
 viteRuntimeFactory,
 assetModuleUrl,
} from './vite-runtime.js';
import {
 assetRuntimeStatus,
 AssetErrorBoundary,
 toAssetError,
 makeOkEntry,
 makeVariantEntry,
 makeMarkdownEntry,
 makeErrorEntry,
} from './asset-runtime.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A project model rooted at a synthetic `.lerret/` path. */
const project = createProjectNode({ name: 'demo', path: '/proj/.lerret', pages: [] });

/** Build a component AssetNode at a given page-relative path. */
function componentAsset(relPath) {
 const fileName = relPath.split('/').pop();
 const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
 return createAssetNode({
 name: fileName.slice(0, fileName.lastIndexOf('.')),
 fileName,
 path: `/proj/.lerret/${relPath}`,
 assetKind: 'component',
 ext,
 });
}

/** Build a markdown (`.md`) AssetNode at a given page-relative path. */
function markdownAsset(relPath) {
 const fileName = relPath.split('/').pop();
 return createAssetNode({
 name: fileName.slice(0, fileName.lastIndexOf('.')),
 fileName,
 path: `/proj/.lerret/${relPath}`,
 assetKind: 'markdown',
 ext: '.md',
 });
}

/** A trivial valid React component. */
function Ok() {
 return React.createElement('div', { 'data-ok': true }, 'ok');
}

/**
 * Mount a React element into a detached jsdom container and return the
 * container plus a teardown. Used instead of `@testing-library/react` so the
 * suite adds no new dependency — `react-dom/client` is already a studio dep,
 * and vitest runs in jsdom.
 *
 * @param {React.ReactElement} element
 * @returns {{ container: HTMLElement, cleanup: () => void }}
 */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

// ---------------------------------------------------------------------------
// assetModuleUrl
// ---------------------------------------------------------------------------

describe('assetModuleUrl', () => {
 it('rebases an asset path onto the base URL, relative to the .lerret root', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret')).toBe(
 '/@fixture-lerret/ui/Card.jsx',
 );
 });

 it('tolerates a trailing slash on the base URL', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret/')).toBe(
 '/@fixture-lerret/ui/Card.jsx',
 );
 });

 it('uses the asset path as-is when no base URL is given', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project)).toBe('/proj/.lerret/ui/Card.jsx');
 });

 it('appends a cache-bust query when a reload token is supplied', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret', 7)).toBe(
 '/@fixture-lerret/ui/Card.jsx?t=7',
 );
 });

 it('appends the switch epoch as ?v= when > 0', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret', undefined, 2)).toBe(
 '/@fixture-lerret/ui/Card.jsx?v=2',
 );
 });

 it('omits the epoch query at epoch 0 (boot — keeps URLs cacheable)', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret', undefined, 0)).toBe(
 '/@fixture-lerret/ui/Card.jsx',
 );
 });

 it('combines epoch and reload token (?v= then ?t=)', () => {
 const asset = componentAsset('ui/Card.jsx');
 expect(assetModuleUrl(asset, project, '/@fixture-lerret', 7, 2)).toBe(
 '/@fixture-lerret/ui/Card.jsx?v=2&t=7',
 );
 });
});

// ---------------------------------------------------------------------------
// createViteRuntime — loadAsset
// ---------------------------------------------------------------------------

describe('createViteRuntime — loadAsset', () => {
 it('yields an "ok" entry whose Component is the module default export', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.Component).toBe(Ok);
 expect(entry.error).toBeNull();
 expect(entry.id).toBe(asset.path);
 expect(entry.asset).toBe(asset);
 expect(entry.assetKind).toBe('component');
 expect(entry.label).toBe('Card');
 });

 it('imports the asset from the rebased module URL', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const importModule = vi.fn(async () => ({ default: Ok }));
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/@fixture-lerret',
 importModule,
 });

 await runtime.loadAsset(asset);
 expect(importModule).toHaveBeenCalledWith('/@fixture-lerret/ui/Card.jsx');
 });

 it('surfaces a module-evaluation throw as a contained "error" entry — never rejects', async () => {
 const asset = componentAsset('brand/Broken.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => {
 throw new Error('top-level boom');
 },
 });

 // The promise resolves (does not reject) ...
 const entries = await runtime.loadAsset(asset);
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.ERROR);
 expect(entry.Component).toBeNull();
 expect(entry.error.phase).toBe('evaluate');
 expect(entry.error.message).toContain('top-level boom');
 // ... and the artboard still has a stable id, so it keeps its canvas slot.
 expect(entry.id).toBe(asset.path);
 });

 it('renders a named-only export as a variant when there is no default export', async () => {
 // No default export, but a component-valued named export makes
 // that a variant artboard rather than an error.
 const asset = componentAsset('ui/NoDefault.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ NamedOnly: Ok }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.Component).toBe(Ok);
 expect(entry.variantName).toBe('NamedOnly');
 expect(entry.id).toBe(`${asset.path}#NamedOnly`);
 });

 it('treats a module with no component-valued export as an "error" entry', async () => {
 // A non-component default and no component-valued named export → nothing
 // to render. (`export default {}` is caught here too.)
 const asset = componentAsset('ui/NotAComponent.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: { not: 'a component' }, VERSION: '1.0' }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.ERROR);
 expect(entry.error.phase).toBe('evaluate');
 expect(entry.error.message).toMatch(/exports no react component/i);
 });

 it('does not reject even when the importer throws a non-Error value', async () => {
 const asset = componentAsset('ui/Weird.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => {
 // Throwing a non-Error value — JS allows it; the runtime must cope.
 const bare = 'a bare string';
 throw bare;
 },
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.ERROR);
 expect(entry.error.message).toBe('a bare string');
 });

 it('returns an "error" entry after the runtime is disposed', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok }),
 });
 runtime.dispose();

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.ERROR);
 expect(entry.error.message).toMatch(/disposed/i);
 });
});

// ---------------------------------------------------------------------------
// createViteRuntime — variants & meta
// ---------------------------------------------------------------------------

describe('createViteRuntime — variants', () => {
 const Dark = () => null;
 const Compact = () => null;

 it('yields one entry for a single default export — the primary variant', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 expect(entries[0].variantName).toBe('default');
 expect(entries[0].id).toBe(asset.path); // primary keeps the bare path
 expect(entries[0].label).toBe('Card');
 });

 it('yields one entry per component-valued export — 1..N artboards per file', async () => {
 const asset = componentAsset('ui/Button.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok, Dark, Compact }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(3);
 // The default export leads as the primary variant; its id is the bare path.
 expect(entries[0]).toMatchObject({
 status: assetRuntimeStatus.OK,
 variantName: 'default',
 id: asset.path,
 Component: Ok,
 });
 // Named-export variants get a `#variant` id suffix and a derived label.
 expect(entries[1]).toMatchObject({
 variantName: 'Dark',
 id: `${asset.path}#Dark`,
 Component: Dark,
 label: 'Button · Dark',
 });
 expect(entries[2]).toMatchObject({
 variantName: 'Compact',
 id: `${asset.path}#Compact`,
 Component: Compact,
 });
 });

 it('gives every artboard across a file a unique, stable id', async () => {
 const asset = componentAsset('ui/Button.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok, Dark, Compact }),
 });

 const ids = (await runtime.loadAsset(asset)).map((e) => e.id);
 expect(new Set(ids).size).toBe(ids.length);
 });
});

describe('createViteRuntime — meta export', () => {
 it('populates dimensions, label, tags, and meta from a full meta export', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const propsSchema = { title: { type: 'string' } };
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({
 default: Ok,
 meta: {
 dimensions: { width: 420, height: 280 },
 label: 'Hero card',
 tags: ['hero', 'card'],
 propsSchema,
 },
 }),
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.dimensions).toEqual({ width: 420, height: 280 });
 expect(entry.label).toBe('Hero card'); // meta.label wins over the file name
 expect(entry.tags).toEqual(['hero', 'card']);
 expect(entry.meta.propsSchema).toBe(propsSchema); // carried, not validated
 expect(entry.meta.hasMeta).toBe(true);
 });

 it('shares one parsed meta across every variant of the same file', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const Dark = () => null;
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({
 default: Ok,
 Dark,
 meta: { dimensions: { width: 360, height: 240 }, tags: ['ui'] },
 }),
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(2);
 for (const entry of entries) {
 expect(entry.dimensions).toEqual({ width: 360, height: 240 });
 expect(entry.tags).toEqual(['ui']);
 }
 // The named variant's label still falls back to a derived name (no label
 // in meta) — `meta.label` absent does not error.
 expect(entries[1].label).toBe('Card · Dark');
 });

 it('renders on sensible defaults when there is no meta export (NFR8)', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: Ok }), // no `meta`
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.OK); // never an error
 expect(entry.dimensions).toEqual({ width: undefined, height: undefined });
 expect(entry.label).toBe('Card'); // falls back to the asset name
 expect(entry.tags).toEqual([]);
 expect(entry.meta.hasMeta).toBe(false);
 });

 it('renders on defaults for a partial meta — missing fields are not errors', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 // Only `dimensions` — no label, no tags, no propsSchema.
 importModule: async () => ({ default: Ok, meta: { dimensions: { width: 500 } } }),
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.dimensions).toEqual({ width: 500, height: undefined });
 expect(entry.label).toBe('Card');
 expect(entry.tags).toEqual([]);
 });

 it('contains a malformed meta — the asset still renders, with a meta.error', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 // `meta` is a string — malformed. It must not break the asset.
 importModule: async () => ({ default: Ok, meta: 'not an object' }),
 });

 const [entry] = await runtime.loadAsset(asset);
 // The asset still loads OK — a malformed `meta` is contained, not fatal.
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.Component).toBe(Ok);
 expect(entry.meta.hasMeta).toBe(false);
 expect(entry.meta.error).toMatch(/must be an object/i);
 // ... and the entry still has usable defaults.
 expect(entry.dimensions).toEqual({ width: undefined, height: undefined });
 });

 it('one asset with a malformed meta does not affect a sibling asset', async () => {
 const bad = componentAsset('ui/Bad.jsx');
 const good = componentAsset('ui/Good.jsx');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async (url) =>
 url.includes('Bad')
 ? { default: Ok, meta: 42 } // malformed meta
 : { default: Ok, meta: { label: 'Good one' } }, // healthy
 });

 const [badEntry] = await runtime.loadAsset(bad);
 const [goodEntry] = await runtime.loadAsset(good);
 expect(badEntry.status).toBe(assetRuntimeStatus.OK);
 expect(badEntry.meta.error).toBeTruthy();
 // The sibling is entirely unaffected.
 expect(goodEntry.status).toBe(assetRuntimeStatus.OK);
 expect(goodEntry.meta.error).toBeNull();
 expect(goodEntry.label).toBe('Good one');
 });
});

// ---------------------------------------------------------------------------
// createViteRuntime — markdown assets
// ---------------------------------------------------------------------------

describe('createViteRuntime — markdown assets', () => {
 it('loads a .md asset as a single "ok" markdown entry that renders its text', () => {
 const asset = markdownAsset('docs/Notes.md');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 // A `?raw` import resolves to a module whose default export is the text.
 importModule: async () => ({ default: '# Hello\n\nA **note**.' }),
 });

 return runtime.loadAsset(asset).then((entries) => {
 expect(entries).toHaveLength(1); // markdown has no variants — one entry
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.assetKind).toBe('markdown');
 expect(entry.id).toBe(asset.path);
 expect(entry.label).toBe('Notes');
 expect(entry.text).toBe('# Hello\n\nA **note**.');
 expect(typeof entry.Component).toBe('function');

 // The entry's Component renders the parsed Markdown as real DOM.
 const { container, cleanup } = renderToDom(React.createElement(entry.Component));
 const heading = container.querySelector('h1');
 expect(heading && heading.textContent).toBe('Hello');
 expect(container.querySelector('strong')).toBeTruthy();
 cleanup();
 });
 });

 it('imports the .md file via Vite\'s ?raw suffix on the rebased URL', async () => {
 const asset = markdownAsset('docs/Notes.md');
 const importModule = vi.fn(async () => ({ default: 'text' }));
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/@fixture-lerret',
 importModule,
 });

 await runtime.loadAsset(asset);
 expect(importModule).toHaveBeenCalledWith('/@fixture-lerret/docs/Notes.md?raw');
 });

 it('renders an empty .md as an "ok" empty document card — never an error', async () => {
 const asset = markdownAsset('docs/Empty.md');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => ({ default: '' }), // empty file
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.OK); // empty is not a failure
 expect(entry.text).toBe('');

 const { container, cleanup } = renderToDom(React.createElement(entry.Component));
 // The card renders — with an empty-document placeholder, no error/heading.
 expect(container.querySelector('[data-asset-kind="markdown"]')).toBeTruthy();
 expect(container.querySelector('h1')).toBeNull();
 expect(container.textContent).toMatch(/empty document/i);
 cleanup();
 });

 it('tolerates a bare-string ?raw result as well as a { default } module', async () => {
 const asset = markdownAsset('docs/Notes.md');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => '# Bare string body', // not wrapped in { default }
 });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.text).toBe('# Bare string body');
 });

 it('surfaces a missing .md file as a contained "error" entry — never rejects', async () => {
 const asset = markdownAsset('docs/Gone.md');
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: async () => {
 throw new Error('Failed to fetch dynamically imported module');
 },
 });

 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 const [entry] = entries;
 expect(entry.status).toBe(assetRuntimeStatus.ERROR);
 expect(entry.error.phase).toBe('load');
 expect(entry.id).toBe(asset.path); // keeps a stable canvas slot
 });
});

// ---------------------------------------------------------------------------
// createViteRuntime — subscribe / dispose
// ---------------------------------------------------------------------------

describe('createViteRuntime — subscribe / dispose', () => {
 it('subscribe returns an unsubscribe function and dispose is idempotent', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const unsubscribe = runtime.subscribe(() => {});
 expect(typeof unsubscribe).toBe('function');
 expect(() => unsubscribe()).not.toThrow();
 // dispose is safe to call repeatedly.
 expect(() => {
 runtime.dispose();
 runtime.dispose();
 }).not.toThrow();
 });

 it('viteRuntimeFactory is the CLI-mode factory alias', () => {
 expect(viteRuntimeFactory).toBe(createViteRuntime);
 });
});

// ---------------------------------------------------------------------------
// createViteRuntime — notifyChange + reload
// ---------------------------------------------------------------------------

describe('createViteRuntime — notifyChange', () => {
 it('fans out the changed path to every subscriber', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const a = vi.fn();
 const b = vi.fn();
 runtime.subscribe(a);
 runtime.subscribe(b);

 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');

 expect(a).toHaveBeenCalledWith('/proj/.lerret/home/Hero.jsx');
 expect(b).toHaveBeenCalledWith('/proj/.lerret/home/Hero.jsx');
 });

 it('bumps the cache-bust token so the next loadAsset re-evaluates the module', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const importModule = vi.fn(async () => ({ default: Ok }));
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule,
 });

 // First load: cached path (no `?t=`).
 await runtime.loadAsset(asset);
 expect(importModule).toHaveBeenNthCalledWith(1, '/base/ui/Card.jsx');

 // Signal a change; the next load must include a fresh cache-bust query.
 runtime.notifyChange(asset.path);
 await runtime.loadAsset(asset);
 expect(importModule).toHaveBeenNthCalledWith(2, expect.stringMatching(/^\/base\/ui\/Card\.jsx\?t=\d+$/));

 // Another change → a different token value.
 runtime.notifyChange(asset.path);
 await runtime.loadAsset(asset);
 const thirdUrl = importModule.mock.calls[2][0];
 const secondUrl = importModule.mock.calls[1][0];
 expect(thirdUrl).toMatch(/^\/base\/ui\/Card\.jsx\?t=\d+$/);
 expect(thirdUrl).not.toBe(secondUrl);
 });

 it('does not bump the cache-bust token for unrelated assets', async () => {
 const a = componentAsset('ui/A.jsx');
 const b = componentAsset('ui/B.jsx');
 const importModule = vi.fn(async () => ({ default: Ok }));
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule,
 });

 await runtime.loadAsset(a);
 await runtime.loadAsset(b);
 runtime.notifyChange(a.path);
 await runtime.loadAsset(a);
 await runtime.loadAsset(b);

 // A's second load is cache-busted; B's second load is NOT.
 const calls = importModule.mock.calls.map((c) => c[0]);
 expect(calls[0]).toBe('/base/ui/A.jsx');
 expect(calls[1]).toBe('/base/ui/B.jsx');
 expect(calls[2]).toMatch(/^\/base\/ui\/A\.jsx\?t=\d+$/);
 expect(calls[3]).toBe('/base/ui/B.jsx'); // unchanged → no token
 });

 it('unsubscribe stops the listener from receiving further events', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const listener = vi.fn();
 const unsub = runtime.subscribe(listener);

 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).toHaveBeenCalledTimes(1);

 unsub();
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).toHaveBeenCalledTimes(1); // unchanged
 });

 it('is silent (no-op) after the runtime is disposed', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const listener = vi.fn();
 runtime.subscribe(listener);
 runtime.dispose();
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).not.toHaveBeenCalled();
 });

 it('isolates a throwing subscriber — others still fire', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const badError = new Error('listener boom');
 const bad = vi.fn(() => { throw badError; });
 const good = vi.fn();
 runtime.subscribe(bad);
 runtime.subscribe(good);

 // Silence the runtime's `console.error` so the test output stays clean.
 const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 spy.mockRestore();

 expect(bad).toHaveBeenCalledTimes(1);
 expect(good).toHaveBeenCalledTimes(1);
 });

 it('ignores a malformed path', () => {
 const runtime = createViteRuntime(project, { importModule: async () => ({}) });
 const listener = vi.fn();
 runtime.subscribe(listener);
 runtime.notifyChange('');
 runtime.notifyChange(/** @type {any} */ (null));
 expect(listener).not.toHaveBeenCalled();
 });
});

// ---------------------------------------------------------------------------
// asset-runtime interface — record helpers
// ---------------------------------------------------------------------------

describe('asset-runtime — record helpers', () => {
 it('makeOkEntry / makeErrorEntry build the documented record shape', () => {
 const asset = componentAsset('ui/Card.jsx');

 const ok = makeOkEntry(asset, Ok);
 expect(ok).toMatchObject({
 id: asset.path,
 status: assetRuntimeStatus.OK,
 Component: Ok,
 error: null,
 assetKind: 'component',
 });

 const err = makeErrorEntry(asset, toAssetError(new Error('x'), 'load'));
 expect(err).toMatchObject({
 id: asset.path,
 status: assetRuntimeStatus.ERROR,
 Component: null,
 });
 expect(err.error.phase).toBe('load');
 });

 it('makeVariantEntry builds a primary entry with the bare path id', () => {
 const asset = componentAsset('ui/Card.jsx');
 const meta = {
 dimensions: { width: 300, height: 200 },
 label: undefined,
 tags: ['x'],
 propsSchema: undefined,
 hasMeta: true,
 error: null,
 };
 const variant = { exportName: 'default', variantName: 'default', isPrimary: true, component: Ok };

 const entry = makeVariantEntry(asset, variant, meta);
 expect(entry).toMatchObject({
 id: asset.path, // primary → bare path
 status: assetRuntimeStatus.OK,
 Component: Ok,
 variantName: 'default',
 label: 'Card', // no meta.label → asset name
 dimensions: { width: 300, height: 200 },
 tags: ['x'],
 });
 });

 it('makeMarkdownEntry builds an "ok" markdown record carrying its raw text', () => {
 const asset = markdownAsset('docs/Notes.md');
 const entry = makeMarkdownEntry(asset, '# Title');
 expect(entry).toMatchObject({
 id: asset.path,
 status: assetRuntimeStatus.OK,
 assetKind: 'markdown',
 error: null,
 label: 'Notes',
 text: '# Title',
 });
 expect(typeof entry.Component).toBe('function');
 });

 it('makeMarkdownEntry coerces a non-string text to an empty document', () => {
 const asset = markdownAsset('docs/Notes.md');
 const entry = makeMarkdownEntry(asset, undefined);
 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.text).toBe('');
 });

 it('makeVariantEntry suffixes a named-variant id and derives its label', () => {
 const asset = componentAsset('ui/Card.jsx');
 const meta = {
 dimensions: { width: undefined, height: undefined },
 label: undefined,
 tags: [],
 propsSchema: undefined,
 hasMeta: false,
 error: null,
 };
 const variant = { exportName: 'Dark', variantName: 'Dark', isPrimary: false, component: Ok };

 const entry = makeVariantEntry(asset, variant, meta);
 expect(entry.id).toBe(`${asset.path}#Dark`);
 expect(entry.label).toBe('Card · Dark'); // derived from asset + export name
 expect(entry.variantName).toBe('Dark');
 });

 it('toAssetError normalizes Error objects and bare values alike', () => {
 const fromError = toAssetError(new Error('boom'), 'render');
 expect(fromError).toMatchObject({ phase: 'render', message: 'boom' });
 expect(typeof fromError.stack).toBe('string');

 const fromString = toAssetError('plain', 'load');
 expect(fromString).toEqual({ phase: 'load', message: 'plain' });
 });
});

// ---------------------------------------------------------------------------
// AssetErrorBoundary — render-time containment
// ---------------------------------------------------------------------------

describe('AssetErrorBoundary', () => {
 it('renders children when nothing throws', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorBoundary, null, React.createElement(Ok)),
 );
 expect(container.querySelector('[data-ok]')).toBeTruthy();
 expect(container.textContent).toContain('ok');
 cleanup();
 });

 it('contains a render-time throw: shows the fallback and reports an AssetError', () => {
 const Throwing = () => {
 throw new Error('render boom');
 };
 const onError = vi.fn();

 const { container, cleanup } = renderToDom(
 React.createElement(
 AssetErrorBoundary,
 {
 onError,
 fallback: React.createElement('div', { 'data-fallback': true }, 'fallback shown'),
 },
 React.createElement(Throwing),
 ),
 );

 // The fallback rendered in place of the crashed subtree — the throw did
 // not escape the boundary (no canvas crash).
 expect(container.querySelector('[data-fallback]')).toBeTruthy();
 expect(container.textContent).toContain('fallback shown');
 // ... and the structured error reached the caller exactly once.
 expect(onError).toHaveBeenCalledTimes(1);
 const [reported] = onError.mock.calls[0];
 expect(reported.phase).toBe('render');
 expect(reported.message).toBe('render boom');
 cleanup();
 });
});
