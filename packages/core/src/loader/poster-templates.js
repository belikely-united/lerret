// poster-templates.js — ready-made layouts and building blocks for designing
// store and marketing images WITHOUT code.
//
// Two pure surfaces, shared by the studio's New-asset flow and its Add menu:
//   • POSTER_TEMPLATES + posterTemplateContent(): a whole starting layout
//     (headline, sub-headline, phone frame, background) generated at the
//     artboard's real size;
//   • ELEMENTS + elementJsx(): one element to drop into an existing artboard
//     (text, rectangle, circle, phone frame).
//
// Every element is absolutely positioned in artboard pixels, so the editor
// can move and resize each one directly. Template TEXT lives in the companion
// data file (headline / subheadline props) — editing it in the studio writes
// the data file, which keeps localized variants one file away.

import { componentIdentifier, validateAssetDimensions, DEFAULT_ASSET_DIMENSIONS } from './entry-name.js';

/** The default typeface for new text: Apple's on Apple devices, clean elsewhere. */
export const DEFAULT_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, system-ui, sans-serif";

/** Attribute marking an element that a dropped image fills (a phone screen). */
export const IMAGE_SLOT_ATTR = 'data-image-slot';

/**
 * @typedef {object} PosterTemplate
 * @property {string} id
 * @property {string} label
 * @property {string} description
 */

/** @type {ReadonlyArray<PosterTemplate>} */
export const POSTER_TEMPLATES = Object.freeze([
  { id: 'headline-phone', label: 'Headline + phone', description: 'Your message on top, the app below.' },
  { id: 'phone-headline', label: 'Phone + caption', description: 'The app first, a caption underneath.' },
  { id: 'big-headline', label: 'Big statement', description: 'One bold line on a dark background.' },
]);

const r = (n) => Math.round(n);

/**
 * A phone frame with a screenshot slot, as one absolutely-positioned element.
 *
 * @param {{ left: number, top: number, width: number }} box  Frame box in px.
 * @returns {string}
 */
function phoneJsx({ left, top, width }) {
  const height = r(width * 2.06);
  const bezel = Math.max(6, r(width * 0.035));
  const radius = r(width * 0.14);
  const label = Math.max(12, r(width * 0.05));
  return [
    `<div data-lerret-role="phone" style={{ position: 'absolute', left: ${r(left)}, top: ${r(top)}, width: ${r(width)}, height: ${height}, padding: ${bezel}, boxSizing: 'border-box', background: '#111111', borderRadius: ${radius}, boxShadow: '0 40px 80px rgba(0, 0, 0, 0.22)' }}>`,
    `  <div ${IMAGE_SLOT_ATTR}="screenshot" style={{ width: '100%', height: '100%', borderRadius: ${radius - bezel}, overflow: 'hidden', background: '#E5E5EA', color: '#8E8E93', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: ${label} }}>`,
    '    Drop your screenshot here',
    '  </div>',
    '</div>',
  ].join('\n');
}

/**
 * @typedef {'text' | 'rectangle' | 'circle' | 'phone'} ElementKind
 */

/** The Add menu, in order. */
export const ELEMENTS = Object.freeze([
  { id: 'text', label: 'Text' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'phone', label: 'Phone frame' },
]);

/**
 * JSX for one new element, sized and centered for an artboard.
 *
 * @param {ElementKind} kind
 * @param {{ width: number, height: number }} dims  The artboard's size.
 * @returns {string | null}  Null for an unknown kind.
 */
export function elementJsx(kind, dims) {
  const W = Number(dims?.width) || DEFAULT_ASSET_DIMENSIONS.width;
  const H = Number(dims?.height) || DEFAULT_ASSET_DIMENSIONS.height;
  const short = Math.min(W, H);
  if (kind === 'text') {
    const width = r(W * 0.8);
    const fontSize = Math.max(16, r(short * 0.07));
    return (
      `<div style={{ position: 'absolute', left: ${r((W - width) / 2)}, top: ${r(H / 2 - fontSize)}, width: ${width}, ` +
      `fontFamily: ${JSON.stringify(DEFAULT_FONT_STACK)}, fontSize: ${fontSize}, fontWeight: 700, lineHeight: 1.15, ` +
      `color: '#111111', textAlign: 'center' }}>Your text</div>`
    );
  }
  if (kind === 'rectangle' || kind === 'circle') {
    const size = r(short * 0.3);
    const radius = kind === 'circle' ? "'50%'" : r(size * 0.12);
    return (
      `<div style={{ position: 'absolute', left: ${r((W - size) / 2)}, top: ${r((H - size) / 2)}, width: ${size}, ` +
      `height: ${size}, background: '#111111', borderRadius: ${radius} }} />`
    );
  }
  if (kind === 'phone') {
    const width = r(Math.min(W * 0.6, H * 0.4));
    return phoneJsx({ left: (W - width) / 2, top: (H - width * 2.06) / 2, width });
  }
  return null;
}

/**
 * The template's elements for an artboard, as JSX lines (inside the root).
 *
 * @param {string} id
 * @param {number} W
 * @param {number} H
 * @returns {{ background: string, children: string[] } | null}
 */
function layout(id, W, H) {
  const portrait = H >= W;
  const pad = r(W * 0.08);
  const font = JSON.stringify(DEFAULT_FONT_STACK);
  const headline = (left, top, width, size, color, align) =>
    `<div style={{ position: 'absolute', left: ${r(left)}, top: ${r(top)}, width: ${r(width)}, fontFamily: ${font}, ` +
    `fontSize: ${r(size)}, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.02em', color: '${color}', textAlign: '${align}' }}>{headline}</div>`;
  const sub = (left, top, width, size, color, align) =>
    `<div style={{ position: 'absolute', left: ${r(left)}, top: ${r(top)}, width: ${r(width)}, fontFamily: ${font}, ` +
    `fontSize: ${r(size)}, fontWeight: 500, lineHeight: 1.3, color: '${color}', textAlign: '${align}' }}>{subheadline}</div>`;
  const light = 'linear-gradient(180deg, #F5F5F7 0%, #E3E3E8 100%)';

  if (id === 'headline-phone' || id === 'phone-headline') {
    const textFirst = id === 'headline-phone';
    if (portrait) {
      const hs = W * 0.085;
      const ss = W * 0.042;
      const pw = W * 0.74;
      const ph = pw * 2.06;
      const textTop = textFirst ? H * 0.07 : H * 0.8;
      const phoneTop = textFirst ? H * 0.3 : H * 0.74 - ph;
      return {
        background: light,
        children: [
          phoneJsx({ left: (W - pw) / 2, top: phoneTop, width: pw }),
          headline(pad, textTop, W - pad * 2, hs, '#111111', 'center'),
          sub(pad, textTop + hs * 2.5, W - pad * 2, ss, '#3A3A3C', 'center'),
        ],
      };
    }
    // Landscape: text on one side, the phone on the other.
    const pw = H * 0.42;
    const textW = W * 0.5 - pad;
    const hs = H * 0.09;
    const textLeft = textFirst ? pad : W * 0.5;
    const phoneLeft = textFirst ? W * 0.75 - pw / 2 : W * 0.25 - pw / 2;
    return {
      background: light,
      children: [
        phoneJsx({ left: phoneLeft, top: H * 0.12, width: pw }),
        headline(textLeft, H * 0.3, textW, hs, '#111111', 'left'),
        sub(textLeft, H * 0.3 + hs * 2.6, textW, hs * 0.5, '#3A3A3C', 'left'),
      ],
    };
  }
  if (id === 'big-headline') {
    const hs = Math.min(W, H) * (portrait ? 0.12 : 0.1);
    return {
      background: 'linear-gradient(160deg, #1C1C1E 0%, #000000 100%)',
      children: [
        headline(pad, H * 0.36, W - pad * 2, hs, '#FFFFFF', 'center'),
        sub(pad, H * 0.36 + hs * 2.6, W - pad * 2, hs * 0.38, '#AEAEB2', 'center'),
      ],
    };
  }
  return null;
}

/**
 * A complete asset (source + companion data) for a poster template.
 *
 * @param {string} templateId  One of {@link POSTER_TEMPLATES}.
 * @param {string} name        Validated asset base name.
 * @param {{ width: number, height: number }} dimensions
 * @returns {{ source: string, data: string } | null}  Null for an unknown template.
 */
export function posterTemplateContent(templateId, name, dimensions) {
  const dims = validateAssetDimensions(dimensions).ok ? dimensions : DEFAULT_ASSET_DIMENSIONS;
  const lay = layout(templateId, dims.width, dims.height);
  if (!lay) return null;
  const id = componentIdentifier(name);
  const indent = (block, n) => block.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
  const source = [
    `// ${id} — made from the "${POSTER_TEMPLATES.find((t) => t.id === templateId).label}" template.`,
    '// Click anything in the studio to change it; the text lives in the data file.',
    'export const meta = {',
    `  dimensions: { width: ${dims.width}, height: ${dims.height} },`,
    '  propsSchema: {',
    "    headline: { type: 'string', default: 'Your headline' },",
    "    subheadline: { type: 'string', default: 'One short line about it.' },",
    '  },',
    '};',
    '',
    `export default function ${id}({ headline = 'Your headline', subheadline = 'One short line about it.' }) {`,
    '  return (',
    `    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '${lay.background}' }}>`,
    ...lay.children.map((c) => indent(c, 6)),
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
  const data = `${JSON.stringify(
    { headline: 'Your app’s biggest benefit', subheadline: 'One short line that explains why it matters.' },
    null,
    2,
  )}\n`;
  return { source, data };
}
