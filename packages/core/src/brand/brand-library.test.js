// brand-library.test.js — the brand file, linked references, config vars.

import { describe, expect, it } from 'vitest';

import {
  brandId,
  parseBrand,
  fontStack,
  colorRef,
  fontRef,
  linkedVarKey,
  mergeBrandVars,
  logoPathFrom,
} from './brand-library.js';

const brand = {
  colors: [{ id: 'primary', name: 'Primary', value: '#2F5BFF' }],
  fonts: [{ id: 'heading', name: 'Heading', family: 'Playfair Display' }],
  logos: [{ id: 'logo', name: 'Logo', file: 'logo.png' }],
};

describe('brandId', () => {
  it('slugs a name and stays unique', () => {
    expect(brandId('Primary Blue')).toBe('primary-blue');
    expect(brandId('Primary Blue', ['primary-blue'])).toBe('primary-blue-2');
    expect(brandId('!!!')).toBe('item');
  });
});

describe('parseBrand', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const json = JSON.stringify({
      colors: [...brand.colors, { id: 'Bad Id', name: 'x', value: '#000' }, { id: 'empty', name: 'e', value: '' }],
      fonts: brand.fonts,
      logos: [...brand.logos, { id: 'evil', name: 'e', file: '../secret.png' }],
    });
    expect(parseBrand(json)).toEqual(brand);
    expect(parseBrand('nope')).toEqual({ colors: [], fonts: [], logos: [] });
  });
});

describe('linked references', () => {
  it('a colour or font links to its var with the current value as fallback', () => {
    expect(colorRef(brand.colors[0])).toBe('var(--brand-primary, #2F5BFF)');
    expect(fontRef(brand.fonts[0])).toBe("var(--brand-font-heading, 'Playfair Display', serif)");
    expect(fontStack('Inter')).toBe('Inter, sans-serif');
    expect(linkedVarKey('var(--brand-primary, #2F5BFF)')).toBe('brand-primary');
    expect(linkedVarKey('#2F5BFF')).toBeNull();
  });

  it('mirrors the library into config vars, replacing only brand-* keys', () => {
    const vars = { accent: '#f00', 'brand-old': '#000' };
    expect(mergeBrandVars(vars, brand)).toEqual({
      accent: '#f00',
      'brand-primary': '#2F5BFF',
      'brand-font-heading': "'Playfair Display', serif",
    });
  });

  it('reaches the library from a page or a nested group', () => {
    expect(logoPathFrom('/p/.lerret/awards', '/p/.lerret', 'logo.png')).toBe('../_brand/logo.png');
    expect(logoPathFrom('/p/.lerret/awards/2026/', '/p/.lerret/', 'logo.png')).toBe('../../_brand/logo.png');
  });
});
