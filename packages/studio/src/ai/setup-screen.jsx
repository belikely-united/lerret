/**
 * setup-screen.jsx — UX-delta §4.2 first-run AI provider setup screen.
 *
 * Summons the first time the user submits anything to the dock AI input on a
 * folder where no provider is configured. A centered Editor-sheet variant
 * (≈ 880 × 540), four provider cards side-by-side (OpenAI / Anthropic /
 * OpenRouter / Ollama). Selecting a provider commits the user's chosen turn;
 * `Skip for now` dismisses without writing.
 *
 * Per AC-13/14/15/16 and the verbatim copy specified in §4.2 + the story's
 * "UX copy verbatim — quick reference for the dev" block.
 *
 * The setup flow:
 *   1. Render four cards.
 *   2. User selects a provider, enters API key (cloud) or base URL + model (Ollama).
 *   3. On `Select`: encrypt key + persist provider config + open the inline
 *      privacy disclosure.
 *   4. On disclosure ack: call onCommit(providerName) so the parent can resume
 *      the originally-submitted AI turn.
 *   5. On disclosure cancel (Esc): the entire setup dismisses; the originally-
 *      submitted turn is discarded.
 *
 * The dock wiring (the submit handler that suspends the turn and opens this
 * sheet) is Story 8.2's responsibility. This component only exports the
 * controlled sheet.
 */

import React from 'react';

import { EditorSheet } from '../components/editors/editor-sheet.jsx';
import { useAiContext, PROVIDER_NAMES, PROVIDER_LABELS, PROVIDER_VARIANTS, OLLAMA_DEFAULT_BASE_URL } from './ai-context.jsx';
import { PrivacyDisclosure } from './privacy-disclosure.jsx';

// ─── Verbatim copy (do NOT paraphrase) ────────────────────────────────────────

/**
 * Per-provider card content. Sub-line + description copy is verbatim per
 * UX-delta §4.2 and the story's "Setup screen card descriptions (AC-13)" block.
 */
const PROVIDER_CARD_COPY = Object.freeze({
    openai: {
        subline: 'BYOK · cloud',
        description:
            'Frontier model from OpenAI. Prompts and file contents go directly from your browser to OpenAI — never through a Lerret server.',
    },
    anthropic: {
        subline: 'BYOK · cloud',
        description:
            'Claude from Anthropic. Prompts and file contents go directly from your browser to Anthropic — never through a Lerret server.',
    },
    openrouter: {
        subline: 'BYOK · cloud',
        description:
            'Pick from 200+ models via OpenRouter. Prompts and file contents go directly from your browser to OpenRouter — never through a Lerret server.',
    },
    ollama: {
        subline: 'Local · keyless',
        description: 'Runs entirely on your machine. No key. No data leaves your computer.',
    },
});

/**
 * NFR19 quality note — verbatim. Single calm line below the card row.
 */
const QUALITY_NOTE =
    'Local Ollama models produce lower-fidelity .jsx than frontier cloud models. Choose with informed expectations — you can switch any time.';

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('ai-setup-screen-styles')) {
    const s = document.createElement('style');
    s.id = 'ai-setup-screen-styles';
    s.textContent = `
.lm-ai-setup {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-5, 20px);
    width: 100%;
}
.lm-ai-setup__cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--lm-space-3, 12px);
}
@media (max-width: 880px) {
    .lm-ai-setup__cards { grid-template-columns: repeat(2, 1fr); }
}
.lm-ai-setup__card {
    background: var(--lm-bg-secondary, #F2EEE6);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-md, 8px);
    padding: var(--lm-space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    cursor: pointer;
    transition: border-color var(--lm-duration-fast, 120ms), background var(--lm-duration-fast, 120ms);
}
.lm-ai-setup__card[data-selected="true"] {
    border-color: var(--lm-accent, #B85B33);
    background: var(--lm-bg-primary, #FAF8F2);
}
.lm-ai-setup__card:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-ai-setup__title {
    font: 600 16px/1.2 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-primary, #1A1714);
    margin: 0;
}
.lm-ai-setup__subline {
    font: 400 11px/1.3 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    letter-spacing: 0.02em;
    margin: 0;
}
.lm-ai-setup__desc {
    font: 400 12px/1.45 var(--lm-font-sans);
    color: var(--lm-text-secondary, #44403A);
    margin: 0;
    flex: 1;
}
.lm-ai-setup__inputs {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    margin-top: var(--lm-space-2, 8px);
}
.lm-ai-setup__input-row {
    position: relative;
    display: flex;
    align-items: center;
}
.lm-ai-setup__input {
    flex: 1;
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 6px 8px;
    font: 400 12px/1.3 var(--lm-font-mono, ui-monospace, monospace);
    color: var(--lm-text-primary, #1A1714);
    width: 100%;
}
.lm-ai-setup__input:focus {
    outline: none;
    border-color: var(--lm-accent, #B85B33);
}
.lm-ai-setup__eye {
    position: absolute;
    right: 4px;
    background: transparent;
    border: none;
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
}
.lm-ai-setup__eye:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-ai-setup__select-btn {
    margin-top: var(--lm-space-2, 8px);
    font-family: inherit;
    font-size: 12px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 7px 12px;
    cursor: pointer;
    border: 1px solid transparent;
    background: transparent;
    color: var(--lm-text-primary, #1A1714);
    transition: background var(--lm-duration-fast, 120ms);
}
.lm-ai-setup__select-btn[data-tier="primary"] {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-accent, #B85B33);
}
.lm-ai-setup__select-btn[data-tier="primary"]:hover {
    background: var(--lm-accent-hover, #A24E2C);
}
.lm-ai-setup__select-btn[data-tier="secondary"] {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-ai-setup__quality-note {
    font: 400 12px/1.45 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    text-align: center;
    margin: 0;
}
.lm-ai-setup__skip {
    background: transparent;
    border: none;
    font: 400 12px/1.3 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    padding: 6px 10px;
    border-radius: var(--lm-radius-sm, 6px);
}
.lm-ai-setup__skip:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Setup screen component ───────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {boolean} props.open - Whether the setup sheet is rendered.
 * @param {() => void} props.onClose - Called when the sheet should close (Esc, backdrop, close button, Skip).
 * @param {(providerName: string) => void} [props.onCommit] - Called after the user completes provider configuration AND acknowledges the privacy disclosure. The caller's deferred AI turn should resume here.
 * @param {() => void} [props.onSkip] - Called when the user clicks Skip for now. The deferred AI turn is discarded.
 */
export function SetupScreen({ open, onClose, onCommit, onSkip }) {
    const { configureProvider } = useAiContext();

    // Selected card / draft inputs (controlled at this level so card switches
    // don't lose what the user typed).
    const [selected, setSelected] = React.useState(/** @type {string | null} */ (null));
    const [drafts, setDrafts] = React.useState(
        /** @type {Record<string, { apiKey?: string, baseUrl?: string, model?: string, showKey?: boolean }>} */ ({
            ollama: { baseUrl: OLLAMA_DEFAULT_BASE_URL, model: 'llava' },
        }),
    );

    // Inline disclosure state. After the user clicks Select, the disclosure
    // opens for the chosen provider; on Ack, we call onCommit.
    const [discloseFor, setDiscloseFor] = React.useState(/** @type {string | null} */ (null));

    const cardsRef = React.useRef(null);

    React.useEffect(() => {
        if (!open) {
            // Reset draft state on close so the next open starts fresh except
            // the Ollama default URL.
            setSelected(null);
            setDiscloseFor(null);
        }
    }, [open]);

    const setDraft = (name, patch) => {
        setDrafts((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), ...patch } }));
    };

    const handleSelect = (name) => {
        const d = drafts[name] ?? {};
        // Cloud providers require an API key before commit.
        if (PROVIDER_VARIANTS[name] === 'cloud-byok' && !d.apiKey) {
            // No key — bail; the user can fill the field and try again.
            return;
        }
        // Do NOT persist anything yet. The provider key + active-config write
        // is deferred to handleAck so that an Esc-cancel of the disclosure
        // leaves NO orphaned key, NO ai_provider_config row, and NO change to
        // the folder's active provider. (Previously configure ran here, before
        // the disclosure, so backing out still committed everything.)
        setDiscloseFor(name);
    };

    const handleAck = async () => {
        const name = discloseFor;
        if (!name) {
            onClose?.();
            return;
        }
        // Persist now — the user has seen and acknowledged the disclosure.
        const d = drafts[name] ?? {};
        await configureProvider(name, {
            apiKey: d.apiKey,
            baseUrl: d.baseUrl,
            model: d.model,
        });
        setDiscloseFor(null);
        onCommit?.(name);
        onClose?.();
    };

    const handleDisclosureCancel = () => {
        // Nothing was persisted (configure is deferred to handleAck), so there
        // is nothing to roll back — just close. The originally-submitted turn
        // is discarded by the caller.
        setDiscloseFor(null);
        onClose?.();
    };

    const handleSwitchToOllama = () => {
        setDiscloseFor(null);
        setSelected('ollama');
    };

    const handleSkip = () => {
        onSkip?.();
        onClose?.();
    };

    // Arrow-key navigation across the 4 cards.
    const onCardKeyDown = (e, name) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const idx = PROVIDER_NAMES.indexOf(name);
            const nextIdx =
                e.key === 'ArrowRight'
                    ? (idx + 1) % PROVIDER_NAMES.length
                    : (idx - 1 + PROVIDER_NAMES.length) % PROVIDER_NAMES.length;
            setSelected(PROVIDER_NAMES[nextIdx]);
            const el = cardsRef.current?.querySelector(`[data-provider="${PROVIDER_NAMES[nextIdx]}"]`);
            if (el && typeof el.focus === 'function') el.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setSelected(name);
        }
    };

    return (
        <>
            <EditorSheet
                open={open && !discloseFor}
                onClose={onClose}
                title="Pick an AI provider"
                footer={
                    <>
                        <button
                            type="button"
                            className="lm-ai-setup__skip"
                            onClick={handleSkip}
                            data-testid="lm-ai-setup-skip"
                        >
                            Skip for now
                        </button>
                        <div style={{ flex: 1 }} />
                    </>
                }
            >
                <div className="lm-ai-setup">
                <div className="lm-ai-setup__cards" role="radiogroup" aria-label="AI providers" ref={cardsRef}>
                    {PROVIDER_NAMES.map((name) => {
                        const copy = PROVIDER_CARD_COPY[name];
                        const variant = PROVIDER_VARIANTS[name];
                        const isSelected = selected === name;
                        const d = drafts[name] ?? {};
                        return (
                            <div
                                key={name}
                                role="radio"
                                aria-checked={isSelected}
                                tabIndex={isSelected || (!selected && name === 'openai') ? 0 : -1}
                                data-provider={name}
                                data-selected={isSelected}
                                className="lm-ai-setup__card"
                                onClick={() => setSelected(name)}
                                onKeyDown={(e) => onCardKeyDown(e, name)}
                            >
                                <h3 className="lm-ai-setup__title">{PROVIDER_LABELS[name]}</h3>
                                <p className="lm-ai-setup__subline">{copy.subline}</p>
                                <p className="lm-ai-setup__desc">{copy.description}</p>
                                <div className="lm-ai-setup__inputs">
                                    {variant === 'cloud-byok' ? (
                                        <>
                                            <div className="lm-ai-setup__input-row">
                                                <input
                                                    type={d.showKey ? 'text' : 'password'}
                                                    className="lm-ai-setup__input"
                                                    placeholder="API key"
                                                    aria-label={`${PROVIDER_LABELS[name]} API key`}
                                                    value={d.apiKey ?? ''}
                                                    onChange={(e) => setDraft(name, { apiKey: e.target.value })}
                                                    data-testid={`lm-ai-setup-key-${name}`}
                                                />
                                                <button
                                                    type="button"
                                                    className="lm-ai-setup__eye"
                                                    aria-label={d.showKey ? 'Hide key' : 'Show key'}
                                                    aria-pressed={Boolean(d.showKey)}
                                                    onClick={() => setDraft(name, { showKey: !d.showKey })}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                                                        <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
                                                        <circle cx="7" cy="7" r="1.5" />
                                                    </svg>
                                                </button>
                                            </div>
                                            {name === 'openrouter' && (
                                                <input
                                                    type="text"
                                                    className="lm-ai-setup__input"
                                                    placeholder="Model (e.g. anthropic/claude-3.5-sonnet)"
                                                    aria-label="OpenRouter model"
                                                    value={d.model ?? ''}
                                                    onChange={(e) => setDraft(name, { model: e.target.value })}
                                                />
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <input
                                                type="text"
                                                className="lm-ai-setup__input"
                                                placeholder="Base URL"
                                                aria-label="Ollama base URL"
                                                value={d.baseUrl ?? OLLAMA_DEFAULT_BASE_URL}
                                                onChange={(e) => setDraft(name, { baseUrl: e.target.value })}
                                            />
                                            <input
                                                type="text"
                                                className="lm-ai-setup__input"
                                                placeholder="Model (e.g. llava)"
                                                aria-label="Ollama model"
                                                value={d.model ?? ''}
                                                onChange={(e) => setDraft(name, { model: e.target.value })}
                                            />
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        className="lm-ai-setup__select-btn"
                                        data-tier={isSelected ? 'primary' : 'secondary'}
                                        onClick={() => handleSelect(name)}
                                        data-testid={`lm-ai-setup-select-${name}`}
                                    >
                                        Select
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <p className="lm-ai-setup__quality-note">{QUALITY_NOTE}</p>
            </div>
            </EditorSheet>

            {/* Disclosure rendered as a sibling of the EditorSheet so it
                survives the sheet's close-on-open-false unmount. The sheet
                steps aside (open=false) while the disclosure is up; on Ack the
                disclosure unmounts and onCommit fires. */}
            {discloseFor && (
                <PrivacyDisclosure
                    open={Boolean(discloseFor)}
                    providerName={discloseFor}
                    baseUrl={drafts[discloseFor]?.baseUrl}
                    onAck={handleAck}
                    onCancel={handleDisclosureCancel}
                    onSwitchToOllama={handleSwitchToOllama}
                />
            )}
        </>
    );
}
