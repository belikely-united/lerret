// Turn manifest schema + CRUD.
//
// One JSON file per turn under `.lerret/.state/history/manifests/<id>.json`.
// The manifest carries enough metadata (prompt, provider, model, files,
// status) to power the revert timeline UI (UX-delta §4.5) without ever
// reading the snapshot blobs themselves.
//
// IMMUTABILITY: once a manifest's `files[]` is written, the array and each
// entry's `snapshotKey` are NEVER modified. Only the top-level `status`
// field flips (via `updateManifestStatus`). Subsequent revert/redo append
// NEW manifests with `kind: 'revert'` / `kind: 'redo'`; the original is
// preserved so a redo can find the post-turn blobs.

import {
    manifestPath,
    absoluteManifestPath,
    absoluteManifestsDir,
} from './layout.js';
import { SnapshotError } from './errors.js';

/**
 * Stable JSON serializer — two-space indent, sorted-by-insertion-order keys,
 * trailing newline. Matches `serializeJson` in `@lerret/core/fs/filesystem.js`
 * exactly; reproduced here (rather than imported) so the snapshot subsystem
 * has no static dependency on `@lerret/core`'s source layout. (The
 * @lerret/ai package has no `@lerret/core` dep declared.)
 *
 * @param {unknown} value
 * @returns {string}
 */
function serializeJson(value) {
    return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Allowed values for `TurnManifest.status`.
 */
const ALLOWED_STATUSES = Object.freeze([
    'applied-in-progress',
    'applied',
    'reverted',
    'reverted-forward',
    'stopped-mid-turn',
    'error',
]);

/**
 * Allowed values for `TurnManifest.kind`.
 */
const ALLOWED_KINDS = Object.freeze(['turn', 'revert', 'redo', 'inspect']);

/**
 * @typedef {Object} FileEntry
 * @property {string} path                       POSIX, relative to projectRoot
 * @property {'create'|'edit'|'delete'} op
 * @property {string} [sha256]                   sha256 hex of POST-turn content (absent for delete-op of created-then-deleted files; required for redo)
 * @property {string|null} [snapshotKey]         sha256 hex of PRE-edit content (the before-image blob key); null for op:'create' files
 * @property {'utf-8'|'binary'} [encoding]       Defaults to 'utf-8'. Determines how the blob is read/written.
 */

/**
 * @typedef {Object} TurnManifest
 * @property {string} id
 * @property {string} timestamp                  ISO-8601 UTC with ms precision
 * @property {string} prompt
 * @property {string} provider                   'openai' | 'anthropic' | 'openrouter' | 'ollama'
 * @property {string} model
 * @property {{type: 'project'|'selection', selectionLabel?: string}} scope
 * @property {Array<FileEntry>} files
 * @property {'applied-in-progress'|'applied'|'reverted'|'reverted-forward'|'stopped-mid-turn'|'error'} status
 * @property {'turn'|'revert'|'redo'|'inspect'} [kind]    Default 'turn'
 * @property {string} [sourceTurnId]            Present iff kind in {revert,redo}
 */

/**
 * Create a fresh turn manifest in-memory. The orchestrator (Story 8.3) calls
 * this once per turn and threads the result through subsequent capture +
 * finalize calls.
 *
 * @param {{
 *   id?: string,
 *   prompt: string,
 *   provider: string,
 *   model: string,
 *   scope?: { type: 'project'|'selection', selectionLabel?: string },
 *   kind?: 'turn'|'revert'|'redo'|'inspect',
 *   sourceTurnId?: string,
 *   now?: () => Date,
 * }} args
 * @returns {TurnManifest}
 */
export function createManifest({
    id,
    prompt,
    provider,
    model,
    scope = { type: 'project' },
    kind = 'turn',
    sourceTurnId,
    now,
}) {
    if (!id) {
        // Browser + Node 19+ both expose this as a global.
        id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : fallbackUuid();
    }
    const ts = now ? now() : new Date();
    /** @type {TurnManifest} */
    const m = {
        id,
        timestamp: ts.toISOString(),
        prompt,
        provider,
        model,
        scope,
        files: [],
        status: 'applied-in-progress',
        kind,
    };
    if (sourceTurnId) m.sourceTurnId = sourceTurnId;
    return m;
}

/**
 * Test-only fallback for environments lacking `crypto.randomUUID`. Not used
 * in the production runtime (Node 19+ / Chromium browsers all support it).
 * Kept minimal and intentionally non-cryptographic.
 */
function fallbackUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        // eslint-disable-next-line no-bitwise
        const r = (Date.now() + Math.floor(Math.random() * 16)) % 16;
        // eslint-disable-next-line no-bitwise
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Append a file entry to a manifest. Returns a NEW manifest object; the
 * input is not mutated. (Immutable-update style mirrors how core's project
 * model is patched — keeps the data flow predictable for downstream
 * consumers.)
 *
 * @param {TurnManifest} manifest
 * @param {FileEntry} entry
 * @returns {TurnManifest}
 */
export function addFileEntry(manifest, entry) {
    return { ...manifest, files: [...manifest.files, entry] };
}

/**
 * Replace an existing file entry (matched by path) — used by the Worker
 * pipeline to set `sha256` (post-turn content hash) after the write
 * completes, while preserving the `snapshotKey` set at capture time.
 *
 * @param {TurnManifest} manifest
 * @param {string} path
 * @param {Partial<FileEntry>} patch
 * @returns {TurnManifest}
 */
export function updateFileEntry(manifest, path, patch) {
    const files = manifest.files.map((f) => (f.path === path ? { ...f, ...patch } : f));
    return { ...manifest, files };
}

/**
 * Finalize a manifest's status. Validates the status is in the allowed
 * enum; throws `SnapshotError({code: 'INVALID_STATUS'})` otherwise.
 *
 * @param {TurnManifest} manifest
 * @param {{ status: string }} args
 * @returns {TurnManifest}
 */
export function finalizeManifest(manifest, { status }) {
    if (!ALLOWED_STATUSES.includes(status)) {
        throw new SnapshotError({
            code: 'INVALID_STATUS',
            message: `status '${status}' is not in the allowed enum: ${ALLOWED_STATUSES.join(', ')}`,
        });
    }
    return { ...manifest, status };
}

/**
 * Validate manifest shape — defensive read for corrupted on-disk files.
 *
 * @param {unknown} m
 * @returns {asserts m is TurnManifest}
 */
function assertWellFormed(m) {
    if (!m || typeof m !== 'object') {
        throw new SnapshotError({
            code: 'MALFORMED_MANIFEST',
            message: 'manifest must be an object',
        });
    }
    const obj = /** @type {Record<string, unknown>} */ (m);
    for (const k of ['id', 'timestamp', 'prompt', 'provider', 'model', 'status']) {
        if (typeof obj[k] !== 'string') {
            throw new SnapshotError({
                code: 'MALFORMED_MANIFEST',
                message: `manifest.${k} must be a string; got ${typeof obj[k]}`,
            });
        }
    }
    if (!ALLOWED_STATUSES.includes(/** @type {string} */ (obj.status))) {
        throw new SnapshotError({
            code: 'MALFORMED_MANIFEST',
            message: `manifest.status '${obj.status}' is not in the allowed enum`,
        });
    }
    if (!Array.isArray(obj.files)) {
        throw new SnapshotError({
            code: 'MALFORMED_MANIFEST',
            message: 'manifest.files must be an array',
        });
    }
    if (obj.kind !== undefined && !ALLOWED_KINDS.includes(/** @type {string} */ (obj.kind))) {
        throw new SnapshotError({
            code: 'MALFORMED_MANIFEST',
            message: `manifest.kind '${obj.kind}' is not in the allowed enum`,
        });
    }
}

/**
 * Write a manifest via the sandbox. Uses Lerret's canonical JSON form
 * (two-space indent, trailing newline) — rewriting the same manifest twice
 * produces byte-identical output.
 *
 * @param {{ sandbox: import('./types.js').Sandbox, manifest: TurnManifest }} args
 * @returns {Promise<void>}
 */
export async function writeManifest({ sandbox, manifest }) {
    await sandbox.writeFile(manifestPath(manifest.id), serializeJson(manifest));
}

/**
 * Read a manifest by turn id. Reads via the unwrapped `fs` (sandbox reads
 * are equivalent but the unwrapped fs is the more common pattern for
 * non-mutating ops downstream).
 *
 * @param {{ projectRoot: string, fs: import('./types.js').FilesystemAccess, turnId: string }} args
 * @returns {Promise<TurnManifest>}
 */
export async function readManifest({ projectRoot, fs, turnId }) {
    const path = absoluteManifestPath(projectRoot, turnId);
    let raw;
    try {
        raw = await fs.readFile(path);
    } catch (err) {
        throw new SnapshotError({
            code: 'MANIFEST_NOT_FOUND',
            message: `manifest for turn '${turnId}' not found at ${path}`,
            details: { cause: err instanceof Error ? err.message : String(err) },
        });
    }
    let parsed;
    try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch (err) {
        throw new SnapshotError({
            code: 'MALFORMED_MANIFEST',
            message: `manifest at ${path} is not valid JSON`,
            details: { cause: err instanceof Error ? err.message : String(err) },
        });
    }
    assertWellFormed(parsed);
    return /** @type {TurnManifest} */ (parsed);
}

/**
 * List all manifests sorted by timestamp ascending (oldest first). Skips
 * directory entries whose name does not match the `<uuid>.json` pattern.
 *
 * @param {{ projectRoot: string, fs: import('./types.js').FilesystemAccess }} args
 * @returns {Promise<Array<TurnManifest>>}
 */
export async function listManifests({ projectRoot, fs }) {
    let entries;
    try {
        entries = await fs.readDir(absoluteManifestsDir(projectRoot));
    } catch {
        // History directory may not exist yet on a brand-new project — that's fine.
        return [];
    }
    const manifests = [];
    for (const entry of entries) {
        if (!entry.name || !entry.name.endsWith('.json')) continue;
        const turnId = entry.name.slice(0, -'.json'.length);
        try {
            const m = await readManifest({ projectRoot, fs, turnId });
            manifests.push(m);
        } catch {
            // Skip malformed or unreadable manifests rather than failing the
            // whole listing — observability: the cleanup pass will log
            // these, but listing should not throw on partial corruption.
        }
    }
    manifests.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return manifests;
}

/**
 * Mutate ONLY the `status` field of an existing manifest on disk. Reads,
 * patches, writes via the sandbox. The `files[]` array and other fields are
 * preserved byte-exact except for serialization-format normalization.
 *
 * @param {{
 *   projectRoot: string,
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   turnId: string,
 *   status: string,
 * }} args
 * @returns {Promise<TurnManifest>}
 */
export async function updateManifestStatus({ projectRoot, fs, sandbox, turnId, status }) {
    const m = await readManifest({ projectRoot, fs, turnId });
    const next = finalizeManifest(m, { status });
    await writeManifest({ sandbox, manifest: next });
    return next;
}

// Internal exports for testing only — re-exporting the constants lets tests
// branch on the enums without re-declaring them.
export const _internal = { ALLOWED_STATUSES, ALLOWED_KINDS, serializeJson };
