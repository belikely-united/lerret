// Orchestrator integration suite (Story 8.3 AC-18). Drives the real
// LangGraph turn graph end-to-end against MOCK providers + the in-memory
// FS/sandbox from Story 8.5's test helpers. Every test asserts an EXPECTED
// side effect (event sequence, manifest status, file/blob presence,
// sandbox-call order) — never merely that runTurn ran (the 8.0/8.5 review
// lesson: no vacuously-passing tests).

import { describe, it, expect, vi } from 'vitest';

import { runTurn } from '../src/orchestrator/run-turn.js';
import * as snapshot from '../src/snapshot/index.js';
import {
    createInMemoryFs,
    createMockSandbox,
    seedFs,
} from '../src/snapshot/__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

/**
 * A mock provider handle. `complete` returns a canned plan (JSON of steps).
 * Respects `signal` if `abortBetween` is set.
 */
function mockHandle({ name = 'openai', model = 'gpt-4o', vision = true, plan = [], onComplete } = {}) {
    return {
        name,
        model,
        modelSupportsVision: () => vision,
        complete:
            onComplete ??
            (async () => ({ content: JSON.stringify({ steps: plan }) })),
        async *stream() {},
    };
}

/**
 * A mock resolver injected into runTurn so no vault / real provider is hit.
 */
function mockResolver({ active, vision = [], override } = {}) {
    return {
        async resolveActive() {
            return { handle: active, name: active.name, model: active.model };
        },
        async enumerateVision() {
            return vision;
        },
        async resolveOverride() {
            return override;
        },
    };
}

/** Drain an async iterable of TurnEvents into an array. */
async function collect(iter) {
    const out = [];
    for await (const ev of iter) out.push(ev);
    return out;
}

describe('orchestrator integration — happy path', () => {
    it('single turn with two file writes → two writing events, done with both files, manifest applied', async () => {
        const fs = createInMemoryFs();
        const plan = [
            { op: 'write', path: '.lerret/social/a.jsx', content: 'A' },
            { op: 'write', path: '.lerret/social/b.jsx', content: 'B' },
        ];
        const resolver = mockResolver({ active: mockHandle({ plan }) });

        const events = await collect(
            runTurn({ prompt: 'make two', projectRoot: PROJECT_ROOT, fs, resolver }),
        );

        const writes = events.filter((e) => e.type === 'writing').map((e) => e.file);
        expect(writes).toEqual(['.lerret/social/a.jsx', '.lerret/social/b.jsx']);

        const doneEv = events.find((e) => e.type === 'done');
        expect(doneEv).toBeDefined();
        expect(doneEv.files.map((f) => f.path)).toEqual([
            '.lerret/social/a.jsx',
            '.lerret/social/b.jsx',
        ]);

        // Files actually written via the sandbox.
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/social/a.jsx`)).toBe(true);
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/social/b.jsx`)).toBe(true);

        // Manifest finalized to 'applied' with both file entries.
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toHaveLength(1);
        expect(manifests[0].status).toBe('applied');
        expect(manifests[0].files.map((f) => f.path).sort()).toEqual([
            '.lerret/social/a.jsx',
            '.lerret/social/b.jsx',
        ]);
    });
});

describe('orchestrator integration — stop', () => {
    it('stop mid-turn while reading → immediate halt: stopped event, no writing, manifest stopped-mid-turn', async () => {
        const fs = createInMemoryFs();
        const controller = new AbortController();
        // Abort during the Planner's complete() (stands in for "while reading").
        const active = mockHandle({
            onComplete: async () => {
                controller.abort();
                return { content: JSON.stringify({ steps: [{ op: 'write', path: '.lerret/x.jsx', content: 'X' }] }) };
            },
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({
                prompt: 'stop me',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        expect(events.some((e) => e.type === 'stopped')).toBe(true);
        expect(events.some((e) => e.type === 'writing')).toBe(false);
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/x.jsx`)).toBe(false);

        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].status).toBe('stopped-mid-turn');
    });

    it('stop mid-turn while writing → finishes in-flight write, next queued write NOT made', async () => {
        const fs = createInMemoryFs();
        const controller = new AbortController();
        // Two-write plan; the sandbox spy aborts AFTER the first write commits,
        // so the Worker's pre-check on the second step sees aborted and halts.
        const plan = [
            { op: 'write', path: '.lerret/first.jsx', content: '1' },
            { op: 'write', path: '.lerret/second.jsx', content: '2' },
        ];
        const resolver = mockResolver({ active: mockHandle({ plan }) });

        // Spy on the in-memory fs writeFile to fire the abort right after the
        // FIRST project file write lands.
        const realWrite = fs.writeFile.bind(fs);
        let firstSeen = false;
        fs.writeFile = vi.fn(async (path, content, opts) => {
            await realWrite(path, content, opts);
            if (path.endsWith('/.lerret/first.jsx') && !firstSeen) {
                firstSeen = true;
                controller.abort();
            }
        });

        const events = await collect(
            runTurn({
                prompt: 'stop mid write',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        // In-flight (first) write FINISHED; the next queued write did NOT.
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/first.jsx`)).toBe(true);
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/second.jsx`)).toBe(false);
        expect(events.filter((e) => e.type === 'writing').map((e) => e.file)).toEqual([
            '.lerret/first.jsx',
        ]);
        expect(events.some((e) => e.type === 'stopped')).toBe(true);

        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].status).toBe('stopped-mid-turn');
    });
});

describe('orchestrator integration — error', () => {
    it('provider error mid-turn → error event, snapshot intact (no auto-revert), manifest error', async () => {
        const fs = createInMemoryFs();
        const active = mockHandle({
            onComplete: async () => {
                const err = new Error('rate limited');
                err.name = 'RateLimited';
                throw err;
            },
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({ prompt: 'boom', projectRoot: PROJECT_ROOT, fs, resolver }),
        );

        const errEv = events.find((e) => e.type === 'error');
        expect(errEv).toBeDefined();
        expect(errEv.error.class).toBe('RateLimited');

        // The manifest exists (snapshot intact — NO auto-revert) with status error.
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].status).toBe('error');
    });
});

describe('orchestrator integration — vision fallback', () => {
    it('accept → the single vision (planning) call uses the override provider', async () => {
        const fs = createInMemoryFs();
        // Active model lacks vision; override does.
        const overrideComplete = vi.fn(async () => ({
            content: JSON.stringify({ steps: [{ op: 'write', path: '.lerret/v.jsx', content: 'V' }] }),
        }));
        const active = mockHandle({ name: 'ollama', model: 'llama3.2', vision: false });
        const override = mockHandle({ name: 'anthropic', model: 'claude-opus-4-7', vision: true, onComplete: overrideComplete });
        const resolver = mockResolver({
            active,
            vision: [{ name: 'anthropic', model: 'claude-opus-4-7' }],
            override,
        });

        const events = await collect(
            runTurn({
                prompt: 'match this screenshot',
                attachments: [{ type: 'image' }],
                onVisionDecision: async () => ({ accept: true, providerOverride: 'anthropic' }),
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        // The override provider's complete was used for the vision call.
        expect(overrideComplete).toHaveBeenCalledTimes(1);
        expect(events.some((e) => e.type === 'needs-vision-fallback')).toBe(true);
        expect(events.some((e) => e.type === 'done')).toBe(true);
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/v.jsx`)).toBe(true);
    });

    it('decline (no eligible provider) → VisionUnavailable error, manifest error', async () => {
        const fs = createInMemoryFs();
        const active = mockHandle({ name: 'ollama', model: 'llama3.2', vision: false });
        const resolver = mockResolver({ active, vision: [] }); // no eligible cloud vision provider

        const events = await collect(
            runTurn({
                prompt: 'match this screenshot',
                attachments: [{ type: 'image' }],
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        const errEv = events.find((e) => e.type === 'error');
        expect(errEv).toBeDefined();
        expect(errEv.error.class).toBe('VisionUnavailable');

        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].status).toBe('error');
    });
});

describe('orchestrator integration — edit-then-revert round trip', () => {
    it('a turn that edits an existing file captures the before-image, enabling revert', async () => {
        const fs = createInMemoryFs();
        seedFs(fs, { [`${PROJECT_ROOT}/.lerret/existing.jsx`]: 'ORIGINAL' });
        const plan = [{ op: 'write', path: '.lerret/existing.jsx', content: 'EDITED' }];
        const resolver = mockResolver({ active: mockHandle({ plan }) });

        await collect(runTurn({ prompt: 'edit it', projectRoot: PROJECT_ROOT, fs, resolver }));
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/existing.jsx`).content).toBe('EDITED');

        // The manifest recorded an 'edit' with a before-image snapshotKey.
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        const entry = manifests[0].files.find((f) => f.path === '.lerret/existing.jsx');
        expect(entry.op).toBe('edit');
        expect(typeof entry.snapshotKey).toBe('string');

        // Revert restores the original content.
        await snapshot.revertTurn({
            projectRoot: PROJECT_ROOT,
            fs,
            sandbox: createMockSandbox(fs, PROJECT_ROOT),
            turnId: manifests[0].id,
        });
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/existing.jsx`).content).toBe('ORIGINAL');
    });
});

describe('orchestrator integration — public surface smoke', () => {
    it('@lerret/ai exposes runTurn + orchestrator/providers/vault/snapshot namespaces', async () => {
        const ai = await import('../src/index.js');
        expect(typeof ai.runTurn).toBe('function');
        expect(ai.orchestrator).toBeDefined();
        expect(Array.isArray(ai.orchestrator.TURN_EVENT_TYPES)).toBe(true);
        expect(ai.providers).toBeDefined();
        expect(ai.vault).toBeDefined();
        expect(ai.snapshot).toBeDefined();
        expect(Array.isArray(ai.AGENT_NODES)).toBe(true);
        expect(ai.AGENT_NODES).toContain('Worker');
    });
});
