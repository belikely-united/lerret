// Content-addressed blob store + SHA-256 capture.
//
// The Worker (Story 8.3) calls `captureBeforeImage` exactly once per file
// per turn — the FIRST time it touches the file — to snapshot the pre-edit
// content as a content-addressed blob under `.lerret/.state/history/blobs/`.
// After the write completes, the Worker calls `capturePostImage` to also
// store the post-edit content (keyed by sha256), which lets `redoTurn`
// re-apply a reverted turn byte-exact.
//
// Content-addressing means two turns touching the same file with identical
// pre-edit content produce ONE blob. The retention pass MUST refuse to
// delete a blob still referenced by any retained manifest.

import { blobPath, absoluteBlobPath } from './layout.js';
import { addFileEntry } from './manifest.js';

/**
 * Compute the SHA-256 hex digest of UTF-8 text or raw bytes. Cross-
 * environment (Web Crypto in browsers, the same global in Node 19+).
 *
 * @param {string | Uint8Array} content
 * @returns {Promise<string>} 64-char lowercase hex
 */
export async function computeSha256(content) {
    const bytes =
        typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Capture a file's PRE-edit content as a content-addressed blob.
 *
 * Called by the Worker BEFORE the first mutation of a file in a turn. The
 * caller MUST check `isAlreadyCapturedInTurn(manifest, filePath)` first —
 * the snapshot policy is once-per-(file, turn) per AC-9.
 *
 * For `op: 'create'` (file does not yet exist), no blob is written;
 * `snapshotKey` is set to `null` on the manifest entry.
 *
 * @param {{
 *   projectRoot: string,
 *   fs: import('./types.js').FilesystemAccess,
 *   sandbox: import('./types.js').Sandbox,
 *   manifest: import('./manifest.js').TurnManifest,
 *   filePath: string,
 *   op: 'create' | 'edit' | 'delete',
 *   encoding?: 'utf-8' | 'binary',
 * }} args
 * @returns {Promise<import('./manifest.js').TurnManifest>}
 */
export async function captureBeforeImage({
    projectRoot,
    fs,
    sandbox,
    manifest,
    filePath,
    op,
    encoding = 'utf-8',
}) {
    if (op === 'create') {
        // No pre-edit content exists; record the create op with a null
        // snapshotKey. sha256 (post-turn) is filled in by capturePostImage.
        return addFileEntry(manifest, {
            path: filePath,
            op: 'create',
            snapshotKey: null,
            encoding,
        });
    }

    // op === 'edit' or op === 'delete' — read the current content as the
    // before-image. `filePath` is project-relative; resolve to absolute
    // for the unwrapped FS call.
    const absolute = filePath.startsWith('/') ? filePath : `${projectRoot}/${filePath}`;
    const content = await fs.readFile(absolute, { encoding });
    const sha256 = await computeSha256(content);
    const path = blobPath(sha256);

    // Content-addressed dedup: only write the blob if it does not already
    // exist. This is the cross-turn sharing mechanism — two turns with the
    // same pre-edit content produce one blob.
    const alreadyPresent = await sandbox.exists(path);
    if (!alreadyPresent) {
        await sandbox.writeFile(path, content, { encoding });
    }

    return addFileEntry(manifest, {
        path: filePath,
        op,
        snapshotKey: sha256,
        encoding,
    });
}

/**
 * Capture the POST-edit content as a content-addressed blob and return its
 * sha256. The caller is responsible for setting `fileEntry.sha256` on the
 * manifest via `updateFileEntry` after this resolves.
 *
 * For `op: 'delete'`, the post-image is the empty content — there is no
 * file after the turn — and the caller should set `sha256` to the empty-
 * content digest (which the cleanup pass will treat as orphan-eligible
 * once no manifest references it).
 *
 * @param {{
 *   sandbox: import('./types.js').Sandbox,
 *   content: string | Uint8Array,
 *   encoding?: 'utf-8' | 'binary',
 * }} args
 * @returns {Promise<{ sha256: string }>}
 */
export async function capturePostImage({ sandbox, content, encoding = 'utf-8' }) {
    const sha256 = await computeSha256(content);
    const path = blobPath(sha256);
    const alreadyPresent = await sandbox.exists(path);
    if (!alreadyPresent) {
        await sandbox.writeFile(path, content, { encoding });
    }
    return { sha256 };
}

// `absoluteBlobPath` is re-exported in `./index.js` (via `blobPath`) for
// the revert path's absolute-read needs. Suppress unused-symbol noise.
void absoluteBlobPath;

/**
 * Returns `true` if the manifest already has an entry for this file. The
 * orchestrator calls this before `captureBeforeImage` to enforce the
 * once-per-(file, turn) policy.
 *
 * @param {import('./manifest.js').TurnManifest} manifest
 * @param {string} filePath
 * @returns {boolean}
 */
export function isAlreadyCapturedInTurn(manifest, filePath) {
    return manifest.files.some((f) => f.path === filePath);
}
