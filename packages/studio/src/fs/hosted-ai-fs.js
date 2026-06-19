// fs/hosted-ai-fs.js — the hosted-mode (File System Access) FilesystemAccess
// bridge for the AI orchestrator. The hosted counterpart of ai-fs.js's
// `createCliAiFs`.
//
// Where the CLI adapter relays ABSOLUTE LerretPaths to the dev server's
// `__lerret/*` HTTP endpoints, this one strips a VIRTUAL projectRoot prefix and
// delegates straight to the in-browser FSA backend (`createFsaBackend`), which
// is already rooted at the user's picked folder and speaks `.lerret/…`-relative
// paths. So `createSandbox({ projectRoot, fs })` accepts it unchanged and the
// agent loop creates / edits / reverts directly on the local folder — no CLI.
//
// ── Why a virtual projectRoot ────────────────────────────────────────────────
// The sandbox does pure-string path math: it builds `projectRoot + '/.lerret/…'`
// and hands the result to `fs.<op>`. The FSA backend has no absolute path (it is
// rooted at the picked folder), and `createSandbox` rejects an empty / `'/'`
// projectRoot — so we address files under a fixed virtual absolute prefix and
// strip it back off before every backend call. Files appear to the agent as
// `${HOSTED_AI_PROJECT_ROOT}/.lerret/…`; on disk they are `.lerret/…`.
//
// ── ENOENT discipline ────────────────────────────────────────────────────────
// The snapshot store branches on `err.code === 'ENOENT'` (file absent) and on an
// empty `readDir` (history dir not bootstrapped yet). The FSA backend instead
// throws a DOMException named `NotFoundError`. This adapter translates: a missing
// dir → `[]`, a missing file read → an ENOENT-shaped throw, a missing delete →
// a no-op success (matching the CLI bridge's semantics).
//
// ── Boundary note ────────────────────────────────────────────────────────────
// Like ai-fs.js, this file must NOT import '@lerret/ai' — it is plain plumbing
// handed TO the orchestrator via runTurn's options.

/**
 * The VIRTUAL project root the sandbox + orchestrator address files under in
 * hosted mode. Purely a string prefix for the sandbox's path math — it never
 * touches disk (this adapter strips it before every backend call). Must be a
 * non-empty POSIX-absolute path that is not the filesystem root, per
 * `createSandbox`'s argument checks.
 *
 * @type {string}
 */
export const HOSTED_AI_PROJECT_ROOT = '/hosted';

/**
 * Build an ENOENT-shaped error (`err.code === 'ENOENT'`) — the shape the
 * orchestrator's snapshot store branches on for "file is absent".
 *
 * @param {string} message
 * @param {string} [path]
 * @returns {Error & { code: 'ENOENT' }}
 */
function enoent(message, path) {
  const err = new Error(`ENOENT: ${message}${path ? ` — ${path}` : ''}`);
  // @ts-expect-error augmenting the Error with the Node-style code field
  err.code = 'ENOENT';
  return /** @type {Error & { code: 'ENOENT' }} */ (err);
}

/**
 * Whether an error means "the entry does not exist" — the FSA API's
 * `NotFoundError` DOMException, or an already-ENOENT-shaped error.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFound(err) {
  return Boolean(
    err &&
      (/** @type {{ name?: string }} */ (err).name === 'NotFoundError' ||
        /** @type {{ code?: string }} */ (err).code === 'ENOENT'),
  );
}

/**
 * Create the hosted-mode FilesystemAccess adapter for the AI orchestrator.
 *
 * @param {import('@lerret/core').FilesystemAccess} backend
 *   The FSA backend (`createFsaBackend`) rooted at the user's picked folder.
 * @returns {import('@lerret/core').FilesystemAccess}
 */
export function createHostedAiFs(backend) {
  if (!backend || typeof backend.readDir !== 'function') {
    throw new Error('createHostedAiFs: a FilesystemAccess backend is required');
  }
  const root = HOSTED_AI_PROJECT_ROOT;

  /**
   * Translate an absolute virtual path (`/hosted/.lerret/…`) to the
   * backend-relative path (`.lerret/…`). The orchestrator always addresses
   * files under the virtual root; the backend speaks relative to the picked
   * folder.
   *
   * @param {string} absPath
   * @returns {string}
   */
  function toRel(absPath) {
    if (typeof absPath !== 'string') {
      throw enoent('path is not a string', String(absPath));
    }
    if (absPath === root) return '';
    if (!absPath.startsWith(`${root}/`)) {
      throw enoent('path is outside the project root', absPath);
    }
    return absPath.slice(root.length + 1);
  }

  /**
   * Re-absolutize a child name under an absolute virtual directory, so readDir
   * entries the snapshot store feeds back into readFile / exists carry the
   * virtual-absolute path the rest of the pipeline expects.
   *
   * @param {string} absDir
   * @param {string} name
   * @returns {string}
   */
  function childAbs(absDir, name) {
    const base = absDir.endsWith('/') ? absDir.slice(0, -1) : absDir;
    return `${base}/${name}`;
  }

  return {
    // The agent never watches or reveals; writes ride the FSA writable stream.
    capabilities: { canWrite: true, canWatch: false, canReveal: false },

    /**
     * List a directory's immediate children in the DirEntry shape the snapshot
     * store consumes, with VIRTUAL-absolute `path`s. A missing directory
     * resolves to `[]` — the store lists `.lerret/.state/history/manifests/`
     * before the first turn ever creates it.
     */
    async readDir(dirPath) {
      const rel = toRel(dirPath);
      let entries;
      try {
        entries = await backend.readDir(rel);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      return entries.map((e) => ({
        name: e.name,
        path: childAbs(dirPath, e.name),
        kind: e.isDirectory ? 'directory' : 'file',
        isFile: e.isFile === true,
        isDirectory: e.isDirectory === true,
      }));
    },

    /**
     * Read a file. UTF-8 by default; `{ encoding: 'binary' }` returns a
     * `Uint8Array` (the FSA backend reads it natively — no base64 hop). An
     * absent file throws ENOENT-shaped, matching the Node/CLI backends so the
     * snapshot store records a new file as "absent" rather than failing.
     */
    async readFile(filePath, options) {
      try {
        return await backend.readFile(toRel(filePath), options);
      } catch (err) {
        if (isNotFound(err)) throw enoent('no such file', filePath);
        throw err;
      }
    },

    /**
     * Write a file (atomic via the FSA writable stream; parents auto-created).
     * A `Uint8Array` is written byte-exact — blob writes round-trip without a
     * base64 detour.
     */
    writeFile(filePath, content, options) {
      return backend.writeFile(toRel(filePath), content, options);
    },

    /** Delete a file. A missing target is a no-op success (matches the CLI bridge). */
    async deleteFile(filePath) {
      try {
        await backend.deleteFile(toRel(filePath));
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },

    /** Recursively create a directory (idempotent). */
    mkdir(dirPath) {
      return backend.mkdir(toRel(dirPath));
    },

    /**
     * Remove an EMPTY directory (POSIX `rmdir` semantic). A missing target is a
     * no-op success — it is already gone.
     */
    async removeDir(dirPath) {
      try {
        await backend.removeDir(toRel(dirPath));
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
    },

    /**
     * Existence probe. Any failure reports `false` — the snapshot store's blob
     * dedup then re-writes the blob, which is harmless; throwing would fail the
     * whole turn over a probe.
     */
    async exists(targetPath) {
      try {
        return await backend.exists(toRel(targetPath));
      } catch {
        return false;
      }
    },

    /** Inert — the orchestrator never watches (`canWatch: false`). */
    watch() {
      return { close() {} };
    },
  };
}

// ── Registry: the live hosted adapter, set at bring-up ───────────────────────
// hosted-project-source registers the adapter once the FSA backend exists (and
// clears it on project switch / unmount). The dock cluster + revert timeline
// read it to decide whether the hosted AI filesystem bridge is available.

/** @type {import('@lerret/core').FilesystemAccess | null} */
let hostedAiFs = null;

/**
 * Register (or clear, with `null`) the live hosted AI filesystem adapter.
 *
 * @param {import('@lerret/core').FilesystemAccess | null} fs
 */
export function setHostedAiFs(fs) {
  hostedAiFs = fs || null;
}

/**
 * The live hosted AI filesystem adapter, or `null` when not in hosted mode (or
 * before a project is open).
 *
 * @returns {import('@lerret/core').FilesystemAccess | null}
 */
export function getHostedAiFs() {
  return hostedAiFs;
}
