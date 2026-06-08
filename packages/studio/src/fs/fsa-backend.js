// fsa-backend.js — the File System Access API implementation of FilesystemAccess.
//
// This is one of the two filesystem backends behind the `core`
// `FilesystemAccess` contract; it powers hosted mode, where Lerret runs in a
// Chromium browser and reads/writes a user's local project through the File
// System Access API.
//
// IMPORTANT — this file is the ONLY place in the codebase permitted to call
// `window.showDirectoryPicker`, access `FileSystemDirectoryHandle`, or touch
// any other File System Access API globals. `core` stays pure (AR2/AR3/NFR13).
//
// Core purity invariant: `@lerret/core` contains no `window.showDirectoryPicker`
// or browser filesystem globals — verified by `core`'s own test suite.

import { assertFilesystemContract } from '@lerret/core';

// ---------------------------------------------------------------------------
// Typed permission error
// ---------------------------------------------------------------------------

/**
 * Thrown whenever the File System Access API refuses or cannot grant readwrite
 * permission for the root directory handle.
 *
 * Callers branch on type:
 * ```js
 * try { ... } catch (err) {
 * if (err instanceof PermissionDeniedError) {
 * // Show guidance: "Re-open the folder to continue editing"
 * } else { throw err; }
 * }
 * ```
 *
 * (entry layer) catches this to present user-facing guidance rather
 * than an unhandled rejection.
 */
export class PermissionDeniedError extends Error {
 /**
 * @param {string} [message]
 */
 constructor(message = 'Permission to access the project folder was denied.') {
 super(message);
 this.name = 'PermissionDeniedError';
 }
}

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------

/**
 * Capabilities of the FSA backend. In a browser environment the FSA can write
 * (via `createWritable`) but cannot poll for live changes (will
 * replace the watch stub) and cannot reveal a path in the native file manager.
 *
 * @type {import('@lerret/core').FilesystemCapabilities}
 */
const FSA_CAPABILITIES = Object.freeze({
 canWrite: true,
 canWatch: false, // replaces the stub with real polling
 canReveal: false, // Browser cannot shell out to Finder / Explorer
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Join a forward-slash directory path with a single child name segment,
 * producing a forward-slash path with no double slashes and no trailing slash.
 *
 * @param {string} dirPath A LerretPath (forward slashes).
 * @param {string} name A single path segment (no separators).
 * @returns {string} The joined LerretPath.
 */
function joinLerretPath(dirPath, name) {
 // Normalise away a trailing slash on dirPath (the root '' case).
 const base = dirPath.endsWith('/') ? dirPath.slice(0, -1) : dirPath;
 return base === '' ? name : `${base}/${name}`;
}

/**
 * Split a forward-slash path into its segments (empty strings filtered out).
 *
 * @param {string} filePath A LerretPath (forward slashes).
 * @returns {string[]} Non-empty segments.
 */
function splitPath(filePath) {
 return filePath.split('/').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Permission guard
// ---------------------------------------------------------------------------

/**
 * Ensure the root handle has (or can obtain) readwrite permission.
 *
 * The File System Access API revokes permission across page reloads; this
 * helper re-requests it transparently. If permission is denied it throws a
 * typed {@link PermissionDeniedError} so the entry layer can
 * present guidance instead of letting an unhandled rejection bubble.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @returns {Promise<void>}
 * @throws {PermissionDeniedError} When readwrite permission is not available
 * and cannot be obtained.
 */
async function ensurePermission(rootHandle) {
 const state = await rootHandle.queryPermission({ mode: 'readwrite' });
 if (state === 'granted') return;

 // Permission has lapsed or was never requested — ask the user.
 const result = await rootHandle.requestPermission({ mode: 'readwrite' });
 if (result !== 'granted') {
 throw new PermissionDeniedError(
 'Readwrite permission for the project folder was denied. ' +
 'Re-select the folder to continue editing.',
 );
 }
}

// ---------------------------------------------------------------------------
// Internal handle navigation
// ---------------------------------------------------------------------------

/**
 * Traverse `rootHandle` following `segments` to reach a nested
 * `FileSystemDirectoryHandle`. Creates intermediate directories when
 * `create` is `true`.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string[]} segments Path segments (may be empty for root).
 * @param {boolean} [create] Whether to create missing directories.
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function traverseDirs(rootHandle, segments, create = false) {
 let handle = rootHandle;
 for (const seg of segments) {
 handle = await handle.getDirectoryHandle(seg, { create });
 }
 return handle;
}

/**
 * Resolve a LerretPath to the `FileSystemFileHandle` for that path, relative
 * to the root handle.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filePath A LerretPath (forward slashes).
 * @param {boolean} [create] Whether to create the file if absent.
 * @returns {Promise<FileSystemFileHandle>}
 */
async function resolveFileHandle(rootHandle, filePath, create = false) {
 const segments = splitPath(filePath);
 const fileName = segments.pop();
 if (!fileName) {
 throw new Error(`fsa-backend: cannot resolve an empty path as a file: "${filePath}"`);
 }
 const dirHandle = await traverseDirs(rootHandle, segments, create);
 return dirHandle.getFileHandle(fileName, { create });
}

// ---------------------------------------------------------------------------
// readDir
// ---------------------------------------------------------------------------

/**
 * List the immediate children of a directory identified by `dirPath`.
 *
 * Mirrors the Node backend's output shape exactly so `core`'s loader builds
 * an identical project model regardless of backend:
 * - `name` — the entry's own final segment.
 * - `path` — forward-slash, no trailing slash, relative to the same root.
 * - `kind` — `'file'` | `'directory'` discriminant.
 * - `isFile` / `isDirectory` — mutually exclusive booleans.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} dirPath A LerretPath (forward slashes).
 * @returns {Promise<import('@lerret/core').DirEntry[]>}
 */
async function readDir(rootHandle, dirPath) {
 const segments = splitPath(dirPath);
 const dirHandle = await traverseDirs(rootHandle, segments);

 /** @type {import('@lerret/core').DirEntry[]} */
 const entries = [];

 for await (const [name, handle] of dirHandle.entries()) {
 const isDirectory = handle.kind === 'directory';
 entries.push({
 name,
 path: joinLerretPath(dirPath, name),
 kind: isDirectory ? 'directory' : 'file',
 isFile: !isDirectory,
 isDirectory,
 });
 }

 return entries;
}

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

/**
 * Read a file's full contents.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filePath A LerretPath (forward slashes).
 * @param {import('@lerret/core').ReadFileOptions} [options]
 * @returns {Promise<string | Uint8Array>}
 */
async function readFile(rootHandle, filePath, options = {}) {
 const { encoding = 'utf-8' } = options;
 const fileHandle = await resolveFileHandle(rootHandle, filePath);
 const file = await fileHandle.getFile();

 if (encoding === 'binary') {
 const buf = await file.arrayBuffer();
 return new Uint8Array(buf);
 }

 return file.text();
}

// ---------------------------------------------------------------------------
// writeFile — safe (atomic from reader's perspective) write
// ---------------------------------------------------------------------------

/**
 * Write a file's full contents using the FSA `createWritable()` stream.
 *
 * The FSA write sequence commits only on `close()` — an interrupted write
 * (i.e. calling `abort()` or the stream closing unexpectedly) leaves the
 * existing file fully intact (NFR9). This is the browser equivalent of the
 * Node backend's temp-file-then-atomic-rename pattern.
 *
 * Parent directories are created lazily via `{ create: true }` on each
 * `getDirectoryHandle` call, so a new file whose parent chain doesn't exist
 * yet is created correctly.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filePath A LerretPath (forward slashes).
 * @param {string | Uint8Array} data
 * @param {import('@lerret/core').WriteFileOptions} [options]
 * @returns {Promise<void>}
 */
async function writeFile(rootHandle, filePath, data, options = {}) {
 // encoding is validated for documentation purposes; the writable stream
 // accepts both strings and BufferSource transparently.
 const { encoding: _encoding = 'utf-8' } = options;

 // Create intermediate directories and the file handle.
 const fileHandle = await resolveFileHandle(rootHandle, filePath, true);

 // `createWritable` opens a write stream; data is buffered separately from
 // the current file. Only `close()` atomically swaps the buffer into place.
 // If `write()` throws, we `abort()` so the existing content is preserved.
 const writable = await fileHandle.createWritable();
 try {
 await writable.write(data);
 await writable.close();
 } catch (err) {
 // Abort to discard the in-progress write; original file remains intact.
 try { await writable.abort(); } catch { /* ignore abort errors */ }
 throw err;
 }
}

// ---------------------------------------------------------------------------
// deleteFile / mkdir / exists
// ---------------------------------------------------------------------------
//
// Added in Epic 8 (Story 8.5) for the snapshot store's bootstrap + revert
// + cleanup paths. Story 8.4's sandbox routes its `deleteFile` / `mkdir` /
// `exists` through these.

/**
 * Delete a single file via the parent directory handle's `removeEntry`.
 * Throws if the path is missing or is a directory.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} filePath A LerretPath (forward slashes).
 * @returns {Promise<void>}
 */
async function deleteFile(rootHandle, filePath) {
 const segments = splitPath(filePath);
 const fileName = segments.pop();
 if (!fileName) {
 throw new Error(`fsa-backend: cannot delete an empty path: "${filePath}"`);
 }
 const dirHandle = await traverseDirs(rootHandle, segments);
 await dirHandle.removeEntry(fileName);
}

/**
 * Create a directory (and any missing parent directories) at `dirPath`.
 * Idempotent — if the directory already exists, resolves successfully
 * (the FSA API's `getDirectoryHandle({create:true})` is itself idempotent).
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} dirPath A LerretPath (forward slashes).
 * @returns {Promise<void>}
 */
async function mkdir(rootHandle, dirPath) {
 const segments = splitPath(dirPath);
 await traverseDirs(rootHandle, segments, /* create */ true);
}

/**
 * Test whether a file OR directory exists at `targetPath`. Tries a file
 * handle first (the most common case); on `NotFoundError` falls back to a
 * directory handle probe.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {string} targetPath A LerretPath (forward slashes).
 * @returns {Promise<boolean>}
 */
async function exists(rootHandle, targetPath) {
 const segments = splitPath(targetPath);
 const lastSeg = segments.pop();
 if (!lastSeg) {
 // Empty path or root — root always exists.
 return true;
 }
 let parentHandle;
 try {
 parentHandle = await traverseDirs(rootHandle, segments);
 } catch (err) {
 if (err && err.name === 'NotFoundError') return false;
 throw err;
 }
 try {
 await parentHandle.getFileHandle(lastSeg);
 return true;
 } catch (err) {
 if (err && err.name === 'TypeMismatchError') {
 // Path exists but is a directory — still "exists".
 return true;
 }
 if (err && err.name === 'NotFoundError') {
 // Not a file — try directory.
 try {
 await parentHandle.getDirectoryHandle(lastSeg);
 return true;
 } catch (dirErr) {
 if (dirErr && dirErr.name === 'NotFoundError') return false;
 throw dirErr;
 }
 }
 throw err;
 }
}

// ---------------------------------------------------------------------------
// watch — stub (replaces this with polling)
// ---------------------------------------------------------------------------

/**
 * Begin watching a path for changes.
 *
 * STUB replaces this with a real directory-handle polling
 * implementation. The stub satisfies the `FilesystemAccess` contract (returns
 * a valid, closable `Watcher`) while doing nothing. Callers MUST check
 * `capabilities.canWatch` before depending on events; since this backend sets
 * `canWatch: false`, a properly written caller will not subscribe in the first
 * place.
 *
 * @param {string} _targetPath Unused in the stub; consumed by the real
 * implementation.
 * @param {import('@lerret/core').WatchListener} _listener Unused in the stub.
 * @returns {import('@lerret/core').Watcher} A no-op, closable handle.
 */
function watch(_targetPath, _listener) {
 let closed = false;
 return {
 close() {
 // Idempotent — safe to call multiple times.
 closed = true;
 void closed; // suppress unused-variable lint
 },
 };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct the File System Access API filesystem backend given a
 * `FileSystemDirectoryHandle` pointing at the user's project root.
 *
 * The returned backend:
 * - Conforms to the `core` `FilesystemAccess` contract (verified by
 * `assertFilesystemContract` before return).
 * - Exposes `capabilities = { canWrite: true, canWatch: false, canReveal: false }`.
 * - Throws a typed {@link PermissionDeniedError} (not a raw exception) when the
 * directory handle's permission has lapsed and cannot be re-obtained, so
 * 's entry layer can present user-facing guidance.
 * - Keeps ALL File System Access API calls confined to THIS file — `core` and
 * every other subsystem remain pure (AR2/AR3/NFR13).
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * A `FileSystemDirectoryHandle` for the user's project folder, typically
 * obtained via `window.showDirectoryPicker()`.
 * @returns {import('@lerret/core').FilesystemAccess}
 * An object satisfying the `FilesystemAccess` contract.
 *
 * @example
 * const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
 * const backend = createFsaBackend(handle);
 * const entries = await backend.readDir('');
 */
export function createFsaBackend(rootHandle) {
 /** @type {import('@lerret/core').FilesystemAccess} */
 const backend = {
 capabilities: FSA_CAPABILITIES,

 readDir(dirPath) {
 return ensurePermission(rootHandle).then(() =>
 readDir(rootHandle, dirPath),
 );
 },

 readFile(filePath, options) {
 return ensurePermission(rootHandle).then(() =>
 readFile(rootHandle, filePath, options),
 );
 },

 writeFile(filePath, data, options) {
 return ensurePermission(rootHandle).then(() =>
 writeFile(rootHandle, filePath, data, options),
 );
 },

 deleteFile(filePath) {
 return ensurePermission(rootHandle).then(() =>
 deleteFile(rootHandle, filePath),
 );
 },

 mkdir(dirPath) {
 return ensurePermission(rootHandle).then(() =>
 mkdir(rootHandle, dirPath),
 );
 },

 exists(targetPath) {
 return ensurePermission(rootHandle).then(() =>
 exists(rootHandle, targetPath),
 );
 },

 watch(targetPath, listener) {
 return watch(targetPath, listener);
 },
 };

 // Fail fast if this backend ever drifts from the contract.
 assertFilesystemContract(backend, 'fsa-backend');

 return backend;
}

// ---------------------------------------------------------------------------
// Convenience: open picker + return backend
// ---------------------------------------------------------------------------

/**
 * Prompt the user to pick a local folder and return a ready-to-use backend.
 *
 * A convenience wrapper for 's entry flow. It calls
 * `window.showDirectoryPicker` (the only place in the codebase allowed to do
 * so outside of tests) and constructs the backend in one step.
 *
 * Throws if the user cancels the picker (browser throws `AbortError`) or if
 * `showDirectoryPicker` is unavailable in this environment.
 *
 * @returns {Promise<import('@lerret/core').FilesystemAccess>}
 */
export async function pickFolderAndCreateBackend() {
 const rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
 return createFsaBackend(rootHandle);
}
