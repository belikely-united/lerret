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
 *   - Test connection — probes with the form's current (possibly unsaved)
 *     values, falling back to the saved config, so "paste key → Test" works
 *     before Save. Inline `Connected` cue on success (with a persistent
 *     "Save to keep this key" hint when the tested values are unsaved);
 *     contained human-voice error card on failure (raw reason slugs never
 *     render — see probeFailureCopy).
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
    grid-template-columns: 188px 1fr;
    gap: var(--lm-space-6, 24px);
    align-items: start;
    min-height: 232px;
}
.lm-ai-settings__list {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-1, 4px);
}
.lm-ai-settings__row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px;
    border-radius: var(--lm-radius-sm, 6px);
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    text-align: left;
    width: 100%;
    font-family: inherit;
}
.lm-ai-settings__dot {
    width: 7px;
    height: 7px;
    border-radius: var(--lm-radius-pill, 999px);
    flex-shrink: 0;
    box-sizing: border-box;
}
.lm-ai-settings__dot[data-state="active"] { background: var(--lm-accent, #B85B33); }
.lm-ai-settings__dot[data-state="configured"] { background: transparent; border: 1.5px solid var(--lm-accent, #B85B33); }
.lm-ai-settings__dot[data-state="none"] { background: transparent; border: 1.5px solid var(--lm-border, #D8D2C4); }
.lm-ai-settings__row[data-active="true"] .lm-ai-settings__dot {
    background: var(--lm-text-onAccent, #FAF8F2);
    border-color: var(--lm-text-onAccent, #FAF8F2);
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
    font: 400 10.5px/1.2 var(--lm-font-sans);
    margin-left: auto;
    opacity: 0.6;
    white-space: nowrap;
}
.lm-ai-settings__row[data-active="true"] .lm-ai-settings__row-status { opacity: 0.92; }
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
.lm-ai-settings__detail-head {
    display: flex;
    align-items: center;
    gap: 8px;
}
.lm-ai-settings__badge {
    font: 500 10.5px/1 var(--lm-font-sans);
    color: var(--lm-text-onAccent, #FAF8F2);
    background: var(--lm-accent, #B85B33);
    border-radius: var(--lm-radius-pill, 999px);
    padding: 3px 8px;
    letter-spacing: 0.02em;
}
.lm-ai-settings__detail-desc {
    display: flex;
    gap: 7px;
    font: 400 12px/1.5 var(--lm-font-sans);
    color: var(--lm-text-secondary, #44403A);
    margin: 0;
}
.lm-ai-settings__detail-desc svg {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--lm-text-tertiary, #6E6960);
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
    align-self: flex-start;
    margin-top: auto;
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

// ─── Probe-failure copy ──────────────────────────────────────────────────────

/**
 * Map a probe result's machine reason to a human sentence. The raw reason
 * slugs (`invalid-key`, `unreachable`, …) never render directly — an auth
 * rejection in particular must not read as "could not reach" (the request
 * DID reach the vendor; the key was refused).
 *
 * @param {string} providerName
 * @param {{ reason?: string, detail?: string } | null | undefined} result
 * @returns {string}
 */
export function probeFailureCopy(providerName, result) {
    const label = PROVIDER_LABELS[providerName] ?? providerName;
    switch (result?.reason) {
        case 'no-key':
            return 'Enter an API key first, then test the connection.';
        case 'invalid-key':
            return `${label} rejected this API key — check that it's correct and active.`;
        case 'cors':
            return `${label} blocked the request from this origin — see the setup guide for OLLAMA_ORIGINS.`;
        case 'unreachable':
        case 'network':
            return providerName === 'ollama'
                ? 'Could not reach Ollama — make sure it is running at the base URL.'
                : `Could not reach ${label} — check your connection.`;
        case 'server':
            return `${label} returned a server error — try again in a moment.`;
        case 'unavailable':
            return 'AI is not available in this build.';
        default:
            return `Connection test failed${result?.detail ? ` (${result.detail})` : ''}.`;
    }
}

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
    const [probeResult, setProbeResult] = React.useState(/** @type {null | {ok: boolean, reason?: string, detail?: string}} */ (null));
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
        // The just-tested state (cue or error) referred to the pre-save form;
        // clear it so a stale "Save to keep this key" hint never outlives the save.
        setProbeResult(null);
        setShowCue(false);
    };

    const handleMakeActive = async () => {
        await makeActive(selected);
    };

    const handleClear = async () => {
        await clearProvider(selected);
        setDrafts((prev) => ({ ...prev, [selected]: {} }));
    };

    // True when the form holds values the user typed but has not saved — the
    // test then runs against those, and a passing cue must point at Save.
    const draftUsed =
        PROVIDER_VARIANTS[selected] === 'cloud-byok'
            ? Boolean((draft.apiKey ?? '').trim())
            : Boolean((draft.baseUrl ?? '').trim() || (draft.model ?? '').trim());

    const handleTest = async () => {
        setProbeResult(null);
        setShowCue(false);
        const result = await testConnection(selected, {
            apiKey: draft.apiKey,
            baseUrl: draft.baseUrl,
            model: draft.model,
        });
        setProbeResult(result);
        if (result?.ok) {
            setShowCue(true);
            // A pass on unsaved values carries an action ("Save") — that cue
            // stays until the next action; a plain "Connected" fades.
            if (!draftUsed) setTimeout(() => setShowCue(false), 1500);
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
                        const dotState = isAct ? 'active' : c ? 'configured' : 'none';
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
                                <span className="lm-ai-settings__dot" data-state={dotState} aria-hidden="true" />
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
                    <div className="lm-ai-settings__detail-head">
                        <h3 className="lm-ai-settings__detail-title">{PROVIDER_LABELS[selected]}</h3>
                        {isActive && <span className="lm-ai-settings__badge">Active</span>}
                    </div>
                    <p className="lm-ai-settings__detail-desc">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                            <rect x="2.5" y="6.2" width="9" height="6" rx="1.4" />
                            <path d="M4.4 6.2V4.6a2.6 2.6 0 0 1 5.2 0v1.6" />
                        </svg>
                        <span>{PROVIDER_DETAIL_DESC[selected]}</span>
                    </p>

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
                            data-tier={isConfigured ? 'secondary' : 'primary'}
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
                                style={{ marginLeft: 'auto' }}
                                onClick={handleClear}
                                data-testid="lm-ai-settings-clear"
                            >
                                Clear key
                            </button>
                        )}
                    </div>

                    {showCue && (
                        <div className="lm-ai-settings__cue" role="status">
                            {draftUsed
                                ? variant === 'cloud-byok'
                                    ? 'Connected — Save to keep this key.'
                                    : 'Connected — Save to keep these settings.'
                                : 'Connected'}
                        </div>
                    )}
                    {probeResult && !probeResult.ok && (
                        <div className="lm-ai-settings__error" role="alert">
                            {probeFailureCopy(selected, probeResult)}
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
