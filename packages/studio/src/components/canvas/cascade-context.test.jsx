// Tests for cascade-context.jsx.
//
// Covers:
// • CascadedConfigProvider + useCascadedConfig — context provision and
// lookup; empty/missing/malformed cascadeEntries fall back safely.
// • Section background application via project-canvas.jsx — the canvas
// applies presentation.background to the right section surfaces, inherits
// through the cascade, and falls back on malformed values.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { createProjectNode, createPageNode, createAssetNode } from '@lerret/core';

import { CascadedConfigProvider, useCascadedConfig } from './cascade-context.jsx';
import { ProjectCanvas } from './project-canvas.jsx';
import { createViteRuntime } from '../../runtime/vite-runtime.js';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/** Waits until `predicate()` returns truthy, or times out. */
async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10, label } = {}) {
 const start = Date.now();
 for (;;) {
 if (predicate()) return;
 if (Date.now() - start > timeoutMs) {
 throw new Error(`waitFor${label ? ` (${label})` : ''} timed out`);
 }
 await new Promise((r) => setTimeout(r, intervalMs));
 }
}

// ──────────────────────────────────────────────────────────────────────────
// Mount / unmount helpers
// ──────────────────────────────────────────────────────────────────────────

let mountedRoot = null;
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

async function mount(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(element));
 mountedContainer = container;
 mountedRoot = root;
 return container;
}

// ──────────────────────────────────────────────────────────────────────────
// CascadedConfigProvider + useCascadedConfig
// ──────────────────────────────────────────────────────────────────────────

describe('CascadedConfigProvider + useCascadedConfig', () => {
 it('returns {} for any path when no cascadeEntries are provided', () => {
 // Render a consumer outside a provider — the default context returns {}.
 let result;
 function Consumer() {
 const getConfigFor = useCascadedConfig();
 result = getConfigFor('/some/path');
 return null;
 }
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(<Consumer />));
 act(() => root.unmount());
 container.remove();
 expect(result).toEqual({});
 });

 it('returns {} when cascadeEntries is null', () => {
 let result;
 function Consumer() {
 const getConfigFor = useCascadedConfig();
 result = getConfigFor('/some/path');
 return null;
 }
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(
 <CascadedConfigProvider cascadeEntries={null}>
 <Consumer />
 </CascadedConfigProvider>,
 ));
 act(() => root.unmount());
 container.remove();
 expect(result).toEqual({});
 });

 it('returns {} for an unknown path', () => {
 const entries = [['/a', { presentation: { background: '#f00' } }]];
 let result;
 function Consumer() {
 const getConfigFor = useCascadedConfig();
 result = getConfigFor('/not-in-cascade');
 return null;
 }
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(
 <CascadedConfigProvider cascadeEntries={entries}>
 <Consumer />
 </CascadedConfigProvider>,
 ));
 act(() => root.unmount());
 container.remove();
 expect(result).toEqual({});
 });

 it('returns the config object for a known path', () => {
 const cfg = { presentation: { background: '#f00' }, vars: { brandColor: '#B85B33' } };
 const entries = [['/ui-components', cfg]];
 let result;
 function Consumer() {
 const getConfigFor = useCascadedConfig();
 result = getConfigFor('/ui-components');
 return null;
 }
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(
 <CascadedConfigProvider cascadeEntries={entries}>
 <Consumer />
 </CascadedConfigProvider>,
 ));
 act(() => root.unmount());
 container.remove();
 expect(result).toEqual(cfg);
 });

 it('the getConfigFor function is stable when cascadeEntries identity is unchanged', () => {
 const entries = [['/a', {}]];
 const results = [];
 function Consumer() {
 const getConfigFor = useCascadedConfig();
 results.push(getConfigFor);
 return null;
 }
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(
 <CascadedConfigProvider cascadeEntries={entries}>
 <Consumer />
 </CascadedConfigProvider>,
 ));
 // Re-render parent without changing entries identity — getConfigFor should
 // be the same reference (memoized in CascadedConfigProvider).
 act(() => root.render(
 <CascadedConfigProvider cascadeEntries={entries}>
 <Consumer />
 </CascadedConfigProvider>,
 ));
 act(() => root.unmount());
 container.remove();
 expect(results.length).toBeGreaterThanOrEqual(1);
 // All collected references should be the same function.
 for (const fn of results) {
 expect(fn).toBe(results[0]);
 }
 });
});

// ──────────────────────────────────────────────────────────────────────────
// ProjectCanvas + cascade context — section background application
// ──────────────────────────────────────────────────────────────────────────

describe('ProjectCanvas — section background from cascade', () => {
 /**
 * Build a minimal project + runtime with one page and one section asset.
 */
 function setup({ pagePath = '/.lerret/home' } = {}) {
 const asset = createAssetNode({
 name: 'Card',
 fileName: 'Card.jsx',
 path: `${pagePath}/Card.jsx`,
 assetKind: 'component',
 ext: '.jsx',
 });
 const page = createPageNode({
 name: 'home',
 path: pagePath,
 assets: [asset],
 });
 const project = createProjectNode({
 name: 'demo',
 path: '/.lerret',
 pages: [page],
 });
 const importer = vi.fn(async () => ({
 default: () => React.createElement('div', { 'data-card': true }, 'Card'),
 }));
 const runtime = createViteRuntime(project, {
 assetBaseUrl: '/base',
 importModule: importer,
 });
 return { project, runtime };
 }

 it('applies the cascade bg color to the matching section', async () => {
 const pagePath = '/.lerret/home';
 const { project, runtime } = setup({ pagePath });
 const cascadeEntries = [[pagePath, { presentation: { background: '#ff0000' } }]];

 const container = await mount(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <ProjectCanvas project={project} runtime={runtime} />
 </CascadedConfigProvider>,
 );

 await waitFor(() => container.querySelector('[data-card]'), { label: 'card rendered' });

 // The section wrapper should carry backgroundColor: '#ff0000'.
 const section = container.querySelector('[data-dc-section]');
 expect(section).not.toBeNull();
 expect(section.style.backgroundColor).toBe('rgb(255, 0, 0)');
 });

 it('uses default styling (no backgroundColor) when the cascade has no bg', async () => {
 const pagePath = '/.lerret/home';
 const { project, runtime } = setup({ pagePath });
 // No presentation.background in cascade.
 const cascadeEntries = [[pagePath, { vars: { foo: 'bar' } }]];

 const container = await mount(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <ProjectCanvas project={project} runtime={runtime} />
 </CascadedConfigProvider>,
 );

 await waitFor(() => container.querySelector('[data-card]'), { label: 'card rendered' });

 const section = container.querySelector('[data-dc-section]');
 expect(section).not.toBeNull();
 // No explicit background — the section uses the canvas default.
 expect(section.style.backgroundColor).toBe('');
 });

 it('uses default styling when no cascade entries are provided (empty provider)', async () => {
 const pagePath = '/.lerret/home';
 const { project, runtime } = setup({ pagePath });

 const container = await mount(
 <CascadedConfigProvider cascadeEntries={[]}>
 <ProjectCanvas project={project} runtime={runtime} />
 </CascadedConfigProvider>,
 );

 await waitFor(() => container.querySelector('[data-card]'), { label: 'card rendered' });

 const section = container.querySelector('[data-dc-section]');
 expect(section).not.toBeNull();
 expect(section.style.backgroundColor).toBe('');
 });

 it('falls back to default and console.warns for a malformed bg color', async () => {
 const pagePath = '/.lerret/home';
 const { project, runtime } = setup({ pagePath });
 // Malformed: not a CSS color string.
 const cascadeEntries = [[pagePath, { presentation: { background: 'not-a-color-{;}' } }]];
 const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

 const container = await mount(
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <ProjectCanvas project={project} runtime={runtime} />
 </CascadedConfigProvider>,
 );

 await waitFor(() => container.querySelector('[data-card]'), { label: 'card rendered' });

 const section = container.querySelector('[data-dc-section]');
 expect(section).not.toBeNull();
 // No background applied — fell back to default.
 expect(section.style.backgroundColor).toBe('');
 // A warning was emitted naming the folder path.
 expect(warnSpy).toHaveBeenCalled();
 const warnMsg = warnSpy.mock.calls[0][0];
 expect(warnMsg).toContain(pagePath);
 expect(warnMsg).toContain('presentation.background');

 warnSpy.mockRestore();
 });

 it('section renders normally (no crash) without a CascadedConfigProvider', async () => {
 // Without a provider the default context (getConfigFor → {}) is used —
 // no error, no bg override.
 const pagePath = '/.lerret/home';
 const { project, runtime } = setup({ pagePath });

 const container = await mount(
 <ProjectCanvas project={project} runtime={runtime} />,
 );

 await waitFor(() => container.querySelector('[data-card]'), { label: 'card rendered' });
 expect(container.querySelector('[data-dc-section]')).not.toBeNull();
 });
});
