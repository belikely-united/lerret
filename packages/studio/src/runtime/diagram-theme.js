// diagram-theme.js — brand look + project images for Mermaid diagrams
// (spec-mermaid-diagrams.md, Phase 2). Pure: no DOM, no Mermaid.
//
// Theme source is the folder's EFFECTIVE config (the cascade), so studio and
// `@lerret/cli export` theme identically. Precedence, lowest → highest:
//   1. the brand library — mirrored into root `vars` as `brand-<id>` colours
//      and `brand-text-<style>-font` fonts (see core brand-library.js);
//   2. plain vars guessed by name (`paper`, `ink`, `accent`, `line`, …) — D2;
//   3. an explicit `mermaid.themeVariables` block in config.json, whose
//      values may reference vars as `"$accent"`;
//   4. the `.mmd` file's own frontmatter `config:` (applied by Mermaid itself).

import { brandRoles, luminance, BRAND_VAR_PREFIX } from '@lerret/core';

const isColor = (v) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(v.trim());

/** First var whose name matches one of `names` (case-insensitive) and holds a colour. */
function byName(vars, names) {
  const lower = Object.keys(vars).map((k) => [k.toLowerCase(), k]);
  for (const n of names) {
    const hit = lower.find(([l]) => l === n);
    if (hit && isColor(vars[hit[1]])) return vars[hit[1]];
  }
  return undefined;
}

/** Brand library roles, rebuilt from the mirrored `brand-*` vars. */
function brandFromVars(vars) {
  const colors = [];
  let headline;
  let body;
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith(BRAND_VAR_PREFIX)) continue;
    const rest = k.slice(BRAND_VAR_PREFIX.length);
    const font = /^text-(.+)-font$/.exec(rest);
    if (font) {
      if (font[1] === 'body') body = v;
      if (font[1] === 'h1') headline = v;
    } else if (!rest.startsWith('text-') && isColor(v) && v.startsWith('#')) {
      colors.push({ id: rest, name: rest, value: v });
    }
  }
  const roles = brandRoles({ colors, textStyles: [], logos: [] });
  return {
    paper: roles.paper?.value,
    ink: roles.ink?.value,
    primary: roles.primary?.value,
    font: typeof body === 'string' ? body : typeof headline === 'string' ? headline : undefined,
  };
}

/**
 * The Mermaid theme for a folder's effective config, or `null` to keep
 * Mermaid's neutral default (no usable brand colours — D2 fallback).
 *
 * @param {{ vars?: Record<string, unknown>, mermaid?: { themeVariables?: Record<string, unknown> } }} [config]
 * @returns {{ theme: 'base', themeVariables: Record<string, unknown>, background: string } | null}
 */
export function diagramTheme(config) {
  const vars = (config && typeof config.vars === 'object' && config.vars) || {};
  const brand = brandFromVars(vars);

  const paper = brand.paper ?? byName(vars, ['paper', 'background', 'bg']);
  const ink = brand.ink ?? byName(vars, ['ink', 'text', 'foreground', 'fg']);
  const primary = brand.primary ?? byName(vars, ['accent', 'primary', 'brand']);
  const surface = byName(vars, ['surface', 'card']);
  const line = byName(vars, ['line', 'border']);
  const muted = byName(vars, ['muted']);
  const font = brand.font ?? (typeof vars.font === 'string' ? vars.font : undefined);

  const tv = {};
  if (paper) tv.background = paper;
  if (surface || paper) tv.primaryColor = surface ?? paper;
  if (primary || line || ink) tv.primaryBorderColor = primary ?? line ?? ink;
  if (ink) {
    tv.primaryTextColor = ink;
    tv.textColor = ink;
  }
  if (muted || ink) tv.lineColor = muted ?? ink;
  if (surface || paper) {
    tv.secondaryColor = surface ?? paper;
    tv.tertiaryColor = surface ?? paper;
  }
  if (font) tv.fontFamily = font;
  if (paper && luminance(paper) !== null) tv.darkMode = luminance(paper) < 0.4;

  // Explicit mapping wins; "$name" points at a var.
  const explicit = config?.mermaid?.themeVariables;
  if (explicit && typeof explicit === 'object') {
    for (const [k, v] of Object.entries(explicit)) {
      tv[k] = typeof v === 'string' && v.startsWith('$') ? vars[v.slice(1)] ?? v : v;
    }
  }

  if (!tv.background && !tv.primaryColor && !tv.primaryTextColor) return null;
  return { theme: 'base', themeVariables: tv, background: tv.background ?? '#FFFFFF' };
}

const IMG_RE = /(\bimg\s*:\s*)(["'])([^"']+)\2/g;
const IS_LOCAL = (src) => !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src);

/** Join a folder and a relative path (`./`, `../`), forward slashes only. */
export function resolveRelative(folder, rel) {
  const parts = folder.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Inline project images used by image nodes (`A@{ img: "./logo.png" }`): each
 * relative path is resolved against the diagram's folder and replaced with a
 * data URL, so the SVG is self-contained (canvas, export and SVG download all
 * work). Remote URLs are left alone. An image that can't be read is left as
 * written — Mermaid then shows an empty frame, never an error.
 *
 * @param {string} text  Mermaid source.
 * @param {string} folder  The diagram's folder (a LerretPath).
 * @param {((path: string) => Promise<string | null>) | undefined} readDataUrl
 * @returns {Promise<string>}
 */
export async function inlineDiagramImages(text, folder, readDataUrl) {
  if (typeof readDataUrl !== 'function') return text;
  const wanted = new Set();
  for (const m of text.matchAll(IMG_RE)) if (IS_LOCAL(m[3])) wanted.add(m[3]);
  if (wanted.size === 0) return text;
  const urls = new Map();
  await Promise.all(
    [...wanted].map(async (src) => {
      try {
        const url = await readDataUrl(resolveRelative(folder, src));
        if (url) urls.set(src, url);
      } catch {
        // unreadable → keep as written
      }
    }),
  );
  return text.replace(IMG_RE, (all, pre, q, src) => (urls.has(src) ? `${pre}${q}${urls.get(src)}${q}` : all));
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

/** MIME type for an image path, by extension. */
export function imageMime(path) {
  return MIME[String(path).split('.').pop().toLowerCase()] ?? 'application/octet-stream';
}

/** Bytes → `data:` URL. */
export function bytesToDataUrl(bytes, mime) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}
