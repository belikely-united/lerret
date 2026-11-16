// diagram-render.test.js — Mermaid diagram entries (spec-mermaid-diagrams.md).
// Mermaid itself needs a real layout engine, so the renderer is injected.

import { describe, expect, it } from 'vitest';
import { svgSize, DIAGRAM_PADDING } from './diagram-render.js';
import { makeDiagramEntry, assetRuntimeStatus } from './asset-runtime.js';

const asset = { kind: 'asset', name: 'flow', fileName: 'flow.mmd', path: '/p/.lerret/a/flow.mmd', assetKind: 'diagram', ext: '.mmd' };

describe('svgSize', () => {
  it('reads the size from the viewBox', () => {
    expect(svgSize('<svg viewBox="-8 -8 120.4 64" width="100%">')).toEqual({ width: 121, height: 64 });
  });
  it('returns null without a usable viewBox', () => {
    expect(svgSize('<svg width="10">')).toBeNull();
  });
});

describe('makeDiagramEntry', () => {
  it('sizes the artboard to the diagram plus padding', async () => {
    const entry = await makeDiagramEntry(asset, 'flowchart LR\n a-->b', async () => ({ svg: '<svg/>', width: 100, height: 50 }));
    expect(entry.status).toBe(assetRuntimeStatus.OK);
    expect(entry.dimensions).toEqual({ width: 100 + 2 * DIAGRAM_PADDING, height: 50 + 2 * DIAGRAM_PADDING });
    expect(entry.id).toBe(asset.path);
  });

  it('turns a Mermaid error into an error entry with its message', async () => {
    const entry = await makeDiagramEntry(asset, 'flowchart ???', async () => {
      throw new Error('Parse error on line 1');
    });
    expect(entry.status).toBe(assetRuntimeStatus.ERROR);
    expect(entry.error).toEqual({ phase: 'evaluate', message: 'Parse error on line 1' });
  });

  it('shows an empty file as an empty card without rendering', async () => {
    let called = false;
    const entry = await makeDiagramEntry(asset, '  \n', async () => { called = true; });
    expect(called).toBe(false);
    expect(entry.status).toBe(assetRuntimeStatus.OK);
  });
});
