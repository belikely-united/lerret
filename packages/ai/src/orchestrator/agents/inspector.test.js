// @vitest-environment node
//
// Unit tests for the Inspector node — read-only project Q&A (FR58). Pins:
//   - it answers via the provider handle and emits thinking → tool-call('inspect'),
//   - it is structurally write-free (createInspectorNode takes no sandbox),
//   - the abort guards: pre-aborted short-circuits with no provider call; an
//     abort that lands after Memory (before the LLM call) skips the round-trip.

import { describe, it, expect, vi } from 'vitest';

import { createInspectorNode } from './inspector.js';

function makeHandle(content = 'the answer') {
    return {
        name: 'openai',
        model: 'gpt-4o',
        complete: vi.fn(async () => ({ content })),
    };
}

describe('createInspectorNode — answer path', () => {
    it('emits thinking + tool-call(inspect) and returns the provider answer', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle('42 components');
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'how many?' });

        expect(out).toEqual({ answer: '42 components' });
        const types = emit.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['thinking', 'tool-call']);
        expect(emit.mock.calls[1][0].name).toBe('inspect');
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });

    it('injects the Memory context into the system prompt', async () => {
        const providerHandle = makeHandle();
        await createInspectorNode({ providerHandle, emit: vi.fn() })({
            prompt: 'q',
            context: 'PROJECT_FACTS',
        });
        const sysMsg = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sysMsg).toMatch(/read-only project inspector/);
        expect(sysMsg).toMatch(/PROJECT_FACTS/);
    });

    it('returns answer:"" when the provider yields no content', async () => {
        const providerHandle = { name: 'openai', model: 'gpt-4o', complete: vi.fn(async () => ({})) };
        const out = await createInspectorNode({ providerHandle, emit: vi.fn() })({ prompt: 'q' });
        expect(out).toEqual({ answer: '' });
    });

    it('is write-free: the factory accepts no sandbox and the node returns only { answer }', async () => {
        const out = await createInspectorNode({ providerHandle: makeHandle(), emit: vi.fn() })({ prompt: 'q' });
        expect(Object.keys(out)).toEqual(['answer']);
    });
});

describe('createInspectorNode — abort guards', () => {
    it('pre-aborted signal: no thinking event, no provider call, answer ""', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const controller = new AbortController();
        controller.abort();
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q', signal: controller.signal });
        expect(out).toEqual({ answer: '' });
        expect(emit).not.toHaveBeenCalled();
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });

    it('abort after Memory (between the two guards) skips the LLM round-trip', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        // aborted is false on the entry guard, true on the pre-complete guard.
        let reads = 0;
        const signal = {
            get aborted() {
                reads += 1;
                return reads > 1;
            },
        };
        const out = await createInspectorNode({ providerHandle, emit })({ prompt: 'q', signal });
        expect(out).toEqual({ answer: '' });
        // thinking() was emitted (entry guard passed) but complete() was skipped.
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking']);
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });
});
