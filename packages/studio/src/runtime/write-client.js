// write-client.js — studio→CLI write helper.
//
// ── Why this exists ────────────────────────────────────────────────────────
// In CLI mode the studio runs in the browser, but the user's filesystem lives
// on the Node side. Stories 3.4 / 3.7 / 3.8 / 3.9 all need to write into the
// `.lerret/` tree (data editor, asset rename, config edits, raw-JSON edits) —
// every one of them goes through this single client. There is exactly one
// path that crosses the browser→Node boundary for writes, and this is it.
//
// ── Contract (the public face of this client) ─────────────────────────────
//
// writeProjectFile(path, content) => Promise<{ ok, error? }>
// - `path` {LerretPath} — forward-slash path inside the project's
// `.lerret/` tree.
// - `content` {string} — the new file contents (UTF-8).
// Returns `{ ok: true }` on success.
// Returns `{ ok: false, error: string }` on failure — never throws.
//
// The endpoint is `POST /__lerret/write` with JSON body
// { "path": "<LerretPath>", "content": "<file contents>" }
// and JSON response
// { "ok": true } | { "ok": false, "error": "<reason>" }.
//
// ── Mode awareness ─────────────────────────────────────────────────────────
// In CLI mode (`window.__LERRET_CLI_MODE__ === true`) we POST to the endpoint.
// In standalone / fixture / hosted mode the helper is a no-op that returns a
// clear `{ ok: false, error: 'writes are disabled in standalone mode' }`. The
// hosted Vision-tier writer plugs in via a different writer and
// will replace this branch.
//
// ── Path safety ────────────────────────────────────────────────────────────
// Path validation is the SERVER's responsibility (the Vite plugin's endpoint).
// We send the path through verbatim; the server rejects anything outside
// `.lerret/` so a malicious or buggy caller cannot escape the project tree.

/**
 * The stable endpoint path the CLI's Vite plugin exposes for safe writes.
 * Kept here so the studio and tests don't drift from the CLI side.
 *
 * @type {string}
 */
export const WRITE_ENDPOINT = '/__lerret/write';

/**
 * Lifecycle endpoints powering the per-entity kebab menus.
 * Each mirrors the contract of `WRITE_ENDPOINT`: POST a small JSON body, get
 * back a `{ ok, error? }` (rename / delete / reveal) or `{ ok, path?, error? }`
 * (duplicate) response. Path safety is enforced server-side.
 *
 * @type {string}
 */
export const RENAME_ENDPOINT = '/__lerret/rename';
export const DUPLICATE_ENDPOINT = '/__lerret/duplicate';
export const DELETE_ENDPOINT = '/__lerret/delete';
export const REVEAL_ENDPOINT = '/__lerret/reveal';
export const MOVE_ENDPOINT = '/__lerret/move';
export const CREATE_ENDPOINT = '/__lerret/create';
export const READ_CONFIG_ENDPOINT = '/__lerret/read-config';
export const SWITCH_FOLDER_ENDPOINT = '/__lerret/switch-folder';
export const RECENT_PROJECTS_ENDPOINT = '/__lerret/recent-projects';

/**
 * Detect CLI mode from the same flag the CLI's plugin injects in
 * `transformIndexHtml`. Reading `globalThis` is friendly to non-browser
 * environments (jsdom tests).
 *
 * @returns {boolean}
 */
function isCliMode() {
 return typeof globalThis !== 'undefined' && globalThis.__LERRET_CLI_MODE__ === true;
}

/**
 * Write a file to the user's project via the CLI's write endpoint.
 *
 * Always resolves with a `{ ok, error? }` shape — never rejects. Callers can
 * treat any non-`ok` result as "show the user a calm message and let them
 * retry"; throwing would force every editor to wrap calls in try/catch.
 *
 * In standalone (no CLI, no dev-harness write target) the call is a no-op
 * that returns `{ ok: false, error: '...' }`. This keeps the editors
 * identical across modes — they always call `writeProjectFile` and react to
 * its return value.
 *
 * @param {string} path
 * The {@link LerretPath} inside the project's `.lerret/` directory.
 * @param {string} content
 * The full new file contents (UTF-8). For JSON callers should serialize
 * with `serializeJson` from `@lerret/core` to get stable key order +
 * trailing newline.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * Inject a fetch implementation. Tests pass a fake; production uses
 * `globalThis.fetch`.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function writeProjectFile(path, content, opts = {}) {
 // Always validate inputs cheaply so a typo at the call site surfaces here
 // and not as a confusing 400 from the server.
 if (typeof path !== 'string' || path.length === 0) {
 return { ok: false, error: 'writeProjectFile: path must be a non-empty string' };
 }
 if (typeof content !== 'string') {
 return { ok: false, error: 'writeProjectFile: content must be a string' };
 }

 if (!isCliMode()) {
 return {
 ok: false,
 error: 'writes are disabled in standalone mode (run `@lerret/cli dev` to enable)',
 };
 }

 const fetchImpl = opts.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
 if (typeof fetchImpl !== 'function') {
 return { ok: false, error: 'no fetch implementation available' };
 }

 let response;
 try {
 response = await fetchImpl(WRITE_ENDPOINT, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ path, content }),
 });
 } catch (err) {
 return {
 ok: false,
 error: `network error: ${err instanceof Error ? err.message : String(err)}`,
 };
 }

 // The server is required to return JSON of the `{ ok, error? }` shape on
 // every status code. We still defend against a non-JSON body (e.g. a Vite
 // dev-server error page) so the editor sees a calm message.
 let body;
 try {
 body = await response.json();
 } catch {
 return {
 ok: false,
 error: `server returned non-JSON response (status ${response.status})`,
 };
 }

 if (body && body.ok === true) {
 return { ok: true };
 }
 return {
 ok: false,
 error:
 (body && typeof body.error === 'string' && body.error) ||
 `write failed (status ${response.status})`,
 };
}

/**
 * Read a folder's OWN config.json via the CLI's read-config endpoint.
 *
 * Returns `{ ok, value, missing?, error? }` — never throws. A plain GET of the
 * file can't be used: the dev server's SPA fallback returns index.html for any
 * unknown path, so this dedicated POST is the only reliable read in CLI mode.
 * In standalone mode it returns a clear non-ok so the caller can fall back.
 *
 * @param {string} configPath
 * The {@link LerretPath} of the `config.json` file to read.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, value: Record<string, unknown>, missing?: boolean, error?: string }>}
 */
export async function readProjectConfig(configPath, opts = {}) {
 if (typeof configPath !== 'string' || configPath.length === 0) {
 return { ok: false, value: {}, error: 'readProjectConfig: path must be a non-empty string' };
 }
 if (!isCliMode()) {
 return { ok: false, value: {}, error: 'config reads are disabled in standalone mode' };
 }
 const fetchImpl = opts.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
 if (typeof fetchImpl !== 'function') {
 return { ok: false, value: {}, error: 'no fetch implementation available' };
 }
 let response;
 try {
 response = await fetchImpl(READ_CONFIG_ENDPOINT, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ path: configPath }),
 });
 } catch (err) {
 return {
 ok: false,
 value: {},
 error: `network error: ${err instanceof Error ? err.message : String(err)}`,
 };
 }
 let parsed;
 try {
 parsed = await response.json();
 } catch {
 return {
 ok: false,
 value: {},
 error: `server returned non-JSON response (status ${response.status})`,
 };
 }
 if (parsed && parsed.ok === true) {
 const value =
 parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
 ? parsed.value
 : {};
 return { ok: true, value, missing: parsed.missing === true };
 }
 return {
 ok: false,
 value: {},
 error:
 (parsed && typeof parsed.error === 'string' && parsed.error) ||
 `read failed (status ${response.status})`,
 };
}

// ── : lifecycle helpers ────────────────────────────────────────────
//
// Each helper mirrors `writeProjectFile`'s shape:
// - return a `{ ok, error? }` object (duplicate also returns `path`),
// - never throw,
// - no-op in standalone mode with an actionable message,
// - share path-safety with the server (the server is the source of truth;
// these helpers don't re-implement the gate).

/**
 * Helper that mirrors {@link writeProjectFile}'s framing for the lifecycle
 * endpoints. POSTs `body` to `endpoint`, returns the parsed `{ ok, error? }`
 * response. Extra response fields (`duplicate` returns `path`) are spread onto
 * the returned object so callers can read them by key.
 *
 * @param {string} endpoint One of the lifecycle endpoint URLs.
 * @param {Record<string, unknown>} body The JSON body to POST.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, error?: string, [extra: string]: unknown }>}
 */
async function callLifecycleEndpoint(endpoint, body, opts = {}) {
 if (!isCliMode()) {
 return {
 ok: false,
 error: 'lifecycle actions are disabled in standalone mode (run `@lerret/cli dev` to enable)',
 };
 }

 const fetchImpl = opts.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
 if (typeof fetchImpl !== 'function') {
 return { ok: false, error: 'no fetch implementation available' };
 }

 let response;
 try {
 response = await fetchImpl(endpoint, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body),
 });
 } catch (err) {
 return {
 ok: false,
 error: `network error: ${err instanceof Error ? err.message : String(err)}`,
 };
 }

 let parsed;
 try {
 parsed = await response.json();
 } catch {
 return {
 ok: false,
 error: `server returned non-JSON response (status ${response.status})`,
 };
 }

 if (parsed && parsed.ok === true) {
 return parsed;
 }
 return {
 ok: false,
 error:
 (parsed && typeof parsed.error === 'string' && parsed.error) ||
 `request failed (status ${response.status})`,
 };
}

/**
 * Rename (or move) a file or folder inside the project's `.lerret/` tree.
 *
 * @param {string} fromPath The current {@link LerretPath}.
 * @param {string} toPath The target {@link LerretPath} (must not exist).
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function renameProjectFile(fromPath, toPath, opts = {}) {
 if (typeof fromPath !== 'string' || fromPath.length === 0) {
 return { ok: false, error: 'renameProjectFile: from must be a non-empty string' };
 }
 if (typeof toPath !== 'string' || toPath.length === 0) {
 return { ok: false, error: 'renameProjectFile: to must be a non-empty string' };
 }
 const result = await callLifecycleEndpoint(RENAME_ENDPOINT, { from: fromPath, to: toPath }, opts);
 return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Duplicate a file or folder, producing a sibling copy with a `(copy)` suffix.
 *
 * @param {string} path The {@link LerretPath} to duplicate.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 * The new path is returned on success so the caller can highlight it.
 */
export async function duplicateProjectFile(path, opts = {}) {
 if (typeof path !== 'string' || path.length === 0) {
 return { ok: false, error: 'duplicateProjectFile: path must be a non-empty string' };
 }
 const result = await callLifecycleEndpoint(DUPLICATE_ENDPOINT, { path }, opts);
 if (!result.ok) return { ok: false, error: result.error };
 return { ok: true, path: typeof result.path === 'string' ? result.path : undefined };
}

/**
 * Move a file or folder from `fromPath` into `toFolderPath` (a destination
 * parent folder, NOT a final path). The server handles companion-file
 * discovery (data file, component-prefixed images) atomically and rewrites
 * the source folder's `liveRefresh` block per the {@link opts.carryLiveRefresh}
 * flag (see spec `spec-move-asset-cross-group.md`).
 *
 * @param {string} fromPath The {@link LerretPath} to move (asset or folder).
 * @param {string} toFolderPath The {@link LerretPath} of the destination
 *   parent folder. Must be inside `.lerret/`.
 * @param {object} [opts]
 * @param {boolean} [opts.carryLiveRefresh]
 *   When `true`, carry the source folder's `liveRefresh[<basename>]` entry
 *   over to the destination folder's `config.json` (creating the block if
 *   missing). Default `false`: the key is simply stripped from the source.
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{
 *   ok: boolean,
 *   newPath?: string,
 *   rewroteLiveRefresh?: 'stripped'|'carried-over'|'none'|'skipped-malformed',
 *   error?: string,
 * }>}
 *   On success, `newPath` is the final {@link LerretPath} of the moved
 *   asset/folder and `rewroteLiveRefresh` records what happened to the
 *   liveRefresh block (so the caller can surface a meaningful toast).
 */
export async function moveProjectFile(fromPath, toFolderPath, opts = {}) {
 if (typeof fromPath !== 'string' || fromPath.length === 0) {
 return { ok: false, error: 'moveProjectFile: fromPath must be a non-empty string' };
 }
 if (typeof toFolderPath !== 'string' || toFolderPath.length === 0) {
 return { ok: false, error: 'moveProjectFile: toFolderPath must be a non-empty string' };
 }
 const body = { fromPath, toFolderPath };
 if (opts.carryLiveRefresh === true) body.carryLiveRefresh = true;
 const result = await callLifecycleEndpoint(MOVE_ENDPOINT, body, opts);
 if (!result.ok) return { ok: false, error: result.error };
 return {
 ok: true,
 newPath: typeof result.newPath === 'string' ? result.newPath : undefined,
 rewroteLiveRefresh:
 typeof result.rewroteLiveRefresh === 'string' ? result.rewroteLiveRefresh : undefined,
 };
}

/**
 * Create a new page/group folder or a starter asset file inside `parentPath`.
 *
 * `parentPath` is the destination folder's {@link LerretPath} (the bare
 * `.lerret/` root is allowed for a new top-level page). `name` is the user's
 * raw name — the server validates + normalizes it (the studio dialog runs the
 * same `validateEntryName` for instant feedback). For `kind: 'asset'`,
 * `opts.assetKind` picks `'component'` (`.jsx`, default) or `'markdown'`
 * (`.md`).
 *
 * @param {string} parentPath  Destination folder's LerretPath.
 * @param {string} name        Raw entry name (no extension needed).
 * @param {'folder'|'asset'} kind
 * @param {object} [opts]
 * @param {'component'|'markdown'} [opts.assetKind]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 *   On success, `path` is the created entry's LerretPath.
 */
export async function createProjectEntry(parentPath, name, kind, opts = {}) {
  if (typeof parentPath !== 'string' || parentPath.length === 0) {
    return { ok: false, error: 'createProjectEntry: parentPath must be a non-empty string' };
  }
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, error: 'createProjectEntry: name must be a non-empty string' };
  }
  if (kind !== 'folder' && kind !== 'asset') {
    return { ok: false, error: 'createProjectEntry: kind must be "folder" or "asset"' };
  }
  const reqBody = { parentPath, name, kind };
  if (kind === 'asset') {
    reqBody.assetKind = opts.assetKind === 'markdown' ? 'markdown' : 'component';
  }
  const result = await callLifecycleEndpoint(CREATE_ENDPOINT, reqBody, opts);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, path: typeof result.path === 'string' ? result.path : undefined };
}

/**
 * Delete a file or folder inside the project's `.lerret/` tree. Folders are
 * removed recursively. A missing target is treated as a successful no-op
 * (server-side; the desired post-state is already met).
 *
 * @param {string} path The {@link LerretPath} to delete.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteProjectFile(path, opts = {}) {
 if (typeof path !== 'string' || path.length === 0) {
 return { ok: false, error: 'deleteProjectFile: path must be a non-empty string' };
 }
 const result = await callLifecycleEndpoint(DELETE_ENDPOINT, { path }, opts);
 return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Reveal a path in the user's editor (`target: 'editor'`) or file manager
 * (`target: 'finder'`). Requires CLI mode — in hosted/standalone mode this is
 * the surface that returns disabled-with-reason at the UI layer (UX-DR9).
 *
 * @param {string} path The {@link LerretPath} to reveal.
 * @param {'editor'|'finder'} target
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function revealProjectFile(path, target, opts = {}) {
 if (typeof path !== 'string' || path.length === 0) {
 return { ok: false, error: 'revealProjectFile: path must be a non-empty string' };
 }
 if (target !== 'editor' && target !== 'finder') {
 return { ok: false, error: 'revealProjectFile: target must be "editor" or "finder"' };
 }
 const result = await callLifecycleEndpoint(REVEAL_ENDPOINT, { path, target }, opts);
 return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * Switch the studio to a different project folder — or close the current one —
 * WITHOUT restarting the CLI. POSTs `{ folder }` to the switch endpoint; the
 * server re-points, re-scans, restarts the watcher, and broadcasts the new
 * model over `lerret:change` (which `cli-project-source` applies). This call
 * resolves once the server acknowledges, carrying the new project metadata.
 *
 * @param {string | null} folder
 *   An absolute folder path to connect (the server walks up to find `.lerret/`),
 *   or `null` to close the current project and return to the connect screen.
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<{ ok: boolean, projectRoot?: string|null, lerretDir?: string|null, epoch?: number, recent?: Array<{path:string,name:string}>, error?: string }>}
 */
export async function switchProject(folder, opts = {}) {
 if (folder !== null && (typeof folder !== 'string' || folder.length === 0)) {
 return { ok: false, error: 'switchProject: folder must be a non-empty path or null' };
 }
 return callLifecycleEndpoint(SWITCH_FOLDER_ENDPOINT, { folder }, opts);
}

/**
 * Fetch the recent-projects list (most-recent-first) for the connect screen.
 * Always resolves with an array — `[]` on any failure or in standalone mode,
 * so the caller never has to try/catch.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {Promise<Array<{ path: string, name: string }>>}
 */
export async function fetchRecentProjects(opts = {}) {
 if (!isCliMode()) return [];
 const fetchImpl = opts.fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
 if (typeof fetchImpl !== 'function') return [];
 try {
 const response = await fetchImpl(RECENT_PROJECTS_ENDPOINT, { method: 'GET' });
 const parsed = await response.json();
 if (parsed && parsed.ok === true && Array.isArray(parsed.recent)) return parsed.recent;
 } catch {
 // No recents available (network error / non-JSON) — fall through to [].
 }
 return [];
}

/**
 * Report whether the studio is running in CLI mode. Exposed for components
 * that need to gate UI affordances (e.g. UX-DR9 disabled-with-reason for
 * "Reveal in editor / Finder" outside CLI mode).
 *
 * @returns {boolean}
 */
export function inCliMode() {
 return isCliMode();
}

/**
 * @typedef {import('@lerret/core').LerretPath} LerretPath
 */
