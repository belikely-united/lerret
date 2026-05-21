// Tests for `meta.js` — the pure parser of an asset module's `meta` export
// into the canonical {@link AssetMeta} shape (FR11).
//
// `parseMeta` is pure: it takes the plain value an asset module exported as
// `meta`, exactly as the studio's asset-runtime hands it over. Tests pass plain
// values; no module loading is involved.

import { describe, it, expect } from 'vitest';

import { parseMeta } from './meta.js';

describe('parseMeta — meta with all four fields', () => {
  it('reads dimensions, label, tags, and propsSchema by their exact camelCase names', () => {
    const propsSchema = { label: { type: 'string', default: 'Click me' } };
    const result = parseMeta({
      dimensions: { width: 320, height: 200 },
      label: 'Primary button',
      tags: ['button', 'cta'],
      propsSchema,
    });

    expect(result.dimensions).toEqual({ width: 320, height: 200 });
    expect(result.label).toBe('Primary button');
    expect(result.tags).toEqual(['button', 'cta']);
    // `propsSchema` is carried through verbatim — validation lives elsewhere.
    expect(result.propsSchema).toBe(propsSchema);
    expect(result.hasMeta).toBe(true);
    expect(result.error).toBeNull();
  });

  it('trims a label and drops empty / non-string tag entries', () => {
    const result = parseMeta({
      label: '  Spaced label  ',
      tags: ['keep', '', '  ', '  trimmed  ', 42, null, 'also-keep'],
    });

    expect(result.label).toBe('Spaced label');
    expect(result.tags).toEqual(['keep', 'trimmed', 'also-keep']);
  });
});

describe('parseMeta — missing meta', () => {
  it('returns documented defaults for an undefined meta — never an error (NFR8)', () => {
    const result = parseMeta(undefined);

    expect(result.dimensions).toEqual({ width: undefined, height: undefined });
    expect(result.label).toBeUndefined();
    expect(result.tags).toEqual([]);
    expect(result.propsSchema).toBeUndefined();
    expect(result.hasMeta).toBe(false);
    expect(result.error).toBeNull();
  });

  it('treats a null meta the same as a missing one', () => {
    const result = parseMeta(null);
    expect(result.hasMeta).toBe(false);
    expect(result.error).toBeNull();
    expect(result.tags).toEqual([]);
  });

  it('returns a fresh defaults object each call (callers cannot mutate shared state)', () => {
    const a = parseMeta(undefined);
    const b = parseMeta(undefined);
    expect(a).not.toBe(b);
    expect(a.tags).not.toBe(b.tags);
    expect(a.dimensions).not.toBe(b.dimensions);
  });
});

describe('parseMeta — partial meta', () => {
  it('keeps present fields and defaults absent ones', () => {
    const result = parseMeta({ dimensions: { width: 480, height: 320 } });

    expect(result.dimensions).toEqual({ width: 480, height: 320 });
    expect(result.label).toBeUndefined(); // absent → caller derives a fallback
    expect(result.tags).toEqual([]);
    expect(result.propsSchema).toBeUndefined();
    expect(result.hasMeta).toBe(true);
    expect(result.error).toBeNull();
  });

  it('defaults a single missing dimension axis without erroring', () => {
    const result = parseMeta({ dimensions: { width: 600 } });
    expect(result.dimensions).toEqual({ width: 600, height: undefined });
  });

  it('rejects invalid dimension values (zero, negative, NaN, string) per axis', () => {
    expect(parseMeta({ dimensions: { width: 0, height: 200 } }).dimensions).toEqual({
      width: undefined,
      height: 200,
    });
    expect(parseMeta({ dimensions: { width: -50, height: 200 } }).dimensions).toEqual({
      width: undefined,
      height: 200,
    });
    expect(parseMeta({ dimensions: { width: NaN, height: '200' } }).dimensions).toEqual({
      width: undefined,
      height: undefined,
    });
  });

  it('treats an empty-string or non-string label as absent', () => {
    expect(parseMeta({ label: '' }).label).toBeUndefined();
    expect(parseMeta({ label: '   ' }).label).toBeUndefined();
    expect(parseMeta({ label: 123 }).label).toBeUndefined();
  });

  it('defaults non-array tags and non-object dimensions / propsSchema', () => {
    const result = parseMeta({
      dimensions: 'not an object',
      tags: 'not an array',
      propsSchema: ['not', 'an', 'object'],
    });
    expect(result.dimensions).toEqual({ width: undefined, height: undefined });
    expect(result.tags).toEqual([]);
    expect(result.propsSchema).toBeUndefined();
    expect(result.hasMeta).toBe(true);
  });
});

describe('parseMeta — malformed meta', () => {
  it('returns defaults plus an error for a meta that is not an object', () => {
    const result = parseMeta('I am a string, not metadata');

    expect(result.hasMeta).toBe(false);
    expect(result.error).toMatch(/must be an object/i);
    // ... but the asset still gets usable defaults — it is not broken.
    expect(result.dimensions).toEqual({ width: undefined, height: undefined });
    expect(result.tags).toEqual([]);
  });

  it('treats an array meta as malformed', () => {
    const result = parseMeta(['dimensions', 'label']);
    expect(result.hasMeta).toBe(false);
    expect(result.error).toMatch(/array/i);
  });

  it('contains a throw raised while reading a meta field — defaults + an error', () => {
    // A hostile `meta` whose `dimensions` getter throws. `parseMeta` must not
    // let that escape: it would otherwise break sibling assets.
    const hostile = {};
    Object.defineProperty(hostile, 'dimensions', {
      enumerable: true,
      get() {
        throw new Error('exploding getter');
      },
    });

    let result;
    expect(() => {
      result = parseMeta(hostile);
    }).not.toThrow();
    expect(result.hasMeta).toBe(false);
    expect(result.error).toMatch(/exploding getter/);
    expect(result.tags).toEqual([]);
  });
});
