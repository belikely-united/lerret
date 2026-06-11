// Tests for the State B one-off vision-fallback prompt (Story 8.7, UX-delta
// §4.7). jsdom.
//
// Coverage (AC-11/12/14/16/17 + AC-22's component bullets):
//   - exact copy with {ProviderName} filled (router-handle AND orchestrator-
//     event shapes),
//   - the ($) hint is a separate Mist-class span, not part of the provider name,
//   - Yes is default-focused on mount (keyboard-only confirm via Enter),
//   - Yes → onAccept(leadHandle) with the ORIGINAL handle object,
//   - Cancel and Esc → onCancel,
//   - NOT focus-trapped: Tab is not intercepted (unlike the privacy
//     disclosure), no aria-modal/dialog role,
//   - empty eligibleProviders renders nothing (State A is the host's branch).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { VisionFallbackPrompt } from './vision-fallback-prompt.jsx';

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

afterEach(() => {
    for (const m of mounted) m.cleanup();
    mounted = [];
    vi.restoreAllMocks();
});

const anthropicHandle = Object.freeze({
    providerName: 'anthropic',
    label: 'Anthropic',
    model: 'claude-sonnet-4-6',
    variant: 'cloud-byok',
    source: 'configured',
});
const openaiHandle = Object.freeze({
    providerName: 'openai',
    label: 'OpenAI',
    model: 'gpt-4o',
    variant: 'cloud-byok',
    source: 'configured',
});

// ── Copy ──────────────────────────────────────────────────────────────────────

describe('VisionFallbackPrompt — copy (AC-11/12)', () => {
    it('renders the verbatim prompt copy with {ProviderName} filled from the lead handle', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle, openaiHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const copy = container.querySelector('[data-testid="vision-fallback-copy"]');
        expect(copy.textContent).toBe(
            "This model can't see images. Run this turn with Anthropic ($) just this once?",
        );
        // Lead = first element (the array arrives pre-ordered by the router).
        expect(copy.textContent).not.toContain('OpenAI');
        // Button labels are part of the verbatim contract.
        expect(
            container.querySelector('[data-testid="vision-fallback-yes"]').textContent,
        ).toBe('Yes, this turn only');
        expect(
            container.querySelector('[data-testid="vision-fallback-cancel"]').textContent,
        ).toBe('Cancel');
    });

    it('normalizes the orchestrator needs-vision-fallback event shape ({ name, model })', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[{ name: 'openai', model: 'gpt-4o' }]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(
            container.querySelector('[data-testid="vision-fallback-copy"]').textContent,
        ).toBe("This model can't see images. Run this turn with OpenAI ($) just this once?");
    });

    it('renders the ($) hint as a distinct Mist-class span, not part of the provider name', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const hint = container.querySelector('[data-testid="vision-fallback-cost-hint"]');
        expect(hint.tagName).toBe('SPAN');
        expect(hint.textContent).toBe('($)');
        expect(hint.className).toContain('lm-vision-fallback__cost-hint');
        // The Mist token backs the hint color (Geist 12 hint per UX-delta §4.7).
        const styles = document.getElementById('vision-fallback-prompt-styles').textContent;
        expect(styles).toMatch(/__cost-hint\s*{[^}]*--lm-mist/);
    });

    it('renders nothing for an empty eligibleProviders array (State A is the host branch)', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt eligibleProviders={[]} onAccept={() => {}} onCancel={() => {}} />,
        );
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
    });
});

// ── Actions ───────────────────────────────────────────────────────────────────

describe('VisionFallbackPrompt — actions (AC-13/14)', () => {
    it('Yes invokes onAccept with the ORIGINAL lead handle object', () => {
        const onAccept = vi.fn();
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle, openaiHandle]}
                onAccept={onAccept}
                onCancel={() => {}}
            />,
        );
        act(() => {
            container.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        expect(onAccept).toHaveBeenCalledTimes(1);
        expect(onAccept.mock.calls[0][0]).toBe(anthropicHandle); // identity, not a copy
    });

    it('Cancel invokes onCancel (and never onAccept)', () => {
        const onAccept = vi.fn();
        const onCancel = vi.fn();
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={onAccept}
                onCancel={onCancel}
            />,
        );
        act(() => {
            container.querySelector('[data-testid="vision-fallback-cancel"]').click();
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onAccept).not.toHaveBeenCalled();
    });

    it('Esc anywhere inside the prompt invokes onCancel (AC-17)', () => {
        const onCancel = vi.fn();
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={onCancel}
            />,
        );
        const prompt = container.querySelector('[data-testid="vision-fallback-prompt"]');
        act(() => {
            prompt.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
            );
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

// ── Keyboard / focus (AC-16/17) ───────────────────────────────────────────────

describe('VisionFallbackPrompt — keyboard-only path', () => {
    it('default-focuses the Yes button on mount so Enter confirms without mousing', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(document.activeElement).toBe(
            container.querySelector('[data-testid="vision-fallback-yes"]'),
        );
    });

    it('is NOT focus-trapped: Tab from Cancel is left to the browser (no preventDefault, no cycling)', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const cancel = container.querySelector('[data-testid="vision-fallback-cancel"]');
        act(() => {
            cancel.focus();
        });
        let notPrevented;
        act(() => {
            notPrevented = cancel.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
            );
        });
        // Unlike the focus-trapped privacy disclosure, the prompt neither
        // cancels the Tab nor steals focus back to Yes — Tab leaves the prompt.
        expect(notPrevented).toBe(true);
        expect(document.activeElement).not.toBe(
            container.querySelector('[data-testid="vision-fallback-yes"]'),
        );
    });

    it('is an inline affordance, not a modal: role=group, no aria-modal, no backdrop', () => {
        const { container } = renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const prompt = container.querySelector('[data-testid="vision-fallback-prompt"]');
        expect(prompt.getAttribute('role')).toBe('group');
        expect(prompt.getAttribute('aria-modal')).toBeNull();
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
});
