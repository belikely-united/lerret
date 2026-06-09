/**
 * ai-context.jsx — React 19 context for the studio's AI subsystem.
 *
 * Carries the per-folder active provider state, the `folderId` from the
 * existing studio project-model context, and helper actions that wrap the
 * @lerret/ai vault store (`setProviderConfig`, `clearEncryptedKey`,
 * `recordDisclosureAck`, etc.) so AI surfaces (setup-screen, privacy-disclosure,
 * settings-panel) don't have to plumb the lazy module reference through every
 * level.
 *
 * The provider deliberately reaches @lerret/ai via the {@link getAi} shim —
 * NEVER via a static `import`. When the optional dependency is not installed,
 * the context value still renders with `aiAvailable: false` so consumers can
 * show an empty/idle state.
 *
 * Architectural references:
 *   - architecture-epic-8.md §Studio Chrome (AI Glue)
 *   - architecture-epic-8.md §Pattern Extensions / New Invariants #1
 *   - UX-delta §State Model (Configured / Active / Not-configured)
 */

import React from 'react';

import { getAi } from './lazy.js';

/**
 * Canonical provider names. The display labels for the same set are managed
 * inside the UI components — the persistence layer uses the canonical strings
 * (matching the four `packages/ai/src/providers/{name}.js` modules).
 *
 * @type {ReadonlyArray<'openai' | 'anthropic' | 'openrouter' | 'ollama'>}
 */
export const PROVIDER_NAMES = Object.freeze(['openai', 'anthropic', 'openrouter', 'ollama']);

/**
 * Display labels for the four providers. UI surfaces use these in headings,
 * cards, and copy interpolation (e.g. `{Provider}` in the privacy disclosure).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PROVIDER_LABELS = Object.freeze({
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    ollama: 'Ollama',
});

/**
 * Variant tag per provider. `cloud-byok` providers require an API key; the
 * `local-keyless` Ollama variant uses a base URL + model picker instead.
 *
 * @type {Readonly<Record<string, 'cloud-byok' | 'local-keyless'>>}
 */
export const PROVIDER_VARIANTS = Object.freeze({
    openai: 'cloud-byok',
    anthropic: 'cloud-byok',
    openrouter: 'cloud-byok',
    ollama: 'local-keyless',
});

/**
 * Default Ollama base URL — matches the upstream default for `ollama serve`.
 *
 * @type {string}
 */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

// ─── Context shape ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ProviderConfigEntry
 * @property {string} providerName - Canonical provider name.
 * @property {boolean} active - True when this is the active provider for the folder.
 * @property {string} [model] - Selected model id (Ollama / OpenRouter).
 * @property {string} [baseUrl] - Base URL (Ollama).
 * @property {string} configuredAt - ISO-8601 timestamp.
 */

/**
 * @typedef {Object} AiContextValue
 * @property {boolean} aiAvailable - False when @lerret/ai is not installed.
 * @property {string | null} folderId - The current folder identity, or null.
 * @property {Array<ProviderConfigEntry>} providerConfigs - All configured providers for the folder.
 * @property {string | null} activeProvider - The active provider's name, or null.
 * @property {(name: string) => boolean} isDisclosureAcked - Sync check from the local snapshot of ack rows.
 * @property {(name: string) => Promise<void>} refresh - Re-fetch the snapshot from IndexedDB.
 * @property {(name: string, payload: { apiKey?: string, baseUrl?: string, model?: string }) => Promise<void>} configureProvider
 * @property {(name: string) => Promise<void>} makeActive
 * @property {(name: string) => Promise<void>} clearProvider
 * @property {(name: string) => Promise<void>} recordAck
 * @property {(name: string) => Promise<{ ok: boolean, reason?: string }>} testConnection
 */

/** @type {React.Context<AiContextValue | null>} */
const AiContext = React.createContext(null);

/**
 * Default no-op context value, used when no provider is mounted (so a stray
 * consumer doesn't crash; it just sees the idle state).
 *
 * @type {AiContextValue}
 */
const DEFAULT_VALUE = Object.freeze({
    aiAvailable: false,
    folderId: null,
    providerConfigs: [],
    activeProvider: null,
    isDisclosureAcked: () => false,
    refresh: async () => {},
    configureProvider: async () => {},
    makeActive: async () => {},
    clearProvider: async () => {},
    recordAck: async () => {},
    testConnection: async () => ({ ok: false, reason: 'unavailable' }),
});

/**
 * Read the current AI context. Returns the default idle value when no provider
 * has been mounted, which keeps consumer components from crashing in storybook
 * or test setups that don't wrap them in `<AiContextProvider>`.
 *
 * @returns {AiContextValue}
 */
export function useAiContext() {
    const ctx = React.useContext(AiContext);
    return ctx ?? DEFAULT_VALUE;
}

/**
 * Convenience hook returning just the per-folder active-provider name, or null
 * when none configured. Components that only need to read the active provider
 * (e.g. the dock cluster's eventual provider pill) can pull this alone.
 *
 * @returns {string | null}
 */
export function useActiveProvider() {
    return useAiContext().activeProvider;
}

// ─── Provider component ───────────────────────────────────────────────────────

/**
 * Snapshot of the on-disk vault state, kept in memory so render-time reads are
 * synchronous. Refreshed via `refresh()` after every write.
 *
 * @typedef {Object} VaultSnapshot
 * @property {Array<ProviderConfigEntry>} configs
 * @property {Record<string, boolean>} acks - Map of `${providerName}` → acked-bool.
 */

/**
 * Provider for the AI context. Mount once at the studio shell level, beneath
 * any folder-binding context that supplies the `folderId`.
 *
 * @param {object} props
 * @param {string | null} props.folderId - The current folder identity from the existing studio project-model context.
 * @param {React.ReactNode} props.children
 */
export function AiContextProvider({ folderId, children }) {
    const [snapshot, setSnapshot] = React.useState(/** @type {VaultSnapshot} */ ({ configs: [], acks: {} }));
    const [aiAvailable, setAiAvailable] = React.useState(false);

    // Refresh — pulls the vault state for the current folder from IndexedDB.
    const refresh = React.useCallback(async () => {
        const ai = await getAi();
        if (!ai || !folderId) {
            setAiAvailable(Boolean(ai));
            setSnapshot({ configs: [], acks: {} });
            return;
        }
        setAiAvailable(true);
        try {
            const configs = await ai.vault.listProviderConfigs({ folderId });
            const acks = {};
            for (const name of PROVIDER_NAMES) {
                acks[name] = await ai.vault.isDisclosureAcked({ folderId, providerName: name });
            }
            setSnapshot({ configs, acks });
        } catch (_err) {
            // Vault read failure → render idle state. The settings panel can
            // probe the underlying error via lazy.lastLoadError; routine UI
            // does not surface IDB errors directly (calm voice).
            setSnapshot({ configs: [], acks: {} });
        }
    }, [folderId]);

    React.useEffect(() => {
        refresh();
    }, [refresh]);

    // ── Writes ─────────────────────────────────────────────────────────────

    const configureProvider = React.useCallback(
        async (providerName, payload) => {
            const ai = await getAi();
            if (!ai || !folderId) return;
            // Encrypt key (cloud only).
            if (payload?.apiKey) {
                const sessionKey = await ai.vault.getSessionKey(folderId);
                const encrypted = await ai.vault.encrypt(payload.apiKey, sessionKey);
                await ai.vault.setEncryptedKey({ folderId, providerName, payload: encrypted });
            }
            // Mark all others inactive in this folder, then write this entry as active.
            const existing = await ai.vault.listProviderConfigs({ folderId });
            for (const e of existing) {
                if (e.providerName !== providerName && e.active) {
                    await ai.vault.setProviderConfig({
                        folderId,
                        providerName: e.providerName,
                        config: { ...e, active: false },
                    });
                }
            }
            await ai.vault.setProviderConfig({
                folderId,
                providerName,
                config: {
                    active: true,
                    model: payload?.model,
                    baseUrl: payload?.baseUrl,
                    configuredAt: new Date().toISOString(),
                },
            });
            await refresh();
        },
        [folderId, refresh],
    );

    const makeActive = React.useCallback(
        async (providerName) => {
            const ai = await getAi();
            if (!ai || !folderId) return;
            const existing = await ai.vault.listProviderConfigs({ folderId });
            for (const e of existing) {
                const shouldBeActive = e.providerName === providerName;
                if (e.active !== shouldBeActive) {
                    await ai.vault.setProviderConfig({
                        folderId,
                        providerName: e.providerName,
                        config: { ...e, active: shouldBeActive },
                    });
                }
            }
            await refresh();
        },
        [folderId, refresh],
    );

    const clearProvider = React.useCallback(
        async (providerName) => {
            const ai = await getAi();
            if (!ai || !folderId) return;
            await ai.vault.clearEncryptedKey({ folderId, providerName });
            // Determine successor active provider before deleting the current row.
            const existing = await ai.vault.listProviderConfigs({ folderId });
            const wasActive = existing.find((e) => e.providerName === providerName)?.active === true;
            const remaining = existing.filter((e) => e.providerName !== providerName);
            // Delete the provider-config row via the dedicated delete API.
            // (setProviderConfig({config: null}) throws — putProviderConfig
            // dereferences config.active — and would leave an orphaned keyless
            // row; clearProviderConfig is the correct delete surface, AC-22.)
            await ai.vault.clearProviderConfig({ folderId, providerName });
            if (wasActive && remaining.length > 0) {
                const successor = [...remaining].sort((a, b) =>
                    String(b.configuredAt).localeCompare(String(a.configuredAt)),
                )[0];
                await ai.vault.setProviderConfig({
                    folderId,
                    providerName: successor.providerName,
                    config: { ...successor, active: true },
                });
            }
            await refresh();
        },
        [folderId, refresh],
    );

    const recordAck = React.useCallback(
        async (providerName) => {
            const ai = await getAi();
            if (!ai || !folderId) return;
            await ai.vault.recordDisclosureAck({ folderId, providerName });
            await refresh();
        },
        [folderId, refresh],
    );

    const testConnection = React.useCallback(
        async (providerName) => {
            const ai = await getAi();
            if (!ai || !folderId) return { ok: false, reason: 'unavailable' };
            try {
                const ProviderClass = pickProviderClass(ai, providerName);
                if (!ProviderClass) return { ok: false, reason: 'unknown-provider' };
                const provider = new ProviderClass();
                const cfg = snapshot.configs.find((c) => c.providerName === providerName);
                let apiKey;
                if (PROVIDER_VARIANTS[providerName] === 'cloud-byok') {
                    const enc = await ai.vault.getEncryptedKey({ folderId, providerName });
                    if (enc) {
                        const sessionKey = await ai.vault.getSessionKey(folderId);
                        apiKey = await ai.vault.decrypt(enc, sessionKey);
                    }
                }
                provider.configure({
                    apiKey,
                    baseUrl: cfg?.baseUrl,
                    model: cfg?.model,
                });
                return await provider.probe();
            } catch {
                // Never forward a raw error message to the UI: the decrypted
                // `apiKey` is in scope in this frame, and some fetch/serialization
                // error paths can echo request headers. Return a fixed reason
                // string; the provider's own probe() returns structured
                // {reason, detail} on expected failures, which callers render
                // safely.
                return { ok: false, reason: 'probe-failed' };
            }
        },
        [folderId, snapshot.configs],
    );

    const isDisclosureAcked = React.useCallback(
        (providerName) => Boolean(snapshot.acks[providerName]),
        [snapshot.acks],
    );

    const activeProvider = React.useMemo(() => {
        const a = snapshot.configs.find((c) => c.active);
        return a?.providerName ?? null;
    }, [snapshot.configs]);

    const value = React.useMemo(
        () => ({
            aiAvailable,
            folderId,
            providerConfigs: snapshot.configs,
            activeProvider,
            isDisclosureAcked,
            refresh,
            configureProvider,
            makeActive,
            clearProvider,
            recordAck,
            testConnection,
        }),
        [
            aiAvailable,
            folderId,
            snapshot.configs,
            activeProvider,
            isDisclosureAcked,
            refresh,
            configureProvider,
            makeActive,
            clearProvider,
            recordAck,
            testConnection,
        ],
    );

    return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

/**
 * Resolve the provider class on the @lerret/ai module namespace. The four
 * provider classes live under the `providers` namespace
 * (`packages/ai/src/index.js` does `export * as providers from
 * './providers/index.js'`), so they are reached as `ai.providers.X`, NOT as
 * top-level `ai.X`.
 *
 * @param {object} ai - The @lerret/ai module namespace.
 * @param {string} providerName
 * @returns {Function | null}
 */
function pickProviderClass(ai, providerName) {
    const ns = ai?.providers;
    if (!ns) return null;
    switch (providerName) {
        case 'openai':
            return ns.OpenAIProvider ?? null;
        case 'anthropic':
            return ns.AnthropicProvider ?? null;
        case 'openrouter':
            return ns.OpenRouterProvider ?? null;
        case 'ollama':
            return ns.OllamaProvider ?? null;
        default:
            return null;
    }
}
