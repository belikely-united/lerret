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
import { tmpdir, platform } from 'node:os';
import {
  basename,
  dirname,
  extname,
  join as joinNative,
  sep as nativeSep,
} from 'node:path';

import { assertFilesystemContract, serializeJson } from '@lerret/core';

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

export { renameEntry, duplicateEntry, deleteEntry, revealEntry };

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
