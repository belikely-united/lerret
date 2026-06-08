// Tests for `store.js` — SHA-256 + content-addressed before/after-image capture.

import { describe, it, expect } from 'vitest';

import {
    computeSha256,
    captureBeforeImage,
    capturePostImage,
    isAlreadyCapturedInTurn,
} from './store.js';
import { createManifest } from './manifest.js';
import { blobPath } from './layout.js';
import {
    createInMemoryFs,
    createMockSandbox,
    seedFs,
} from './__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function freshEnv() {
    const fs = createInMemoryFs();
    const sandbox = createMockSandbox(fs, PROJECT_ROOT);
    const manifest = createManifest({
        id: 't1',
        prompt: 'p',
        provider: 'openai',
        model: 'gpt-4o',
        now: () => new Date('2026-06-07T00:00:00.000Z'),
    });
    return { fs, sandbox, manifest };
}

describe('computeSha256', () => {
    it('hashes UTF-8 strings correctly (empty string test vector)', async () => {
        expect(await computeSha256('')).toBe(EMPTY_SHA256);
    });

    it('hashes the same content to the same hex regardless of representation', async () => {
        const text = 'hello, lerret';
        const bytes = new TextEncoder().encode(text);
        expect(await computeSha256(text)).toBe(await computeSha256(bytes));
    });

    it('produces a 64-char lowercase hex string', async () => {
        const hex = await computeSha256('some content');
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles binary content (Uint8Array of arbitrary bytes)', async () => {
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const hex = await computeSha256(png);
        expect(hex).toMatch(/^[0-9a-f]{64}$/);
        // Same bytes → same hash, deterministic.
        expect(await computeSha256(png)).toBe(hex);
    });
});

describe('captureBeforeImage', () => {
    it('op:create records snapshotKey: null and writes NO blob', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        const next = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/new-asset.jsx',
            op: 'create',
        });
        expect(next.files).toHaveLength(1);
        expect(next.files[0]).toMatchObject({
            path: '.lerret/new-asset.jsx',
            op: 'create',
            snapshotKey: null,
        });
        // No blob written.
        for (const key of fs._files.keys()) {
            expect(key).not.toContain('/.state/history/blobs/');
        }
    });

    it('op:edit reads current content, hashes it, writes blob, sets snapshotKey', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'original content',
        });
        const next = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/asset.jsx',
            op: 'edit',
        });
        const expectedHash = await computeSha256('original content');
        expect(next.files[0]).toMatchObject({
            path: '.lerret/asset.jsx',
            op: 'edit',
            snapshotKey: expectedHash,
            encoding: 'utf-8',
        });
        // Blob written.
        const blobAbs = `${PROJECT_ROOT}/${blobPath(expectedHash)}`;
        expect(fs._files.has(blobAbs)).toBe(true);
        expect(fs._files.get(blobAbs).content).toBe('original content');
    });

    it('op:delete reads pre-delete content, writes blob (file existed pre-turn)', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/old.jsx`]: 'soon to be deleted',
        });
        const next = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/old.jsx',
            op: 'delete',
        });
        const expectedHash = await computeSha256('soon to be deleted');
        expect(next.files[0].snapshotKey).toBe(expectedHash);
        const blobAbs = `${PROJECT_ROOT}/${blobPath(expectedHash)}`;
        expect(fs._files.has(blobAbs)).toBe(true);
    });

    it('AC-21: snapshot blob is written BEFORE the worker writes the new content (call-order spy)', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'pre-content',
        });
        // Record the order of sandbox.writeFile calls. The first call must
        // be the BLOB write (under .lerret/.state/history/blobs/); a
        // subsequent simulated Worker write would be the file edit. AC-21:
        // "snapshot is written BEFORE the mock-Worker's write call".
        const callLog = [];
        const originalWrite = sandbox.writeFile;
        sandbox.writeFile = async (path, data, opts) => {
            callLog.push(path);
            return originalWrite(path, data, opts);
        };

        // Step 1: snapshot the pre-edit content (captureBeforeImage).
        await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/asset.jsx',
            op: 'edit',
        });

        // Step 2: simulate the Worker writing the new content.
        await sandbox.writeFile('.lerret/asset.jsx', 'NEW VALUE');

        // The FIRST entry in callLog must be a blobs/ path (the snapshot);
        // the file edit must come AFTER it. No call to the file edit happens
        // before the blob is durably written.
        expect(callLog.length).toBeGreaterThanOrEqual(2);
        const blobWriteIdx = callLog.findIndex((p) => p.includes('/.state/history/blobs/'));
        const fileWriteIdx = callLog.findIndex((p) => p.endsWith('asset.jsx'));
        expect(blobWriteIdx).toBeGreaterThanOrEqual(0);
        expect(fileWriteIdx).toBeGreaterThan(blobWriteIdx);
    });

    it('AC-21: content-addressed dedup across TWO separate turns produces ONE blob, both manifests share the snapshotKey', async () => {
        const { fs, sandbox } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/asset.jsx`]: 'shared-pre-content',
        });

        // Turn 1: capture before-image then write NEW1.
        let m1 = createManifest({
            id: 't1',
            prompt: 'p1',
            provider: 'openai',
            model: 'gpt-4o',
            now: () => new Date('2026-06-07T01:00:00.000Z'),
        });
        m1 = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest: m1,
            filePath: '.lerret/asset.jsx',
            op: 'edit',
        });
        await sandbox.writeFile('.lerret/asset.jsx', 'NEW1');

        // Restore pre-content so turn 2 captures the same content as turn 1.
        await sandbox.writeFile('.lerret/asset.jsx', 'shared-pre-content');

        // Turn 2: same pre-content → same sha256.
        let m2 = createManifest({
            id: 't2',
            prompt: 'p2',
            provider: 'openai',
            model: 'gpt-4o',
            now: () => new Date('2026-06-07T02:00:00.000Z'),
        });
        m2 = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest: m2,
            filePath: '.lerret/asset.jsx',
            op: 'edit',
        });

        // Both manifests carry the same snapshotKey.
        expect(m1.files[0].snapshotKey).toBe(m2.files[0].snapshotKey);

        // And the on-disk blob count is exactly one.
        const blobFiles = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/blobs/'),
        );
        expect(blobFiles).toHaveLength(1);
    });

    it('content-addressed dedup: two captures of same content produce ONE blob', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/a.jsx`]: 'shared content',
            [`${PROJECT_ROOT}/.lerret/b.jsx`]: 'shared content',
        });
        const m1 = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/a.jsx',
            op: 'edit',
        });
        const m2 = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest: m1,
            filePath: '.lerret/b.jsx',
            op: 'edit',
        });
        expect(m2.files[0].snapshotKey).toBe(m2.files[1].snapshotKey);
        // Count blob files — should be exactly 1.
        const blobFiles = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/blobs/'),
        );
        expect(blobFiles).toHaveLength(1);
    });

    it('binary encoding round-trips byte-exact', async () => {
        const { fs, sandbox, manifest } = freshEnv();
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]);
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/_brand/icon.png`]: png,
        });
        const next = await captureBeforeImage({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            manifest,
            filePath: '.lerret/_brand/icon.png',
            op: 'edit',
            encoding: 'binary',
        });
        const blobAbs = `${PROJECT_ROOT}/${blobPath(next.files[0].snapshotKey)}`;
        const stored = fs._files.get(blobAbs);
        expect(stored.content).toEqual(png); // byte-exact
        expect(stored.encoding).toBe('binary');
    });
});

describe('capturePostImage', () => {
    it('writes the post-turn blob and returns its sha256', async () => {
        const { fs, sandbox } = freshEnv();
        const { sha256 } = await capturePostImage({
            sandbox,
            content: 'new content',
        });
        const expectedHash = await computeSha256('new content');
        expect(sha256).toBe(expectedHash);
        const blobAbs = `${PROJECT_ROOT}/${blobPath(expectedHash)}`;
        expect(fs._files.has(blobAbs)).toBe(true);
    });

    it('dedup applies: second call with same content does not re-write', async () => {
        const { fs, sandbox } = freshEnv();
        await capturePostImage({ sandbox, content: 'duplicate' });
        const blobsBefore = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/blobs/'),
        );
        await capturePostImage({ sandbox, content: 'duplicate' });
        const blobsAfter = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/blobs/'),
        );
        expect(blobsAfter.length).toBe(blobsBefore.length);
    });
});

describe('isAlreadyCapturedInTurn', () => {
    it('returns false when the file is not in the manifest', () => {
        const m = createManifest({ id: 't', prompt: '', provider: 'o', model: 'm' });
        expect(isAlreadyCapturedInTurn(m, '.lerret/x.jsx')).toBe(false);
    });

    it('returns true when the file is already in the manifest', () => {
        const { manifest } = freshEnv();
        const m2 = { ...manifest, files: [{ path: '.lerret/x.jsx', op: 'edit' }] };
        expect(isAlreadyCapturedInTurn(m2, '.lerret/x.jsx')).toBe(true);
    });
});
