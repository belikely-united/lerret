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
// Scope: `.data.json` only (the form the scaffold + the AI agent write). A
// `.data.js` module would need browser evaluation; it stays a CLI/fixture
// feature for now — a `.data.js` candidate simply reads as null here and the
// loader falls through to `.data.json`.

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
 * @returns {(candidatePath: string) => Promise<Record<string, unknown> | null>}
 */
export function createHostedDataReader(backend) {
  if (!backend || typeof backend.readFile !== 'function') {
    throw new Error('createHostedDataReader: a FilesystemAccess backend is required');
  }
  return async (candidatePath) => {
    // `.data.js` is not evaluated here (see module header) — let the loader fall
    // through to the `.data.json` candidate.
    if (typeof candidatePath !== 'string' || !candidatePath.endsWith('.json')) return null;
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
