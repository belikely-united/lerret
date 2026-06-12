// @vitest-environment node
//
// Unit tests for the Planner — prompt → WorkerStep[] decomposition. Pins the
// Story 8.3 review fixes:
//   - parsePlan WHITELISTS ops (write/delete/mkdir); an unknown op yields a
//     visibly-empty plan rather than a step the Worker silently skips,
//   - the abort re-check immediately before the (expensive) LLM call,
//   - the vision-fallback decision routes through requestVisionDecision(),
// plus the later additions:
//   - FR56 image DELIVERY: a payload-bearing image attachment reaches
//     complete() as a provider-neutral multipart user message when the
//     resolved handle's model supports vision (text-only fallback otherwise),
//   - Story 8.8 workflow delegation: recognized launch-kit / social-variants
//     prompts with a sandbox bypass the provider entirely.

import { describe, it, expect, vi } from 'vitest';

import { createPlannerNode, parsePlan, parsePlanResult } from './planner.js';

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

    it('teaches the Lerret asset contract (meta + default-export JSX, no .html) in the system prompt', async () => {
        // Without this the live model produces plausible-but-unloadable files
        // (.html pages) — found by the Epic 8 close live-model session.
        const providerHandle = makeHandle();
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'make a pricing card',
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).toMatch(/export const meta = \{ dimensions/);
        expect(sys).toMatch(/export default function/);
        expect(sys).toMatch(/Never\s+write \.html files/);
        expect(sys).toMatch(/inline style objects only/);
    });

    it('teaches the design-system brand-authority edit + the empty-plan note escape hatch', async () => {
        // "change color to blue gradient" with nothing selected planned ZERO
        // steps — the contract forbade writing the brand .md and offered no
        // way to explain itself (live user-testing finding, 2026-06-12).
        const providerHandle = makeHandle();
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'change color to blue gradient',
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).toMatch(/_design-system\.md is the project's brand authority/);
        expect(sys).toMatch(/PROJECT-WIDE look request/);
        expect(sys).toMatch(/rewriting \.lerret\/_design-system\.md in place/);
        expect(sys).toMatch(/\{"steps":\[\],"note":/);
    });
});

describe('createPlannerNode — empty-plan clarifying note', () => {
    it('surfaces the model\'s note when the plan is empty', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle({
            content: '{"steps":[],"note":"Select the pricing card on the canvas and resend."}',
        });
        const out = await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({
            prompt: 'change the pricing card',
        });
        expect(out.plan).toEqual([]);
        const notes = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === 'clarifying-note');
        expect(notes).toHaveLength(1);
        expect(notes[0].note).toBe('Select the pricing card on the canvas and resend.');
    });

    it('falls back to the fixed pointer when the empty plan has no note (prose / unparseable)', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle({ content: 'Sorry, I am not sure which asset you mean.' });
        await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({
            prompt: 'change it',
        });
        const notes = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === 'clarifying-note');
        expect(notes).toHaveLength(1);
        expect(notes[0].note).toMatch(/selecting the\s+target asset on the canvas/);
    });

    it('emits NO clarifying note when the plan has steps', async () => {
        const emit = vi.fn();
        const providerHandle = makeHandle({
            content: JSON.stringify({ steps: [{ op: 'write', path: '.lerret/a.jsx', content: 'A' }] }),
        });
        await createPlannerNode({ providerHandle, emit, requestVisionDecision: vi.fn() })({
            prompt: 'make a',
        });
        const notes = emit.mock.calls.map((c) => c[0]).filter((e) => e.type === 'clarifying-note');
        expect(notes).toHaveLength(0);
    });
});

describe('parsePlanResult', () => {
    it('extracts steps and note together', () => {
        const r = parsePlanResult('{"steps":[],"note":"pick an asset"}');
        expect(r.steps).toEqual([]);
        expect(r.note).toBe('pick an asset');
    });

    it('parses a bare-JSON plan whose file CONTENT embeds a fenced block (design-system rewrite)', () => {
        // The exact live shape that silently planned to nothing: the brand
        // file's ```lerret-tokens``` fence sits INSIDE the JSON string, and
        // the old fence-FIRST unwrap reduced the whole response to the YAML
        // between the embedded fences (live user-testing finding, 2026-06-12).
        const content = JSON.stringify({
            steps: [
                {
                    op: 'write',
                    path: '.lerret/_design-system.md',
                    content:
                        '# Design system\n\n```lerret-tokens\ncolors:\n  brand: "#1A4FA3"\n```\n\nBlue leads.\n',
                },
            ],
        });
        const r = parsePlanResult(content);
        expect(r.steps).toHaveLength(1);
        expect(r.steps[0].path).toBe('.lerret/_design-system.md');
        expect(r.steps[0].content).toContain('#1A4FA3');
    });

    it('still unwraps a response that is ONLY a fenced JSON block', () => {
        const r = parsePlanResult('```json\n{"steps":[{"op":"mkdir","path":".lerret/social"}]}\n```');
        expect(r.steps).toEqual([{ op: 'mkdir', path: '.lerret/social' }]);
    });

    it('still salvages prose-wrapped bare JSON', () => {
        const r = parsePlanResult(
            'Here is the plan: {"steps":[{"op":"write","path":".lerret/a.jsx","content":"A"}]} — done.',
        );
        expect(r.steps).toEqual([{ op: 'write', path: '.lerret/a.jsx', content: 'A' }]);
    });

    it('caps the note and ignores non-string notes', () => {
        const long = parsePlanResult(`{"steps":[],"note":"${'x'.repeat(500)}"}`);
        expect(long.note).toHaveLength(240);
        expect(parsePlanResult('{"steps":[],"note":42}').note).toBe('');
    });

    it('keeps parsePlan as the steps-only view', () => {
        expect(parsePlan('{"steps":[{"op":"write","path":".lerret/a.jsx","content":"A"}],"note":"n"}')).toEqual([
            { op: 'write', path: '.lerret/a.jsx', content: 'A' },
        ]);
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

describe('createPlannerNode — vision recognition (Story 8.7 router heuristic)', () => {
    // The Story 8.7 swap: the Planner now recognizes ALL the image-attachment
    // shapes in circulation via vision/router.js isVisionRequired — not just
    // the Story 8.3 `{ type: 'image' }` form.
    it.each([
        ['kind: image (studio attach-button shape)', { kind: 'image' }],
        ['mimeType: image/png (file-picker shape)', { mimeType: 'image/png' }],
    ])('routes through requestVisionDecision for %s', async (_label, attachment) => {
        const active = makeHandle({ vision: false });
        const override = {
            name: 'anthropic',
            model: 'claude-sonnet-4-6',
            modelSupportsVision: () => true,
            complete: vi.fn(async () => ({ content: '{"steps":[]}' })),
        };
        const requestVisionDecision = vi.fn(async () => override);
        await createPlannerNode({ providerHandle: active, emit: vi.fn(), requestVisionDecision })({
            prompt: 'p',
            attachments: [attachment],
        });
        expect(requestVisionDecision).toHaveBeenCalledTimes(1);
        expect(override.complete).toHaveBeenCalledTimes(1);
        expect(active.complete).not.toHaveBeenCalled();
    });

    it('non-image attachments do NOT trigger the vision decision (plans on the active handle)', async () => {
        const requestVisionDecision = vi.fn();
        const providerHandle = makeHandle({ vision: false });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision })({
            prompt: 'p',
            attachments: [{ type: 'file' }, { kind: 'doc' }, { mimeType: 'text/plain' }],
        });
        expect(requestVisionDecision).not.toHaveBeenCalled();
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });

    it('prompt text alone never triggers vision (v1 heuristic is attachment-only)', async () => {
        const requestVisionDecision = vi.fn();
        const providerHandle = makeHandle({ vision: false });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision })({
            prompt: 'look at this image and match the screenshot',
        });
        expect(requestVisionDecision).not.toHaveBeenCalled();
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });
});

describe('createPlannerNode — image payload delivery (FR56 is delivery, not just routing)', () => {
    const PAYLOAD_ATTACHMENT = Object.freeze({
        kind: 'image',
        type: 'image',
        mimeType: 'image/png',
        name: 'shot.png',
        base64: 'QUJD',
        dataUrl: 'data:image/png;base64,QUJD',
    });

    it('vision-capable handle + base64-bearing image attachment → multipart user message reaches complete', async () => {
        const providerHandle = makeHandle({ vision: true });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'match this screenshot',
            attachments: [PAYLOAD_ATTACHMENT],
        });
        const { messages } = providerHandle.complete.mock.calls[0][0];
        const user = messages.find((m) => m.role === 'user');
        expect(Array.isArray(user.content)).toBe(true);
        expect(user.content[0]).toEqual({ type: 'text', text: 'match this screenshot' });
        expect(user.content[1]).toEqual({
            type: 'image',
            mimeType: 'image/png',
            base64: 'QUJD',
            dataUrl: 'data:image/png;base64,QUJD',
        });
        // The system message stays a plain string — only the user turn is multipart.
        expect(typeof messages[0].content).toBe('string');
    });

    it('the override handle receives the multipart message when the active model lacks vision', async () => {
        const active = makeHandle({ vision: false });
        const overrideComplete = vi.fn(async () => ({ content: '{"steps":[]}' }));
        const override = {
            name: 'anthropic',
            model: 'claude-sonnet-4-6',
            modelSupportsVision: () => true,
            complete: overrideComplete,
        };
        await createPlannerNode({
            providerHandle: active,
            emit: vi.fn(),
            requestVisionDecision: vi.fn(async () => override),
        })({ prompt: 'p', attachments: [PAYLOAD_ATTACHMENT] });

        const user = overrideComplete.mock.calls[0][0].messages.find((m) => m.role === 'user');
        expect(Array.isArray(user.content)).toBe(true);
        expect(user.content.filter((b) => b.type === 'image')).toEqual([
            { type: 'image', mimeType: 'image/png', base64: 'QUJD', dataUrl: 'data:image/png;base64,QUJD' },
        ]);
        expect(active.complete).not.toHaveBeenCalled();
    });

    it('payload-less image attachments (legacy routing-only shape) fall back to a text-only string', async () => {
        const providerHandle = makeHandle({ vision: true });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'match this',
            attachments: [{ type: 'image' }], // no base64 / dataUrl — never crash
        });
        const user = providerHandle.complete.mock.calls[0][0].messages.find((m) => m.role === 'user');
        expect(user.content).toBe('match this');
    });

    it('a turn without attachments keeps the plain-string user message (backward compat)', async () => {
        const providerHandle = makeHandle({ vision: true });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'plain text turn',
        });
        const user = providerHandle.complete.mock.calls[0][0].messages.find((m) => m.role === 'user');
        expect(user.content).toBe('plain text turn');
    });
});

describe('createPlannerNode — recognized workflow delegation (Story 8.8 pin)', () => {
    // Minimal stub sandbox: nothing exists, every read fails — enough for the
    // deterministic planners' graceful-absence paths.
    const stubSandbox = {
        exists: async () => false,
        readFile: async () => {
            throw new Error('ENOENT');
        },
    };

    it('a recognized launch-kit prompt with a sandbox returns the workflow plan — provider NEVER called', async () => {
        const providerHandle = makeHandle();
        const out = await createPlannerNode({
            providerHandle,
            emit: vi.fn(),
            requestVisionDecision: vi.fn(),
            sandbox: stubSandbox,
        })({ prompt: 'launch kit for twitter' });

        expect(providerHandle.complete).not.toHaveBeenCalled();
        expect(out.plan.map((s) => `${s.op} ${s.path}`)).toEqual([
            'mkdir .lerret/social-media/twitter',
            'write .lerret/social-media/twitter/launch.jsx',
            'write .lerret/social-media/twitter/launch.data.json',
        ]);
    });

    it('the same prompt WITHOUT a sandbox falls through to the LLM path (complete called)', async () => {
        const providerHandle = makeHandle();
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'launch kit for twitter',
        });
        expect(providerHandle.complete).toHaveBeenCalledTimes(1);
    });

    it('a recognized social-variants prompt routes to planSocialVariants — zero provider calls', async () => {
        const providerHandle = makeHandle();
        const out = await createPlannerNode({
            providerHandle,
            emit: vi.fn(),
            requestVisionDecision: vi.fn(),
            sandbox: stubSandbox,
        })({ prompt: 'three more in the same style as social-media/twitter/launch-1.jsx' });

        expect(providerHandle.complete).not.toHaveBeenCalled();
        // The stub sandbox has no reference component, so the W3 planner's
        // existence probe yields the EMPTY plan — the pin here is the ROUTE
        // (deterministic planner, no LLM round-trip), not the plan content.
        expect(out.plan).toEqual([]);
    });
});

describe('parsePlan — prose-wrapped JSON salvage (live-model finding)', () => {
    it('salvages the outermost {...} when the model wraps the plan in prose', () => {
        const plan = parsePlan(
            'Here is the plan you asked for:\n' +
                '{"steps":[{"op":"write","path":".lerret/a.jsx","content":"A"}]}\n' +
                'Let me know if you want changes.',
        );
        expect(plan).toEqual([{ op: 'write', path: '.lerret/a.jsx', content: 'A' }]);
    });

    it('still returns [] when there is no JSON object at all', () => {
        expect(parsePlan('I cannot see the file, please share it.')).toEqual([]);
    });
});

describe('createPlannerNode — selection-scoped file context (live-model finding)', () => {
    function makeScopedSandbox(files) {
        return {
            exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
            readFile: vi.fn(async (p) => {
                if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
                return files[p];
            }),
        };
    }

    it("folds the chip-scoped file's CURRENT content into the planning prompt (with .lerret/ prefix fallback)", async () => {
        const providerHandle = makeHandle();
        const sandbox = makeScopedSandbox({
            '.lerret/pricing/card.jsx': 'export default function Card() { return <div>$89</div>; }',
        });
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn(), sandbox })({
            prompt: 'change the price to $79',
            scope: { kind: 'file', filePath: 'pricing/card.jsx', label: 'card.jsx' },
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).toContain('--- .lerret/pricing/card.jsx (current content) ---');
        expect(sys).toContain('$89');
        expect(sys).toMatch(/COMPLETE updated file/);
    });

    it('no file scope (or no sandbox) → no scoped block, planning proceeds as before', async () => {
        const providerHandle = makeHandle();
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn() })({
            prompt: 'make a card',
            scope: { kind: 'project' },
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).not.toContain('current content');
    });
});

describe('createPlannerNode — element pinpoint (chip › element)', () => {
    it('folds the clicked element into the scoped prompt so the request targets it', async () => {
        const providerHandle = makeHandle();
        const sandbox = {
            exists: vi.fn(async () => true),
            readFile: vi.fn(async () => 'export default function Card() { return <div>$79</div>; }'),
        };
        await createPlannerNode({ providerHandle, emit: vi.fn(), requestVisionDecision: vi.fn(), sandbox })({
            prompt: 'make this bigger',
            scope: {
                kind: 'file',
                filePath: 'pricing/card.jsx',
                element: { text: '$79', tag: 'div' },
            },
        });
        const sys = providerHandle.complete.mock.calls[0][0].messages[0].content;
        expect(sys).toContain('clicked the <div> element containing "$79"');
        expect(sys).toMatch(/apply the request to that element specifically/);
    });
});
