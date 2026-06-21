// runtime/hosted-data-reader.js — reads an asset's `.data.json` through the FSA
// backend in hosted mode (Epic 10 follow-up; the data-loading counterpart of the
// AI fs bridge).
//
// WHY: the canvas resolves an asset's Tier-1 data via `fetchDataValue`, which in
// CLI / fixture mode dynamic-`import()`s the file through Vite aliases
// (`/@lerret-project`, `/@fixture-lerret`). Those aliases DO NOT EXIST in hosted
// mode (there is no dev server), so every data import 404s and the asset falls
// back to its propsSchema defaults — the `.data.json` is written but never read.
// This reader closes that gap: registered at hosted bring-up, it reads the file
// straight from the user's folder via the File System Access backend, so
// AI-authored text lives in `.data.json` and is loaded + editable in the studio.
//
// Scope: `.data.json` (read + JSON-parsed here) AND `.data.js` / `.data.ts`
// (evaluated through the hosted runtime's `loadDataModule` — transform +
// service-worker + import — passed in by the caller). So a dynamic / `fetch`ing
// data file works in hosted mode too, not just the CLI. Without a module loader
// wired in, a `.data.js` candidate reads as null and the loader falls through to
// `.data.json`.

/** @type {((candidatePath: string) => Promise<Record<string, unknown> | null>) | null} */
let hostedDataReader = null;

/**
 * Register (or clear, with a non-function) the live hosted data reader.
 *
 * @param {((candidatePath: string) => Promise<Record<string, unknown> | null>) | null} fn
 */
export function setHostedDataReader(fn) {
  hostedDataReader = typeof fn === 'function' ? fn : null;
}

/**
 * The live hosted data reader, or `null` outside hosted mode (so the canvas's
 * `fetchDataValue` uses its CLI/fixture dynamic-import path).
 *
 * @returns {((candidatePath: string) => Promise<Record<string, unknown> | null>) | null}
 */
export function getHostedDataReader() {
  return hostedDataReader;
}

/**
 * Build a data reader over an FSA backend. Given a candidate data-file path
 * (`.lerret/…`-relative, exactly as the canvas constructs it from the asset
 * path), reads + parses a `.data.json` and returns the data object — or `null`
 * when the file is absent, not JSON, or unparseable, so the caller falls through
 * to the next candidate (and ultimately the propsSchema defaults).
 *
 * @param {import('@lerret/core').FilesystemAccess} backend
 * @param {{ loadDataModule?: (path: string, opts?: { bust?: string | number }) => Promise<Record<string, unknown> | null> }} [options]
 *   `loadDataModule` — the hosted runtime's data-module loader, used to evaluate
 *   `.data.js` / `.data.ts` candidates. Omit it and those candidates read as
 *   null (the loader then falls through to `.data.json`).
 * @returns {(candidatePath: string, opts?: { bust?: string | number }) => Promise<Record<string, unknown> | null>}
 */
export function createHostedDataReader(backend, options = {}) {
  if (!backend || typeof backend.readFile !== 'function') {
    throw new Error('createHostedDataReader: a FilesystemAccess backend is required');
  }
  const loadDataModule =
    options && typeof options.loadDataModule === 'function' ? options.loadDataModule : null;
  return async (candidatePath, opts = {}) => {
    if (typeof candidatePath !== 'string' || candidatePath.length === 0) return null;
    // `.data.js` / `.data.ts` are MODULES — evaluate them through the hosted
    // runtime (transform → service-worker → import) so they can compute or
    // `fetch` their data. Without a module loader they read as null and the
    // caller falls through to the `.data.json` candidate.
    if (/\.(jsx?|tsx?)$/i.test(candidatePath)) {
      if (!loadDataModule) return null;
      try {
        return await loadDataModule(candidatePath, opts);
      } catch {
        return null;
      }
    }
    if (!candidatePath.endsWith('.json')) return null;
    let text;
    try {
      const raw = await backend.readFile(candidatePath, { encoding: 'utf-8' });
      text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    } catch {
      return null; // absent → next candidate
    }
    try {
      const value = JSON.parse(text);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null; // malformed JSON → defaults
    }
  };
}
