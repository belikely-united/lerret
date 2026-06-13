/**
 * ollama-origins-guide.jsx — UX-delta §4.6 `OLLAMA_ORIGINS` guide flow (FR59).
 *
 * A three-step walkthrough-styled content-card overlay (NO canvas spotlight)
 * that auto-summons in HOSTED mode when the Ollama probe classifies as a CORS
 * denial: the browser found Ollama on the user's machine but blocked the
 * connection because the studio page is on `https://`. The guide walks the
 * user through setting `OLLAMA_ORIGINS` — the only place in Epic 8 where the
 * studio asks the user to do something in their terminal, so the voice stays
 * calm and explanatory.
 *
 *   Step 1 — what's happening (verbatim sentence, AC-5)
 *   Step 2 — the fix (the command + copy button + restart note, AC-6/11/12/13)
 *   Step 3 — verify (`Retry connection`; inline note + docs link on failure, AC-7/14)
 *
 * Renders its OWN backdrop + focus trap (mirroring privacy-disclosure.jsx),
 * NOT an EditorSheet — the §4.6 layout is a walkthrough content card without
 * the sheet header, and the setup sheet steps aside while this is up. Esc
 * dismisses at any step (AC-9); a ghost-tier `Use a different provider`
 * button on every step returns to the provider chooser (AC-8).
 *
 * The guide never appears in CLI mode — the summon path is gated by
 * `shouldRunHostedProbe()` in setup-screen.jsx (AC-10). This component itself
 * is mode-agnostic chrome; it reaches no network and no @lerret/ai surface
 * (the probe re-run arrives via the `onRetry` prop, which the setup screen
 * implements through `getAi()`).
 */

import React from 'react';
import * as ReactDOM from 'react-dom';

// ─── Single sources of truth (verbatim contract — do NOT duplicate) ──────────

/**
 * The terminal command from UX-delta §4.6 / AC-6 — the rendered code block,
 * the clipboard write, and the tests all reference THIS constant. Frozen by
 * `const` + primitive; never rebuild the string elsewhere.
 *
 * @type {string}
 */
export const OLLAMA_ORIGINS_COMMAND =
    'OLLAMA_ORIGINS="https://lerret.belikely.com" ollama serve';

/**
 * Canonical Lerret docs page on Ollama setup (AC-14 — URL stub; the page is
 * authored in the Phase 2 documentation effort). Shared with the setup
 * screen's contained-error docs link.
 *
 * @type {string}
 */
export const OLLAMA_DOCS_URL = 'https://lerret-docs.belikely.com/providers/ollama';

// Step 1 sentence — verbatim per UX-delta §4.6 / AC-5 (the trailing
// `https://.` is part of the sentence; `https://` renders as inline code).
const STEP1_LEAD =
    'Lerret found Ollama on your machine, but your browser is blocking the connection because this page is on ';

// Step 2 copy — verbatim per UX-delta §4.6 / AC-6.
const STEP2_INTRO = "Run this in your terminal to allow Lerret's hosted page to talk to Ollama:";
const STEP2_NOTE = "If Ollama is already running, you'll need to restart it with that variable set.";

const STEP_TITLES = Object.freeze({
    1: "What's happening",
    2: 'The fix',
    3: 'Verify',
});

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('ollama-origins-guide-styles')) {
    const s = document.createElement('style');
    s.id = 'ollama-origins-guide-styles';
    s.textContent = `
.lm-ollama-guide-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: rgba(26, 23, 20, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
}
.lm-ollama-guide {
    background: var(--lm-bg-primary, #FAF8F2);
    border-radius: var(--lm-radius-lg, 12px);
    box-shadow: var(--lm-shadow-sm, 0 4px 12px rgba(26, 23, 20, 0.10));
    width: min(520px, calc(100vw - 32px));
    padding: var(--lm-space-6, 24px);
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-4, 16px);
    color: var(--lm-text-primary, #1A1714);
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
}
.lm-ollama-guide__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--lm-space-3, 12px);
}
.lm-ollama-guide__title {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    line-height: 1.3;
}
.lm-ollama-guide__indicator {
    font: 400 11px/1.2 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    letter-spacing: 0.04em;
    white-space: nowrap;
}
.lm-ollama-guide__body {
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
    color: var(--lm-text-secondary, #44403A);
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-3, 12px);
}
.lm-ollama-guide__body p {
    margin: 0;
}
.lm-ollama-guide__inline-code {
    font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    font-size: 12px;
    background: var(--lm-bg-tertiary, #E8E2D4);
    padding: 1px 5px;
    border-radius: 4px;
}
.lm-ollama-guide__code-row {
    display: flex;
    align-items: center;
    gap: var(--lm-space-2, 8px);
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 10px 12px;
}
.lm-ollama-guide__code {
    flex: 1;
    font: 400 13px/1.5 var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--lm-text-primary, #1A1714);
    user-select: text;
    word-break: break-all;
}
.lm-ollama-guide__copy {
    background: transparent;
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-sm, 6px);
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    padding: 5px 6px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
}
.lm-ollama-guide__copy:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-ollama-guide__copy:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-ollama-guide__copied {
    font: 500 12px/1.2 var(--lm-font-sans);
    color: var(--lm-success, #4A6B3F);
    min-height: 14px;
}
.lm-ollama-guide__note {
    font: 400 12px/1.45 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
}
.lm-ollama-guide__retry-note {
    font: 400 12px/1.45 var(--lm-font-sans);
    color: var(--lm-text-secondary, #44403A);
    background: var(--lm-bg-secondary, #F2EEE6);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 8px 10px;
}
.lm-ollama-guide__retry-note a {
    color: var(--lm-accent-text, #92421E);
    text-decoration: underline;
    text-underline-offset: 2px;
}
.lm-ollama-guide__actions {
    display: flex;
    align-items: center;
    gap: var(--lm-space-3, 12px);
    margin-top: var(--lm-space-2, 8px);
}
.lm-ollama-guide__btn {
    font-family: inherit;
    font-size: 13px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 8px 14px;
    cursor: pointer;
    transition: background var(--lm-duration-fast, 120ms);
    border: 1px solid transparent;
}
.lm-ollama-guide__btn--primary {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-accent, #B85B33);
}
.lm-ollama-guide__btn--primary:hover {
    background: var(--lm-accent-hover, #A24E2C);
}
.lm-ollama-guide__btn--primary:disabled {
    opacity: 0.6;
    cursor: default;
}
.lm-ollama-guide__btn--secondary {
    background: transparent;
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-ollama-guide__btn--secondary:hover {
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-ollama-guide__btn--ghost {
    background: transparent;
    color: var(--lm-text-tertiary, #6E6960);
    border-color: transparent;
}
.lm-ollama-guide__btn--ghost:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-ollama-guide__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-ollama-guide__spacer {
    flex: 1;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * The `OLLAMA_ORIGINS` guide overlay.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the guide is rendered.
 * @param {() => Promise<'ok' | 'cors' | 'unreachable'>} props.onRetry - Re-runs
 *   the hosted probe-classify against the current draft baseUrl/model and
 *   resolves the classified route. Implemented by the setup screen via getAi().
 * @param {() => void} props.onSuccess - Called when a retry classifies 'ok';
 *   the caller closes the guide and resumes the disclosure path.
 * @param {() => void} props.onUseDifferentProvider - Ghost-tier bypass on every
 *   step; the caller closes the guide and de-selects the Ollama card (AC-8).
 * @param {() => void} props.onDismiss - Esc at any step (AC-9). The caller owns
 *   the turn-abort wiring (the existing onClose/onSkip contract from Story 8.2).
 */
export function OllamaOriginsGuide({ open, onRetry, onSuccess, onUseDifferentProvider, onDismiss }) {
    const [step, setStep] = React.useState(/** @type {1 | 2 | 3} */ (1));
    const [copied, setCopied] = React.useState(false);
    const [retryState, setRetryState] = React.useState(
        /** @type {'idle' | 'running' | 'failed'} */ ('idle'),
    );

    const dialogRef = React.useRef(null);
    const primaryRef = React.useRef(null);
    const copyTimerRef = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const titleId = React.useId();

    // Reset to Step 1 whenever the guide closes so a re-summon starts fresh.
    React.useEffect(() => {
        if (!open) {
            setStep(1);
            setCopied(false);
            setRetryState('idle');
        }
    }, [open]);

    // Esc + Tab-containment + focus-restore (mirrors privacy-disclosure.jsx —
    // this dialog owns its own backdrop, so it owns its own focus trap).
    React.useEffect(() => {
        if (!open) return;
        const previouslyFocused =
            typeof document !== 'undefined' ? document.activeElement : null;

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onDismiss?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusables = dialog.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (e.shiftKey) {
                if (active === first || !dialog.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last || !dialog.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            // Restore focus to whatever was focused before the guide opened.
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
        };
    }, [open, onDismiss]);

    // Auto-focus the step's primary button on open and on every step change.
    // (Separate from the trap effect so a step change does NOT run the
    // focus-restore cleanup above.)
    React.useEffect(() => {
        if (!open) return;
        const raf = requestAnimationFrame(() => {
            if (primaryRef.current) primaryRef.current.focus();
        });
        return () => cancelAnimationFrame(raf);
    }, [open, step]);

    // Clear the Copied-cue timer on unmount.
    React.useEffect(
        () => () => {
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        },
        [],
    );

    if (!open) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(OLLAMA_ORIGINS_COMMAND);
            setCopied(true);
            if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard unavailable (or permission denied) — never throw out
            // of the copy handler. The code block stays text-selectable so
            // manual copy still works.
        }
    };

    const handleRetry = async () => {
        if (retryState === 'running') return;
        setRetryState('running');
        let route = 'unreachable';
        try {
            route = await onRetry?.();
        } catch {
            // A throwing retry fails safe to the inline note.
        }
        if (route === 'ok') {
            setRetryState('idle');
            onSuccess?.();
            return;
        }
        setRetryState('failed');
    };

    // Portal to <body>: rendered as a sibling inside SetupScreen, which mounts
    // inside the dock — and the dock's `backdrop-filter` is a containing block
    // for `position: fixed`, so an un-portaled backdrop gets trapped in the
    // dock's bar and clips. Same fix/pattern as privacy-disclosure.jsx and
    // revert-timeline.jsx.
    return ReactDOM.createPortal(
        <div className="lm-ollama-guide-backdrop" data-testid="lm-ollama-guide-backdrop">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="lm-ollama-guide"
                data-testid="lm-ollama-guide"
            >
                <div className="lm-ollama-guide__header">
                    <h2 id={titleId} className="lm-ollama-guide__title">
                        {STEP_TITLES[step]}
                    </h2>
                    <span
                        className="lm-ollama-guide__indicator"
                        aria-label={`Step ${step} of 3`}
                        data-testid="lm-ollama-guide-indicator"
                    >
                        {step} / 3
                    </span>
                </div>

                {step === 1 && (
                    <div className="lm-ollama-guide__body">
                        <p data-testid="lm-ollama-guide-step1">
                            {STEP1_LEAD}
                            <code className="lm-ollama-guide__inline-code">https://</code>.
                        </p>
                    </div>
                )}

                {step === 2 && (
                    <div className="lm-ollama-guide__body">
                        <p data-testid="lm-ollama-guide-step2-intro">{STEP2_INTRO}</p>
                        <div className="lm-ollama-guide__code-row">
                            <code
                                className="lm-ollama-guide__code"
                                data-testid="lm-ollama-guide-command"
                            >
                                {OLLAMA_ORIGINS_COMMAND}
                            </code>
                            <button
                                type="button"
                                className="lm-ollama-guide__copy"
                                aria-label="Copy command"
                                onClick={handleCopy}
                                data-testid="lm-ollama-guide-copy"
                            >
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 14 14"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    aria-hidden="true"
                                >
                                    <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" />
                                    <path d="M9.5 4.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
                                </svg>
                            </button>
                        </div>
                        <span
                            className="lm-ollama-guide__copied"
                            aria-live="polite"
                            data-testid="lm-ollama-guide-copied"
                        >
                            {copied ? 'Copied' : ''}
                        </span>
                        <p className="lm-ollama-guide__note" data-testid="lm-ollama-guide-step2-note">
                            {STEP2_NOTE}
                        </p>
                    </div>
                )}

                {step === 3 && (
                    <div className="lm-ollama-guide__body">
                        <p data-testid="lm-ollama-guide-step3">
                            Once Ollama is running with the variable set, retry the connection.
                        </p>
                        {retryState === 'failed' && (
                            <p
                                className="lm-ollama-guide__retry-note"
                                role="status"
                                data-testid="lm-ollama-guide-retry-note"
                            >
                                Still can't connect. Make sure Ollama restarted with the variable
                                set, or{' '}
                                <a
                                    href={OLLAMA_DOCS_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    data-testid="lm-ollama-guide-docs-link"
                                >
                                    see the Ollama setup docs
                                </a>
                                .
                            </p>
                        )}
                    </div>
                )}

                <div className="lm-ollama-guide__actions">
                    <button
                        type="button"
                        className="lm-ollama-guide__btn lm-ollama-guide__btn--ghost"
                        onClick={() => onUseDifferentProvider?.()}
                        data-testid="lm-ollama-guide-different-provider"
                    >
                        Use a different provider
                    </button>
                    <div className="lm-ollama-guide__spacer" />
                    {step > 1 && (
                        <button
                            type="button"
                            className="lm-ollama-guide__btn lm-ollama-guide__btn--secondary"
                            onClick={() => setStep((s) => /** @type {1 | 2 | 3} */ (s - 1))}
                            data-testid="lm-ollama-guide-back"
                        >
                            Back
                        </button>
                    )}
                    {step < 3 ? (
                        <button
                            ref={primaryRef}
                            type="button"
                            className="lm-ollama-guide__btn lm-ollama-guide__btn--primary"
                            onClick={() => setStep((s) => /** @type {1 | 2 | 3} */ (s + 1))}
                            data-testid="lm-ollama-guide-next"
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            ref={primaryRef}
                            type="button"
                            className="lm-ollama-guide__btn lm-ollama-guide__btn--primary"
                            onClick={handleRetry}
                            disabled={retryState === 'running'}
                            data-testid="lm-ollama-guide-retry"
                        >
                            Retry connection
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
