// diagram-render.test.js — Mermaid diagram entries (spec-mermaid-diagrams.md).
// Mermaid itself needs a real layout engine, so the renderer is injected.

import { describe, expect, it } from 'vitest';
import { svgSize, DIAGRAM_PADDING, flowAxis } from './diagram-render.js';
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
    const entry = await makeDiagramEntry(asset, 'flowchart LR\n a-->b', { render: async () => ({ svg: '<svg/>', width: 100, height: 50 }) });
    expect(entry.status).toBe(assetRuntimeStatus.OK);
    expect(entry.dimensions).toEqual({ width: 100 + 2 * DIAGRAM_PADDING, height: 50 + 2 * DIAGRAM_PADDING });
    expect(entry.id).toBe(asset.path);
  });

  it('turns a Mermaid error into an error entry with its message', async () => {
    const entry = await makeDiagramEntry(asset, 'flowchart ???', {
      render: async () => {
        throw new Error('Parse error on line 1');
      },
    });
    expect(entry.status).toBe(assetRuntimeStatus.ERROR);
    expect(entry.error).toEqual({ phase: 'evaluate', message: 'Parse error on line 1' });
  });

  it('shows an empty file as an empty card without rendering', async () => {
    let called = false;
    const entry = await makeDiagramEntry(asset, '  \n', { render: async () => { called = true; } });
    expect(called).toBe(false);
    expect(entry.status).toBe(assetRuntimeStatus.OK);
  });
});

describe('makeDiagramEntry — brand look and images (Phase 2)', () => {
  it('renders with the folder theme and inlines relative images', async () => {
    let seen;
    const entry = await makeDiagramEntry(asset, 'flowchart LR\n a@{ img: "../logo.png" }', {
      getConfigFor: (folder) => (folder === '/p/.lerret/a' ? { vars: { paper: '#0A0A0A', ink: '#FFFFFF' } } : {}),
      readImage: async (path) => (path === '/p/.lerret/logo.png' ? 'data:image/png;base64,AA==' : null),
      render: async (text, look) => {
        seen = { text, look };
        return { svg: '<svg/>', width: 10, height: 10 };
      },
    });
    expect(seen.text).toContain('img: "data:image/png;base64,AA=="');
    expect(seen.look.themeVariables).toMatchObject({ background: '#0A0A0A', textColor: '#FFFFFF', darkMode: true });
    expect(entry.status).toBe(assetRuntimeStatus.OK);
  });

  it('keeps the default look when the config getter throws', async () => {
    let look = 'unset';
    await makeDiagramEntry(asset, 'flowchart LR\n a', {
      getConfigFor: () => { throw new Error('bad config'); },
      render: async (_t, l) => { look = l; return { svg: '<svg/>', width: 1, height: 1 }; },
    });
    expect(look).toBeNull();
  });
});

describe('flowAxis', () => {
  it('reads the flow direction of a flowchart', () => {
    expect(flowAxis('flowchart LR\n  a --> b')).toBe('x');
    expect(flowAxis('graph RL;\n  a --> b')).toBe('x');
    expect(flowAxis('%% note\nflowchart TD\n  a --> b')).toBe('y');
    expect(flowAxis('---\ntitle: x\n---\nflowchart\n  a --> b')).toBe('y');
  });
  it('leaves other diagrams and explicit curves alone', () => {
    expect(flowAxis('sequenceDiagram\n  a->>b: hi')).toBeNull();
    expect(flowAxis('---\nconfig:\n  flowchart:\n    curve: linear\n---\nflowchart LR\n  a --> b')).toBeNull();
  });
});
