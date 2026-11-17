// model-render.test.js — 3D model entries (spec-3d-models.md).
// WebGL isn't available in jsdom, so the renderer is injected.

import { describe, expect, it } from 'vitest';
import { inlineGltfResources, modelExt, MODEL_NEUTRAL, MODEL_SIZE } from './model-render.js';
import { makeModelEntry, assetRuntimeStatus } from './asset-runtime.js';

const asset = { kind: 'asset', name: 'chair', fileName: 'chair.GLB', path: '/p/.lerret/a/chair.GLB', assetKind: 'model', ext: '.glb' };
const bytes = new Uint8Array([1, 2, 3]);

describe('modelExt', () => {
  it('lower-cases the extension', () => {
    expect(modelExt('Chair.GLB')).toBe('.glb');
    expect(modelExt('noext')).toBe('');
  });
});

describe('inlineGltfResources', () => {
  const gltf = JSON.stringify({
    buffers: [{ uri: 'bin/chair.bin', byteLength: 3 }],
    images: [{ uri: '../tex/wood%20grain.png', mimeType: 'image/png' }, { uri: 'data:image/png;base64,AA==' }],
  });

  it('inlines relative side files as data URLs, resolved from the .gltf folder', async () => {
    const read = [];
    const out = JSON.parse(await inlineGltfResources(gltf, '/p/.lerret/a', async (p) => { read.push(p); return bytes; }));
    expect(read).toEqual(['/p/.lerret/a/bin/chair.bin', '/p/.lerret/tex/wood grain.png']);
    expect(out.buffers[0].uri).toBe('data:application/octet-stream;base64,AQID');
    expect(out.images[0].uri).toBe('data:image/png;base64,AQID');
    expect(out.images[1].uri).toBe('data:image/png;base64,AA=='); // already inline: untouched
  });

  it('names a missing side file', async () => {
    await expect(inlineGltfResources(gltf, '/p/.lerret/a', async () => null)).rejects.toThrow('Missing file "bin/chair.bin"');
  });
});

describe('makeModelEntry', () => {
  it('renders a fixed-size artboard with the neutral look when there is no brand', async () => {
    let seen;
    const entry = await makeModelEntry(asset, bytes, { render: async (m) => { seen = m; return 'data:image/png;base64,x'; } });
    expect(entry.status).toBe(assetRuntimeStatus.OK);
    expect(entry.dimensions).toEqual(MODEL_SIZE);
    expect(seen).toMatchObject({ ext: '.glb', bytes, folder: '/p/.lerret/a', ...MODEL_NEUTRAL });
  });

  it('takes the background and model colour from the folder brand', async () => {
    let seen;
    await makeModelEntry(asset, bytes, {
      getConfigFor: () => ({ vars: { paper: '#0F172A', ink: '#F8FAFC', accent: '#22D3EE' } }),
      render: async (m) => { seen = m; return ''; },
    });
    expect(seen.background).toBe('#0F172A');
    expect(seen.color).toBe('#22D3EE');
  });

  it('turns a parse failure into an error entry with its message', async () => {
    const entry = await makeModelEntry(asset, bytes, { render: async () => { throw new Error('Unexpected token'); } });
    expect(entry.status).toBe(assetRuntimeStatus.ERROR);
    expect(entry.error).toEqual({ phase: 'evaluate', message: 'Unexpected token' });
  });
});
