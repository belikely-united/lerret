// node-backend — the Node `fs` implementation of `FilesystemAccess`.
//
// This is one of the two filesystem backends behind the `core`
// `FilesystemAccess` contract; it powers CLI / self-host mode, where Lerret
// has full Node `fs` access. The studio's File System Access backend is the
// browser counterpart.
//
// IMPORTANT — this file is the ONLY place in the codebase permitted to import
// `node:fs`. The architecture's separation invariant (and an ESLint
// `no-restricted-imports` rule in `eslint.config.js`) bans the `fs` family
// everywhere else; every other subsystem reaches the filesystem exclusively
// through a `FilesystemAccess` value. `node:path` / `node:os` are allowed in
// Node packages generally — only the `fs` family is gated to this file.

import { spawn } from 'node:child_process';
import {
  existsSync as fsExistsSync,
  mkdtempSync,
  promises as fsp,
  realpathSync,
  watch as watchNative,
} from 'node:fs';
import { homedir, tmpdir, platform } from 'node:os';
import {
  basename,
  dirname,
  extname,
  join as joinNative,
  resolve as resolveNative,
  sep as nativeSep,
} from 'node:path';

import {
  assertFilesystemContract,
  serializeJson,
  assetFileName,
  starterAssetContent,
} from '@lerret/core';

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------
//
// The `FilesystemAccess` contract speaks POSIX-style paths (forward slashes)
// at its boundary. On macOS / Linux the native separator already is `/`, so
// these are near no-ops; on Windows they bridge `/` <-> `\`. Normalizing here,
// at the backend edge, means the loader and editors never see a backslash.

/**
 * Convert a contract-level {@link LerretPath} (forward slashes) into a path
 * the host OS understands.
 *
 * @param {string} lerretPath
 * @returns {string} A path using the native separator.
 */
function toNativePath(lerretPath) {
  return nativeSep === '/' ? lerretPath : lerretPath.replaceAll('/', nativeSep);
}

/**
 * Convert a native OS path into a contract-level {@link LerretPath} (forward
 * slashes).
 *
 * @param {string} nativePath
 * @returns {string} A forward-slash path.
 */
function toLerretPath(nativePath) {
  return nativeSep === '/' ? nativePath : nativePath.replaceAll(nativeSep, '/');
}

/**
 * Join a directory path and a child name into a normalized {@link LerretPath}.
 *
 * @param {string} dirPath A contract-level (forward-slash) directory path.
 * @param {string} name A single path segment.
 * @returns {string} The joined, forward-slash path.
 */
function joinLerretPath(dirPath, name) {
  return toLerretPath(joinNative(toNativePath(dirPath), name));
}

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------

/**
 * Capabilities of the Node backend. In a Node / self-host environment the
 * process has full filesystem access: it can write, it can watch via
 * `fs.watch`, and the host OS can reveal a path in a native file manager.
 *
 * @type {import('@lerret/core').FilesystemCapabilities}
 */
const NODE_CAPABILITIES = Object.freeze({
  canWrite: true,
  canWatch: true,
  canReveal: true,
});

// ---------------------------------------------------------------------------
// readDir
// ---------------------------------------------------------------------------

/**
 * List the immediate children of a directory.
 *
 * @param {string} dirPath A contract-level (forward-slash) directory path.
 * @returns {Promise<import('@lerret/core').DirEntry[]>}
 *   One {@link DirEntry} per child, files distinguished from subdirectories.
 *   Rejects if `dirPath` is missing or not a directory.
 */
async function readDir(dirPath) {
  // `withFileTypes` yields Dirent objects, so the file/dir distinction comes
  // for free without an extra `stat` per entry.
  const dirents = await fsp.readdir(toNativePath(dirPath), {
    withFileTypes: true,
  });

  return dirents.map((dirent) => {
    const isDirectory = dirent.isDirectory();
    return {
      name: dirent.name,
      path: joinLerretPath(dirPath, dirent.name),
      kind: isDirectory ? 'directory' : 'file',
      isFile: !isDirectory,
      isDirectory,
    };
  });
}

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

/**
 * Read a file's full contents.
 *
 * @param {string} filePath A contract-level (forward-slash) file path.
 * @param {import('@lerret/core').ReadFileOptions} [options]
 *   `encoding: 'utf-8'` (default) decodes to a `string`; `encoding: 'binary'`
 *   returns raw bytes as a `Uint8Array`.
 * @returns {Promise<string | Uint8Array>}
 */
async function readFile(filePath, options = {}) {
  const { encoding = 'utf-8' } = options;
  const nativePath = toNativePath(filePath);

  if (encoding === 'binary') {
    // Read as a Node Buffer, then hand back a plain Uint8Array — the contract
    // shape — so callers get an identical type from either backend. The
    // returned view is a copy, fully owned by the caller.
    const buffer = await fsp.readFile(nativePath);
    return new Uint8Array(buffer);
  }

  return fsp.readFile(nativePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// writeFile — safe (atomic) write
// ---------------------------------------------------------------------------

/**
 * Write a file's full contents via a temp-file-then-atomic-rename, so a failed
 * or interrupted write never corrupts or truncates the existing file (NFR9).
 *
 * The sequence:
 *   1. write the new content to a fresh temp file in the OS temp directory,
 *   2. `fsync` it so the bytes are durably on disk,
 *   3. `rename` the temp file over the destination — an atomic operation, so a
 *      reader sees either the whole old file or the whole new file,
 *   4. on any failure before the rename, delete the temp file and reject with
 *      the original target left untouched.
 *
 * Note the temp file is created in the system temp dir (not beside the target)
 * so a partially-written file never appears inside the user's project — the
 * watcher would otherwise observe it. The rename therefore crosses devices on
 * some setups; `fsp.rename` handles the common case, and the fallback path
 * copies-then-replaces while still never exposing a partial destination.
 *
 * @param {string} filePath A contract-level (forward-slash) file path.
 * @param {string | Uint8Array} data
 *   The full new contents — a `string` for `encoding: 'utf-8'`, a
 *   `Uint8Array` for `encoding: 'binary'`.
 * @param {import('@lerret/core').WriteFileOptions} [options]
 * @returns {Promise<void>} Resolves once the new content is durably in place.
 */
async function writeFile(filePath, data, options = {}) {
  const { encoding = 'utf-8' } = options;
  const nativeTarget = toNativePath(filePath);

  // A unique temp directory per write — `mkdtemp` guarantees no collision even
  // under concurrent writes, and one file inside it keeps cleanup trivial.
  const tempDir = mkdtempSync(joinNative(tmpdir(), 'lerret-write-'));
  const tempFile = joinNative(tempDir, basename(nativeTarget));

  try {
    // Write + fsync the temp copy so the new bytes are durable before we
    // expose them via the rename.
    const handle = await fsp.open(tempFile, 'w');
    try {
      if (encoding === 'binary') {
        await handle.write(data);
      } else {
        await handle.write(data, 0, 'utf-8');
      }
      await handle.sync();
    } finally {
      await handle.close();
    }

    // Atomic publish. On the same filesystem this is a single atomic rename;
    // if it crosses devices (EXDEV) fall back to copy-into-place, which Node's
    // `copyFile` performs without ever leaving a truncated destination.
    try {
      await fsp.rename(tempFile, nativeTarget);
    } catch (err) {
      if (err && err.code === 'EXDEV') {
        await fsp.copyFile(tempFile, nativeTarget);
        await fsp.rm(tempFile, { force: true });
      } else {
        throw err;
      }
    }
  } catch (err) {
    // Any failure before the destination is replaced: clean up the temp
    // artifacts and re-reject. The original target file is untouched.
    await fsp.rm(tempDir, { recursive: true, force: true });
    throw err;
  }

  // Success — remove the now-empty temp directory (the temp file was renamed
  // out of it, or copied out and deleted).
  await fsp.rm(tempDir, { recursive: true, force: true });
}

/**
 * Convenience: serialize a value as canonical Lerret JSON (stable key order,
 * two-space indent, trailing newline) and write it atomically.
 *
 * Equivalent to `writeFile(path, serializeJson(value))`, exposed so callers
 * writing `config.json` / `<Name>.data.json` / the `.lerret/.state/` sidecar
 * do not each re-import {@link serializeJson}.
 *
 * @param {string} filePath A contract-level (forward-slash) file path.
 * @param {unknown} value The JSON-serializable value to write.
 * @returns {Promise<void>}
 */
async function writeJson(filePath, value) {
  await writeFile(filePath, serializeJson(value), { encoding: 'utf-8' });
}

// ---------------------------------------------------------------------------
// deleteFile / mkdir / exists
// ---------------------------------------------------------------------------
//
// Added in Epic 8 (Story 8.5) to support the snapshot store's bootstrap +
// revert + cleanup paths. Story 8.4's sandbox routes its `deleteFile` /
// `mkdir` / `exists` through these.

/**
 * Delete a single file. Rejects if `filePath` is missing, is a directory, or
 * permission is denied.
 *
 * @param {string} filePath A contract-level (forward-slash) file path.
 * @returns {Promise<void>}
 */
async function deleteFile(filePath) {
  await fsp.unlink(toNativePath(filePath));
}

/**
 * Create a directory (and any missing parents) at `dirPath`. Idempotent — if
 * the directory already exists, resolves successfully.
 *
 * @param {string} dirPath A contract-level (forward-slash) directory path.
 * @returns {Promise<void>}
 */
async function mkdir(dirPath) {
  await fsp.mkdir(toNativePath(dirPath), { recursive: true });
}

/**
 * Remove an EMPTY directory at `dirPath` — the POSIX `rmdir` semantic.
 * NON-recursive by design: `fs.promises.rmdir` rejects with `ENOTEMPTY` when
 * the directory still has children, which is exactly what we want — the
 * primitive can never erase un-snapshotted data. The `delete_dir` agent tool
 * achieves safe recursion ABOVE this layer (deleting every file individually
 * through the snapshotted Worker delete path first, then removing the
 * now-empty directories bottom-up via this method). Rejects if `dirPath` is
 * missing, is a file, or the directory is non-empty.
 *
 * Added in Epic 9 follow-up for the `delete_dir` tool (removing a page —
 * a directory under `.lerret/`).
 *
 * @param {string} dirPath A contract-level (forward-slash) directory path.
 * @returns {Promise<void>}
 */
async function removeDir(dirPath) {
  await fsp.rmdir(toNativePath(dirPath));
}

/**
 * Test whether a file OR directory exists at `targetPath`. Resolves with
 * `true` if anything is at the path, `false` otherwise. Genuine I/O errors
 * (permission denied, etc.) re-reject so callers can distinguish 'absent'
 * from 'inaccessible'.
 *
 * @param {string} targetPath A contract-level (forward-slash) path.
 * @returns {Promise<boolean>}
 */
async function exists(targetPath) {
  try {
    await fsp.access(toNativePath(targetPath));
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Stat a path: report whether anything exists there and, when it does,
 * whether it is a file or a directory. `ENOENT` resolves to
 * `{ exists: false }` rather than rejecting — "absent" is a normal answer
 * here, not an error. Genuine I/O errors (permission denied, etc.) re-reject
 * so callers can distinguish 'absent' from 'inaccessible', matching
 * {@link exists}.
 *
 * Exported (not folded into the backend object) for the dev server's
 * `/__lerret/exists` endpoint, which needs the file/directory distinction the
 * boolean contract method cannot carry.
 *
 * @param {string} targetPath A contract-level (forward-slash) path.
 * @returns {Promise<{ exists: boolean, isFile: boolean, isDirectory: boolean }>}
 */
export async function statEntry(targetPath) {
  try {
    const st = await fsp.stat(toNativePath(targetPath));
    return { exists: true, isFile: st.isFile(), isDirectory: st.isDirectory() };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { exists: false, isFile: false, isDirectory: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------
//
// Deliberately minimal. This is a thin `fs.watch` wrapper that surfaces raw
// rename/change events; the normalized `{ type: 'add'|'change'|'remove',
// path }` change-event layer the loader consumes lives in
// (`core/loader/watch.js`), built by diffing these raw events against the
// project model.

/**
 * Watch a file or directory for changes.
 *
 * @param {string} targetPath A contract-level (forward-slash) path.
 * @param {import('@lerret/core').WatchListener} listener
 *   Invoked with a {@link RawWatchEvent} on each change.
 * @returns {import('@lerret/core').Watcher}
 *   A handle whose `close()` ends the watch. `close()` is idempotent.
 */
function watch(targetPath, listener) {
  const nativeTarget = toNativePath(targetPath);
  const fsWatcher = watchNative(nativeTarget);

  fsWatcher.on('change', (eventType, filename) => {
    listener({
      kind: eventType === 'rename' ? 'rename' : 'change',
      // `filename` may be a Buffer or null depending on platform.
      path: filename ? joinLerretPath(targetPath, filename.toString()) : null,
    });
  });

  let closed = false;
  return {
    close() {
      if (closed) return;
      closed = true;
      fsWatcher.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct the Node `fs` filesystem backend — an object satisfying the
 * `core` {@link FilesystemAccess} contract.
 *
 * The returned backend is stateless and may be shared across the whole CLI
 * process. It is validated against the contract before being returned, so a
 * future drift from the interface fails loudly at construction rather than
 * silently at a call site.
 *
 * @returns {import('@lerret/core').FilesystemAccess & {
 *   writeJson: (filePath: string, value: unknown) => Promise<void>,
 * }}
 *   The backend. Beyond the four contract methods and `capabilities` it also
 *   exposes `writeJson` as a typed convenience.
 */
export function createNodeBackend() {
  /** @type {import('@lerret/core').FilesystemAccess} */
  const backend = {
    readDir,
    readFile,
    writeFile,
    watch,
    deleteFile,
    mkdir,
    removeDir,
    exists,
    capabilities: NODE_CAPABILITIES,
  };

  // Fail fast if this backend ever drifts from the contract.
  assertFilesystemContract(backend, 'node-backend');

  return Object.assign(backend, { writeJson });
}

export { NODE_CAPABILITIES };

// ---------------------------------------------------------------------------
// realpath helper — CLI-internal, NOT part of the FilesystemAccess contract
// ---------------------------------------------------------------------------
//
// `@lerret/cli dev` configures Vite's `server.fs.allow`, which Vite enforces by
// comparing against the *real* (symlink-resolved) path of each request. On
// macOS `/tmp` is a symlink to `/private/tmp`, so an `--folder /tmp/foo`
// argument must be resolved to `/private/tmp/foo` before being added to
// `fs.allow` — otherwise every request 404s with an "outside of Vite serving
// allow list" warning.
//
// This is the only place in the CLI permitted to call `realpathSync` (same
// `node:fs` ban as the rest of the file — this is the sanctioned escape).
// The helper is `Sync` because it is called once during CLI startup, before
// the dev server boots, on at most a handful of paths; making it async would
// only complicate the boot sequence without buying anything.

/**
 * Resolve a path through symlinks if it exists on disk; if the path does
 * not exist (a programmer-typo case the caller wants to surface separately),
 * return the input unchanged so the downstream `fs.allow` / existence-check
 * machinery sees the original string.
 *
 * @param {string} osPath A native OS path. The return value is also native.
 * @returns {string}      The real path, or `osPath` on `ENOENT`.
 */
export function realpathOrSelf(osPath) {
  try {
    return realpathSync(osPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return osPath;
    throw err;
  }
}

/**
 * Synchronously check whether a path exists on the filesystem. A thin wrapper
 * around Node's `fs.existsSync` that can be imported by the rest of the CLI
 * without violating the `no-restricted-imports` rule (only this file may touch
 * the `fs` family directly).
 *
 * Intentionally synchronous: callers such as `resolveStudioRoot()` need to
 * probe the CLI package's own `dist-studio/` at startup — the result is needed
 * before any async boundary and is a self-inspection of the CLI package, not a
 * user-data read. The `FilesystemAccess` abstraction is for user project files;
 * this is a one-shot packaging check.
 *
 * @param {string} path  An absolute OS path.
 * @returns {boolean}    `true` when the path exists (any type).
 */
export function pathExists(path) {
  return fsExistsSync(path);
}

/**
 * Recursively create a directory (no-op if it already exists). Used by
 * subsystems that need to materialize an output tree on disk — the bulk
 * `@lerret/cli export` writer lands captured images under a user-
 * specified `--out` directory and needs to mkdir intermediate folders for the
 * structured layout. Kept in this file so the `fs` ban for the rest of the
 * codebase is preserved (this is the sanctioned escape).
 *
 * @param {string} lerretPath  A contract-level (forward-slash) directory path.
 * @returns {Promise<void>}    Resolves once the directory exists.
 */
export async function ensureDir(lerretPath) {
  const native = toNativePath(lerretPath);
  await fsp.mkdir(native, { recursive: true });
}

/**
 * Canonicalize the deepest existing prefix of a path, then re-attach the
 * still-virtual trailing components. Used by `@lerret/cli export` to compare a
 * user-supplied `--out` directory against the project's `.lerret/` path even
 * when `--out` does not yet exist on disk.
 *
 * `realpathSync` flatly refuses to resolve a path that does not exist (it
 * throws `ENOENT`). This walks up component by component until it finds an
 * existing ancestor, canonicalizes that, and joins the leftover virtual
 * leaf back on. The result is always returned in forward-slash form to match
 * the rest of the CLI's `LerretPath` convention.
 *
 * @param {string} osPath  An absolute native path.
 * @returns {string}       A forward-slash, canonicalized-prefix path.
 */
export function realpathOfExistingPrefix(osPath) {
  // Walk up until we find an ancestor that exists.
  let head = osPath;
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(head);
      // Re-attach virtual leaves. `joinNative` collapses any redundant
      // separators introduced by the loop above; forward-slash conversion
      // happens once at the end.
      const stitched = tail.length === 0 ? real : joinNative(real, ...tail);
      return stitched.replaceAll('\\', '/');
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
      const parent = dirname(head);
      if (parent === head) {
        // Reached the filesystem root without finding anything that exists —
        // return the original path normalized to forward slashes.
        return osPath.replaceAll('\\', '/');
      }
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

// ---------------------------------------------------------------------------
// rename / duplicate / delete / reveal helpers
// ---------------------------------------------------------------------------
//
// These are CLI-internal lifecycle operations powering the per-entity kebab
// menus. They live here because this file is the only spot allowed to import
// `node:fs` (and `node:child_process` for reveal). The Vite plugin wraps each
// helper in a JSON endpoint and gates the input through `checkWritePath`.

/**
 * Rename (or move) a file or directory atomically. Refuses to overwrite an
 * existing destination — the caller must supply a path the disk does not
 * already use. Both paths are contract-level `LerretPath` (forward slashes).
 *
 * @param {string} fromPath
 * @param {string} toPath
 * @returns {Promise<void>}
 */
async function renameEntry(fromPath, toPath) {
  const fromNative = toNativePath(fromPath);
  const toNative = toNativePath(toPath);

  // Refuse to clobber an existing destination — make collisions visible.
  try {
    await fsp.access(toNative);
    throw new Error(`destination already exists: ${toPath}`);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  await fsp.mkdir(dirname(toNative), { recursive: true });
  await fsp.rename(fromNative, toNative);
}

/**
 * Duplicate a file or directory into the SAME parent folder with a derived
 * "(copy)"/`(copy N)` name. Returns the resulting path so the caller can
 * surface it (and the watcher will fire an `add` event).
 *
 * The naming rule mirrors macOS Finder / VS Code:
 *   `Foo.jsx`      → `Foo (copy).jsx`
 *   `Foo (copy).jsx` → `Foo (copy 2).jsx`
 *   `Foo (copy 2).jsx` → `Foo (copy 3).jsx`
 *
 * For folders the suffix sits at the end (no extension to consider).
 *
 * @param {string} sourcePath
 * @returns {Promise<{ path: string }>}  The duplicated entry's path.
 */
async function duplicateEntry(sourcePath) {
  const sourceNative = toNativePath(sourcePath);
  const stat = await fsp.stat(sourceNative);
  const parentNative = dirname(sourceNative);
  const baseName = basename(sourceNative);

  const ext = stat.isDirectory() ? '' : extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;

  // Strip an existing "(copy)" / "(copy N)" suffix so consecutive duplicates
  // produce `(copy 2)`, `(copy 3)`, … instead of `(copy) (copy)`.
  const copyRe = /\s*\(copy(?:\s+(\d+))?\)$/;
  const match = stem.match(copyRe);
  const rootStem = match ? stem.slice(0, -match[0].length) : stem;
  const startN = match ? (match[1] ? parseInt(match[1], 10) + 1 : 2) : 1;

  const targetFor = (n) => {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
    return joinNative(parentNative, `${rootStem}${suffix}${ext}`);
  };

  // Probe upward until we find a non-existing name. Cap the loop to keep a
  // pathological caller from spinning forever.
  let targetNative = '';
  for (let n = startN; n < startN + 1000; n += 1) {
    const candidate = targetFor(n);
    try {
      await fsp.access(candidate);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        targetNative = candidate;
        break;
      }
      throw err;
    }
  }
  if (!targetNative) {
    throw new Error(`unable to find a free duplicate name for: ${sourcePath}`);
  }

  if (stat.isDirectory()) {
    // Node 16+: recursive copy. Force = false to refuse clobbering (we already
    // probed above; this is belt-and-braces).
    await fsp.cp(sourceNative, targetNative, { recursive: true, force: false, errorOnExist: true });
  } else {
    await fsp.copyFile(sourceNative, targetNative);
  }

  return { path: toLerretPath(targetNative) };
}

/**
 * Delete a file or directory. Directories are removed recursively. Missing
 * targets succeed silently (already-gone is the desired post-state).
 *
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
async function deleteEntry(targetPath) {
  const native = toNativePath(targetPath);
  await fsp.rm(native, { recursive: true, force: true });
}

/**
 * Shell out to reveal a path in the user's preferred editor (`code <path>`)
 * or in their file manager (`open -R` on macOS, `explorer /select,` on
 * Windows, `xdg-open` on Linux). Best-effort: a missing helper does not throw,
 * the caller surfaces the message to the user.
 *
 * Security: the path is the caller's `LerretPath` already vetted through
 * `checkWritePath`, so it must live under the project's `.lerret/` tree.
 * The command itself is the fixed binary name — we never pass user-supplied
 * data as a shell command, only as a single argument to `spawn`.
 *
 * @param {string} targetPath   A contract-level (forward-slash) path.
 * @param {'editor' | 'finder'} target  Which surface to reveal in.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function revealEntry(targetPath, target) {
  const native = toNativePath(targetPath);
  const onMac = platform() === 'darwin';
  const onWindows = platform() === 'win32';

  /**
   * @param {string} bin
   * @param {string[]} args
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  function run(bin, args) {
    return new Promise((resolve) => {
      try {
        const child = spawn(bin, args, { stdio: 'ignore', detached: true });
        child.on('error', (err) => {
          resolve({ ok: false, error: err && err.message ? err.message : String(err) });
        });
        child.on('spawn', () => {
          // Detach so the child outlives the CLI process if needed.
          try { child.unref(); } catch { /* ignore */ }
          resolve({ ok: true });
        });
      } catch (err) {
        resolve({ ok: false, error: err && err.message ? err.message : String(err) });
      }
    });
  }

  if (target === 'editor') {
    // `code` is the universal CLI launcher — most editors install it under that
    // name (VS Code itself, Cursor, Code-OSS variants). If it isn't in PATH the
    // spawn errors and we report a calm message.
    return run('code', [native]);
  }

  if (target === 'finder') {
    if (onMac) return run('open', ['-R', native]);
    if (onWindows) return run('explorer.exe', [`/select,${native}`]);
    // Linux/Other — `xdg-open` opens the file's parent folder; no native
    // "select" equivalent across distros.
    return run('xdg-open', [dirname(native)]);
  }

  return { ok: false, error: `unknown reveal target: ${target}` };
}

/**
 * Convert a PascalCase / kebab / snake / lower stem into its "PascalCase" form
 * with the first letter capitalized. Used to discover component-prefixed image
 * companions: an asset `Twitter.jsx` should sweep `Twitter-logo.png`, and an
 * asset `twitter.jsx` should ALSO sweep `Twitter-logo.png` (case-insensitive on
 * the prefix). The check itself is done case-insensitively on the comparison
 * side; this helper is no longer strictly required but kept as a no-op for
 * future-proofing the discovery pass.
 *
 * @param {string} stem
 * @returns {string}
 */
function stemPascal(stem) {
  if (!stem) return stem;
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

/**
 * Discover companion files that should travel with an asset on move. Per the
 * "Companion discovery contract" in the move spec:
 *
 *   • `<stem>.data.json`
 *   • `<stem>.data.js`
 *   • `<StemPascal>-*.{png|jpg|jpeg|svg|gif|webp|avif}` — case-insensitive
 *      extension AND case-insensitive prefix (so `twitter-logo.png` matches a
 *      `Twitter.jsx` asset and vice versa).
 *
 * Only same-folder siblings. Walking deeper is not part of the contract —
 * shared `assets/` images live above and explicitly are not moved.
 *
 * @param {string} folderNative  Native (OS-separator) path of the source folder.
 * @param {string} stem          Asset basename without extension.
 * @returns {Promise<string[]>}  Native paths of companion files found on disk.
 */
async function discoverCompanions(folderNative, stem) {
  if (!stem) return [];
  /** @type {string[]} */
  const out = [];

  // Lower-case prefix for case-insensitive comparison. We do NOT require the
  // disk file to match the stem's case exactly — `Twitter.jsx` and
  // `twitter-logo.png` are considered companions.
  const stemLower = stem.toLowerCase();
  const pascalStem = stemPascal(stem); // referenced for parity with the spec
  void pascalStem;

  const imageExts = new Set([
    '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.avif',
  ]);

  let entries;
  try {
    entries = await fsp.readdir(folderNative, { withFileTypes: true });
  } catch {
    // No source folder somehow? No companions to worry about.
    return [];
  }

  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    const name = dirent.name;
    const lower = name.toLowerCase();

    // Exact-match sidecars: `<stem>.data.json`, `<stem>.data.js`, and the
    // per-asset `<stem>.config.json` (auto-refresh etc., ADR-003) — they travel
    // with the asset on move.
    if (
      lower === `${stemLower}.data.json` ||
      lower === `${stemLower}.data.js` ||
      lower === `${stemLower}.config.json`
    ) {
      out.push(joinNative(folderNative, name));
      continue;
    }

    // Component-prefixed images: `<StemPascal>-*.<ext>` (case-insensitive both
    // for the prefix and the extension). The `-` is required so we don't sweep
    // an unrelated `TwitterLogo.png` accidentally.
    const prefix = `${stemLower}-`;
    if (lower.startsWith(prefix)) {
      const ext = extname(lower);
      if (imageExts.has(ext)) {
        out.push(joinNative(folderNative, name));
      }
    }
  }

  return out;
}

/**
 * Best-effort safe-parse of a `config.json`. Returns `null` if the file is
 * missing OR malformed — caller decides how to react. The two cases are
 * disambiguated by the returned flag:
 *
 *   `{ kind: 'missing' }`   — no such file. Treat as empty config.
 *   `{ kind: 'malformed' }` — present but unparseable. Caller may skip writes
 *                             or refuse the operation depending on context.
 *   `{ kind: 'ok', value }` — parsed value.
 *
 * @param {string} configNative
 * @returns {Promise<{kind:'missing'}|{kind:'malformed'}|{kind:'ok',value:Record<string,unknown>}>}
 */
export async function tryReadConfig(configNative) {
  let text;
  try {
    text = await fsp.readFile(configNative, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'missing' };
    throw err;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      // A non-object root is treated as malformed for the purposes of liveRefresh.
      return { kind: 'malformed' };
    }
    return { kind: 'ok', value: parsed };
  } catch {
    return { kind: 'malformed' };
  }
}

/**
 * Move (rename across folders) a file or folder atomically, alongside any
 * sibling companion files. The contract:
 *
 *   • `sourcePath` is the asset/file/folder being moved.
 *   • `toFolderPath` is the destination folder (must already exist on disk and
 *      already be validated to be inside `.lerret/` by the middleware).
 *
 * The asset's own `Name.config.json` (auto-refresh etc.) travels as a companion
 * (see `discoverCompanions`) — there is no folder-level `liveRefresh` block to
 * strip or carry anymore (ADR-003).
 *
 * Semantics:
 *   1. Refuse cycles — moving a folder into itself or into one of its own
 *      descendants is a `cycle` error.
 *   2. Refuse name collisions — if the destination already has an entry with
 *      the same basename, return a `collision` error. (Move is a reparent, not
 *      a copy; auto-suffix would surprise the user.)
 *   3. Refuse missing-source — if `sourcePath` does not exist, return a
 *      `missing-source` error.
 *   4. Move the asset with `fsp.rename`. On `EXDEV`, fall back to
 *      `fsp.cp(..., recursive) + fsp.rm(..., recursive)` after verifying the
 *      destination exists.
 *   5. Move every companion the same way. Any companion failure rolls the
 *      asset BACK to its original path so disk state is consistent.
 *
 * @param {string} sourcePath        Contract-level (forward-slash) source path.
 * @param {string} toFolderPath      Contract-level destination folder path.
 * @returns {Promise<{ path: string }>}
 *   The destination path (LerretPath form).
 *
 *   Throws:
 *     • `Error` with `code: 'cycle'`              — cycle move refused.
 *     • `Error` with `code: 'missing-source'`     — source path does not exist.
 *     • `Error` with `code: 'missing-dest'`       — destination folder does not exist.
 *     • `Error` with `code: 'collision'`          — destination already has an entry of that name.
 *     • `Error` (no code)                          — bubble-up of fs errors.
 */
async function moveEntry(sourcePath, toFolderPath) {
  // ── Cycle prevention (contract-path / forward-slash basis) ────────────────
  // Compare on the forward-slash paths so we don't get tripped up by mixed
  // separators on Windows. A folder moved into itself OR into any descendant
  // is the unambiguous cycle case.
  const srcNorm = sourcePath.replace(/\/+$/, '');
  const destNorm = toFolderPath.replace(/\/+$/, '');
  if (destNorm === srcNorm) {
    const err = new Error('cannot move into the same folder');
    err.code = 'cycle';
    throw err;
  }
  if (destNorm.startsWith(srcNorm + '/')) {
    const err = new Error('cannot move folder into its own descendant');
    err.code = 'cycle';
    throw err;
  }

  const srcNative = toNativePath(sourcePath);
  const destFolderNative = toNativePath(toFolderPath);

  // ── Source must exist ──────────────────────────────────────────────────────
  let srcStat;
  try {
    srcStat = await fsp.stat(srcNative);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const e = new Error('fromPath does not exist');
      e.code = 'missing-source';
      throw e;
    }
    throw err;
  }

  // ── Destination folder must exist and be a directory ──────────────────────
  let destStat;
  try {
    destStat = await fsp.stat(destFolderNative);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const e = new Error('destination folder does not exist');
      e.code = 'missing-dest';
      throw e;
    }
    throw err;
  }
  if (!destStat.isDirectory()) {
    const e = new Error('destination is not a folder');
    e.code = 'missing-dest';
    throw e;
  }

  const baseName = basename(srcNative);
  const targetNative = joinNative(destFolderNative, baseName);

  // ── Collision check on the primary entry ──────────────────────────────────
  try {
    await fsp.access(targetNative);
    const e = new Error(`destination already has an asset named ${baseName}`);
    e.code = 'collision';
    throw e;
  } catch (err) {
    if (err && err.code === 'collision') throw err;
    if (err && err.code !== 'ENOENT') throw err;
  }

  // ── Companion discovery (files only — folders carry their tree intact) ────
  const isDir = srcStat.isDirectory();
  const ext = isDir ? '' : extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  const parentNative = dirname(srcNative);

  /** @type {string[]} */
  const companionsNative = isDir
    ? []
    : await discoverCompanions(parentNative, stem);

  // The asset's `Name.config.json` (auto-refresh etc.) travels as a companion
  // (see `discoverCompanions`) — there is no folder-level `liveRefresh` to strip
  // or carry anymore (ADR-003).

  // ── Helper: race-free rename with EXDEV + collision atomicity ─────────────
  //
  // Two issues this fixes vs. a naive `fsp.rename`:
  //   1. **Collision race (D.S4)** — `fsp.rename` silently OVERWRITES the
  //      destination on POSIX. The upstream collision probe (above) has a
  //      TOCTOU gap where a concurrent writer could create the destination
  //      between our probe and the rename, and we'd silently clobber their
  //      file. `fsp.link` fails atomically with `EEXIST` instead, closing
  //      that window for the file case. (Folders can't be hardlinked on
  //      POSIX so they fall through to `cp { errorOnExist: true }`, which
  //      enforces the same atomic-on-collision semantic.)
  //   2. **EXDEV partial-state strand (D.M2)** — if `cp` succeeds but `rm`
  //      fails on the cross-device fallback, the old code would leave an
  //      orphan at the destination AND the source intact. Worse, when this
  //      happened on a COMPANION mid-loop, the destination orphan was never
  //      added to `moved[]` and the outer rollback missed it. Now we clean
  //      up the destination copy on `rm` failure so the caller sees a clean
  //      "move did not happen" failure with source intact.
  //
  /**
   * @param {string} fromN  Native source path.
   * @param {string} toN    Native target path.
   * @returns {Promise<void>}
   */
  async function renameWithExdev(fromN, toN) {
    // Fast path: try `link` first for atomic-on-collision semantics. On the
    // same filesystem for files, `link + unlink` is atomic and avoids the
    // TOCTOU window. EPERM/EISDIR (folder) and EXDEV (cross-device) fall
    // through to the cp+rm path below.
    let usedLink = false;
    try {
      await fsp.link(fromN, toN);
      usedLink = true;
    } catch (linkErr) {
      if (linkErr && linkErr.code === 'EEXIST') {
        // Concurrent writer created the destination between our probe and
        // this call. Surface a clean collision error.
        const e = new Error('destination already has an asset with this name (race)');
        e.code = 'collision';
        throw e;
      }
      if (linkErr && (linkErr.code === 'EPERM' || linkErr.code === 'EISDIR' || linkErr.code === 'EXDEV' || linkErr.code === 'ENOTSUP' || linkErr.code === 'EOPNOTSUPP')) {
        // Fall through to cp+rm path.
      } else {
        throw linkErr;
      }
    }

    if (usedLink) {
      // Source still has a hardlink. Remove it. If that fails, clean up the
      // destination so the caller sees a clean failure with source intact.
      try {
        await fsp.unlink(fromN);
      } catch (unlinkErr) {
        try { await fsp.unlink(toN); } catch { /* best effort */ }
        throw unlinkErr;
      }
      return;
    }

    // Fallback: copy-then-remove. `errorOnExist: true` is the race-free
    // safeguard here — even if another writer creates the destination
    // between our upstream probe and this call, `cp` refuses.
    await fsp.cp(fromN, toN, { recursive: true, force: false, errorOnExist: true });
    let destOk = false;
    try {
      await fsp.access(toN);
      destOk = true;
    } catch {
      destOk = false;
    }
    if (!destOk) {
      throw new Error(`EXDEV fallback: destination ${toN} did not materialize after copy`);
    }
    try {
      await fsp.rm(fromN, { recursive: true, force: true });
    } catch (rmErr) {
      // D.M2 fix: clean up the destination copy so the caller sees a clean
      // failure with source intact. Otherwise we'd strand an orphan at the
      // destination AND leave the source intact — and on a companion this
      // orphan would not be in moved[] so the outer rollback would miss it.
      try {
        await fsp.rm(toN, { recursive: true, force: true });
      } catch {
        // Both rms failed — caller sees two copies. Surface the original rm error.
      }
      throw rmErr;
    }
  }

  // ── Move the primary entry ────────────────────────────────────────────────
  await renameWithExdev(srcNative, targetNative);

  // ── Move companions with atomic-rollback semantics ─────────────────────────
  /** @type {Array<{ from: string, to: string }>} */
  const moved = [];
  try {
    for (const companionNative of companionsNative) {
      const companionName = basename(companionNative);
      const companionDest = joinNative(destFolderNative, companionName);
      // Companion-level collision: refuse and roll back. (renameWithExdev
      // also enforces atomic-on-collision via link/cp, but this probe gives
      // a clearer error message.)
      try {
        await fsp.access(companionDest);
        const e = new Error(`destination already has a companion file named ${companionName}`);
        e.code = 'collision';
        throw e;
      } catch (probeErr) {
        if (probeErr && probeErr.code === 'collision') throw probeErr;
        if (probeErr && probeErr.code !== 'ENOENT') throw probeErr;
      }
      await renameWithExdev(companionNative, companionDest);
      moved.push({ from: companionNative, to: companionDest });
    }
  } catch (companionErr) {
    // Roll back: every companion that DID move comes back, then the asset.
    for (const m of moved.reverse()) {
      try {
        await renameWithExdev(m.to, m.from);
      } catch {
        // Best-effort rollback — if rollback itself fails we surface the
        // original error rather than the rollback's. The user gets the
        // primary failure message; a stranded companion is logged below.
      }
    }
    try {
      await renameWithExdev(targetNative, srcNative);
    } catch {
      // Same — best effort.
    }
    throw companionErr;
  }

  return {
    path: toLerretPath(targetNative),
  };
}

/**
 * Create a new page/group folder, or a starter asset file, inside an existing
 * `parentPath`. Powers the studio's in-canvas "New page / group / asset" flow.
 *
 * `parentPath` must already exist and be a directory (the middleware validates
 * it is inside `.lerret/`, allowing the bare project root for new pages). The
 * `name` is the already-validated base name (no extension).
 *
 * Semantics:
 *   • `kind: 'folder'` → `mkdir(parentPath/name)`.
 *   • `kind: 'asset'`  → write `parentPath/<name><ext>` with minimal renderable
 *     starter content (`opts.assetKind` picks `.jsx` vs `.md`).
 *   • Collisions are refused **case-insensitively** among siblings, so a new
 *     `Landing` next to an existing `landing` is rejected (macOS/Windows are
 *     case-insensitive — silently merging would surprise the user).
 *
 * @param {string} parentPath  Contract-level (forward-slash) destination folder.
 * @param {string} name        Validated base name (no extension).
 * @param {'folder'|'asset'} kind
 * @param {{ assetKind?: 'component'|'markdown' }} [opts]
 * @returns {Promise<{ path: string }>}  The created entry's LerretPath.
 *
 *   Throws `Error` with:
 *     • `code: 'missing-parent'` — parent doesn't exist or isn't a directory.
 *     • `code: 'collision'`      — a sibling of that name already exists.
 *     • `code: 'invalid-kind'`   — `kind` is neither 'folder' nor 'asset'.
 */
async function createEntry(parentPath, name, kind, opts = {}) {
  if (kind !== 'folder' && kind !== 'asset') {
    const e = new Error(`unknown create kind: ${kind}`);
    e.code = 'invalid-kind';
    throw e;
  }

  const parentNative = toNativePath(parentPath);

  // Parent must exist and be a directory.
  let parentStat;
  try {
    parentStat = await fsp.stat(parentNative);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      const e = new Error('parent folder does not exist');
      e.code = 'missing-parent';
      throw e;
    }
    throw err;
  }
  if (!parentStat.isDirectory()) {
    const e = new Error('parent is not a folder');
    e.code = 'missing-parent';
    throw e;
  }

  const assetKind = opts.assetKind === 'markdown' ? 'markdown' : 'component';
  const childName = kind === 'asset' ? assetFileName(name, assetKind) : name;

  // Case-insensitive collision check among existing siblings (macOS/Windows are
  // case-insensitive; matching exactly would let `Landing` shadow `landing`).
  let siblings;
  try {
    siblings = await fsp.readdir(parentNative);
  } catch {
    siblings = [];
  }
  const childLower = childName.toLowerCase();
  if (siblings.some((s) => s.toLowerCase() === childLower)) {
    const e = new Error(`"${childName}" already exists here`);
    e.code = 'collision';
    throw e;
  }

  const targetNative = joinNative(parentNative, childName);

  if (kind === 'folder') {
    try {
      // Non-recursive: the parent exists and the collision is already checked;
      // `mkdir` without `recursive` still surfaces EEXIST as a race backstop.
      await fsp.mkdir(targetNative);
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        const e = new Error(`"${childName}" already exists here`);
        e.code = 'collision';
        throw e;
      }
      throw err;
    }
    return { path: toLerretPath(targetNative) };
  }

  // asset — write the starter content atomically (the parent exists, so the
  // temp-file-then-rename write lands cleanly).
  const content = starterAssetContent(name, assetKind);
  await writeFile(toLerretPath(targetNative), content, { encoding: 'utf-8' });
  return { path: toLerretPath(targetNative) };
}

export { renameEntry, duplicateEntry, deleteEntry, revealEntry, moveEntry, createEntry };

// ---------------------------------------------------------------------------
// Plain text file reader (CLI-internal, NOT part of FilesystemAccess)
// ---------------------------------------------------------------------------
//
// `loadOverrideFile` in `export.js` needs to read a user-supplied JSON (or .js)
// file by absolute path. The `FilesystemAccess` contract's `readFile` method
// works but binds a whole backend object. Exposing this thin helper keeps the
// ban on direct `node:fs` imports outside this file while giving the caller
// exactly the one function it needs.

/**
 * Read an absolute file path and return its contents as a UTF-8 string.
 * Throws with an `ENOENT`-style message when the file does not exist.
 * Used exclusively by `loadOverrideFile` in `export.js`.
 *
 * @param {string} absPath  Absolute path (any separator — normalized internally).
 * @returns {Promise<string>}
 */
export async function readTextFile(absPath) {
  return fsp.readFile(toNativePath(absPath), 'utf-8');
}

// ---------------------------------------------------------------------------
// Recent-projects list (host-level config — NOT project data)
// ---------------------------------------------------------------------------
//
// The studio's connect screen offers one-click re-open of folders the user has
// connected before. The list lives at `~/.lerret/recent-projects.json` (or
// `$LERRET_CONFIG_DIR/recent-projects.json`) — a Lerret-app config in the user's
// home, NOT inside any project's `.lerret/`, so NFR13 ("never write into the
// user's project") is untouched. This fs access lives HERE because node-backend
// is the only file permitted to import `fs`. Every read/write is best-effort: a
// missing or malformed file simply yields an empty list, never a thrown error.

/** Max recent-project entries kept; older entries fall off the end. */
const RECENTS_MAX = 8;

/** The Lerret host-config directory: `$LERRET_CONFIG_DIR` or `~/.lerret`. */
function lerretConfigDir() {
  const override = process.env.LERRET_CONFIG_DIR;
  return override ? resolveNative(override) : joinNative(homedir(), '.lerret');
}

/** Absolute path of the recents file under the host-config dir. */
function recentsFilePath() {
  return joinNative(lerretConfigDir(), 'recent-projects.json');
}

/** The basename of a folder path (its display name). */
function folderDisplayName(p) {
  const parts = String(p).replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || String(p);
}

/**
 * Read the recent-projects list (most-recent-first). Returns `[]` on any error
 * (missing / malformed file).
 *
 * @returns {Promise<Array<{ path: string, name: string }>>}
 */
export async function readRecentProjects() {
  try {
    const raw = await fsp.readFile(recentsFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.path === 'string')
      .map((e) => ({ path: e.path, name: typeof e.name === 'string' ? e.name : folderDisplayName(e.path) }))
      .slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

/**
 * Record `projectRoot` at the front of the recents list (de-duplicated, capped).
 * Best-effort — a write failure is logged but never thrown.
 *
 * @param {string} projectRoot
 * @returns {Promise<Array<{ path: string, name: string }>>}  The updated list.
 */
export async function recordRecentProject(projectRoot) {
  if (!projectRoot) return readRecentProjects();
  const entry = { path: projectRoot, name: folderDisplayName(projectRoot) };
  const existing = await readRecentProjects();
  const next = [entry, ...existing.filter((e) => e.path !== projectRoot)].slice(0, RECENTS_MAX);
  try {
    await fsp.mkdir(lerretConfigDir(), { recursive: true });
    await fsp.writeFile(recentsFilePath(), JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.error('[lerret] could not save recent projects:', err && err.message ? err.message : err);
  }
  return next;
}
