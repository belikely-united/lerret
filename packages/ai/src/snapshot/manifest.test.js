// Tests for the turn-manifest schema + CRUD helpers.

import { describe, it, expect } from 'vitest';

import {
    createManifest,
    addFileEntry,
    updateFileEntry,
    finalizeManifest,
    writeManifest,
    readManifest,
    listManifests,
    updateManifestStatus,
    _internal,
} from './manifest.js';
import { SnapshotError } from './errors.js';
import { manifestPath } from './layout.js';
import { createInMemoryFs, createMockSandbox } from './__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

function freshEnv() {
    const fs = createInMemoryFs();
    const sandbox = createMockSandbox(fs, PROJECT_ROOT);
    return { fs, sandbox };
}

describe('createManifest', () => {
    it('produces a well-formed manifest with default kind/status', () => {
        const m = createManifest({
            id: 'turn-1',
            prompt: 'launch kit for v0.4',
            provider: 'anthropic',
            model: 'claude-opus-4.7',
            now: () => new Date('2026-06-07T12:34:56.789Z'),
        });
        expect(m).toMatchObject({
            id: 'turn-1',
            timestamp: '2026-06-07T12:34:56.789Z',
            prompt: 'launch kit for v0.4',
            provider: 'anthropic',
            model: 'claude-opus-4.7',
            scope: { type: 'project' },
            files: [],
            status: 'applied-in-progress',
            kind: 'turn',
        });
        expect(m.sourceTurnId).toBeUndefined();
    });

    it('auto-generates an id when none provided', () => {
        const m = createManifest({ prompt: 'p', provider: 'openai', model: 'gpt-4o' });
        expect(typeof m.id).toBe('string');
        expect(m.id.length).toBeGreaterThan(0);
    });

    it('carries sourceTurnId for revert/redo kinds', () => {
        const m = createManifest({
            prompt: 'p',
            provider: 'openai',
            model: 'gpt-4o',
            kind: 'revert',
            sourceTurnId: 'turn-1',
        });
        expect(m.kind).toBe('revert');
        expect(m.sourceTurnId).toBe('turn-1');
    });
});

describe('addFileEntry / updateFileEntry', () => {
    it('returns a NEW manifest with the entry appended (immutable)', () => {
        const m = createManifest({ id: 't', prompt: '', provider: 'o', model: 'm' });
        const next = addFileEntry(m, { path: 'a.jsx', op: 'create', snapshotKey: null });
        expect(m.files).toHaveLength(0);
        expect(next.files).toHaveLength(1);
        expect(next.files[0]).toMatchObject({ path: 'a.jsx', op: 'create' });
        expect(next).not.toBe(m);
    });

    it('updateFileEntry patches matching entry by path', () => {
        const m = createManifest({ id: 't', prompt: '', provider: 'o', model: 'm' });
        const m2 = addFileEntry(m, { path: 'a.jsx', op: 'edit', snapshotKey: 'abc' });
        const m3 = updateFileEntry(m2, 'a.jsx', { sha256: 'def' });
        expect(m3.files[0]).toMatchObject({ snapshotKey: 'abc', sha256: 'def' });
    });
});

describe('finalizeManifest', () => {
    it('sets a valid status', () => {
        const m = createManifest({ id: 't', prompt: '', provider: 'o', model: 'm' });
        const finalized = finalizeManifest(m, { status: 'applied' });
        expect(finalized.status).toBe('applied');
    });

    it('rejects an invalid status', () => {
        const m = createManifest({ id: 't', prompt: '', provider: 'o', model: 'm' });
        expect(() => finalizeManifest(m, { status: 'made-up' })).toThrow(SnapshotError);
        try {
            finalizeManifest(m, { status: 'made-up' });
        } catch (err) {
            expect(err.code).toBe('INVALID_STATUS');
        }
    });
});

describe('writeManifest + readManifest round-trip', () => {
    it('writes via the sandbox + reads back the same shape', async () => {
        const { fs, sandbox } = freshEnv();
        const m = createManifest({
            id: 'turn-r1',
            prompt: 'p',
            provider: 'openai',
            model: 'gpt-4o',
            now: () => new Date('2026-06-07T00:00:00.000Z'),
        });
        await writeManifest({ sandbox, manifest: m });
        const back = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 'turn-r1' });
        expect(back).toEqual(m);
    });

    it('writes Lerret canonical JSON (two-space indent, trailing newline)', async () => {
        const { fs, sandbox } = freshEnv();
        const m = createManifest({ id: 't1', prompt: '', provider: 'o', model: 'm' });
        await writeManifest({ sandbox, manifest: m });
        const raw = await fs.readFile(`${PROJECT_ROOT}/${manifestPath('t1')}`);
        expect(raw).toMatch(/\n {2}"prompt":/); // two-space indent
        expect(raw.endsWith('\n')).toBe(true);
    });

    it('readManifest throws SnapshotError on missing file', async () => {
        const { fs } = freshEnv();
        await expect(
            readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 'nope' }),
        ).rejects.toMatchObject({
            name: 'SnapshotError',
            code: 'MANIFEST_NOT_FOUND',
        });
    });

    it('readManifest throws SnapshotError on malformed JSON', async () => {
        const { fs } = freshEnv();
        await fs.writeFile(`${PROJECT_ROOT}/${manifestPath('bad')}`, '{not json');
        await expect(
            readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 'bad' }),
        ).rejects.toMatchObject({
            name: 'SnapshotError',
            code: 'MALFORMED_MANIFEST',
        });
    });
});

describe('listManifests', () => {
    it('returns manifests sorted by timestamp ascending', async () => {
        const { fs, sandbox } = freshEnv();
        await writeManifest({
            sandbox,
            manifest: createManifest({
                id: 't1',
                prompt: '',
                provider: 'o',
                model: 'm',
                now: () => new Date('2026-06-07T02:00:00.000Z'),
            }),
        });
        await writeManifest({
            sandbox,
            manifest: createManifest({
                id: 't2',
                prompt: '',
                provider: 'o',
                model: 'm',
                now: () => new Date('2026-06-07T01:00:00.000Z'),
            }),
        });
        const list = await listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(list.map((m) => m.id)).toEqual(['t2', 't1']);
    });

    it('returns [] when manifests dir does not exist', async () => {
        const { fs } = freshEnv();
        const list = await listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(list).toEqual([]);
    });
});

describe('updateManifestStatus', () => {
    it('mutates only the status field', async () => {
        const { fs, sandbox } = freshEnv();
        const m = createManifest({ id: 's', prompt: 'p', provider: 'o', model: 'm' });
        const enriched = addFileEntry(m, { path: 'x', op: 'edit', snapshotKey: 'k' });
        await writeManifest({ sandbox, manifest: enriched });
        await updateManifestStatus({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 's', status: 'applied' });
        const back = await readManifest({ projectRoot: PROJECT_ROOT, fs, turnId: 's' });
        expect(back.status).toBe('applied');
        // files[] array preserved byte-exact:
        expect(back.files).toEqual([
            { path: 'x', op: 'edit', snapshotKey: 'k' },
        ]);
        expect(back.prompt).toBe('p');
    });

    it('rejects an invalid status', async () => {
        const { fs, sandbox } = freshEnv();
        await writeManifest({
            sandbox,
            manifest: createManifest({ id: 's2', prompt: '', provider: 'o', model: 'm' }),
        });
        await expect(
            updateManifestStatus({ projectRoot: PROJECT_ROOT, fs, sandbox, turnId: 's2', status: 'bad' }),
        ).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    });
});

describe('serialization determinism', () => {
    it('serializeJson produces byte-identical output on repeat calls', () => {
        const { serializeJson } = _internal;
        const value = { b: 2, a: 1, nested: { y: true, x: false } };
        expect(serializeJson(value)).toBe(serializeJson(value));
    });
});
