// diagram-theme.test.js — brand look + image inlining for diagrams (Phase 2).

import { describe, expect, it } from 'vitest';
import { diagramTheme, inlineDiagramImages, resolveRelative, bytesToDataUrl } from './diagram-theme.js';

describe('diagramTheme', () => {
  it('returns null without usable colours (Mermaid default look)', () => {
    expect(diagramTheme({})).toBeNull();
    expect(diagramTheme({ vars: { size: 12 } })).toBeNull();
  });

  it('guesses roles from plain var names', () => {
    const t = diagramTheme({ vars: { paper: '#FFFFFF', ink: '#111111', accent: '#2F5BFF', surface: '#F5F5F5', muted: '#888888' } });
    expect(t.theme).toBe('base');
    expect(t.background).toBe('#FFFFFF');
    expect(t.themeVariables).toMatchObject({
      primaryColor: '#F5F5F5', primaryBorderColor: '#2F5BFF', primaryTextColor: '#111111', lineColor: '#888888', darkMode: false,
    });
  });

  it('prefers the brand library colours and body font', () => {
    const t = diagramTheme({
      vars: {
        paper: '#000000', // plain var loses to the brand library
        'brand-primary': '#2F5BFF', 'brand-ink': '#111111', 'brand-paper': '#FAFAFA',
        'brand-text-body-font': "Inter, sans-serif",
      },
    });
    expect(t.background).toBe('#FAFAFA');
    expect(t.themeVariables).toMatchObject({ primaryBorderColor: '#2F5BFF', textColor: '#111111', fontFamily: 'Inter, sans-serif' });
  });

  it('applies an explicit mermaid.themeVariables block, with $var references', () => {
    const t = diagramTheme({ vars: { paper: '#FFFFFF', pink: '#FF00AA' }, mermaid: { themeVariables: { primaryBorderColor: '$pink', fontSize: '18px' } } });
    expect(t.themeVariables.primaryBorderColor).toBe('#FF00AA');
    expect(t.themeVariables.fontSize).toBe('18px');
  });
});

describe('diagram images', () => {
  it('resolves paths relative to the diagram folder', () => {
    expect(resolveRelative('/p/.lerret/page/group', '../_brand/logo.png')).toBe('/p/.lerret/page/_brand/logo.png');
    expect(resolveRelative('/p/.lerret/page', './x.png')).toBe('/p/.lerret/page/x.png');
  });

  it('inlines local images, leaves remote and unreadable ones alone', async () => {
    const text = 'a@{ img: "./ok.png" }\nb@{ img: \'https://x.test/r.png\' }\nc@{ img: "./missing.png" }';
    const out = await inlineDiagramImages(text, '/p/pg', async (p) => (p === '/p/pg/ok.png' ? 'data:image/png;base64,AA==' : null));
    expect(out).toContain('img: "data:image/png;base64,AA=="');
    expect(out).toContain("img: 'https://x.test/r.png'");
    expect(out).toContain('img: "./missing.png"');
  });

  it('encodes bytes as a data URL', () => {
    expect(bytesToDataUrl(new Uint8Array([104, 105]), 'text/plain')).toBe('data:text/plain;base64,aGk=');
  });
});
