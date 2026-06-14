// Tests for the CLI-mode AI FilesystemAccess adapter (ai-fs.js). jsdom.
//
// The write-client module is mocked (vi.mock) so every test asserts the
// adapter's own behavior: absolute-path containment, the utf-8/binary lanes
// (base64 round-trip), the DirEntry mapping, ENOENT shaping for absent files,
// and the graceful-absence contracts the AI snapshot store depends on. The
// real endpoints are covered by the CLI plugin's middleware tests.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { isFilesystemAccess } from '@lerret/core';

vi.mock('../runtime/write-client.js', () => ({
    deleteProjectFile: vi.fn(),
    existsProjectPath: vi.fn(),
    listProjectDir: vi.fn(),
    mkdirProject: vi.fn(),
    readProjectFile: vi.fn(),
    removeDirProject: vi.fn(),
    writeProjectFile: vi.fn(),
}));

import {
    deleteProjectFile,
    existsProjectPath,
    listProjectDir,
    mkdirProject,
    readProjectFile,
    removeDirProject,
    writeProjectFile,
} from '../runtime/write-client.js';
import { createCliAiFs, bytesToBase64, base64ToBytes } from './ai-fs.js';

const ROOT = '/Users/me/my-project';
const LERRET = `${ROOT}/.lerret`;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createCliAiFs — construction + contract shape', () => {
    it('requires a POSIX-absolute projectRoot', () => {
        expect(() => createCliAiFs({})).toThrow(/POSIX-absolute/);
        expect(() => createCliAiFs({ projectRoot: 'relative/path' })).toThrow(/POSIX-absolute/);
    });

    it('satisfies the v1 FilesystemAccess contract (sandbox-constructible)', () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        expect(isFilesystemAccess(fs)).toBe(true);
        expect(fs.capabilities).toEqual({ canWrite: true, canWatch: false, canReveal: false });
    });

    it('watch is an inert handle (canWatch: false)', () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        const handle = fs.watch(`${LERRET}/x`, () => {});
        expect(typeof handle.close).toBe('function');
        expect(() => handle.close()).not.toThrow();
    });
});

describe('createCliAiFs — path containment (ENOENT-shaped)', () => {
    it('rejects paths outside the project root without calling the client', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        for (const bad of ['/etc/passwd', '/Users/me/other/.lerret/x', ROOT]) {
            await expect(fs.readFile(bad)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        await expect(fs.writeFile('/elsewhere/y.jsx', 'x')).rejects.toMatchObject({
            code: 'ENOENT',
        });
        await expect(fs.readDir('/elsewhere')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.deleteFile('/elsewhere/y')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.mkdir('/elsewhere/dir')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.removeDir('/elsewhere/dir')).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.exists('/elsewhere/y')).rejects.toMatchObject({ code: 'ENOENT' });
        expect(readProjectFile).not.toHaveBeenCalled();
        expect(writeProjectFile).not.toHaveBeenCalled();
        expect(listProjectDir).not.toHaveBeenCalled();
        expect(deleteProjectFile).not.toHaveBeenCalled();
        expect(mkdirProject).not.toHaveBeenCalled();
        expect(removeDirProject).not.toHaveBeenCalled();
        expect(existsProjectPath).not.toHaveBeenCalled();
    });

    it('tolerates a trailing slash on projectRoot', async () => {
        readProjectFile.mockResolvedValue({ ok: true, content: 'hi' });
        const fs = createCliAiFs({ projectRoot: `${ROOT}/` });
        await expect(fs.readFile(`${LERRET}/note.md`)).resolves.toBe('hi');
        expect(readProjectFile).toHaveBeenCalledWith(`${LERRET}/note.md`);
    });
});

describe('createCliAiFs — readFile', () => {
    it('reads utf-8 by default, passing the absolute path through', async () => {
        readProjectFile.mockResolvedValue({ ok: true, content: '# hello\n' });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.readFile(`${LERRET}/note.md`)).resolves.toBe('# hello\n');
        expect(readProjectFile).toHaveBeenCalledWith(`${LERRET}/note.md`);
    });

    it('returns a Uint8Array for { encoding: "binary" } via the base64 lane', async () => {
        const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
        readProjectFile.mockResolvedValue({ ok: true, base64: bytesToBase64(bytes) });
        const fs = createCliAiFs({ projectRoot: ROOT });
        const out = await fs.readFile(`${LERRET}/img.png`, { encoding: 'binary' });
        expect(out).toBeInstanceOf(Uint8Array);
        expect(Array.from(out)).toEqual(Array.from(bytes));
        expect(readProjectFile).toHaveBeenCalledWith(`${LERRET}/img.png`, {
            encoding: 'base64',
        });
    });

    it('shapes an absent file as ENOENT (missing: true from the client)', async () => {
        readProjectFile.mockResolvedValue({ ok: false, missing: true, error: 'file not found' });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.readFile(`${LERRET}/gone.md`)).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('throws a plain (non-ENOENT) error on transport failure', async () => {
        readProjectFile.mockResolvedValue({ ok: false, error: 'network error: boom' });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.readFile(`${LERRET}/x.md`)).rejects.toThrow(/network error: boom/);
        await expect(fs.readFile(`${LERRET}/x.md`)).rejects.not.toMatchObject({
            code: 'ENOENT',
        });
    });
});

describe('createCliAiFs — writeFile', () => {
    it('writes a string through the utf-8 text lane', async () => {
        writeProjectFile.mockResolvedValue({ ok: true });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await fs.writeFile(`${LERRET}/page/Card.jsx`, 'export default () => null;');
        expect(writeProjectFile).toHaveBeenCalledWith(
            `${LERRET}/page/Card.jsx`,
            'export default () => null;',
        );
    });

    it('base64-encodes a Uint8Array onto the binary lane (byte-exact round trip)', async () => {
        writeProjectFile.mockResolvedValue({ ok: true });
        const fs = createCliAiFs({ projectRoot: ROOT });
        const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
        await fs.writeFile(`${LERRET}/.state/history/blobs/abc`, bytes, {
            encoding: 'binary',
        });
        const [path, payload, opts] = writeProjectFile.mock.calls[0];
        expect(path).toBe(`${LERRET}/.state/history/blobs/abc`);
        expect(opts).toEqual({ encoding: 'base64' });
        expect(Array.from(base64ToBytes(payload))).toEqual(Array.from(bytes));
    });

    it('throws when the write fails', async () => {
        writeProjectFile.mockResolvedValue({ ok: false, error: 'disk full' });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.writeFile(`${LERRET}/x.md`, 'x')).rejects.toThrow(/disk full/);
    });
});

describe('createCliAiFs — readDir', () => {
    it('maps entries to the DirEntry shape with absolute paths', async () => {
        listProjectDir.mockResolvedValue({
            ok: true,
            entries: [
                { name: 'Card.jsx', isFile: true, isDirectory: false },
                { name: 'group', isFile: false, isDirectory: true },
            ],
        });
        const fs = createCliAiFs({ projectRoot: ROOT });
        const entries = await fs.readDir(`${LERRET}/page`);
        expect(entries).toEqual([
            {
                name: 'Card.jsx',
                path: `${LERRET}/page/Card.jsx`,
                kind: 'file',
                isFile: true,
                isDirectory: false,
            },
            {
                name: 'group',
                path: `${LERRET}/page/group`,
                kind: 'directory',
                isFile: false,
                isDirectory: true,
            },
        ]);
        expect(listProjectDir).toHaveBeenCalledWith(`${LERRET}/page`);
    });

    it('resolves [] for a missing directory (graceful absence — the server flattens it)', async () => {
        listProjectDir.mockResolvedValue({ ok: true, entries: [] });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.readDir(`${LERRET}/.state/history/manifests`)).resolves.toEqual([]);
    });

    it('strips a trailing slash before composing child paths', async () => {
        listProjectDir.mockResolvedValue({
            ok: true,
            entries: [{ name: 'a.md', isFile: true, isDirectory: false }],
        });
        const fs = createCliAiFs({ projectRoot: ROOT });
        const entries = await fs.readDir(`${LERRET}/page/`);
        expect(entries[0].path).toBe(`${LERRET}/page/a.md`);
    });

    it('throws on a transport failure', async () => {
        listProjectDir.mockResolvedValue({ ok: false, entries: [], error: 'boom' });
        const fs = createCliAiFs({ projectRoot: ROOT });
        await expect(fs.readDir(`${LERRET}/page`)).rejects.toThrow(/boom/);
    });
});

describe('createCliAiFs — exists / mkdir / deleteFile / removeDir', () => {
    it('exists resolves the boolean and never throws on probe failure', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        existsProjectPath.mockResolvedValue({ ok: true, exists: true, isDirectory: false });
        await expect(fs.exists(`${LERRET}/blob`)).resolves.toBe(true);
        existsProjectPath.mockResolvedValue({ ok: true, exists: false });
        await expect(fs.exists(`${LERRET}/gone`)).resolves.toBe(false);
        // A failed probe degrades to false — blob dedup then re-writes, which
        // is harmless; failing the turn over a probe is not.
        existsProjectPath.mockResolvedValue({ ok: false, exists: false, error: 'boom' });
        await expect(fs.exists(`${LERRET}/x`)).resolves.toBe(false);
    });

    it('mkdir delegates and throws on failure', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        mkdirProject.mockResolvedValue({ ok: true });
        await fs.mkdir(`${LERRET}/.state/history/blobs`);
        expect(mkdirProject).toHaveBeenCalledWith(`${LERRET}/.state/history/blobs`);
        mkdirProject.mockResolvedValue({ ok: false, error: 'nope' });
        await expect(fs.mkdir(`${LERRET}/.state`)).rejects.toThrow(/nope/);
    });

    it('deleteFile delegates and throws on failure', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        deleteProjectFile.mockResolvedValue({ ok: true });
        await fs.deleteFile(`${LERRET}/old.jsx`);
        expect(deleteProjectFile).toHaveBeenCalledWith(`${LERRET}/old.jsx`);
        deleteProjectFile.mockResolvedValue({ ok: false, error: 'denied' });
        await expect(fs.deleteFile(`${LERRET}/old.jsx`)).rejects.toThrow(/denied/);
    });

    it('removeDir delegates and throws on failure (e.g. ENOTEMPTY surfaced by the server)', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        removeDirProject.mockResolvedValue({ ok: true });
        await fs.removeDir(`${LERRET}/social`);
        expect(removeDirProject).toHaveBeenCalledWith(`${LERRET}/social`);
        removeDirProject.mockResolvedValue({ ok: false, error: 'remove-dir failed: ENOTEMPTY' });
        await expect(fs.removeDir(`${LERRET}/social`)).rejects.toThrow(/ENOTEMPTY/);
    });
});

describe('base64 helpers', () => {
    it('round-trips arbitrary bytes (including a chunk-boundary-sized array)', () => {
        const sizes = [0, 1, 3, 0x8000, 0x8000 + 7];
        for (const size of sizes) {
            const bytes = new Uint8Array(size);
            for (let i = 0; i < size; i += 1) bytes[i] = (i * 31) % 256;
            const back = base64ToBytes(bytesToBase64(bytes));
            expect(back.length).toBe(size);
            expect(Array.from(back)).toEqual(Array.from(bytes));
        }
    });
});

describe('createCliAiFs — dropped-connection error copy', () => {
    it('surfaces the calm connection message VERBATIM (no "mkdir failed:" prefix)', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        const connMsg =
            "can't reach the Lerret dev server — it may have stopped. Reload the studio to reconnect (and check that `@lerret/cli dev` is still running).";
        mkdirProject.mockResolvedValue({ ok: false, error: connMsg });
        await expect(fs.mkdir(`${LERRET}/kit`)).rejects.toThrow(connMsg);
        await expect(fs.mkdir(`${LERRET}/kit`)).rejects.not.toThrow(/mkdir failed/);
    });

    it('keeps the "<op> failed:" prefix for genuine server-side errors', async () => {
        const fs = createCliAiFs({ projectRoot: ROOT });
        writeProjectFile.mockResolvedValue({ ok: false, error: 'EACCES: permission denied' });
        await expect(fs.writeFile(`${LERRET}/a.jsx`, 'X')).rejects.toThrow(
            'writeFile failed: EACCES: permission denied',
        );
    });
});
