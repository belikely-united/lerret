// Tests for the project-canvas model layout (`project-canvas.jsx`, )
// and the live-edit loop.
//
// `ProjectCanvas` itself renders the brownfield `DesignCanvas` (covered by the
// dev-server boot + screenshots). These tests pin:
// • `collectPageSections` — one page → its depth-ordered section list;
// • `resolvePage` — the project + a page id → the page to show;
// • : a `runtime.notifyChange(path)` causes only the matching
// artboard to re-load — surrounding artboards keep their DOM identity,
// the prior render is held until the new content arrives (no blank flash),
// and the re-render cue appears on the refreshed artboard.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { createProjectNode, createPageNode, createGroupNode, createAssetNode } from '@lerret/core';

import { ProjectCanvas, collectPageSections, resolvePage } from './project-canvas.jsx';
import { createViteRuntime } from '../../runtime/vite-runtime.js';

/** A `.jsx` component asset node under `dir`. */
function componentAsset(dir, name) {
 return createAssetNode({
 name,
 fileName: `${name}.jsx`,
 path: `${dir}/${name}.jsx`,
 assetKind: 'component',
 ext: '.jsx',
 });
}

/** A `.md` markdown asset node under `dir`. */
function markdownAsset(dir, name) {
 return createAssetNode({
 name,
 fileName: `${name}.md`,
 path: `${dir}/${name}.md`,
 assetKind: 'markdown',
 ext: '.md',
 });
}

describe('collectPageSections', () => {
 it('makes one section for a page with direct assets', () => {
 const page = createPageNode({
 name: 'home',
 path: '/.lerret/home',
 assets: [componentAsset('/.lerret/home', 'Hero')],
 });
 const sections = collectPageSections(page);
 expect(sections).toHaveLength(1);
 expect(sections[0]).toMatchObject({
 id: '/.lerret/home',
 title: 'home',
 depth: 0,
 kicker: null,
 });
 expect(sections[0].assets).toHaveLength(1);
 });

 it('emits a section per group, depth-first, with true nesting depth', () => {
 // home ── components ── buttons (page → group → nested group)
 const buttons = createGroupNode({
 name: 'buttons',
 path: '/.lerret/home/components/buttons',
 assets: [componentAsset('/.lerret/home/components/buttons', 'PrimaryButton')],
 });
 const components = createGroupNode({
 name: 'components',
 path: '/.lerret/home/components',
 groups: [buttons],
 assets: [componentAsset('/.lerret/home/components', 'Card')],
 });
 const page = createPageNode({
 name: 'home',
 path: '/.lerret/home',
 groups: [components],
 assets: [componentAsset('/.lerret/home', 'Hero')],
 });

 const sections = collectPageSections(page);
 // Depth-first: page, then components, then buttons.
 expect(sections.map((s) => s.title)).toEqual(['home', 'components', 'buttons']);
 expect(sections.map((s) => s.depth)).toEqual([0, 1, 2]);
 // A nested section names its immediate parent group as the kicker.
 expect(sections.map((s) => s.kicker)).toEqual([null, 'home', 'components']);
 });

 it('skips a container with no direct assets but still recurses into its groups', () => {
 // An empty intermediate group contributes no section, but its
 // assets-bearing child still appears — at its true (deeper) depth.
 const leaf = createGroupNode({
 name: 'leaf',
 path: '/.lerret/home/mid/leaf',
 assets: [componentAsset('/.lerret/home/mid/leaf', 'Deep')],
 });
 const mid = createGroupNode({
 name: 'mid',
 path: '/.lerret/home/mid',
 groups: [leaf],
 // no direct assets
 });
 const page = createPageNode({
 name: 'home',
 path: '/.lerret/home',
 groups: [mid],
 // no direct assets
 });

 const sections = collectPageSections(page);
 expect(sections).toHaveLength(1);
 expect(sections[0]).toMatchObject({ title: 'leaf', depth: 2, kicker: 'mid' });
 });

 it('emits a placeholder section for an empty leaf group', () => {
 const empty = createGroupNode({ name: 'social', path: '/.lerret/home/social' });
 const page = createPageNode({
 name: 'home',
 path: '/.lerret/home',
 assets: [componentAsset('/.lerret/home', 'Hero')],
 groups: [empty],
 });
 const sections = collectPageSections(page);
 // The page's own section + the empty group's placeholder.
 expect(sections).toHaveLength(2);
 const placeholder = sections.find((s) => s.title === 'social');
 expect(placeholder).toMatchObject({ depth: 1, kicker: 'home', isEmpty: true });
 expect(placeholder.assets).toEqual([]);
 expect(sections.find((s) => s.title === 'home')).toMatchObject({ isEmpty: false });
 });

 it('does NOT placeholder an empty group that still has child groups', () => {
 const child = createGroupNode({
 name: 'child',
 path: '/.lerret/home/mid/child',
 assets: [componentAsset('/.lerret/home/mid/child', 'X')],
 });
 const mid = createGroupNode({ name: 'mid', path: '/.lerret/home/mid', groups: [child] });
 const page = createPageNode({ name: 'home', path: '/.lerret/home', groups: [mid] });
 // Only the assets-bearing child shows; `mid` contributes nothing.
 expect(collectPageSections(page).map((s) => s.title)).toEqual(['child']);
 });

 it('orders component assets before markdown assets within a section', () => {
 const page = createPageNode({
 name: 'docs',
 path: '/.lerret/docs',
 assets: [
 markdownAsset('/.lerret/docs', 'Readme'),
 componentAsset('/.lerret/docs', 'Widget'),
 ],
 });
 const [section] = collectPageSections(page);
 expect(section.assets.map((a) => a.assetKind)).toEqual(['component', 'markdown']);
 });

 it('returns no sections for an empty page', () => {
 const page = createPageNode({ name: 'empty', path: '/.lerret/empty' });
 expect(collectPageSections(page)).toEqual([]);
 });
});

describe('resolvePage', () => {
 const project = createProjectNode({
 name: 'demo',
 path: '/.lerret',
 pages: [
 createPageNode({ name: 'home', path: '/.lerret/home' }),
 createPageNode({ name: 'about', path: '/.lerret/about' }),
 ],
 });

 it('resolves a page by its id', () => {
 expect(resolvePage(project, '/.lerret/about').name).toBe('about');
 });

 it('falls back to the first page when the id is unknown (stale hash)', () => {
 expect(resolvePage(project, '/.lerret/gone').name).toBe('home');
 });

 it('falls back to the first page when no id is given', () => {
 expect(resolvePage(project, undefined).name).toBe('home');
 });

 it('returns null for a project with zero pages', () => {
 const empty = createProjectNode({ name: 'empty', path: '/.lerret', pages: [] });
 expect(resolvePage(empty, undefined)).toBeNull();
 });
});

// ---------------------------------------------------------------------------
// Live-edit loop
// ---------------------------------------------------------------------------

/** Wait for `predicate` to return truthy or fail after `timeoutMs`. */
async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10, label } = {}) {
 const start = Date.now();
 for (;;) {
 if (predicate()) return;
 if (Date.now() - start > timeoutMs) {
 throw new Error(`waitFor ${label ? `(${label}) ` : ''}timed out`);
 }
 await new Promise((r) => setTimeout(r, intervalMs));
 }
}

describe('ProjectCanvas — live-edit loop', () => {
 /** Active DOM root for cleanup between tests. @type {{ unmount(): void } | null} */
 let mountedRoot = null;
 /** Active container for cleanup. @type {HTMLElement | null} */
 let mountedContainer = null;

 afterEach(() => {
 if (mountedRoot) {
 act(() => mountedRoot.unmount());
 mountedRoot = null;
 }
 if (mountedContainer) {
 mountedContainer.remove();
 mountedContainer = null;
 }
 });

 /**
 * Build a minimal project with one page holding two component assets.
 * Returns `{ project, asset, asset2, makeRuntime(importer) }` so tests
 * pick their own importer behavior.
 */
 function setup() {
 const asset = createAssetNode({
 name: 'Card',
 fileName: 'Card.jsx',
 path: '/.lerret/home/Card.jsx',
 assetKind: 'component',
 ext: '.jsx',
 });
 const asset2 = createAssetNode({
 name: 'Hero',
 fileName: 'Hero.jsx',
 path: '/.lerret/home/Hero.jsx',
 assetKind: 'component',
 ext: '.jsx',
 });
 const home = createPageNode({
 name: 'home',
 path: '/.lerret/home',
 assets: [asset, asset2],
 });
 const project = createProjectNode({
 name: 'demo',
 path: '/.lerret',
 pages: [home],
 });
 return {
 project,
 asset,
 asset2,
 makeRuntime(importer) {
 return createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: importer,
 });
 },
 };
 }

 async function mount(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 mountedContainer = container;
 mountedRoot = root;
 return container;
 }

 it('shows a per-section "+ Asset / + Group" add bar (CLI mode) that targets that section', async () => {
 globalThis.__LERRET_CLI_MODE__ = true;
 try {
 const { project, makeRuntime } = setup();
 const importer = vi.fn(async () => ({
 default: () => React.createElement('div', { 'data-card': true }),
 }));
 const container = await mount(<ProjectCanvas project={project} runtime={makeRuntime(importer)} />);
 await waitFor(() => container.querySelector('[data-card]'), { label: 'initial render' });

 // Every rendered section gets the in-canvas add bar.
 expect(document.querySelector('[data-testid="section-add-asset"]')).not.toBeNull();
 const addGroup = document.querySelector('[data-testid="section-add-group"]');
 expect(addGroup).not.toBeNull();

 // Clicking it opens the create dialog targeting THIS section ("home").
 act(() => { addGroup.click(); });
 const dialog = document.querySelector('[data-testid="lm-create-dialog"]');
 expect(dialog).not.toBeNull();
 expect(dialog.getAttribute('aria-label')).toBe('New group');
 expect(dialog.textContent).toContain('home');
 } finally {
 delete globalThis.__LERRET_CLI_MODE__;
 }
 });

 it('reloads only the affected artboard on notifyChange, preserving siblings', async () => {
 const { project, asset, asset2, makeRuntime } = setup();
 // Track each asset's load — the runtime calls `importer(url)` per
 // loadAsset; we return a component whose label reflects the current
 // "version" so a swap is observable in the DOM.
 let cardVersion = 1;
 let heroVersion = 1;
 const importer = vi.fn(async (url) => {
 if (url.includes('Card.jsx')) {
 const v = cardVersion;
 return {
 default: () =>
 React.createElement('div', { 'data-card': true, 'data-v': String(v) }, `Card v${v}`),
 };
 }
 if (url.includes('Hero.jsx')) {
 const v = heroVersion;
 return {
 default: () =>
 React.createElement('div', { 'data-hero': true, 'data-v': String(v) }, `Hero v${v}`),
 };
 }
 return { default: () => null };
 });
 const runtime = makeRuntime(importer);

 const container = await mount(<ProjectCanvas project={project} runtime={runtime} />);

 // Wait for the initial load to land.
 await waitFor(
 () => container.querySelector('[data-card]') && container.querySelector('[data-hero]'),
 { label: 'initial render' },
 );
 expect(container.querySelector('[data-card]').getAttribute('data-v')).toBe('1');
 expect(container.querySelector('[data-hero]').getAttribute('data-v')).toBe('1');

 // Mutate the source for Card.jsx, then signal the change. Only the Card
 // artboard should re-render — Hero stays at v1.
 cardVersion = 2;
 heroVersion = 2; // changed in module space but never signaled — must NOT show
 act(() => {
 runtime.notifyChange(asset.path);
 });

 await waitFor(
 () => container.querySelector('[data-card]')?.getAttribute('data-v') === '2',
 { label: 'card reloaded' },
 );
 // Hero is untouched — the live-edit loop is surgical.
 expect(container.querySelector('[data-hero]').getAttribute('data-v')).toBe('1');
 // The asset that changed had its cache-bust query bumped.
 const cardCalls = importer.mock.calls
 .map((c) => c[0])
 .filter((u) => u.includes('Card.jsx'));
 expect(cardCalls.length).toBeGreaterThanOrEqual(2);
 expect(cardCalls[cardCalls.length - 1]).toMatch(/Card\.jsx\?t=\d+$/);
 // Hero's import was called only once (the initial load) — no extra reload.
 const heroCalls = importer.mock.calls
 .map((c) => c[0])
 .filter((u) => u.includes('Hero.jsx'));
 expect(heroCalls).toHaveLength(1);
 // The unused asset reference is intentional (kept so the test docs both
 // assets) — silence the linter.
 void asset2;
 });

 it('shows the re-render cue on the refreshed artboard after a notifyChange', async () => {
 const { project, asset, makeRuntime } = setup();
 let version = 1;
 const importer = vi.fn(async (url) => {
 if (url.includes('Card.jsx')) {
 const v = version;
 return {
 default: () =>
 React.createElement('div', { 'data-card': true, 'data-v': String(v) }, `Card v${v}`),
 };
 }
 return { default: () => null };
 });
 const runtime = makeRuntime(importer);
 const container = await mount(<ProjectCanvas project={project} runtime={runtime} />);

 await waitFor(() => container.querySelector('[data-card]'), { label: 'initial render' });
 // No cue on the initial paint — only on subsequent live re-renders.
 expect(container.querySelector('[data-lm-rerender-cue]')).toBeNull();

 version = 2;
 act(() => {
 runtime.notifyChange(asset.path);
 });
 await waitFor(
 () => container.querySelector('[data-card]')?.getAttribute('data-v') === '2',
 { label: 'reload landed' },
 );
 // The cue is produced by a post-render `useEffect` in `RerenderCue`,
 // so it appears one render after `data-v="2"` lands — wait for it
 // explicitly rather than racing the assertion against the effect
 // commit cycle.
 await waitFor(
 () => container.querySelector('[data-lm-rerender-cue]') !== null,
 { label: 'rerender cue rendered' },
 );
 expect(container.querySelector('[data-lm-rerender-cue]')).not.toBeNull();
 });

 it('holds the prior render until the new render is ready — no blank flash', async () => {
 const { project, asset, makeRuntime } = setup();
 // Importer returns a promise we control — we deliberately delay the
 // second load so we can assert what the DOM shows DURING the reload.
 let resolveSecondLoad;
 let calls = 0;
 const importer = vi.fn(async (url) => {
 if (url.includes('Hero.jsx')) {
 return { default: () => React.createElement('div', { 'data-hero': true }) };
 }
 if (url.includes('Card.jsx')) {
 calls += 1;
 if (calls === 1) {
 return {
 default: () =>
 React.createElement('div', { 'data-card': true, 'data-v': '1' }, 'Card v1'),
 };
 }
 // Second load — pause until the test resolves the promise.
 return new Promise((resolve) => {
 resolveSecondLoad = () =>
 resolve({
 default: () =>
 React.createElement('div', { 'data-card': true, 'data-v': '2' }, 'Card v2'),
 });
 });
 }
 return { default: () => null };
 });
 const runtime = makeRuntime(importer);
 const container = await mount(<ProjectCanvas project={project} runtime={runtime} />);

 await waitFor(
 () => container.querySelector('[data-card]')?.getAttribute('data-v') === '1',
 { label: 'initial card' },
 );

 // Kick off the reload — the importer's promise has not resolved yet.
 act(() => {
 runtime.notifyChange(asset.path);
 });

 // Give the canvas a tick to react; the previous render is still in place.
 await new Promise((r) => setTimeout(r, 60));
 expect(container.querySelector('[data-card]')?.getAttribute('data-v')).toBe('1');

 // Now complete the reload — the new render replaces the old one.
 resolveSecondLoad();
 await waitFor(
 () => container.querySelector('[data-card]')?.getAttribute('data-v') === '2',
 { label: 'card v2 lands' },
 );
 });

 it('a notifyChange for an asset NOT on the current page is silent on the canvas', async () => {
 const { project, makeRuntime } = setup();
 const importer = vi.fn(async () => ({
 default: () => React.createElement('div', { 'data-card': true }, 'x'),
 }));
 const runtime = makeRuntime(importer);
 const container = await mount(<ProjectCanvas project={project} runtime={runtime} />);
 await waitFor(() => container.querySelector('[data-card]'), { label: 'initial' });
 const before = importer.mock.calls.length;
 act(() => {
 runtime.notifyChange('/.lerret/somewhere-else/Stranger.jsx');
 });
 // Settle any microtasks.
 await new Promise((r) => setTimeout(r, 30));
 // No additional load was issued for an asset not on the page.
 expect(importer.mock.calls.length).toBe(before);
 });
});
