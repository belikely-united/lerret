// embed-bridge.test.js — images load on demand, not with the project.

import { describe, expect, it } from 'vitest';

import { createEmbedBridge, createSyncedBackend } from './embed-bridge.js';
import { createMemoryBackend } from '../fs/memory-backend.js';

const b64 = (s) => btoa(s);

function fakeApp() {
  const calls = [];
  return {
    calls,
    async callServerTool({ name, arguments: args }) {
      calls.push(name);
      if (name === 'lerret_files') {
        return { structuredContent: { version: 'v1', next: null, files: [{ path: '.lerret/a.jsx', text: 'x' }, { path: '.lerret/big.png', lazy: '6:1' }] } };
      }
      if (name === 'lerret_blob') {
        return { structuredContent: args.from ? { base64: b64('def'), next: null } : { base64: b64('abc'), next: 4 } };
      }
      return { structuredContent: {} };
    },
  };
}

describe('embed bridge', () => {
  it('loads text up front and leaves binaries for loadBlob', async () => {
    const app = fakeApp();
    const bridge = createEmbedBridge(app);
    const { files, lazy } = await bridge.loadFiles();
    expect(files).toEqual({ '.lerret/a.jsx': 'x' });
    expect(lazy).toEqual({ '.lerret/big.png': '6:1' });
    expect(app.calls).not.toContain('lerret_blob');
    expect(new TextDecoder().decode(await bridge.loadBlob('.lerret/big.png'))).toBe('abcdef');
  });

  it('fetches a binary before the first read', async () => {
    const memory = createMemoryBackend({ '.lerret/big.png': new Uint8Array(0) });
    const fetched = [];
    const fs = createSyncedBackend(memory, {}, () => {}, async (p) => {
      fetched.push(p);
      await memory.writeFile(p, new Uint8Array([1, 2]));
    });
    expect(await fs.readFile('.lerret/big.png', { encoding: 'binary' })).toEqual(new Uint8Array([1, 2]));
    expect(fetched).toEqual(['.lerret/big.png']);
  });
});

describe('image resolver', () => {
  it('fetches an image only when an <img> asks for it', async () => {
    const { startImageResolver } = await import('./embed-media.js');
    const files = new Map([['.lerret/social/photo.png', new Uint8Array(0)], ['.lerret/other.png', new Uint8Array(0)]]);
    const loads = [];
    const root = document.createElement('div');
    const stop = startImageResolver(() => files, root, {}, async (path) => {
      loads.push(path);
      return new Uint8Array([137, 80, 78, 71]);
    });
    const img = document.createElement('img');
    img.setAttribute('src', './photo.png');
    root.appendChild(img);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(img.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(loads).toEqual(['.lerret/social/photo.png']);
    stop();
  });
});
