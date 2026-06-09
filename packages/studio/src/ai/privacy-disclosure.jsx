/**
 * privacy-disclosure.jsx — UX-delta §4.4 inline privacy dialog.
 *
 * Shown in two situations (per FR60):
 *   1. Inside the setup sheet during provider configuration (after card
 *      selection, before connection test).
 *   2. One time on first cloud use per `(folderId, providerName)` — immediately
 *      before the first actual turn that sends data to that provider.
 *
 * Cloud-provider copy: AC-18 verbatim with `{Provider}` placeholder filled.
 * Ollama-provider copy: AC-19 verbatim with `{baseUrl}` placeholder filled.
 *
 * Acknowledgement persists to the `ai_disclosure_ack` IndexedDB store via the
 * @lerret/ai vault; the dock submit handler (Story 8.2) consults
 * `isDisclosureAcked` before running a turn against a cloud provider and
 * re-opens this component if the ack is missing.
 *
 * Esc closes the dialog AND aborts the AI turn (the deferred promise rejects
 * with `DisclosureCancelled`). The caller (setup-screen or dock submit handler)
 * owns the deferred and the abort wiring; this component just calls onCancel.
 */

import React from 'react';

import { useAiContext, PROVIDER_LABELS, PROVIDER_VARIANTS, OLLAMA_DEFAULT_BASE_URL } from './ai-context.jsx';

// ─── Scoped styles ───────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('ai-disclosure-styles')) {
    const s = document.createElement('style');
    s.id = 'ai-disclosure-styles';
    s.textContent = `
.lm-ai-disclosure-backdrop {
    position: fixed;
    inset: 0;
    z-index: 250;
    background: rgba(26, 23, 20, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
}
.lm-ai-disclosure {
    background: var(--lm-bg-primary, #FAF8F2);
    border-radius: var(--lm-radius-lg, 12px);
    box-shadow: var(--lm-shadow-sm, 0 4px 12px rgba(26, 23, 20, 0.10));
    width: min(480px, calc(100vw - 32px));
    padding: var(--lm-space-6, 24px);
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-4, 16px);
    color: var(--lm-text-primary, #1A1714);
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
}
.lm-ai-disclosure__title {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    line-height: 1.3;
}
.lm-ai-disclosure__body {
    font-size: 13px;
    line-height: 1.5;
    margin: 0;
    color: var(--lm-text-secondary, #44403A);
}
.lm-ai-disclosure__body p {
    margin: 0 0 var(--lm-space-3, 12px) 0;
}
.lm-ai-disclosure__body p:last-child {
    margin-bottom: 0;
}
.lm-ai-disclosure__provider {
    color: var(--lm-accent, #B85B33);
    font-weight: 500;
}
.lm-ai-disclosure__code {
    font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    font-size: 12px;
    background: var(--lm-bg-tertiary, #E8E2D4);
    padding: 1px 5px;
    border-radius: 4px;
}
.lm-ai-disclosure__actions {
    display: flex;
    gap: var(--lm-space-3, 12px);
    justify-content: flex-end;
    margin-top: var(--lm-space-2, 8px);
}
.lm-ai-disclosure__btn {
    font-family: inherit;
    font-size: 13px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 8px 14px;
    cursor: pointer;
    transition: background var(--lm-duration-fast, 120ms);
    border: 1px solid transparent;
}
.lm-ai-disclosure__btn--primary {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-accent, #B85B33);
}
.lm-ai-disclosure__btn--primary:hover {
    background: var(--lm-accent-hover, #A24E2C);
}
.lm-ai-disclosure__btn--secondary {
    background: transparent;
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-ai-disclosure__btn--secondary:hover {
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-ai-disclosure__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Privacy disclosure dialog.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the dialog is rendered.
 * @param {string} props.providerName - Canonical provider name (see PROVIDER_NAMES).
 * @param {string} [props.baseUrl] - Ollama base URL (defaults to OLLAMA_DEFAULT_BASE_URL).
 * @param {() => void} props.onAck - Called when the user acknowledges (primary button or Continue).
 * @param {() => void} props.onCancel - Called when the user dismisses via Esc.
 * @param {() => void} [props.onSwitchToOllama] - Called when the cloud "Switch to Ollama" button is pressed.
 * @param {boolean} [props.infoOnly] - When true, primary button does NOT call recordAck (settings panel "Privacy" link re-displays informationally).
 */
export function PrivacyDisclosure({
    open,
    providerName,
    baseUrl,
    onAck,
    onCancel,
    onSwitchToOllama,
    infoOnly = false,
}) {
    const { recordAck } = useAiContext();
    const dialogRef = React.useRef(null);
    const primaryRef = React.useRef(null);
    const titleId = React.useId();

    // Esc + focus management.
    React.useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel?.();
            }
        };
        document.addEventListener('keydown', onKey);
        // Auto-focus the primary button on open.
        const raf = requestAnimationFrame(() => {
            if (primaryRef.current) primaryRef.current.focus();
        });
        return () => {
            document.removeEventListener('keydown', onKey);
            cancelAnimationFrame(raf);
        };
    }, [open, onCancel]);

    if (!open) return null;

    const variant = PROVIDER_VARIANTS[providerName];
    const label = PROVIDER_LABELS[providerName] ?? providerName;

    const handlePrimary = async () => {
        if (!infoOnly) {
            try {
                await recordAck(providerName);
            } catch {
                // Ack-write failure does not block the turn — the disclosure
                // will re-display on next attempt. Calm voice; no banner.
            }
        }
        onAck?.();
    };

    return (
        <div className="lm-ai-disclosure-backdrop" data-testid="lm-ai-disclosure-backdrop">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="lm-ai-disclosure"
            >
                {variant === 'local-keyless' ? (
                    <>
                        <h2 id={titleId} className="lm-ai-disclosure__title">
                            Ollama keeps everything on your machine
                        </h2>
                        <div className="lm-ai-disclosure__body">
                            <p>
                                Your prompts, file contents, and images stay on your computer. Lerret connects to
                                your local Ollama at{' '}
                                <code className="lm-ai-disclosure__code">
                                    {baseUrl || OLLAMA_DEFAULT_BASE_URL}
                                </code>{' '}
                                and never sends data over the network.
                            </p>
                        </div>
                        <div className="lm-ai-disclosure__actions">
                            <button
                                ref={primaryRef}
                                type="button"
                                className="lm-ai-disclosure__btn lm-ai-disclosure__btn--primary"
                                onClick={handlePrimary}
                            >
                                Continue
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <h2 id={titleId} className="lm-ai-disclosure__title">
                            Lerret sends data to <span className="lm-ai-disclosure__provider">{label}</span> during
                            AI turns
                        </h2>
                        <div className="lm-ai-disclosure__body">
                            <p>
                                When you run an AI turn, Lerret sends the prompt, the file contents the turn needs,
                                and any images you attach{' '}
                                <strong>directly from your browser to {label}</strong> — never through a Lerret
                                server. {label} processes the request under their own terms.
                            </p>
                            <p>
                                If you want every AI turn to stay on your machine, switch to <strong>Ollama</strong>{' '}
                                — local, keyless, no data leaves your computer.
                            </p>
                        </div>
                        <div className="lm-ai-disclosure__actions">
                            <button
                                type="button"
                                className="lm-ai-disclosure__btn lm-ai-disclosure__btn--secondary"
                                onClick={() => onSwitchToOllama?.()}
                            >
                                Switch to Ollama
                            </button>
                            <button
                                ref={primaryRef}
                                type="button"
                                className="lm-ai-disclosure__btn lm-ai-disclosure__btn--primary"
                                onClick={handlePrimary}
                            >
                                I understand — continue with {label}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
