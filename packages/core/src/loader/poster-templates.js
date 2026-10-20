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
import {
  BRAND_DIR,
  brandRoles,
  colorRef,
  hasBrand,
  logoVariantFor,
  luminance,
  parseBrand,
  textStyleRefs,
} from '../brand/brand-library.js';

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
 * A project's brand, reduced to what a new design needs: the roles (ink,
 * paper, primary, headline/body styles, logo) and where `_brand/` is relative
 * to the new file. Every value it produces stays LINKED (`var(--brand-…)`), so
 * a later library edit restyles designs made from it.
 *
 * @typedef {object} BrandKit
 * @property {unknown} [brand]     The parsed or raw `_brand/brand.json`.
 * @property {string}  [brandDir]  `_brand/` relative to the new file's folder,
 *   e.g. `../_brand/`. Without it no logo is placed.
 */

/**
 * @param {BrandKit | undefined} kit
 * @returns {null | ReturnType<typeof brandRoles> & { brandDir: string | null }}
 */
function kitRoles(kit) {
  if (!kit || !kit.brand) return null;
  const brand = parseBrand(typeof kit.brand === 'string' ? kit.brand : JSON.stringify(kit.brand));
  if (!hasBrand(brand)) return null;
  const dir = typeof kit.brandDir === 'string' && BRAND_DIR_RE.test(kit.brandDir) ? kit.brandDir : null;
  return { ...brandRoles(brand), brandDir: dir };
}

/** `./_brand/`, `../_brand/`, `../../_brand/` … — nothing else is trusted. */
const BRAND_DIR_RE = new RegExp(`^(?:\\./|(?:\\.\\./)+)${BRAND_DIR}/$`);

/** A colour role as a linked style value, or the fallback literal. */
function colorOr(role, fallback) {
  return role ? colorRef(role) : fallback;
}

/** Whether a role colour (or a literal) is dark. */
function isDark(role, fallbackDark) {
  const l = role ? luminance(role.value) : null;
  return l === null ? fallbackDark : l < 0.45;
}

/**
 * Style entries for text at `size` px: the brand text style linked (scaled so
 * the default renders at exactly `size`), else the stock stack + `weight`.
 *
 * @returns {string}  `fontFamily: …, fontSize: …, fontWeight: …, lineHeight: …[, letterSpacing: …]`
 */
function textStyleEntries(style, size, weight, lineHeight, tracking) {
  if (style) {
    const refs = textStyleRefs(style, size / (style.size || size));
    return Object.entries(refs).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
  }
  return (
    `fontFamily: ${JSON.stringify(DEFAULT_FONT_STACK)}, fontSize: ${r(size)}, fontWeight: ${weight}, lineHeight: ${lineHeight}` +
    (tracking ? `, letterSpacing: '${tracking}'` : '')
  );
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
 * @param {BrandKit} [kit]  Starts text in the brand's body style and ink,
 *   shapes in its primary colour — linked.
 * @returns {string | null}  Null for an unknown kind.
 */
export function elementJsx(kind, dims, kit) {
  const roles = kitRoles(kit);
  const W = Number(dims?.width) || DEFAULT_ASSET_DIMENSIONS.width;
  const H = Number(dims?.height) || DEFAULT_ASSET_DIMENSIONS.height;
  const short = Math.min(W, H);
  if (kind === 'text') {
    const width = r(W * 0.8);
    const fontSize = Math.max(16, r(short * 0.07));
    return (
      `<div style={{ position: 'absolute', left: ${r((W - width) / 2)}, top: ${r(H / 2 - fontSize)}, width: ${width}, ` +
      `${textStyleEntries(roles?.headline, fontSize, 700, 1.15)}, ` +
      `color: ${JSON.stringify(colorOr(roles?.ink, '#111111'))}, textAlign: 'center' }}>Your text</div>`
    );
  }
  if (kind === 'rectangle' || kind === 'circle') {
    const size = r(short * 0.3);
    const radius = kind === 'circle' ? "'50%'" : r(size * 0.12);
    return (
      `<div style={{ position: 'absolute', left: ${r((W - size) / 2)}, top: ${r((H - size) / 2)}, width: ${size}, ` +
      `height: ${size}, background: ${JSON.stringify(colorOr(roles?.primary || roles?.ink, '#111111'))}, borderRadius: ${radius} }} />`
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
 * @param {ReturnType<typeof kitRoles>} roles  The brand, when there is one.
 * @returns {{ background: string, dark: boolean, children: string[], logo?: { left: number, top: number, height: number, align: 'left' | 'center' } } | null}
 */
function layout(id, W, H, roles) {
  const portrait = H >= W;
  const pad = r(W * 0.08);
  const q = JSON.stringify;
  const headline = (left, top, width, size, color, align) =>
    `<div style={{ position: 'absolute', left: ${r(left)}, top: ${r(top)}, width: ${r(width)}, ` +
    `${textStyleEntries(roles?.headline, size, 800, 1.08, '-0.02em')}, color: ${q(color)}, textAlign: '${align}' }}>{headline}</div>`;
  // A distinct body style, linked; with only one style, link just its family.
  const bodyEntries = (size) => {
    if (roles?.body && roles.body.id !== roles.headline?.id) return textStyleEntries(roles.body, size, 500, 1.3);
    if (roles?.headline) {
      const family = textStyleRefs(roles.headline).fontFamily;
      return `fontFamily: ${q(family)}, fontSize: ${r(size)}, fontWeight: 500, lineHeight: 1.3`;
    }
    return textStyleEntries(null, size, 500, 1.3);
  };
  const sub = (left, top, width, size, color, align) =>
    `<div style={{ position: 'absolute', left: ${r(left)}, top: ${r(top)}, width: ${r(width)}, ` +
    `${bodyEntries(size)}, color: ${q(color)}, textAlign: '${align}'${roles?.ink ? ', opacity: 0.78' : ''} }}>{subheadline}</div>`;
  // Light layouts sit on the brand's paper with ink text; stock greys otherwise.
  const light = roles?.paper ? colorRef(roles.paper) : 'linear-gradient(180deg, #F5F5F7 0%, #E3E3E8 100%)';
  const ink = colorOr(roles?.ink, '#111111');
  const inkSoft = roles?.ink ? colorRef(roles.ink) : '#3A3A3C';

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
        dark: false,
        children: [
          phoneJsx({ left: (W - pw) / 2, top: phoneTop, width: pw }),
          headline(pad, textTop, W - pad * 2, hs, ink, 'center'),
          sub(pad, textTop + hs * 2.5, W - pad * 2, ss, inkSoft, 'center'),
        ],
        // Above the headline; the phone-first layout has no free top edge.
        logo: textFirst ? { left: W / 2, top: H * 0.022, height: H * 0.032, align: 'center' } : undefined,
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
      dark: false,
      children: [
        phoneJsx({ left: phoneLeft, top: H * 0.12, width: pw }),
        headline(textLeft, H * 0.3, textW, hs, ink, 'left'),
        sub(textLeft, H * 0.3 + hs * 2.6, textW, hs * 0.5, inkSoft, 'left'),
      ],
      logo: { left: textLeft, top: H * 0.14, height: H * 0.075, align: 'left' },
    };
  }
  if (id === 'big-headline') {
    const hs = Math.min(W, H) * (portrait ? 0.12 : 0.1);
    // The brand's primary when it is bold enough to carry white text, else ink.
    const bgRole = roles?.primary && isDark(roles.primary, true) ? roles.primary : roles?.ink || null;
    const dark = isDark(bgRole, true);
    const fg = dark ? colorOr(roles?.paper, '#FFFFFF') : ink;
    return {
      background: bgRole ? colorRef(bgRole) : 'linear-gradient(160deg, #1C1C1E 0%, #000000 100%)',
      dark,
      children: [
        headline(pad, H * 0.36, W - pad * 2, hs, fg, 'center'),
        sub(pad, H * 0.36 + hs * 2.6, W - pad * 2, hs * 0.38, roles ? fg : '#AEAEB2', 'center'),
      ],
      logo: { left: W / 2, top: H * 0.36 - Math.min(W, H) * 0.16, height: Math.min(W, H) * 0.09, align: 'center' },
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
 * @param {BrandKit} [kit]  The project's brand: colours, text styles and the
 *   logo are applied linked, so library edits flow into the new design.
 * @returns {{ source: string, data: string } | null}  Null for an unknown template.
 */
export function posterTemplateContent(templateId, name, dimensions, kit) {
  const dims = validateAssetDimensions(dimensions).ok ? dimensions : DEFAULT_ASSET_DIMENSIONS;
  const roles = kitRoles(kit);
  const lay = layout(templateId, dims.width, dims.height, roles);
  if (!lay) return null;
  const id = componentIdentifier(name);
  const indent = (block, n) => block.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
  // The logo, linked to its `_brand/` file, in the variant that suits the background.
  let logoDecl = [];
  const children = [...lay.children];
  if (roles?.logo && roles.brandDir && lay.logo) {
    const variant = logoVariantFor(roles.logo, lay.dark);
    const h = r(lay.logo.height);
    const w = roles.logo.kind === 'icon' ? h : r(h * 4);
    const left = lay.logo.align === 'center' ? lay.logo.left - w / 2 : lay.logo.left;
    logoDecl = [`const logoSrc = new URL(${JSON.stringify(roles.brandDir + variant.file)}, import.meta.url).href;`, ''];
    children.push(
      `<img src={logoSrc} alt=${JSON.stringify(roles.logo.name || 'Logo')} style={{ position: 'absolute', left: ${r(left)}, top: ${r(lay.logo.top)}, ` +
        `width: ${w}, height: ${h}, objectFit: 'contain', objectPosition: '${lay.logo.align === 'center' ? 'center' : 'left center'}' }} />`,
    );
  }
  const source = [
    `// ${id} — made from the "${POSTER_TEMPLATES.find((t) => t.id === templateId).label}" template.`,
    '// Click anything in the studio to change it; the text lives in the data file.',
    ...(roles ? ['// Colours, fonts and the logo are linked to the brand library (.lerret/_brand).'] : []),
    ...logoDecl,
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
    `    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: ${JSON.stringify(lay.background)} }}>`,
    ...children.map((c) => indent(c, 6)),
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
