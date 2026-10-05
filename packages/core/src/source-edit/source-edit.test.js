import { describe, it, expect } from 'vitest';

import {
  addVariantExport,
  listExportNames,
  stampSourceLocations,
  parseSourceStamp,
  inspectElement,
  applyEdit,
  SRC_ATTR,
  insertImageLayer,
  insertImageLayers,
} from './index.js';

const HERO = `const TONES = { warm: 'linear-gradient(#fb923c, #f43f5e)' };

export default function Hero({ headline = 'Ship it', tone = 'warm', items = [] }) {
  return (
    <div
      style={{
        padding: '40px 48px',
        gap: 12,
        background: TONES[tone],
        color: '#fff',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700 }}>
        640 × 280 · FROM META
      </div>
      <h1>{headline}</h1>
      <p>Hello <b>world</b></p>
      <img src="/a.png" alt="A" />
      {items.map((i) => <span key={i}>{i}</span>)}
      <Badge label="x" />
    </div>
  );
}
`;

const at = (code, needle) => code.indexOf(needle);

describe('stampSourceLocations', () => {
  it('stamps DOM tags with path:offset of their `<`, skips components', () => {
    const out = stampSourceLocations(HERO, 'ui/Hero.jsx');
    const stamps = [...out.matchAll(/data-lerret-src="([^"]+)"/g)].map((m) => parseSourceStamp(m[1]));
    // div, div, h1, p, b, img, span — not <Badge>
    expect(stamps).toHaveLength(7);
    for (const s of stamps) {
      expect(s.path).toBe('ui/Hero.jsx');
      expect(HERO[s.offset]).toBe('<');
    }
    expect(stamps[2].offset).toBe(at(HERO, '<h1>'));
    expect(out).toContain('<Badge label="x" />');
  });

  it('stamped code still parses and re-stamping is idempotent', () => {
    const once = stampSourceLocations(HERO, 'Hero.jsx');
    expect(stampSourceLocations(once, 'Hero.jsx')).toBe(once);
  });

  it('returns input unchanged on a syntax error or unsafe path', () => {
    expect(stampSourceLocations('<div>', 'a.jsx')).toBe('<div>');
    expect(stampSourceLocations(HERO, 'we"ird.jsx')).toBe(HERO);
  });

  it('handles .tsx', () => {
    const tsx = 'export default function A(p: { n: number }) { return <div>{p.n}</div>; }';
    expect(stampSourceLocations(tsx, 'A.tsx')).toContain(`${SRC_ATTR}="A.tsx:`);
  });
});

describe('inspectElement', () => {
  it('classifies literal, identifier and expression values', () => {
    const root = inspectElement(HERO, at(HERO, '<div\n'));
    expect(root.tag).toBe('div');
    expect(root.style.padding).toEqual({ kind: 'literal', value: '40px 48px' });
    expect(root.style.gap).toEqual({ kind: 'literal', value: 12 });
    expect(root.style.background).toMatchObject({ kind: 'expression', identifiers: ['TONES', 'tone'] });
    expect(root.text.kind).toBe('mixed');

    const badge = inspectElement(HERO, at(HERO, '<div style={{ fontSize'));
    expect(badge.text).toEqual({ kind: 'literal', value: '640 × 280 · FROM META' });

    expect(inspectElement(HERO, at(HERO, '<h1>')).text).toEqual({ kind: 'identifier', name: 'headline' });
    expect(inspectElement(HERO, at(HERO, '<p>')).text.kind).toBe('mixed');

    const img = inspectElement(HERO, at(HERO, '<img'));
    expect(img.text.kind).toBe('none');
    expect(img.attrs.src).toEqual({ kind: 'literal', value: '/a.png' });
    expect(img.style).toEqual({});
  });

  it('reports the enclosing exported component and its destructured props', () => {
    const h1 = inspectElement(HERO, at(HERO, '<h1>'));
    expect(h1.component.exportName).toBe('default');
    expect(h1.component.props.headline).toEqual({ kind: 'literal', value: 'Ship it' });
    expect(h1.component.props).toHaveProperty('tone');

    const code = `function Row({ label }) { return <li>{label}</li>; }
function Card({ title = 'T' }) { return <h2>{title}</h2>; }
export const Dark = ({ x }) => <p>{x}</p>;
export default Card;`;
    expect(inspectElement(code, at(code, '<li>')).component).toBeNull();
    expect(inspectElement(code, at(code, '<h2>')).component.exportName).toBe('default');
    expect(inspectElement(code, at(code, '<p>')).component).toEqual({ exportName: 'Dark', props: { x: null } });
  });

  it('reports not-found for a stale offset', () => {
    expect(inspectElement(HERO, 3)).toEqual({ ok: false, reason: 'not-found' });
  });
});

/** Apply and assert only the intended span changed. */
function edit(code, needle, change) {
  const res = applyEdit(code, at(code, needle), change);
  expect(res.ok).toBe(true);
  return res.code;
}

describe('applyEdit — text', () => {
  it('replaces literal text, keeping surrounding whitespace', () => {
    const out = edit(HERO, '<div style={{ fontSize', { type: 'text', value: 'NEW BADGE' });
    expect(out).toBe(HERO.replace('640 × 280 · FROM META', 'NEW BADGE'));
  });

  it('wraps text containing JSX-special characters', () => {
    const out = edit(HERO, '<div style={{ fontSize', { type: 'text', value: 'a {b} <c>' });
    expect(out).toContain('{"a {b} <c>"}');
  });

  it('fills an empty element', () => {
    const code = 'const A = () => <p></p>;';
    expect(edit(code, '<p>', { type: 'text', value: 'hi' })).toBe('const A = () => <p>hi</p>;');
  });

  it('refuses text set by code', () => {
    expect(applyEdit(HERO, at(HERO, '<h1>'), { type: 'text', value: 'x' })).toEqual({ ok: false, reason: 'text-is-code' });
    expect(applyEdit(HERO, at(HERO, '<img'), { type: 'text', value: 'x' }).reason).toBe('self-closing');
  });
});

describe('applyEdit — style', () => {
  it('replaces a literal, keeping numbers as numbers', () => {
    const out = edit(HERO, '<div style={{ fontSize', { type: 'style', key: 'fontSize', value: 14 });
    expect(out).toBe(HERO.replace('fontSize: 12', 'fontSize: 14'));
    const out2 = edit(HERO, '<div\n', { type: 'style', key: 'color', value: '#000' });
    expect(out2).toBe(HERO.replace("color: '#fff'", "color: '#000'"));
  });

  it('appends to a multiline object with a trailing comma, matching indent', () => {
    const out = edit(HERO, '<div\n', { type: 'style', key: 'borderRadius', value: 8 });
    expect(out).toBe(HERO.replace("color: '#fff',\n", "color: '#fff',\n        borderRadius: 8,\n"));
  });

  it('appends to a single-line object', () => {
    const out = edit(HERO, '<div style={{ fontSize', { type: 'style', key: 'color', value: 'red' });
    expect(out).toContain("{{ fontSize: 12, fontWeight: 700, color: 'red' }}");
  });

  it('creates a style attribute when missing', () => {
    const out = edit(HERO, '<img', { type: 'style', key: 'width', value: 40 });
    expect(out).toContain('<img src="/a.png" alt="A" style={{ width: 40 }} />');
  });

  it('removes keys cleanly (middle, last, only)', () => {
    const mid = edit(HERO, '<div style={{ fontSize', { type: 'style', key: 'fontSize' });
    expect(mid).toContain('style={{ fontWeight: 700 }}');
    const last = edit(HERO, '<div style={{ fontSize', { type: 'style', key: 'fontWeight' });
    expect(last).toContain('style={{ fontSize: 12 }}');
    const only = edit('const A = () => <p style={{ a: 1 }} />;', '<p', { type: 'style', key: 'a' });
    expect(only).toBe('const A = () => <p style={{}} />;');
  });

  it('never rewrites expressions', () => {
    expect(applyEdit(HERO, at(HERO, '<div\n'), { type: 'style', key: 'background', value: 'red' }))
      .toEqual({ ok: false, reason: 'value-is-code' });
    const code = 'const A = () => <p style={s.x} />;';
    expect(applyEdit(code, at(code, '<p'), { type: 'style', key: 'a', value: 1 }).reason).toBe('style-is-code');
  });
});

describe('applyEdit — attr + safety', () => {
  it('sets, adds and removes string attributes', () => {
    expect(edit(HERO, '<img', { type: 'attr', name: 'alt', value: 'B' })).toContain('alt="B"');
    expect(edit(HERO, '<img', { type: 'attr', name: 'title', value: 'T' })).toContain('alt="A" title="T" />');
    expect(edit(HERO, '<img', { type: 'attr', name: 'alt' })).toContain('<img src="/a.png" />');
  });

  it("refuses with 'changed' when the file moved underneath", () => {
    const offset = at(HERO, '<h1>');
    const moved = '// new line\n' + HERO;
    expect(applyEdit(moved, offset, { type: 'text', value: 'x' }).reason).toBe('changed');
    expect(applyEdit(HERO, offset, { type: 'text', value: 'x', expectTag: 'p' }).reason).toBe('changed');
  });

  it('round-trip: edits keep every untouched byte', () => {
    const out = edit(HERO, '<div style={{ fontSize', { type: 'style', key: 'fontSize', value: 12 });
    expect(out).toBe(HERO);
  });
});

describe('applyEdit — duplicate / remove', () => {
  it('duplicates an element on its own line, keeping indent', () => {
    const out = edit(HERO, '<h1>', { type: 'duplicate' });
    expect(out).toBe(HERO.replace('      <h1>{headline}</h1>\n', '      <h1>{headline}</h1>\n      <h1>{headline}</h1>\n'));
  });

  it('removes the whole line of an element on its own line', () => {
    const out = edit(HERO, '<img', { type: 'remove' });
    expect(out).toBe(HERO.replace('      <img src="/a.png" alt="A" />\n', ''));
  });

  it('handles inline elements', () => {
    expect(edit(HERO, '<b>', { type: 'duplicate' })).toContain('<p>Hello <b>world</b><b>world</b></p>');
    expect(edit(HERO, '<b>', { type: 'remove' })).toContain('<p>Hello </p>');
  });

  it('refuses elements placed by code', () => {
    // inside .map(), and the component's returned root
    expect(applyEdit(HERO, at(HERO, '<span key'), { type: 'remove' }).reason).toBe('structure-is-code');
    expect(applyEdit(HERO, at(HERO, '<div\n'), { type: 'duplicate' }).reason).toBe('structure-is-code');
    const cond = 'const A = ({ s }) => <div>{s && <em>x</em>}</div>;';
    expect(applyEdit(cond, at(cond, '<em>'), { type: 'remove' }).reason).toBe('structure-is-code');
  });
});

describe('addVariantExport', () => {
  const CARD = `function Card() { return <div />; }
export default Card;
export const Complete = Card;
`;

  it('appends an export pointing at the source variant\'s component', () => {
    const res = addVariantExport(CARD, 'Dark');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(`${CARD}export const Dark = Card;\n`);
    expect(res.exports).toEqual(['default', 'Complete', 'Dark']);
    expect(addVariantExport(CARD, 'Dark', 'Complete').code).toContain('export const Dark = Complete;');
  });

  it('works with `export default function Name` and files without a trailing newline', () => {
    const src = 'export default function Hero() { return <div />; }';
    expect(addVariantExport(src, 'Alt').code).toBe(`${src}\nexport const Alt = Hero;\n`);
  });

  it('refuses bad names, duplicates and anonymous defaults', () => {
    expect(addVariantExport(CARD, 'dark').reason).toBe('variant-name');
    expect(addVariantExport(CARD, 'Complete').reason).toBe('variant-exists');
    expect(addVariantExport('export default () => <div />;', 'Alt').reason).toBe('variant-anonymous');
  });

  it('lists export names', () => {
    expect(listExportNames(CARD)).toEqual(['default', 'Complete']);
  });
});

describe('insertImageLayer', () => {
  const SRC = [
    'export default function Card() {',
    '  return (',
    "    <div style={{ width: '100%', height: '100%', background: '#fff' }}>",
    '      <h1>Hello</h1>',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
  const rootAt = SRC.indexOf('<div');
  const box = { file: 'logo.png', left: 10.4, top: 20, width: 300, height: 150 };

  it('adds the image as the last child, positions the root, and declares a module-relative URL', () => {
    const r = insertImageLayer(SRC, rootAt, box);
    expect(r.ok).toBe(true);
    expect(r.varName).toBe('logoSrc');
    expect(r.code.startsWith(`const logoSrc = new URL("./logo.png", import.meta.url).href;\n\nexport default`)).toBe(true);
    expect(r.code).toContain("background: '#fff', position: 'relative' }}");
    expect(r.code).toContain(
      `      <h1>Hello</h1>\n      <img src={logoSrc} alt="logo" style={{ position: 'absolute', left: 10, top: 20, width: 300, height: 150, objectFit: 'contain' }} />\n    </div>`,
    );
  });

  it('keeps an existing position and places the URL after the imports', () => {
    const src = `import x from './x.png';\n${SRC.replace("background: '#fff'", "position: 'absolute'")}`;
    const r = insertImageLayer(src, src.indexOf('<div'), box);
    expect(r.ok).toBe(true);
    expect(r.code).toContain("import x from './x.png';\nconst logoSrc = new URL(");
    expect(r.code.match(/position: 'relative'/g)).toBeNull();
  });

  it('opens a self-closing root and avoids a name clash', () => {
    const src = 'const logoSrc = 1;\nexport default () => <div style={{ width: 10 }} />;\n';
    const r = insertImageLayer(src, src.indexOf('<div'), box);
    expect(r.ok).toBe(true);
    expect(r.varName).toBe('logoSrc2');
    expect(r.code).toContain('<div style={{ width: 10, position: \'relative\' }}>');
    expect(r.code).toContain('</div>;');
  });

  it('refuses a stale offset, a path-like file, and unparsable code', () => {
    expect(insertImageLayer(SRC, rootAt + 1, box)).toEqual({ ok: false, reason: 'changed' });
    expect(insertImageLayer(SRC, rootAt, { ...box, file: '../x.png' })).toEqual({ ok: false, reason: 'bad-image' });
    expect(insertImageLayer('<<<', 0, box)).toEqual({ ok: false, reason: 'parse-error' });
  });

  it('places several images in one pass, in order, with distinct names', () => {
    const r = insertImageLayers(SRC, rootAt, [box, { ...box, file: 'logo.png', left: 50 }]);
    expect(r.ok).toBe(true);
    expect(r.varNames).toEqual(['logoSrc', 'logoSrc2']);
    expect(r.code).toContain('const logoSrc = new URL("./logo.png", import.meta.url).href;\nconst logoSrc2 = new URL(');
    expect(r.code.indexOf('src={logoSrc}')).toBeLessThan(r.code.indexOf('src={logoSrc2}'));
    expect(insertImageLayers(SRC, rootAt, [])).toEqual({ ok: false, reason: 'bad-image' });
  });

  it('produces code that still parses', async () => {
    const { parse } = await import('@babel/parser');
    const r = insertImageLayer(SRC, rootAt, box);
    expect(() => parse(r.code, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow();
  });
});
