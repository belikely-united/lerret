// @vitest-environment node
//
// Unit tests for the Planner — prompt → WorkerStep[] decomposition. Pins the
// Story 8.3 review fixes:
//   - parsePlan WHITELISTS ops (write/delete/mkdir); an unknown op yields a
//     visibly-empty plan rather than a step the Worker silently skips,
//   - the abort re-check immediately before the (expensive) LLM call,
//   - the vision-fallback decision routes through requestVisionDecision().

import { describe, it, expect, vi } from 'vitest';

import { createPlannerNode, parsePlan } from './planner.js';

describe('parsePlan', () => {
    it('keeps write/delete/mkdir steps with a string path', () => {
        const plan = parsePlan(
            JSON.stringify({
                steps: [
                    { op: 'write', path: '.lerret/a.jsx', content: 'A' },
                    { op: 'delete', path: '.lerret/b.jsx' },
                    { op: 'mkdir', path: '.lerret/dir' },
                ],
            }),
        );
        expect(plan.map((s) => s.op)).toEqual(['write', 'delete', 'mkdir']);
    });

    it('drops unknown ops (whitelist) and path-less steps', () => {
        const plan = parsePlan(
            JSON.stringify({
                steps: [
                    { op: 'exec', path: '.lerret/x' }, // not whitelisted
                    { op: 'write' }, // missing path
                    { op: 'write', path: 42 }, // non-string path
                    { op: 'write', path: '.lerret/ok.jsx', content: 'O' },
                ],
            }),
        );
        expect(plan).toEqual([{ op: 'write', path: '.lerret/ok.jsx', content: 'O' }]);
    });

    it('accepts a top-level array as well as a { steps } object', () => {
        const plan = parsePlan(JSON.stringify([{ op: 'mkdir', path: '.lerret/d' }]));
        expect(plan).toEqual([{ op: 'mkdir', path: '.lerret/d' }]);
    });

    it('unwraps a fenced ```json block', () => {
        const plan = parsePlan('```json\n{"steps":[{"op":"write","path":".lerret/a","content":"x"}]}\n```');
        expect(plan).toEqual([{ op: 'write', path: '.lerret/a', content: 'x' }]);
    });

    it('returns [] for non-string, unparseable, or non-array steps', () => {
        expect(parsePlan(undefined)).toEqual([]);
        expect(parsePlan('not json at all')).toEqual([]);
        expect(parsePlan(JSON.stringify({ steps: 'nope' }))).toEqual([]);
    });
});

function makeHandle({ vision = true, content = '{"steps":[]}' } = {}) {
    return {
        name: 'openai',
        model: 'gpt-4o',
        modelSupportsVision: vi.fn(() => vision),
        complete: vi.fn(async () => ({ content })),
    };
}

describe('createPlannerNode — decomposition', () => {
    it('emits thinking and returns the parsed plan', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle({
            content: JSON.stringify({ steps: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }] }),
        });
        const out = await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({ prompt: 'make a' });
        expect(emit.mock.calls[0][0].type).toBe('thinking');
        expect(out.plan).toEqual([{ op: 'write', path: '.lerret/a.jsx', content: 'A' }]);
    });

    it('injects brand tokens + context into the planning system prompt', async () => {
        const providerHandle = makeHandle();
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'p',
            brandTokens: { 'brand-orange': '#ff6600' },
            context: 'CTX',
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).toMatch(/brand-orange/);
        expect(sys).toMatch(/CTX/);
    });
});

describe('createPlannerNode — abort guard', () => {
    it('pre-aborted: returns { plan: [] }, no thinking, no provider call', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        const controller = new AbortController();
        controller.abort();
        const out = await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({
            prompt: 'p',
            signal: controller.signal,
        });
        expect(out).toEqual({ plan: [] });
        expect(emit).not.toHaveBeenCalled();
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });

    it('abort landing between entry guard and the LLM call skips the round-trip', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle();
        let reads = 0;
        const signal = {
            get aborted() {
                reads += 1;
                return reads > 1; // false at entry, true at the pre-complete re-check
            },
        };
        const out = await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({
            prompt: 'p',
            signal,
        });
        expect(out).toEqual({ plan: [] });
        expect(emit.mock.calls.map((c) => c[0].type)).toEqual(['thinking']);
        expect(providerHandle.complete).not.toHaveBeenCalled();
    });
});

describe('createPlannerNode — vision fallback', () => {
    it('routes the call through requestVisionDecision when an image needs vision the active model lacks', async () => {
        const active = makeHandle({ vision: false });
        const overrideComplete = vi.fn(async () => ({
            content: JSON.stringify({ steps: [{ op: 'write', path: '.lerret/v.jsx', content: 'V' }] }),
        }));
        const override = { name: 'anthropic', model: 'claude', modelSupportsVision: () => true, complete: overrideComplete };
        const requestVisionDecision = vi.fn(async () => override);

        const out = await createPlannerNode({ providerHandle: active, emit: vi.fn(), requestVisionDecision })({
            prompt: 'match screenshot',
            attachments: [{ type: 'image' }],
        });

        expect(requestVisionDecision).toHaveBeenCalledTimes(1);
        expect(overrideComplete).toHaveBeenCalledTimes(1);
        expect(active.complete).not.toHaveBeenCalled(); // active (no-vision) handle NOT used for the call
        expect(out.plan).toEqual([{ op: 'write', path: '.lerret/v.jsx', content: 'V' }]);
    });

    it('does not request a vision decision when the active model already supports vision', async () => {
        const requestVisionDecision = vi.fn();
        const providerHandle = makeHandle({ vision: true });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision })({
            prompt: 'p',
            attachments: [{ type: 'image' }],
        });
        expect(requestVisionDecision).not.toHaveBeenCalled();
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });
});
