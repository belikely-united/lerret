// FilesystemAccess — the keystone filesystem-abstraction contract.
//
// Lerret reads and writes a user's project through ONE interface, defined here
// in `core` as pure, environment-agnostic code. Two backends implement it:
//
//   - the Node `fs` backend  (`lerret` — CLI / self-host mode)
//   - the File System Access API backend  (`@lerret/studio` — hosted mode)
//
// Every filesystem-touching subsystem — the project loader, the watcher, the
// data / config / meta editors, the export pipeline, and the `.lerret/.state/`
// persistence layer — goes exclusively through a `FilesystemAccess` value.
// No subsystem calls `node:fs` or the File System Access API directly; only
// the two backends do (architecture: the separation invariant, NFR13).
//
// This file is PURE: it imports no `node:fs`, no `node:path`, and no DOM APIs.
// It is the contract + canonical type shapes + a runtime conformance validator,
// nothing more.
//
// SCOPE NOTE. `watch` is declared in the contract here so backends can expose
// it and capability flags can advertise it. The normalized change-event layer
// (`{ type: 'add' | 'change' | 'remove', path }`) and the native watcher live
// in `core/loader/watch.js` — this file does not implement them.

// ---------------------------------------------------------------------------
// Path convention
// ---------------------------------------------------------------------------
//
// Every path that crosses the `FilesystemAccess` boundary — as an argument or
// in a returned shape — is a POSIX-style string with forward-slash (`/`)
// separators, regardless of host OS. Backends normalize at their edge: the
// Node backend converts to/from the OS separator internally; callers (loader,
// editors, export) never see a backslash. This keeps project model paths
// stable and diffable across Windows, macOS, and Linux.

/**
 * A path as it crosses the filesystem abstraction: forward-slash separators,
 * no trailing slash (except a lone root). Always normalized by the backend.
 *
 * @typedef {string} LerretPath
 */

// ---------------------------------------------------------------------------
// Canonical shapes
// ---------------------------------------------------------------------------

/**
 * The kind of a single entry inside a directory.
 *
 * `'file'` and `'directory'` are the only kinds the loader needs to walk a
 * project tree. Symlinks and other special entries are resolved or ignored by
 * the backend — they never surface as a distinct kind here.
 *
 * @typedef {'file' | 'directory'} DirEntryKind
 */

/**
 * One entry returned by {@link FilesystemAccess.readDir}.
 *
 * The canonical directory-entry shape, shared by every backend. `isDirectory`
 * and `isFile` are mutually exclusive booleans so callers can branch with a
 * plain boolean check; `kind` carries the same information as a discriminant
 * for `switch` statements. Both are always populated and always consistent.
 *
 * @typedef {object} DirEntry
 * @property {string} name
 *   The entry's own name — the final path segment only, never a full path
 *   (e.g. `"Button.jsx"`, `"components"`). Forward-slash convention is moot
 *   for a single segment but the name never contains a separator.
 * @property {LerretPath} path
 *   The entry's full normalized path, formed by joining the directory passed
 *   to `readDir` with `name`. Forward-slash separators.
 * @property {DirEntryKind} kind
 *   `'file'` or `'directory'` — the discriminant form.
 * @property {boolean} isFile
 *   `true` iff this entry is a regular file. Equivalent to `kind === 'file'`.
 * @property {boolean} isDirectory
 *   `true` iff this entry is a subdirectory. Equivalent to
 *   `kind === 'directory'`.
 */

/**
 * Encoding accepted by {@link FilesystemAccess.readFile} /
 * {@link FilesystemAccess.writeFile}.
 *
 * - `'utf-8'` — read returns a `string`; write accepts a `string`. The default
 *   and the form used for all JSON, JSX, Markdown, and config files.
 * - `'binary'` — read returns a `Uint8Array`; write accepts a `Uint8Array`.
 *   Used for asset bytes: images, fonts. Chosen over Node's `Buffer` so the
 *   shape is identical in the browser backend.
 *
 * @typedef {'utf-8' | 'binary'} FileEncoding
 */

/**
 * Options for {@link FilesystemAccess.readFile}.
 *
 * @typedef {object} ReadFileOptions
 * @property {FileEncoding} [encoding='utf-8']
 *   How to decode the file. Omit (or pass `'utf-8'`) for text; pass
 *   `'binary'` to receive raw bytes as a `Uint8Array`.
 */

/**
 * Options for {@link FilesystemAccess.writeFile}.
 *
 * @typedef {object} WriteFileOptions
 * @property {FileEncoding} [encoding='utf-8']
 *   How to interpret `data`. `'utf-8'` for a `string`, `'binary'` for a
 *   `Uint8Array`. Must match the runtime type of `data`.
 */

/**
 * A subscription handle returned by {@link FilesystemAccess.watch}.
 *
 * Calling `close()` stops the watch and releases the underlying OS resource.
 * It is idempotent — calling it more than once is safe and does nothing after
 * the first call.
 *
 * @typedef {object} Watcher
 * @property {() => void} close
 *   Stop watching and release resources. Idempotent.
 */

/**
 * A raw filesystem change as reported by a backend's `watch`.
 *
 * NOTE. This is the *backend-level* event — intentionally coarse. The Node
 * `fs.watch` API cannot reliably distinguish add / change / remove, so the
 * backend reports only that *something* changed at (or under) a path. The
 * normalized `{ type: 'add' | 'change' | 'remove', path }` event the loader
 * consumes is derived in the watcher layer by diffing against the project
 * model — not here.
 *
 * @typedef {object} RawWatchEvent
 * @property {'rename' | 'change'} kind
 *   The underlying event kind. `'rename'` covers creation, deletion, and
 *   renames; `'change'` covers content modification. Maps to `fs.watch`'s
 *   `eventType`.
 * @property {LerretPath | null} path
 *   The normalized path of the affected entry, or `null` if the platform did
 *   not report a filename.
 */

/**
 * Callback passed to {@link FilesystemAccess.watch}.
 *
 * @callback WatchListener
 * @param {RawWatchEvent} event
 * @returns {void}
 */

// ---------------------------------------------------------------------------
// Capability flags
// ---------------------------------------------------------------------------

/**
 * What a given backend can actually do in its environment.
 *
 * Some operations are environment-limited: the File System Access API cannot
 * "reveal in Finder", a read-only handle cannot write, and watch support
 * varies. Rather than have the UI guess, each backend declares its
 * capabilities up front so features can be enabled — or disabled *with a
 * reason* — deterministically. A disabled capability should pair with a short
 * human-readable explanation in the UI ("Reveal in Finder is unavailable in
 * the browser"), per the UX spec's honest-degradation pattern.
 *
 * Flags are conservative: a backend sets a flag `true` only if the operation
 * is genuinely supported. Unknown future capabilities are added here as new
 * optional flags — consumers must treat a missing flag as `false`.
 *
 * @typedef {object} FilesystemCapabilities
 * @property {boolean} canWrite
 *   `true` iff `writeFile` is supported. A read-only project (e.g. a
 *   File System Access handle granted read-only) reports `false`, and the UI
 *   disables editors and persistence accordingly.
 * @property {boolean} canWatch
 *   `true` iff `watch` reports live filesystem changes. When `false`, the
 *   studio falls back to manual refresh — `watch` may still exist but is a
 *   no-op, so consumers must check this flag rather than the method's
 *   presence.
 * @property {boolean} canReveal
 *   `true` iff the host OS can reveal a path in a native file manager
 *   ("Reveal in Finder" / "Show in Explorer"). Browser backends report
 *   `false`. The reveal action itself is not part of the v1 method surface;
 *   this flag lets the UI show-or-hide the affordance ahead of that.
 */

// ---------------------------------------------------------------------------
// The interface contract
// ---------------------------------------------------------------------------

/**
 * `FilesystemAccess` — the filesystem-abstraction interface contract.
 *
 * Any object that fulfils this typedef is a valid filesystem backend and may
 * be injected into the loader, watcher, editors, and export pipeline. The
 * contract is environment-agnostic; backends adapt it to Node `fs` or the
 * File System Access API.
 *
 * Method conventions, binding on every backend:
 *
 * - **Paths.** Every path argument is a {@link LerretPath} (forward slashes);
 *   every path in a returned shape is likewise normalized.
 * - **Async.** Every operation returns a `Promise`. Backends never block.
 * - **Errors.** A failed operation *rejects* — backends never resolve with a
 *   sentinel. Rejection reasons are `Error` objects; the loader translates
 *   them into guided, user-facing messages (architecture: honest degradation).
 * - **Writes are safe.** `writeFile` is atomic from a reader's perspective: a
 *   reader either sees the complete old content or the complete new content,
 *   never a truncated or partial file, even if the write is interrupted
 *   (NFR9). Backends implement this via temp-file-then-rename or an
 *   equivalent atomic primitive.
 *
 * @typedef {object} FilesystemAccess
 *
 * @property {(dirPath: LerretPath) => Promise<DirEntry[]>} readDir
 *   List the immediate children of a directory. Resolves with an array of
 *   {@link DirEntry} — one per child — distinguishing files from
 *   subdirectories. Order is not guaranteed; callers that need a stable order
 *   sort by `name`. Rejects if `dirPath` does not exist or is not a directory.
 *   Non-recursive: the loader walks the tree itself.
 *
 * @property {(filePath: LerretPath, options?: ReadFileOptions) => Promise<string | Uint8Array>} readFile
 *   Read a file's full contents. With `encoding: 'utf-8'` (the default)
 *   resolves with a decoded `string`; with `encoding: 'binary'` resolves with
 *   a `Uint8Array` of raw bytes. Rejects if the file does not exist or is not
 *   readable.
 *
 * @property {(filePath: LerretPath, data: string | Uint8Array, options?: WriteFileOptions) => Promise<void>} writeFile
 *   Write a file's full contents, replacing any existing file, creating it if
 *   absent. The write is atomic (see "Writes are safe" above): an interrupted
 *   write leaves the previous content fully intact. `data` is a `string` for
 *   `encoding: 'utf-8'` (default) or a `Uint8Array` for `encoding: 'binary'`.
 *   Resolves once the new content is durably in place. Rejects on failure —
 *   and on rejection the original file is unchanged.
 *
 *   JSON written through a backend is serialized with a stable key order and a
 *   trailing newline so files diff cleanly under git; see
 *   {@link serializeJson}.
 *
 * @property {(targetPath: LerretPath, listener: WatchListener) => Watcher} watch
 *   Begin watching a file or directory for changes, invoking `listener` with a
 *   {@link RawWatchEvent} on each change. Returns a {@link Watcher} whose
 *   `close()` ends the subscription. If the backend cannot watch
 *   (`capabilities.canWatch === false`) this is a no-op that still returns a
 *   valid, closable {@link Watcher} — consumers gate on the capability flag,
 *   not on whether the method exists. Synchronous: returns the handle
 *   immediately rather than a `Promise`, since there is nothing to await.
 *
 * @property {FilesystemCapabilities} capabilities
 *   The backend's declared {@link FilesystemCapabilities}. A plain data
 *   object, read directly (not a method).
 */

// ---------------------------------------------------------------------------
// JSON serialization helper
// ---------------------------------------------------------------------------

/**
 * Serialize a value to the canonical Lerret JSON form:
 *
 * - two-space indentation (matches the brownfield studio's existing JSON),
 * - keys in stable insertion order — deterministic output for the same input,
 * - exactly one trailing newline.
 *
 * Backends use this for every JSON file they write (`config.json`,
 * `<Name>.data.json`, the `.lerret/.state/` sidecar) so that re-saving an
 * unchanged value produces a byte-identical file and git diffs stay minimal
 * (architecture: JSON format rules).
 *
 * This is pure string work — no filesystem access — so it lives in `core`
 * alongside the contract and is reused by every backend.
 *
 * @param {unknown} value
 *   The JSON-serializable value to write.
 * @returns {string}
 *   The serialized text, terminated by a single `\n`.
 */
export function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Conformance validator
// ---------------------------------------------------------------------------

/**
 * The method names every {@link FilesystemAccess} backend must implement.
 * @type {readonly string[]}
 */
const REQUIRED_METHODS = ['readDir', 'readFile', 'writeFile', 'watch'];

/**
 * The boolean flags every {@link FilesystemCapabilities} object must declare.
 * @type {readonly string[]}
 */
const REQUIRED_CAPABILITY_FLAGS = ['canWrite', 'canWatch', 'canReveal'];

/**
 * Check whether `backend` structurally conforms to the {@link FilesystemAccess}
 * contract, returning the list of problems found.
 *
 * This is a *structural* check — it verifies the required methods and
 * capability flags are present and correctly typed. It does not (and cannot)
 * verify runtime behavior such as write atomicity; that is covered by each
 * backend's own tests.
 *
 * @param {unknown} backend
 *   The candidate backend object.
 * @returns {string[]}
 *   An array of human-readable problem descriptions — empty iff `backend`
 *   conforms.
 */
export function findFilesystemContractViolations(backend) {
  /** @type {string[]} */
  const problems = [];

  if (backend === null || typeof backend !== 'object') {
    return ['backend is not an object'];
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof backend[method] !== 'function') {
      problems.push(`missing or non-function method: ${method}()`);
    }
  }

  const caps = backend.capabilities;
  if (caps === null || typeof caps !== 'object') {
    problems.push('missing or invalid `capabilities` object');
  } else {
    for (const flag of REQUIRED_CAPABILITY_FLAGS) {
      if (typeof caps[flag] !== 'boolean') {
        problems.push(`capabilities.${flag} must be a boolean`);
      }
    }
  }

  return problems;
}

/**
 * Assert that `backend` conforms to the {@link FilesystemAccess} contract,
 * throwing if it does not.
 *
 * Backends call this on themselves (e.g. in a test, or once at construction)
 * to fail fast and loudly if they drift from the contract. The thrown error
 * lists every violation at once.
 *
 * @param {unknown} backend
 *   The candidate backend object.
 * @param {string} [label='backend']
 *   A name for the backend, used in the error message to identify which
 *   backend failed.
 * @returns {FilesystemAccess}
 *   The same `backend`, now type-asserted as a `FilesystemAccess`, so the call
 *   can be used inline.
 * @throws {Error} If `backend` does not conform — the message enumerates every
 *   violation found.
 */
export function assertFilesystemContract(backend, label = 'backend') {
  const problems = findFilesystemContractViolations(backend);
  if (problems.length > 0) {
    throw new Error(
      `${label} does not satisfy the FilesystemAccess contract:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
  return /** @type {FilesystemAccess} */ (backend);
}

/**
 * Boolean form of {@link findFilesystemContractViolations} — `true` iff
 * `backend` satisfies the {@link FilesystemAccess} contract.
 *
 * @param {unknown} backend
 *   The candidate backend object.
 * @returns {boolean}
 */
export function isFilesystemAccess(backend) {
  return findFilesystemContractViolations(backend).length === 0;
}
