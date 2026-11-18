// inline-loader.test.js — running asset modules without a service worker
// (the MCP App sandbox). Tests run scripts with indirect eval instead of an
// inline <script>; the loader logic is the same.

import { describe, expect, it } from 'vitest';

import { createInlineImporter, createModuleStore } from './inline-loader.js';
import { createEmbedBridge, WRITE_CHUNK } from './embed-bridge.js';
import { createMemoryBackend } from '../fs/memory-backend.js';

const execute = (src) => (0, eval)(src);
const PNG = new Uint8Array([137, 80, 78, 71]);

function setup(files = {}) {
  const store = createModuleStore();
  const fs = createMemoryBackend(files);
  const importModule = createInlineImporter({ store, fs, projectRoot: () => '.lerret', execute, loadMermaid: async () => ({ default: { id: 'mermaid' } }) });
  return { store, importModule };
}

describe('createInlineImporter', () => {
  it('evaluates an ES module and resolves React, Mermaid, a sibling module and an image', async () => {
    const { store, importModule } = setup({ '.lerret/social/logo.png': PNG });
    store.postMessage({ type: 'REGISTER_MODULE', url: '/__lerret/asset/social/theme.js?h=1', code: 'export const ink = "#111";' });
    store.postMessage({
      type: 'REGISTER_MODULE',
      url: '/__lerret/asset/social/Card.jsx?h=2',
      code: [
        "import React from 'react';",
        "import mermaid from 'mermaid';",
        "import { ink } from '/__lerret/asset/social/theme.js?h=1';",
        "import logo from './logo.png';",
        'export const meta = { label: "Card" };',
        'export default function Card() { return null; }',
        'export const info = { hasReact: typeof React.createElement, ink, logo, mermaid: mermaid.id };',
      ].join('\n'),
    });
    const mod = await importModule('/__lerret/asset/social/Card.jsx?h=2');
    expect(typeof mod.default).toBe('function');
    expect(mod.meta.label).toBe('Card');
    expect(mod.info).toEqual({ hasReact: 'function', ink: '#111', logo: 'data:image/png;base64,iVBORw==', mermaid: 'mermaid' });
  });

  it('returns the same instance for the same URL and a fresh one for a new hash', async () => {
    const { store, importModule } = setup();
    store.postMessage({ type: 'REGISTER_MODULE', url: '/__lerret/asset/a.js?h=1', code: 'export const o = {};' });
    store.postMessage({ type: 'REGISTER_MODULE', url: '/__lerret/asset/a.js?h=2', code: 'export const o = {};' });
    const a1 = await importModule('/__lerret/asset/a.js?h=1');
    expect(await importModule('/__lerret/asset/a.js?h=1')).toBe(a1);
    expect(await importModule('/__lerret/asset/a.js?h=2')).not.toBe(a1);
  });

  it('surfaces a top-level throw and an unknown package as errors', async () => {
    const { store, importModule } = setup();
    store.postMessage({ type: 'REGISTER_MODULE', url: '/__lerret/asset/b.js?h=1', code: 'throw new Error("boom");' });
    await expect(importModule('/__lerret/asset/b.js?h=1')).rejects.toThrow('boom');
    store.postMessage({ type: 'REGISTER_MODULE', url: '/__lerret/asset/c.js?h=1', code: "import x from 'left-pad'; export default x;" });
    await expect(importModule('/__lerret/asset/c.js?h=1')).rejects.toThrow(/left-pad/);
  });
});

describe('createEmbedBridge', () => {
  it('joins paged text and binary slices back into files', async () => {
    const pages = [
      { files: [{ path: '.lerret/a.jsx', text: 'export ' }, { path: '.lerret/m.glb', base64: 'AQ' }], next: 2, version: 'v1', name: 'p' },
      { files: [{ path: '.lerret/a.jsx', text: 'default 1;' }, { path: '.lerret/m.glb', base64: 'ID' }], next: null },
    ];
    const app = { callServerTool: async ({ arguments: a }) => ({ structuredContent: pages[a.cursor === 0 ? 0 : 1] }) };
    const { files, version } = await createEmbedBridge(app).loadFiles();
    expect(version).toBe('v1');
    expect(files['.lerret/a.jsx']).toBe('export default 1;');
    expect([...files['.lerret/m.glb']]).toEqual([1, 2, 3]);
  });

  it('writes large content in chunks under the cap', async () => {
    const calls = [];
    const app = { callServerTool: async (c) => (calls.push(c.arguments), { structuredContent: {} }) };
    await createEmbedBridge(app).writeFile('.lerret/big.md', 'x'.repeat(WRITE_CHUNK * 2 + 5));
    expect(calls.map((c) => [c.content.length, c.append])).toEqual([[WRITE_CHUNK, false], [WRITE_CHUNK, true], [5, true]]);
  });
});
