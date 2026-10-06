// Visual Edit mode — session state + save/undo (spec-visual-edit-mode.md).
//
// A tiny module-level store (no provider to wire): the dock toggle and the
// canvas overlay both read it with `useEditMode()`. Saves go through the same
// write-client every editor uses, then the existing watcher → reload loop
// re-renders the artboard. Saves run one at a time (a queue), so a fast
// sequence of edits never reads a file another edit is still writing.

import React from 'react';
import { serializeJson, imageAssetContent } from '@lerret/core';

import {
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  inCliMode,
  hostedWritesEnabled,
} from '../../runtime/write-client.js';
import { defaultReadAssetSource } from '../editors/meta-editor.jsx';
import { getAssetDataPath } from '../../runtime/asset-data-registry.js';

// ── Store ───────────────────────────────────────────────────────────────────

// `revision` bumps on every successful write so the Inspector re-reads the file.
// Editing is always on: clicking a design selects what was clicked. `enabled`
// stays in the state for callers that still read it.
let state = { enabled: true, selection: null, status: 'idle', error: null, canUndo: false, canRedo: false, revision: 0 };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getEditState() {
  return state;
}

export function useEditMode() {
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function setEditEnabled(enabled) {
  set({ enabled, selection: enabled ? state.selection : null });
}

export function toggleEditMode() {
  setEditEnabled(!state.enabled);
}

/** selection: { path, offset, tag, assetPath, variant } | null */
export function selectElement(selection) {
  set({ selection, error: null });
}

/** A calm one-line message in the Inspector footer (not an error). */
export function showNotice(message) {
  set({ status: 'notice', error: message });
}

/** Writes need `@lerret/cli dev` or a hosted folder grant; the fixture is preview-only. */
export function canSave() {
  return inCliMode() || hostedWritesEnabled();
}

// Lazy: the parser only loads once someone actually uses Edit mode.
export const loadEngine = () => import('@lerret/core/source-edit');

// ── Reads ───────────────────────────────────────────────────────────────────

export async function readSource(path) {
  const r = await readProjectFile(path);
  if (r.ok) return { ok: true, source: r.content };
  return defaultReadAssetSource(path); // fixture / dev-server fallback
}

/** `ui/Hero.jsx` → `ui/Hero.data.json` (same rule as the Data editor). */
export function dataPathFor(assetPath) {
  return assetPath.replace(/\.[jt]sx?$/, '.data.json');
}

/**
 * The asset's data file: `{ path, raw, value, writable }`. Uses the server's
 * data-file map when present (no blind probe — see CLAUDE.md "Studio ↔ CLI
 * data contract"); a `.data.js` file is code, so it's read-only here.
 */
export async function readAssetData(assetPath) {
  const known = getAssetDataPath(assetPath);
  const path = known || dataPathFor(assetPath);
  if (known === null) return { path, raw: null, value: {}, writable: true };
  if (/\.js$/.test(path)) return { path, raw: null, value: {}, writable: false };
  const r = await readProjectFile(path);
  if (!r.ok) return { path, raw: null, value: {}, writable: true };
  try {
    const value = JSON.parse(r.content);
    return { path, raw: r.content, value: value && typeof value === 'object' && !Array.isArray(value) ? value : {}, writable: true };
  } catch {
    return { path, raw: r.content, value: {}, writable: false };
  }
}

/** A data file is keyed per variant when the variant's slot is an object. */
export function dataValueFor(fileValue, variant, key) {
  const slot = fileValue[variant];
  if (slot && typeof slot === 'object' && !Array.isArray(slot)) return slot[key];
  return fileValue[key];
}

export function withDataValue(fileValue, variant, key, value) {
  const slot = fileValue[variant];
  if (slot && typeof slot === 'object' && !Array.isArray(slot)) {
    return { ...fileValue, [variant]: { ...slot, [key]: value } };
  }
  return { ...fileValue, [key]: value };
}

/**
 * Keep the selection pointing at the same element after a save rewrote the
 * file. Selections are addressed by source offset; a change entirely BEFORE
 * the element (an image's URL line added at the top, a style added to the
 * artboard root) shifts that offset, so shift the selection with it. Changes
 * at or after the element leave it alone.
 *
 * @param {string} path
 * @param {string | null} before
 * @param {string | null} after
 */
export function rebaseSelection(path, before, after) {
  const sel = state.selection;
  if (!sel || sel.path !== path || typeof before !== 'string' || typeof after !== 'string') return;
  let p = 0;
  const max = Math.min(before.length, after.length);
  while (p < max && before[p] === after[p]) p += 1;
  if (p >= sel.offset) return; // the change starts at/after the element
  let sfx = 0;
  while (
    sfx < max - p &&
    before[before.length - 1 - sfx] === after[after.length - 1 - sfx]
  ) sfx += 1;
  const oldChangeEnd = before.length - sfx;
  if (oldChangeEnd > sel.offset) return; // the change overlaps the element itself
  const offset = sel.offset + (after.length - before.length);
  set({ selection: { ...sel, offset, stamp: `${sel.path}:${offset}` } });
}

// ── Saves (queued) ──────────────────────────────────────────────────────────

let queue = Promise.resolve();
const undoStack = [];
const redoStack = [];

function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

function syncHistoryFlags() {
  set({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
}

async function write(path, content) {
  if (content === null) return deleteProjectFile(path);
  return writeProjectFile(path, content);
}

async function saving(fn) {
  set({ status: 'saving', error: null });
  const res = await fn();
  if (res.ok) set({ status: 'saved', revision: state.revision + 1 });
  else set({ status: 'error', error: res.error });
  return res;
}

/**
 * Apply one source change to the element at `offset` in `path`.
 * @returns {Promise<{ ok: boolean, code?: string, error?: string }>}
 */
export function saveSourceEdit(path, offset, change) {
  return enqueue(() => saving(async () => {
    const [{ applyEdit, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(path)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    const res = applyEdit(read.source, offset, change, path);
    if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
    if (res.code === read.source) return { ok: true, code: res.code };
    const w = await write(path, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: read.source, after: res.code });
    rebaseSelection(path, read.source, res.code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true, code: res.code };
  }));
}

/**
 * Apply several style changes to one element as ONE save and ONE undo step —
 * a resize (width + height + left/top) or a move (left + top) reads as a
 * single action. Each change is a `{ key, value }` (value undefined = remove).
 *
 * @param {string} path
 * @param {number} offset
 * @param {Array<{ key: string, value: unknown }>} changes
 * @param {string} [expectTag]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function saveStyles(path, offset, changes, expectTag) {
  return enqueue(() => saving(async () => {
    const [{ applyEdit, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(path)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    let code = read.source;
    for (const { key, value } of changes) {
      // Style edits never move the element's own `<`, so the offset holds.
      const res = applyEdit(code, offset, { type: 'style', key, value, expectTag }, path);
      if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
      code = res.code;
    }
    if (code === read.source) return { ok: true };
    const w = await write(path, code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: read.source, after: code });
    rebaseSelection(path, read.source, code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

/**
 * Add an element (Add menu: text, shape, phone frame) as the top layer of the
 * element at `offset` — normally an artboard's root.
 *
 * @param {string} path
 * @param {number} offset
 * @param {string} jsx
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function addElement(path, offset, jsx) {
  return enqueue(() => saving(async () => {
    const [{ insertElement, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(path)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    const res = insertElement(read.source, offset, jsx, path);
    if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
    const w = await write(path, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: read.source, after: res.code });
    rebaseSelection(path, read.source, res.code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

/**
 * Put an image file into the element at `offset`: an image slot (phone
 * screen) is filled, an `<img>` gets the new picture. The file is written next
 * to the source; the source change joins the undo stack.
 *
 * @param {string} path
 * @param {number} offset
 * @param {{ file: string, base64: string }} image
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function placeImage(path, offset, image) {
  return enqueue(() => saving(async () => {
    const [{ fillImageSlot, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(path)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    const res = fillImageSlot(read.source, offset, image.file, path);
    if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
    const wi = await writeProjectFile(`${path.slice(0, path.lastIndexOf('/'))}/${image.file}`, image.base64, { encoding: 'base64' });
    if (!wi.ok) return { ok: false, error: wi.error || `Couldn’t save ${image.file}.` };
    const w = await write(path, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: read.source, after: res.code });
    rebaseSelection(path, read.source, res.code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

/** Set one prop in the asset's `.data.json` (for text bound to `{prop}`). */
export function saveDataEdit(assetPath, variant, key, value) {
  return enqueue(() => saving(async () => {
    const { path, raw, value: current, writable } = await readAssetData(assetPath);
    if (!writable) return { ok: false, error: `${path.split('/').pop()} can’t be edited here.` };
    const next = serializeJson(withDataValue(current, variant, key, value));
    if (next === raw) return { ok: true };
    const w = await write(path, next);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: raw, after: next });
    rebaseSelection(path, raw, next);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

const isSlot = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * New variant: add `export const <name> = <component>` to the asset and give
 * it its own slot in the data file, copied from the variant it came from, so
 * the new artboard starts identical and can then be edited on its own. A flat
 * (shared) data file becomes keyed — every existing variant keeps its content.
 */
export function createVariant(assetPath, name, from = 'default') {
  return enqueue(() => saving(async () => {
    const [{ addVariantExport, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(assetPath)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    const res = addVariantExport(read.source, name, from, assetPath);
    if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
    const group = `variant:${Date.now()}`;

    // Data first, so the new artboard's first render already has its slot.
    const data = await readAssetData(assetPath);
    if (data.writable) {
      const cur = data.value;
      const keyed = res.exports.some((n) => isSlot(cur[n]));
      const next = keyed
        ? { ...cur, [name]: { ...(isSlot(cur[from]) ? cur[from] : {}) } }
        : Object.fromEntries(res.exports.map((n) => [n, { ...cur }]));
      const content = serializeJson(next);
      const w = await write(data.path, content);
      if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save the data file.' };
      undoStack.push({ path: data.path, before: data.raw, after: content, group });
      rebaseSelection(data.path, data.raw, content);
    }

    const w = await write(assetPath, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path: assetPath, before: read.source, after: res.code, group });
    rebaseSelection(assetPath, read.source, res.code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

// ── Dropped images ──────────────────────────────────────────────────────────

const folderOf = (path) => path.slice(0, path.lastIndexOf('/'));

/**
 * Insert dropped images into an asset: write each image file next to the
 * source that renders the target element, then add them as top layers inside
 * that element (`insertImageLayers`). The source change joins the undo stack;
 * the image files are left in place on undo (harmless, and re-usable).
 *
 * @param {{ path: string, offset: number, images: Array<{ file: string, base64: string,
 *   left: number, top: number, width: number, height: number }> }} args
 *   `path`/`offset` — the target element's source stamp.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function insertImagesIntoAsset({ path, offset, images }) {
  return enqueue(() => saving(async () => {
    const [{ insertImageLayers, EDIT_REASONS }, read] = await Promise.all([loadEngine(), readSource(path)]);
    if (!read.ok) return { ok: false, error: read.error || 'Couldn’t read the file.' };
    const res = insertImageLayers(
      read.source,
      offset,
      images.map(({ base64: _b, ...box }) => box),
      path,
    );
    if (!res.ok) return { ok: false, error: EDIT_REASONS[res.reason] || res.reason };
    for (const im of images) {
      const w = await writeProjectFile(`${folderOf(path)}/${im.file}`, im.base64, { encoding: 'base64' });
      if (!w.ok) return { ok: false, error: w.error || `Couldn’t save ${im.file}.` };
    }
    const w = await write(path, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path, before: read.source, after: res.code });
    rebaseSelection(path, read.source, res.code);
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

/**
 * Create one image asset per dropped image in `folder`: the image file plus a
 * `<name>.jsx` sized to the image (`imageAssetContent`). Each new asset joins
 * the undo stack as one group (undo removes the asset; the image file stays).
 *
 * @param {{ folder: string, images: Array<{ name: string, file: string, base64: string,
 *   width: number, height: number }> }} args
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function createImageAssets({ folder, images }) {
  return enqueue(() => saving(async () => {
    const group = `images:${Date.now()}`;
    for (const im of images) {
      const wi = await writeProjectFile(`${folder}/${im.file}`, im.base64, { encoding: 'base64' });
      if (!wi.ok) return { ok: false, error: wi.error || `Couldn’t save ${im.file}.` };
      const assetPath = `${folder}/${im.name}.jsx`;
      const content = imageAssetContent(im.name, im.file, { width: im.width, height: im.height });
      const wa = await write(assetPath, content);
      if (!wa.ok) return { ok: false, error: wa.error || 'Couldn’t save.' };
      undoStack.push({ path: assetPath, before: null, after: content, group });
      rebaseSelection(assetPath, null, content);
    }
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true };
  }));
}

async function step(from, to, pick) {
  const entry = from[from.length - 1];
  if (!entry) return { ok: true };
  const [expected, restore] = pick(entry);
  const current = await readProjectFile(entry.path);
  const now = current.ok ? current.content : null;
  if (now !== expected && typeof window !== 'undefined'
      && !window.confirm(`${entry.path.split('/').pop()} changed since this edit. Overwrite it anyway?`)) {
    return { ok: true };
  }
  const w = await write(entry.path, restore);
  if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
  rebaseSelection(entry.path, now, restore);
  to.push(from.pop());
  syncHistoryFlags();
  // One user action that wrote several files (e.g. New variant) undoes as one.
  if (entry.group && from[from.length - 1]?.group === entry.group) return step(from, to, pick);
  return { ok: true };
}

export function undo() {
  return enqueue(() => saving(() => step(undoStack, redoStack, (e) => [e.after, e.before])));
}

export function redo() {
  return enqueue(() => saving(() => step(redoStack, undoStack, (e) => [e.before, e.after])));
}

/** Test hook: reset the module state between tests. */
export function __resetEditSession() {
  undoStack.length = 0;
  redoStack.length = 0;
  queue = Promise.resolve();
  state = { enabled: true, selection: null, status: 'idle', error: null, canUndo: false, canRedo: false, revision: 0 };
}
