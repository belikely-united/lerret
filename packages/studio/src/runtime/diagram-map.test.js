// diagram-map.test.js — `_index.mmd` arranges a folder's canvas (Mermaid Phase 4).

import { describe, expect, it } from 'vitest';
import { preparePageMap, starterPageMap, isPageMap, MAP_PLACEHOLDER } from './diagram-map.js';

const ab = (name, ext = '.jsx', width = 400, height = 300) => ({ id: `/p/.lerret/pg/${name}${ext}`, name, width, height });

describe('preparePageMap', () => {
  it('turns every node named after an artboard into a hole of its size', () => {
    const { text, nodes } = preparePageMap('flowchart LR\n  og-card --> x-banner\n  x-banner --> other[Other]\n', [ab('og-card', '.jsx', 1200, 630), ab('x-banner'), ab('notes', '.md')]);
    expect(nodes).toEqual([
      { id: 'og-card', slotId: '/p/.lerret/pg/og-card.jsx', width: 1200, height: 630 },
      { id: 'x-banner', slotId: '/p/.lerret/pg/x-banner.jsx', width: 400, height: 300 },
    ]);
    expect(text).toContain(`og-card@{ img: "${MAP_PLACEHOLDER}", label: "", w: 1200, h: 630 }`);
    expect(text).not.toContain('notes@{');
  });

  it('does not match a name inside a longer id, but does next to arrows', () => {
    expect(preparePageMap('flowchart LR\n  og-card --> b\n', [ab('card'), ab('og')]).nodes).toEqual([]);
    expect(preparePageMap('graph TD\n  a-->og-card\n', [ab('og-card')]).nodes.map((n) => n.id)).toEqual(['og-card']);
  });

  it('leaves non-flowcharts and unsafe names alone; reads past frontmatter', () => {
    expect(preparePageMap('sequenceDiagram\n  A->>B: hi\n', [ab('A')]).nodes).toEqual([]);
    expect(preparePageMap('flowchart LR\n  a\n', [{ id: '/x', name: 'Image 1', width: 1, height: 1 }]).nodes).toEqual([]);
    expect(preparePageMap('---\nconfig:\n  theme: base\n---\nflowchart LR\n  a --> og\n', [ab('og')]).nodes).toHaveLength(1);
  });
});

describe('starterPageMap / isPageMap', () => {
  it('lists the folder assets as nodes, without the map itself', () => {
    const text = starterPageMap([{ name: 'og-card' }, { name: '_index', fileName: '_index.mmd' }, { name: 'Image 1' }]);
    expect(text).toContain('flowchart LR\n  og-card\n');
    expect(text).not.toContain('  _index');
    expect(isPageMap({ fileName: '_index.mmd' })).toBe(true);
    expect(isPageMap({ fileName: 'flow.mmd' })).toBe(false);
  });
});
