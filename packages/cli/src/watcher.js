// watcher.js — the CLI-mode file watcher that turns native `fs` events under
// a project's `.lerret/` tree into the architecture's normalized
// {@link WatchEvent}s (AR5).
//
// The Node `fs.watch` API on its own is famously coarse and platform-
// dependent — it does not reliably distinguish `add` / `change` / `remove`,
// and on macOS its `recursive` mode is half-implemented. So this watcher
// wraps **chokidar**, the de-facto standard wrapper over `fs.watch` (the same
// library Vite itself uses). Chokidar gives us per-platform `add` / `change`
// / `unlink` events and the `addDir` / `unlinkDir` pair for folders, with
// known/consistent behavior on macOS, Linux, and Windows. We translate that
// straight into the model's normalized `{ type, path }` shape.
//
// THIS file is the only place in `@lerret/cli` allowed to import `chokidar`.
// `core` stays environment-agnostic (no Node built-ins); the loader's pure
// `applyWatchEvent` patches the project model off the events this file emits.
//
// Path discipline: every emitted `WatchEvent.path` is a {@link LerretPath} —
// forward-slash, no trailing slash. Chokidar may report native separators on
// Windows (it normalizes most of the time but not always), so this file does
// the conversion at the boundary, exactly like the Node fs backend.

import { sep as nativeSep } from 'node:path';

import chokidar from 'chokidar';

import { makeWatchEvent, watchEventType } from '@lerret/core';

/**
 * @typedef {import('@lerret/core').WatchEvent} WatchEvent
 * @typedef {import('@lerret/core').LerretPath} LerretPath
 */

/**
 * Convert a native OS path into a contract-level {@link LerretPath}
 * (forward slashes, no trailing slash).
 *
 * @param {string} nativePath
 * @returns {string}
 */
function toLerretPath(nativePath) {
  const slashed = nativeSep === '/' ? nativePath : nativePath.replaceAll(nativeSep, '/');
  // Strip a trailing slash so `/a/b/` and `/a/b` are the same path. A bare
  // root `'/'` is left alone — that case never reaches the watcher (the scan
  // root is always a `.lerret/` directory).
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed;
}

/**
 * Convert a contract-level {@link LerretPath} into a path the host OS
 * understands — used when handing the scan root to chokidar.
 *
 * @param {string} lerretPath
 * @returns {string}
 */
function toNativePath(lerretPath) {
  return nativeSep === '/' ? lerretPath : lerretPath.replaceAll('/', nativeSep);
}

/**
 * Chokidar event names → normalized `WatchEventType`. Folder add/remove
 * (`addDir` / `unlinkDir`) and file add/remove map onto the same `add`/
 * `remove` semantics — the loader's patcher uses path classification to
 * decide whether the event is for a page, group, asset, or font.
 *
 * @type {Readonly<Record<string, import('@lerret/core').watchEventType[keyof typeof import('@lerret/core').watchEventType]>>}
 */
const CHOKIDAR_TO_TYPE = Object.freeze({
  add: watchEventType.ADD,
  addDir: watchEventType.ADD,
  change: watchEventType.CHANGE,
  unlink: watchEventType.REMOVE,
  unlinkDir: watchEventType.REMOVE,
});

/**
 * Optional handler invoked when chokidar's underlying watch errors. Stays
 * non-fatal — the watcher logs and keeps running rather than tearing down
 * the live-edit loop on a transient `fs` error.
 *
 * @callback WatcherErrorHandler
 * @param {Error} err
 * @returns {void}
 */

/**
 * The handle returned by {@link startWatcher}. Calling `close()` stops the
 * underlying chokidar watcher and releases the OS resources. Idempotent.
 *
 * @typedef {object} WatcherHandle
 * @property {() => Promise<void>} close
 *   Stop watching. Resolves once chokidar has fully closed. Safe to call
 *   more than once.
 * @property {Promise<void>} ready
 *   Resolves once chokidar has done its initial scan and reported `'ready'`
 *   — the watcher is now genuinely live. The `ignoreInitial: true` option
 *   means no `add` events fire for files that already existed at start;
 *   `await handle.ready` lets a caller (or a test) wait for that quiescent
 *   point before triggering edits.
 */

/**
 * Begin watching a project's `.lerret/` directory for changes, emitting one
 * normalized {@link WatchEvent} per filesystem change.
 *
 * Configuration is deliberately conservative:
 *
 * - `ignoreInitial: true` — chokidar does not emit `add` for files that
 *   already existed at start. The initial project state is the loader's job
 *   (`scan`), not the watcher's; the watcher only reports CHANGES from that
 *   baseline. (Without this we would re-feed every file at boot as `add`,
 *   doubling the work of the initial scan.)
 * - `awaitWriteFinish` — debounces a save so the editor's "write the new
 *   bytes, then truncate, then close" sequence (which can fire multiple
 *   `change` events) yields exactly one. The values are short enough to
 *   stay well inside the 1-second NFR2 budget while still coalescing.
 * - No `ignored` patterns by default — the loader's path classification
 *   filters out the irrelevant paths (config.json, images, anything under a
 *   reserved folder). Watching everything keeps the watcher dumb and the
 *   model the single source of mapping rules.
 *
 * @param {object} opts
 * @param {LerretPath} opts.root
 *   The project's scan root — the `.lerret/` directory. Same path the
 *   loader scanned.
 * @param {(event: WatchEvent) => void} opts.onEvent
 *   Called once per normalized event. Receives the validated `WatchEvent`;
 *   callers feed it straight to `applyWatchEvent` and re-render off the new
 *   model.
 * @param {WatcherErrorHandler} [opts.onError]
 *   Optional non-fatal error handler. Defaults to `console.error`.
 * @param {object} [opts.options]
 *   Pass-through overrides for chokidar's option bag — exposed for tests
 *   that need to tune timing. Merged on top of the defaults.
 * @returns {WatcherHandle}
 */
export function startWatcher({ root, onEvent, onError, options = {} }) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('startWatcher: root must be a non-empty LerretPath string');
  }
  if (typeof onEvent !== 'function') {
    throw new TypeError('startWatcher: onEvent must be a function');
  }
  const errorHandler =
    typeof onError === 'function' ? onError : (err) => console.error('[watcher]', err);

  // Chokidar takes a glob-like or path string; we pass the native form so it
  // does its own native-`fs` work without re-translating.
  const watcher = chokidar.watch(toNativePath(root), {
    // Don't fire `add` events for the initial state — the loader already
    // built the model from `scan()`.
    ignoreInitial: true,
    // Coalesce a save's multiple writes into one `change` event.
    awaitWriteFinish: {
      stabilityThreshold: 80,
      pollInterval: 20,
    },
    // Keep symlink quirkiness out of the live-edit loop — match the loader,
    // which never follows symlinks either.
    followSymlinks: false,
    // Always include subdirectories; the watcher is for the whole `.lerret/`.
    depth: undefined,
    // Chokidar normally pre-loads stats. Disabling it shortens initial start
    // on bigger projects; the per-event payload doesn't depend on stat info.
    alwaysStat: false,
    ...options,
  });

  // `ready` resolves once chokidar has done its initial silent walk. Tests
  // await this before triggering edits so the watcher is genuinely live.
  /** @type {(value: void) => void} */
  let resolveReady;
  /** @type {(reason: unknown) => void} */
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // Forward each chokidar event as a normalized WatchEvent.
  watcher.on('all', (chokidarEvent, nativePath) => {
    const type = CHOKIDAR_TO_TYPE[chokidarEvent];
    if (type === undefined) return; // 'ready' / 'error' / 'raw' — not change events
    if (typeof nativePath !== 'string' || nativePath.length === 0) return;
    // Chokidar tells us file vs folder via the event name (`addDir`/`unlinkDir`
    // for folders, `add`/`change`/`unlink` for files). Pass it through so the
    // loader's classifier never has to guess from the extension — without it a
    // non-asset file like `Name.config.json` would be mistaken for a folder and
    // patched in as a phantom group.
    const isDirectory = chokidarEvent === 'addDir' || chokidarEvent === 'unlinkDir';
    try {
      // `makeWatchEvent` validates + normalizes — a single place to enforce
      // the contract. A bug in mapping fails loudly here, not silently in a
      // consumer.
      onEvent(makeWatchEvent(type, toLerretPath(nativePath), isDirectory));
    } catch (err) {
      errorHandler(/** @type {Error} */ (err));
    }
  });

  watcher.on('ready', () => resolveReady());
  watcher.on('error', (err) => {
    errorHandler(/** @type {Error} */ (err));
    // A pre-`ready` error means the watcher never came up — reject so the
    // caller's `await handle.ready` does not hang forever.
    rejectReady(err);
  });

  let closed = false;
  return {
    ready,
    async close() {
      if (closed) return;
      closed = true;
      await watcher.close();
    },
  };
}

export { CHOKIDAR_TO_TYPE };
