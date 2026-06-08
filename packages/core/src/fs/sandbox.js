// `core/fs/sandbox.js` — path-sandboxing wrapper for AI-driven writes.
//
// Wraps a `FilesystemAccess` backend with synchronous path validation: every
// target path must resolve to under `projectRoot + '/.lerret/'` after
// normalization, must not contain unresolved `..` segments, and must not
// carry a null byte. Violations throw `SandboxViolationError` BEFORE any
// backend call.
//
// Lives in `core` (not `@lerret/ai`) because it operates exclusively on the
// abstract `FilesystemAccess` interface — no DOM, no Node built-ins, no
// `@lerret/ai` imports. Preserves the `core`-purity invariant.
//
// Write atomicity is delegated to the underlying `FilesystemAccess` backend.
// NFR18 (safe AI writes) inherits NFR9 (safe writes) unchanged — the sandbox
// adds path validation, NOT new write-safety machinery.
//
// SYMLINK POLICY: the sandbox does NOT call `realpath` itself (no `node:fs`,
// no FS Access API). Symlink defense lives in the Node backend's
// `realpathOrSelf` helper (see `packages/cli/src/fs/node-backend.js`).
// Story 8.5's retention pass verifies the backend rejects writes whose
// resolved path leaves `projectRoot`.

import { assertFilesystemContract } from './filesystem.js';

/**
 * Typed error thrown by sandbox methods when a path fails validation. Carries
 * a structured `code` so the orchestrator (Story 8.3) can branch on the
 * failure mode without parsing message strings.
 *
 * @property {string} name             Always `'SandboxViolationError'`
 * @property {SandboxViolationCode} code
 *   One of `'NOT_A_STRING' | 'EMPTY_PATH' | 'NULL_BYTE' |
 *   'TRAVERSAL_DETECTED' | 'OUTSIDE_PROJECT'`.
 * @property {unknown} attemptedPath   The original input as received
 * @property {string | undefined} normalizedPath
 *   The normalization result, present when normalization succeeded enough to
 *   produce one — `undefined` for `NOT_A_STRING` / `EMPTY_PATH` / `NULL_BYTE`.
 */
export class SandboxViolationError extends Error {
    /**
     * @param {{
     *   code: 'NOT_A_STRING' | 'EMPTY_PATH' | 'NULL_BYTE' | 'TRAVERSAL_DETECTED' | 'OUTSIDE_PROJECT',
     *   attemptedPath: unknown,
     *   normalizedPath?: string,
     *   message: string,
     * }} init
     */
    constructor({ code, attemptedPath, normalizedPath, message }) {
        super(message);
        this.name = 'SandboxViolationError';
        this.code = code;
        this.attemptedPath = attemptedPath;
        this.normalizedPath = normalizedPath;
    }
}

/**
 * Normalize a POSIX-style path: resolve `.` and `..` segments without
 * touching the filesystem (no realpath, no stat). Throws
 * `SandboxViolationError` on null bytes, empty input, non-string input, or
 * traversal that walks above the filesystem root.
 *
 * Pure string manipulation — does NOT import `node:path`. The
 * `FilesystemAccess` contract speaks POSIX paths at its boundary; this
 * normalizer follows suit.
 *
 * @param {string} projectRoot  Absolute POSIX path, e.g. `/Users/me/proj`
 * @param {unknown} input       Caller-supplied path
 * @returns {string} Normalized absolute POSIX path (no trailing slash)
 */
function normalizePath(projectRoot, input) {
    if (typeof input !== 'string') {
        throw new SandboxViolationError({
            code: 'NOT_A_STRING',
            attemptedPath: input,
            message: `path must be a string; got ${input === null ? 'null' : typeof input}`,
        });
    }
    if (input.length === 0 || input.trim().length === 0) {
        throw new SandboxViolationError({
            code: 'EMPTY_PATH',
            attemptedPath: input,
            message: 'path must be a non-empty string',
        });
    }
    if (input.includes('\0')) {
        throw new SandboxViolationError({
            code: 'NULL_BYTE',
            attemptedPath: input,
            message: 'path contains a null byte',
        });
    }

    // If relative, prefix projectRoot.
    const absolute = input.startsWith('/') ? input : projectRoot + '/' + input;

    // Split, filter empty + single-dot segments, walk collapsing `..`.
    const segments = absolute.split('/').filter((s) => s.length > 0 && s !== '.');
    /** @type {string[]} */
    const stack = [];
    for (const seg of segments) {
        if (seg === '..') {
            if (stack.length === 0) {
                // Walking above filesystem root.
                throw new SandboxViolationError({
                    code: 'TRAVERSAL_DETECTED',
                    attemptedPath: input,
                    normalizedPath: '/',
                    message: `path '${input}' attempts to traverse above filesystem root`,
                });
            }
            stack.pop();
        } else {
            stack.push(seg);
        }
    }

    return '/' + stack.join('/');
}

/**
 * Assert that a normalized path is inside `projectRoot + '/.lerret'`.
 *
 * The slash-prefix boundary check (`+ '/'`) is critical — without it, a path
 * like `projectRoot + '/.lerret-evil/x'` would slip through a naive
 * `startsWith(projectRoot + '/.lerret')` check.
 *
 * @param {string} projectRoot
 * @param {string} normalized
 * @param {unknown} attemptedPath  Original input (for error reporting)
 * @param {boolean} allowDirEquality
 *   When `true`, the `.lerret` directory itself is allowed (used by `mkdir`
 *   per AC-6); when `false`, only paths under `.lerret/` are allowed.
 */
function validateInsideLerret(projectRoot, normalized, attemptedPath, allowDirEquality) {
    const lerretDir = projectRoot + '/.lerret';
    const lerretDirWithSlash = lerretDir + '/';
    const equalsDir = normalized === lerretDir;
    const underDir = normalized.startsWith(lerretDirWithSlash);

    const isAllowed = allowDirEquality ? equalsDir || underDir : underDir;
    if (!isAllowed) {
        throw new SandboxViolationError({
            code: 'OUTSIDE_PROJECT',
            attemptedPath,
            normalizedPath: normalized,
            message:
                `path '${attemptedPath}' (normalized: '${normalized}') is outside the project sandbox; ` +
                `expected to be under '${lerretDirWithSlash}'`,
        });
    }
}

/**
 * @typedef {{
 *   writeFile: (path: string, data: string | Uint8Array, options?: object) => Promise<void>,
 *   deleteFile: (path: string) => Promise<void>,
 *   mkdir: (path: string) => Promise<void>,
 *   readFile: (path: string, options?: object) => Promise<string | Uint8Array>,
 *   exists: (path: string) => Promise<boolean>,
 * }} Sandbox
 */

/**
 * Create a sandbox over a `FilesystemAccess` backend. Every write / delete /
 * mkdir / read call is path-validated SYNCHRONOUSLY before the backend is
 * touched. Violations throw `SandboxViolationError`.
 *
 * The factory itself throws plain `Error` (not `SandboxViolationError`) when
 * its own arguments are malformed — those are programming errors in the
 * orchestrator, not runtime sandbox events that the Worker should catch.
 *
 * @param {{ projectRoot: string, fs: import('./filesystem.js').FilesystemAccess }} args
 * @returns {Sandbox}
 */
export function createSandbox({ projectRoot, fs } = {}) {
    if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
        throw new Error('createSandbox: projectRoot must be a non-empty string');
    }
    if (!projectRoot.startsWith('/')) {
        throw new Error(
            `createSandbox: projectRoot must be POSIX-absolute (start with '/'); got '${projectRoot}'`,
        );
    }
    // Strip any trailing slash(es). Without this, a caller passing
    // `/Users/me/proj/` would produce `projectRoot + '/.lerret'` =
    // `/Users/me/proj//.lerret`, and the boundary check (which compares
    // against the literal `'/.lerret/'`) would reject every valid path as
    // OUTSIDE_PROJECT.
    let normalizedRoot = projectRoot;
    while (normalizedRoot.length > 1 && normalizedRoot.endsWith('/')) {
        normalizedRoot = normalizedRoot.slice(0, -1);
    }
    // Filesystem-root (`/`) is rejected: the boundary `projectRoot + '/.lerret'`
    // would degenerate to `//.lerret` (double slash) and the validator's
    // string-prefix check would reject every otherwise-valid path. Real
    // callers always pass a project directory, never `/`.
    if (normalizedRoot === '/' || normalizedRoot.length === 0) {
        throw new Error(
            `createSandbox: projectRoot must be a project directory, not the filesystem root; got '${projectRoot}'`,
        );
    }
    projectRoot = normalizedRoot;

    assertFilesystemContract(fs, 'createSandbox.fs');

    return {
        writeFile: async (path, data, options) => {
            const normalized = normalizePath(projectRoot, path);
            validateInsideLerret(projectRoot, normalized, path, /* allowDirEquality */ false);
            return fs.writeFile(normalized, data, options);
        },
        deleteFile: async (path) => {
            const normalized = normalizePath(projectRoot, path);
            validateInsideLerret(projectRoot, normalized, path, /* allowDirEquality */ false);
            return fs.deleteFile(normalized);
        },
        mkdir: async (path) => {
            const normalized = normalizePath(projectRoot, path);
            validateInsideLerret(projectRoot, normalized, path, /* allowDirEquality */ true);
            return fs.mkdir(normalized);
        },
        readFile: async (path, options) => {
            const normalized = normalizePath(projectRoot, path);
            validateInsideLerret(projectRoot, normalized, path, /* allowDirEquality */ false);
            return fs.readFile(normalized, options);
        },
        exists: async (path) => {
            const normalized = normalizePath(projectRoot, path);
            validateInsideLerret(projectRoot, normalized, path, /* allowDirEquality */ true);
            return fs.exists(normalized);
        },
    };
}
