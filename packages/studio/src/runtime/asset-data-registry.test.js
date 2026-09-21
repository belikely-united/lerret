// asset-data-registry.test.js
//
// The whole point of the registry is the THREE-WAY answer: a path, `null`
// ("server says this asset has none"), and `undefined` ("server did not
// answer"). Collapsing the last two is what would silently reintroduce the
// 404-per-artboard probe — or, worse, suppress data loading for a CLI too old
// to send the map.

import { describe, it, expect, beforeEach } from 'vitest';

import { setAssetDataEntries, getAssetDataPath } from './asset-data-registry.js';

describe('asset-data-registry', () => {
  beforeEach(() => {
    setAssetDataEntries(null);
  });

  it('returns undefined when no map is registered (caller must fall back to probing)', () => {
    expect(getAssetDataPath('/p/.lerret/brand/Card.jsx')).toBeUndefined();
  });

  it('returns the recorded data path for an asset that has one', () => {
    setAssetDataEntries([
      ['/p/.lerret/brand/Card.jsx', '/p/.lerret/brand/Card.data.json'],
      ['/p/.lerret/live/Clock.jsx', '/p/.lerret/live/Clock.data.js'],
    ]);
    expect(getAssetDataPath('/p/.lerret/brand/Card.jsx')).toBe('/p/.lerret/brand/Card.data.json');
    expect(getAssetDataPath('/p/.lerret/live/Clock.jsx')).toBe('/p/.lerret/live/Clock.data.js');
  });

  it('returns null — not undefined — for an asset absent from a registered map', () => {
    // This is the case that kills the 404: the server answered, and the answer
    // is "no data file". `undefined` here would send the caller back to probing.
    setAssetDataEntries([['/p/.lerret/brand/Card.jsx', '/p/.lerret/brand/Card.data.json']]);
    expect(getAssetDataPath('/p/.lerret/social/Og.jsx')).toBeNull();
  });

  it('treats an empty array as a real answer: every asset has no data file', () => {
    setAssetDataEntries([]);
    expect(getAssetDataPath('/p/.lerret/anything.jsx')).toBeNull();
  });

  it('clears back to the probing fallback when handed a non-array', () => {
    setAssetDataEntries([['/p/.lerret/a.jsx', '/p/.lerret/a.data.json']]);
    expect(getAssetDataPath('/p/.lerret/a.jsx')).toBe('/p/.lerret/a.data.json');
    // An older CLI's virtual module has no `assetDataEntries` export at all.
    setAssetDataEntries(undefined);
    expect(getAssetDataPath('/p/.lerret/a.jsx')).toBeUndefined();
  });

  it('replaces the map wholesale on re-registration (watcher delivered a new set)', () => {
    setAssetDataEntries([['/p/.lerret/a.jsx', '/p/.lerret/a.data.json']]);
    // The user deleted a.data.json and added b.data.js.
    setAssetDataEntries([['/p/.lerret/b.jsx', '/p/.lerret/b.data.js']]);
    expect(getAssetDataPath('/p/.lerret/a.jsx')).toBeNull();
    expect(getAssetDataPath('/p/.lerret/b.jsx')).toBe('/p/.lerret/b.data.js');
  });
});
