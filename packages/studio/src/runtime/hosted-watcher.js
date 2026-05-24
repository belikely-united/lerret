// hosted-watcher.js — the hosted-mode (browser) filesystem watcher.
//
// In hosted mode there is no Node `fs.watch` or chokidar — the only access to
// the user's project folder is through the File System Access API
// `FileSystemDirectoryHandle`. This watcher bridges that API to the same
// normalized `{ type: 'add' | 'change' | 'remove', path }` `WatchEvent`
// contract the CLI watcher emits (AR5, ), so the studio's loader can
// call `applyWatchEvent` identically regardless of backend.
//
// ── Detection mechanism ──────────────────────────────────────────────────────
// On every poll cycle the watcher recursively walks the directory handle tree,
// building a flat Map<LerretPath, { lastModified, size, isDirectory }>
// "snapshot" for every entry under the root. It then diffs the new snapshot
// against the previous one:
//
// - Path in new, not in old → `add` event.
// - Path in both, `lastModified` or `size` changed → `change` event.
// (Folders have no meaningful mtime/size; they are tracked for presence
// only — a folder with changed children does NOT emit a `change` on the
// folder itself, only on the children.)
// - Path in old, not in new → `remove` event.
//
// File content is NEVER read during a poll — only the `lastModified` and `size`
// fields from `fileHandle.getFile()` are inspected (NFR3/NFR4).
//
// ── Poll interval ───────────────────────────────────────────────────────────
// Default: 300 ms, matching the spike's recommendation (FINDINGS.md §2.3).
// Configurable via `options.pollInterval` for tests or power users who want
// faster detection at higher API pressure.
//
// ── Permission lapse ────────────────────────────────────────────────────────
// If a poll cycle throws a `PermissionDeniedError` (from fsa-backend.js) or
// any other FSA-related error (DOMException `NotAllowedError` etc.), the watcher
// calls `onError(err)` ONCE and stops the loop cleanly. It does NOT retry.
// 's entry/permission layer is responsible for remounting the watcher
// after re-obtaining permission.
//
// ── Ready semantics ─────────────────────────────────────────────────────────
// `ready` resolves once the initial snapshot has been built. No `add` events
// are emitted for the initial snapshot — those files already exist when the
// watcher starts; the initial state is the loader's concern. The first user
// edit is the first event.
//
// ── Wire-up notes ───────────────────────────────────────────────
// The watcher's `onEvent` callback should:
// - For `'change'` events: call `runtime.notifyChange(event.path)` so the
// hosted runtime re-transforms and re-imports the module.
// - For `'add'` / `'remove'` events: call `applyWatchEvent(model, event)` to
// patch the project model, then notify the canvas to re-render.
// wires this in `bootHostedProject`. The watcher itself is transport-
// only — it does not import `applyWatchEvent` or the runtime.
//
// ── capabilities.canWatch ───────────────────────────────────────────────────
// `createFsaBackend` sets `canWatch: false` by default. To signal that a live
// watcher is attached, use `createFsaBackendWithWatcher` exported below —
// a small convenience factory that constructs both the backend and the watcher,
// returning `{ backend, watcher }` where `backend.capabilities.canWatch` is
// `true`. uses this helper rather than constructing the two pieces
// separately.

import { makeWatchEvent } from '@lerret/core';
import { PermissionDeniedError } from '../fs/fsa-backend.js';
import { createFsaBackend } from '../fs/fsa-backend.js';

/**
 * @typedef {import('@lerret/core').WatchEvent} WatchEvent
 * @typedef {import('@lerret/core').LerretPath} LerretPath
 */

// ---------------------------------------------------------------------------
// Default poll interval
// ---------------------------------------------------------------------------

/**
 * Default poll interval in ms. Validated in the spike (FINDINGS.md §2.3):
 * with 300 ms poll the worst-case latency is ~372 ms — well within the <1 s
 * NFR2 budget after accounting for transform + import + render time.
 *
 * @type {number}
 */
export const DEFAULT_POLL_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Snapshot primitives
// ---------------------------------------------------------------------------

/**
 * Metadata captured per entry during a snapshot walk.
 *
 * @typedef {object} SnapshotEntry
 * @property {boolean} isDirectory `true` for a directory, `false` for a file.
 * @property {number} lastModified File's `lastModified` epoch ms; `0` for dirs.
 * @property {number} size File's byte size; `0` for dirs.
 */

/**
 * Walk `dirHandle` recursively, collecting a flat Map of
 * `LerretPath → SnapshotEntry` for every entry under the root.
 *
 * Paths are forward-slash, relative to the root — so the root handle's own
 * children appear as `'name'`, their children as `'name/child'`, etc. This is
 * exactly the same scheme the FSA backend uses for `LerretPath`s.
 *
 * We do NOT skip any folders here — the loader's `classifyPath` is the single
 * source of filtering rules. Skipping `_assets/` here would mean the watcher
 * misses `remove` events for images etc., breaking the consistency guarantee.
 *
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} prefix The LerretPath prefix for this directory level.
 * @returns {Promise<Map<string, SnapshotEntry>>}
 */
async function walkSnapshot(dirHandle, prefix) {
 /** @type {Map<string, SnapshotEntry>} */
 const map = new Map();

 for await (const [name, handle] of dirHandle.entries()) {
 const entryPath = prefix === '' ? name : `${prefix}/${name}`;

 if (handle.kind === 'directory') {
 // Record the directory itself (presence-only; mtime/size = 0).
 map.set(entryPath, { isDirectory: true, lastModified: 0, size: 0 });
 // Recurse into the subdirectory.
 const sub = await walkSnapshot(handle, entryPath);
 for (const [subPath, subEntry] of sub) {
 map.set(subPath, subEntry);
 }
 } else {
 // File: call getFile() to read lastModified + size cheaply.
 // This is the only FSA call on every poll — no content read.
 const file = await handle.getFile();
 map.set(entryPath, {
 isDirectory: false,
 lastModified: file.lastModified,
 size: file.size,
 });
 }
 }

 return map;
}

// ---------------------------------------------------------------------------
// Diff two snapshots → WatchEvent[]
// ---------------------------------------------------------------------------

/**
 * Diff two snapshots and return the normalized `WatchEvent[]` for any changes.
 *
 * Order: removals first (old paths not in new), then additions (new paths not
 * in old), then modifications (present in both with changed metadata). Within
 * each category, paths are emitted in alphabetical order for deterministic
 * test assertions.
 *
 * `change` events are NOT emitted for directories — a folder's presence change
 * is an `add` or `remove`, never a `change`. Only file entries can produce a
 * `change` event.
 *
 * @param {Map<string, SnapshotEntry>} oldSnap
 * @param {Map<string, SnapshotEntry>} newSnap
 * @returns {WatchEvent[]}
 */
function diffSnapshots(oldSnap, newSnap) {
 const events = [];

 // Removals — paths in old but not in new.
 const removals = [];
 for (const path of oldSnap.keys()) {
 if (!newSnap.has(path)) {
 removals.push(path);
 }
 }
 removals.sort();
 for (const path of removals) {
 // The snapshot knows the kind — pass it so the classifier never guesses a
 // non-asset file (e.g. Name.config.json) is a folder.
 events.push(makeWatchEvent('remove', path, oldSnap.get(path).isDirectory));
 }

 // Additions — paths in new but not in old.
 const additions = [];
 for (const path of newSnap.keys()) {
 if (!oldSnap.has(path)) {
 additions.push(path);
 }
 }
 additions.sort();
 for (const path of additions) {
 events.push(makeWatchEvent('add', path, newSnap.get(path).isDirectory));
 }

 // Modifications — paths in both; only files can produce a 'change' event.
 const modifications = [];
 for (const [path, newEntry] of newSnap) {
 if (!newEntry.isDirectory && oldSnap.has(path)) {
 const oldEntry = oldSnap.get(path);
 if (
 oldEntry.lastModified !== newEntry.lastModified ||
 oldEntry.size !== newEntry.size
 ) {
 modifications.push(path);
 }
 }
 }
 modifications.sort();
 for (const path of modifications) {
 // Only file entries reach here (directories never emit 'change').
 events.push(makeWatchEvent('change', path, false));
 }

 return events;
}

// ---------------------------------------------------------------------------
// Classify an error as a fatal permission lapse
// ---------------------------------------------------------------------------

/**
 * Return `true` when `err` indicates a permission lapse or an invalid handle —
 * the two conditions that should stop the poll loop rather than letting it keep
 * erroring on every cycle.
 *
 * We treat as fatal:
 * - Our own `PermissionDeniedError` from fsa-backend.js.
 * - DOM `NotAllowedError` (the FSA API's native permission denial).
 * - DOM `NotFoundError` / `InvalidStateError` (handle became invalid).
 *
 * Everything else (unexpected JS errors) is also treated as fatal rather than
 * silently swallowed — the watcher stopping and surfacing the error via
 * `onError` is always preferable to an infinite crash loop.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function isFatalError(err) {
 if (err instanceof PermissionDeniedError) return true;
 if (err instanceof DOMException) return true;
 // Any other thrown value stops the loop — unknown errors should not repeat.
 return true;
}

// ---------------------------------------------------------------------------
// startHostedWatcher — the public API
// ---------------------------------------------------------------------------

/**
 * A handle returned by {@link startHostedWatcher}. Mirrors the CLI
 * `WatcherHandle` shape from `packages/cli/src/watcher.js` so the studio's
 * consumer can swap backends without branching.
 *
 * @typedef {object} HostedWatcherHandle
 * @property {Promise<void>} ready
 * Resolves once the initial snapshot has been built. No `add` events are
 * emitted for the initial state — only changes from this baseline are
 * reported.
 * @property {() => Promise<void>} close
 * Stop the poll loop. Idempotent — safe to call multiple times. Resolves
 * immediately (no in-flight poll is awaited past the current tick).
 */

/**
 * Start polling a `FileSystemDirectoryHandle` for changes, emitting normalized
 * `WatchEvent`s identical to the CLI chokidar watcher.
 *
 * @param {object} opts
 * @param {FileSystemDirectoryHandle} opts.rootHandle
 * The root handle to watch. Must be a `FileSystemDirectoryHandle` whose
 * `readwrite` permission has already been granted (e.g. by
 * `window.showDirectoryPicker({ mode: 'readwrite' })`).
 * @param {(event: WatchEvent) => void} opts.onEvent
 * Called once per normalized event. This is synchronous and should be fast —
 * it feeds straight into `applyWatchEvent` + `runtime.notifyChange`.
 * @param {(err: Error) => void} [opts.onError]
 * Called at most once when the poll loop encounters a fatal error
 * (permission lapse, invalid handle). After `onError` is called the loop
 * stops — the entry layer must remount the watcher after
 * re-obtaining permission.
 * @param {object} [opts.options]
 * Override options.
 * @param {number} [opts.options.pollInterval]
 * Poll interval in ms. Defaults to {@link DEFAULT_POLL_INTERVAL_MS} (300).
 * @returns {HostedWatcherHandle}
 */
export function startHostedWatcher({ rootHandle, onEvent, onError, options = {} }) {
 if (!rootHandle || typeof rootHandle.entries !== 'function') {
 throw new TypeError(
 'startHostedWatcher: rootHandle must be a FileSystemDirectoryHandle',
 );
 }
 if (typeof onEvent !== 'function') {
 throw new TypeError('startHostedWatcher: onEvent must be a function');
 }

 const pollInterval =
 typeof options.pollInterval === 'number' && options.pollInterval > 0
 ? options.pollInterval
 : DEFAULT_POLL_INTERVAL_MS;

 const errorHandler =
 typeof onError === 'function'
 ? onError
 : (err) => console.error('[hosted-watcher]', err);

 let closed = false;
 let timerId = null;

 // The previous snapshot. Starts null; set after the initial walk (ready).
 /** @type {Map<string, SnapshotEntry> | null} */
 let prevSnapshot = null;

 // `ready` resolves once the initial snapshot is built.
 /** @type {(value: void) => void} */
 let resolveReady;
 const ready = new Promise((resolve) => {
 resolveReady = resolve;
 });

 /**
 * Run one poll cycle: walk the handle, diff against the previous snapshot,
 * emit events, schedule the next poll.
 *
 * Never rejects — any error stops the loop (fatal) and surfaces via
 * `onError`. Non-fatal conditions don't exist for the hosted watcher; any
 * thrown value is treated as fatal.
 */
 async function poll() {
 if (closed) return;

 let newSnapshot;
 try {
 newSnapshot = await walkSnapshot(rootHandle, '');
 } catch (err) {
 if (isFatalError(err)) {
 // Stop the loop and surface the error once.
 closed = true;
 try {
 errorHandler(/** @type {Error} */ (err));
 } catch {
 // Ignore errors thrown by the error handler.
 }
 }
 return;
 }

 if (prevSnapshot === null) {
 // First snapshot — the baseline. No events emitted.
 prevSnapshot = newSnapshot;
 resolveReady();
 } else {
 // Subsequent snapshot — diff and emit events.
 const events = diffSnapshots(prevSnapshot, newSnapshot);
 prevSnapshot = newSnapshot;
 for (const event of events) {
 if (closed) break;
 try {
 onEvent(event);
 } catch (err) {
 // An error in the consumer should not stop the watcher.
 console.error('[hosted-watcher] onEvent threw:', err);
 }
 }
 }

 // Schedule the next poll (unless closed).
 if (!closed) {
 timerId = setTimeout(() => {
 timerId = null;
 poll();
 }, pollInterval);
 }
 }

 // Kick off immediately (microtask queue, not setTimeout, for fast boot).
 Promise.resolve().then(() => poll());

 return {
 ready,

 async close() {
 if (closed) return;
 closed = true;
 if (timerId !== null) {
 clearTimeout(timerId);
 timerId = null;
 }
 },
 };
}

// ---------------------------------------------------------------------------
// createFsaBackendWithWatcher — convenience helper that flips canWatch: true
// ---------------------------------------------------------------------------

/**
 * Construct the FSA backend AND start the hosted watcher together, returning
 * both. The returned `backend.capabilities.canWatch` is `true` — it reflects
 * the live watcher being attached.
 *
 * This helper is the intended integration point for 's
 * `bootHostedProject`. Instead of:
 *
 * ```js
 * const backend = createFsaBackend(handle); // canWatch: false
 * const watcher = startHostedWatcher({ rootHandle: handle, ... });
 * ```
 *
 * calls:
 *
 * ```js
 * const { backend, watcher } = createFsaBackendWithWatcher(handle, {
 * onEvent, onError, options,
 * });
 * // backend.capabilities.canWatch === true
 * ```
 *
 * The backend returned here is a thin wrapper around `createFsaBackend` that
 * overrides `capabilities` with `canWatch: true`. All reads/writes are
 * delegated unchanged.
 *
 * @param {FileSystemDirectoryHandle} rootHandle
 * @param {object} watcherOpts
 * @param {(event: WatchEvent) => void} watcherOpts.onEvent
 * @param {(err: Error) => void} [watcherOpts.onError]
 * @param {{ pollInterval?: number }} [watcherOpts.options]
 * @returns {{ backend: import('@lerret/core').FilesystemAccess, watcher: HostedWatcherHandle }}
 */
export function createFsaBackendWithWatcher(rootHandle, watcherOpts) {
 const baseBackend = createFsaBackend(rootHandle);

 // Override capabilities to reflect the live watcher.
 const capabilities = Object.freeze({
 ...baseBackend.capabilities,
 canWatch: true,
 });

 /** @type {import('@lerret/core').FilesystemAccess} */
 const backend = {
 capabilities,
 readDir: (dirPath) => baseBackend.readDir(dirPath),
 readFile: (filePath, opts) => baseBackend.readFile(filePath, opts),
 writeFile: (filePath, data, opts) => baseBackend.writeFile(filePath, data, opts),
 watch: (targetPath, listener) => baseBackend.watch(targetPath, listener),
 };

 const watcher = startHostedWatcher({
 rootHandle,
 onEvent: watcherOpts.onEvent,
 onError: watcherOpts.onError,
 options: watcherOpts.options,
 });

 return { backend, watcher };
}
