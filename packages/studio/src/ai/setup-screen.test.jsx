// Tests for the first-run setup screen (UX-delta §4.2).
//
// Coverage:
//   - Renders four provider cards when open.
//   - The NFR19 verbatim quality note is present below the card row.
//   - Skip for now calls onSkip and DOES NOT call configureProvider.
//   - Selecting a cloud provider without a key is a no-op (no commit).
//   - Selecting Ollama (keyless) opens the inline privacy disclosure.
//   - Story 8.10 hosted-mode Ollama probe routing: cors → OLLAMA_ORIGINS
//     guide; ok → disclosure; unreachable → contained card error + docs link;
//     CLI / non-hosted → disclosure directly with the probe NEVER called.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── getAi() mock (Story 8.10 probe routing) ──────────────────────────────────
// A module-level handle the hosted-mode tests reconfigure per-spec before
// clicking Select. The pre-8.10 tests never touch getAi (the default null is
// fine — the probe path is gated off without the hosted flag).
const aiMock = {
    current: /** @type {object | null} */ (null),
};
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import { _resetSheetSingleton } from '../components/editors/editor-sheet.jsx';
import { SetupScreen } from './setup-screen.jsx';
import { PROVIDER_NAMES } from './ai-context.jsx';
import { OLLAMA_DOCS_URL } from './ollama-origins-guide.jsx';

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

function clearModeFlags() {
    delete globalThis.__LERRET_HOSTED_MODE__;
    delete globalThis.__LERRET_CLI_MODE__;
}

beforeEach(() => {
    _resetSheetSingleton();
    aiMock.current = null;
    clearModeFlags();
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
});

afterEach(() => {
    _resetSheetSingleton();
    clearModeFlags();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ── Render ────────────────────────────────────────────────────────────────────

describe('SetupScreen — render', () => {
    it('renders four provider cards when open', async () => {
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={() => {}} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        for (const name of PROVIDER_NAMES) {
            const card = document.querySelector(`[data-provider="${name}"]`);
            expect(card, `card for ${name}`).not.toBeNull();
        }
        cleanup();
    });

    it('renders the NFR19 verbatim quality note', async () => {
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={() => {}} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        const note = document.querySelector('.lm-ai-setup__quality-note');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe(
            'Local Ollama models produce lower-fidelity .jsx than frontier cloud models. Choose with informed expectations — you can switch any time.',
        );
        cleanup();
    });

    it('does not render when open=false', () => {
        const { cleanup } = renderToDom(
            <SetupScreen open={false} onClose={() => {}} onCommit={() => {}} onSkip={() => {}} />,
        );
        const card = document.querySelector('[data-provider="openai"]');
        expect(card).toBeNull();
        cleanup();
    });
});

// ── Skip behavior ─────────────────────────────────────────────────────────────

describe('SetupScreen — Skip for now', () => {
    it('calls onSkip + onClose when the Skip button is clicked', async () => {
        const onSkip = vi.fn();
        const onClose = vi.fn();
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={onClose} onCommit={() => {}} onSkip={onSkip} />,
        );
        await act(async () => {
            await tick(30);
        });
        const skipBtn = document.querySelector('[data-testid="lm-ai-setup-skip"]');
        expect(skipBtn).not.toBeNull();
        await act(async () => {
            skipBtn.click();
            await tick(10);
        });
        expect(onSkip).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
        cleanup();
    });
});

// ── Cloud-without-key guard ───────────────────────────────────────────────────

describe('SetupScreen — cloud provider without API key', () => {
    it('does not open the disclosure (no commit) when no key is provided', async () => {
        const onCommit = vi.fn();
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={onCommit} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        // Click Select on the OpenAI card without entering a key.
        const selectBtn = document.querySelector('[data-testid="lm-ai-setup-select-openai"]');
        await act(async () => {
            selectBtn.click();
            await tick(20);
        });
        // Disclosure should NOT have opened.
        const disclosure = document.querySelector('.lm-ai-disclosure');
        expect(disclosure).toBeNull();
        expect(onCommit).not.toHaveBeenCalled();
        cleanup();
    });
});

// ── Keyless Ollama path ──────────────────────────────────────────────────────

describe('SetupScreen — Ollama (keyless)', () => {
    it('opens the inline privacy disclosure on Select even without a key', async () => {
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={() => {}} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        const selectBtn = document.querySelector('[data-testid="lm-ai-setup-select-ollama"]');
        await act(async () => {
            selectBtn.click();
            await tick(30);
        });
        // The Ollama disclosure renders inline.
        const disclosure = document.querySelector('.lm-ai-disclosure');
        expect(disclosure).not.toBeNull();
        const title = document.querySelector('.lm-ai-disclosure__title');
        expect(title.textContent).toBe('Ollama keeps everything on your machine');
        cleanup();
    });
});

// ── Story 8.10 — hosted-mode Ollama probe routing ────────────────────────────

/**
 * Install a fake @lerret/ai module whose OllamaProvider.probe() resolves the
 * scripted result(s). Returns the probe spy so tests can assert call counts
 * (or that the probe was NEVER called in CLI / non-hosted modes). No network.
 */
function installOllamaProbeMock(...results) {
    const probe = vi.fn();
    for (const r of results.slice(0, -1)) probe.mockResolvedValueOnce(r);
    probe.mockResolvedValue(results[results.length - 1]);
    class FakeOllamaProvider {
        configure() {}
        probe() {
            return probe();
        }
    }
    aiMock.current = { providers: { OllamaProvider: FakeOllamaProvider } };
    return probe;
}

async function mountAndSelectOllama(props = {}) {
    const handle = renderToDom(
        <SetupScreen open onClose={() => {}} onCommit={() => {}} onSkip={() => {}} {...props} />,
    );
    await act(async () => {
        await tick(30);
    });
    const selectBtn = document.querySelector('[data-testid="lm-ai-setup-select-ollama"]');
    await act(async () => {
        selectBtn.click();
        await tick(30);
    });
    return handle;
}

describe('SetupScreen — hosted-mode Ollama probe routing (Story 8.10)', () => {
    it("opens the OLLAMA_ORIGINS guide (not the disclosure) on a 'cors' probe in hosted mode", async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        const probe = installOllamaProbeMock({ ok: false, reason: 'cors', detail: 'Failed to fetch' });
        const { cleanup } = await mountAndSelectOllama();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).not.toBeNull();
        expect(document.querySelector('.lm-ai-disclosure')).toBeNull();
        cleanup();
    });

    it("proceeds to the existing Ollama disclosure on an 'ok' probe in hosted mode", async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        const probe = installOllamaProbeMock({ ok: true });
        const { cleanup } = await mountAndSelectOllama();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        const title = document.querySelector('.lm-ai-disclosure__title');
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('Ollama keeps everything on your machine');
        cleanup();
    });

    it("shows the contained card error + docs link (never the guide) on an 'unreachable' probe", async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        const probe = installOllamaProbeMock({ ok: false, reason: 'unreachable', detail: 'refused' });
        const { cleanup } = await mountAndSelectOllama();

        expect(probe).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        expect(document.querySelector('.lm-ai-disclosure')).toBeNull();
        const error = document.querySelector('[data-testid="lm-ai-setup-ollama-error"]');
        expect(error).not.toBeNull();
        const docs = error.querySelector('[data-testid="lm-ai-setup-ollama-error-docs"]');
        expect(docs.getAttribute('href')).toBe(OLLAMA_DOCS_URL);
        expect(docs.getAttribute('target')).toBe('_blank');
        expect(docs.getAttribute('rel')).toBe('noopener noreferrer');
        cleanup();
    });

    it('skips the probe entirely in non-hosted mode (no flags) — disclosure opens directly', async () => {
        const probe = installOllamaProbeMock({ ok: false, reason: 'cors' });
        const { cleanup } = await mountAndSelectOllama();

        // Exactly today's behavior: probe NOT called, no guide, disclosure up.
        expect(probe).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        expect(document.querySelector('.lm-ai-disclosure')).not.toBeNull();
        cleanup();
    });

    it('skips the probe in CLI mode even when the hosted flag is also set (guide never summons)', async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        globalThis.__LERRET_CLI_MODE__ = true;
        const probe = installOllamaProbeMock({ ok: false, reason: 'cors' });
        const { cleanup } = await mountAndSelectOllama();

        expect(probe).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        expect(document.querySelector('.lm-ai-disclosure')).not.toBeNull();
        cleanup();
    });

    it("retry-success resumes setup: guide Retry on a now-'ok' probe closes the guide and opens the disclosure", async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        // First probe (Select) → cors; second probe (Retry) → ok.
        const probe = installOllamaProbeMock(
            { ok: false, reason: 'cors', detail: 'Failed to fetch' },
            { ok: true },
        );
        const { cleanup } = await mountAndSelectOllama();
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).not.toBeNull();

        // Walk to Step 3 and retry.
        for (let i = 0; i < 2; i++) {
            const next = document.querySelector('[data-testid="lm-ollama-guide-next"]');
            await act(async () => {
                next.click();
                await tick(30);
            });
        }
        const retry = document.querySelector('[data-testid="lm-ollama-guide-retry"]');
        await act(async () => {
            retry.click();
            await tick(30);
        });

        expect(probe).toHaveBeenCalledTimes(2);
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        const title = document.querySelector('.lm-ai-disclosure__title');
        expect(title).not.toBeNull();
        expect(title.textContent).toBe('Ollama keeps everything on your machine');
        cleanup();
    });

    it('Use a different provider returns to the chooser with the Ollama card unselected', async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        installOllamaProbeMock({ ok: false, reason: 'cors' });
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={() => {}} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        // Select the Ollama card first so the de-select is observable.
        const card = document.querySelector('[data-provider="ollama"]');
        await act(async () => {
            card.click();
            await tick(10);
        });
        expect(card.getAttribute('data-selected')).toBe('true');
        const selectBtn = document.querySelector('[data-testid="lm-ai-setup-select-ollama"]');
        await act(async () => {
            selectBtn.click();
            await tick(30);
        });
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).not.toBeNull();

        const ghost = document.querySelector('[data-testid="lm-ollama-guide-different-provider"]');
        await act(async () => {
            ghost.click();
            await tick(30);
        });

        // Guide gone, sheet back, Ollama card de-selected.
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        const cardAfter = document.querySelector('[data-provider="ollama"]');
        expect(cardAfter).not.toBeNull();
        expect(cardAfter.getAttribute('data-selected')).toBe('false');
        cleanup();
    });

    it('Esc on the guide dismisses it AND closes the setup via the existing onClose contract', async () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        installOllamaProbeMock({ ok: false, reason: 'cors' });
        const onClose = vi.fn();
        const { cleanup } = await mountAndSelectOllama({ onClose });
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).not.toBeNull();

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await tick(30);
        });

        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        expect(onClose).toHaveBeenCalled();
        cleanup();
    });
});

// ── Cloud key + Select flow ──────────────────────────────────────────────────

describe('SetupScreen — cloud key + Select', () => {
    it('opens the disclosure when a cloud provider key has been entered', async () => {
        const onCommit = vi.fn();
        const { cleanup } = renderToDom(
            <SetupScreen open onClose={() => {}} onCommit={onCommit} onSkip={() => {}} />,
        );
        await act(async () => {
            await tick(30);
        });
        // Type into the OpenAI key field.
        const keyInput = document.querySelector('[data-testid="lm-ai-setup-key-openai"]');
        await act(async () => {
            setReactInputValue(keyInput, 'sk-test-key');
            await tick(10);
        });
        // Click Select.
        const selectBtn = document.querySelector('[data-testid="lm-ai-setup-select-openai"]');
        await act(async () => {
            selectBtn.click();
            await tick(30);
        });
        // Disclosure should now be visible (cloud variant).
        const disclosure = document.querySelector('.lm-ai-disclosure');
        expect(disclosure).not.toBeNull();
        const title = document.querySelector('.lm-ai-disclosure__title');
        expect(title.textContent).toContain('OpenAI');
        cleanup();
    });
});
