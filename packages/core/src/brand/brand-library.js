// brand-library.js — the project's brand library, as data (pure).
//
// Stored at `.lerret/_brand/brand.json`, with logo files beside it:
//
//   { "colors": [{ "id": "primary", "name": "Primary", "value": "#2F5BFF" }],
//     "fonts":  [{ "id": "heading", "name": "Heading", "family": "Poppins" }],
//     "logos":  [{ "id": "logo", "name": "Logo", "file": "logo.png" }] }
//
// Designs LINK to it rather than copying values:
//   • each colour / font is mirrored into the root config.json `vars`
//     (`brand-primary`, `brand-font-heading`), which every design on every page
//     receives as a CSS custom property — so a design uses
//     `var(--brand-primary, #2F5BFF)` and a library edit updates them all;
//   • a logo is referenced by its path in `_brand/`, so replacing the file
//     updates every design that uses it.

/** The library's folder under `.lerret/` (reserved: never a page). */
export const BRAND_DIR = '_brand';
/** The library file inside {@link BRAND_DIR}. */
export const BRAND_FILE = 'brand.json';
/** Every config var the library owns starts with this. */
export const BRAND_VAR_PREFIX = 'brand-';

/** @typedef {{ id: string, name: string, value: string }} BrandColor */
/** @typedef {{ id: string, name: string, family: string }} BrandFont */
/** @typedef {{ id: string, name: string, file: string }} BrandLogo */
/** @typedef {{ colors: BrandColor[], fonts: BrandFont[], logos: BrandLogo[] }} Brand */

export const emptyBrand = () => ({ colors: [], fonts: [], logos: [] });

const ID = /^[a-z0-9][a-z0-9-]*$/;

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

/**
 * Parse `brand.json`, keeping only well-formed entries (a hand-edited file
 * must never break the panel).
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
  return {
    colors: list('colors', (c) => typeof c.value === 'string' && c.value.trim() !== ''),
    fonts: list('fonts', (f) => typeof f.family === 'string' && f.family.trim() !== ''),
    logos: list('logos', (l) => typeof l.file === 'string' && /^[^/\\]+$/.test(l.file)),
  };
}

/** A font family as a CSS stack: `Playfair Display` → `'Playfair Display', serif`. */
export function fontStack(family) {
  const f = String(family ?? '').replace(/['"]/g, '').trim();
  const serif = /serif|playfair|lora|garamond|georgia|merriweather|times/i.test(f) && !/sans/i.test(f);
  return `${/\s/.test(f) ? `'${f}'` : f}, ${serif ? 'serif' : 'sans-serif'}`;
}

/** The config var key for a colour / font. */
export const colorVarKey = (color) => `${BRAND_VAR_PREFIX}${color.id}`;
export const fontVarKey = (font) => `${BRAND_VAR_PREFIX}font-${font.id}`;

/** What a design stores to use a brand colour — linked, with its current value as fallback. */
export function colorRef(color) {
  return `var(--${colorVarKey(color)}, ${color.value})`;
}

/** What a design stores to use a brand font — linked, with its current stack as fallback. */
export function fontRef(font) {
  return `var(--${fontVarKey(font)}, ${fontStack(font.family)})`;
}

/**
 * Which brand item a stored style value links to (`var(--brand-…`), if any.
 *
 * @param {unknown} value
 * @returns {string | null}  The var key, e.g. `brand-primary`.
 */
export function linkedVarKey(value) {
  const m = /^\s*var\(\s*--(brand-[a-z0-9-]+)\s*[,)]/i.exec(String(value ?? ''));
  return m ? m[1] : null;
}

/** The config vars the library contributes. */
export function brandVars(brand) {
  const vars = {};
  for (const c of brand.colors) vars[colorVarKey(c)] = c.value;
  for (const f of brand.fonts) vars[fontVarKey(f)] = fontStack(f.family);
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
 * The path from a design's folder to a logo in the library, for an `<img>`
 * reference (`../_brand/logo.png` from a page, `../../_brand/logo.png` from a
 * group inside a page).
 *
 * @param {string} assetFolder  The design's folder (absolute or LerretPath).
 * @param {string} lerretDir    The `.lerret/` root.
 * @param {string} file         The logo's file name in `_brand/`.
 * @returns {string}
 */
export function logoPathFrom(assetFolder, lerretDir, file) {
  const root = String(lerretDir).replace(/\/+$/, '');
  const folder = String(assetFolder).replace(/\/+$/, '');
  const rel = folder.startsWith(`${root}/`) ? folder.slice(root.length + 1) : folder === root ? '' : folder;
  const depth = rel ? rel.split('/').filter(Boolean).length : 0;
  return `${'../'.repeat(depth) || './'}${BRAND_DIR}/${file}`;
}
