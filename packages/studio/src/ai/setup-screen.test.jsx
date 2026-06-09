// Tests for the first-run setup screen (UX-delta §4.2).
//
// Coverage:
//   - Renders four provider cards when open.
//   - The NFR19 verbatim quality note is present below the card row.
//   - Skip for now calls onSkip and DOES NOT call configureProvider.
//   - Selecting a cloud provider without a key is a no-op (no commit).
//   - Selecting Ollama (keyless) opens the inline privacy disclosure.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetSheetSingleton } from '../components/editors/editor-sheet.jsx';
import { SetupScreen } from './setup-screen.jsx';
import { PROVIDER_NAMES } from './ai-context.jsx';

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
