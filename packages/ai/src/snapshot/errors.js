// Snapshot subsystem error class.
//
// Surfaces snapshot-internal invariant violations: missing manifest, missing
// blob, malformed manifest, file-not-in-turn (caller invoked revertFile
// against a path the source turn never touched), etc. Sandbox-violation
// errors are NOT translated — `SandboxViolationError` from `@lerret/core`
// propagates unchanged so consumers can branch on the structured `code`.

/**
 * Snapshot-store invariant violation. Distinct from `SandboxViolationError`
 * (Story 8.4) — that one means "bad path"; this one means "bad state".
 *
 * @property {string} name  Always `'SnapshotError'`
 * @property {string} code  Stable identifier, e.g. `'MANIFEST_NOT_FOUND'`,
 *                          `'FILE_NOT_IN_TURN'`, `'BLOB_MISSING'`,
 *                          `'MALFORMED_MANIFEST'`, `'INVALID_STATUS'`
 */
export class SnapshotError extends Error {
    /**
     * @param {{ code: string, message: string, details?: Record<string, unknown> }} init
     */
    constructor({ code, message, details }) {
        super(message);
        this.name = 'SnapshotError';
        this.code = code;
        if (details) this.details = details;
    }
}
