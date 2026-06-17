/**
 * setup-screen.jsx — UX-delta §4.2 first-run AI provider setup screen.
 *
 * Summons the first time the user submits anything to the dock AI input on a
 * folder where no provider is configured. A centered Editor-sheet variant
 * (≈ 880 × 540), four full-width provider cards stacked vertically (OpenAI /
 * Anthropic / OpenRouter / Ollama). Selecting a provider commits the user's chosen turn;
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
 *
 * Hosted-mode Ollama detour (Story 8.10): when the studio runs in hosted mode
 * (`https://lerret.belikely.com`), step 3's Ollama Select first probes the
 * local endpoint and routes on the classification — `ok` proceeds to the
 * disclosure as before, `cors` auto-summons the OLLAMA_ORIGINS guide, and
 * `unreachable` shows a contained error on the Ollama card with a docs link.
 * In CLI / non-hosted modes the probe never runs (no CORS hurdle) and the
 * Select path is exactly the pre-8.10 behavior.
 */

import React from 'react';

import { EditorSheet } from '../components/editors/editor-sheet.jsx';
import { useAiContext, PROVIDER_NAMES, PROVIDER_LABELS, PROVIDER_VARIANTS, OLLAMA_DEFAULT_BASE_URL } from './ai-context.jsx';
import { PrivacyDisclosure } from './privacy-disclosure.jsx';
import { getAi } from './lazy.js';
import { classifyOllamaProbe, shouldRunHostedProbe } from './ollama-hosted-detect.js';
import { OllamaOriginsGuide, OLLAMA_DOCS_URL } from './ollama-origins-guide.jsx';

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
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-3, 12px);
}
.lm-ai-setup__card {
    background: var(--lm-bg-secondary, #F2EEE6);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-md, 8px);
    padding: var(--lm-space-4, 16px);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: var(--lm-space-5, 20px);
    cursor: pointer;
    transition: border-color var(--lm-duration-fast, 120ms), background var(--lm-duration-fast, 120ms);
}
@media (max-width: 760px) {
    .lm-ai-setup__card {
        flex-direction: column;
        align-items: stretch;
    }
}
.lm-ai-setup__card[data-selected="true"] {
    border-color: var(--lm-accent, #B85B33);
    background: var(--lm-bg-primary, #FAF8F2);
}
.lm-ai-setup__card:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-ai-setup__body {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-1, 4px);
    flex: 1;
    min-width: 0;
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
    max-width: 52ch;
}
.lm-ai-setup__inputs {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    width: 280px;
    flex: none;
}
@media (max-width: 760px) {
    .lm-ai-setup__inputs { width: 100%; }
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
.lm-ai-setup__error {
    background: var(--lm-error-bg, #FBEBE3);
    border: 1px solid var(--lm-error-border, #E8B8A0);
    color: var(--lm-error-text, #8A3A1F);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 8px 10px;
    font: 400 12px/1.4 var(--lm-font-sans);
    margin-top: var(--lm-space-2, 8px);
}
.lm-ai-setup__error a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Hosted-mode Ollama probe (Story 8.10) ────────────────────────────────────

/**
 * Run the Ollama `probe()` against the draft config and classify the result
 * into a setup-screen route. Reaches @lerret/ai ONLY via {@link getAi}; every
 * failure on the way (chunk missing, invalid draft baseUrl rejected by
 * `configure`, probe throw) fails safe to `'unreachable'` — never to the
 * guide (Story 8.10 guardrail #4).
 *
 * Used by the Ollama Select path (gated by `shouldRunHostedProbe()`) and by
 * the guide's `Retry connection` button (which re-reads the then-current
 * draft via the closure in the component below).
 *
 * @param {{ baseUrl?: string, model?: string }} [draft]
 * @returns {Promise<'ok' | 'cors' | 'unreachable'>}
 */
async function probeOllamaHosted(draft) {
    try {
        const ai = await getAi();
        if (!ai) return 'unreachable';
        const provider = new ai.providers.OllamaProvider();
        provider.configure({ baseUrl: draft?.baseUrl, model: draft?.model });
        return classifyOllamaProbe(await provider.probe());
    } catch {
        return 'unreachable';
    }
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

    // Story 8.10 hosted-mode Ollama state: the OLLAMA_ORIGINS guide overlay
    // (cors route) and the contained error on the Ollama card (unreachable
    // route).
    const [guideOpen, setGuideOpen] = React.useState(false);
    const [ollamaError, setOllamaError] = React.useState(false);

    const cardsRef = React.useRef(null);

    React.useEffect(() => {
        if (!open) {
            // Reset draft state on close so the next open starts fresh except
            // the Ollama default URL.
            setSelected(null);
            setDiscloseFor(null);
            setGuideOpen(false);
            setOllamaError(false);
        }
    }, [open]);

    const setDraft = (name, patch) => {
        setDrafts((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), ...patch } }));
    };

    const handleSelect = async (name) => {
        const d = drafts[name] ?? {};
        // Cloud providers require an API key before commit.
        if (PROVIDER_VARIANTS[name] === 'cloud-byok' && !d.apiKey) {
            // No key — bail; the user can fill the field and try again.
            return;
        }
        // Story 8.10 — hosted-mode Ollama probe-and-classify (AC-1/2/10).
        // Gated on shouldRunHostedProbe(): in CLI / non-hosted modes the
        // probe NEVER runs and the Select path falls straight through to the
        // disclosure, exactly as before this story.
        if (name === 'ollama' && shouldRunHostedProbe()) {
            setOllamaError(false);
            const route = await probeOllamaHosted(d);
            if (route === 'cors') {
                // Ollama is running but the browser blocked it — auto-summon
                // the OLLAMA_ORIGINS guide.
                setGuideOpen(true);
                return;
            }
            if (route === 'unreachable') {
                // Not running / network error / anything unclear — contained
                // error on the card (never the guide; fail-safe).
                setOllamaError(true);
                return;
            }
            // 'ok' — CORS already configured; proceed to the disclosure.
        }
        // Do NOT persist anything yet. The provider key + active-config write
        // is deferred to handleAck so that an Esc-cancel of the disclosure
        // leaves NO orphaned key, NO ai_provider_config row, and NO change to
        // the folder's active provider. (Previously configure ran here, before
        // the disclosure, so backing out still committed everything.)
        setDiscloseFor(name);
    };

    // ── Story 8.10 — OLLAMA_ORIGINS guide callbacks ────────────────────────

    // Re-runs the probe against the THEN-current Ollama draft (the guide's
    // Step 3 `Retry connection`); the guide branches on the returned route.
    const handleGuideRetry = () => probeOllamaHosted(drafts.ollama ?? {});

    // Retry classified 'ok' — the guide dismisses and setup resumes on the
    // disclosure path (then the turn commits via handleAck as usual).
    const handleGuideSuccess = () => {
        setGuideOpen(false);
        setDiscloseFor('ollama');
    };

    // Ghost-tier bypass (AC-8) — back to the four-card chooser with the
    // Ollama card unselected.
    const handleGuideUseDifferentProvider = () => {
        setGuideOpen(false);
        setSelected(null);
    };

    // Esc (AC-9) — the guide closes and the whole setup dismisses; the
    // originally-submitted turn is discarded by the caller via the existing
    // onClose contract (Story 8.2's deferred — same wiring as the
    // disclosure-cancel path).
    const handleGuideDismiss = () => {
        setGuideOpen(false);
        onClose?.();
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
                open={open && !discloseFor && !guideOpen}
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
                                <div className="lm-ai-setup__body">
                                    <h3 className="lm-ai-setup__title">{PROVIDER_LABELS[name]}</h3>
                                    <p className="lm-ai-setup__subline">{copy.subline}</p>
                                    <p className="lm-ai-setup__desc">{copy.description}</p>
                                </div>
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
                                    {name === 'ollama' && ollamaError && (
                                        <div
                                            className="lm-ai-setup__error"
                                            role="alert"
                                            data-testid="lm-ai-setup-ollama-error"
                                        >
                                            Could not reach Ollama. Make sure it's running on
                                            your machine, or{' '}
                                            <a
                                                href={OLLAMA_DOCS_URL}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                data-testid="lm-ai-setup-ollama-error-docs"
                                            >
                                                see the Ollama setup docs
                                            </a>
                                            .
                                        </div>
                                    )}
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

            {/* Story 8.10 — OLLAMA_ORIGINS guide. Like the disclosure, a
                sibling of the EditorSheet (which steps aside via open=false
                while the guide is up). Only reachable from the hosted-mode
                cors route in handleSelect; never summoned in CLI mode. */}
            {guideOpen && (
                <OllamaOriginsGuide
                    open={guideOpen}
                    onRetry={handleGuideRetry}
                    onSuccess={handleGuideSuccess}
                    onUseDifferentProvider={handleGuideUseDifferentProvider}
                    onDismiss={handleGuideDismiss}
                />
            )}
        </>
    );
}
