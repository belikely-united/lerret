// brand-library.js — the project's brand library, as data (pure).
//
// Stored at `.lerret/_brand/brand.json`, with logo files beside it:
//
//   { "version": 2,
//     "setup": "done",                       // or "skipped" — the first-run wizard ran
//     "app": { "name": "Acme", "tagline": "…", "url": "https://…" },
//     "colors": [{ "id": "primary", "name": "Primary", "value": "#2F5BFF" }, …],
//     "textStyles": [{ "id": "h1", "name": "Heading 1", "family": "Poppins",
//                      "size": 96, "weight": 700, "lineHeight": 1.1, "letterSpacing": "-0.01em" }, …],
//     "logos": [{ "id": "logo", "name": "Logo", "kind": "full",
//                 "variants": [{ "id": "color", "label": "Colour", "file": "logo.png" },
//                              { "id": "light", "label": "Light", "file": "logo-light.png" }] }] }
//
// Designs LINK to it rather than copying values:
//   • colours and text-style properties are mirrored into the root config.json
//     `vars` (`brand-primary`, `brand-text-h1-size`, …), which every design on
//     every page receives as CSS custom properties — so a design stores
//     `var(--brand-primary, #2F5BFF)` and a library edit updates them all;
//   • a logo is referenced by its file in `_brand/`, so replacing the file
//     updates every design that uses it.
//
// Text-style sizes are px on a ~1080px-wide design; templates scale them.

/** The library's folder under `.lerret/` (reserved: never a page). */
export const BRAND_DIR = '_brand';
/** The library file inside {@link BRAND_DIR}. */
export const BRAND_FILE = 'brand.json';
/** Every config var the library owns starts with this. */
export const BRAND_VAR_PREFIX = 'brand-';
/** Text-style sizes are authored for a design this wide. */
export const TEXT_STYLE_REFERENCE_WIDTH = 1080;

/** @typedef {{ id: string, name: string, value: string }} BrandColor */
/**
 * @typedef {{ id: string, name: string, family: string, size: number, weight: number,
 *             lineHeight: number, letterSpacing: string }} BrandTextStyle
 */
/** @typedef {{ id: string, label: string, file: string }} BrandLogoVariant */
/** @typedef {{ id: string, name: string, kind: 'full' | 'icon' | 'wordmark' | 'other', variants: BrandLogoVariant[] }} BrandLogo */
/** @typedef {{ name?: string, tagline?: string, url?: string }} BrandApp */
/**
 * @typedef {{ version: 2, setup?: 'done' | 'skipped', app: BrandApp,
 *             colors: BrandColor[], textStyles: BrandTextStyle[], logos: BrandLogo[] }} Brand
 */

export const LOGO_KINDS = Object.freeze([
  { id: 'full', label: 'Full logo' },
  { id: 'icon', label: 'Icon / mark' },
  { id: 'wordmark', label: 'Wordmark' },
  { id: 'other', label: 'Other' },
]);

/** The text styles a new library starts with. */
export const DEFAULT_TEXT_STYLES = Object.freeze([
  { id: 'display', name: 'Display', family: 'Inter', size: 120, weight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' },
  { id: 'h1', name: 'Heading 1', family: 'Inter', size: 96, weight: 700, lineHeight: 1.1, letterSpacing: '-0.01em' },
  { id: 'h2', name: 'Heading 2', family: 'Inter', size: 64, weight: 700, lineHeight: 1.15, letterSpacing: '0em' },
  { id: 'body', name: 'Body', family: 'Inter', size: 36, weight: 400, lineHeight: 1.4, letterSpacing: '0em' },
  { id: 'caption', name: 'Caption', family: 'Inter', size: 24, weight: 500, lineHeight: 1.3, letterSpacing: '0.02em' },
]);

export const emptyBrand = () => ({ version: 2, app: {}, colors: [], textStyles: [], logos: [] });

/** A new library pre-filled with the default text styles. */
export const starterBrand = () => ({ ...emptyBrand(), textStyles: DEFAULT_TEXT_STYLES.map((s) => ({ ...s })) });

const ID = /^[a-z0-9][a-z0-9-]*$/;
const FILE = /^[^/\\]+$/;

/**
 * A short id from a display name, unique among `taken`: `Primary Blue` →
 * `primary-blue`, then `primary-blue-2` …
 *
 * @param {string} name
 * @param {Iterable<string>} [taken]
 * @returns {string}
 */
export function brandId(name, taken = []) {
  const used = new Set(taken);
  const base = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'item';
  let id = base;
  for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

/** Fill in a text style's missing properties. */
export function normalizeTextStyle(s) {
  return {
    id: s.id,
    name: String(s.name),
    family: String(s.family).trim(),
    size: num(s.size, 36),
    weight: Math.min(900, Math.max(100, Math.round(num(s.weight, 400) / 100) * 100)),
    lineHeight: num(s.lineHeight, 1.3),
    letterSpacing: typeof s.letterSpacing === 'string' && /^-?\d*\.?\d+(em|px)$|^normal$/.test(s.letterSpacing.trim()) ? s.letterSpacing.trim() : '0em',
  };
}

/**
 * Parse `brand.json`, keeping only well-formed entries (a hand-edited file
 * must never break the studio). Version-1 libraries are migrated: `fonts`
 * become text styles, single-file logos become one-variant logo sets.
 *
 * @param {string} json
 * @returns {Brand}
 */
export function parseBrand(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyBrand();
  }
  const list = (k, ok) => (Array.isArray(raw?.[k]) ? raw[k].filter((x) => x && ID.test(x.id) && typeof x.name === 'string' && ok(x)) : []);
  const colors = list('colors', (c) => typeof c.value === 'string' && c.value.trim() !== '').map(({ id, name, value }) => ({ id, name, value }));

  let textStyles = list('textStyles', (s) => typeof s.family === 'string' && s.family.trim() !== '').map(normalizeTextStyle);
  if (!Array.isArray(raw?.textStyles)) {
    // v1: { fonts: [{ id, name, family }] }
    textStyles = list('fonts', (f) => typeof f.family === 'string' && f.family.trim() !== '').map((f) =>
      normalizeTextStyle({ ...f, size: 64, weight: 700, lineHeight: 1.15 }),
    );
  }

  const logos = list('logos', (l) => Array.isArray(l.variants) || (typeof l.file === 'string' && FILE.test(l.file)))
    .map((l) => {
      const variants = Array.isArray(l.variants)
        ? l.variants.filter((v) => v && ID.test(v.id) && typeof v.file === 'string' && FILE.test(v.file)).map((v) => ({ id: v.id, label: String(v.label || v.id), file: v.file }))
        : [{ id: 'default', label: 'Default', file: l.file }]; // v1
      return { id: l.id, name: l.name, kind: LOGO_KINDS.some((k) => k.id === l.kind) ? l.kind : 'full', variants };
    })
    .filter((l) => l.variants.length > 0);

  const app = raw?.app && typeof raw.app === 'object'
    ? Object.fromEntries(['name', 'tagline', 'url'].filter((k) => typeof raw.app[k] === 'string' && raw.app[k].trim()).map((k) => [k, raw.app[k].trim()]))
    : {};
  const brand = { version: 2, app, colors, textStyles, logos };
  if (raw?.setup === 'done' || raw?.setup === 'skipped') brand.setup = raw.setup;
  return brand;
}

/** Whether a library has anything a design could use. */
export function hasBrand(brand) {
  return !!brand && (brand.colors.length > 0 || brand.logos.length > 0 || brand.textStyles.length > 0);
}

/** A font family as a CSS stack: `Playfair Display` → `'Playfair Display', serif`. */
export function fontStack(family) {
  const f = String(family ?? '').replace(/['"]/g, '').trim();
  const serif = /serif|playfair|lora|garamond|georgia|merriweather|times/i.test(f) && !/sans/i.test(f);
  return `${/\s/.test(f) ? `'${f}'` : f}, ${serif ? 'serif' : 'sans-serif'}`;
}

/** The config var key for a colour. */
export const colorVarKey = (color) => `${BRAND_VAR_PREFIX}${color.id}`;
/** The config var key for one property of a text style. */
export const textVarKey = (style, prop) => `${BRAND_VAR_PREFIX}text-${style.id}-${prop}`;

/** What a design stores to use a brand colour — linked, with its current value as fallback. */
export function colorRef(color) {
  return `var(--${colorVarKey(color)}, ${color.value})`;
}

/**
 * The style properties a design stores to use a text style — every one linked
 * to the library. `scale` multiplies the size (templates fit it to the design).
 *
 * @param {BrandTextStyle} style
 * @param {number} [scale]
 * @returns {{ fontFamily: string, fontSize: string, fontWeight: string, lineHeight: string, letterSpacing: string }}
 */
export function textStyleRefs(style, scale = 1) {
  const s = normalizeTextStyle(style);
  const k = (p) => `--${textVarKey(s, p)}`;
  const factor = Math.round(scale * 1000) / 1000;
  return {
    fontFamily: `var(${k('font')}, ${fontStack(s.family)})`,
    fontSize: `calc(var(${k('size')}, ${s.size}) * ${factor}px)`,
    fontWeight: `var(${k('weight')}, ${s.weight})`,
    lineHeight: `var(${k('line')}, ${s.lineHeight})`,
    letterSpacing: `var(${k('tracking')}, ${s.letterSpacing})`,
  };
}

/**
 * Which brand item a stored style value links to (`var(--brand-…`), if any.
 *
 * @param {unknown} value
 * @returns {string | null}  The var key, e.g. `brand-primary` / `brand-text-h1-font`.
 */
export function linkedVarKey(value) {
  const m = /var\(\s*--(brand-[a-z0-9-]+)\s*[,)]/i.exec(String(value ?? ''));
  return m ? m[1] : null;
}

/** The text style a stored `fontFamily` links to (its id), if any. */
export function linkedTextStyleId(value) {
  const m = /^brand-text-([a-z0-9-]+)-font$/.exec(linkedVarKey(value) || '');
  return m ? m[1] : null;
}

/** The config vars the library contributes. */
export function brandVars(brand) {
  const vars = {};
  for (const c of brand.colors) vars[colorVarKey(c)] = c.value;
  for (const raw of brand.textStyles) {
    const s = normalizeTextStyle(raw);
    vars[textVarKey(s, 'font')] = fontStack(s.family);
    vars[textVarKey(s, 'size')] = s.size;
    vars[textVarKey(s, 'weight')] = s.weight;
    vars[textVarKey(s, 'line')] = s.lineHeight;
    vars[textVarKey(s, 'tracking')] = s.letterSpacing;
  }
  return vars;
}

/**
 * Root config `vars` with the library's vars swapped in: every `brand-*` key
 * is replaced (removed items disappear), every other var is kept as-is.
 *
 * @param {Record<string, unknown> | undefined} vars
 * @param {Brand} brand
 * @returns {Record<string, unknown>}
 */
export function mergeBrandVars(vars, brand) {
  const out = {};
  for (const [k, v] of Object.entries(vars || {})) {
    if (!k.startsWith(BRAND_VAR_PREFIX)) out[k] = v;
  }
  return { ...out, ...brandVars(brand) };
}

/**
 * The path from a design's folder to a file in the library, for an `<img>`
 * reference (`../_brand/logo.png` from a page, `../../_brand/logo.png` from a
 * group inside a page).
 *
 * @param {string} assetFolder  The design's folder (absolute or LerretPath).
 * @param {string} lerretDir    The `.lerret/` root.
 * @param {string} file         The file name in `_brand/`.
 * @returns {string}
 */
export function logoPathFrom(assetFolder, lerretDir, file) {
  const root = String(lerretDir).replace(/\/+$/, '');
  const folder = String(assetFolder).replace(/\/+$/, '');
  const rel = folder.startsWith(`${root}/`) ? folder.slice(root.length + 1) : folder === root ? '' : folder;
  const depth = rel ? rel.split('/').filter(Boolean).length : 0;
  return `${'../'.repeat(depth) || './'}${BRAND_DIR}/${file}`;
}

/** Relative luminance of a #rgb/#rrggbb colour (0 dark … 1 light), or null. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * The library's roles for designing on-brand: the most saturated non-neutral
 * colour is the primary, the darkest the ink, the lightest the paper; the
 * largest text style the headline, a "body" style the body.
 *
 * @param {Brand} brand
 */
export function brandRoles(brand) {
  const scored = brand.colors.map((c) => ({ c, l: luminance(c.value) })).filter((x) => x.l !== null);
  const sat = (hex) => {
    const h = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex)[1];
    const v = (h.length === 3 ? h.replace(/./g, (c) => c + c) : h).match(/../g).map((x) => parseInt(x, 16));
    return Math.max(...v) - Math.min(...v);
  };
  const byLum = [...scored].sort((a, b) => a.l - b.l);
  const primary = [...scored].sort((a, b) => sat(b.c.value) - sat(a.c.value))[0]?.c || null;
  const ink = byLum[0] && byLum[0].l < 0.2 ? byLum[0].c : null;
  const paper = byLum.at(-1) && byLum.at(-1).l > 0.8 ? byLum.at(-1).c : null;
  const styles = brand.textStyles.map(normalizeTextStyle);
  const bySize = [...styles].sort((a, b) => b.size - a.size);
  const headline = styles.find((s) => s.id === 'h1') || bySize[0] || null;
  const body = styles.find((s) => s.id === 'body') || bySize.at(-1) || null;
  const logo = brand.logos.find((l) => l.kind === 'full') || brand.logos[0] || null;
  return { primary, ink, paper, headline, body, logo };
}

/**
 * The best variant of a logo for a background: on a dark background prefer a
 * "light"/"white" variant, on a light one a "dark"/"color" one.
 *
 * @param {BrandLogo} logo
 * @param {boolean} darkBackground
 * @returns {BrandLogoVariant}
 */
export function logoVariantFor(logo, darkBackground) {
  const v = logo.variants;
  const find = (re) => v.find((x) => re.test(`${x.id} ${x.label}`));
  return (darkBackground ? find(/light|white|reverse|inverse/i) : find(/colou?r|dark|black|default|primary/i)) || v[0];
}
