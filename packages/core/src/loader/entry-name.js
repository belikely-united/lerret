// entry-name.js — pure validation + starter-content helpers for creating new
// pages, groups, and assets from the studio.
//
// Shared by BOTH the studio's CreateEntryDialog (instant inline feedback) and
// the CLI's `/__lerret/create` endpoint (the authoritative server check) so the
// two never drift. Pure: no `fs`, no DOM — fits the `@lerret/core` boundary.

import { ASSET_EXTENSIONS, ASSET_KIND } from './model.js';

/**
 * Maximum length of a page/group/asset base name. Folder and file names well
 * under typical OS limits; a short cap keeps labels legible on the canvas.
 * @type {number}
 */
export const MAX_ENTRY_NAME_LENGTH = 64;

// Windows reserved device names — refused on every platform so a project
// authored on macOS/Linux never breaks when synced to Windows.
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

// Printable characters illegal in a path segment on at least one mainstream OS
// (Windows is the strictest). Refused everywhere for portability. Spaces and
// dashes are ALLOWED — `tw-banner`, `og-card`, and `My Page` are valid names.
// Control characters (incl. NUL) are caught separately, escape-free, below.
const ILLEGAL_CHARS = /[<>:"/\\|?*]/;

/** Known asset extensions, lower-case (e.g. ['.jsx', '.tsx', '.md']). */
const KNOWN_ASSET_EXTS = Object.keys(ASSET_EXTENSIONS);

/**
 * Validate (and normalize) a user-typed name for a new page, group, or asset.
 *
 * Returns `{ ok: true, name }` with the cleaned base name (NO extension — the
 * caller appends one for assets), or `{ ok: false, error }` with a calm,
 * user-facing reason suitable for inline display.
 *
 * @param {unknown} rawName
 * @param {{ kind?: 'page'|'group'|'asset' }} [opts]
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function validateEntryName(rawName, { kind } = {}) {
  if (typeof rawName !== 'string') {
    return { ok: false, error: 'Enter a name.' };
  }

  const isAsset = kind === 'asset';

  // Trim outer whitespace, then strip trailing dots / spaces (a trailing dot or
  // space is silently dropped by Windows and confuses every tool).
  let name = rawName.trim().replace(/[.\s]+$/, '');

  // For an asset, if the user typed a recognized extension, strip it — the
  // type choice (component / markdown) decides the real extension.
  if (isAsset) {
    const lower = name.toLowerCase();
    for (const ext of KNOWN_ASSET_EXTS) {
      if (lower.endsWith(ext)) {
        name = name.slice(0, -ext.length);
        break;
      }
    }
    name = name.trim().replace(/[.\s]+$/, '');
  }

  if (name.length === 0) {
    return { ok: false, error: 'Enter a name.' };
  }
  if (name.length > MAX_ENTRY_NAME_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_ENTRY_NAME_LENGTH} characters.` };
  }
  if (name === '.' || name === '..') {
    return { ok: false, error: 'That name is reserved.' };
  }
  // Control characters (NUL … US) — escape-free check so the source stays clean.
  if ([...name].some((ch) => ch.charCodeAt(0) < 32)) {
    return { ok: false, error: 'Remove special/control characters.' };
  }
  if (ILLEGAL_CHARS.test(name)) {
    return { ok: false, error: 'Remove these characters: < > : " / \\ | ? *' };
  }
  if (name.startsWith('.')) {
    return { ok: false, error: "Names can't start with a dot." };
  }
  // Folders: a leading underscore is reserved (the `_fonts` / `_assets`
  // convention at the project root). Files may start with `_`.
  if (!isAsset && name.startsWith('_')) {
    return { ok: false, error: "Folder names can't start with an underscore (reserved)." };
  }
  // Windows reserved device names (compare the stem, case-insensitively).
  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    return { ok: false, error: 'That name is reserved by the operating system.' };
  }

  return { ok: true, name };
}

/**
 * The on-disk filename for a new asset of the given kind.
 *
 * @param {string} name  Validated base name (no extension).
 * @param {'component'|'markdown'} assetKind
 * @returns {string}
 */
export function assetFileName(name, assetKind) {
  return assetKind === ASSET_KIND.MARKDOWN ? `${name}.md` : `${name}.jsx`;
}

/** Starter artboard size when the create dialog didn't pick one. */
export const DEFAULT_ASSET_DIMENSIONS = Object.freeze({ width: 800, height: 450 });
/** Smallest artboard edge (px) a new asset may be created with. */
export const MIN_ASSET_DIMENSION = 16;
/** Largest artboard edge (px) — guards a fat-fingered value from blowing up the canvas. */
export const MAX_ASSET_DIMENSION = 10000;

/**
 * Validate a new asset's `{ width, height }` — whole pixels, each edge within
 * [{@link MIN_ASSET_DIMENSION}, {@link MAX_ASSET_DIMENSION}]. Shared by the
 * create dialog's custom-size fields and the create endpoint.
 *
 * @param {unknown} dims
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateAssetDimensions(dims) {
  if (!dims || typeof dims !== 'object') return { ok: false, error: 'Size must be { width, height }.' };
  for (const edge of ['width', 'height']) {
    const n = dims[edge];
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      return { ok: false, error: `The ${edge} must be a whole number of pixels.` };
    }
    if (n < MIN_ASSET_DIMENSION || n > MAX_ASSET_DIMENSION) {
      return {
        ok: false,
        error: `The ${edge} must be between ${MIN_ASSET_DIMENSION} and ${MAX_ASSET_DIMENSION} px.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Derive a safe PascalCase JS identifier for a component's default-export
 * function name from an arbitrary asset name. Falls back to `'Asset'`.
 *
 * @param {string} name
 * @returns {string}
 */
export function componentIdentifier(name) {
  const parts = String(name)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  let id = parts.join('');
  if (/^[0-9]/.test(id)) id = `A${id}`; // an identifier can't start with a digit
  return id || 'Asset';
}

/**
 * Minimal-but-renderable starter content for a new asset, so a just-created
 * asset renders cleanly on the canvas (never an error card). The display label
 * is JSON-encoded into a JS string expression so any character in the name is
 * safe inside JSX.
 *
 * @param {string} name  Validated base name.
 * @param {'component'|'markdown'} assetKind
 * @param {{ dimensions?: { width: number, height: number } }} [opts]
 *   `dimensions` — the artboard size picked in the create dialog (a platform
 *   preset or a custom W×H). Omitted or invalid → {@link DEFAULT_ASSET_DIMENSIONS}.
 *   Ignored for Markdown, which sizes to its content.
 * @returns {string}
 */
export function starterAssetContent(name, assetKind, opts = {}) {
  if (assetKind === ASSET_KIND.MARKDOWN) {
    return `# ${name}\n\nStart writing — this card renders as Markdown.\n`;
  }
  const id = componentIdentifier(name);
  const label = JSON.stringify(name);
  const dims = validateAssetDimensions(opts.dimensions).ok
    ? opts.dimensions
    : DEFAULT_ASSET_DIMENSIONS;
  // Scale the starter text with the artboard so a 1080×1920 story and a
  // 240×240 thumbnail both open with legible, proportionate copy.
  const fontSize = Math.max(12, Math.round(Math.min(dims.width, dims.height) * 0.07));
  return [
    `// ${id} — new component. Edit me; the canvas re-renders on save.`,
    'export const meta = {',
    `  dimensions: { width: ${dims.width}, height: ${dims.height} },`,
    '  propsSchema: {',
    '    title: {',
    "      type: 'string',",
    `      default: ${label},`,
    "      description: 'The card text. Edit it in the data file.',",
    '    },',
    '  },',
    '};',
    '',
    `export default function ${id}({ title = ${label} }) {`,
    '  return (',
    '    <div',
    '      style={{',
    "        width: '100%',",
    "        height: '100%',",
    "        display: 'flex',",
    "        alignItems: 'center',",
    "        justifyContent: 'center',",
    "        background: '#FAF8F2',",
    "        color: '#1A1714',",
    "        fontFamily: '-apple-system, system-ui, sans-serif',",
    `        fontSize: ${fontSize},`,
    '        fontWeight: 600,',
    "        letterSpacing: '-0.02em',",
    '      }}',
    '    >',
    "      {title}",
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
}

/**
 * The companion `.data.json` for a freshly-created COMPONENT asset — the Tier-1
 * data its starter component reads through the `title` prop. Pairing every new
 * asset with a data file makes its text editable WITHOUT touching code (and it
 * updates live on save), the same contract the create-lerret templates model.
 * Markdown assets have no data file.
 *
 * @param {string} name  Validated base name.
 * @returns {string}  Pretty-printed JSON, newline-terminated.
 */
export function starterAssetData(name) {
  return `${JSON.stringify({ title: String(name) }, null, 2)}\n`;
}
