// Tests for the revert API — revertFile / revertTurn / revertToTurn / redoTurn.

import { describe, it, expect } from 'vitest';

import {
    createManifest,
    addFileEntry,
    updateFileEntry,
    finalizeManifest,
    writeManifest,
    readManifest,
    listManifests,
} from './manifest.js';
import {
    computeSha256,
    captureBeforeImage,
    capturePostImage,
} from './store.js';
import { revertFile, revertTurn, revertToTurn, redoTurn } from './revert.js';
import { SnapshotError } from './errors.js';
import { blobPath } from './layout.js';
import {
    createInMemoryFs,
    createMockSandbox,
    seedFs,
} from './__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

function freshEnv() {
    const fs = createInMemoryFs();
    const sandbox = createMockSandbox(fs, PROJECT_ROOT);
    return { fs, sandbox };
}

/**
 * Helper: simulate a complete turn end-to-end (capture-before + write +
 * capture-post + finalize-manifest). Returns the final manifest.
 */
async function simulateTurn({
    fs,
    sandbox,
    turnId,
    timestamp,
    fileOps,
}) {
    let manifest = createManifest({
        id: turnId,
        prompt: `turn ${turnId}`,
        provider: 'openai',
        model: 'gpt-4o',
        now: () => new Date(timestamp),
    });
    for (const { path, op, content, encoding = 'utf-8' } of fileOps) {
        manifest = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: path,
            op,
            encoding,
        });
        if (op === 'delete') {
            await sandbox.deleteFile(path);
            // capturePostImage of empty-content blob (the post-state of a delete)
            const { sha256 } = await capturePostImage({
                sandbox,
                content: '',
                encoding,
            });
            manifest = updateFileEntry(manifest, path, { sha256 });
        } else {
            await sandbox.writeFile(path, content, { encoding });
            const { sha256 } = await capturePostImage({ sandbox, content, encoding });
            manifest = updateFileEntry(manifest, path, { sha256 });
        }
    }
    manifest = finalizeManifest(manifest, { status: 'applied' });
    await writeManifest({ sandbox, manifest });
    return manifest;
}

describe('revertFile', () => {
    it('restores a single edited file byte-exact', async () => {
        const { fs, sandbox } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'original',
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't1',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [{ path: '.lerret/asset.jsx', op: 'edit', content: 'NEW VALUE' }],
        });
        // Sanity check: file currently has the new content.
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('NEW VALUE');

        await revertFile({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't1', filePath: '.lerret/asset.jsx' });
        // File restored to 'original'.
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('original');
        // Source manifest's status flipped to 'reverted'.
        const m = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 't1' });
        expect(m.status).toBe('reverted');
    });

    it('undoes a created file by deleting it', async () => {
        const { fs, sandbox } = freshEnv();
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't-create',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [{ path: '.lerret/new.jsx', op: 'create', content: 'new file' }],
        });
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/new.jsx`)).toBe(true);

        await revertFile({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            turnId: 't-create',
            filePath: '.lerret/new.jsx',
        });
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/new.jsx`)).toBe(false);
    });

    it('throws FILE_NOT_IN_TURN for a path the source turn never touched', async () => {
        const { fs, sandbox } = freshEnv();
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [{ path: '.lerret/a.jsx', op: 'create', content: 'x' }],
        });
        await expect(
            revertFile({
                projectRoot: PROJECT_ROOT,
                fs,
                sandbox,
                turnId: 't',
                filePath: '.lerret/never-touched.jsx',
            }),
        ).rejects.toMatchObject({ name: 'SnapshotError', code: 'FILE_NOT_IN_TURN' });
    });
});

describe('revertTurn', () => {
    it('restores every file the turn touched (create-undo + edit-restore + delete-restore)', async () => {
        const { fs, sandbox } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/edit-me.jsx`]: 'original-edit',
            [`${PROJECT_ROOT}/.lerret/delete-me.jsx`]: 'original-delete',
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't-multi',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [
                { path: '.lerret/edit-me.jsx', op: 'edit', content: 'EDITED' },
                { path: '.lerret/delete-me.jsx', op: 'delete' },
                { path: '.lerret/new.jsx', op: 'create', content: 'NEW' },
            ],
        });
        // Verify post-turn state:
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/edit-me.jsx`).content).toBe('EDITED');
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/delete-me.jsx`)).toBe(false);
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/new.jsx`)).toBe(true);

        await revertTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't-multi' });

        // Edit restored:
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/edit-me.jsx`).content).toBe(
            'original-edit',
        );
        // Delete restored:
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/delete-me.jsx`).content).toBe(
            'original-delete',
        );
        // Create undone:
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/new.jsx`)).toBe(false);

        // Source manifest's status flipped to 'reverted'.
        const m = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 't-multi' });
        expect(m.status).toBe('reverted');

        // One consolidated revert manifest appended.
        const allManifests = await listManifests({ projectRoot: PROJECT_ROOT, fs });
        const revertManifests = allManifests.filter((m) => m.kind === 'revert');
        expect(revertManifests).toHaveLength(1);
        expect(revertManifests[0].sourceTurnId).toBe('t-multi');
    });
});

describe('revertToTurn', () => {
    it('reverts the given turn AND every newer turn, in reverse chronological order', async () => {
        const { fs, sandbox } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'v0',
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't1',
            timestamp: '2026-06-07T01:00:00.000Z',
            fileOps: [{ path: '.lerret/asset.jsx', op: 'edit', content: 'v1' }],
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't2',
            timestamp: '2026-06-07T02:00:00.000Z',
            fileOps: [{ path: '.lerret/asset.jsx', op: 'edit', content: 'v2' }],
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't3',
            timestamp: '2026-06-07T03:00:00.000Z',
            fileOps: [{ path: '.lerret/asset.jsx', op: 'edit', content: 'v3' }],
        });
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('v3');

        // Step back to BEFORE t2 — should revert t3 and t2.
        await revertToTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't2' });

        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('v1');
        const t2 = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 't2' });
        const t3 = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 't3' });
        expect(t2.status).toBe('reverted');
        expect(t3.status).toBe('reverted');
    });
});

describe('redoTurn', () => {
    it('re-applies the post-turn content byte-exact', async () => {
        const { fs, sandbox } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'original',
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't-redo',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [{ path: '.lerret/asset.jsx', op: 'edit', content: 'EDITED' }],
        });
        await revertTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't-redo' });
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('original');

        await redoTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't-redo' });
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/asset.jsx`).content).toBe('EDITED');
        const m = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 't-redo' });
        expect(m.status).toBe('applied');
    });

    it('refuses to redo a non-reverted turn', async () => {
        const { fs, sandbox } = freshEnv();
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [{ path: '.lerret/a.jsx', op: 'create', content: 'a' }],
        });
        await expect(redoTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't' })).rejects.toMatchObject({
            name: 'SnapshotError',
            code: 'NOT_REVERTED',
        });
    });
});

describe('binary-content revert round-trip', () => {
    it('a binary file (Uint8Array) reverts byte-exact', async () => {
        const { fs, sandbox } = freshEnv();
        const originalBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
        const editedBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]);
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/_brand/logo.png`]: originalBytes,
        });
        await simulateTurn({
            fs,
            sandbox,
            turnId: 't-binary',
            timestamp: '2026-06-07T00:00:00.000Z',
            fileOps: [
                {
                    path: '.lerret/_brand/logo.png',
                    op: 'edit',
                    content: editedBytes,
                    encoding: 'binary',
                },
            ],
        });
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/_brand/logo.png`).content).toEqual(
            editedBytes,
        );

        await revertTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't-binary' });
        const restored = fs._files.get(`${PROJECT_ROOT}/.lerret/_brand/logo.png`).content;
        expect(restored).toEqual(originalBytes); // byte-exact via Uint8Array equality
    });
});

describe('sandbox integration', () => {
    it('every revert write routes through the sandbox (path validation runs)', async () => {
        // We don't spy on the sandbox directly here — the SandboxViolationError
        // surface is tested in sandbox.test.js. Here we verify that a
        // malformed manifest (path outside .lerret/) DOES surface the
        // SandboxViolationError unchanged.
        const { fs, sandbox } = freshEnv();
        // Hand-craft a malformed manifest with an escape path:
        const manifest = createManifest({
            id: 't-evil',
            prompt: 'evil',
            provider: 'o',
            model: 'm',
            now: () => new Date('2026-06-07T00:00:00.000Z'),
        });
        manifest.files = [
            { path: '/etc/passwd', op: 'edit', snapshotKey: 'abc', encoding: 'utf-8' },
        ];
        manifest.status = 'applied';
        await writeManifest({ sandbox, manifest });
        // Seed the blob so the restoreEntry's fs.readFile would succeed if
        // not for the sandbox rejection.
        const blobHash = await computeSha256('original');
        seedFs(fs, {
            [`${PROJECT_ROOT}/${blobPath(blobHash)}`]: 'original',
        });
        manifest.files[0].snapshotKey = blobHash;
        await writeManifest({ sandbox, manifest });

        await expect(revertTurn({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 't-evil' })).rejects.toMatchObject(
            {
                name: 'SandboxViolationError',
                code: 'OUTSIDE_PROJECT',
            },
        );
    });
});
