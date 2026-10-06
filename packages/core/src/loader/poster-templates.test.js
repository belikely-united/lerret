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
