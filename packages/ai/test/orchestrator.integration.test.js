// Orchestrator integration suite (Story 8.3 AC-18). Drives the real
// LangGraph turn graph end-to-end against MOCK providers + the in-memory
// FS/sandbox from Story 8.5's test helpers. Every test asserts an EXPECTED
// side effect (event sequence, manifest status, file/blob presence,
// sandbox-call order) — never merely that runTurn ran (the 8.0/8.5 review
// lesson: no vacuously-passing tests).

import { describe, it, expect, vi } from 'vitest';

import { runTurn, createVaultResolver } from '../src/orchestrator/run-turn.js';
import * as snapshot from '../src/snapshot/index.js';
import {
    createInMemoryFs,
    createMockSandbox,
    seedFs,
} from '../src/snapshot/__test-helpers__/in-memory-fs.js';
import { __setIndexedDBForTests, putProviderConfig } from '../src/vault/store.js';
import { createInMemoryIDB } from '../src/vault/__test-helpers__/in-memory-idb.js';

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

        // The done event carries the turn-manifest id (the dock's revert target).
        expect(doneEv.turnId).toBe(manifests[0].id);
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

        // The stopped event carries the turn-manifest id (revert targeting).
        const stoppedEv = events.find((e) => e.type === 'stopped');
        expect(stoppedEv.turnId).toBe(manifests[0].id);
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

describe('orchestrator integration — inspect mode (read-only Q&A, Story 8.9)', () => {
    it('mode:"inspect" happy path → inspector-response carries the provider answer; done files []; NO manifest', async () => {
        const fs = createInMemoryFs();
        const active = mockHandle({
            onComplete: async () => ({ content: 'You have 3 social assets under .lerret/social/.' }),
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({
                prompt: 'what social assets do I have?',
                mode: 'inspect',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        // The thread shows the ANSWER (FR58) — exactly one inspector-response,
        // delivered before the terminal done.
        const respEvents = events.filter((e) => e.type === 'inspector-response');
        expect(respEvents).toHaveLength(1);
        expect(respEvents[0].answer).toBe('You have 3 social assets under .lerret/social/.');
        expect(events.findIndex((e) => e.type === 'inspector-response')).toBeLessThan(
            events.findIndex((e) => e.type === 'done'),
        );

        // Terminal done: nothing written, nothing to revert.
        const doneEv = events.find((e) => e.type === 'done');
        expect(doneEv.files).toEqual([]);
        expect(doneEv).not.toHaveProperty('turnId');
        expect(events.some((e) => e.type === 'writing')).toBe(false);

        // AC group C: NO snapshot manifest — the revert timeline did not grow.
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toEqual([]);
        // And the backend saw zero writes of any kind.
        expect(fs._files.size).toBe(0);
    });

    it('inspect turn reads a referenced file (reading event) without mutating the backend', async () => {
        const fs = createInMemoryFs();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/social/release-card.jsx`]: 'export const ReleaseCard = () => null;',
        });
        const active = mockHandle({
            onComplete: async ({ messages }) => ({
                // Echo back whether the file content reached the provider —
                // the assertion below pins the targeted-read plumbing.
                content: messages[0].content.includes('ReleaseCard')
                    ? 'It renders the release card: .lerret/social/release-card.jsx'
                    : 'file content missing',
            }),
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({
                prompt: 'explain social/release-card.jsx',
                mode: 'inspect',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        expect(
            events.some((e) => e.type === 'reading' && e.file === '.lerret/social/release-card.jsx'),
        ).toBe(true);
        const respEv = events.find((e) => e.type === 'inspector-response');
        expect(respEv.answer).toBe('It renders the release card: .lerret/social/release-card.jsx');
        // Only the seeded file exists — the turn added nothing.
        expect([...fs._files.keys()]).toEqual([`${PROJECT_ROOT}/.lerret/social/release-card.jsx`]);
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
    });

    it('inspect + abort → stopped with NO turnId, no inspector-response, still no manifest', async () => {
        const fs = createInMemoryFs();
        const controller = new AbortController();
        const active = mockHandle({
            onComplete: async () => {
                controller.abort(); // Esc / Stop mid-round-trip.
                return { content: 'late answer' };
            },
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({
                prompt: 'stop this inspect',
                mode: 'inspect',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        const stoppedEv = events.find((e) => e.type === 'stopped');
        expect(stoppedEv).toBeDefined();
        expect(stoppedEv).not.toHaveProperty('turnId');
        expect(events.some((e) => e.type === 'inspector-response')).toBe(false);
        expect(events.some((e) => e.type === 'done')).toBe(false);

        // Aborted inspect turns also write nothing — no stopped-mid-turn manifest.
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
        expect(fs._files.size).toBe(0);
    });
});

describe('orchestrator integration — consumer early-break (.return() teardown)', () => {
    /**
     * A provider whose planning call PARKS until the turn's signal aborts —
     * the consumer's break lands deterministically while the turn is
     * mid-flight (no race against a fast mock resolution).
     */
    function parkedHandle(plan) {
        return mockHandle({
            onComplete: async ({ signal }) =>
                new Promise((resolve) => {
                    const finish = () =>
                        resolve({ content: JSON.stringify({ steps: plan }) });
                    if (signal?.aborted) return finish();
                    signal?.addEventListener('abort', finish, { once: true });
                }),
        });
    }

    it('generate mode: breaking after the first event still finalizes the manifest (stopped-mid-turn)', async () => {
        const fs = createInMemoryFs();
        const plan = [{ op: 'write', path: '.lerret/late.jsx', content: 'L' }];
        const resolver = mockResolver({ active: parkedHandle(plan) });

        const consumed = [];
        for await (const ev of runTurn({ prompt: 'break me', projectRoot: PROJECT_ROOT, fs, resolver })) {
            consumed.push(ev);
            break; // the consumer walks away after the FIRST event
        }
        expect(consumed).toHaveLength(1);

        // The generator's finally aborted the graph, waited for it to settle,
        // and finalized: ONE manifest at stopped-mid-turn (current early-break
        // semantics — the abort lands before the Worker runs)…
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toHaveLength(1);
        expect(manifests[0].status).toBe('stopped-mid-turn');
        // …and the aborted plan never wrote.
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/late.jsx`)).toBe(false);
    });

    it('inspect mode: breaking after the first event leaves NO manifest and zero writes', async () => {
        const fs = createInMemoryFs();
        const resolver = mockResolver({ active: parkedHandle([]) });

        const consumed = [];
        for await (const ev of runTurn({
            prompt: 'break this inspect',
            mode: 'inspect',
            projectRoot: PROJECT_ROOT,
            fs,
            resolver,
        })) {
            consumed.push(ev);
            break;
        }
        expect(consumed).toHaveLength(1);

        // Early-break holds the inspect invariant too: no manifest, no blobs,
        // byte-empty backend.
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
        expect(fs._files.size).toBe(0);
    });
});

describe('orchestrator integration — vault resolver vision enumeration (FR56, key-only configs)', () => {
    it('a key-only (model-less) cloud config is eligible mid-turn at its class-default model', async () => {
        const idb = createInMemoryIDB();
        __setIndexedDBForTests(idb);
        try {
            const folderId = 'folder:vision-enum';
            // Active local provider (never vision-eligible on llama3.2)…
            await putProviderConfig({
                folderId,
                providerName: 'ollama',
                config: { active: true, model: 'llama3.2', configuredAt: '2026-06-01T00:00:00.000Z' },
            });
            // …plus a key-only cloud config: the user pasted a key and never
            // picked a model. Its EFFECTIVE model is the class default.
            await putProviderConfig({
                folderId,
                providerName: 'openai',
                config: { active: false, configuredAt: '2026-06-02T00:00:00.000Z' },
            });

            const resolver = createVaultResolver({ folderId });
            const eligible = await resolver.enumerateVision({ exclude: 'ollama' });

            // The router resolves the effective model (gpt-4o), so the
            // model-less config is OFFERED — not failed closed on `undefined`.
            expect(eligible).toEqual([{ name: 'openai', model: 'gpt-4o' }]);
        } finally {
            __setIndexedDBForTests(null);
        }
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
        // Epic 9 (ADR-006): Planner→Worker collapsed into one AgentExecutor
        // graph node — the Worker lives on as the mutation MODULE.
        expect(ai.AGENT_NODES).toContain('AgentExecutor');
        expect(ai.AGENT_NODES).not.toContain('Worker');
    });

    it('exposes the vision + workflows namespaces with their key functions', async () => {
        const ai = await import('../src/index.js');
        // ai.vision — the Story 8.7 router surface.
        expect(ai.vision).toBeDefined();
        expect(typeof ai.vision.isVisionRequired).toBe('function');
        expect(typeof ai.vision.supportsVision).toBe('function');
        expect(typeof ai.vision.shouldFallback).toBe('function');
        expect(typeof ai.vision.eligibleVisionProviders).toBe('function');
        expect(typeof ai.vision.resolveEffectiveModel).toBe('function');
        // ai.workflows — the Story 8.8 recognizer + planners.
        expect(ai.workflows).toBeDefined();
        expect(typeof ai.workflows.recognizeWorkflow).toBe('function');
        expect(typeof ai.workflows.planLaunchKit).toBe('function');
        expect(typeof ai.workflows.planSocialVariants).toBe('function');
        // The orchestrator barrel carries EVERY event factory — including the
        // Story 8.9 inspector-response one.
        expect(typeof ai.orchestrator.inspectorResponse).toBe('function');
    });
});

describe('orchestrator integration — stop aborting an in-flight provider fetch', () => {
    it('an AbortError thrown by the aborted provider call terminates as STOPPED, never error', async () => {
        const fs = createInMemoryFs();
        const controller = new AbortController();
        // The provider call rejects with a fetch-style AbortError once the
        // signal fires mid-flight (the live-session repro: Esc during the
        // Anthropic round-trip showed "Error — see thread").
        const active = mockHandle({
            onComplete: ({ signal } = {}) =>
                new Promise((resolve, reject) => {
                    const abort = () => {
                        const err = new Error('The operation was aborted.');
                        err.name = 'AbortError';
                        reject(err);
                    };
                    if (signal?.aborted) return abort();
                    signal?.addEventListener('abort', abort, { once: true });
                    setTimeout(() => controller.abort(), 20);
                }),
        });
        const resolver = mockResolver({ active });

        const events = await collect(
            runTurn({
                prompt: 'stop me mid-fetch',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver,
            }),
        );

        expect(events.some((e) => e.type === 'stopped')).toBe(true);
        expect(events.some((e) => e.type === 'error')).toBe(false);
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].status).toBe('stopped-mid-turn');
    });
});
