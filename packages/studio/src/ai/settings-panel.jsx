/**
 * settings-panel.jsx — UX-delta §4.3 AI provider/key settings panel.
 *
 * Summoned via the dock kebab `Settings` item (wiring in Story 8.2). The panel
 * is a two-column Editor sheet: provider list (≈ 35% left) + detail (≈ 65% right).
 * The active provider is marked with the accent fill; inactive providers are
 * ghost-tier. Status is one of `Active`, `Configured · inactive`,
 * `Not configured`.
 *
 * Right-column actions:
 *   - Edit masked API key (cloud) OR base URL + model picker (Ollama).
 *   - Make active — instantaneous per-folder switch; no confirmation modal.
 *   - Test connection — calls provider.probe() via the lazy AI module;
 *     inline `Connected` (moss, 1500ms) on success, contained error card on
 *     failure.
 *   - Clear key — removes the ai_keys entry AND the ai_provider_config row.
 *   - Privacy — re-opens the disclosure dialog in info-only mode.
 */

import React from 'react';

import { EditorSheet } from '../components/editors/editor-sheet.jsx';
import {
    useAiContext,
    PROVIDER_NAMES,
    PROVIDER_LABELS,
    PROVIDER_VARIANTS,
    OLLAMA_DEFAULT_BASE_URL,
} from './ai-context.jsx';
import { PrivacyDisclosure } from './privacy-disclosure.jsx';

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('ai-settings-panel-styles')) {
    const s = document.createElement('style');
    s.id = 'ai-settings-panel-styles';
    s.textContent = `
.lm-ai-settings {
    display: grid;
    grid-template-columns: 35% 1fr;
    gap: var(--lm-space-5, 20px);
    min-height: 400px;
}
.lm-ai-settings__list {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-1, 4px);
}
.lm-ai-settings__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: var(--lm-radius-sm, 6px);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    text-align: left;
    width: 100%;
    font-family: inherit;
}
.lm-ai-settings__row[data-active="true"] {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
}
.lm-ai-settings__row[data-selected="true"]:not([data-active="true"]) {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-ai-settings__row:hover:not([data-active="true"]):not([data-selected="true"]) {
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-ai-settings__row-name {
    font: 500 13px/1.2 var(--lm-font-sans, sans-serif);
}
.lm-ai-settings__row-status {
    font: 400 11px/1.2 var(--lm-font-sans);
    opacity: 0.8;
}
.lm-ai-settings__detail {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-4, 16px);
    border-left: 1px solid var(--lm-border, #D8D2C4);
    padding-left: var(--lm-space-5, 20px);
}
.lm-ai-settings__detail-title {
    font: 600 14px/1.2 var(--lm-font-sans);
    color: var(--lm-text-primary, #1A1714);
    margin: 0;
}
.lm-ai-settings__detail-desc {
    font: 400 12px/1.5 var(--lm-font-sans);
    color: var(--lm-text-secondary, #44403A);
    margin: 0;
}
.lm-ai-settings__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.lm-ai-settings__field label {
    font: 500 11px/1.2 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    letter-spacing: 0.02em;
}
.lm-ai-settings__input-row {
    position: relative;
    display: flex;
    align-items: center;
}
.lm-ai-settings__input {
    flex: 1;
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border, #D8D2C4);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 7px 10px;
    font: 400 12px/1.3 var(--lm-font-mono, ui-monospace, monospace);
    color: var(--lm-text-primary, #1A1714);
    width: 100%;
}
.lm-ai-settings__input:focus {
    outline: none;
    border-color: var(--lm-accent, #B85B33);
}
.lm-ai-settings__eye {
    position: absolute;
    right: 4px;
    background: transparent;
    border: none;
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    padding: 4px;
}
.lm-ai-settings__actions {
    display: flex;
    gap: var(--lm-space-2, 8px);
    flex-wrap: wrap;
    align-items: center;
}
.lm-ai-settings__btn {
    font-family: inherit;
    font-size: 12px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background var(--lm-duration-fast, 120ms);
}
.lm-ai-settings__btn[data-tier="primary"] {
    background: var(--lm-accent, #B85B33);
    color: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-accent, #B85B33);
}
.lm-ai-settings__btn[data-tier="secondary"] {
    background: var(--lm-bg-secondary, #F2EEE6);
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-ai-settings__btn[data-tier="ghost"] {
    background: transparent;
    color: var(--lm-text-tertiary, #6E6960);
    border-color: transparent;
}
.lm-ai-settings__btn[data-tier="ghost"]:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-ai-settings__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-ai-settings__cue {
    font: 500 12px/1.2 var(--lm-font-sans);
    color: var(--lm-moss, #4A6B3F);
    padding: 6px 0;
}
.lm-ai-settings__error {
    background: var(--lm-error-bg, #FBEBE3);
    border: 1px solid var(--lm-error-border, #E8B8A0);
    color: var(--lm-error-text, #8A3A1F);
    border-radius: var(--lm-radius-sm, 6px);
    padding: 10px 12px;
    font: 400 12px/1.4 var(--lm-font-sans);
}
.lm-ai-settings__privacy-link {
    background: transparent;
    border: none;
    font: 400 11px/1.2 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
    padding: 4px 0;
}
.lm-ai-settings__privacy-link:hover {
    color: var(--lm-text-primary, #1A1714);
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Per-provider description copy (matches setup-screen for consistency) ────

const PROVIDER_DETAIL_DESC = Object.freeze({
    openai:
        'Frontier model from OpenAI. Prompts and file contents go directly from your browser to OpenAI — never through a Lerret server.',
    anthropic:
        'Claude from Anthropic. Prompts and file contents go directly from your browser to Anthropic — never through a Lerret server.',
    openrouter:
        'Pick from 200+ models via OpenRouter. Prompts and file contents go directly from your browser to OpenRouter — never through a Lerret server.',
    ollama: 'Runs entirely on your machine. No key. No data leaves your computer.',
});

// ─── Status computation ──────────────────────────────────────────────────────

/**
 * Compute the per-provider status string.
 *
 * @param {string} providerName
 * @param {Array<{providerName: string, active: boolean}>} configs
 * @returns {'Active' | 'Configured · inactive' | 'Not configured'}
 */
function statusFor(providerName, configs) {
    const c = configs.find((c) => c.providerName === providerName);
    if (!c) return 'Not configured';
    return c.active ? 'Active' : 'Configured · inactive';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function SettingsPanel({ open, onClose }) {
    const ctx = useAiContext();
    const { providerConfigs, configureProvider, makeActive, clearProvider, testConnection } = ctx;

    const [selected, setSelected] = React.useState('openai');
    const [drafts, setDrafts] = React.useState({});
    const [probeResult, setProbeResult] = React.useState(/** @type {null | {ok: boolean, reason?: string, message?: string}} */ (null));
    const [showCue, setShowCue] = React.useState(false);
    const [privacyOpen, setPrivacyOpen] = React.useState(false);

    React.useEffect(() => {
        if (!open) {
            setProbeResult(null);
            setShowCue(false);
        }
    }, [open]);

    const cfg = providerConfigs.find((c) => c.providerName === selected);
    const draft = drafts[selected] ?? {};

    const setDraft = (patch) => {
        setDrafts((prev) => ({ ...prev, [selected]: { ...(prev[selected] ?? {}), ...patch } }));
    };

    const handleSaveKey = async () => {
        await configureProvider(selected, {
            apiKey: draft.apiKey,
            baseUrl: draft.baseUrl,
            model: draft.model,
        });
    };

    const handleMakeActive = async () => {
        await makeActive(selected);
    };

    const handleClear = async () => {
        await clearProvider(selected);
        setDrafts((prev) => ({ ...prev, [selected]: {} }));
    };

    const handleTest = async () => {
        setProbeResult(null);
        setShowCue(false);
        const result = await testConnection(selected);
        setProbeResult(result);
        if (result?.ok) {
            setShowCue(true);
            setTimeout(() => setShowCue(false), 1500);
        }
    };

    const variant = PROVIDER_VARIANTS[selected];
    const isActive = cfg?.active === true;
    const isConfigured = Boolean(cfg);

    return (
        <>
        <EditorSheet open={open && !privacyOpen} onClose={onClose} title="AI provider settings">
            <div className="lm-ai-settings">
                {/* Left column — provider list */}
                <div className="lm-ai-settings__list" role="listbox" aria-label="Providers">
                    {PROVIDER_NAMES.map((name) => {
                        const c = providerConfigs.find((c) => c.providerName === name);
                        const isSel = selected === name;
                        const isAct = c?.active === true;
                        return (
                            <button
                                key={name}
                                type="button"
                                role="option"
                                aria-selected={isSel}
                                className="lm-ai-settings__row"
                                data-active={isAct}
                                data-selected={isSel}
                                data-provider={name}
                                onClick={() => setSelected(name)}
                            >
                                <span className="lm-ai-settings__row-name">{PROVIDER_LABELS[name]}</span>
                                <span className="lm-ai-settings__row-status">
                                    {statusFor(name, providerConfigs)}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Right column — detail */}
                <div className="lm-ai-settings__detail">
                    <h3 className="lm-ai-settings__detail-title">{PROVIDER_LABELS[selected]}</h3>
                    <p className="lm-ai-settings__detail-desc">{PROVIDER_DETAIL_DESC[selected]}</p>

                    {variant === 'cloud-byok' ? (
                        <div className="lm-ai-settings__field">
                            <label htmlFor={`api-key-${selected}`}>API key</label>
                            <div className="lm-ai-settings__input-row">
                                <input
                                    id={`api-key-${selected}`}
                                    type={draft.showKey ? 'text' : 'password'}
                                    className="lm-ai-settings__input"
                                    placeholder="API key"
                                    value={draft.apiKey ?? ''}
                                    onChange={(e) => setDraft({ apiKey: e.target.value })}
                                    data-testid={`lm-ai-settings-key-${selected}`}
                                />
                                <button
                                    type="button"
                                    className="lm-ai-settings__eye"
                                    aria-label={draft.showKey ? 'Hide key' : 'Show key'}
                                    onClick={() => setDraft({ showKey: !draft.showKey })}
                                >
                                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                                        <path d="M1 7s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" />
                                        <circle cx="7" cy="7" r="1.5" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="lm-ai-settings__field">
                                <label htmlFor="ollama-base-url">Base URL</label>
                                <input
                                    id="ollama-base-url"
                                    type="text"
                                    className="lm-ai-settings__input"
                                    value={draft.baseUrl ?? cfg?.baseUrl ?? OLLAMA_DEFAULT_BASE_URL}
                                    onChange={(e) => setDraft({ baseUrl: e.target.value })}
                                />
                            </div>
                            <div className="lm-ai-settings__field">
                                <label htmlFor="ollama-model">Model</label>
                                <input
                                    id="ollama-model"
                                    type="text"
                                    className="lm-ai-settings__input"
                                    placeholder="llava"
                                    value={draft.model ?? cfg?.model ?? ''}
                                    onChange={(e) => setDraft({ model: e.target.value })}
                                />
                            </div>
                        </>
                    )}

                    <div className="lm-ai-settings__actions">
                        <button
                            type="button"
                            className="lm-ai-settings__btn"
                            data-tier="secondary"
                            onClick={handleSaveKey}
                            data-testid="lm-ai-settings-save"
                        >
                            Save
                        </button>
                        {!isActive && isConfigured && (
                            <button
                                type="button"
                                className="lm-ai-settings__btn"
                                data-tier="primary"
                                onClick={handleMakeActive}
                                data-testid="lm-ai-settings-make-active"
                            >
                                Make active
                            </button>
                        )}
                        <button
                            type="button"
                            className="lm-ai-settings__btn"
                            data-tier="secondary"
                            onClick={handleTest}
                            data-testid="lm-ai-settings-test"
                        >
                            Test connection
                        </button>
                        {isConfigured && (
                            <button
                                type="button"
                                className="lm-ai-settings__btn"
                                data-tier="ghost"
                                onClick={handleClear}
                                data-testid="lm-ai-settings-clear"
                            >
                                Clear key
                            </button>
                        )}
                    </div>

                    {showCue && (
                        <div className="lm-ai-settings__cue" role="status">
                            Connected
                        </div>
                    )}
                    {probeResult && !probeResult.ok && (
                        <div className="lm-ai-settings__error" role="alert">
                            Could not reach {PROVIDER_LABELS[selected]}
                            {probeResult.reason ? ` — ${probeResult.reason}` : ''}
                            {probeResult.message ? `: ${probeResult.message}` : ''}.
                        </div>
                    )}

                    <button
                        type="button"
                        className="lm-ai-settings__privacy-link"
                        onClick={() => setPrivacyOpen(true)}
                        data-testid="lm-ai-settings-privacy"
                    >
                        Privacy
                    </button>
                </div>
            </div>
        </EditorSheet>

            {/* Disclosure rendered as a sibling of the EditorSheet (see
                setup-screen for the same pattern). The sheet hides itself
                while the disclosure is up so the EditorSheet singleton slot is
                free for the disclosure to render through. */}
            {privacyOpen && (
                <PrivacyDisclosure
                    open={privacyOpen}
                    providerName={selected}
                    baseUrl={cfg?.baseUrl}
                    infoOnly
                    onAck={() => setPrivacyOpen(false)}
                    onCancel={() => setPrivacyOpen(false)}
                />
            )}
        </>
    );
}
