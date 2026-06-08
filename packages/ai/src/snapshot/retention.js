// Retention policy + cleanup pass.
//
// Bounded growth invariant: keep AT MOST 100 turns OR 50 MB of blobs,
// whichever bound is hit first; oldest-first eviction; orphan-blob deletion
// in the same pass.
//
// Cleanup is synchronous, called by the orchestrator (Story 8.3) AFTER the
// turn's manifest finalizes. No background timer, no Web Worker — the call
// blocks until the on-disk state satisfies the retention invariants.

import {
    manifestPath,
    BLOBS_DIR,
    absoluteBlobsDir,
    absoluteConfigFile,
} from './layout.js';
import { listManifests } from './manifest.js';

export const DEFAULT_CONFIG = Object.freeze({
    maxTurns: 100,
    maxBlobsBytes: 50 * 1024 * 1024, // 50 MB
});

/**
 * Read `history-config.json` if present; merge with defaults. Malformed
 * config logs a warning and falls back to defaults — the cleanup pass
 * must succeed even when the project's config file is corrupt.
 *
 * @param {{ fs: import('./types.js').FilesystemAccess }} args
 * @returns {Promise<{ maxTurns: number, maxBlobsBytes: number }>}
 */
export async function loadConfig({ projectRoot, fs }) {
    let raw;
    try {
        raw = await fs.readFile(absoluteConfigFile(projectRoot));
    } catch {
        return { ...DEFAULT_CONFIG };
    }
    let parsed;
    try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
        console.warn(
            '[lerret-ai] snapshot history-config.json is not valid JSON — using defaults',
        );
        return { ...DEFAULT_CONFIG };
    }
    return {
        maxTurns:
            typeof parsed.maxTurns === 'number' && parsed.maxTurns > 0
                ? parsed.maxTurns
                : DEFAULT_CONFIG.maxTurns,
        maxBlobsBytes:
            typeof parsed.maxBlobsBytes === 'number' && parsed.maxBlobsBytes > 0
                ? parsed.maxBlobsBytes
                : DEFAULT_CONFIG.maxBlobsBytes,
    };
}

/**
 * Sum the byte-size of every file under `.lerret/.state/history/blobs/`.
 * Uses the v1 `FilesystemAccess.readDir` which returns `DirEntry` objects
 * with `kind` and `path` — for byte-size we additionally read each file.
 *
 * This is `O(N)` where N is the number of blobs; acceptable since cleanup
 * runs once per turn and blob counts are bounded by the retention rule.
 *
 * @param {{ fs: import('./types.js').FilesystemAccess }} args
 * @returns {Promise<number>}
 */
export async function computeBlobsBytes({ projectRoot, fs }) {
    const blobsDir = absoluteBlobsDir(projectRoot);
    let entries;
    try {
        entries = await fs.readDir(blobsDir);
    } catch {
        return 0;
    }
    let total = 0;
    for (const entry of entries) {
        if (!entry.name) continue;
        try {
            const content = await fs.readFile(`${blobsDir}/${entry.name}`, {
                encoding: 'binary',
            });
            total += content instanceof Uint8Array ? content.byteLength : content.length;
        } catch {
            // Skip unreadable entries — cleanup must not crash on transient
            // FS errors.
        }
    }
    return total;
}

/**
 * Run the cleanup pass: evict oldest turns until under both caps, then
 * delete orphan blobs (blobs no retained manifest references).
 *
 * Hard invariant: NEVER delete a blob that is still referenced by any
 * retained manifest's `snapshotKey` or `files[i].sha256`. Such a deletion
 * would silently corrupt redo / revert.
 *
 * @param {{
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   config?: { maxTurns?: number, maxBlobsBytes?: number },
 * }} args
 * @returns {Promise<{ evictedTurns: number, reclaimedBytes: number, deletedBlobs: number }>}
 */
export async function runCleanup({ projectRoot, fs, sandbox, config }) {
    const effective = {
        ...DEFAULT_CONFIG,
        ...(config ?? (await loadConfig({ projectRoot, fs }))),
    };

    let manifests = await listManifests({ projectRoot, fs });
    let evictedTurns = 0;

    // Step 1: count-bounded eviction (oldest first). Only 'turn'-kind
    // manifests count toward the limit — revert/redo are bookkeeping
    // entries the user did not "spend" a turn on.
    const turnManifests = () => manifests.filter((m) => (m.kind ?? 'turn') === 'turn');
    while (turnManifests().length > effective.maxTurns) {
        const oldest = turnManifests()[0];
        if (!oldest) break;
        await sandbox.deleteFile(manifestPath(oldest.id));
        manifests = manifests.filter((m) => m.id !== oldest.id);
        evictedTurns += 1;
    }

    // Step 2: size-bounded eviction. Recompute blob size after each
    // eviction (a removed manifest may release a chain of referenced
    // blobs that the orphan-deletion step below picks up).
    let blobsBytes = await computeBlobsBytes({ projectRoot, fs });
    while (
        blobsBytes > effective.maxBlobsBytes &&
        turnManifests().length > 0
    ) {
        const oldest = turnManifests()[0];
        if (!oldest) break;
        await sandbox.deleteFile(manifestPath(oldest.id));
        manifests = manifests.filter((m) => m.id !== oldest.id);
        evictedTurns += 1;
        blobsBytes = await computeBlobsBytes({ projectRoot, fs });
    }

    // Step 3: orphan-blob deletion. Build the set of all blob keys still
    // referenced by remaining manifests, then iterate blobs/ and delete
    // anything not in the set.
    const referenced = new Set();
    for (const m of manifests) {
        for (const f of m.files) {
            if (f.snapshotKey) referenced.add(f.snapshotKey);
            if (f.sha256) referenced.add(f.sha256);
        }
    }

    let deletedBlobs = 0;
    let reclaimedBytes = 0;
    const blobsDir = absoluteBlobsDir(projectRoot);
    let blobEntries;
    try {
        blobEntries = await fs.readDir(blobsDir);
    } catch {
        blobEntries = [];
    }
    for (const entry of blobEntries) {
        if (!entry.name) continue;
        if (referenced.has(entry.name)) continue;
        // Orphan — measure size, then delete.
        let size = 0;
        try {
            const content = await fs.readFile(`${blobsDir}/${entry.name}`, {
                encoding: 'binary',
            });
            size = content instanceof Uint8Array ? content.byteLength : content.length;
        } catch {
            // Skip; size stays 0.
        }
        try {
            // sandbox.deleteFile expects a project-relative path; use the
            // pre-existing relative form (BLOBS_DIR + name).
            await sandbox.deleteFile(`${BLOBS_DIR}/${entry.name}`);
            deletedBlobs += 1;
            reclaimedBytes += size;
        } catch {
            // Sandbox rejection on a blob path inside .lerret/ would be a
            // bug; surface it as a log line but do not crash cleanup.
            console.warn(
                `[lerret-ai] snapshot cleanup — could not delete blob '${entry.name}'`,
            );
        }
    }

    // Observability log — no user content, just counts.
    console.info(
        `[lerret-ai] snapshot cleanup — evicted ${evictedTurns} turn(s), reclaimed ${reclaimedBytes} bytes (${deletedBlobs} blobs)`,
    );

    return { evictedTurns, reclaimedBytes, deletedBlobs };
}
