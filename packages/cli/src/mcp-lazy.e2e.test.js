// mcp-lazy.e2e.test.js — the studio's bridge against the real paging functions:
// a project opens with its text, and an image arrives intact when asked for.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { blobPage, filesPage } from './mcp.js';
import { createEmbedBridge } from '../../studio/src/embed/embed-bridge.js';

it('bridge + server: text up front, image on demand', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lerret-lazy-'));
  try {
    await mkdir(join(root, '.lerret', 'p'), { recursive: true });
    await writeFile(join(root, '.lerret', 'p', 'Card.jsx'), 'export default () => null;');
    const png = Buffer.alloc(500_000, 3);
    await writeFile(join(root, '.lerret', 'p', 'hero.png'), png);
    const calls = [];
    const app = {
      async callServerTool({ name, arguments: a }) {
        calls.push(name);
        const sc = name === 'lerret_files' ? await filesPage(root, a.cursor, { lazy: a.lazy }) : await blobPage(root, a.path, a.from);
        expect(JSON.stringify(sc).length).toBeLessThan(150_000);
        return { structuredContent: sc };
      },
    };
    const bridge = createEmbedBridge(app);
    const { files, lazy } = await bridge.loadFiles();
    expect(Object.keys(files)).toEqual(['.lerret/p/Card.jsx']);
    expect(Object.keys(lazy)).toEqual(['.lerret/p/hero.png']);
    expect(calls).toEqual(['lerret_files']);
    expect(Buffer.from(await bridge.loadBlob('.lerret/p/hero.png')).equals(png)).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
