// brand-library.test.js — the brand file (v2 + v1 migration), linked
// references, config vars, roles.

import { describe, expect, it } from 'vitest';

import {
  brandId,
  parseBrand,
  starterBrand,
  fontStack,
  colorRef,
  textStyleRefs,
  linkedVarKey,
  linkedTextStyleId,
  mergeBrandVars,
  logoPathFrom,
  brandRoles,
  logoVariantFor,
} from './brand-library.js';

const brand = {
  version: 2,
  app: { name: 'Acme' },
  colors: [
    { id: 'primary', name: 'Primary', value: '#2F5BFF' },
    { id: 'ink', name: 'Ink', value: '#111111' },
    { id: 'paper', name: 'Paper', value: '#FAFAFA' },
  ],
  textStyles: [{ id: 'h1', name: 'Heading 1', family: 'Playfair Display', size: 96, weight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' }],
  logos: [{ id: 'logo', name: 'Logo', kind: 'full', variants: [{ id: 'color', label: 'Colour', file: 'logo.png' }, { id: 'light', label: 'Light', file: 'logo-light.png' }] }],
};

describe('brandId', () => {
  it('slugs a name and stays unique', () => {
    expect(brandId('Primary Blue')).toBe('primary-blue');
    expect(brandId('Primary Blue', ['primary-blue'])).toBe('primary-blue-2');
    expect(brandId('!!!')).toBe('item');
  });
});

describe('parseBrand', () => {
  it('round-trips a v2 library and drops malformed entries', () => {
    const json = JSON.stringify({
      ...brand,
      setup: 'done',
      colors: [...brand.colors, { id: 'Bad Id', name: 'x', value: '#000' }],
      logos: [...brand.logos, { id: 'evil', name: 'e', variants: [{ id: 'x', label: 'x', file: '../secret.png' }] }],
    });
    expect(parseBrand(json)).toEqual({ ...brand, setup: 'done' });
    expect(parseBrand('nope')).toEqual({ version: 2, app: {}, colors: [], textStyles: [], logos: [] });
  });

  it('migrates a v1 library: fonts → text styles, single-file logos → one variant', () => {
    const v1 = JSON.stringify({
      colors: [{ id: 'primary', name: 'Primary', value: '#2F5BFF' }],
      fonts: [{ id: 'heading', name: 'Heading', family: 'Poppins' }],
      logos: [{ id: 'logo', name: 'Logo', file: 'logo.png' }],
    });
    const b = parseBrand(v1);
    expect(b.textStyles).toEqual([{ id: 'heading', name: 'Heading', family: 'Poppins', size: 64, weight: 700, lineHeight: 1.15, letterSpacing: '0em' }]);
    expect(b.logos).toEqual([{ id: 'logo', name: 'Logo', kind: 'full', variants: [{ id: 'default', label: 'Default', file: 'logo.png' }] }]);
  });

  it('a starter library has the five default text styles', () => {
    expect(starterBrand().textStyles.map((s) => s.name)).toEqual(['Display', 'Heading 1', 'Heading 2', 'Body', 'Caption']);
  });
});

describe('linked references', () => {
  it('colours and text styles link to vars with current values as fallback', () => {
    expect(colorRef(brand.colors[0])).toBe('var(--brand-primary, #2F5BFF)');
    expect(textStyleRefs(brand.textStyles[0], 1.5)).toEqual({
      fontFamily: "var(--brand-text-h1-font, 'Playfair Display', serif)",
      fontSize: 'calc(var(--brand-text-h1-size, 96) * 1.5px)',
      fontWeight: 'var(--brand-text-h1-weight, 700)',
      lineHeight: 'var(--brand-text-h1-line, 1.1)',
      letterSpacing: 'var(--brand-text-h1-tracking, -0.01em)',
    });
    expect(fontStack('Inter')).toBe('Inter, sans-serif');
    expect(linkedVarKey('var(--brand-primary, #2F5BFF)')).toBe('brand-primary');
    expect(linkedVarKey('calc(var(--brand-text-h1-size, 96) * 1px)')).toBe('brand-text-h1-size');
    expect(linkedTextStyleId("var(--brand-text-h1-font, 'X', serif)")).toBe('h1');
    expect(linkedVarKey('#2F5BFF')).toBeNull();
  });

  it('mirrors the library into config vars, replacing only brand-* keys', () => {
    const vars = mergeBrandVars({ accent: '#f00', 'brand-old': '#000' }, brand);
    expect(vars.accent).toBe('#f00');
    expect(vars['brand-old']).toBeUndefined();
    expect(vars['brand-primary']).toBe('#2F5BFF');
    expect(vars['brand-text-h1-font']).toBe("'Playfair Display', serif");
    expect(vars['brand-text-h1-size']).toBe(96);
    expect(vars['brand-text-h1-tracking']).toBe('-0.01em');
  });

  it('reaches the library from a page or a nested group', () => {
    expect(logoPathFrom('/p/.lerret/awards', '/p/.lerret', 'logo.png')).toBe('../_brand/logo.png');
    expect(logoPathFrom('/p/.lerret/awards/2026/', '/p/.lerret/', 'logo.png')).toBe('../../_brand/logo.png');
  });
});

describe('brandRoles + logoVariantFor', () => {
  it('picks primary/ink/paper colours, the headline style and the full logo', () => {
    const r = brandRoles(brand);
    expect([r.primary.id, r.ink.id, r.paper.id, r.headline.id, r.logo.id]).toEqual(['primary', 'ink', 'paper', 'h1', 'logo']);
  });

  it('uses a light logo variant on dark backgrounds and the colour one on light', () => {
    expect(logoVariantFor(brand.logos[0], true).id).toBe('light');
    expect(logoVariantFor(brand.logos[0], false).id).toBe('color');
  });
});
