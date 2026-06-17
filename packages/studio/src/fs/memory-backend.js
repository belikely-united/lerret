// memory-backend.js — an in-memory implementation of the core `FilesystemAccess`
// contract.
//
// It exists so the hosted-mode code paths (loader, writer, lifecycle) can be
// unit-tested without a real File System Access handle — the FSA picker is a
// native dialog that headless test runners cannot drive. The same object also
// makes a convenient throwaway project for stories and demos.
//
// Paths are LerretPaths: forward-slash separators, no trailing slash, relative
// to an implicit root ('' is the root). Mirrors the shape `node-backend` and
// `fsa-backend` produce so `@lerret/core`'s loader builds an identical model.

import { assertFilesystemContract } from '@lerret/core';

/** Strip a trailing slash so the root normalizes to ''. */
function norm(p) {
  return String(p).replace(/\/+$/, '');
}

/** The parent directory of a LerretPath ('' for a top-level segment). */
function parentOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/** The final segment of a LerretPath. */
function nameOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

/**
 * A typed not-found error mirroring what `fsa-backend` / `node-backend` throw,
 * so callers (and core's `readFolderConfig`) branch identically.
 */
export class MemoryNotFoundError extends Error {
  constructor(path) {
    super(`memory-backend: not found: ${path}`);
    this.name = 'NotFoundError';
  }
}

/**
 * Construct an in-memory `FilesystemAccess` backend, optionally seeded with
 * files.
 *
 * @param {Record<string, string | Uint8Array>} [seed]
 *   A map of LerretPath → file contents. Parent directories are created
 *   implicitly. Example: `{ '.lerret/config.json': '{"vars":{}}' }`.
 * @returns {import('@lerret/core').FilesystemAccess}
 */
export function createMemoryBackend(seed = {}) {
  /** @type {Map<string, string | Uint8Array>} */
  const files = new Map();
  /** @type {Set<string>} The empty string is the always-present root. */
  const dirs = new Set(['']);

  /** Add `path` and every ancestor directory to the dir set. */
  function addDirChain(path) {
    let cur = norm(path);
    while (cur !== '') {
      dirs.add(cur);
      cur = parentOf(cur);
    }
  }

  function setFile(p, content) {
    const path = norm(p);
    files.set(path, content);
    addDirChain(parentOf(path));
  }

  for (const [p, content] of Object.entries(seed)) setFile(p, content);

  /** True iff any file or dir lives directly OR indirectly under `dir`. */
  function hasChildren(dir) {
    for (const f of files.keys()) if (parentOf(f) === dir) return true;
    for (const d of dirs) if (d !== dir && parentOf(d) === dir) return true;
    return false;
  }

  const backend = {
    capabilities: { canWrite: true, canWatch: false, canReveal: false },

    async readDir(dirPath) {
      const dir = norm(dirPath);
      if (dir !== '' && !dirs.has(dir)) throw new MemoryNotFoundError(dir);
      const seen = new Set();
      /** @type {import('@lerret/core').DirEntry[]} */
      const entries = [];
      const consider = (full, isDirectory) => {
        if (full === dir || parentOf(full) !== dir) return;
        const name = nameOf(full);
        if (seen.has(name)) return;
        seen.add(name);
        entries.push({
          name,
          path: full,
          kind: isDirectory ? 'directory' : 'file',
          isFile: !isDirectory,
          isDirectory,
        });
      };
      for (const d of dirs) consider(d, true);
      for (const f of files.keys()) consider(f, false);
      return entries;
    },

    async readFile(filePath, options = {}) {
      const path = norm(filePath);
      if (!files.has(path)) throw new MemoryNotFoundError(path);
      const content = files.get(path);
      if (options.encoding === 'binary') {
        return ArrayBuffer.isView(content)
          ? content
          : new TextEncoder().encode(String(content));
      }
      return ArrayBuffer.isView(content)
        ? new TextDecoder().decode(content)
        : String(content);
    },

    async writeFile(filePath, data) {
      setFile(filePath, data);
    },

    async deleteFile(filePath) {
      const path = norm(filePath);
      if (!files.has(path)) throw new MemoryNotFoundError(path);
      files.delete(path);
    },

    async mkdir(dirPath) {
      addDirChain(dirPath);
    },

    async removeDir(dirPath) {
      const path = norm(dirPath);
      if (path === '' ) throw new Error('memory-backend: refusing to remove the root');
      if (!dirs.has(path)) throw new MemoryNotFoundError(path);
      if (hasChildren(path)) {
        const e = new Error(`memory-backend: directory not empty: ${path}`);
        e.name = 'InvalidModificationError';
        throw e;
      }
      dirs.delete(path);
    },

    async exists(targetPath) {
      const path = norm(targetPath);
      return path === '' || files.has(path) || dirs.has(path);
    },

    watch() {
      let closed = false;
      return {
        close() {
          closed = true;
          void closed;
        },
      };
    },
  };

  return assertFilesystemContract(backend, 'memory-backend');
}
