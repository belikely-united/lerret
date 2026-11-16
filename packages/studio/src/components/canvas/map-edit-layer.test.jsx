import { describe, expect, it } from 'vitest';
import { connectName } from './map-edit-layer.jsx';
import { firstPageMap, listEdges } from '../../runtime/diagram-map.js';

describe('connectName', () => {
  it('names a card of this folder by its asset name', () => {
    expect(connectName('launch/socials/recap.jsx', 'launch/socials')).toBe('recap');
    expect(connectName('launch/notes.md', 'launch')).toBe('notes');
  });
  it('skips other folders, the map itself and unusable names', () => {
    expect(connectName('launch/socials/recap.jsx', 'launch')).toBeNull();
    expect(connectName('launch/_index.mmd', 'launch')).toBeNull();
    expect(connectName('launch/My Card.jsx', 'launch')).toBeNull();
    expect(connectName('', 'launch')).toBeNull();
  });
});

describe('firstPageMap', () => {
  it('is a left-to-right flowchart with just that arrow', () => {
    const text = firstPageMap('teaser', 'recap');
    expect(text).toContain('\nflowchart LR\n');
    expect(listEdges(text).map((e) => e.id)).toEqual(['L_teaser_recap_0']);
  });
});
