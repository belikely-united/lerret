// brand-store.js — the project's brand library, shared by the Brand panel, the
// Design panel and the canvas drop layer.
//
// Source of truth: `.lerret/_brand/brand.json` (+ logo files beside it). Every
// save also mirrors colours and fonts into the root `config.json` `vars`
// (`brand-*` keys), which every design on every page receives as CSS custom
// properties — that is what makes library edits update designs everywhere.

import React from 'react';
import {
  BRAND_DIR,
  BRAND_FILE,
  emptyBrand,
  hasBrand,
  logoPathFrom,
  brandId,
  parseBrand,
  normalizeTextStyle,
  mergeBrandVars,
  serializeJson,
} from '@lerret/core';

import { readProjectFile, writeProjectFile, listProjectDir } from '../../runtime/write-client.js';
import { ensureGoogleFont } from '../../fonts/curated-fonts.js';

let state = {
  lerretDir: null,
  assetBaseUrl: null,
  brand: emptyBrand(),
  loaded: false,
  setupOpen: false, // the first-run / "Set up brand" wizard
  exists: false, // brand.json is on disk
  version: 0, // bumps on every logo change, for thumbnail cache-busting
  error: null,
};
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
  // Make sure every text style's family can render (Google Fonts on demand).
  if (patch.brand) for (const t of patch.brand.textStyles || []) ensureGoogleFont(t.family);
  for (const l of listeners) l();
};

/** @returns {typeof state} */
export function useBrand() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const getBrandState = () => state;

/**
 * The brand, packaged for designing a new file in `folder` (templates and
 * + Add): the library plus where `_brand/` sits relative to that folder.
 * Undefined when the project has no brand yet.
 *
 * @param {string} folder  The new file's folder (a LerretPath).
 * @returns {{ brand: object, brandDir: string } | undefined}
 */
export function brandKitFor(folder) {
  if (!state.lerretDir || !hasBrand(state.brand)) return undefined;
  return { brand: state.brand, brandDir: logoPathFrom(folder, state.lerretDir, '') };
}
export const setBrandSetupOpen = (open) => set({ setupOpen: !!open });

const dir = () => `${state.lerretDir}/${BRAND_DIR}`;

/** Load the library for a project (no-op when it's already the loaded one). */
export async function loadBrand(lerretDir, assetBaseUrl) {
  if (!lerretDir) return;
  if (state.lerretDir === lerretDir && state.loaded) {
    if (assetBaseUrl !== state.assetBaseUrl) set({ assetBaseUrl });
    return;
  }
  set({ lerretDir, assetBaseUrl: assetBaseUrl ?? null, brand: emptyBrand(), loaded: false });
  const listing = await listProjectDir(dir());
  let brand = emptyBrand();
  const exists = (listing.entries || []).some((e) => e.name === BRAND_FILE);
  if (exists) {
    const r = await readProjectFile(`${dir()}/${BRAND_FILE}`);
    if (r.ok) brand = parseBrand(r.content);
  }
  if (state.lerretDir !== lerretDir) return;
  // First time this project is opened without a brand: offer the setup wizard.
  set({ brand, loaded: true, exists, setupOpen: !exists || !brand.setup });
}

/** The served URL of a logo file (for thumbnails), cache-busted per change. */
export function logoUrl(file) {
  const base = String(state.assetBaseUrl || '/@lerret-project').replace(/\/+$/, '');
  return `${base}/${BRAND_DIR}/${encodeURIComponent(file)}?v=${state.version}`;
}

// ── Saving ──────────────────────────────────────────────────────────────────

let queue = Promise.resolve();

/** Write brand.json and mirror its colours/fonts into the root config vars. */
function save(next) {
  set({ brand: next, error: null, exists: true });
  const run = async () => {
    const w = await writeProjectFile(`${dir()}/${BRAND_FILE}`, serializeJson(next));
    if (!w.ok) return set({ error: w.error || 'Couldn’t save the brand library.' });
    const cfgPath = `${state.lerretDir}/config.json`;
    const listing = await listProjectDir(state.lerretDir);
    let cfg = {};
    if ((listing.entries || []).some((e) => e.name === 'config.json')) {
      const r = await readProjectFile(cfgPath);
      if (r.ok) {
        try {
          cfg = JSON.parse(r.content) || {};
        } catch {
          return set({ error: 'The project’s config.json has a syntax error — fix it to update brand colours.' });
        }
      }
    }
    const vars = mergeBrandVars(cfg.vars, next);
    const nextCfg = { ...cfg, vars };
    if (Object.keys(vars).length === 0) delete nextCfg.vars;
    const wc = await writeProjectFile(cfgPath, serializeJson(nextCfg));
    if (!wc.ok) set({ error: wc.error || 'Couldn’t update the project config.' });
    return undefined;
  };
  queue = queue.then(run, run);
  return queue;
}

const ids = (list) => list.map((x) => x.id);

export function addColor({ name, value }) {
  const b = state.brand;
  const color = { id: brandId(name || 'Colour', ids(b.colors)), name: name || 'Colour', value };
  return save({ ...b, colors: [...b.colors, color] }).then(() => color);
}
export function updateColor(id, patch) {
  const b = state.brand;
  return save({ ...b, colors: b.colors.map((c) => (c.id === id ? { ...c, ...patch, id } : c)) });
}
export function removeColor(id) {
  const b = state.brand;
  return save({ ...b, colors: b.colors.filter((c) => c.id !== id) });
}

export function addTextStyle(style) {
  const b = state.brand;
  const text = normalizeTextStyle({ ...style, id: brandId(style.name || 'Style', ids(b.textStyles)), name: style.name || 'Style' });
  return save({ ...b, textStyles: [...b.textStyles, text] }).then(() => text);
}
export function updateTextStyle(id, patch) {
  const b = state.brand;
  return save({ ...b, textStyles: b.textStyles.map((t) => (t.id === id ? normalizeTextStyle({ ...t, ...patch, id }) : t)) });
}
export function removeTextStyle(id) {
  const b = state.brand;
  return save({ ...b, textStyles: b.textStyles.filter((t) => t.id !== id) });
}

/** Replace the whole library at once (the setup wizard's "Save"). */
export function saveWholeBrand(next) {
  return save({ ...next, version: 2 });
}

/** Mark the first-run wizard finished or skipped so it doesn't reappear. */
export function markSetup(value) {
  set({ setupOpen: false });
  return save({ ...state.brand, setup: value });
}

export function updateApp(patch) {
  const b = state.brand;
  return save({ ...b, app: { ...b.app, ...patch } });
}

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** A file name in `folder` not yet taken (case-insensitive). */
async function freeName(folder, fileName) {
  const listing = await listProjectDir(folder);
  const taken = new Set((listing.entries || []).map((e) => String(e.name).toLowerCase()));
  const dot = fileName.lastIndexOf('.');
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[^\w .-]+/g, '-').trim() || 'logo';
  const ext = (dot > 0 ? fileName.slice(dot + 1) : 'png').toLowerCase();
  let name = `${stem}.${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${stem}-${n}.${ext}`;
  return name;
}

/** Write an image file into `_brand/` under a free name; returns the name. */
export async function writeBrandFile(file, preferredName = file.name) {
  const name = await freeName(dir(), preferredName);
  const w = await writeProjectFile(`${dir()}/${name}`, await toBase64(file), { encoding: 'base64' });
  if (!w.ok) {
    set({ error: w.error || `Couldn’t save ${name}.` });
    return null;
  }
  set({ version: state.version + 1 });
  return name;
}

/** Add a logo set whose first variant is `file`. */
export async function addLogo(file, { name, kind = 'full', variantLabel = 'Colour' } = {}) {
  const saved = await writeBrandFile(file);
  if (!saved) return null;
  const b = state.brand;
  const label = name || saved.replace(/\.[^.]+$/, '');
  const logo = {
    id: brandId(label, ids(b.logos)),
    name: label,
    kind,
    variants: [{ id: brandId(variantLabel), label: variantLabel, file: saved }],
  };
  await save({ ...b, logos: [...b.logos, logo] });
  return logo;
}

/** Add another colour version (e.g. "Light") to a logo set. */
export async function addLogoVariant(logoId, file, label) {
  const logo = state.brand.logos.find((l) => l.id === logoId);
  if (!logo) return null;
  const saved = await writeBrandFile(file, `${logo.name}-${label}.${(file.name.split('.').pop() || 'png').toLowerCase()}`);
  if (!saved) return null;
  const b = state.brand;
  const variant = { id: brandId(label, logo.variants.map((v) => v.id)), label, file: saved };
  await save({ ...b, logos: b.logos.map((l) => (l.id === logoId ? { ...l, variants: [...l.variants, variant] } : l)) });
  return variant;
}

/**
 * Swap one logo version's image. Same file type → overwritten in place, so
 * every design using it updates. A different type gets a new file name (the
 * old file stays, so existing designs keep showing it).
 */
export async function replaceLogoVariant(logoId, variantId, file) {
  const logo = state.brand.logos.find((l) => l.id === logoId);
  const variant = logo?.variants.find((v) => v.id === variantId);
  if (!variant) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const sameType = variant.file.toLowerCase().endsWith(`.${ext}`);
  const name = sameType ? variant.file : await freeName(dir(), `${logo.name}-${variant.label}.${ext}`);
  const w = await writeProjectFile(`${dir()}/${name}`, await toBase64(file), { encoding: 'base64' });
  if (!w.ok) {
    set({ error: w.error || `Couldn’t save ${name}.` });
    return;
  }
  set({ version: state.version + 1 });
  if (sameType) await refreshLogoInDocument(name);
  else {
    const b = state.brand;
    await save({
      ...b,
      logos: b.logos.map((l) => (l.id === logoId ? { ...l, variants: l.variants.map((v) => (v.id === variantId ? { ...v, file: name } : v)) } : l)),
    });
  }
}

export function updateLogo(id, patch) {
  const b = state.brand;
  return save({ ...b, logos: b.logos.map((l) => (l.id === id ? { ...l, ...patch, id } : l)) });
}

export function removeLogoVariant(logoId, variantId) {
  const b = state.brand;
  return save({
    ...b,
    logos: b.logos
      .map((l) => (l.id === logoId ? { ...l, variants: l.variants.filter((v) => v.id !== variantId) } : l))
      .filter((l) => l.variants.length > 0),
  });
}

/**
 * Designs reference a library logo by a stable URL, so after the file is
 * overwritten the browser would keep showing its cached copy. Re-fetch it
 * past the cache and re-point every <img> using it, so every design on the
 * canvas shows the new logo at once (exports fetch the fresh copy too).
 *
 * @param {string} file
 */
async function refreshLogoInDocument(file) {
  if (typeof document === 'undefined') return;
  const tail = `/${BRAND_DIR}/${file}`;
  const imgs = [...document.querySelectorAll('img')].filter((img) => {
    try {
      return decodeURIComponent(new URL(img.src, location.href).pathname).endsWith(tail);
    } catch {
      return false;
    }
  });
  const urls = [...new Set(imgs.map((img) => img.src))];
  await Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
  for (const img of imgs) {
    const src = img.src;
    img.removeAttribute('src');
    img.src = src;
  }
}

/** Remove from the library. The files stay, so designs already using them keep working. */
export function removeLogo(id) {
  const b = state.brand;
  return save({ ...b, logos: b.logos.filter((l) => l.id !== id) });
}

/** Upload a font file into `.lerret/_fonts/` (picked up by the font registry). */
export async function uploadFontFile(file) {
  const folder = `${state.lerretDir}/_fonts`;
  const name = await freeName(folder, file.name);
  const w = await writeProjectFile(`${folder}/${name}`, await toBase64(file), { encoding: 'base64' });
  if (!w.ok) {
    set({ error: w.error || `Couldn’t save ${name}.` });
    return null;
  }
  return name.replace(/\.[^.]+$/, ''); // the family the registry gives it
}

/** Test hook. */
export function __resetBrandStore() {
  state = { lerretDir: null, assetBaseUrl: null, brand: emptyBrand(), loaded: false, setupOpen: false, exists: false, version: 0, error: null };
  queue = Promise.resolve();
}
