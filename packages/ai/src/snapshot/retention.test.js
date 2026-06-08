// Tests for `retention.js` — count-bounded eviction, size-bounded eviction,
// shared-blob preservation, orphan deletion, observability log.

import { describe, it, expect, vi } from 'vitest';

import {
    DEFAULT_CONFIG,
    loadConfig,
    computeBlobsBytes,
    runCleanup,
} from './retention.js';
import {
    createManifest,
    addFileEntry,
    finalizeManifest,
    writeManifest,
} from './manifest.js';
import { blobPath, CONFIG_FILE } from './layout.js';
import {
    createInMemoryFs,
    createMockSandbox,
} from './__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

function freshEnv() {
    const fs = createInMemoryFs();
    const sandbox = createMockSandbox(fs, PROJECT_ROOT);
    return { fs, sandbox };
}

/**
 * Write N synthetic turn manifests with sequential timestamps so list-by-
 * ascending order is deterministic. Each turn references one unique blob
 * (sha256 = `'<n>'.padStart(64, '0')`) so the referenced-blobs Set is easy
 * to reason about.
 */
async function writeTurns({ fs, sandbox }, count, { baseTimestamp = '2026-06-07T00:00:00.000Z', baseId = 't' } = {}) {
    const base = new Date(baseTimestamp).getTime();
    for (let i = 0; i < count; i++) {
        const m = createManifest({
            id: `${baseId}-${String(i).padStart(3, '0')}`,
            prompt: `turn ${i}`,
            provider: 'openai',
            model: 'gpt-4o',
            now: () => new Date(base + i * 1000),
        });
        const sha = String(i).padStart(64, '0');
        const m2 = finalizeManifest(
            addFileEntry(m, {
                path: `.lerret/a${i}.jsx`,
                op: 'edit',
                snapshotKey: sha,
                sha256: sha,
                encoding: 'utf-8',
            }),
            { status: 'applied' },
        );
        await writeManifest({ sandbox, manifest: m2 });
        // Write a 1-byte blob with the matching key.
        await sandbox.writeFile(blobPath(sha), 'x');
    }
}

describe('DEFAULT_CONFIG', () => {
    it('matches the architecture defaults (100 turns OR 50 MB)', () => {
        expect(DEFAULT_CONFIG).toEqual({ maxTurns: 100, maxBlobsBytes: 50 * 1024 * 1024 });
    });
});

describe('loadConfig', () => {
    it('returns defaults when history-config.json is absent', async () => {
        const { fs } = freshEnv();
        const cfg = await loadConfig({ projectRoot: PROJECT_ROOT, fs });
        expect(cfg).toEqual(DEFAULT_CONFIG);
    });

    it('merges valid overrides on top of defaults', async () => {
        const { fs } = freshEnv();
        await fs.writeFile(
            `${PROJECT_ROOT}/${CONFIG_FILE}`,
            JSON.stringify({ maxTurns: 25 }),
        );
        const cfg = await loadConfig({ projectRoot: PROJECT_ROOT, fs });
        expect(cfg.maxTurns).toBe(25);
        expect(cfg.maxBlobsBytes).toBe(DEFAULT_CONFIG.maxBlobsBytes);
    });

    it('falls back to defaults on malformed JSON, with a warn log', async () => {
        const { fs } = freshEnv();
        await fs.writeFile(`${PROJECT_ROOT}/${CONFIG_FILE}`, '{not json');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cfg = await loadConfig({ projectRoot: PROJECT_ROOT, fs });
        expect(cfg).toEqual(DEFAULT_CONFIG);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

describe('computeBlobsBytes', () => {
    it('returns 0 when blobs/ is absent', async () => {
        const { fs } = freshEnv();
        expect(await computeBlobsBytes({ projectRoot: PROJECT_ROOT, fs })).toBe(0);
    });

    it('sums the byte-size of every blob in blobs/', async () => {
        const { fs, sandbox } = freshEnv();
        await sandbox.writeFile(blobPath('a'.repeat(64)), 'three');
        await sandbox.writeFile(blobPath('b'.repeat(64)), 'four ');
        const total = await computeBlobsBytes({ projectRoot: PROJECT_ROOT, fs });
        // 'three'.length (5) + 'four '.length (5) = 10 (string encoded to UTF-8 below)
        expect(total).toBeGreaterThanOrEqual(10);
    });
});

describe('runCleanup — count-bounded eviction', () => {
    it('writing 105 turns + cleanup at maxTurns=100 evicts the 5 oldest', async () => {
        const { fs, sandbox } = freshEnv();
        await writeTurns({ fs, sandbox }, 105);

        // Sanity: 105 manifests exist before cleanup.
        const before = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/manifests/'),
        ).length;
        expect(before).toBe(105);

        const result = await runCleanup({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            config: { maxTurns: 100, maxBlobsBytes: Number.MAX_SAFE_INTEGER },
        });

        expect(result.evictedTurns).toBe(5);
        const after = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/manifests/'),
        ).length;
        expect(after).toBe(100);

        // The five oldest manifests should be the ones evicted (ids 000..004).
        for (let i = 0; i < 5; i++) {
            const id = `t-${String(i).padStart(3, '0')}`;
            const path = `${PROJECT_ROOT}/.lerret/.state/history/manifests/${id}.json`;
            expect(fs._files.has(path)).toBe(false);
        }
    });
});

describe('runCleanup — orphan-blob deletion', () => {
    it('deletes blobs no retained manifest references', async () => {
        const { fs, sandbox } = freshEnv();
        await writeTurns({ fs, sandbox }, 3);

        // Add an orphan blob with a hash no manifest references.
        const orphanHash = 'orphan'.padEnd(64, '0');
        await sandbox.writeFile(blobPath(orphanHash), 'orphan content');
        const orphanPath = `${PROJECT_ROOT}/${blobPath(orphanHash)}`;

        // Precondition: orphan exists.
        expect(fs._files.has(orphanPath)).toBe(true);

        const result = await runCleanup({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            config: DEFAULT_CONFIG,
        });

        // Postcondition: orphan deleted.
        expect(fs._files.has(orphanPath)).toBe(false);
        expect(result.deletedBlobs).toBeGreaterThanOrEqual(1);
        expect(result.reclaimedBytes).toBeGreaterThanOrEqual('orphan content'.length);
    });
});

describe('runCleanup — shared-blob preservation', () => {
    it('refuses to delete a blob still referenced by any retained manifest', async () => {
        const { fs, sandbox } = freshEnv();
        const sharedHash = 'shared'.padEnd(64, '0');

        // Two manifests both reference the same blob.
        const m1 = finalizeManifest(
            addFileEntry(
                createManifest({
                    id: 't-1',
                    prompt: 'p',
                    provider: 'o',
                    model: 'm',
                    now: () => new Date('2026-06-07T01:00:00.000Z'),
                }),
                { path: '.lerret/a.jsx', op: 'edit', snapshotKey: sharedHash, sha256: sharedHash },
            ),
            { status: 'applied' },
        );
        const m2 = finalizeManifest(
            addFileEntry(
                createManifest({
                    id: 't-2',
                    prompt: 'p',
                    provider: 'o',
                    model: 'm',
                    now: () => new Date('2026-06-07T02:00:00.000Z'),
                }),
                { path: '.lerret/b.jsx', op: 'edit', snapshotKey: sharedHash, sha256: sharedHash },
            ),
            { status: 'applied' },
        );
        await writeManifest({ sandbox, manifest: m1 });
        await writeManifest({ sandbox, manifest: m2 });
        await sandbox.writeFile(blobPath(sharedHash), 'shared');

        // maxTurns=1 → evict t-1 (older). t-2 still references sharedHash.
        await runCleanup({ projectRoot: PROJECT_ROOT, fs, sandbox, config: { maxTurns: 1, maxBlobsBytes: Number.MAX_SAFE_INTEGER } });

        // Shared blob MUST still be present.
        expect(fs._files.has(`${PROJECT_ROOT}/${blobPath(sharedHash)}`)).toBe(true);
    });
});

describe('runCleanup — observability log', () => {
    it('emits a single info line with counts (no user content)', async () => {
        const { fs, sandbox } = freshEnv();
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

        // Create a single orphan blob to clean up.
        await sandbox.writeFile(blobPath('orphan'.padEnd(64, '0')), 'x');
        await runCleanup({ projectRoot: PROJECT_ROOT, fs, sandbox, config: DEFAULT_CONFIG });

        expect(infoSpy).toHaveBeenCalledTimes(1);
        const arg = infoSpy.mock.calls[0][0];
        expect(arg).toMatch(/^\[lerret-ai\] snapshot cleanup —/);
        expect(arg).toMatch(/evicted \d+ turn\(s\)/);
        expect(arg).toMatch(/reclaimed \d+ bytes/);
        expect(arg).toMatch(/\d+ blobs\)/);
        // No user content — no file paths, no prompts.
        expect(arg).not.toContain('.lerret');
        expect(arg).not.toContain('prompt');
        infoSpy.mockRestore();
    });
});

describe('runCleanup — does NOT count revert/redo as turns', () => {
    it('a revert manifest is NOT evicted when counting toward maxTurns', async () => {
        const { fs, sandbox } = freshEnv();
        // 2 turns + 1 revert. maxTurns=2 should leave both turns + the revert intact.
        await writeTurns({ fs, sandbox }, 2);
        const revertM = createManifest({
            id: 'r-1',
            prompt: 'revert',
            provider: 'o',
            model: 'm',
            kind: 'revert',
            sourceTurnId: 't-001',
            now: () => new Date('2026-06-07T00:00:03.000Z'),
        });
        revertM.status = 'applied';
        await writeManifest({ sandbox, manifest: revertM });

        const result = await runCleanup({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox,
            config: { maxTurns: 2, maxBlobsBytes: Number.MAX_SAFE_INTEGER },
        });
        expect(result.evictedTurns).toBe(0);
        // All three manifests still present.
        const manifestCount = [...fs._files.keys()].filter((k) =>
            k.includes('/.state/history/manifests/'),
        ).length;
        expect(manifestCount).toBe(3);
    });
});
