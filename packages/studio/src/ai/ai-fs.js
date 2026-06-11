/**
 * ai-fs.js — the CLI-mode FilesystemAccess bridge for the AI orchestrator.
 *
 * The orchestrator (`runTurn` in @lerret/ai) needs a real filesystem in the
 * browser: the snapshot store reads pre-edit content and manifests, probes
 * blob existence, bootstraps `.lerret/.state/history/`, and the Worker writes
 * the turn's files. In CLI mode the actual filesystem lives on the Node side
 * of `@lerret/cli dev`, behind the dev server's `__lerret/*` endpoints. This
 * adapter composes the write-client wrappers (read-file / write / delete /
 * list-dir / exists / mkdir) into the v1 `FilesystemAccess` shape
 * (`@lerret/core`'s contract: readDir, readFile, writeFile, watch,
 * deleteFile, mkdir, exists + capabilities) so `createSandbox({ projectRoot,
 * fs })` accepts it unchanged.
 *
 * ── Path discipline ─────────────────────────────────────────────────────────
 * The orchestrator speaks ABSOLUTE POSIX paths (`<projectRoot>/.lerret/...`).
 * The CLI endpoints also take absolute LerretPaths and gate every one against
 * the project's `.lerret/` tree server-side — so the adapter passes paths
 * through verbatim after one cheap client-side check: anything not under
 * `projectRoot + '/'` throws an ENOENT-shaped error before any request is
 * made. The server stays the authority on `.lerret/`-tree containment.
 *
 * ── Mode scope ──────────────────────────────────────────────────────────────
 * This is the CLI-mode bridge ONLY. Hosted mode (the File System Access API
 * backend) needs its own adapter and is a follow-up — the dock cluster omits
 * `fs` / `projectRoot` outside CLI mode, and the orchestrator reports the
 * missing filesystem as a calm turn error there.
 *
 * ── Boundary note ───────────────────────────────────────────────────────────
 * This file must NOT import '@lerret/ai' (statically or otherwise) — it is
 * plain plumbing handed TO the orchestrator via runTurn's options, and the
 * no-static-imports boundary check scans this folder.
 */

import {
    deleteProjectFile,
    existsProjectPath,
    listProjectDir,
    mkdirProject,
    readProjectFile,
    writeProjectFile,
} from '../runtime/write-client.js';

/**
 * Build an ENOENT-shaped error (`err.code === 'ENOENT'`) — the shape the
 * orchestrator's snapshot store branches on for "file is absent".
 *
 * @param {string} message
 * @param {string} [path]
 * @returns {Error & { code: 'ENOENT' }}
 */
function enoent(message, path) {
    const err = new Error(`ENOENT: ${message}${path ? ` — ${path}` : ''}`);
    // @ts-expect-error augmenting the Error with the Node-style code field
    err.code = 'ENOENT';
    return /** @type {Error & { code: 'ENOENT' }} */ (err);
}

/**
 * Encode raw bytes to base64 without Node's Buffer (browser-safe). Chunked so
 * `String.fromCharCode` never sees an argument list large enough to overflow
 * the call stack.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Decode a base64 string to raw bytes without Node's Buffer (browser-safe).
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Create the CLI-mode FilesystemAccess adapter for the AI orchestrator.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 *   The project ROOT — the absolute POSIX folder that CONTAINS `.lerret/`
 *   (NOT the `.lerret/` directory itself). Matches what
 *   `createSandbox({ projectRoot })` expects.
 * @returns {import('@lerret/core').FilesystemAccess}
 */
export function createCliAiFs({ projectRoot } = {}) {
    if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) {
        throw new Error(
            `createCliAiFs: projectRoot must be a POSIX-absolute path; got '${projectRoot}'`,
        );
    }
    const root = projectRoot.replace(/\/+$/, '');

    /**
     * Cheap client-side containment check: every path the orchestrator hands
     * us must live under the project root. Outside paths get an ENOENT-shaped
     * throw BEFORE any request — the server's `.lerret/`-tree gate stays the
     * real authority for everything that passes.
     *
     * @param {string} absPath
     * @returns {string}
     */
    function ensureInside(absPath) {
        if (typeof absPath !== 'string' || !absPath.startsWith(root + '/')) {
            throw enoent('path is outside the project root', String(absPath));
        }
        return absPath;
    }

    return {
        capabilities: { canWrite: true, canWatch: false, canReveal: false },

        /**
         * List a directory's immediate children in the DirEntry shape the
         * snapshot store consumes (`{ name, path, kind, isFile, isDirectory }`,
         * `path` absolute). A missing directory resolves to `[]` — the store
         * lists `.lerret/.state/history/manifests/` before the first turn
         * ever creates it.
         */
        async readDir(dirPath) {
            const p = ensureInside(dirPath).replace(/\/+$/, '');
            const res = await listProjectDir(p);
            if (!res.ok) {
                throw new Error(`readDir failed: ${res.error || 'unknown error'}`);
            }
            return res.entries.map((e) => ({
                name: e.name,
                path: `${p}/${e.name}`,
                kind: e.isDirectory ? 'directory' : 'file',
                isFile: e.isFile === true,
                isDirectory: e.isDirectory === true,
            }));
        },

        /**
         * Read a file. UTF-8 by default; `{ encoding: 'binary' }` rides the
         * endpoint's base64 lane and returns a `Uint8Array`. An absent file
         * throws ENOENT-shaped (matching the Node backend).
         */
        async readFile(filePath, opts = {}) {
            const p = ensureInside(filePath);
            if (opts.encoding === 'binary') {
                const res = await readProjectFile(p, { encoding: 'base64' });
                if (!res.ok) {
                    if (res.missing) throw enoent('no such file', p);
                    throw new Error(`readFile failed: ${res.error || 'unknown error'}`);
                }
                return base64ToBytes(res.base64 || '');
            }
            const res = await readProjectFile(p);
            if (!res.ok) {
                if (res.missing) throw enoent('no such file', p);
                throw new Error(`readFile failed: ${res.error || 'unknown error'}`);
            }
            return res.content ?? '';
        },

        /**
         * Write a file (atomic server-side, parents auto-created). A string
         * takes the UTF-8 text lane; a `Uint8Array` is base64-encoded onto
         * the endpoint's binary lane — the content's TYPE decides, so blob
         * writes round-trip byte-exact regardless of the encoding option.
         */
        async writeFile(filePath, content, _opts = {}) {
            const p = ensureInside(filePath);
            const res =
                content instanceof Uint8Array
                    ? await writeProjectFile(p, bytesToBase64(content), { encoding: 'base64' })
                    : await writeProjectFile(p, content);
            if (!res.ok) {
                throw new Error(`writeFile failed: ${res.error || 'unknown error'}`);
            }
        },

        /** Delete a file (a missing target is a server-side no-op success). */
        async deleteFile(filePath) {
            const p = ensureInside(filePath);
            const res = await deleteProjectFile(p);
            if (!res.ok) {
                throw new Error(`deleteFile failed: ${res.error || 'unknown error'}`);
            }
        },

        /** Recursively create a directory (no-op when present). */
        async mkdir(dirPath) {
            const p = ensureInside(dirPath);
            const res = await mkdirProject(p);
            if (!res.ok) {
                throw new Error(`mkdir failed: ${res.error || 'unknown error'}`);
            }
        },

        /**
         * Existence probe. A failed probe (network blip) reports `false` —
         * the snapshot store's blob dedup then re-writes the blob, which is
         * harmless; throwing would fail the whole turn over a probe.
         */
        async exists(targetPath) {
            const p = ensureInside(targetPath);
            const res = await existsProjectPath(p);
            return res.ok === true && res.exists === true;
        },

        /**
         * Watch is part of the v1 contract surface but intentionally inert
         * here (`canWatch: false`) — live updates already ride the CLI's
         * chokidar → `lerret:change` HMR channel; the orchestrator never
         * watches.
         */
        watch() {
            return { close() {} };
        },
    };
}
