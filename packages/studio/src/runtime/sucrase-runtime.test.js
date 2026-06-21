// sucrase-runtime.test.js — tests for the hosted-mode asset runtime
//. The runtime depends on:
// - the FSA filesystem — we pass a tiny mock implementing only
// `readFile`/`readDir` since the runtime only calls `readFile`;
// - the service-worker bridge — we pass a mock that records `postMessage`s;
// - an injectable `importModule` — so the test doesn't need a live SW or
// a network round-trip.
//
// The goal of this suite: verify the hosted runtime returns the SAME
// `AssetEntry[]` shape as `vite-runtime.js` so the studio canvas doesn't
// branch on deploy mode (AR4), and that all the per-asset error containment
// (NFR8) lands in the same phases the Vite runtime uses.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { createAssetNode, createProjectNode } from '@lerret/core';

import {
 createHostedRuntime,
 hostedRuntimeFactory,
 hostedAssetModuleUrl,
 registerHostedServiceWorker,
 createNavigatorServiceWorkerBridge,
 ServiceWorkerRegistrationError,
 HOSTED_ASSET_URL_PREFIX,
 setReactImportMap,
 LERRET_IMPORT_MAP_ID,
} from './sucrase-runtime.js';
import { assetRuntimeStatus } from './asset-runtime.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const project = createProjectNode({ name: 'demo', path: '/proj/.lerret', pages: [] });

/** Build a component AssetNode at a project-relative path. */
function componentAsset(relPath, ext = '.jsx') {
 const fileName = relPath.split('/').pop();
 return createAssetNode({
 name: fileName.slice(0, fileName.lastIndexOf('.')),
 fileName,
 path: `/proj/.lerret/${relPath}`,
 assetKind: 'component',
 ext,
 });
}

/** Build a markdown AssetNode at a project-relative path. */
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

/**
 * A tiny FilesystemAccess mock that returns `files[path]` as the file's
 * text. Records every `readFile` call so tests can assert what was read.
 */
function makeFs(files = {}) {
 const reads = [];
 return {
 capabilities: { canWrite: true, canWatch: false, canReveal: false },
 reads,
 async deleteFile() {},
 async mkdir() {},
 async exists(p) { return p in files; },
 async readFile(filePath) {
 reads.push(filePath);
 if (filePath in files) return files[filePath];
 const err = new Error(`ENOENT: ${filePath}`);
 throw err;
 },
 async readDir() {
 return [];
 },
 async writeFile() {},
 watch() {
 return { close() {} };
 },
 };
}

/** A SW bridge mock that records every `postMessage`. */
function makeSw() {
 const messages = [];
 return {
 messages,
 postMessage(m) { messages.push(m); },
 async ready() {},
 };
}

/** A trivial valid React component. */
function Ok() {
 return React.createElement('div', { 'data-ok': true }, 'ok');
}

// ---------------------------------------------------------------------------
// hostedAssetModuleUrl
// ---------------------------------------------------------------------------

describe('hostedAssetModuleUrl', () => {
 it('rebases an asset path under the SW interception prefix', () => {
 const asset = componentAsset('ui/Card.jsx');
 const url = hostedAssetModuleUrl(asset, project, 'abc123');
 expect(url).toBe(`${HOSTED_ASSET_URL_PREFIX}ui/Card.jsx?h=abc123`);
 });

 it('omits the hash query when no hash is supplied', () => {
 const asset = componentAsset('ui/Card.jsx');
 const url = hostedAssetModuleUrl(asset, project, '');
 expect(url).toBe(`${HOSTED_ASSET_URL_PREFIX}ui/Card.jsx`);
 });

 it('encodes the hash in the query parameter (no URL-special chars leak)', () => {
 const asset = componentAsset('ui/Card.jsx');
 const url = hostedAssetModuleUrl(asset, project, 'a?b=c&d');
 expect(url).toBe(`${HOSTED_ASSET_URL_PREFIX}ui/Card.jsx?h=${encodeURIComponent('a?b=c&d')}`);
 });
});

// ---------------------------------------------------------------------------
// createHostedRuntime — loadAsset
// ---------------------------------------------------------------------------

describe('createHostedRuntime — loadAsset (component)', () => {
 it('reads source via FSA, transforms, registers with SW, and imports — returning an "ok" entry', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const source = 'export default function Card() { return <i/>; }';
 const fs = makeFs({ [asset.path]: source });
 const sw = makeSw();
 const importModule = vi.fn(async () => ({ default: Ok }));

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const [entry] = await runtime.loadAsset(asset);

 expect(entry.status).toBe(assetRuntimeStatus.OK);
 expect(entry.Component).toBe(Ok);
 expect(entry.error).toBeNull();
 expect(entry.id).toBe(asset.path);
 expect(entry.label).toBe('Card');
 expect(entry.assetKind).toBe('component');

 // The FSA was read once with the asset's path.
 expect(fs.reads).toEqual([asset.path]);

 // A REGISTER_MODULE message landed at the SW, carrying the SW URL.
 const reg = sw.messages.find((m) => m.type === 'REGISTER_MODULE');
 expect(reg).toBeTruthy();
 expect(reg.url.startsWith(`${HOSTED_ASSET_URL_PREFIX}ui/Card.jsx?h=`)).toBe(true);
 expect(typeof reg.code).toBe('string');
 // Production-mode JSX runtime — NOT the dev variant.
 expect(reg.code).toContain('react/jsx-runtime');
 expect(reg.code).not.toContain('react/jsx-dev-runtime');

 // The importer was called with that same URL.
 expect(importModule).toHaveBeenCalledTimes(1);
 expect(importModule.mock.calls[0][0]).toBe(reg.url);
 });

 it('yields one variant entry per component-valued export (shape)', async () => {
 const Dark = () => null;
 const Compact = () => null;
 const asset = componentAsset('ui/Button.jsx');
 const fs = makeFs({ [asset.path]: 'export default function Button(){}' });
 const sw = makeSw();
 const importModule = async () => ({ default: Ok, Dark, Compact });

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const entries = await runtime.loadAsset(asset);

 expect(entries).toHaveLength(3);
 expect(entries[0]).toMatchObject({
 status: 'ok',
 variantName: 'default',
 id: asset.path,
 Component: Ok,
 });
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

 it('populates dimensions/label/tags from the module\'s meta export', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const fs = makeFs({ [asset.path]: 'export default function Card(){}' });
 const sw = makeSw();
 const importModule = async () => ({
 default: Ok,
 meta: {
 dimensions: { width: 420, height: 280 },
 label: 'Hero',
 tags: ['hero'],
 },
 });

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const [entry] = await runtime.loadAsset(asset);

 expect(entry.dimensions).toEqual({ width: 420, height: 280 });
 expect(entry.label).toBe('Hero');
 expect(entry.tags).toEqual(['hero']);
 });

 it('contains an FSA read failure as a "load" error (NEVER rejects)', async () => {
 const asset = componentAsset('ui/Missing.jsx');
 const fs = makeFs({});
 const sw = makeSw();
 const importModule = vi.fn();

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const [entry] = await runtime.loadAsset(asset);

 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('load');
 expect(entry.error.message).toMatch(/ENOENT/);
 expect(entry.id).toBe(asset.path); // stable canvas slot
 expect(importModule).not.toHaveBeenCalled();
 });

 it('contains a Sucrase syntax error as a "load" error', async () => {
 const asset = componentAsset('ui/Broken.jsx');
 const fs = makeFs({ [asset.path]: 'export default function Broken() { return <div unclosed;' });
 const sw = makeSw();
 const runtime = createHostedRuntime(project, { fs, sw, importModule: vi.fn() });

 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('load');
 });

 it('contains a top-level module throw as an "evaluate" error', async () => {
 const asset = componentAsset('ui/TopLevelThrows.jsx');
 const fs = makeFs({ [asset.path]: 'export default function X(){}' });
 const sw = makeSw();
 const importModule = async () => { throw new Error('top-level boom'); };

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('evaluate');
 expect(entry.error.message).toContain('top-level boom');
 });

 it('contains a no-component-export module as an "evaluate" error', async () => {
 const asset = componentAsset('ui/NoComp.jsx');
 const fs = makeFs({ [asset.path]: 'export default function X(){}' });
 const sw = makeSw();
 const importModule = async () => ({ default: { not: 'a function' }, VERSION: '1.0' });

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('evaluate');
 expect(entry.error.message).toMatch(/exports no react component/i);
 });

 it('returns a disposed-error entry after dispose() is called', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const fs = makeFs({ [asset.path]: 'export default function X(){}' });
 const sw = makeSw();
 const runtime = createHostedRuntime(project, {
 fs, sw,
 importModule: async () => ({ default: Ok }),
 });
 runtime.dispose();
 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe('error');
 expect(entry.error.message).toMatch(/disposed/i);
 });

 it('returns an error entry for a null asset (does not crash)', async () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const [entry] = await runtime.loadAsset(/** @type {any} */ (null));
 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('load');
 });
});

// ---------------------------------------------------------------------------
// createHostedRuntime — markdown
// ---------------------------------------------------------------------------

describe('createHostedRuntime — loadAsset (markdown)', () => {
 it('reads a .md via FSA and returns one markdown entry — no SW round-trip', async () => {
 const asset = markdownAsset('docs/Notes.md');
 const fs = makeFs({ [asset.path]: '# Hello\n\nA **note**.' });
 const sw = makeSw();

 const runtime = createHostedRuntime(project, { fs, sw, importModule: vi.fn() });
 const entries = await runtime.loadAsset(asset);
 expect(entries).toHaveLength(1);
 const [entry] = entries;
 expect(entry.status).toBe('ok');
 expect(entry.assetKind).toBe('markdown');
 expect(entry.text).toBe('# Hello\n\nA **note**.');
 expect(typeof entry.Component).toBe('function');

 // Markdown is NOT transformed and NOT registered with the SW.
 expect(sw.messages.some((m) => m.type === 'REGISTER_MODULE')).toBe(false);
 });

 it('surfaces a missing .md as a "load" error', async () => {
 const asset = markdownAsset('docs/Gone.md');
 const runtime = createHostedRuntime(project, {
 fs: makeFs({}),
 sw: makeSw(),
 importModule: vi.fn(),
 });
 const [entry] = await runtime.loadAsset(asset);
 expect(entry.status).toBe('error');
 expect(entry.error.phase).toBe('load');
 });
});

// ---------------------------------------------------------------------------
// notifyChange / subscribe
// ---------------------------------------------------------------------------

describe('createHostedRuntime — notifyChange', () => {
 it('fans out the changed path to every subscriber', () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const a = vi.fn();
 const b = vi.fn();
 runtime.subscribe(a);
 runtime.subscribe(b);
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(a).toHaveBeenCalledWith('/proj/.lerret/home/Hero.jsx');
 expect(b).toHaveBeenCalledWith('/proj/.lerret/home/Hero.jsx');
 });

 it('the next loadAsset after notifyChange produces a fresh URL when the source has changed', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const fs = makeFs({
 [asset.path]: 'export default function Card(){ return <i/>; }',
 });
 const sw = makeSw();
 const seenUrls = [];
 const importModule = vi.fn(async (url) => {
 seenUrls.push(url);
 return { default: Ok };
 });

 const runtime = createHostedRuntime(project, { fs, sw, importModule });

 // First load.
 await runtime.loadAsset(asset);
 expect(seenUrls).toHaveLength(1);

 // Simulate the source on disk changing.
 fs.readFile = async (p) => {
 fs.reads.push(p);
 return 'export default function Card(){ return <b/>; }';
 };
 runtime.notifyChange(asset.path);

 // Second load — the URL must differ (new content hash).
 await runtime.loadAsset(asset);
 expect(seenUrls).toHaveLength(2);
 expect(seenUrls[0]).not.toBe(seenUrls[1]);
 });

 it('a no-diff re-read produces the same URL (content-hash dedup)', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const source = 'export default function Card(){ return <i/>; }';
 const fs = makeFs({ [asset.path]: source });
 const sw = makeSw();
 const seenUrls = [];
 const importModule = vi.fn(async (url) => {
 seenUrls.push(url);
 return { default: Ok };
 });
 const runtime = createHostedRuntime(project, { fs, sw, importModule });

 await runtime.loadAsset(asset);
 runtime.notifyChange(asset.path); // tell the runtime, but source didn't change
 await runtime.loadAsset(asset);

 expect(seenUrls).toHaveLength(2);
 // Same source → same hash → same URL.
 expect(seenUrls[0]).toBe(seenUrls[1]);
 });

 it('unsubscribe stops the listener', () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const listener = vi.fn();
 const unsub = runtime.subscribe(listener);
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).toHaveBeenCalledTimes(1);
 unsub();
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).toHaveBeenCalledTimes(1);
 });

 it('is silent after dispose', () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const listener = vi.fn();
 runtime.subscribe(listener);
 runtime.dispose();
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 expect(listener).not.toHaveBeenCalled();
 });

 it('isolates a throwing subscriber', () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const bad = vi.fn(() => { throw new Error('listener boom'); });
 const good = vi.fn();
 runtime.subscribe(bad);
 runtime.subscribe(good);

 const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
 runtime.notifyChange('/proj/.lerret/home/Hero.jsx');
 spy.mockRestore();

 expect(bad).toHaveBeenCalledTimes(1);
 expect(good).toHaveBeenCalledTimes(1);
 });

 it('ignores malformed paths', () => {
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw: makeSw(),
 importModule: async () => ({}),
 });
 const listener = vi.fn();
 runtime.subscribe(listener);
 runtime.notifyChange('');
 runtime.notifyChange(/** @type {any} */ (null));
 expect(listener).not.toHaveBeenCalled();
 });
});

// ---------------------------------------------------------------------------
// SW pre-register protocol — message shapes
// ---------------------------------------------------------------------------

describe('SW pre-register protocol', () => {
 it('posts REGISTER_MODULE with { type, url, code } before the dynamic import', async () => {
 const asset = componentAsset('ui/Card.jsx');
 const fs = makeFs({ [asset.path]: 'export default function X(){ return <i/>; }' });
 const sw = makeSw();
 // The order is: SW gets REGISTER_MODULE → importModule is called.
 const order = [];
 const swSpy = sw.postMessage.bind(sw);
 sw.postMessage = (m) => {
 if (m && m.type === 'REGISTER_MODULE') order.push('register');
 swSpy(m);
 };
 const importModule = vi.fn(async () => {
 order.push('import');
 return { default: Ok };
 });

 const runtime = createHostedRuntime(project, { fs, sw, importModule });
 await runtime.loadAsset(asset);

 expect(order).toEqual(['register', 'import']);

 const reg = sw.messages.find((m) => m.type === 'REGISTER_MODULE');
 expect(reg).toMatchObject({
 type: 'REGISTER_MODULE',
 url: expect.stringMatching(new RegExp(`^${HOSTED_ASSET_URL_PREFIX}ui/Card\\.jsx\\?h=`)),
 code: expect.any(String),
 });
 });

 it('dispose() posts INVALIDATE_PREFIX so the SW drops every cached module', () => {
 const sw = makeSw();
 const runtime = createHostedRuntime(project, {
 fs: makeFs(),
 sw,
 importModule: async () => ({}),
 });
 runtime.dispose();
 const inv = sw.messages.find((m) => m.type === 'INVALIDATE_PREFIX');
 expect(inv).toMatchObject({ type: 'INVALIDATE_PREFIX', prefix: HOSTED_ASSET_URL_PREFIX });
 });
});

// ---------------------------------------------------------------------------
// registerHostedServiceWorker — failure surface
// ---------------------------------------------------------------------------

describe('registerHostedServiceWorker', () => {
 it('rejects with ServiceWorkerRegistrationError when navigator.serviceWorker is missing', async () => {
 const original = typeof navigator === 'undefined' ? null : navigator.serviceWorker;
 try {
 if (typeof navigator !== 'undefined') {
 Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
 }
 await expect(
 registerHostedServiceWorker({ swUrl: '/module-sw.js' }),
 ).rejects.toBeInstanceOf(ServiceWorkerRegistrationError);
 } finally {
 if (typeof navigator !== 'undefined' && original !== null) {
 Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
 }
 }
 });

 it('wraps a register() rejection as ServiceWorkerRegistrationError preserving the cause', async () => {
 if (typeof navigator === 'undefined') return; // skip in non-DOM
 const original = navigator.serviceWorker;
 const cause = new Error('blocked by policy');
 Object.defineProperty(navigator, 'serviceWorker', {
 value: {
 register: vi.fn().mockRejectedValue(cause),
 get controller() { return null; },
 get ready() { return Promise.resolve(); },
 },
 configurable: true,
 });
 try {
 await expect(
 registerHostedServiceWorker({ swUrl: '/module-sw.js' }),
 ).rejects.toMatchObject({
 name: 'ServiceWorkerRegistrationError',
 cause,
 });
 } finally {
 Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
 }
 });
});

describe('createNavigatorServiceWorkerBridge', () => {
 it('falls back to the active worker when there is no controller yet (first load)', async () => {
 if (typeof navigator === 'undefined') return; // skip in non-DOM
 const original = navigator.serviceWorker;
 const active = { postMessage: vi.fn() };
 Object.defineProperty(navigator, 'serviceWorker', {
 value: { controller: null, ready: Promise.resolve({ active }) },
 configurable: true,
 });
 try {
 const msg = { type: 'REGISTER_BINARY', key: '_assets/logo.svg' };
 createNavigatorServiceWorkerBridge().postMessage(msg);
 await navigator.serviceWorker.ready;
 await Promise.resolve();
 expect(active.postMessage).toHaveBeenCalledWith(msg);
 } finally {
 Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
 }
 });

 it('posts straight to the controller when one is present', () => {
 if (typeof navigator === 'undefined') return; // skip in non-DOM
 const original = navigator.serviceWorker;
 const controller = { postMessage: vi.fn() };
 Object.defineProperty(navigator, 'serviceWorker', {
 value: { controller, ready: Promise.resolve({}) },
 configurable: true,
 });
 try {
 const msg = { type: 'REGISTER_MODULE', key: 'x' };
 createNavigatorServiceWorkerBridge().postMessage(msg);
 expect(controller.postMessage).toHaveBeenCalledWith(msg);
 } finally {
 Object.defineProperty(navigator, 'serviceWorker', { value: original, configurable: true });
 }
 });
});

// ---------------------------------------------------------------------------
// setReactImportMap — bare-specifier → bundled-React URL injection
// ---------------------------------------------------------------------------

describe('setReactImportMap', () => {
 it('populates an existing import-map placeholder by id', () => {
 const el = document.createElement('script');
 el.type = 'importmap';
 el.id = LERRET_IMPORT_MAP_ID;
 el.textContent = '{"imports": {}}';
 document.body.appendChild(el);
 try {
 const ok = setReactImportMap({
 react: '/r/react.js',
 jsxRuntime: '/r/jsx-runtime.js',
 reactDom: '/r/react-dom.js',
 reactDomClient: '/r/client.js',
 });
 expect(ok).toBe(true);
 const parsed = JSON.parse(el.textContent);
 expect(parsed.imports).toMatchObject({
 react: '/r/react.js',
 'react/jsx-runtime': '/r/jsx-runtime.js',
 'react-dom': '/r/react-dom.js',
 'react-dom/client': '/r/client.js',
 });
 } finally {
 el.remove();
 }
 });

 it('returns false when no placeholder element exists', () => {
 expect(setReactImportMap({ react: '/r/react.js', jsxRuntime: '/r/jsx-runtime.js' })).toBe(false);
 });

 it('omits keys whose URLs are not supplied', () => {
 const el = document.createElement('script');
 el.type = 'importmap';
 el.id = LERRET_IMPORT_MAP_ID;
 el.textContent = '{"imports":{}}';
 document.body.appendChild(el);
 try {
 setReactImportMap({ react: '/r/react.js', jsxRuntime: '/r/jsx-runtime.js' });
 const parsed = JSON.parse(el.textContent);
 expect(parsed.imports).toEqual({
 react: '/r/react.js',
 'react/jsx-runtime': '/r/jsx-runtime.js',
 });
 } finally {
 el.remove();
 }
 });
});

// ---------------------------------------------------------------------------
// Factory alias
// ---------------------------------------------------------------------------

describe('hostedRuntimeFactory', () => {
 it('is an alias of createHostedRuntime', () => {
 expect(hostedRuntimeFactory).toBe(createHostedRuntime);
 });

 it('requires both fs and sw in options', () => {
 expect(() => createHostedRuntime(project, { sw: makeSw() })).toThrow(/fs/);
 expect(() => createHostedRuntime(project, { fs: makeFs() })).toThrow(/sw/);
 expect(() => createHostedRuntime(project)).toThrow();
 });
});
