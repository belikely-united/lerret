// Tests for `resolveVariantData`.
//
// All tests are pure — no filesystem access, no DOM, no Node built-ins.
// Coverage maps to the four acceptance criteria plus edge cases:
//
//   AC1 — Fully-keyed: all variants have matching keys in the data object.
//   AC2 — Flat/shared: data is a plain object with NO key matching any export.
//   AC3 — Partial coverage: some variants keyed, others absent.
//   AC4 — Stray key: a data key that matches no export → console.warn, no throw.
//   Edge — AssetData.source === 'absent' → every variant 'absent', no warning.
//   Edge — AssetData.source === 'js' (value already resolved) → treated same as 'json'.
//   Edge — variantExportNames includes 'default' (primary variant).
//   Edge — data value is not a plain object (null, array, primitive) → shared.
//   Edge — empty variantExportNames array → empty Map returned.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { resolveVariantData } from './variant-data.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `AssetData` record with `source === 'json'` and the given
 * value, mimicking what `loadAssetData` returns for a parsed JSON data file.
 *
 * @param {unknown} value
 * @returns {import('./loader.js').AssetData}
 */
function jsonAssetData(value) {
  return { source: 'json', value, dataPath: '/project/Asset.data.json' };
}

/**
 * Build a minimal `AssetData` record with `source === 'js'` and a value
 * already resolved (as the studio runtime would do before calling this fn).
 *
 * @param {unknown} value
 * @returns {import('./loader.js').AssetData}
 */
function jsAssetData(value) {
  return { source: 'js', value, dataPath: '/project/Asset.data.js' };
}

/** @type {import('./loader.js').AssetData} */
const ABSENT_DATA = { source: 'absent' };

// ---------------------------------------------------------------------------
// AC1 — Fully-keyed
// ---------------------------------------------------------------------------

describe('resolveVariantData — AC1: fully-keyed data', () => {
  it('returns keyed records for every variant when all have matching keys', () => {
    const data = jsonAssetData({
      default: { title: 'Default version' },
      Dark: { title: 'Dark version' },
      Compact: { title: 'Compact version' },
    });
    const exportNames = ['default', 'Dark', 'Compact'];

    const result = resolveVariantData(data, exportNames);

    expect(result.size).toBe(3);

    expect(result.get('default')).toEqual({ source: 'keyed', value: { title: 'Default version' } });
    expect(result.get('Dark')).toEqual({ source: 'keyed', value: { title: 'Dark version' } });
    expect(result.get('Compact')).toEqual({ source: 'keyed', value: { title: 'Compact version' } });
  });

  it('handles a single variant with a keyed data object', () => {
    const data = jsonAssetData({ default: { label: 'Hello' } });
    const result = resolveVariantData(data, ['default']);

    expect(result.get('default')).toEqual({ source: 'keyed', value: { label: 'Hello' } });
  });

  it('includes the keyed value even when it is not a plain object (e.g. a string)', () => {
    // A keyed value can be anything — a string, number, etc.
    const data = jsonAssetData({ Dark: 'dark-theme' });
    const result = resolveVariantData(data, ['default', 'Dark']);

    // 'default' has no matching key → absent (partial-coverage sub-case)
    expect(result.get('default')).toEqual({ source: 'absent' });
    expect(result.get('Dark')).toEqual({ source: 'keyed', value: 'dark-theme' });
  });
});

// ---------------------------------------------------------------------------
// AC2 — Flat/shared data
// ---------------------------------------------------------------------------

describe('resolveVariantData — AC2: flat/shared data', () => {
  it('applies the whole value as shared to every variant when no key matches', () => {
    const data = jsonAssetData({ headline: 'Welcome', subtitle: 'Hello world' });
    const exportNames = ['default', 'Dark'];

    const result = resolveVariantData(data, exportNames);

    expect(result.size).toBe(2);
    expect(result.get('default')).toEqual({
      source: 'shared',
      value: { headline: 'Welcome', subtitle: 'Hello world' },
    });
    expect(result.get('Dark')).toEqual({
      source: 'shared',
      value: { headline: 'Welcome', subtitle: 'Hello world' },
    });
  });

  it('treats a flat object with unrelated keys as shared even for a single variant', () => {
    const data = jsonAssetData({ bg: '#fff', fg: '#000' });
    const result = resolveVariantData(data, ['default']);

    expect(result.get('default')).toEqual({
      source: 'shared',
      value: { bg: '#fff', fg: '#000' },
    });
  });

  it('shared mode does NOT emit a console.warn for data keys', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({ unrelated: 'value' });

    resolveVariantData(data, ['default', 'Dark']);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC3 — Partial coverage
// ---------------------------------------------------------------------------

describe('resolveVariantData — AC3: partial coverage', () => {
  it('gives keyed data to matched variants and absent to unmatched ones', () => {
    const data = jsonAssetData({
      Dark: { theme: 'dark' },
      // 'default' and 'Compact' are not in the data
    });
    const exportNames = ['default', 'Dark', 'Compact'];

    const result = resolveVariantData(data, exportNames);

    expect(result.size).toBe(3);
    expect(result.get('default')).toEqual({ source: 'absent' });
    expect(result.get('Dark')).toEqual({ source: 'keyed', value: { theme: 'dark' } });
    expect(result.get('Compact')).toEqual({ source: 'absent' });
  });

  it('does not error when only one variant is matched (rest are absent)', () => {
    // Both 'Dark' and 'Compact' are in the data; 'Dark' is in exportNames but
    // 'Compact' is a stray key. 'default' is in exportNames but not in data.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({ Dark: { x: 1 }, Compact: { y: 2 } });
    const result = resolveVariantData(data, ['default', 'Dark']);

    // 'Dark' matched → keyed; 'default' not in data → absent; 'Compact' is stray.
    expect(result.get('Dark')).toEqual({ source: 'keyed', value: { x: 1 } });
    expect(result.get('default')).toEqual({ source: 'absent' });
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('"Compact"');
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// AC4 — Stray keys
// ---------------------------------------------------------------------------

describe('resolveVariantData — AC4: stray keys in data', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a console.warn for each stray key and does not throw', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({
      default: { a: 1 },
      strayKey: { b: 2 }, // no export named 'strayKey'
    });
    const exportNames = ['default'];

    const result = resolveVariantData(data, exportNames, { assetPath: '/project/Asset.jsx' });

    // Should not throw and should still return correct results.
    expect(result.get('default')).toEqual({ source: 'keyed', value: { a: 1 } });

    // Warn must mention the stray key.
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('"strayKey"');
    expect(warnSpy.mock.calls[0][0]).toContain('/project/Asset.jsx');
  });

  it('warns for multiple stray keys independently', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({
      default: { label: 'Main' },
      foo: 1,
      bar: 2,
    });
    const exportNames = ['default'];

    resolveVariantData(data, exportNames);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((c) => c[0]);
    expect(messages.some((m) => m.includes('"foo"'))).toBe(true);
    expect(messages.some((m) => m.includes('"bar"'))).toBe(true);
  });

  it('stray keys do not affect the resolved values for matched variants', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({
      Dark: { theme: 'dark' },
      ghost: { invisible: true }, // stray
    });
    const exportNames = ['default', 'Dark'];

    const result = resolveVariantData(data, exportNames);

    expect(result.get('Dark')).toEqual({ source: 'keyed', value: { theme: 'dark' } });
    expect(result.get('default')).toEqual({ source: 'absent' });
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('does not warn when assetPath is omitted — warning still mentions the key', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = jsonAssetData({ default: { a: 1 }, stray: 99 });

    resolveVariantData(data, ['default']); // no assetPath option

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('"stray"');
  });
});

// ---------------------------------------------------------------------------
// Edge — AssetData.source === 'absent'
// ---------------------------------------------------------------------------

describe('resolveVariantData — Edge: absent AssetData', () => {
  it('returns absent for every variant when source is absent', () => {
    const result = resolveVariantData(ABSENT_DATA, ['default', 'Dark', 'Compact']);

    expect(result.size).toBe(3);
    for (const record of result.values()) {
      expect(record).toEqual({ source: 'absent' });
    }
  });

  it('does not emit any console.warn for absent data', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveVariantData(ABSENT_DATA, ['default', 'Dark']);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns an empty map for absent data with no variant names', () => {
    const result = resolveVariantData(ABSENT_DATA, []);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge — AssetData.source === 'js'
// ---------------------------------------------------------------------------

describe('resolveVariantData — Edge: js source (value already resolved)', () => {
  it('treats js source data the same as json source (keyed mode)', () => {
    const data = jsAssetData({
      default: { computed: true },
      Dark: { computed: false },
    });
    const result = resolveVariantData(data, ['default', 'Dark']);

    expect(result.get('default')).toEqual({ source: 'keyed', value: { computed: true } });
    expect(result.get('Dark')).toEqual({ source: 'keyed', value: { computed: false } });
  });

  it('treats js source data the same as json source (shared mode)', () => {
    const data = jsAssetData({ bg: 'blue' });
    const result = resolveVariantData(data, ['default', 'Dark']);

    expect(result.get('default')).toEqual({ source: 'shared', value: { bg: 'blue' } });
    expect(result.get('Dark')).toEqual({ source: 'shared', value: { bg: 'blue' } });
  });

  it('absent js source (value undefined) → all absent', () => {
    const data = /** @type {import('./loader.js').AssetData} */ ({ source: 'absent' });
    const result = resolveVariantData(data, ['default']);
    expect(result.get('default')).toEqual({ source: 'absent' });
  });
});

// ---------------------------------------------------------------------------
// Edge — non-object data values
// ---------------------------------------------------------------------------

describe('resolveVariantData — Edge: non-plain-object data values', () => {
  it('treats null value as shared (no key matching possible)', () => {
    const data = jsonAssetData(null);
    const result = resolveVariantData(data, ['default', 'Dark']);

    expect(result.get('default')).toEqual({ source: 'shared', value: null });
    expect(result.get('Dark')).toEqual({ source: 'shared', value: null });
  });

  it('treats an array value as shared', () => {
    const items = [{ label: 'A' }, { label: 'B' }];
    const data = jsonAssetData(items);
    const result = resolveVariantData(data, ['default']);

    expect(result.get('default')).toEqual({ source: 'shared', value: items });
  });

  it('treats a primitive string value as shared', () => {
    const data = jsonAssetData('just a string');
    const result = resolveVariantData(data, ['default', 'Dark']);

    expect(result.get('default')).toEqual({ source: 'shared', value: 'just a string' });
    expect(result.get('Dark')).toEqual({ source: 'shared', value: 'just a string' });
  });
});

// ---------------------------------------------------------------------------
// Edge — empty variantExportNames
// ---------------------------------------------------------------------------

describe('resolveVariantData — Edge: empty variantExportNames', () => {
  it('returns an empty Map when no export names are provided', () => {
    const data = jsonAssetData({ default: { x: 1 } });
    const result = resolveVariantData(data, []);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge — null / undefined assetData guard
// ---------------------------------------------------------------------------

describe('resolveVariantData — Edge: null/undefined assetData', () => {
  it('treats null assetData as absent', () => {
    const result = resolveVariantData(/** @type {any} */ (null), ['default']);
    expect(result.get('default')).toEqual({ source: 'absent' });
  });

  it('treats undefined assetData as absent', () => {
    const result = resolveVariantData(/** @type {any} */ (undefined), ['default', 'Dark']);
    expect(result.get('default')).toEqual({ source: 'absent' });
    expect(result.get('Dark')).toEqual({ source: 'absent' });
  });
});
