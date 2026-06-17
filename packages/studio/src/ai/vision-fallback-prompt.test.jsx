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
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle, openaiHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const copy = document.querySelector('[data-testid="vision-fallback-copy"]');
        expect(copy.textContent).toBe(
            "This model can't see images. Run this turn with Anthropic ($) just this once?",
        );
        // Lead = first element (the array arrives pre-ordered by the router).
        expect(copy.textContent).not.toContain('OpenAI');
        // Button labels are part of the verbatim contract.
        expect(
            document.querySelector('[data-testid="vision-fallback-yes"]').textContent,
        ).toBe('Yes, this turn only');
        expect(
            document.querySelector('[data-testid="vision-fallback-cancel"]').textContent,
        ).toBe('Cancel');
    });

    it('normalizes the orchestrator needs-vision-fallback event shape ({ name, model })', () => {
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[{ name: 'openai', model: 'gpt-4o' }]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(
            document.querySelector('[data-testid="vision-fallback-copy"]').textContent,
        ).toBe("This model can't see images. Run this turn with OpenAI ($) just this once?");
    });

    it('renders the ($) hint as a distinct Mist-class span, not part of the provider name', () => {
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const hint = document.querySelector('[data-testid="vision-fallback-cost-hint"]');
        expect(hint.tagName).toBe('SPAN');
        expect(hint.textContent).toBe('($)');
        expect(hint.className).toContain('lm-vision-fallback__cost-hint');
        // The Mist token backs the hint color (Geist 12 hint per UX-delta §4.7).
        const styles = document.getElementById('vision-fallback-prompt-styles').textContent;
        expect(styles).toMatch(/__cost-hint\s*{[^}]*--lm-mist/);
    });

    it('renders nothing for an empty eligibleProviders array (State A is the host branch)', () => {
        renderToDom(
            <VisionFallbackPrompt eligibleProviders={[]} onAccept={() => {}} onCancel={() => {}} />,
        );
        expect(document.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
    });
});

// ── Actions ───────────────────────────────────────────────────────────────────

describe('VisionFallbackPrompt — actions (AC-13/14)', () => {
    it('Yes invokes onAccept with the ORIGINAL lead handle object', () => {
        const onAccept = vi.fn();
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle, openaiHandle]}
                onAccept={onAccept}
                onCancel={() => {}}
            />,
        );
        act(() => {
            document.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        expect(onAccept).toHaveBeenCalledTimes(1);
        expect(onAccept.mock.calls[0][0]).toBe(anthropicHandle); // identity, not a copy
    });

    it('Cancel invokes onCancel (and never onAccept)', () => {
        const onAccept = vi.fn();
        const onCancel = vi.fn();
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={onAccept}
                onCancel={onCancel}
            />,
        );
        act(() => {
            document.querySelector('[data-testid="vision-fallback-cancel"]').click();
        });
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onAccept).not.toHaveBeenCalled();
    });

    it('Esc anywhere inside the prompt invokes onCancel (AC-17)', () => {
        const onCancel = vi.fn();
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={onCancel}
            />,
        );
        const prompt = document.querySelector('[data-testid="vision-fallback-prompt"]');
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
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        expect(document.activeElement).toBe(
            document.querySelector('[data-testid="vision-fallback-yes"]'),
        );
    });

    it('is NOT focus-trapped: Tab from Cancel is left to the browser (no preventDefault, no cycling)', () => {
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const cancel = document.querySelector('[data-testid="vision-fallback-cancel"]');
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
            document.querySelector('[data-testid="vision-fallback-yes"]'),
        );
    });

    it('is an inline affordance, not a modal: role=group, no aria-modal, no backdrop', () => {
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const prompt = document.querySelector('[data-testid="vision-fallback-prompt"]');
        expect(prompt.getAttribute('role')).toBe('group');
        expect(prompt.getAttribute('aria-modal')).toBeNull();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
});

// ── §6.5 dock-escape: portal + position:fixed (regression guard) ─────────────────
//
// The SAME bug fixed for the activity feed + clarify/continue card in 56d1276:
// the dock ([data-tour="dock"]) has overflow:auto + maxWidth + a backdrop-filter
// containing block, so ANYTHING positioned inside it (absolute OR fixed) is
// clipped/contained and renders invisibly above the dock. The prompt must PORTAL
// to <body> and be position:fixed, anchored from the measured dock rect.

describe('VisionFallbackPrompt — dock-escape portal (§6.5)', () => {
    it('is position:fixed, not absolute-in-dock (the dock clips an in-flow/absolute float)', () => {
        // jsdom can't measure clipping, so assert the injected CSS contract.
        renderToDom(
            <VisionFallbackPrompt
                eligibleProviders={[anthropicHandle]}
                onAccept={() => {}}
                onCancel={() => {}}
            />,
        );
        const css = document.getElementById('vision-fallback-prompt-styles').textContent;
        const rule = css.match(/\.lm-vision-fallback\s*\{[^}]*\}/)?.[0] || '';
        expect(rule).toMatch(/position:\s*fixed/);
        // The OLD absolute-in-dock anchoring is gone — that's exactly what the
        // dock clipped (b997399 hit the same trap by leaving it position:absolute
        // inside the dock).
        expect(rule).not.toMatch(/position:\s*absolute/);
        expect(rule).not.toContain('calc(100% + 8px)');
    });

    it('portals OUT of the dock cluster to <body> (not a descendant the dock can clip)', () => {
        // Build the dock structure the host renders the prompt into.
        const dock = document.createElement('div');
        dock.setAttribute('data-tour', 'dock');
        const cluster = document.createElement('span');
        cluster.className = 'lm-ai-cluster';
        const field = document.createElement('span');
        field.className = 'lm-ai-cluster__field';
        cluster.appendChild(field);
        dock.appendChild(cluster);
        document.body.appendChild(dock);

        // Render the component as a CHILD of the field — exactly as the host does
        // (ai-input-cluster renders <VisionFallbackPrompt> inside .lm-ai-cluster__field).
        const root = createRoot(field);
        act(() => {
            root.render(
                <VisionFallbackPrompt
                    eligibleProviders={[anthropicHandle]}
                    onAccept={() => {}}
                    onCancel={() => {}}
                />,
            );
        });

        const prompt = document.querySelector('[data-testid="vision-fallback-prompt"]');
        expect(prompt).not.toBeNull();
        // The portal escapes the dock: the prompt is NOT inside the cluster/field
        // (an in-dock node would be clipped invisible), and it lands under <body>.
        expect(field.contains(prompt)).toBe(false);
        expect(cluster.contains(prompt)).toBe(false);
        expect(prompt.closest('.lm-ai-cluster')).toBeNull();
        expect(prompt.parentElement).toBe(document.body);

        act(() => root.unmount());
        dock.remove();
    });

    it('pins itself fixed from the measured dock rect (8px above the dock top, clamped left)', () => {
        // Stub a dock whose rect we control so the anchor math is verifiable in
        // jsdom (real getBoundingClientRect returns zeros here).
        const rect = { left: 120, top: 700, right: 520, bottom: 740, width: 400, height: 40, x: 120, y: 700 };
        const dock = document.createElement('div');
        dock.setAttribute('data-tour', 'dock');
        dock.getBoundingClientRect = () => rect;
        document.body.appendChild(dock);

        const root = createRoot(document.createElement('div'));
        act(() => {
            root.render(
                <VisionFallbackPrompt
                    eligibleProviders={[anthropicHandle]}
                    onAccept={() => {}}
                    onCancel={() => {}}
                />,
            );
        });

        const prompt = document.querySelector('[data-testid="vision-fallback-prompt"]');
        // Same anchor math as the impl: left = dock.left clamped into the
        // viewport; bottom = innerHeight - dock.top + 8 (the card sits ABOVE the
        // dock). Computed from live window dims so it holds across jsdom configs.
        const OVERLAY_MAX = 400;
        const expectedLeft = Math.round(
            Math.max(8, Math.min(rect.left, window.innerWidth - OVERLAY_MAX - 8)),
        );
        const expectedBottom = Math.round(window.innerHeight - rect.top + 8);
        expect(prompt.style.left).toBe(`${expectedLeft}px`);
        expect(prompt.style.bottom).toBe(`${expectedBottom}px`);

        act(() => root.unmount());
        dock.remove();
    });
});
