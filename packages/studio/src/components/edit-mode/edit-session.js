// Visual Edit mode — session state + save/undo (spec-visual-edit-mode.md).
//
// A tiny module-level store (no provider to wire): the dock toggle and the
// canvas overlay both read it with `useEditMode()`. Saves go through the same
// write-client every editor uses, then the existing watcher → reload loop
// re-renders the artboard. Saves run one at a time (a queue), so a fast
// sequence of edits never reads a file another edit is still writing.

import React from 'react';
import { serializeJson } from '@lerret/core';

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
let state = { enabled: false, selection: null, status: 'idle', error: null, canUndo: false, canRedo: false, revision: 0 };
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
    redoStack.length = 0;
    syncHistoryFlags();
    return { ok: true, code: res.code };
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
    }

    const w = await write(assetPath, res.code);
    if (!w.ok) return { ok: false, error: w.error || 'Couldn’t save.' };
    undoStack.push({ path: assetPath, before: read.source, after: res.code, group });
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
  state = { enabled: false, selection: null, status: 'idle', error: null, canUndo: false, canRedo: false, revision: 0 };
}
