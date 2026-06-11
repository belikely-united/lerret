// Tests for the vision submit-gate hook (Story 8.7, UX-delta §4.7). jsdom.
//
// Coverage (AC-7/8/9/13/18/19 + AC-22's gate bullets):
//   - not required → run,
//   - required + vision-capable active model → run,
//   - required + non-vision active + NO cloud candidate → blocked-state-a
//     (verbatim note + 1500ms pill flash; turn consumed),
//   - required + non-vision active + cloud configured → prompt with the
//     populated cloud eligibleProviders (family-default + active + local
//     handles filtered out),
//   - getAi() null → fail-safe run,
//   - onVisionDecision mirrors runTurn's resolver contract: accept →
//     { accept: true, providerOverride: name }; decline / no machinery →
//     { accept: false }.
//
// getAi() is mocked at the lazy boundary; ai.vision.* are behavior stubs
// (the real router semantics are pinned in packages/ai/src/vision/router.test.js).

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── getAi() mock ──────────────────────────────────────────────────────────────
const aiMock = { current: /** @type {object | null} */ (null) };
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import {
    useVisionGate,
    VISION_STATE_A_NOTE,
    VISION_PILL_LABEL,
    VISION_PILL_MS,
} from './use-vision-gate.js';
import { AiContextProvider } from './ai-context.jsx';

// ── Test infra ────────────────────────────────────────────────────────────────

let mounted = [];

function renderToDom(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(element);
    });
    const handle = {
        container,
        rerender(el) {
            act(() => root.render(el));
        },
        cleanup() {
            act(() => root.unmount());
            container.remove();
        },
    };
    mounted.push(handle);
    return handle;
}

async function tick(ms = 10) {
    await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
    });
}

afterEach(() => {
    for (const m of mounted) m.cleanup();
    mounted = [];
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/** Probe component exposing the live hook value to the test body. */
function Probe({ gateRef, requestDecision }) {
    const gate = useVisionGate({ requestDecision });
    // Publish the latest hook value AFTER commit (refs must not be written
    // during render); act() flushes effects, so tests read a fresh value.
    React.useEffect(() => {
        gateRef.current = gate;
    });
    return gate.stateANote ? <span data-testid="state-a-note">{gate.stateANote}</span> : null;
}

const ANTHROPIC_HANDLE = Object.freeze({
    providerName: 'anthropic',
    label: 'Anthropic',
    model: 'claude-sonnet-4-6',
    variant: 'cloud-byok',
    source: 'configured',
});

/**
 * Stub @lerret/ai. The vision stubs mirror the real router for the fixture
 * matrix: ollama/llama3.2 non-vision, anthropic/claude-sonnet-4-6 vision.
 */
function makeAi({ configs, eligible }) {
    return {
        vault: {
            listProviderConfigs: async () => configs,
            isDisclosureAcked: async () => true,
        },
        vision: {
            isVisionRequired: (prompt, attachments) =>
                Array.isArray(attachments) &&
                attachments.some((a) => a && (a.kind === 'image' || a.type === 'image')),
            supportsVision: (provider, model) =>
                (provider === 'anthropic' && model === 'claude-sonnet-4-6') ||
                (provider === 'ollama' && model === 'llava'),
            eligibleVisionProviders: vi.fn(() => eligible),
        },
    };
}

const OLLAMA_ACTIVE = { providerName: 'ollama', active: true, model: 'llama3.2', configuredAt: '2026-06-01T00:00:00.000Z' };
const ANTHROPIC_INACTIVE = { providerName: 'anthropic', active: false, model: 'claude-sonnet-4-6', configuredAt: '2026-06-02T00:00:00.000Z' };

function mountGate({ ai, requestDecision } = {}) {
    aiMock.current = ai ?? null;
    const gateRef = { current: null };
    const view = renderToDom(
        <AiContextProvider folderId="f1">
            <Probe gateRef={gateRef} requestDecision={requestDecision} />
        </AiContextProvider>,
    );
    return { gateRef, view };
}

async function evaluate(gateRef, turn) {
    let decision;
    await act(async () => {
        decision = await gateRef.current.evaluate(turn);
    });
    return decision;
}

// ── evaluate ──────────────────────────────────────────────────────────────────

describe('useVisionGate — evaluate', () => {
    it('not required (no image attachments) → run', async () => {
        const { gateRef } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
        });
        await tick();
        const d = await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'doc' }] });
        expect(d).toEqual({ action: 'run' });
        expect(gateRef.current.stateANote).toBeNull();
    });

    it('required + vision-capable active model → run (no prompt, no block)', async () => {
        const { gateRef } = mountGate({
            ai: makeAi({
                configs: [{ ...ANTHROPIC_INACTIVE, active: true }],
                eligible: [],
            }),
        });
        await tick(); // let AiContextProvider load configs
        const d = await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'image' }] });
        expect(d).toEqual({ action: 'run' });
    });

    it('required + non-vision active + no cloud candidate → blocked-state-a with verbatim note + 1500ms pill', async () => {
        const { gateRef, view } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
        });
        await tick();

        vi.useFakeTimers();
        const d = await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'image' }] });
        expect(d).toEqual({ action: 'blocked-state-a' });

        // The verbatim inline note renders (AC-8) and the pill signal is armed (AC-7).
        expect(view.container.querySelector('[data-testid="state-a-note"]').textContent).toBe(
            "This model can't see images. Configure a cloud provider in settings to enable vision.",
        );
        expect(gateRef.current.pillFlash).toBe(true);
        expect(VISION_PILL_LABEL).toBe('Vision unavailable');

        // The pill flash auto-clears after exactly VISION_PILL_MS (1500ms)…
        await act(async () => {
            vi.advanceTimersByTime(VISION_PILL_MS - 1);
        });
        expect(gateRef.current.pillFlash).toBe(true);
        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(gateRef.current.pillFlash).toBe(false);
        // …while the note stays (sticky guidance) until cleared / re-evaluated.
        expect(gateRef.current.stateANote).toBe(VISION_STATE_A_NOTE);
    });

    it('required + non-vision active + cloud configured → prompt with the cloud candidates only', async () => {
        const ai = makeAi({
            configs: [OLLAMA_ACTIVE, ANTHROPIC_INACTIVE],
            eligible: [
                ANTHROPIC_HANDLE,
                // Family-default handles, the active provider, and local
                // handles must all be filtered out of the State B prompt.
                { providerName: 'openai', label: 'OpenAI', model: 'gpt-4o', variant: 'cloud-byok', source: 'default' },
                { providerName: 'ollama', label: 'Ollama', model: 'llava', variant: 'local-keyless', source: 'configured' },
            ],
        });
        const { gateRef } = mountGate({ ai });
        await tick();
        const d = await evaluate(gateRef, { prompt: 'p', attachments: [{ type: 'image' }] });
        expect(d.action).toBe('prompt');
        expect(d.eligibleProviders).toEqual([ANTHROPIC_HANDLE]);
        // The router was consulted with the folder's provider configs.
        expect(ai.vision.eligibleVisionProviders).toHaveBeenCalledWith(
            expect.arrayContaining([expect.objectContaining({ providerName: 'anthropic' })]),
        );
        // State A feedback is NOT armed on the prompt path.
        expect(gateRef.current.stateANote).toBeNull();
        expect(gateRef.current.pillFlash).toBe(false);
    });

    it('a fresh evaluate clears the previous State A note', async () => {
        const { gateRef } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
        });
        await tick();
        await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'image' }] });
        expect(gateRef.current.stateANote).toBe(VISION_STATE_A_NOTE);
        // Next submission is text-only → the stale note clears.
        const d = await evaluate(gateRef, { prompt: 'p2', attachments: [] });
        expect(d).toEqual({ action: 'run' });
        expect(gateRef.current.stateANote).toBeNull();
    });

    it('fail-safe: getAi() → null (or a build without ai.vision) lets the turn run', async () => {
        const { gateRef } = mountGate({ ai: null });
        await tick();
        const d = await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'image' }] });
        expect(d).toEqual({ action: 'run' });

        aiMock.current = { vault: { listProviderConfigs: async () => [], isDisclosureAcked: async () => true } }; // no vision namespace
        const d2 = await evaluate(gateRef, { prompt: 'p', attachments: [{ kind: 'image' }] });
        expect(d2).toEqual({ action: 'run' });
    });
});

// ── onVisionDecision (the runTurn resolver mirror) ────────────────────────────

describe('useVisionGate — onVisionDecision (AC-18/19)', () => {
    const EVENT = Object.freeze({
        type: 'needs-vision-fallback',
        requiredCapability: 'vision',
        eligibleProviders: Object.freeze([{ name: 'anthropic', model: 'claude-sonnet-4-6' }]),
    });

    it('accept via the prompt machinery → { accept: true, providerOverride: name }', async () => {
        const requestDecision = vi.fn(async (eligible) => ({ accept: true, handle: eligible[0] }));
        const { gateRef } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
            requestDecision,
        });
        await tick();
        let decision;
        await act(async () => {
            decision = await gateRef.current.onVisionDecision(EVENT);
        });
        expect(requestDecision).toHaveBeenCalledWith(EVENT.eligibleProviders);
        expect(decision).toEqual({ accept: true, providerOverride: 'anthropic' });
    });

    it('decline via the prompt machinery → { accept: false } (no providerOverride)', async () => {
        const requestDecision = vi.fn(async () => ({ accept: false }));
        const { gateRef } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
            requestDecision,
        });
        await tick();
        let decision;
        await act(async () => {
            decision = await gateRef.current.onVisionDecision(EVENT);
        });
        expect(decision).toEqual({ accept: false });
    });

    it('declines when no prompt machinery is injected or the event has no candidates', async () => {
        const { gateRef } = mountGate({
            ai: makeAi({ configs: [OLLAMA_ACTIVE], eligible: [] }),
        });
        await tick();
        let d1;
        let d2;
        await act(async () => {
            d1 = await gateRef.current.onVisionDecision(EVENT);
        });
        expect(d1).toEqual({ accept: false });

        const requestDecision = vi.fn();
        mounted[0].rerender(
            <AiContextProvider folderId="f1">
                <Probe gateRef={gateRef} requestDecision={requestDecision} />
            </AiContextProvider>,
        );
        await act(async () => {
            d2 = await gateRef.current.onVisionDecision({ ...EVENT, eligibleProviders: [] });
        });
        expect(d2).toEqual({ accept: false });
        expect(requestDecision).not.toHaveBeenCalled();
    });
});
