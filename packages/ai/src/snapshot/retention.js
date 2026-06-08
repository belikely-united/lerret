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
            // Always read as binary — `Uint8Array.byteLength` is the true on-
            // disk byte count, whereas a UTF-8 file read as a `string` returns
            // a UTF-16 code-unit count (`.length`) which under-counts the
            // actual bytes for any multi-byte content (e.g. a JSX file with
            // emoji or non-ASCII characters). Reading binary keeps the size
            // accounting truthful regardless of file encoding.
            const content = await fs.readFile(`${blobsDir}/${entry.name}`, {
                encoding: 'binary',
            });
            if (content instanceof Uint8Array) {
                total += content.byteLength;
            } else {
                // Backend ignored our encoding hint and returned a string —
                // fall back to UTF-8 byte count rather than UTF-16 code-units.
                total += new TextEncoder().encode(content).byteLength;
            }
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
    let totalReclaimedBytes = 0;
    let totalDeletedBlobs = 0;
    const blobsDir = absoluteBlobsDir(projectRoot);

    // Only 'turn'-kind manifests count toward the maxTurns limit — revert /
    // redo are bookkeeping entries the user did not "spend" a turn on.
    const turnManifests = () => manifests.filter((m) => (m.kind ?? 'turn') === 'turn');

    // Helper: delete every blob in blobs/ that no remaining manifest still
    // references, and accumulate the reclaimed bytes. Returns the count +
    // bytes for the caller to add to running totals. This is the orphan-
    // delete primitive used by both the size-eviction loop (so eviction
    // actually frees space) and the final cleanup pass below.
    async function deleteOrphans() {
        // Build the live set of referenced blob keys from remaining
        // manifests.
        const referenced = new Set();
        for (const m of manifests) {
            for (const f of m.files) {
                if (f.snapshotKey) referenced.add(f.snapshotKey);
                if (f.sha256) referenced.add(f.sha256);
            }
        }
        let blobEntries;
        try {
            blobEntries = await fs.readDir(blobsDir);
        } catch {
            return { deleted: 0, bytes: 0 };
        }
        let deleted = 0;
        let bytes = 0;
        for (const entry of blobEntries) {
            if (!entry.name) continue;
            if (referenced.has(entry.name)) continue;
            let size = 0;
            try {
                const content = await fs.readFile(`${blobsDir}/${entry.name}`, {
                    encoding: 'binary',
                });
                if (content instanceof Uint8Array) {
                    size = content.byteLength;
                } else {
                    size = new TextEncoder().encode(content).byteLength;
                }
            } catch {
                // Skip; size stays 0.
            }
            try {
                await sandbox.deleteFile(`${BLOBS_DIR}/${entry.name}`);
                deleted += 1;
                bytes += size;
            } catch {
                console.warn(
                    `[lerret-ai] snapshot cleanup — could not delete blob '${entry.name}'`,
                );
            }
        }
        return { deleted, bytes };
    }

    // Step 1: count-bounded eviction. Evict the oldest 'turn' manifest until
    // the remaining count is ≤ maxTurns.
    while (turnManifests().length > effective.maxTurns) {
        const oldest = turnManifests()[0];
        if (!oldest) break;
        await sandbox.deleteFile(manifestPath(oldest.id));
        manifests = manifests.filter((m) => m.id !== oldest.id);
        evictedTurns += 1;
    }

    // Step 2: size-bounded eviction. Each iteration: evict the oldest
    // manifest, immediately delete the blobs it uniquely held (orphans
    // post-eviction), recompute blobsBytes. Without the interleaved orphan
    // delete, the size cap is unreachable because evicting a manifest does
    // not by itself remove its blobs.
    const corruptCount = /** @type {any} */ (manifests)._corruptCount ?? 0;
    if (corruptCount === 0) {
        let blobsBytes = await computeBlobsBytes({ projectRoot, fs });
        while (blobsBytes > effective.maxBlobsBytes && turnManifests().length > 0) {
            const oldest = turnManifests()[0];
            if (!oldest) break;
            await sandbox.deleteFile(manifestPath(oldest.id));
            manifests = manifests.filter((m) => m.id !== oldest.id);
            evictedTurns += 1;
            const { deleted, bytes } = await deleteOrphans();
            totalDeletedBlobs += deleted;
            totalReclaimedBytes += bytes;
            blobsBytes = await computeBlobsBytes({ projectRoot, fs });
        }
    }

    // Step 3: a final orphan-blob deletion pass to clean up any blobs not
    // referenced by the (possibly count-evicted-only) remaining manifests.
    //
    // SAFETY GUARD: if listManifests skipped any malformed manifests
    // (corrupt JSON, schema violation, partial-write crash), we CANNOT
    // safely run orphan deletion — a corrupted manifest's blobs would be
    // wrongly classified as orphans and deleted, violating AC-20's HARD
    // invariant. Skip orphan deletion entirely; the next cleanup pass
    // will retry once the corruption is repaired manually.
    if (corruptCount > 0) {
        console.warn(
            `[lerret-ai] snapshot cleanup — skipping orphan-blob deletion: ` +
                `${corruptCount} manifest(s) were unreadable. Manual repair needed; ` +
                `next cleanup will retry.`,
        );
        console.info(
            `[lerret-ai] snapshot cleanup — evicted ${evictedTurns} turn(s), ` +
                `reclaimed 0 bytes (0 blobs; orphan-delete skipped due to ` +
                `${corruptCount} corrupt manifest(s))`,
        );
        return { evictedTurns, reclaimedBytes: 0, deletedBlobs: 0 };
    }

    const finalOrphan = await deleteOrphans();
    totalDeletedBlobs += finalOrphan.deleted;
    totalReclaimedBytes += finalOrphan.bytes;

    // Observability log — no user content, just counts.
    console.info(
        `[lerret-ai] snapshot cleanup — evicted ${evictedTurns} turn(s), reclaimed ${totalReclaimedBytes} bytes (${totalDeletedBlobs} blobs)`,
    );

    return {
        evictedTurns,
        reclaimedBytes: totalReclaimedBytes,
        deletedBlobs: totalDeletedBlobs,
    };
}
