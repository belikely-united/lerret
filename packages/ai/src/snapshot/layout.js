// Snapshot store layout — path constants and directory bootstrap.
//
// The `.lerret/.state/history/` sidecar (gitignored by inheritance from the
// v1 `.state/` gitignore handling) holds per-turn snapshot manifests and
// content-addressed before/after-image blobs. Cleanup runs after every turn
// per the retention policy in `./retention.js`.

export const HISTORY_DIR = '.lerret/.state/history';
export const MANIFESTS_DIR = '.lerret/.state/history/manifests';
export const BLOBS_DIR = '.lerret/.state/history/blobs';
export const CONFIG_FILE = '.lerret/.state/history/history-config.json';

/**
 * Idempotent directory bootstrap. Creates `manifests/` and `blobs/` under
 * `.lerret/.state/history/` via the sandbox. Safe to call on every turn —
 * if a directory already exists, the underlying `fs.mkdir` is expected to
 * be a no-op (the v1 backends honor `{ recursive: true }` semantics).
 *
 * NOTE on v1 contract gap: Story 8.4's sandbox currently stubs `mkdir` with
 * an honest "not yet part of v1 contract" error. This helper structures the
 * runtime contract correctly; runtime integration requires the
 * `FilesystemAccess` contract to be extended (deferred follow-up).
 *
 * @param {{ projectRoot: string, sandbox: import('./types.js').Sandbox }} args
 * @returns {Promise<void>}
 */
export async function ensureHistoryDirs({ sandbox }) {
    await sandbox.mkdir(MANIFESTS_DIR);
    await sandbox.mkdir(BLOBS_DIR);
}

/**
 * Compose the project-relative path for a manifest file given a turn id.
 * Used for sandbox calls (sandbox handles its own projectRoot resolution).
 *
 * @param {string} turnId  UUID v4
 * @returns {string} POSIX path relative to projectRoot
 */
export function manifestPath(turnId) {
    return `${MANIFESTS_DIR}/${turnId}.json`;
}

/**
 * Compose the project-relative path for a content-addressed blob.
 *
 * @param {string} sha256  64-char lowercase hex
 * @returns {string} POSIX path relative to projectRoot
 */
export function blobPath(sha256) {
    return `${BLOBS_DIR}/${sha256}`;
}

/**
 * Compose the ABSOLUTE on-disk path for a manifest. Used when reading via
 * the unwrapped `FilesystemAccess` (which speaks absolute paths).
 *
 * @param {string} projectRoot  POSIX-absolute project directory
 * @param {string} turnId
 * @returns {string} Absolute POSIX path
 */
export function absoluteManifestPath(projectRoot, turnId) {
    return `${projectRoot}/${manifestPath(turnId)}`;
}

/**
 * Compose the ABSOLUTE on-disk path for a content-addressed blob.
 *
 * @param {string} projectRoot
 * @param {string} sha256
 * @returns {string}
 */
export function absoluteBlobPath(projectRoot, sha256) {
    return `${projectRoot}/${blobPath(sha256)}`;
}

/**
 * Compose the ABSOLUTE on-disk path for the manifests directory.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function absoluteManifestsDir(projectRoot) {
    return `${projectRoot}/${MANIFESTS_DIR}`;
}

/**
 * Compose the ABSOLUTE on-disk path for the blobs directory.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function absoluteBlobsDir(projectRoot) {
    return `${projectRoot}/${BLOBS_DIR}`;
}

/**
 * Compose the ABSOLUTE on-disk path for the history-config sidecar.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function absoluteConfigFile(projectRoot) {
    return `${projectRoot}/${CONFIG_FILE}`;
}
