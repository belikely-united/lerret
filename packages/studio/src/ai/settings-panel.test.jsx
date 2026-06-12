// Tests for the AI provider settings panel (UX-delta §4.3).
//
// Coverage:
//   - Renders four provider rows in the left list with default "Not configured" status.
//   - Selecting a row updates the right detail to the chosen provider.
//   - The Privacy link opens an info-only disclosure.
//   - Cloud and Ollama variants render their correct input shapes.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── getAi() mock ──────────────────────────────────────────────────────────────
// Module-level handle the Test-connection specs reconfigure per-spec. The
// render/privacy tests never reach getAi (they mount without a provider and
// see the default idle context).
const aiMock = {
    current: /** @type {object | null} */ (null),
};
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import { _resetSheetSingleton } from '../components/editors/editor-sheet.jsx';
import { SettingsPanel, probeFailureCopy } from './settings-panel.jsx';
import { PROVIDER_NAMES, AiContextProvider } from './ai-context.jsx';

// ── Test infra ────────────────────────────────────────────────────────────────

function renderToDom(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(element);
    });
    return {
        container,
        rerender(el) {
            act(() => root.render(el));
        },
        cleanup() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

async function tick(ms = 20) {
    await new Promise((r) => setTimeout(r, ms));
}

function setReactInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Fake @lerret/ai module for the Test-connection flow: one provider class
 * recording configure() args, probe() resolving the scripted result, and an
 * empty vault (nothing saved — the draft-first case).
 */
function makeFakeAi({ probeResult = { ok: true } } = {}) {
    const calls = { configure: [], probe: 0 };
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
            getEncryptedKey: async () => null,
            getSessionKey: async () => 'session-key',
            decrypt: async () => null,
        },
    };
    return { ai, calls };
}

function renderPanelWithAi(fake) {
    aiMock.current = fake.ai;
    return renderToDom(
        <AiContextProvider folderId="folder:test:panel">
            <SettingsPanel open onClose={() => {}} />
        </AiContextProvider>,
    );
}

beforeEach(() => {
    _resetSheetSingleton();
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
});

afterEach(() => {
    _resetSheetSingleton();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ── Render ────────────────────────────────────────────────────────────────────

describe('SettingsPanel — render', () => {
    it('renders four provider rows in the left list', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        for (const name of PROVIDER_NAMES) {
            const row = document.querySelector(`[data-provider="${name}"]`);
            expect(row, `row for ${name}`).not.toBeNull();
        }
        cleanup();
    });

    it('shows "Not configured" status for each provider by default', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        const rows = document.querySelectorAll('.lm-ai-settings__row');
        expect(rows.length).toBe(4);
        for (const row of rows) {
            const status = row.querySelector('.lm-ai-settings__row-status');
            expect(status.textContent).toBe('Not configured');
        }
        cleanup();
    });

    it('renders the cloud (key) input by default for OpenAI', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        const keyInput = document.querySelector('[data-testid="lm-ai-settings-key-openai"]');
        expect(keyInput).not.toBeNull();
        expect(keyInput.getAttribute('type')).toBe('password');
        cleanup();
    });

    it('switches to Ollama base-url + model input when Ollama row is clicked', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        const ollamaRow = document.querySelector('[data-provider="ollama"]');
        await act(async () => {
            ollamaRow.click();
            await tick(20);
        });
        const baseUrlInput = document.querySelector('#ollama-base-url');
        expect(baseUrlInput).not.toBeNull();
        expect(baseUrlInput.value).toBe('http://localhost:11434');
        const modelInput = document.querySelector('#ollama-model');
        expect(modelInput).not.toBeNull();
        cleanup();
    });
});

// ── Privacy link ──────────────────────────────────────────────────────────────

describe('SettingsPanel — Privacy link', () => {
    it('opens the disclosure in info-only mode when clicked', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        const link = document.querySelector('[data-testid="lm-ai-settings-privacy"]');
        await act(async () => {
            link.click();
            await tick(20);
        });
        const disclosure = document.querySelector('.lm-ai-disclosure');
        expect(disclosure).not.toBeNull();
        cleanup();
    });
});

// ── Actions surface ──────────────────────────────────────────────────────────

describe('SettingsPanel — action buttons', () => {
    it('shows Save and Test connection by default', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        expect(document.querySelector('[data-testid="lm-ai-settings-save"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="lm-ai-settings-test"]')).not.toBeNull();
        cleanup();
    });

    it('does not render Make active / Clear key when the provider is not configured', async () => {
        const { cleanup } = renderToDom(<SettingsPanel open onClose={() => {}} />);
        await act(async () => {
            await tick(30);
        });
        expect(document.querySelector('[data-testid="lm-ai-settings-make-active"]')).toBeNull();
        expect(document.querySelector('[data-testid="lm-ai-settings-clear"]')).toBeNull();
        cleanup();
    });
});

// ── Test connection (draft-first) ────────────────────────────────────────────

describe('SettingsPanel — Test connection', () => {
    afterEach(() => {
        aiMock.current = null;
    });

    it('tests the typed (unsaved) key and shows the persistent save hint', async () => {
        const fake = makeFakeAi({ probeResult: { ok: true } });
        const { cleanup } = renderPanelWithAi(fake);
        await act(async () => {
            await tick(30);
        });
        const keyInput = document.querySelector('[data-testid="lm-ai-settings-key-openai"]');
        await act(async () => {
            setReactInputValue(keyInput, '  sk-typed-but-not-saved\n');
        });
        const testBtn = document.querySelector('[data-testid="lm-ai-settings-test"]');
        await act(async () => {
            testBtn.click();
            await tick(30);
        });
        expect(fake.calls.probe).toBe(1);
        expect(fake.calls.configure[0].apiKey).toBe('sk-typed-but-not-saved');
        const cue = document.querySelector('.lm-ai-settings__cue');
        expect(cue).not.toBeNull();
        expect(cue.textContent).toBe('Connected — Save to keep this key.');
        // The save hint carries an action — it must not auto-fade like the
        // plain Connected cue (1500ms).
        await act(async () => {
            await tick(1700);
        });
        expect(document.querySelector('.lm-ai-settings__cue')).not.toBeNull();
        cleanup();
    });

    it('renders honest copy when the vendor rejects the key (never the raw slug)', async () => {
        const fake = makeFakeAi({ probeResult: { ok: false, reason: 'invalid-key' } });
        const { cleanup } = renderPanelWithAi(fake);
        await act(async () => {
            await tick(30);
        });
        const keyInput = document.querySelector('[data-testid="lm-ai-settings-key-openai"]');
        await act(async () => {
            setReactInputValue(keyInput, 'sk-bogus');
        });
        const testBtn = document.querySelector('[data-testid="lm-ai-settings-test"]');
        await act(async () => {
            testBtn.click();
            await tick(30);
        });
        const error = document.querySelector('.lm-ai-settings__error');
        expect(error).not.toBeNull();
        expect(error.textContent).toBe(
            "OpenAI rejected this API key — check that it's correct and active.",
        );
        expect(error.textContent).not.toContain('invalid-key');
        expect(error.textContent).not.toContain('Could not reach');
        cleanup();
    });

    it('asks for a key (without probing) when the form is empty and nothing is saved', async () => {
        const fake = makeFakeAi({ probeResult: { ok: true } });
        const { cleanup } = renderPanelWithAi(fake);
        await act(async () => {
            await tick(30);
        });
        const testBtn = document.querySelector('[data-testid="lm-ai-settings-test"]');
        await act(async () => {
            testBtn.click();
            await tick(30);
        });
        expect(fake.calls.probe).toBe(0);
        const error = document.querySelector('.lm-ai-settings__error');
        expect(error).not.toBeNull();
        expect(error.textContent).toBe('Enter an API key first, then test the connection.');
        cleanup();
    });
});

// ── probeFailureCopy ─────────────────────────────────────────────────────────

describe('probeFailureCopy', () => {
    it('maps invalid-key to a rejection sentence, not a reachability claim', () => {
        const copy = probeFailureCopy('anthropic', { reason: 'invalid-key' });
        expect(copy).toBe("Anthropic rejected this API key — check that it's correct and active.");
    });

    it('maps no-key to a prompt for input', () => {
        expect(probeFailureCopy('openai', { reason: 'no-key' })).toBe(
            'Enter an API key first, then test the connection.',
        );
    });

    it('maps unreachable per-variant (cloud vs Ollama)', () => {
        expect(probeFailureCopy('openai', { reason: 'unreachable' })).toBe(
            'Could not reach OpenAI — check your connection.',
        );
        expect(probeFailureCopy('ollama', { reason: 'network' })).toBe(
            'Could not reach Ollama — make sure it is running at the base URL.',
        );
    });

    it('falls back to a generic sentence carrying the detail when present', () => {
        expect(probeFailureCopy('openrouter', { reason: 'other', detail: 'HTTP 429' })).toBe(
            'Connection test failed (HTTP 429).',
        );
        expect(probeFailureCopy('openrouter', { reason: 'probe-failed' })).toBe(
            'Connection test failed.',
        );
    });
});
