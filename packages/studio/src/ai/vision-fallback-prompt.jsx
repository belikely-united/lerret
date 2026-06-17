/**
 * vision-fallback-prompt.jsx — UX-delta §4.7 State B one-off vision-fallback
 * prompt (Story 8.7, FR56).
 *
 * The "Inline-near-dock prompt" primitive: a small action card pinned visually
 * DIRECTLY ABOVE the dock input — NOT a centered overlay, NOT a backdropped
 * modal, NOT `aria-modal`, NOT focus-trapped (Tab order is Yes → Cancel → out
 * of the prompt; deliberately unlike the Story 8.1 privacy-disclosure dialog,
 * which IS trapped).
 *
 * §6.5 fix — it PORTALS to <body> and is `position: fixed`, placed from the
 * measured dock rect (8px above the dock top, left-aligned + clamped into the
 * viewport). It must NOT live inside the dock: the dock (`[data-tour="dock"]`)
 * has `overflow: auto` + `maxWidth` + a `backdrop-filter` containing block, so
 * ANY element positioned inside it — absolute OR fixed — is clipped/contained
 * and renders invisibly above the dock (the exact trap the activity feed and
 * clarify/continue card hit in 56d1276). Because this prompt shows BEFORE a
 * turn runs (when the host sets `visionPromptProviders`, not during `running`),
 * it can't reuse the cluster's running-gated `dockOverlayPos` — it measures the
 * dock itself on mount + on resize. Same dock-escape the privacy-disclosure /
 * dock-menu / PagePicker overlays use (anchor with `bottom: innerHeight - top`).
 *
 * Copy is the user-facing contract (verbatim, AC-11/12):
 *   This model can't see images. Run this turn with {ProviderName} ($) just this once?
 *   [ Yes, this turn only ]   [ Cancel ]
 * The `($)` is a distinct Mist-colored (Geist 12) hint span — the call is
 * metered against the cloud provider's BYOK key — NOT part of the provider name.
 *
 * Consent semantics: the acknowledgement is NEVER remembered (no "don't ask
 * again", no persisted ack store) — every vision-requiring call against a
 * non-vision active model shows this prompt afresh (NFR6 egress carve-out;
 * intentionally distinct from the one-time-per-(folder,provider) privacy
 * disclosure).
 *
 * The component is purely presentational: it accepts `eligibleProviders`
 * (either this story's ProviderHandle shape `{ providerName, label, model,
 * variant }` from `ai.vision.eligibleVisionProviders(...)` OR the
 * orchestrator's `needs-vision-fallback` event shape `{ name, model }`),
 * renders the LEAD provider (index 0 — the array arrives pre-ordered by the
 * router's most-recently-configured precedence), and reports the user's
 * choice via callbacks. It performs no @lerret/ai calls itself — the host
 * hook (use-vision-gate.js) owns the routing logic.
 */

import React from 'react';
import { createPortal } from 'react-dom';

import { PROVIDER_LABELS } from './ai-context.jsx';

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('vision-fallback-prompt-styles')) {
    const s = document.createElement('style');
    s.id = 'vision-fallback-prompt-styles';
    s.textContent = `
.lm-vision-fallback {
    /* §6.5 fix: position:fixed + portaled to <body> (left/bottom set inline from
       the measured dock rect). It must NOT be absolute-in-dock: the dock has
       overflow:auto + maxWidth + a backdrop-filter containing block, so anything
       positioned inside it — absolute OR fixed — is clipped/contained and renders
       invisibly above the dock (the trap the feed + clarify card hit in 56d1276). */
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border-light, #E8E2D4);
    border-radius: var(--lm-radius-md, 8px);
    box-shadow: var(--lm-shadow-sm, 0 4px 12px rgba(26, 23, 20, 0.10));
    padding: var(--lm-space-3, 12px) var(--lm-space-4, 16px);
    min-width: 300px;
    max-width: 400px;
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
}
.lm-vision-fallback__copy {
    margin: 0;
    font: 400 13px/1.45 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-primary, #1A1714);
}
.lm-vision-fallback__cost-hint {
    font: 400 12px/1 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-mist, #B8B3A8);
}
.lm-vision-fallback__actions {
    display: flex;
    gap: var(--lm-space-3, 12px);
    justify-content: flex-end;
}
.lm-vision-fallback__btn {
    font-family: inherit;
    font-size: 12px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 6px 12px;
    cursor: pointer;
    transition: background var(--lm-duration-fast, 120ms);
    border: 1px solid transparent;
}
.lm-vision-fallback__btn--primary {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-accent, #B85B33);
}
.lm-vision-fallback__btn--primary:hover {
    background: var(--lm-accent-hover, #A24E2C);
}
.lm-vision-fallback__btn--secondary {
    background: transparent;
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-vision-fallback__btn--secondary:hover {
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-vision-fallback__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * The State B one-off fallback prompt.
 *
 * @param {object} props
 * @param {Array<{ providerName?: string, name?: string, label?: string, model?: string }>} props.eligibleProviders
 *   Pre-ordered eligible providers (lead first). Accepts BOTH the router's
 *   ProviderHandle shape and the orchestrator event's `{ name, model }` shape.
 *   With an empty/absent array the component renders nothing (State A is the
 *   host hook's concern, not this component's).
 * @param {(handle: object) => void} props.onAccept - Called with the LEAD
 *   provider handle (the original array element) when the user confirms.
 *   The host runs the suspended turn with `providerOverride` for THIS turn
 *   only — never `makeActive`, never a vault write (AC-13).
 * @param {() => void} props.onCancel - Called on Cancel click or Esc. The host
 *   discards the suspended submission and returns focus to the dock input (AC-14).
 */
export function VisionFallbackPrompt({ eligibleProviders, onAccept, onCancel }) {
    const yesRef = React.useRef(null);
    const lead = Array.isArray(eligibleProviders) ? eligibleProviders[0] : undefined;
    const hasLead = Boolean(lead);

    // §6.5 fix: the prompt is portaled to <body> + position:fixed, so it carries
    // its own measured anchor. It shows BEFORE a turn runs (the host sets
    // visionPromptProviders, not `running`), so it can't reuse the cluster's
    // running-gated dockOverlayPos — it measures the dock here on mount + on
    // resize. 8px above the dock top, left-aligned but clamped into the viewport
    // so the (≤400px) card can never run off-screen. Same anchor math as the
    // privacy-disclosure / dock-menu / PagePicker overlays (bottom: innerHeight
    // - top). Null until measured → the inline fallback (left:16, bottom:80).
    const [pos, setPos] = React.useState(
        /** @type {{ left: number, bottom: number } | null} */ (null),
    );

    // AC-16: default-focus the Yes button so a keyboard user confirms with
    // Enter without mousing. focusVisible:true asks for a visible ring where
    // supported; environments without the option just focus.
    React.useEffect(() => {
        if (!hasLead) return;
        const btn = yesRef.current;
        if (!btn) return;
        try {
            btn.focus({ focusVisible: true });
        } catch {
            btn.focus();
        }
    }, [hasLead]);

    // Measure the dock and pin the portaled card 8px above it (clamped into the
    // viewport). Re-measure on resize; the dock is at rest while this prompt is
    // open (it shows pre-turn, before the spend line grows the dock), so a
    // window-resize listener suffices — no ResizeObserver needed.
    React.useLayoutEffect(() => {
        if (!hasLead) return undefined;
        const measure = () => {
            const anchor =
                document.querySelector('[data-tour="dock"]') ||
                document.querySelector('.lm-ai-cluster');
            if (!anchor) return;
            const r = anchor.getBoundingClientRect();
            const OVERLAY_MAX = 400; // matches .lm-vision-fallback max-width
            const left = Math.max(8, Math.min(r.left, window.innerWidth - OVERLAY_MAX - 8));
            setPos({
                left: Math.round(left),
                bottom: Math.round(window.innerHeight - r.top + 8),
            });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => {
            window.removeEventListener('resize', measure);
        };
    }, [hasLead]);

    if (!lead) return null;

    const providerName = lead.providerName ?? lead.name;
    const label = PROVIDER_LABELS[providerName] ?? lead.label ?? String(providerName);

    // Esc cancels (AC-17) — one action per keypress: stop the event here so an
    // open thread sheet (document-level Esc) does not also collapse. NOT a
    // focus trap: Tab is left entirely alone (Yes → Cancel → out).
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel?.();
        }
    };

    // Portaled to <body> so the dock's overflow/backdrop-filter can't clip it;
    // positioned fixed from the measured dock rect (inline left/bottom).
    return createPortal(
        <div
            className="lm-vision-fallback"
            role="group"
            aria-label="Vision fallback"
            data-testid="vision-fallback-prompt"
            onKeyDown={handleKeyDown}
            style={{ left: pos?.left ?? 16, bottom: pos?.bottom ?? 80 }}
        >
            <p className="lm-vision-fallback__copy" data-testid="vision-fallback-copy">
                {`This model can't see images. Run this turn with ${label} `}
                <span className="lm-vision-fallback__cost-hint" data-testid="vision-fallback-cost-hint">
                    ($)
                </span>
                {' just this once?'}
            </p>
            <div className="lm-vision-fallback__actions">
                <button
                    ref={yesRef}
                    type="button"
                    className="lm-vision-fallback__btn lm-vision-fallback__btn--primary"
                    data-testid="vision-fallback-yes"
                    onClick={() => onAccept?.(lead)}
                >
                    Yes, this turn only
                </button>
                <button
                    type="button"
                    className="lm-vision-fallback__btn lm-vision-fallback__btn--secondary"
                    data-testid="vision-fallback-cancel"
                    onClick={() => onCancel?.()}
                >
                    Cancel
                </button>
            </div>
        </div>,
        document.body,
    );
}

export default VisionFallbackPrompt;
