// Test-only in-memory FilesystemAccess + sandbox stand-ins.
//
// Excluded from publish via the `!src/**/__test-helpers__/**` glob in
// packages/ai/package.json. Used by the four snapshot test files.
//
// Mirrors the v1 `FilesystemAccess` contract (readDir, readFile, writeFile,
// watch, capabilities) plus Story 8.4's sandbox interface (writeFile,
// deleteFile, mkdir, exists, readFile). The sandbox here is a full-featured
// stand-in for the production `core/fs/sandbox.js`, whose contract was
// extended (Batch 1, the "V1 contract extension") to implement
// deleteFile/mkdir/exists for real — so this stand-in now mirrors a live
// contract, not a stubbed one. Story 8.5's tests verify the snapshot LOGIC
// against it; Story 8.3's orchestrator integration test exercises the same
// shape end-to-end.

/**
 * Create a minimal in-memory FilesystemAccess.
 *
 * Files are stored in a Map keyed by absolute POSIX path. The encoding
 * the writer supplied is recorded so a binary-write read-back returns the
 * same Uint8Array unchanged.
 */
export function createInMemoryFs() {
    /** @type {Map<string, { content: string | Uint8Array, encoding: 'utf-8'|'binary' }>} */
    const files = new Map();

    function pathParent(p) {
        const idx = p.lastIndexOf('/');
        return idx <= 0 ? '/' : p.slice(0, idx);
    }
    function pathBase(p) {
        const idx = p.lastIndexOf('/');
        return idx < 0 ? p : p.slice(idx + 1);
    }

    return {
        capabilities: { canWrite: true, canWatch: false, canReveal: false },
        async readDir(dirPath) {
            const entries = [];
            const seen = new Set();
            for (const filePath of files.keys()) {
                if (filePath === dirPath) continue;
                if (!filePath.startsWith(dirPath + '/')) continue;
                const rest = filePath.slice(dirPath.length + 1);
                const top = rest.split('/')[0];
                if (seen.has(top)) continue;
                seen.add(top);
                const isDirectory = rest.includes('/');
                entries.push({
                    name: top,
                    path: `${dirPath}/${top}`,
                    kind: isDirectory ? 'directory' : 'file',
                    isFile: !isDirectory,
                    isDirectory,
                });
            }
            return entries;
        },
        async readFile(path, opts = {}) {
            const encoding = opts.encoding ?? 'utf-8';
            const f = files.get(path);
            if (!f) {
                const err = new Error(`ENOENT: ${path}`);
                err.code = 'ENOENT';
                throw err;
            }
            if (encoding === 'binary') {
                if (f.content instanceof Uint8Array) return f.content;
                return new TextEncoder().encode(f.content);
            }
            if (typeof f.content === 'string') return f.content;
            return new TextDecoder().decode(f.content);
        },
        async writeFile(path, content, opts = {}) {
            const encoding = opts.encoding ?? 'utf-8';
            files.set(path, { content, encoding });
        },
        watch() {
            return { close() {} };
        },
        // V1 contract extensions added in the Story 8.5 follow-up:
        async deleteFile(path) {
            files.delete(path);
        },
        async mkdir(_dirPath) {
            // No-op for in-memory FS — directories implicit in file paths.
            void _dirPath;
        },
        async exists(path) {
            if (files.has(path)) return true;
            for (const key of files.keys()) {
                if (key.startsWith(path + '/')) return true;
            }
            return false;
        },
        // Inspection hooks for tests:
        _files: files,
        _pathParent: pathParent,
        _pathBase: pathBase,
    };
}

/**
 * Create a fully-functional sandbox over an in-memory FS. Validates the
 * `.lerret/` prefix the same way the production `core/fs/sandbox.js` does and
 * implements deleteFile / mkdir / exists for real — matching the live v1
 * contract after the Batch 1 extension (the production sandbox no longer
 * throws "not yet in v1 contract" for these).
 *
 * This lets Story 8.5's snapshot tests AND Story 8.3's orchestrator
 * integration test drive the same sandbox shape end-to-end against an
 * in-memory backend.
 */
export function createMockSandbox(fs, projectRoot) {
    if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) {
        throw new Error(`createMockSandbox: bad projectRoot '${projectRoot}'`);
    }
    let normalizedRoot = projectRoot;
    while (normalizedRoot.length > 1 && normalizedRoot.endsWith('/')) {
        normalizedRoot = normalizedRoot.slice(0, -1);
    }

    function validate(relPath, { allowDirEquality = false } = {}) {
        if (typeof relPath !== 'string' || relPath.length === 0) {
            const err = new Error('SandboxViolation: bad path');
            err.name = 'SandboxViolationError';
            err.code = 'BAD_PATH';
            throw err;
        }
        const absolute = relPath.startsWith('/')
            ? relPath
            : `${normalizedRoot}/${relPath}`;
        // Lazy normalization — collapse `.`/`..` segments.
        const segs = absolute.split('/').filter((s) => s.length > 0 && s !== '.');
        const stack = [];
        for (const seg of segs) {
            if (seg === '..') {
                if (stack.length === 0) {
                    const err = new Error('SandboxViolation: traversal');
                    err.name = 'SandboxViolationError';
                    err.code = 'TRAVERSAL_DETECTED';
                    throw err;
                }
                stack.pop();
            } else {
                stack.push(seg);
            }
        }
        const normalized = '/' + stack.join('/');
        const lerretDir = `${normalizedRoot}/.lerret`;
        const equalsDir = normalized === lerretDir;
        const underDir = normalized.startsWith(lerretDir + '/');
        if (allowDirEquality ? !(equalsDir || underDir) : !underDir) {
            const err = new Error(`SandboxViolation: outside project — ${normalized}`);
            err.name = 'SandboxViolationError';
            err.code = 'OUTSIDE_PROJECT';
            throw err;
        }
        return normalized;
    }

    return {
        async writeFile(p, content, opts) {
            const normalized = validate(p);
            await fs.writeFile(normalized, content, opts);
        },
        async deleteFile(p) {
            const normalized = validate(p);
            fs._files.delete(normalized);
        },
        async mkdir(p) {
            const normalized = validate(p, { allowDirEquality: true });
            // No-op for in-memory FS — directories implicit in file paths.
            void normalized;
        },
        async exists(p) {
            const normalized = validate(p, { allowDirEquality: true });
            if (fs._files.has(normalized)) return true;
            // Treat as "directory exists" if any file is under this prefix.
            for (const key of fs._files.keys()) {
                if (key.startsWith(normalized + '/')) return true;
            }
            return false;
        },
        async readFile(p, opts) {
            const normalized = validate(p);
            return fs.readFile(normalized, opts);
        },
    };
}

/**
 * Seed an in-memory FS with an absolute path → content map.
 *
 * @param {ReturnType<typeof createInMemoryFs>} fs
 * @param {Record<string, string | Uint8Array>} files
 */
export function seedFs(fs, files) {
    for (const [path, content] of Object.entries(files)) {
        const encoding = content instanceof Uint8Array ? 'binary' : 'utf-8';
        fs._files.set(path, { content, encoding });
    }
}
