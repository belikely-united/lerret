// Tests for `variants.js` — the pure resolver of an asset module's
// component-valued exports into variant artboards (FR10).
//
// `resolveVariants` is pure: it takes a plain `{ default, ...named }` exports
// object — exactly what the studio's asset-runtime hands it after loading a
// module. So every test passes a plain object; no module loading is involved.

import { describe, it, expect } from 'vitest';

import { resolveVariants } from './variants.js';

// A couple of trivial "components" — at the value level a React component is
// just a function (or class), which is all `resolveVariants` checks for.
const Primary = () => null;
const Dark = () => null;
const Compact = () => null;
class ClassComponent {}

describe('resolveVariants — single default export', () => {
  it('resolves a lone default export to one primary variant', () => {
    const variants = resolveVariants({ default: Primary });

    expect(variants).toHaveLength(1);
    expect(variants[0]).toEqual({
      exportName: 'default',
      variantName: 'default',
      isPrimary: true,
      component: Primary,
    });
  });

  it('accepts a class component as the default export', () => {
    const variants = resolveVariants({ default: ClassComponent });

    expect(variants).toHaveLength(1);
    expect(variants[0].component).toBe(ClassComponent);
    expect(variants[0].isPrimary).toBe(true);
  });
});

describe('resolveVariants — multiple named-export variants', () => {
  it('treats each component-valued named export as its own variant (1..N per file)', () => {
    const variants = resolveVariants({ default: Primary, Dark, Compact });

    expect(variants).toHaveLength(3);
    // The default export leads and is the only primary variant.
    expect(variants[0]).toMatchObject({
      exportName: 'default',
      variantName: 'default',
      isPrimary: true,
      component: Primary,
    });
    // Named exports follow, each non-primary, named by its export identifier.
    expect(variants[1]).toMatchObject({
      exportName: 'Dark',
      variantName: 'Dark',
      isPrimary: false,
      component: Dark,
    });
    expect(variants[2]).toMatchObject({
      exportName: 'Compact',
      variantName: 'Compact',
      isPrimary: false,
      component: Compact,
    });
  });

  it('resolves named-only exports (no default) to all-non-primary variants', () => {
    const variants = resolveVariants({ Dark, Compact });

    expect(variants).toHaveLength(2);
    expect(variants.some((v) => v.isPrimary)).toBe(false);
    expect(variants.map((v) => v.variantName)).toEqual(['Dark', 'Compact']);
  });

  it('skips the reserved `meta` export and any non-function export', () => {
    const variants = resolveVariants({
      default: Primary,
      Dark,
      meta: { label: 'not a variant' }, // metadata — parsed by meta.js
      VERSION: '1.0.0', // a re-exported constant — not a component
      count: 42,
    });

    expect(variants.map((v) => v.variantName)).toEqual(['default', 'Dark']);
  });

  it('skips a function exported under the reserved `meta` name', () => {
    // `meta` is reserved for metadata; even a function there is not a variant.
    const variants = resolveVariants({ default: Primary, meta: () => ({}) });

    expect(variants).toHaveLength(1);
    expect(variants[0].variantName).toBe('default');
  });
});

describe('resolveVariants — malformed / empty input', () => {
  it('returns an empty array for a module with no component-valued export', () => {
    expect(resolveVariants({ meta: { label: 'x' }, NOT_A_COMPONENT: 7 })).toEqual([]);
  });

  it('returns an empty array for null / undefined / non-object input', () => {
    expect(resolveVariants(null)).toEqual([]);
    expect(resolveVariants(undefined)).toEqual([]);
    expect(resolveVariants('not an object')).toEqual([]);
    expect(resolveVariants(123)).toEqual([]);
  });

  it('returns an empty array for an empty exports object', () => {
    expect(resolveVariants({})).toEqual([]);
  });
});
