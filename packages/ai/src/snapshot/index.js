// Public re-exports for the snapshot subsystem. Consumed by Story 8.3's
// orchestrator via `await import('@lerret/ai')` then `ai.snapshot.X`.
//
// This is the ONLY entry point that external callers (the orchestrator,
// future revert-timeline UI) should reach for. Internal-only constants
// (e.g. _internal helpers in manifest.js) are not re-exported.

export {
    createManifest,
    addFileEntry,
    updateFileEntry,
    finalizeManifest,
    writeManifest,
    readManifest,
    listManifests,
    updateManifestStatus,
} from './manifest.js';

export {
    computeSha256,
    captureBeforeImage,
    capturePostImage,
    isAlreadyCapturedInTurn,
} from './store.js';

export { revertFile, revertTurn, revertToTurn, redoTurn } from './revert.js';

// Convenience re-export for the revert-timeline UI (Story 8.5, UX-delta §4.5).
// The revert API routes every write through a Story 8.4 sandbox; the
// orchestrator builds its own (run-turn.js imports `createSandbox` from
// '@lerret/core'), but the studio panel reaches @lerret/ai ONLY via the
// dynamic-import boundary (`getAi()`), so the SAME helper is surfaced here as
// `ai.snapshot.createSandbox` — the panel never needs its own @lerret/core
// import path to construct one.
export { createSandbox } from '@lerret/core';

export {
    DEFAULT_CONFIG,
    loadConfig,
    computeBlobsBytes,
    runCleanup,
} from './retention.js';

export {
    HISTORY_DIR,
    MANIFESTS_DIR,
    BLOBS_DIR,
    CONFIG_FILE,
    manifestPath,
    blobPath,
    absoluteManifestPath,
    absoluteBlobPath,
    absoluteManifestsDir,
    absoluteBlobsDir,
    absoluteConfigFile,
    ensureHistoryDirs,
} from './layout.js';

export { SnapshotError } from './errors.js';
