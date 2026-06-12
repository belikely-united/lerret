// Agent-loop integration suite (Story 9.5 AC-3). Drives the REAL turn graph
// through runTurn — no internal modules mocked; only a scripted provider
// handle (injected via the resolver seam, the same idiom as
// orchestrator.integration.test.js) and the in-memory FS backend. Each test
// pins one row of the architecture-epic-9 §5 behavior matrix for the loop:
//
//   a. multi-turn discovery + write (list → read → write → summary)
//   b. cap → Continue → second cap → finish (one turnId / one manifest)
//   c. abort mid-loop (stopped terminal, stopped-mid-turn manifest)
//   d. repetition guard (identical consecutive call executes once)
//   e. isError self-correction (a failed read never dies the turn)
//   f. inspect-lane zero mutations (read tools only, no manifest)
//
// Every test asserts an EXPECTED side effect (event order, manifest status,
// memory-fs bytes, the messages a later provider call received) — never
// merely that runTurn ran.

import { describe, it, expect, vi } from 'vitest';

import { runTurn } from '../src/orchestrator/run-turn.js';
import * as snapshot from '../src/snapshot/index.js';
import {
    createInMemoryFs,
    seedFs,
} from '../src/snapshot/__test-helpers__/in-memory-fs.js';

const PROJECT_ROOT = '/Users/test/project';

/**
 * A scripted TOOL-CAPABLE provider handle. `respond(index, req)` is called
 * once per `completeWithTools` round-trip and returns the canned
 * `{ text, toolCalls, usage }` response. Every call's request is recorded on
 * `handle.calls` with a DEEP COPY of `messages` (the loop mutates the history
 * array in place — a live reference would show every later turn appended).
 *
 * `name: 'openai'` + `model: 'gpt-4o'` keep `supportsTools` true so the
 * executor routes to the loop branch, not the single-shot fallback.
 */
function scriptedHandle(respond, { name = 'openai', model = 'gpt-4o' } = {}) {
    /** @type {Array<{ messages: Array<object>, tools: Array<object> }>} */
    const calls = [];
    return {
        name,
        model,
        modelSupportsVision: () => true,
        complete: vi.fn(async () => ({ content: 'single-shot fallback (must not be used)' })),
        async *stream() {},
        calls,
        async completeWithTools({ messages, tools, signal }) {
            const index = calls.length;
            calls.push({ messages: JSON.parse(JSON.stringify(messages)), tools, signal });
            return respond(index, { messages, tools, signal });
        },
    };
}

/** Build one scripted provider response. */
function respond(text, toolCalls = [], usage = { inputTokens: 10, outputTokens: 5 }) {
    return { text, toolCalls, usage };
}

/** Build one scripted tool call. */
function call(id, name, args) {
    return { id, name, args };
}

/** Turn a fixed response queue into a `respond(index)` function (throws on
 * over-consumption — a loop that keeps calling past the script is a bug). */
function fromQueue(queue) {
    return (index) => {
        if (index >= queue.length) {
            throw new Error(`scripted provider exhausted at call ${index}`);
        }
        return queue[index];
    };
}

/** A mock resolver injected into runTurn so no vault / real provider is hit. */
function mockResolver(active) {
    return {
        async resolveActive() {
            return { handle: active, name: active.name, model: active.model };
        },
        async enumerateVision() {
            return [];
        },
        async resolveOverride() {
            return undefined;
        },
    };
}

/** Drain an async iterable of TurnEvents into an array. */
async function collect(iter) {
    const out = [];
    for await (const ev of iter) out.push(ev);
    return out;
}

describe('agent loop integration — multi-turn discovery + write (matrix: Ask / none / discovery)', () => {
    it('list → read → write → summary: sane event order, done carries file + summary, manifest applied, write via sandbox', async () => {
        const fs = createInMemoryFs();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/social/card.jsx`]: 'export const OLD = 1;',
        });
        const handle = scriptedHandle(
            fromQueue([
                respond('Let me look around.', [call('c1', 'list_dir', { path: '.lerret/' })]),
                respond('Reading the card.', [call('c2', 'read_file', { path: 'social/card.jsx' })]),
                respond('Writing the update.', [
                    call('c3', 'write_file', { path: 'social/card.jsx', content: 'NEW-CARD' }),
                ]),
                respond('Rethemed the card to the new palette.'),
            ]),
        );

        const events = await collect(
            runTurn({
                prompt: 'find the social card and retheme it',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
            }),
        );

        // The loop ran all four scripted turns against ALL_TOOLS.
        expect(handle.calls).toHaveLength(4);
        expect(handle.calls[0].tools.map((t) => t.name)).toEqual([
            'list_dir',
            'read_file',
            'write_file',
            'delete_file',
        ]);
        expect(handle.complete).not.toHaveBeenCalled();

        // Sane event order: thinking opens; list → read → write tool calls in
        // script order; each read surfaces as reading{file}; the Worker's
        // writing lands after the write tool-call; done is terminal.
        expect(events[0].type).toBe('thinking');
        expect(events.filter((e) => e.type === 'tool-call').map((e) => e.name)).toEqual([
            'list_dir',
            'read_file',
            'write_file',
        ]);
        const idxListCall = events.findIndex((e) => e.type === 'tool-call' && e.name === 'list_dir');
        const idxListRead = events.findIndex((e) => e.type === 'reading' && e.file === '.lerret/');
        const idxFileRead = events.findIndex(
            (e) => e.type === 'reading' && e.file === '.lerret/social/card.jsx',
        );
        const idxWriteCall = events.findIndex(
            (e) => e.type === 'tool-call' && e.name === 'write_file',
        );
        const idxWriting = events.findIndex(
            (e) => e.type === 'writing' && e.file === '.lerret/social/card.jsx',
        );
        expect(idxListCall).toBeGreaterThan(0);
        expect(idxListRead).toBeGreaterThan(idxListCall);
        expect(idxFileRead).toBeGreaterThan(idxListRead);
        expect(idxWriteCall).toBeGreaterThan(idxFileRead);
        expect(idxWriting).toBeGreaterThan(idxWriteCall);

        // One turn-progress per loop turn (incl. the zero-call terminal).
        const progress = events.filter((e) => e.type === 'turn-progress');
        expect(progress.map((e) => e.turn)).toEqual([1, 2, 3, 4]);
        expect(progress.every((e) => e.maxTurns === 10)).toBe(true);
        // Spend is cumulative (15 tokens per scripted response).
        expect(progress.map((e) => e.spentTokens)).toEqual([15, 30, 45, 60]);

        // The read round-trip actually fed the file content back to the model.
        expect(
            handle.calls[2].messages.some(
                (m) =>
                    m.role === 'tool' &&
                    m.results.some((r) => r.content.includes('export const OLD')),
            ),
        ).toBe(true);

        // done is the LAST event and carries the written file + the summary.
        const doneEv = events[events.length - 1];
        expect(doneEv.type).toBe('done');
        expect(doneEv.files).toEqual([{ path: '.lerret/social/card.jsx', op: 'edit' }]);
        expect(doneEv.summary).toBe('Rethemed the card to the new palette.');

        // The write went through the sandbox (bytes on "disk")…
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/social/card.jsx`).content).toBe('NEW-CARD');

        // …and the manifest records the edit at status applied.
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toHaveLength(1);
        expect(manifests[0].status).toBe('applied');
        const entry = manifests[0].files.find((f) => f.path === '.lerret/social/card.jsx');
        expect(entry.op).toBe('edit');
        expect(doneEv.turnId).toBe(manifests[0].id);
    });
});

describe('agent loop integration — cap → Continue → finish (matrix: Ask / any / cap reached)', () => {
    it('needs-continue after turn 10 and 20; once-true-then-false resolver finalizes done with ONE manifest', async () => {
        const fs = createInMemoryFs();
        // A model that wants a NEW write every turn, forever — only the cap
        // (executor default maxTurns 10) and the user's decision stop it.
        const handle = scriptedHandle((index) =>
            respond('', [
                call(`w${index}`, 'write_file', {
                    path: `gen/f${index}.jsx`,
                    content: `F${index}`,
                }),
            ]),
        );
        const decisions = [];

        const events = await collect(
            runTurn({
                prompt: 'generate the whole gallery',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
                onContinueDecision: async (info) => {
                    decisions.push(info);
                    return decisions.length === 1; // Continue once, then Stop here.
                },
            }),
        );

        // The resolver was consulted at BOTH caps, with cumulative spend
        // (15 tokens per scripted response).
        expect(decisions).toEqual([
            { turnsUsed: 10, spentTokens: 150 },
            { turnsUsed: 20, spentTokens: 300 },
        ]);
        const needs = events.filter((e) => e.type === 'needs-continue');
        expect(needs.map((e) => e.turnsUsed)).toEqual([10, 20]);
        expect(needs.map((e) => e.spentTokens)).toEqual([150, 300]);

        // Continue resumed the SAME loop: exactly 20 provider calls, the
        // 11th carrying the full first-10-turns history (no rebuild).
        expect(handle.calls).toHaveLength(20);
        expect(
            handle.calls[10].messages.filter((m) => m.role === 'assistant').length,
        ).toBe(10);

        // turn-progress shows the extended cap after the Continue.
        const progress = events.filter((e) => e.type === 'turn-progress');
        expect(progress).toHaveLength(20);
        expect(progress[9]).toMatchObject({ turn: 10, maxTurns: 10 });
        expect(progress[19]).toMatchObject({ turn: 20, maxTurns: 20 });

        // Cap-stop maps to done — with every file written so far.
        const doneEv = events[events.length - 1];
        expect(doneEv.type).toBe('done');
        expect(doneEv.files).toHaveLength(20);
        expect(doneEv.files[0]).toEqual({ path: '.lerret/gen/f0.jsx', op: 'create' });
        expect(doneEv.summary).toBe('Stopped at the step cap.');
        for (let i = 0; i < 20; i++) {
            expect(fs._files.get(`${PROJECT_ROOT}/.lerret/gen/f${i}.jsx`).content).toBe(`F${i}`);
        }

        // ONE user-perceived turn — ONE turnId, ONE manifest (the resume
        // reused the same snapshot manifest; the history did not fork).
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toHaveLength(1);
        expect(manifests[0].status).toBe('applied');
        expect(manifests[0].files).toHaveLength(20);
        expect(doneEv.turnId).toBe(manifests[0].id);
    });
});

describe('agent loop integration — abort mid-loop (matrix: any / any / Esc-stop)', () => {
    it('abort during the second provider round-trip → stopped terminal, stopped-mid-turn manifest, first write recorded', async () => {
        const fs = createInMemoryFs();
        const controller = new AbortController();
        const handle = scriptedHandle((index) => {
            if (index === 0) {
                return respond('', [
                    call('w1', 'write_file', { path: 'social/first.jsx', content: 'FIRST' }),
                ]);
            }
            // Stop pressed while the SECOND round-trip is in flight — the
            // loop's pre-execution re-check must drop this response's call.
            controller.abort();
            return respond('', [
                call('w2', 'write_file', { path: 'social/second.jsx', content: 'SECOND' }),
            ]);
        });

        const events = await collect(
            runTurn({
                prompt: 'write two files',
                signal: controller.signal,
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
            }),
        );

        // Terminal is stopped — never done, never error.
        const stoppedEv = events.find((e) => e.type === 'stopped');
        expect(stoppedEv).toBeDefined();
        expect(events[events.length - 1].type).toBe('stopped');
        expect(events.some((e) => e.type === 'done')).toBe(false);
        expect(events.some((e) => e.type === 'error')).toBe(false);

        // The pre-stop write landed; the post-abort one never executed.
        expect(fs._files.get(`${PROJECT_ROOT}/.lerret/social/first.jsx`).content).toBe('FIRST');
        expect(fs._files.has(`${PROJECT_ROOT}/.lerret/social/second.jsx`)).toBe(false);
        expect(events.filter((e) => e.type === 'writing').map((e) => e.file)).toEqual([
            '.lerret/social/first.jsx',
        ]);

        // Manifest finalized stopped-mid-turn WITH the pre-stop file recorded
        // (the partial turn stays revertible).
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests).toHaveLength(1);
        expect(manifests[0].status).toBe('stopped-mid-turn');
        expect(manifests[0].files.map((f) => f.path)).toEqual(['.lerret/social/first.jsx']);
        expect(stoppedEv.turnId).toBe(manifests[0].id);
    });
});

describe('agent loop integration — repetition guard (matrix: tool failure feedback)', () => {
    it('the IDENTICAL write_file in consecutive turns executes ONCE; the model is told via an isError result', async () => {
        const fs = createInMemoryFs();
        const handle = scriptedHandle(
            fromQueue([
                respond('Writing.', [
                    call('a1', 'write_file', { path: 'social/twice.jsx', content: 'SAME' }),
                ]),
                respond('Writing again.', [
                    call('a2', 'write_file', { path: 'social/twice.jsx', content: 'SAME' }),
                ]),
                respond('Done — wrote the card once.'),
            ]),
        );
        // Count backend writes to the PROJECT file (snapshot blob writes land
        // under .state/history and are excluded by the path filter).
        const realWrite = fs.writeFile.bind(fs);
        const projectWrites = [];
        fs.writeFile = async (path, content, opts) => {
            if (path.endsWith('/.lerret/social/twice.jsx')) projectWrites.push(path);
            return realWrite(path, content, opts);
        };

        const events = await collect(
            runTurn({
                prompt: 'make the card',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
            }),
        );

        // Executed once — one backend write, one writing event, one manifest entry.
        expect(projectWrites).toHaveLength(1);
        expect(events.filter((e) => e.type === 'writing')).toHaveLength(1);
        // …but the loop still surfaced BOTH requested calls to the UI.
        expect(events.filter((e) => e.type === 'tool-call' && e.name === 'write_file')).toHaveLength(2);

        // The THIRD provider call received the guard's synthetic isError result.
        expect(handle.calls).toHaveLength(3);
        const lastToolMsg = handle.calls[2].messages.filter((m) => m.role === 'tool').pop();
        expect(lastToolMsg.results).toHaveLength(1);
        expect(lastToolMsg.results[0].isError).toBe(true);
        expect(lastToolMsg.results[0].content).toMatch(/already performed this exact action/i);

        // Terminal done with the single file.
        const doneEv = events[events.length - 1];
        expect(doneEv.type).toBe('done');
        expect(doneEv.files).toEqual([{ path: '.lerret/social/twice.jsx', op: 'create' }]);
        const manifests = await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs });
        expect(manifests[0].files).toHaveLength(1);
    });
});

describe('agent loop integration — isError self-correction (matrix: tool failure)', () => {
    it('read_file on a missing path feeds an isError result back; the turn completes, never errors', async () => {
        const fs = createInMemoryFs();
        const handle = scriptedHandle(
            fromQueue([
                respond('Checking the file.', [
                    call('r1', 'read_file', { path: 'social/missing.jsx' }),
                ]),
                respond('That file does not exist, so there is nothing to retheme.'),
            ]),
        );

        const events = await collect(
            runTurn({
                prompt: 'retheme the missing card',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
            }),
        );

        // The turn did NOT error — the failure became conversation.
        expect(events.some((e) => e.type === 'error')).toBe(false);
        const doneEv = events[events.length - 1];
        expect(doneEv.type).toBe('done');
        expect(doneEv.files).toEqual([]);
        expect(doneEv.summary).toBe('That file does not exist, so there is nothing to retheme.');

        // The SECOND provider call carried the isError content.
        expect(handle.calls).toHaveLength(2);
        const toolMsg = handle.calls[1].messages.filter((m) => m.role === 'tool').pop();
        expect(toolMsg.results[0].isError).toBe(true);
        expect(toolMsg.results[0].content).toMatch(/Could not read \.lerret\/social\/missing\.jsx/);

        // A failed read emits no reading event (the executor omits meta on error).
        expect(
            events.some((e) => e.type === 'reading' && e.file === '.lerret/social/missing.jsx'),
        ).toBe(false);
    });
});

describe('agent loop integration — inspect lane zero mutations (matrix: Inspect / any / question)', () => {
    it('a tool-capable inspect turn loops with READ_TOOLS only: no writes, no manifest, done files []', async () => {
        const fs = createInMemoryFs();
        seedFs(fs, {
            [`${PROJECT_ROOT}/.lerret/social/card.jsx`]: 'export const Card = () => null;',
        });
        const before = [...fs._files.keys()].sort();
        const handle = scriptedHandle(
            fromQueue([
                respond('', [
                    call('i1', 'list_dir', { path: '.lerret/' }),
                    call('i2', 'read_file', { path: 'social/card.jsx' }),
                ]),
                respond('You have one social asset: .lerret/social/card.jsx.'),
            ]),
        );

        const events = await collect(
            runTurn({
                prompt: 'what assets do I have?',
                mode: 'inspect',
                projectRoot: PROJECT_ROOT,
                fs,
                resolver: mockResolver(handle),
            }),
        );

        // STRUCTURAL: the inspect lane's registry offered the read pair only —
        // the write tools do not exist in its tool list.
        expect(handle.calls[0].tools.map((t) => t.name)).toEqual(['list_dir', 'read_file']);
        // The inspect loop runs at its own (6-turn) cap, not the Ask default.
        const progress = events.filter((e) => e.type === 'turn-progress');
        expect(progress.length).toBeGreaterThan(0);
        expect(progress.every((e) => e.maxTurns === 6)).toBe(true);

        // The loop actually explored (reads surfaced), and mutated NOTHING.
        expect(events.filter((e) => e.type === 'tool-call').map((e) => e.name)).toEqual([
            'list_dir',
            'read_file',
        ]);
        expect(
            events.some((e) => e.type === 'reading' && e.file === '.lerret/social/card.jsx'),
        ).toBe(true);
        expect(
            events.filter((e) => ['writing', 'deleting', 'mkdir'].includes(e.type)),
        ).toEqual([]);
        expect([...fs._files.keys()].sort()).toEqual(before);

        // One inspector-response with the loop's closing text; done files []
        // and NO turnId; NO manifest — the revert timeline did not grow.
        const responses = events.filter((e) => e.type === 'inspector-response');
        expect(responses).toHaveLength(1);
        expect(responses[0].answer).toBe('You have one social asset: .lerret/social/card.jsx.');
        const doneEv = events[events.length - 1];
        expect(doneEv.type).toBe('done');
        expect(doneEv.files).toEqual([]);
        expect(doneEv).not.toHaveProperty('turnId');
        expect(await snapshot.listManifests({ projectRoot: PROJECT_ROOT, fs })).toEqual([]);
    });
});
