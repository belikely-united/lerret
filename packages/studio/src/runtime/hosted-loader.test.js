// Tests for hosted-loader.js (Epic 10 / Story H1) — verifies the in-browser
// model build composes core's scan + cascade + per-asset-config pipeline over a
// FilesystemAccess backend, producing the same shape the CLI exposes.

import { describe, it, expect } from 'vitest';

import { isProjectNode } from '@lerret/core';

import { createMemoryBackend } from '../fs/memory-backend.js';
import { loadHostedProject, HOSTED_SCAN_ROOT } from './hosted-loader.js';

/** A tiny but realistic project: root config + one page + one component asset
 *  carrying both a per-asset config (autoRefresh) and a data file. */
function seedProject() {
  return createMemoryBackend({
    '.lerret/config.json': JSON.stringify({ vars: { brand: '#B85B33' } }),
    '.lerret/marketing/Hero.jsx': 'export default () => null;',
    '.lerret/marketing/Hero.config.json': JSON.stringify({ autoRefresh: 1000 }),
    '.lerret/marketing/Hero.data.json': JSON.stringify({ title: 'Hi' }),
  });
}

describe('loadHostedProject', () => {
  it('builds a project node with the page and its asset from the FSA backend', async () => {
    const { project } = await loadHostedProject(seedProject());

    expect(isProjectNode(project)).toBe(true);
    expect(project.path).toBe(HOSTED_SCAN_ROOT);
    expect(project.pages.map((p) => p.name)).toEqual(['marketing']);

    const assets = project.pages[0].assets;
    expect(assets.map((a) => a.name)).toEqual(['Hero']);
    // The companion .config.json / .data.json are NOT separate assets.
    expect(assets).toHaveLength(1);
  });

  it('serializes the cascade as [path, config] entries with inherited vars', async () => {
    const { cascadeEntries } = await loadHostedProject(seedProject());

    expect(Array.isArray(cascadeEntries)).toBe(true);
    const marketing = cascadeEntries.find(([path]) => path === '.lerret/marketing');
    expect(marketing).toBeTruthy();
    // Root config.json vars cascade down to the page (FR21).
    expect(marketing[1].vars.brand).toBe('#B85B33');
  });

  it('serializes per-asset config as [assetPath, config] entries', async () => {
    const { assetConfigEntries } = await loadHostedProject(seedProject());

    expect(Array.isArray(assetConfigEntries)).toBe(true);
    expect(assetConfigEntries).toHaveLength(1);
    const [assetPath, config] = assetConfigEntries[0];
    expect(assetPath).toBe('.lerret/marketing/Hero.jsx');
    expect(config.autoRefresh).toBe(1000);
  });

  it('handles an empty .lerret/ (no pages) without throwing', async () => {
    const backend = createMemoryBackend({ '.lerret/config.json': '{}' });
    const { project, cascadeEntries, assetConfigEntries } = await loadHostedProject(backend);
    expect(isProjectNode(project)).toBe(true);
    expect(project.pages).toEqual([]);
    expect(cascadeEntries).toEqual([]);
    expect(assetConfigEntries).toEqual([]);
  });
});
