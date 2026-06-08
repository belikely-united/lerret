// Revert API — four async functions that route through Story 8.4's sandbox:
//
//   revertFile     — restore a single file to its pre-turn content
//   revertTurn     — restore every file the turn touched (one-shot pass)
//   revertToTurn   — step back to BEFORE a given turn (reverts that turn
//                    and every newer turn, in reverse chronological order)
//   redoTurn       — re-apply a reverted turn from its post-turn blobs
//
// Every write routes through the sandbox; the typed `SandboxViolationError`
// from Story 8.4 propagates unchanged if a manifest's path is malformed.
// Every revert appends a NEW manifest entry of kind `'revert'` or `'redo'`
// referencing the source turn id. The original manifest's `files[]` array
// is preserved byte-exact — only the `status` field flips.

import { absoluteBlobPath } from './layout.js';
import {
    createManifest,
    finalizeManifest,
    listManifests,
    readManifest,
    updateManifestStatus,
    writeManifest,
} from './manifest.js';
import { SnapshotError } from './errors.js';

/**
 * Restore a single file to its pre-turn content. Used by the per-file
 * `Restore` action in the revert timeline panel (UX-delta §4.5).
 *
 * @param {{
 *   projectRoot: string,
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   turnId: string,
 *   filePath: string,
 * }} args
 * @returns {Promise<void>}
 */
export async function revertFile({ projectRoot, fs, sandbox, turnId, filePath }) {
    const manifest = await readManifest({ projectRoot, fs, turnId });
    const entry = manifest.files.find((f) => f.path === filePath);
    if (!entry) {
        throw new SnapshotError({
            code: 'FILE_NOT_IN_TURN',
            message: `file '${filePath}' is not part of turn '${turnId}'`,
        });
    }
    await restoreEntry({ projectRoot, fs, sandbox, entry });

    // Append a single-file revert manifest. This preserves the audit trail
    // ("user reverted just this file from turn X") and gives the revert
    // timeline UI a row to render.
    const revertManifest = createManifest({
        prompt: `revertFile ${filePath} (from turn ${turnId})`,
        provider: manifest.provider,
        model: manifest.model,
        scope: { type: 'selection', selectionLabel: filePath },
        kind: 'revert',
        sourceTurnId: turnId,
    });
    revertManifest.files = [entry];
    revertManifest.status = 'applied';
    await writeManifest({ sandbox, manifest: revertManifest });

    // Mark the source turn as partially-reverted by flipping status. The
    // schema's discrete enum does not distinguish "partially reverted" from
    // "fully reverted"; the timeline UI surfaces it from the file-level
    // revert manifests, not from the source-turn status flip.
    await updateManifestStatus({ projectRoot, fs, sandbox, turnId, status: 'reverted' });
}

/**
 * Restore EVERY file the turn touched. The inverse of an applied turn.
 *
 * Iterates `manifest.files` in REVERSE order (last-write-first heuristic
 * for related-path edge cases — e.g., if a turn renamed A→B by deleting A
 * and creating B, reversing the create first reduces the chance of an
 * intermediate inconsistent state).
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   turnId: string,
 * }} args
 * @returns {Promise<void>}
 */
export async function revertTurn({ projectRoot, fs, sandbox, turnId }) {
    const manifest = await readManifest({ projectRoot, fs, turnId });
    // Reverse copy — never mutate the original `files[]` array.
    const reversed = [...manifest.files].reverse();
    for (const entry of reversed) {
        await restoreEntry({ projectRoot, fs, sandbox, entry });
    }
    // Append ONE consolidated revert manifest at the end (kind: 'revert',
    // sourceTurnId, files = cloned from source).
    const revertManifest = createManifest({
        prompt: `revertTurn (from turn ${turnId})`,
        provider: manifest.provider,
        model: manifest.model,
        scope: manifest.scope,
        kind: 'revert',
        sourceTurnId: turnId,
    });
    // Clone the file list — the consolidated revert references the same
    // set of paths the source turn touched.
    revertManifest.files = manifest.files.map((f) => ({ ...f }));
    revertManifest.status = 'applied';
    await writeManifest({ sandbox, manifest: revertManifest });

    // Flip the source manifest's status.
    await updateManifestStatus({ projectRoot, fs, sandbox, turnId, status: 'reverted' });
}

/**
 * Step back to BEFORE the given turn. Reverts the given turn AND every
 * turn newer than it, in REVERSE chronological order (most-recent first).
 * Idempotent across already-reverted turns — those flip to `'reverted'`
 * (no-op on status) but their files are still rewound to be safe.
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   turnId: string,
 * }} args
 * @returns {Promise<void>}
 */
export async function revertToTurn({ projectRoot, fs, sandbox, turnId }) {
    const target = await readManifest({ projectRoot, fs, turnId });
    const all = await listManifests({ projectRoot, fs });
    // Only consider 'turn'-kind manifests for revert — revert/redo
    // manifests themselves are not turns to step over.
    const toRevert = all
        .filter((m) => (m.kind ?? 'turn') === 'turn' && m.timestamp >= target.timestamp)
        // listManifests sorts ascending; we want most-recent first.
        .reverse();
    for (const m of toRevert) {
        await revertTurn({ projectRoot, fs, sandbox, turnId: m.id });
    }
}

/**
 * Re-apply a reverted turn. Reads the source manifest, iterates `files[]`
 * in FORWARD order, and for each entry writes the POST-turn content from
 * the content-addressed blob keyed by `entry.sha256`.
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   turnId: string,
 * }} args
 * @returns {Promise<void>}
 */
export async function redoTurn({ projectRoot, fs, sandbox, turnId }) {
    const manifest = await readManifest({ projectRoot, fs, turnId });
    if (manifest.status !== 'reverted') {
        // Only reverted turns are eligible to redo. Other statuses
        // (applied / error / stopped-mid-turn) have nothing meaningful to
        // redo from.
        throw new SnapshotError({
            code: 'NOT_REVERTED',
            message: `redoTurn requires a reverted source turn; turn '${turnId}' has status '${manifest.status}'`,
        });
    }
    for (const entry of manifest.files) {
        await reapplyEntry({ projectRoot, fs, sandbox, entry });
    }
    const redoManifest = createManifest({
        prompt: `redoTurn (replaying turn ${turnId})`,
        provider: manifest.provider,
        model: manifest.model,
        scope: manifest.scope,
        kind: 'redo',
        sourceTurnId: turnId,
    });
    redoManifest.files = manifest.files.map((f) => ({ ...f }));
    redoManifest.status = 'applied';
    await writeManifest({ sandbox, manifest: redoManifest });

    // The source turn flips back to applied — it has been "redone".
    await updateManifestStatus({ projectRoot, fs, sandbox, turnId, status: 'applied' });
}

// ─── internal helpers ──────────────────────────────────────────────────────

/**
 * Restore a single file entry to its pre-turn state.
 *  - op:'create' → file did not exist pre-turn; delete it
 *  - op:'edit'   → write the snapshotKey blob back
 *  - op:'delete' → write the snapshotKey blob back (file existed pre-turn)
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   entry: import('./manifest.js').FileEntry,
 * }} args
 */
async function restoreEntry({ projectRoot, fs, sandbox, entry }) {
    const { path, op, snapshotKey, encoding = 'utf-8' } = entry;
    if (op === 'create') {
        // File did not exist pre-turn; revert by deleting it.
        await sandbox.deleteFile(path);
        return;
    }
    // op === 'edit' || op === 'delete' — restore the before-image.
    if (!snapshotKey) {
        throw new SnapshotError({
            code: 'BLOB_MISSING',
            message: `file '${path}' has op '${op}' but no snapshotKey; cannot restore`,
        });
    }
    let content;
    try {
        content = await fs.readFile(absoluteBlobPath(projectRoot, snapshotKey), { encoding });
    } catch (err) {
        throw new SnapshotError({
            code: 'BLOB_MISSING',
            message: `snapshot blob '${snapshotKey}' for '${path}' is missing`,
            details: { cause: err instanceof Error ? err.message : String(err) },
        });
    }
    await sandbox.writeFile(path, content, { encoding });
}

/**
 * Re-apply a single file entry's POST-turn state — the inverse of
 * `restoreEntry`. Used by `redoTurn`.
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   entry: import('./manifest.js').FileEntry,
 * }} args
 */
async function reapplyEntry({ projectRoot, fs, sandbox, entry }) {
    const { path, op, sha256, encoding = 'utf-8' } = entry;
    if (op === 'delete') {
        // Turn deleted this file; redo deletes it again.
        await sandbox.deleteFile(path);
        return;
    }
    // op === 'create' || op === 'edit' — write the post-turn content.
    if (!sha256) {
        throw new SnapshotError({
            code: 'BLOB_MISSING',
            message: `file '${path}' has op '${op}' but no sha256 (post-turn key); cannot redo`,
        });
    }
    let content;
    try {
        content = await fs.readFile(absoluteBlobPath(projectRoot, sha256), { encoding });
    } catch (err) {
        throw new SnapshotError({
            code: 'BLOB_MISSING',
            message: `post-turn blob '${sha256}' for '${path}' is missing`,
            details: { cause: err instanceof Error ? err.message : String(err) },
        });
    }
    // Suppress the unused-param lint — `finalizeManifest` is kept around
    // for forward-compat use by orchestrator code that might want it.
    void finalizeManifest;
    await sandbox.writeFile(path, content, { encoding });
}
