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

import { _resetSheetSingleton } from '../components/editors/editor-sheet.jsx';
import { SettingsPanel } from './settings-panel.jsx';
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
