import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { runAgentLoop } from './loop.js';

// ─── Scripted fake provider ──────────────────────────────────────────────────
// A queue of canned `completeWithTools` responses; each request is snapshotted
// (shallow message-list copy) so tests can assert history growth even though
// the loop mutates the same array in place.

function makeProvider(script) {
    const queue = [...script];
    const requests = [];
    return {
        requests,
        handle: {
            completeWithTools: vi.fn(async (req) => {
                requests.push({ ...req, messages: [...req.messages] });
                if (queue.length === 0) throw new Error('scripted provider exhausted');
                return queue.shift();
            }),
        },
    };
}

const TOOLS = [
    { name: 'list_dir' },
    { name: 'read_file' },
    { name: 'write_file' },
    { name: 'delete_file' },
];

const usage = (inputTokens, outputTokens) => ({ inputTokens, outputTokens });
const tc = (id, name, args) => ({ id, name, args });

function initialMessages(userContent = 'retheme the twitter banner') {
    return [
        { role: 'system', content: 'asset contract + brand rules' },
        { role: 'user', content: userContent },
    ];
}

function collector() {
    const events = [];
    return { events, emit: (ev) => events.push(ev) };
}

// Executors that log invocations and return meta the way Story 9.3's real
// executors will (op + file drive the reading/writing/deleting events).
function makeExecutors(overrides = {}) {
    const invocations = [];
    const executors = {
        list_dir: async (args) => {
            invocations.push(['list_dir', args]);
            return { content: 'social · dir', meta: { op: 'list', file: args.path } };
        },
        read_file: async (args) => {
            invocations.push(['read_file', args]);
            return { content: 'old content', meta: { op: 'read', file: args.path } };
        },
        write_file: async (args) => {
            invocations.push(['write_file', args]);
            return { content: 'ok', meta: { op: 'write', file: args.path } };
        },
        delete_file: async (args) => {
            invocations.push(['delete_file', args]);
            return { content: 'ok', meta: { op: 'delete', file: args.path } };
        },
        ...overrides,
    };
    return { invocations, executors };
}

describe('runAgentLoop — happy path', () => {
    it('runs list → read → write → done across four provider turns with the pinned event order', async () => {
        const provider = makeProvider([
            { text: 'Looking around.', toolCalls: [tc('c1', 'list_dir', { path: '.lerret/' })], usage: usage(10, 5) },
            { text: 'Reading the banner.', toolCalls: [tc('c2', 'read_file', { path: 'social/banner.jsx' })], usage: usage(20, 5) },
            { text: '', toolCalls: [tc('c3', 'write_file', { path: 'social/banner.jsx', content: 'new' })], usage: usage(30, 10) },
            { text: 'Rethemed the banner to the design system.', toolCalls: [], usage: usage(5, 15) },
        ]);
        const { invocations, executors } = makeExecutors();
        const { events, emit } = collector();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages,
            emit,
        });

        expect(result.status).toBe('done');
        expect(result.text).toBe('Rethemed the banner to the design system.');
        expect(result.usage).toEqual({ inputTokens: 65, outputTokens: 35, calls: 4 });
        expect(result.steps).toEqual([
            { name: 'list_dir', args: { path: '.lerret/' }, isError: false },
            { name: 'read_file', args: { path: 'social/banner.jsx' }, isError: false },
            { name: 'write_file', args: { path: 'social/banner.jsx', content: 'new' }, isError: false },
        ]);
        expect(invocations.map(([name]) => name)).toEqual(['list_dir', 'read_file', 'write_file']);

        // Pinned event order: thinking → tool-call → reading/writing → turn-progress, per turn.
        expect(events.map((e) => e.type)).toEqual([
            'thinking', 'tool-call', 'reading', 'turn-progress',
            'thinking', 'tool-call', 'reading', 'turn-progress',
            'thinking', 'tool-call', 'writing', 'turn-progress',
            'thinking', 'turn-progress',
        ]);
        expect(events[1]).toMatchObject({ type: 'tool-call', name: 'list_dir' });
        expect(events[2]).toMatchObject({ type: 'reading', file: '.lerret/' });
        expect(events[3]).toEqual({ type: 'turn-progress', turn: 1, maxTurns: 10, spentTokens: 15 });
        expect(events[6]).toMatchObject({ type: 'reading', file: 'social/banner.jsx' });
        expect(events[10]).toMatchObject({ type: 'writing', file: 'social/banner.jsx' });
        // spentTokens is CUMULATIVE: 15 → 40 → 80 → 100.
        expect(events[7]).toMatchObject({ type: 'turn-progress', turn: 2, spentTokens: 40 });
        expect(events[11]).toMatchObject({ type: 'turn-progress', turn: 3, spentTokens: 80 });
        expect(events[13]).toEqual({ type: 'turn-progress', turn: 4, maxTurns: 10, spentTokens: 100 });

        // History: initial 2 + (assistant + tool) × 3 tool turns = 8.
        expect(messages).toHaveLength(8);
        expect(messages[2]).toEqual({
            role: 'assistant',
            content: 'Looking around.',
            toolCalls: [tc('c1', 'list_dir', { path: '.lerret/' })],
        });
        expect(messages[3]).toEqual({
            role: 'tool',
            results: [{ callId: 'c1', name: 'list_dir', content: 'social · dir' }],
        });

        // The provider sees the GROWING history and the tools on every request.
        expect(provider.requests[0].messages).toHaveLength(2);
        expect(provider.requests[1].messages).toHaveLength(4);
        expect(provider.requests[3].messages).toHaveLength(8);
        for (const req of provider.requests) expect(req.tools).toBe(TOOLS);
    });

    it('zero tool calls on the first response → immediate done with the summary text', async () => {
        const provider = makeProvider([
            { text: 'The project has 3 pages.', toolCalls: [], usage: usage(7, 3) },
        ]);
        const { events, emit } = collector();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages,
            emit,
        });

        expect(result).toEqual({
            status: 'done',
            text: 'The project has 3 pages.',
            usage: { inputTokens: 7, outputTokens: 3, calls: 1 },
            steps: [],
        });
        expect(events.map((e) => e.type)).toEqual(['thinking', 'turn-progress']);
        expect(events[1]).toEqual({ type: 'turn-progress', turn: 1, maxTurns: 10, spentTokens: 10 });
        expect(messages).toHaveLength(2); // history untouched
    });

    it('treats message content as opaque — multipart blocks pass through by reference', async () => {
        const blocks = [{ type: 'text', text: 'match this' }, { type: 'image', base64: 'aaa' }];
        const provider = makeProvider([{ text: 'ok', toolCalls: [], usage: usage(1, 1) }]);

        await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: {},
            messages: initialMessages(blocks),
            emit: () => {},
        });

        expect(provider.requests[0].messages[1].content).toBe(blocks);
    });
});

describe('runAgentLoop — turn cap and Continue?', () => {
    const cappedScript = (turns) =>
        Array.from({ length: turns }, (_, i) => ({
            text: `Working (${i + 1}).`,
            toolCalls: [tc(`c${i + 1}`, 'read_file', { path: `f${i + 1}.jsx` })],
            usage: usage(10, 5),
        }));

    it('onContinueDecision → true extends the cap by maxTurns and resumes the SAME history', async () => {
        const provider = makeProvider([
            ...cappedScript(3),
            { text: 'All done.', toolCalls: [], usage: usage(10, 5) },
        ]);
        const onContinueDecision = vi.fn(async () => true);
        const { events, emit } = collector();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages,
            emit,
            maxTurns: 2,
            onContinueDecision,
        });

        expect(result.status).toBe('done');
        expect(result.text).toBe('All done.');
        expect(result.usage.calls).toBe(4);
        expect(onContinueDecision).toHaveBeenCalledTimes(1);
        expect(onContinueDecision).toHaveBeenCalledWith({ turnsUsed: 2, spentTokens: 30 });

        const needs = events.filter((e) => e.type === 'needs-continue');
        expect(needs).toEqual([{ type: 'needs-continue', turnsUsed: 2, spentTokens: 30 }]);
        // needs-continue lands right after turn 2's turn-progress…
        const idx = events.findIndex((e) => e.type === 'needs-continue');
        expect(events[idx - 1]).toMatchObject({ type: 'turn-progress', turn: 2, maxTurns: 2 });
        // …and the extended cap shows in the NEXT turn's progress.
        const turn3 = events.find((e) => e.type === 'turn-progress' && e.turn === 3);
        expect(turn3).toMatchObject({ maxTurns: 4, spentTokens: 45 });

        // Resume continued the same conversation: request 3 carries all prior turns.
        expect(provider.requests[2].messages).toHaveLength(6);
        expect(provider.requests[3].messages).toHaveLength(8);
    });

    it('onContinueDecision → false returns cap-stopped with the last response text', async () => {
        const provider = makeProvider(cappedScript(1));
        const { invocations, executors } = makeExecutors();
        const onContinueDecision = vi.fn(async () => false);

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages: initialMessages(),
            emit: () => {},
            maxTurns: 1,
            onContinueDecision,
        });

        expect(result.status).toBe('cap-stopped');
        expect(result.text).toBe('Working (1).');
        expect(result.usage.calls).toBe(1);
        // The capped turn's tools still executed before the decision.
        expect(invocations).toHaveLength(1);
        expect(result.steps).toHaveLength(1);
        expect(onContinueDecision).toHaveBeenCalledWith({ turnsUsed: 1, spentTokens: 15 });
    });

    it('NO onContinueDecision → cap-stopped immediately, needs-continue never emitted (headless safety)', async () => {
        const provider = makeProvider(cappedScript(1));
        const { events, emit } = collector();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages: initialMessages(),
            emit,
            maxTurns: 1,
        });

        expect(result.status).toBe('cap-stopped');
        expect(events.some((e) => e.type === 'needs-continue')).toBe(false);
        expect(provider.handle.completeWithTools).toHaveBeenCalledTimes(1);
    });
});

describe('runAgentLoop — repetition guard', () => {
    it('an identical consecutive call is NOT executed; it gets the synthetic isError result', async () => {
        const provider = makeProvider([
            {
                text: '',
                toolCalls: [
                    tc('c1', 'read_file', { path: 'a.jsx' }),
                    tc('c2', 'read_file', { path: 'a.jsx' }),
                ],
                usage: usage(10, 5),
            },
            { text: 'done', toolCalls: [], usage: usage(1, 1) },
        ]);
        const { invocations, executors } = makeExecutors();
        const { events, emit } = collector();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages,
            emit,
        });

        expect(result.status).toBe('done');
        expect(invocations).toHaveLength(1); // executor ran ONCE
        expect(messages[3].results[1]).toEqual({
            callId: 'c2',
            name: 'read_file',
            content:
                'You already performed this exact action. Choose a different action or finish with a summary.',
            isError: true,
        });
        expect(result.steps[1]).toEqual({ name: 'read_file', args: { path: 'a.jsx' }, isError: true });
        // tool-call announced for BOTH (one per model-requested call), but only one reading.
        expect(events.filter((e) => e.type === 'tool-call')).toHaveLength(2);
        expect(events.filter((e) => e.type === 'reading')).toHaveLength(1);
    });

    it('guards across provider turns — the last EXECUTED call is the comparator', async () => {
        const provider = makeProvider([
            { text: '', toolCalls: [tc('c1', 'read_file', { path: 'a.jsx' })], usage: usage(1, 1) },
            { text: '', toolCalls: [tc('c2', 'read_file', { path: 'a.jsx' })], usage: usage(1, 1) },
            { text: 'done', toolCalls: [], usage: usage(1, 1) },
        ]);
        const { invocations, executors } = makeExecutors();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages: initialMessages(),
            emit: () => {},
        });

        expect(result.status).toBe('done');
        expect(invocations).toHaveLength(1);
        expect(result.steps.map((s) => s.isError)).toEqual([false, true]);
    });

    it('non-consecutive repeats are allowed (a → b → a all execute)', async () => {
        const provider = makeProvider([
            {
                text: '',
                toolCalls: [
                    tc('c1', 'read_file', { path: 'a.jsx' }),
                    tc('c2', 'list_dir', { path: '.lerret/' }),
                    tc('c3', 'read_file', { path: 'a.jsx' }),
                ],
                usage: usage(1, 1),
            },
            { text: 'done', toolCalls: [], usage: usage(1, 1) },
        ]);
        const { invocations, executors } = makeExecutors();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages: initialMessages(),
            emit: () => {},
        });

        expect(invocations).toHaveLength(3);
        expect(result.steps.map((s) => s.isError)).toEqual([false, false, false]);
    });
});

describe('runAgentLoop — tool failure feedback (never a thrown turn)', () => {
    it('an unknown tool name gets a synthetic isError naming the valid tools', async () => {
        const provider = makeProvider([
            { text: '', toolCalls: [tc('c1', 'grep', { pattern: 'x' })], usage: usage(1, 1) },
            { text: 'done', toolCalls: [], usage: usage(1, 1) },
        ]);
        const { invocations, executors } = makeExecutors();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages,
            emit: () => {},
        });

        expect(result.status).toBe('done');
        expect(invocations).toHaveLength(0);
        const fed = messages[3].results[0];
        expect(fed.isError).toBe(true);
        expect(fed.content).toContain('Unknown tool "grep"');
        expect(fed.content).toContain('list_dir');
        expect(fed.content).toContain('write_file');
        expect(result.steps[0].isError).toBe(true);
    });

    it('a prototype-chain name like "constructor" hits the unknown-tool branch, never Object.prototype', async () => {
        const provider = makeProvider([
            { text: '', toolCalls: [tc('c1', 'constructor', {})], usage: usage(1, 1) },
            { text: 'done', toolCalls: [], usage: usage(1, 1) },
        ]);

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages: initialMessages(),
            emit: () => {},
        });

        expect(result.status).toBe('done');
        expect(result.steps[0]).toEqual({ name: 'constructor', args: {}, isError: true });
    });

    it('a throwing executor becomes an isError result and the loop continues', async () => {
        const provider = makeProvider([
            {
                text: '',
                toolCalls: [
                    tc('c1', 'read_file', { path: '../outside.txt' }),
                    tc('c2', 'read_file', { path: 'weird.jsx' }),
                ],
                usage: usage(1, 1),
            },
            { text: 'recovered', toolCalls: [], usage: usage(1, 1) },
        ]);
        const { executors } = makeExecutors({
            read_file: async (args) => {
                if (args.path === '../outside.txt') {
                    throw new Error('SandboxViolationError: path escapes .lerret/');
                }
                throw 'plain string failure'; // non-Error throw coerces too
            },
        });
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages,
            emit: () => {},
        });

        expect(result.status).toBe('done');
        expect(result.text).toBe('recovered');
        expect(messages[3].results[0]).toEqual({
            callId: 'c1',
            name: 'read_file',
            content: 'SandboxViolationError: path escapes .lerret/',
            isError: true,
        });
        expect(messages[3].results[1]).toMatchObject({
            callId: 'c2',
            content: 'plain string failure',
            isError: true,
        });
        expect(result.steps.map((s) => s.isError)).toEqual([true, true]);
    });
});

describe('runAgentLoop — abort (stop semantics)', () => {
    it('aborted before the first provider call → stopped with nothing spent, no events', async () => {
        const provider = makeProvider([]);
        const { events, emit } = collector();
        const messages = initialMessages();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages,
            signal: { aborted: true },
            emit,
        });

        expect(result).toEqual({
            status: 'stopped',
            text: '',
            usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
            steps: [],
        });
        expect(events).toEqual([]);
        expect(messages).toHaveLength(2);
        expect(provider.handle.completeWithTools).not.toHaveBeenCalled();
    });

    it('aborted between two tool executions → stopped; the second tool never runs', async () => {
        const signal = { aborted: false };
        const provider = makeProvider([
            {
                text: 'Working.',
                toolCalls: [
                    tc('c1', 'list_dir', { path: '.lerret/' }),
                    tc('c2', 'read_file', { path: 'a.jsx' }),
                ],
                usage: usage(10, 5),
            },
        ]);
        const invocations = [];
        const { executors } = makeExecutors({
            list_dir: async (args) => {
                invocations.push(['list_dir', args]);
                signal.aborted = true; // Esc lands mid-turn
                return { content: 'social · dir', meta: { op: 'list', file: args.path } };
            },
            read_file: async (args) => {
                invocations.push(['read_file', args]);
                return { content: 'old content', meta: { op: 'read', file: args.path } };
            },
        });
        const { events, emit } = collector();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages: initialMessages(),
            signal,
            emit,
        });

        expect(result.status).toBe('stopped');
        expect(result.text).toBe('Working.');
        expect(invocations).toEqual([['list_dir', { path: '.lerret/' }]]);
        expect(result.steps).toHaveLength(1);
        // No turn-progress: the turn was cut before its results were committed.
        expect(events.map((e) => e.type)).toEqual(['thinking', 'tool-call', 'reading']);
    });

    it('aborted after a completed turn → stopped before the next provider call', async () => {
        const signal = { aborted: false };
        const provider = makeProvider([
            { text: 'Looking.', toolCalls: [tc('c1', 'list_dir', { path: '.lerret/' })], usage: usage(10, 5) },
        ]);
        const { executors } = makeExecutors({
            list_dir: async (args) => {
                signal.aborted = true;
                return { content: 'social · dir', meta: { op: 'list', file: args.path } };
            },
        });
        const { events, emit } = collector();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors,
            messages: initialMessages(),
            signal,
            emit,
        });

        // One full turn committed (turn-progress emitted), then the re-check
        // before provider call #2 stops the loop. The provider is called once.
        expect(result.status).toBe('stopped');
        expect(result.usage.calls).toBe(1);
        expect(events.map((e) => e.type)).toEqual([
            'thinking', 'tool-call', 'reading', 'turn-progress',
        ]);
        expect(provider.handle.completeWithTools).toHaveBeenCalledTimes(1);
    });
});

describe('runAgentLoop — usage accounting', () => {
    it('accumulates across turns; a missing or malformed usage counts zero', async () => {
        const provider = makeProvider([
            { text: '', toolCalls: [tc('c1', 'list_dir', { path: '.lerret/' })] }, // no usage at all
            { text: 'done', toolCalls: [], usage: { inputTokens: '12', outputTokens: null } },
        ]);
        const { events, emit } = collector();

        const result = await runAgentLoop({
            providerHandle: provider.handle,
            tools: TOOLS,
            executors: makeExecutors().executors,
            messages: initialMessages(),
            emit,
        });

        expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 0, calls: 2 });
        const progress = events.filter((e) => e.type === 'turn-progress');
        expect(progress[0].spentTokens).toBe(0);
        expect(progress[1].spentTokens).toBe(12);
    });
});

describe('runAgentLoop — input contract', () => {
    it('rejects a providerHandle without completeWithTools', async () => {
        await expect(
            runAgentLoop({ providerHandle: {}, tools: TOOLS, executors: {}, messages: [] }),
        ).rejects.toThrow(/completeWithTools/);
    });

    it('rejects a missing messages history', async () => {
        await expect(
            runAgentLoop({
                providerHandle: { completeWithTools: async () => ({}) },
                tools: TOOLS,
                executors: {},
            }),
        ).rejects.toThrow(/messages/);
    });
});

describe('runAgentLoop — structural read-only guarantee', () => {
    it('loop.js imports NOTHING but the event factories (executors are injected)', () => {
        const src = readFileSync(new URL('./loop.js', import.meta.url), 'utf8');
        const specifiers = [...src.matchAll(/^import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(
            (m) => m[1],
        );
        expect(specifiers).toEqual(['../events.js']);
        expect(src).not.toMatch(/from\s+['"].*worker/);
        expect(src).not.toMatch(/from\s+['"]node:/);
    });
});
