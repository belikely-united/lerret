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
