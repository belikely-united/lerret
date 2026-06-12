// Tests for the AI context provider.
//
// Coverage:
//   - PROVIDER_NAMES contains the four canonical names in canonical order.
//   - PROVIDER_LABELS maps each canonical name to a display label.
//   - PROVIDER_VARIANTS classifies cloud vs local-keyless correctly.
//   - useAiContext returns the default idle value when no provider wraps the consumer.
//
// The provider itself exercises async vault writes which are integration-tested
// at Story 8.2's close (the browser smoke). Here we cover the shape of the
// context and the constants surface that downstream UI components depend on.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

// ── getAi() mock ──────────────────────────────────────────────────────────────
// Module-level handle the testConnection specs reconfigure per-spec. The
// constants/default-context tests never reach getAi (no provider mounted).
const aiMock = {
    current: /** @type {object | null} */ (null),
};
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import {
    PROVIDER_NAMES,
    PROVIDER_LABELS,
    PROVIDER_VARIANTS,
    OLLAMA_DEFAULT_BASE_URL,
    useAiContext,
    useActiveProvider,
    AiContextProvider,
} from './ai-context.jsx';

describe('PROVIDER_NAMES', () => {
    it('lists the four canonical names in canonical order', () => {
        expect(PROVIDER_NAMES).toEqual(['openai', 'anthropic', 'openrouter', 'ollama']);
    });

    it('is frozen (the canonical list cannot be mutated)', () => {
        expect(Object.isFrozen(PROVIDER_NAMES)).toBe(true);
    });
});

describe('PROVIDER_LABELS', () => {
    it('maps each canonical name to its display label', () => {
        expect(PROVIDER_LABELS.openai).toBe('OpenAI');
        expect(PROVIDER_LABELS.anthropic).toBe('Anthropic');
        expect(PROVIDER_LABELS.openrouter).toBe('OpenRouter');
        expect(PROVIDER_LABELS.ollama).toBe('Ollama');
    });
});

describe('PROVIDER_VARIANTS', () => {
    it('classifies the three cloud providers as cloud-byok', () => {
        expect(PROVIDER_VARIANTS.openai).toBe('cloud-byok');
        expect(PROVIDER_VARIANTS.anthropic).toBe('cloud-byok');
        expect(PROVIDER_VARIANTS.openrouter).toBe('cloud-byok');
    });

    it('classifies Ollama as local-keyless', () => {
        expect(PROVIDER_VARIANTS.ollama).toBe('local-keyless');
    });
});

describe('OLLAMA_DEFAULT_BASE_URL', () => {
    it('matches the upstream Ollama default port', () => {
        expect(OLLAMA_DEFAULT_BASE_URL).toBe('http://localhost:11434');
    });
});

describe('useAiContext', () => {
    it('returns the default idle value when no provider wraps the consumer', () => {
        let captured;
        function Probe() {
            captured = useAiContext();
            return null;
        }
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<Probe />);
        });
        expect(captured.aiAvailable).toBe(false);
        expect(captured.folderId).toBeNull();
        expect(captured.activeProvider).toBeNull();
        expect(Array.isArray(captured.providerConfigs)).toBe(true);
        expect(captured.providerConfigs).toHaveLength(0);
        expect(typeof captured.refresh).toBe('function');
        expect(typeof captured.configureProvider).toBe('function');
        expect(typeof captured.makeActive).toBe('function');
        expect(typeof captured.clearProvider).toBe('function');
        expect(typeof captured.recordAck).toBe('function');
        expect(typeof captured.testConnection).toBe('function');
        act(() => root.unmount());
        container.remove();
    });
});

// ── testConnection (draft-first probing) ─────────────────────────────────────

/**
 * Build a fake @lerret/ai module whose single provider class records
 * configure() calls and resolves probe() with the scripted result. `vaultKey`
 * non-null simulates a previously saved (encrypted) key.
 */
function makeFakeAi({ probeResult = { ok: true }, vaultKey = null } = {}) {
    const calls = { configure: [], probe: 0, vaultReads: 0 };
    class FakeProvider {
        configure(cfg) {
            calls.configure.push(cfg);
        }
        async probe() {
            calls.probe += 1;
            return probeResult;
        }
    }
    const ai = {
        providers: {
            OpenAIProvider: FakeProvider,
            AnthropicProvider: FakeProvider,
            OpenRouterProvider: FakeProvider,
            OllamaProvider: FakeProvider,
        },
        vault: {
            listProviderConfigs: async () => [],
            isDisclosureAcked: async () => false,
            getEncryptedKey: async () => {
                calls.vaultReads += 1;
                return vaultKey ? { iv: 'x', data: 'y' } : null;
            },
            getSessionKey: async () => 'session-key',
            decrypt: async () => vaultKey,
        },
    };
    return { ai, calls };
}

/** Mount AiContextProvider and capture the live context value. */
async function captureContext(folderId = 'folder:test:ctx') {
    let captured;
    function Probe() {
        captured = useAiContext();
        return null;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(
            <AiContextProvider folderId={folderId}>
                <Probe />
            </AiContextProvider>,
        );
    });
    return {
        get: () => captured,
        cleanup: () => {
            act(() => root.unmount());
            container.remove();
        },
    };
}

describe('testConnection — draft-first probing', () => {
    it('uses the unsaved draft key (trimmed) without touching the vault', async () => {
        const { ai, calls } = makeFakeAi();
        aiMock.current = ai;
        const ctx = await captureContext();
        const result = await ctx.get().testConnection('anthropic', { apiKey: '  sk-draft-123\n' });
        expect(result).toEqual({ ok: true });
        expect(calls.configure[0].apiKey).toBe('sk-draft-123');
        expect(calls.vaultReads).toBe(0);
        expect(calls.probe).toBe(1);
        ctx.cleanup();
    });

    it('short-circuits with no-key when a cloud provider has neither draft nor saved key', async () => {
        const { ai, calls } = makeFakeAi();
        aiMock.current = ai;
        const ctx = await captureContext();
        const result = await ctx.get().testConnection('anthropic');
        expect(result).toEqual({ ok: false, reason: 'no-key' });
        expect(calls.probe).toBe(0);
        ctx.cleanup();
    });

    it('falls back to the saved vault key when no draft is given', async () => {
        const { ai, calls } = makeFakeAi({ vaultKey: 'sk-saved-456' });
        aiMock.current = ai;
        const ctx = await captureContext();
        const result = await ctx.get().testConnection('openai');
        expect(result).toEqual({ ok: true });
        expect(calls.configure[0].apiKey).toBe('sk-saved-456');
        expect(calls.vaultReads).toBe(1);
        ctx.cleanup();
    });

    it('passes draft baseUrl/model to Ollama probes with no key requirement', async () => {
        const { ai, calls } = makeFakeAi();
        aiMock.current = ai;
        const ctx = await captureContext();
        const result = await ctx
            .get()
            .testConnection('ollama', { baseUrl: 'http://localhost:9999 ', model: ' llava ' });
        expect(result).toEqual({ ok: true });
        expect(calls.configure[0].baseUrl).toBe('http://localhost:9999');
        expect(calls.configure[0].model).toBe('llava');
        expect(calls.probe).toBe(1);
        ctx.cleanup();
    });
});

describe('useActiveProvider', () => {
    it('returns null in the idle default context', () => {
        let captured;
        function Probe() {
            captured = useActiveProvider();
            return null;
        }
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<Probe />);
        });
        expect(captured).toBeNull();
        act(() => root.unmount());
        container.remove();
    });
});
