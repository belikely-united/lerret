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
  brandId,
  parseBrand,
  mergeBrandVars,
  serializeJson,
} from '@lerret/core';

import { readProjectFile, writeProjectFile, listProjectDir } from '../../runtime/write-client.js';

let state = {
  lerretDir: null,
  assetBaseUrl: null,
  brand: emptyBrand(),
  loaded: false,
  open: false,
  version: 0, // bumps on every logo change, for thumbnail cache-busting
  error: null,
};
const listeners = new Set();
const set = (patch) => {
  state = { ...state, ...patch };
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
export const setBrandOpen = (open) => set({ open: !!open });
export const toggleBrandOpen = () => set({ open: !state.open });

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
  if ((listing.entries || []).some((e) => e.name === BRAND_FILE)) {
    const r = await readProjectFile(`${dir()}/${BRAND_FILE}`);
    if (r.ok) brand = parseBrand(r.content);
  }
  if (state.lerretDir === lerretDir) set({ brand, loaded: true });
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
  set({ brand: next, error: null });
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

export function addFont({ name, family }) {
  const b = state.brand;
  const font = { id: brandId(name || family, ids(b.fonts)), name: name || family, family };
  return save({ ...b, fonts: [...b.fonts, font] }).then(() => font);
}
export function updateFont(id, patch) {
  const b = state.brand;
  return save({ ...b, fonts: b.fonts.map((f) => (f.id === id ? { ...f, ...patch, id } : f)) });
}
export function removeFont(id) {
  const b = state.brand;
  return save({ ...b, fonts: b.fonts.filter((f) => f.id !== id) });
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

export async function addLogo(file) {
  const name = await freeName(dir(), file.name);
  const w = await writeProjectFile(`${dir()}/${name}`, await toBase64(file), { encoding: 'base64' });
  if (!w.ok) {
    set({ error: w.error || `Couldn’t save ${name}.` });
    return null;
  }
  const b = state.brand;
  const label = name.replace(/\.[^.]+$/, '');
  const logo = { id: brandId(label, ids(b.logos)), name: label, file: name };
  set({ version: state.version + 1 });
  await save({ ...b, logos: [...b.logos, logo] });
  return logo;
}

/**
 * Swap a logo's image. Same file type → the file is overwritten in place, so
 * every design using it updates. A different type gets a new file name (the
 * old one stays, so existing designs keep showing the old logo).
 */
export async function replaceLogo(id, file) {
  const logo = state.brand.logos.find((l) => l.id === id);
  if (!logo) return;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const sameType = logo.file.toLowerCase().endsWith(`.${ext}`);
  const name = sameType ? logo.file : await freeName(dir(), `${logo.name}.${ext}`);
  const w = await writeProjectFile(`${dir()}/${name}`, await toBase64(file), { encoding: 'base64' });
  if (!w.ok) {
    set({ error: w.error || `Couldn’t save ${name}.` });
    return;
  }
  set({ version: state.version + 1 });
  if (sameType) await refreshLogoInDocument(name);
  if (!sameType) {
    const b = state.brand;
    await save({ ...b, logos: b.logos.map((l) => (l.id === id ? { ...l, file: name } : l)) });
  }
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

export function renameLogo(id, name) {
  const b = state.brand;
  return save({ ...b, logos: b.logos.map((l) => (l.id === id ? { ...l, name } : l)) });
}

/** Remove from the library. The file stays, so designs already using it keep working. */
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
  state = { lerretDir: null, assetBaseUrl: null, brand: emptyBrand(), loaded: false, open: false, version: 0, error: null };
  queue = Promise.resolve();
}
