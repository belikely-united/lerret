// @vitest-environment node
//
// Unit tests for the Worker GRAPH NODE (createWorkerNode) — distinct from the
// flat dispatch stub in worker.test.js. These pin the Story 8.3 review fixes:
//   - the snapshot PRE-capture happens before the first touch of a file (AC-10),
//   - the `writing` event + writtenFiles record land BEFORE capturePostImage
//     (O3 ordering fix — so on-disk reality is reflected even if the post-image
//     capture throws),
//   - the abort check is BEFORE each write and never mid-write (AC-13 / NFR18).

import { describe, it, expect, vi } from 'vitest';

import { createWorkerNode } from './worker.js';

/** Minimal sandbox the worker node needs; all ops resolve. */
function makeSandbox(overrides = {}) {
    return {
        writeFile: vi.fn().mockResolvedValue(undefined),
        deleteFile: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        removeDir: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(''),
        exists: vi.fn().mockResolvedValue(false),
        ...overrides,
    };
}

/** Snapshot stub recording call order; manifest is an opaque token. */
function makeSnapshot(order) {
    return {
        isAlreadyCapturedInTurn: vi.fn(() => false),
        captureBeforeImage: vi.fn(async ({ manifest }) => {
            order?.push('before');
            return { ...manifest, _captured: true };
        }),
        capturePostImage: vi.fn(async () => {
            order?.push('post');
            return { sha256: 'deadbeef' };
        }),
        updateFileEntry: vi.fn((manifest) => manifest),
    };
}

const DEPS = (extra) => ({
    sandbox: makeSandbox(),
    fs: {},
    projectRoot: '/p',
    emit: vi.fn(),
    snapshot: makeSnapshot(),
    ...extra,
});

describe('createWorkerNode — write path', () => {
    it('PRE-captures before-image (op=create for a new file) before writing', async () => {
        const deps = DEPS();
        const node = createWorkerNode(deps);
        const state = {
            manifest: { id: 't1', files: [] },
            signal: undefined,
            plan: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }],
        };
        const out = await node(state);

        expect(deps.snapshot.captureBeforeImage).toHaveBeenCalledTimes(1);
        expect(deps.snapshot.captureBeforeImage.mock.calls[0][0].op).toBe('create');
        expect(deps.sandbox.writeFile).toHaveBeenCalledWith('.lerret/a.jsx', 'A');
        expect(out.writtenFiles).toEqual([{ path: '.lerret/a.jsx', op: 'create' }]);
    });

    it('records op=edit when the file already exists', async () => {
        const deps = DEPS({ sandbox: makeSandbox({ exists: vi.fn().mockResolvedValue(true) }) });
        const node = createWorkerNode(deps);
        const out = await node({
            manifest: { id: 't1', files: [] },
            plan: [{ op: 'write', path: '.lerret/exists.jsx', content: 'E' }],
        });
        expect(deps.snapshot.captureBeforeImage.mock.calls[0][0].op).toBe('edit');
        expect(out.writtenFiles).toEqual([{ path: '.lerret/exists.jsx', op: 'edit' }]);
    });

    it('emits `writing` BEFORE capturePostImage (O3 ordering)', async () => {
        const order = [];
        const emit = vi.fn((ev) => order.push(`emit:${ev.type}`));
        const snapshot = makeSnapshot(order);
        const node = createWorkerNode({ sandbox: makeSandbox(), fs: {}, projectRoot: '/p', emit, snapshot });
        await node({
            manifest: { id: 't1', files: [] },
            plan: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }],
        });
        // 'before' (pre-capture) → 'emit:writing' → 'post' (redo capture).
        expect(order).toEqual(['before', 'emit:writing', 'post']);
    });

    it('writtenFiles + writing event survive a throwing capturePostImage', async () => {
        const emit = vi.fn();
        const snapshot = makeSnapshot();
        snapshot.capturePostImage = vi.fn(async () => {
            throw new Error('blob store full');
        });
        const node = createWorkerNode({ sandbox: makeSandbox(), fs: {}, projectRoot: '/p', emit, snapshot });
        await expect(
            node({ manifest: { id: 't1', files: [] }, plan: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }] }),
        ).rejects.toThrow('blob store full');
        // The event + on-disk write already happened before the throw.
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'writing', file: '.lerret/a.jsx' }));
    });

    it('skips a malformed write step (bad content) without crashing the turn', async () => {
        const deps = DEPS();
        const node = createWorkerNode(deps);
        const out = await node({
            manifest: { id: 't1', files: [] },
            plan: [{ op: 'write', path: '.lerret/a.jsx', content: 42 }],
        });
        expect(deps.sandbox.writeFile).not.toHaveBeenCalled();
        expect(out.writtenFiles).toEqual([]);
    });
});

describe('createWorkerNode — delete + mkdir', () => {
    it('delete captures before-image (when the file exists) then deletes + emits', async () => {
        const deps = DEPS({ sandbox: makeSandbox({ exists: vi.fn().mockResolvedValue(true) }) });
        const node = createWorkerNode(deps);
        const out = await node({ manifest: { id: 't1', files: [] }, plan: [{ op: 'delete', path: '.lerret/old.jsx' }] });
        expect(deps.snapshot.captureBeforeImage.mock.calls[0][0].op).toBe('delete');
        expect(deps.sandbox.deleteFile).toHaveBeenCalledWith('.lerret/old.jsx');
        expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'deleting', file: '.lerret/old.jsx' }));
        expect(out.writtenFiles).toEqual([{ path: '.lerret/old.jsx', op: 'delete' }]);
    });

    it('mkdir emits a mkdir event and does NOT add to writtenFiles', async () => {
        const deps = DEPS();
        const node = createWorkerNode(deps);
        const out = await node({ manifest: { id: 't1', files: [] }, plan: [{ op: 'mkdir', path: '.lerret/social' }] });
        expect(deps.sandbox.mkdir).toHaveBeenCalledWith('.lerret/social');
        expect(deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'mkdir', dir: '.lerret/social' }));
        expect(out.writtenFiles).toEqual([]);
    });

    it('rmdir calls removeDir, emits deleting, captures NO before-image, and is NOT in writtenFiles', async () => {
        const deps = DEPS();
        const node = createWorkerNode(deps);
        const out = await node({
            manifest: { id: 't1', files: [] },
            plan: [{ op: 'rmdir', path: '.lerret/social' }],
        });
        expect(deps.sandbox.removeDir).toHaveBeenCalledWith('.lerret/social');
        // A removed folder reuses the `deleting` event (minimal surface).
        expect(deps.emit).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'deleting', file: '.lerret/social' }),
        );
        // No snapshot pre-capture — revert is handled by the per-file deletes.
        expect(deps.snapshot.captureBeforeImage).not.toHaveBeenCalled();
        // rmdir is bookkeeping, not a written file (the deleted FILES are).
        expect(out.writtenFiles).toEqual([]);
    });

    it('a delete_dir-shaped plan deletes files (snapshotted) then rmdirs bottom-up; writtenFiles counts only the files', async () => {
        const deps = DEPS({ sandbox: makeSandbox({ exists: vi.fn().mockResolvedValue(true) }) });
        const node = createWorkerNode(deps);
        // The shape the agent executor builds: all file deletes first, then
        // rmdirs deepest-first ending at the page root.
        const plan = [
            { op: 'delete', path: '.lerret/social/sub/a.jsx' },
            { op: 'delete', path: '.lerret/social/b.jsx' },
            { op: 'rmdir', path: '.lerret/social/sub' },
            { op: 'rmdir', path: '.lerret/social' },
        ];
        const out = await node({ manifest: { id: 't1', files: [] }, plan });
        // Both files were captured (revertible) and deleted.
        expect(deps.snapshot.captureBeforeImage).toHaveBeenCalledTimes(2);
        expect(deps.sandbox.deleteFile).toHaveBeenCalledTimes(2);
        // Both folders removed, deepest first.
        expect(deps.sandbox.removeDir.mock.calls.map((c) => c[0])).toEqual([
            '.lerret/social/sub',
            '.lerret/social',
        ]);
        // writtenFiles carries only the two deleted FILES — folders are bookkeeping.
        expect(out.writtenFiles).toEqual([
            { path: '.lerret/social/sub/a.jsx', op: 'delete' },
            { path: '.lerret/social/b.jsx', op: 'delete' },
        ]);
    });
});

describe('createWorkerNode — abort (AC-13 / NFR18)', () => {
    it('a pre-aborted signal makes zero writes', async () => {
        const deps = DEPS();
        const node = createWorkerNode(deps);
        const controller = new AbortController();
        controller.abort();
        const out = await node({
            manifest: { id: 't1', files: [] },
            signal: controller.signal,
            plan: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }],
        });
        expect(deps.sandbox.writeFile).not.toHaveBeenCalled();
        expect(out.writtenFiles).toEqual([]);
    });

    it('abort fired during the first write lets it finish; the next step is skipped', async () => {
        const controller = new AbortController();
        const sandbox = makeSandbox({
            writeFile: vi.fn(async (p) => {
                if (p === '.lerret/first.jsx') controller.abort(); // abort AFTER entering write #1
            }),
        });
        const deps = DEPS({ sandbox });
        const node = createWorkerNode(deps);
        const out = await node({
            manifest: { id: 't1', files: [] },
            signal: controller.signal,
            plan: [
                { op: 'write', path: '.lerret/first.jsx', content: '1' },
                { op: 'write', path: '.lerret/second.jsx', content: '2' },
            ],
        });
        // First write completed (in-flight finished — NFR18); second never started.
        expect(sandbox.writeFile).toHaveBeenCalledTimes(1);
        expect(sandbox.writeFile).toHaveBeenCalledWith('.lerret/first.jsx', '1');
        expect(out.writtenFiles).toEqual([{ path: '.lerret/first.jsx', op: 'create' }]);
    });
});
