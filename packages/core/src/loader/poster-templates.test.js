// poster-templates.test.js — templates and Add-menu elements must be valid,
// sized to the artboard, and keep their text in the data file.

import { describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';

import { POSTER_TEMPLATES, ELEMENTS, posterTemplateContent, elementJsx, IMAGE_SLOT_ATTR } from './poster-templates.js';

const parses = (code) => () => parse(code, { sourceType: 'module', plugins: ['jsx'] });

describe('posterTemplateContent', () => {
  for (const t of POSTER_TEMPLATES) {
    for (const dims of [{ width: 1320, height: 2868 }, { width: 2880, height: 1800 }]) {
      it(`${t.id} at ${dims.width}×${dims.height} is valid, sized, and data-driven`, () => {
        const out = posterTemplateContent(t.id, 'launch-1', dims);
        expect(parses(out.source)).not.toThrow();
        expect(out.source).toContain(`dimensions: { width: ${dims.width}, height: ${dims.height} }`);
        expect(out.source).toContain('{headline}');
        expect(out.source).toContain('{subheadline}');
        expect(JSON.parse(out.data)).toHaveProperty('headline');
      });
    }
  }

  it('phone templates include a screenshot slot', () => {
    expect(posterTemplateContent('headline-phone', 'x', { width: 1320, height: 2868 }).source).toContain(IMAGE_SLOT_ATTR);
    expect(posterTemplateContent('big-headline', 'x', { width: 1320, height: 2868 }).source).not.toContain(IMAGE_SLOT_ATTR);
  });

  it('returns null for an unknown template', () => {
    expect(posterTemplateContent('nope', 'x', { width: 100, height: 100 })).toBeNull();
  });
});

describe('elementJsx', () => {
  it('every Add-menu element is a single valid JSX element, absolutely positioned', () => {
    for (const { id } of ELEMENTS) {
      const jsx = elementJsx(id, { width: 1080, height: 1920 });
      expect(parses(`(${jsx});`)).not.toThrow();
      expect(jsx).toContain("position: 'absolute'");
    }
  });

  it('centers a shape on the artboard and rounds a circle fully', () => {
    expect(elementJsx('rectangle', { width: 1000, height: 1000 })).toContain('left: 350, top: 350, width: 300, height: 300');
    expect(elementJsx('circle', { width: 1000, height: 1000 })).toContain("borderRadius: '50%'");
    expect(elementJsx('nope', { width: 10, height: 10 })).toBeNull();
  });
});

describe('brand-aware templates', () => {
  const brand = {
    version: 2,
    colors: [
      { id: 'ink', name: 'Ink', value: '#08090A' },
      { id: 'paper', name: 'Paper', value: '#FFFFFF' },
      { id: 'primary', name: 'Primary', value: '#5E6AD2' },
    ],
    textStyles: [
      { id: 'h1', name: 'Heading 1', family: 'Inter', size: 96, weight: 700, lineHeight: 1.1, letterSpacing: '-0.02em' },
      { id: 'body', name: 'Body', family: 'Inter', size: 36, weight: 400, lineHeight: 1.4, letterSpacing: '0em' },
    ],
    logos: [
      {
        id: 'mark',
        name: 'Acme',
        kind: 'full',
        variants: [
          { id: 'default', label: 'Colour', file: 'acme.png' },
          { id: 'light', label: 'Light', file: 'acme-light.png' },
        ],
      },
    ],
  };
  const parses = (src) => parse(src, { sourceType: 'module', plugins: ['jsx'] });

  it('links colours, text styles and the logo', () => {
    const { source } = posterTemplateContent('headline-phone', 'hero', { width: 1920, height: 1080 }, { brand, brandDir: '../_brand/' });
    expect(() => parses(source)).not.toThrow();
    expect(source).toContain('background: "var(--brand-paper, #FFFFFF)"');
    expect(source).toContain('color: "var(--brand-ink, #08090A)"');
    expect(source).toContain('var(--brand-text-h1-font');
    expect(source).toContain('calc(var(--brand-text-body-size, 36)');
    expect(source).toContain('new URL("../_brand/acme.png", import.meta.url)');
  });

  it('uses the light logo variant and bold primary on the dark layout', () => {
    const { source } = posterTemplateContent('big-headline', 'x', { width: 1080, height: 1080 }, { brand, brandDir: './_brand/' });
    expect(source).toContain('background: "var(--brand-primary, #5E6AD2)"');
    expect(source).toContain('./_brand/acme-light.png');
  });

  it('ignores an untrusted brandDir and works with no brand', () => {
    const evil = posterTemplateContent('headline-phone', 'x', { width: 1080, height: 1920 }, { brand, brandDir: 'https://evil/' });
    expect(evil.source).not.toContain('logoSrc');
    expect(evil.source).toContain('var(--brand-ink');
    const plain = posterTemplateContent('headline-phone', 'x', { width: 1080, height: 1920 });
    expect(plain.source).not.toContain('--brand-');
  });

  it('starts Add-menu text and shapes on brand', () => {
    expect(elementJsx('text', { width: 1080, height: 1080 }, { brand })).toContain('var(--brand-text-h1-font');
    expect(elementJsx('rectangle', { width: 1080, height: 1080 }, { brand })).toContain('var(--brand-primary, #5E6AD2)');
  });
});
