// Tests for `core/fs/sandbox.js` — path-sandboxing wrapper for AI-driven
// writes (Story 8.4). Security-adjacent code; the test surface is
// exhaustiveness-over-elegance per AC-15.
//
// The sandbox's contract is: every write/delete/mkdir/read path is normalized
// and validated SYNCHRONOUSLY before the underlying `FilesystemAccess`
// backend is touched. These tests verify both the validation logic and the
// "never called the backend on rejection" invariant — the latter is what
// makes the sandbox useful as a defense layer.

import { describe, it, expect, vi } from 'vitest';

import { createSandbox, SandboxViolationError } from './sandbox.js';

const PROJECT_ROOT = '/Users/me/project';

/**
 * Build a fresh `vi.fn()`-backed `FilesystemAccess` per test. Backed by
 * resolved promises so the sandbox's `await` succeeds in happy-path tests;
 * `mock.calls.length` lets each test assert "backend NOT called" on rejection.
 *
 * Includes the Epic 8 extensions (deleteFile/mkdir/exists) added to the
 * FilesystemAccess contract via Story 8.5's follow-up.
 */
function makeMockFs() {
    return {
        readDir: vi.fn().mockResolvedValue([]),
        readFile: vi.fn().mockResolvedValue(''),
        writeFile: vi.fn().mockResolvedValue(undefined),
        watch: vi.fn().mockReturnValue({ close: vi.fn() }),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        removeDir: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        capabilities: { canWrite: true, canWatch: true, canReveal: false },
    };
}

/**
 * Build a fresh sandbox for tests. Reuses the mock fs constructor; returns
 * both so individual tests can assert against the backend mock.
 */
function makeSandbox(overrides = {}) {
    const fs = makeMockFs();
    const sandbox = createSandbox({ projectRoot: PROJECT_ROOT, fs, ...overrides });
    return { sandbox, fs };
}

describe('search — read-only full-text inventory (Epic 9 follow-up, 2026-06-14)', () => {
    const R = PROJECT_ROOT;
    function searchFs(dirs, files) {
        const fs = makeMockFs();
        fs.readDir.mockImplementation(async (abs) => {
            if (Object.prototype.hasOwnProperty.call(dirs, abs)) return dirs[abs];
            throw new Error(`ENOENT: ${abs}`);
        });
        fs.readFile.mockImplementation(async (abs) => {
            if (Object.prototype.hasOwnProperty.call(files, abs)) return files[abs];
            throw new Error(`ENOENT: ${abs}`);
        });
        return fs;
    }

    it('finds case-insensitive substring matches across the tree (path:line: text); skips binary files', async () => {
        const fs = searchFs(
            {
                [`${R}/.lerret`]: [
                    { name: 'social', isDirectory: true },
                    { name: 'a.jsx', isDirectory: false, size: 40 },
                    { name: 'logo.png', isDirectory: false, size: 999 },
                ],
                [`${R}/.lerret/social`]: [{ name: 'card.jsx', isDirectory: false, size: 30 }],
            },
            {
                [`${R}/.lerret/a.jsx`]: 'top\nGLIMS.IO brand\nbottom',
                [`${R}/.lerret/social/card.jsx`]: 'visit glims.io now\nfooter',
                [`${R}/.lerret/logo.png`]: 'binary-glims.io-not-text',
            },
        );
        const sandbox = createSandbox({ projectRoot: R, fs });
        const hits = await sandbox.search('glims.io');
        expect(hits.map((h) => `${h.path}:${h.line}`).sort()).toEqual([
            '.lerret/a.jsx:2',
            '.lerret/social/card.jsx:1',
        ]);
        expect(hits.find((h) => h.path.endsWith('a.jsx')).text).toBe('GLIMS.IO brand');
        // The .png is not a text extension — never read, never matched.
        expect(fs.readFile).not.toHaveBeenCalledWith(`${R}/.lerret/logo.png`);
    });

    it('honors a folder scope and never descends into the .state sidecar', async () => {
        const fs = searchFs(
            {
                [`${R}/.lerret`]: [
                    { name: 'social', isDirectory: true },
                    { name: '.state', isDirectory: true },
                    { name: 'a.jsx', isDirectory: false, size: 10 },
                ],
                [`${R}/.lerret/social`]: [{ name: 'card.jsx', isDirectory: false, size: 10 }],
                [`${R}/.lerret/.state`]: [{ name: 'snap.jsx', isDirectory: false, size: 10 }],
            },
            {
                [`${R}/.lerret/a.jsx`]: 'glims.io',
                [`${R}/.lerret/social/card.jsx`]: 'glims.io',
                [`${R}/.lerret/.state/snap.jsx`]: 'glims.io',
            },
        );
        const sandbox = createSandbox({ projectRoot: R, fs });
        const scoped = await sandbox.search('glims.io', '.lerret/social');
        expect(scoped.map((h) => h.path)).toEqual(['.lerret/social/card.jsx']);
        const all = await sandbox.search('glims.io');
        expect(all.map((h) => h.path).sort()).toEqual(['.lerret/a.jsx', '.lerret/social/card.jsx']);
        expect(fs.readFile).not.toHaveBeenCalledWith(`${R}/.lerret/.state/snap.jsx`);
    });

    it('returns [] for an empty query without touching the backend', async () => {
        const { sandbox, fs } = makeSandbox();
        expect(await sandbox.search('')).toEqual([]);
        expect(fs.readDir).not.toHaveBeenCalled();
    });
});

describe('Happy path — paths inside .lerret/', () => {
    it('row 1: write to .lerret/social/twitter-card.jsx', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/social/twitter-card.jsx', '<jsx/>');
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
        expect(fs.writeFile).toHaveBeenCalledWith(
            `${PROJECT_ROOT}/.lerret/social/twitter-card.jsx`,
            '<jsx/>',
            undefined,
        );
    });

    it('row 2: write to .lerret/.state/history/manifests/abc-123.json (Story 8.5 path)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/.state/history/manifests/abc-123.json', '{}');
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('row 3: write to .lerret/_brand/logo.svg (reserved underscore folder)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/_brand/logo.svg', '<svg/>');
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('row 4: write to .lerret/_design-system.md (FR53 reserved file)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/_design-system.md', '# brand');
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('row 5: read from .lerret/_context.md', async () => {
        const { sandbox, fs } = makeSandbox();
        fs.readFile.mockResolvedValue('# context');
        const out = await sandbox.readFile('.lerret/_context.md');
        expect(out).toBe('# context');
        expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('row 6: mkdir of .lerret/social/x delegates to backend', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.mkdir('.lerret/social/x');
        expect(fs.mkdir).toHaveBeenCalledTimes(1);
        expect(fs.mkdir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/social/x`);
    });

    it('row 7: mkdir of .lerret itself is allowed (per AC-6 equality exception)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.mkdir('.lerret');
        expect(fs.mkdir).toHaveBeenCalledTimes(1);
        expect(fs.mkdir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret`);
    });

    it('row 8: deleteFile of .lerret/old.jsx delegates to backend', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.deleteFile('.lerret/old.jsx');
        expect(fs.deleteFile).toHaveBeenCalledTimes(1);
        expect(fs.deleteFile).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/old.jsx`);
    });

    it('row 9: exists(".lerret/foo") returns the backend result', async () => {
        const { sandbox, fs } = makeSandbox();
        fs.exists.mockResolvedValue(true);
        const out = await sandbox.exists('.lerret/foo');
        expect(out).toBe(true);
        expect(fs.exists).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/foo`);
    });

    it('write under .lerret/ from a deeply-nested relative path normalizes correctly (row 17 sibling)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/foo/../bar.jsx', 'hi');
        expect(fs.writeFile).toHaveBeenCalledWith(
            `${PROJECT_ROOT}/.lerret/bar.jsx`,
            'hi',
            undefined,
        );
    });
});

describe('Outside-project rejections', () => {
    it('row 10: absolute path /etc/passwd → OUTSIDE_PROJECT', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('/etc/passwd', 'evil')).rejects.toMatchObject({
            name: 'SandboxViolationError',
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 11: absolute path /tmp/escape.jsx → OUTSIDE_PROJECT', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('/tmp/escape.jsx', 'evil')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 12: inside project but outside .lerret/ — e.g. projectRoot/package.json', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('package.json', '{}')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        await expect(
            sandbox.writeFile(`${PROJECT_ROOT}/package.json`, '{}'),
        ).rejects.toMatchObject({ code: 'OUTSIDE_PROJECT' });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 13: substring-prefix that is not actually under .lerret/ (.lerret-evil/x)', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('.lerret-evil/x.jsx', 'evil')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        await expect(
            sandbox.writeFile(`${PROJECT_ROOT}/.lerret-evil/x.jsx`, 'evil'),
        ).rejects.toMatchObject({ code: 'OUTSIDE_PROJECT' });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

describe('Traversal rejections', () => {
    it('row 14: relative ./../../etc/passwd → OUTSIDE_PROJECT after normalization', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('./../../etc/passwd', 'x')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 15: ./.lerret/../../escape.txt normalizes to outside-project', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('./.lerret/../../escape.txt', 'x')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 16: trailing .. — ./.lerret/foo/.. normalizes to .lerret (allowed for mkdir, rejected for writeFile)', async () => {
        const { sandbox, fs } = makeSandbox();
        // For writeFile, equality with .lerret directory is NOT allowed:
        await expect(sandbox.writeFile('./.lerret/foo/..', 'x')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
        // For mkdir, the same normalization is allowed — the path resolves
        // to projectRoot/.lerret (the directory itself), which mkdir permits
        // per AC-6's equality exception. The backend's idempotent mkdir is
        // then called with the normalized absolute path.
        await sandbox.mkdir('./.lerret/foo/..');
        expect(fs.mkdir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret`);
    });

    it('row 17: mid-path .. — .lerret/foo/../bar.jsx normalizes inside (allowed)', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.writeFile('.lerret/foo/../bar.jsx', 'hi');
        expect(fs.writeFile).toHaveBeenCalledWith(
            `${PROJECT_ROOT}/.lerret/bar.jsx`,
            'hi',
            undefined,
        );
    });

    it('walking above the filesystem root throws TRAVERSAL_DETECTED', async () => {
        const { sandbox, fs } = makeSandbox();
        // Absolute path with too many `..` walks above `/`:
        await expect(sandbox.writeFile('/../../../etc/passwd', 'x')).rejects.toMatchObject({
            code: 'TRAVERSAL_DETECTED',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

describe('Null-byte rejections', () => {
    it('row 18: a single null byte → NULL_BYTE', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('\0', 'x')).rejects.toMatchObject({
            code: 'NULL_BYTE',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 19: embedded null byte — .lerret/foo\\0bar.jsx → NULL_BYTE', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('.lerret/foo\0bar.jsx', 'x')).rejects.toMatchObject({
            code: 'NULL_BYTE',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

describe('Bad-input rejections', () => {
    it('row 20: empty string "" → EMPTY_PATH', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('', 'x')).rejects.toMatchObject({
            code: 'EMPTY_PATH',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 20b: whitespace-only "   " → EMPTY_PATH', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('   ', 'x')).rejects.toMatchObject({
            code: 'EMPTY_PATH',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 21: null → NOT_A_STRING', async () => {
        const { sandbox, fs } = makeSandbox();
        // @ts-expect-error — intentionally bad input
        await expect(sandbox.writeFile(null, 'x')).rejects.toMatchObject({
            code: 'NOT_A_STRING',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 21b: undefined → NOT_A_STRING', async () => {
        const { sandbox, fs } = makeSandbox();
        // @ts-expect-error — intentionally bad input
        await expect(sandbox.writeFile(undefined, 'x')).rejects.toMatchObject({
            code: 'NOT_A_STRING',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 21c: number → NOT_A_STRING', async () => {
        const { sandbox, fs } = makeSandbox();
        // @ts-expect-error — intentionally bad input
        await expect(sandbox.writeFile(42, 'x')).rejects.toMatchObject({
            code: 'NOT_A_STRING',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('row 21d: plain object → NOT_A_STRING', async () => {
        const { sandbox, fs } = makeSandbox();
        // @ts-expect-error — intentionally bad input
        await expect(sandbox.writeFile({ a: 1 }, 'x')).rejects.toMatchObject({
            code: 'NOT_A_STRING',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

describe('Case sensitivity', () => {
    it('row 22: .LERRET/foo.jsx → OUTSIDE_PROJECT (sandbox is case-sensitive)', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('.LERRET/foo.jsx', 'x')).rejects.toMatchObject({
            code: 'OUTSIDE_PROJECT',
        });
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});

describe('Sandbox does not call backend on rejection (defense-in-depth)', () => {
    it('row 23a: OUTSIDE_PROJECT rejection — backend.writeFile NOT called', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('/etc/passwd', 'x')).rejects.toBeInstanceOf(
            SandboxViolationError,
        );
        expect(fs.writeFile.mock.calls.length).toBe(0);
    });

    it('row 23b: TRAVERSAL rejection — backend.writeFile NOT called', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('/../../../etc/passwd', 'x')).rejects.toBeInstanceOf(
            SandboxViolationError,
        );
        expect(fs.writeFile.mock.calls.length).toBe(0);
    });

    it('row 23c: NULL_BYTE rejection — backend.writeFile NOT called', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.writeFile('.lerret/foo\0', 'x')).rejects.toBeInstanceOf(
            SandboxViolationError,
        );
        expect(fs.writeFile.mock.calls.length).toBe(0);
    });

    it('readFile rejection also leaves backend.readFile unchanged', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.readFile('/etc/passwd')).rejects.toBeInstanceOf(
            SandboxViolationError,
        );
        expect(fs.readFile.mock.calls.length).toBe(0);
    });
});

describe('SandboxViolationError shape', () => {
    it('row 24: violation instance is both SandboxViolationError and Error', async () => {
        const { sandbox } = makeSandbox();
        try {
            await sandbox.writeFile('/etc/passwd', 'x');
            throw new Error('expected SandboxViolationError to be thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(SandboxViolationError);
            expect(err).toBeInstanceOf(Error);
            expect(err.name).toBe('SandboxViolationError');
        }
    });

    it('row 25: OUTSIDE_PROJECT error carries attemptedPath + normalizedPath', async () => {
        const { sandbox } = makeSandbox();
        try {
            await sandbox.writeFile('/etc/passwd', 'x');
            throw new Error('expected throw');
        } catch (err) {
            expect(err.code).toBe('OUTSIDE_PROJECT');
            expect(err.attemptedPath).toBe('/etc/passwd');
            expect(err.normalizedPath).toBe('/etc/passwd');
            expect(typeof err.message).toBe('string');
            expect(err.message).toContain('/etc/passwd');
        }
    });

    it('NOT_A_STRING / EMPTY_PATH / NULL_BYTE errors omit normalizedPath', async () => {
        const { sandbox } = makeSandbox();
        try {
            // @ts-expect-error
            await sandbox.writeFile(null, 'x');
        } catch (err) {
            expect(err.code).toBe('NOT_A_STRING');
            expect(err.normalizedPath).toBeUndefined();
        }
        try {
            await sandbox.writeFile('', 'x');
        } catch (err) {
            expect(err.code).toBe('EMPTY_PATH');
            expect(err.normalizedPath).toBeUndefined();
        }
        try {
            await sandbox.writeFile('\0', 'x');
        } catch (err) {
            expect(err.code).toBe('NULL_BYTE');
            expect(err.normalizedPath).toBeUndefined();
        }
    });
});

describe('createSandbox factory validation', () => {
    it('row 26: contract violation — fs is non-conforming', () => {
        // assertFilesystemContract throws a regular Error (not a
        // SandboxViolationError); the factory propagates it as-is.
        expect(() =>
            createSandbox({ projectRoot: PROJECT_ROOT, fs: /** @type {any} */ ({}) }),
        ).toThrow(/does not satisfy the FilesystemAccess contract/);
    });

    it('row 27: empty projectRoot', () => {
        expect(() =>
            createSandbox({ projectRoot: '', fs: makeMockFs() }),
        ).toThrow(/projectRoot must be a non-empty string/);
    });

    it('row 28: non-POSIX-absolute projectRoot', () => {
        expect(() =>
            createSandbox({ projectRoot: 'relative/path', fs: makeMockFs() }),
        ).toThrow(/POSIX-absolute/);
    });

    it('missing args object → throws', () => {
        // @ts-expect-error
        expect(() => createSandbox()).toThrow();
    });

    it('non-string projectRoot → throws', () => {
        // @ts-expect-error
        expect(() => createSandbox({ projectRoot: 42, fs: makeMockFs() })).toThrow(
            /projectRoot must be a non-empty string/,
        );
    });

    it('trailing slash in projectRoot is stripped — boundary check still works', async () => {
        // Self-review finding: without stripping, `/Users/me/proj/` would
        // produce a `/Users/me/proj//.lerret/` boundary, and the validator
        // would reject every otherwise-valid path. This test confirms the
        // strip-trailing-slash fix.
        const fs = makeMockFs();
        const sandbox = createSandbox({ projectRoot: `${PROJECT_ROOT}/`, fs });
        await sandbox.writeFile('.lerret/foo.jsx', 'x');
        expect(fs.writeFile).toHaveBeenCalledWith(
            `${PROJECT_ROOT}/.lerret/foo.jsx`,
            'x',
            undefined,
        );
    });

    it('multiple trailing slashes stripped', async () => {
        const fs = makeMockFs();
        const sandbox = createSandbox({ projectRoot: `${PROJECT_ROOT}///`, fs });
        await sandbox.writeFile('.lerret/foo.jsx', 'x');
        expect(fs.writeFile).toHaveBeenCalledWith(
            `${PROJECT_ROOT}/.lerret/foo.jsx`,
            'x',
            undefined,
        );
    });

    it('filesystem-root projectRoot "/" is rejected (not a real use case)', () => {
        expect(() => createSandbox({ projectRoot: '/', fs: makeMockFs() })).toThrow(
            /must be a project directory, not the filesystem root/,
        );
    });

    it('trailing-slash-only projectRoot "//" is also rejected', () => {
        // Stripping reduces "//" → "/", which the next check rejects.
        expect(() => createSandbox({ projectRoot: '//', fs: makeMockFs() })).toThrow(
            /must be a project directory, not the filesystem root/,
        );
    });
});

// ─── listDir — the Epic 9 discovery surface (Story 9.0) ───────────────────────

describe('listDir — validated, non-mutating discovery', () => {
    it('lists .lerret/ children name-sorted with kind (and size when the backend provides it)', async () => {
        const { sandbox, fs } = makeSandbox();
        fs.readDir.mockResolvedValue([
            { name: 'social', path: `${PROJECT_ROOT}/.lerret/social`, kind: 'directory', isFile: false, isDirectory: true },
            { name: 'banner.jsx', path: `${PROJECT_ROOT}/.lerret/banner.jsx`, kind: 'file', isFile: true, isDirectory: false, size: 412 },
            { name: '_design-system.md', path: `${PROJECT_ROOT}/.lerret/_design-system.md`, kind: 'file', isFile: true, isDirectory: false },
        ]);
        const entries = await sandbox.listDir('.lerret/');
        expect(fs.readDir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret`);
        expect(entries).toEqual([
            { name: '_design-system.md', kind: 'file' },
            { name: 'banner.jsx', kind: 'file', size: 412 },
            { name: 'social', kind: 'dir' },
        ]);
    });

    it('accepts the .lerret root itself and nested dirs; rejects traversal and outside paths', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.listDir('.lerret/social');
        expect(fs.readDir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/social`);
        await expect(sandbox.listDir('.lerret/../src')).rejects.toMatchObject({
            name: 'SandboxViolationError',
        });
        await expect(sandbox.listDir('src')).rejects.toMatchObject({
            name: 'SandboxViolationError',
        });
        // The two rejections never reached the backend.
        expect(fs.readDir).toHaveBeenCalledTimes(1);
    });

    it('.lerret/.state and anything under it are OPAQUE — [] without touching the backend', async () => {
        const { sandbox, fs } = makeSandbox();
        expect(await sandbox.listDir('.lerret/.state')).toEqual([]);
        expect(await sandbox.listDir('.lerret/.state/history/manifests')).toEqual([]);
        expect(fs.readDir).not.toHaveBeenCalled();
        // But .state APPEARS as an entry when listing .lerret/ (backend truth passes through).
        fs.readDir.mockResolvedValue([
            { name: '.state', path: `${PROJECT_ROOT}/.lerret/.state`, kind: 'directory', isFile: false, isDirectory: true },
        ]);
        expect(await sandbox.listDir('.lerret')).toEqual([{ name: '.state', kind: 'dir' }]);
    });
});

// ─── removeDir — empty-only rmdir (Epic 9 follow-up, delete_dir) ──────────────

describe('removeDir — validated, empty-only directory removal', () => {
    it('removeDir of .lerret/social/old delegates to the backend', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.removeDir('.lerret/social/old');
        expect(fs.removeDir).toHaveBeenCalledTimes(1);
        expect(fs.removeDir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/social/old`);
    });

    it('removeDir of a nested page folder normalizes a relative path before delegating', async () => {
        const { sandbox, fs } = makeSandbox();
        await sandbox.removeDir('.lerret/kit/sub/..');
        // `.lerret/kit/sub/..` normalizes to `.lerret/kit` (allowed — a page).
        expect(fs.removeDir).toHaveBeenCalledWith(`${PROJECT_ROOT}/.lerret/kit`);
    });

    it('REFUSES the .lerret/ root itself — removing it would erase the project', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.removeDir('.lerret')).rejects.toMatchObject({
            name: 'SandboxViolationError',
            code: 'OUTSIDE_PROJECT',
        });
        await expect(sandbox.removeDir('.lerret/')).rejects.toMatchObject({
            name: 'SandboxViolationError',
        });
        // Neither attempt reached the backend.
        expect(fs.removeDir).not.toHaveBeenCalled();
    });

    it('rejects paths OUTSIDE .lerret/ and traversal escapes without touching the backend', async () => {
        const { sandbox, fs } = makeSandbox();
        await expect(sandbox.removeDir('/etc')).rejects.toMatchObject({
            name: 'SandboxViolationError',
            code: 'OUTSIDE_PROJECT',
        });
        await expect(sandbox.removeDir('.lerret/../src')).rejects.toMatchObject({
            name: 'SandboxViolationError',
        });
        await expect(sandbox.removeDir('src')).rejects.toMatchObject({
            name: 'SandboxViolationError',
        });
        expect(fs.removeDir).not.toHaveBeenCalled();
    });

    it('propagates a backend rejection (e.g. ENOTEMPTY) — the empty-only guarantee', async () => {
        const { sandbox, fs } = makeSandbox();
        const enotempty = Object.assign(new Error('ENOTEMPTY: directory not empty'), {
            code: 'ENOTEMPTY',
        });
        fs.removeDir.mockRejectedValueOnce(enotempty);
        await expect(sandbox.removeDir('.lerret/social')).rejects.toMatchObject({
            code: 'ENOTEMPTY',
        });
    });
});
