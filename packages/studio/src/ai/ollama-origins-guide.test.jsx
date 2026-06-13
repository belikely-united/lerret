// @vitest-environment jsdom
//
// Tests for the OLLAMA_ORIGINS guide overlay (UX-delta §4.6, Story 8.10).
//
// Coverage (AC-15):
//   - Step 1 renders the VERBATIM sentence + dialog a11y wiring + 1/3 indicator.
//   - Step 2 renders the verbatim intro, the exact command (the exported
//     OLLAMA_ORIGINS_COMMAND constant), and the verbatim restart note.
//   - Copy button calls navigator.clipboard.writeText with the exact command,
//     shows the `Copied` cue (aria-live polite), and clears it after 1500ms.
//   - Copy failure (no clipboard / rejected write) never throws and shows no cue.
//   - Retry: onRetry → 'ok' fires onSuccess (no inline note); onRetry → 'cors'
//     shows the inline note + docs link with exact href/target/rel.
//   - `Use a different provider` fires onUseDifferentProvider on every step.
//   - Esc fires onDismiss; Tab is contained inside the dialog (focus trap).
//
// The clipboard is mocked with vi.fn() — jsdom has no navigator.clipboard.
// onRetry is a plain vi.fn() resolving a scripted route; no network anywhere.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, afterEach, vi } from 'vitest';

// Mark this as a React act() environment so async post-mount state updates
// are flushed under act without the "not configured to support act" warning.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
    OllamaOriginsGuide,
    OLLAMA_ORIGINS_COMMAND,
    OLLAMA_DOCS_URL,
} from './ollama-origins-guide.jsx';

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

const noopHandlers = {
    onRetry: async () => 'unreachable',
    onSuccess: () => {},
    onUseDifferentProvider: () => {},
    onDismiss: () => {},
};

/**
 * Mount the guide and advance to the given step via the Next button. The
 * 30ms settles let the auto-focus requestAnimationFrame fire so later focus
 * assertions are deterministic (jsdom rAF ticks at ~16ms).
 */
async function mountAtStep(step, props = {}) {
    const handle = renderToDom(<OllamaOriginsGuide open {...noopHandlers} {...props} />);
    await act(async () => {
        await tick(30);
    });
    for (let i = 1; i < step; i++) {
        const next = document.querySelector('[data-testid="lm-ollama-guide-next"]');
        await act(async () => {
            next.click();
            await tick(30);
        });
    }
    return handle;
}

function stubClipboard(writeText) {
    const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
    });
    return () => {
        if (original) Object.defineProperty(globalThis.navigator, 'clipboard', original);
        else delete globalThis.navigator.clipboard;
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ── The frozen command constant (guardrail #5) ───────────────────────────────

describe('OLLAMA_ORIGINS_COMMAND', () => {
    it('is the exact AC-6 command string', () => {
        expect(OLLAMA_ORIGINS_COMMAND).toBe(
            'OLLAMA_ORIGINS="https://lerret.belikely.com" ollama serve',
        );
    });

    it('exposes the canonical docs URL (AC-14)', () => {
        expect(OLLAMA_DOCS_URL).toBe('https://lerret-docs.belikely.com/providers/ollama');
    });
});

// ── Portal escape (dock containing-block regression) ─────────────────────────

describe('OllamaOriginsGuide — portals to <body>', () => {
    it('renders its fixed backdrop as a direct child of <body>, not its mount container', async () => {
        // Same trap as privacy-disclosure: the guide is a sibling inside
        // SetupScreen, which mounts in the dock — whose `backdrop-filter` is a
        // containing block for `position: fixed`. Without a portal the backdrop
        // clips to the dock's bar. The fixed backdrop MUST live on <body>.
        const { container, cleanup } = renderToDom(
            <OllamaOriginsGuide open {...noopHandlers} />,
        );
        const backdrop = document.querySelector('.lm-ollama-guide-backdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop.parentElement).toBe(document.body);
        expect(container.contains(backdrop)).toBe(false);
        cleanup();
    });
});

// ── Step copy (verbatim) ─────────────────────────────────────────────────────

describe('OllamaOriginsGuide — steps + verbatim copy', () => {
    it('renders Step 1 with the verbatim sentence, dialog a11y wiring, and 1/3 indicator', async () => {
        const { cleanup } = await mountAtStep(1);
        const dialog = document.querySelector('[data-testid="lm-ollama-guide"]');
        expect(dialog).not.toBeNull();
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const titleId = dialog.getAttribute('aria-labelledby');
        expect(titleId).toBeTruthy();
        expect(document.getElementById(titleId)).not.toBeNull();

        const step1 = document.querySelector('[data-testid="lm-ollama-guide-step1"]');
        expect(step1.textContent).toBe(
            'Lerret found Ollama on your machine, but your browser is blocking the connection because this page is on https://.',
        );
        const indicator = document.querySelector('[data-testid="lm-ollama-guide-indicator"]');
        expect(indicator.textContent).toBe('1 / 3');
        cleanup();
    });

    it('renders Step 2 with the verbatim intro, the exact command, and the verbatim restart note', async () => {
        const { cleanup } = await mountAtStep(2);
        const intro = document.querySelector('[data-testid="lm-ollama-guide-step2-intro"]');
        expect(intro.textContent).toBe(
            "Run this in your terminal to allow Lerret's hosted page to talk to Ollama:",
        );
        const code = document.querySelector('[data-testid="lm-ollama-guide-command"]');
        expect(code.textContent).toBe(OLLAMA_ORIGINS_COMMAND);
        const note = document.querySelector('[data-testid="lm-ollama-guide-step2-note"]');
        expect(note.textContent).toBe(
            "If Ollama is already running, you'll need to restart it with that variable set.",
        );
        const indicator = document.querySelector('[data-testid="lm-ollama-guide-indicator"]');
        expect(indicator.textContent).toBe('2 / 3');
        cleanup();
    });

    it('renders Step 3 with the Retry connection primary and a Back button', async () => {
        const { cleanup } = await mountAtStep(3);
        const retry = document.querySelector('[data-testid="lm-ollama-guide-retry"]');
        expect(retry).not.toBeNull();
        expect(retry.textContent.trim()).toBe('Retry connection');
        expect(document.querySelector('[data-testid="lm-ollama-guide-back"]')).not.toBeNull();
        // No failure note until a retry has failed.
        expect(document.querySelector('[data-testid="lm-ollama-guide-retry-note"]')).toBeNull();
        const indicator = document.querySelector('[data-testid="lm-ollama-guide-indicator"]');
        expect(indicator.textContent).toBe('3 / 3');
        cleanup();
    });

    it('Back returns from Step 2 to Step 1', async () => {
        const { cleanup } = await mountAtStep(2);
        const back = document.querySelector('[data-testid="lm-ollama-guide-back"]');
        await act(async () => {
            back.click();
            await tick(5);
        });
        expect(document.querySelector('[data-testid="lm-ollama-guide-step1"]')).not.toBeNull();
        cleanup();
    });
});

// ── Copy affordance (AC-11/12/13) ────────────────────────────────────────────

describe('OllamaOriginsGuide — copy button', () => {
    it('copies the exact command and shows the Copied cue, which clears after 1500ms', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        const restore = stubClipboard(writeText);
        const { cleanup } = await mountAtStep(2);

        const copyBtn = document.querySelector('[data-testid="lm-ollama-guide-copy"]');
        expect(copyBtn.getAttribute('aria-label')).toBe('Copy command');
        await act(async () => {
            copyBtn.click();
            await tick(10);
        });

        expect(writeText).toHaveBeenCalledTimes(1);
        expect(writeText).toHaveBeenCalledWith(OLLAMA_ORIGINS_COMMAND);

        const cue = document.querySelector('[data-testid="lm-ollama-guide-copied"]');
        expect(cue.getAttribute('aria-live')).toBe('polite');
        expect(cue.textContent).toBe('Copied');

        // The cue clears after the 1500ms timer.
        await act(async () => {
            await tick(1600);
        });
        expect(cue.textContent).toBe('');
        cleanup();
        restore();
    });

    it('never throws when the clipboard write rejects, and shows no cue', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        const restore = stubClipboard(writeText);
        const { cleanup } = await mountAtStep(2);

        const copyBtn = document.querySelector('[data-testid="lm-ollama-guide-copy"]');
        await act(async () => {
            copyBtn.click();
            await tick(10);
        });

        expect(writeText).toHaveBeenCalledWith(OLLAMA_ORIGINS_COMMAND);
        const cue = document.querySelector('[data-testid="lm-ollama-guide-copied"]');
        expect(cue.textContent).toBe('');
        // The code block stays selectable for manual copy.
        expect(
            document.querySelector('[data-testid="lm-ollama-guide-command"]').textContent,
        ).toBe(OLLAMA_ORIGINS_COMMAND);
        cleanup();
        restore();
    });

    it('never throws when navigator.clipboard is entirely absent (jsdom default)', async () => {
        // No stub — jsdom's navigator has no clipboard property.
        const { cleanup } = await mountAtStep(2);
        const copyBtn = document.querySelector('[data-testid="lm-ollama-guide-copy"]');
        await act(async () => {
            copyBtn.click();
            await tick(10);
        });
        const cue = document.querySelector('[data-testid="lm-ollama-guide-copied"]');
        expect(cue.textContent).toBe('');
        cleanup();
    });
});

// ── Retry loop (AC-7) ────────────────────────────────────────────────────────

describe('OllamaOriginsGuide — Retry connection', () => {
    it("fires onSuccess when onRetry resolves 'ok' (and shows no failure note)", async () => {
        const onRetry = vi.fn().mockResolvedValue('ok');
        const onSuccess = vi.fn();
        const { cleanup } = await mountAtStep(3, { onRetry, onSuccess });

        const retry = document.querySelector('[data-testid="lm-ollama-guide-retry"]');
        await act(async () => {
            retry.click();
            await tick(10);
        });

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="lm-ollama-guide-retry-note"]')).toBeNull();
        cleanup();
    });

    it("shows the inline note + docs link when onRetry resolves 'cors' (still blocked)", async () => {
        const onRetry = vi.fn().mockResolvedValue('cors');
        const onSuccess = vi.fn();
        const { cleanup } = await mountAtStep(3, { onRetry, onSuccess });

        const retry = document.querySelector('[data-testid="lm-ollama-guide-retry"]');
        await act(async () => {
            retry.click();
            await tick(10);
        });

        expect(onSuccess).not.toHaveBeenCalled();
        const note = document.querySelector('[data-testid="lm-ollama-guide-retry-note"]');
        expect(note).not.toBeNull();
        const link = note.querySelector('[data-testid="lm-ollama-guide-docs-link"]');
        expect(link.getAttribute('href')).toBe('https://lerret-docs.belikely.com/providers/ollama');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        cleanup();
    });

    it('fails safe to the inline note when onRetry throws', async () => {
        const onRetry = vi.fn().mockRejectedValue(new Error('boom'));
        const onSuccess = vi.fn();
        const { cleanup } = await mountAtStep(3, { onRetry, onSuccess });

        const retry = document.querySelector('[data-testid="lm-ollama-guide-retry"]');
        await act(async () => {
            retry.click();
            await tick(10);
        });

        expect(onSuccess).not.toHaveBeenCalled();
        expect(document.querySelector('[data-testid="lm-ollama-guide-retry-note"]')).not.toBeNull();
        cleanup();
    });
});

// ── Bypass + exit paths (AC-8/9) ─────────────────────────────────────────────

describe('OllamaOriginsGuide — bypass and exit', () => {
    it('shows the ghost Use a different provider button on every step and fires the callback', async () => {
        const onUseDifferentProvider = vi.fn();
        const { cleanup } = await mountAtStep(1, { onUseDifferentProvider });

        for (let step = 1; step <= 3; step++) {
            const ghost = document.querySelector(
                '[data-testid="lm-ollama-guide-different-provider"]',
            );
            expect(ghost, `ghost button on step ${step}`).not.toBeNull();
            expect(ghost.textContent.trim()).toBe('Use a different provider');
            if (step < 3) {
                const next = document.querySelector('[data-testid="lm-ollama-guide-next"]');
                await act(async () => {
                    next.click();
                    await tick(5);
                });
            }
        }
        const ghost = document.querySelector('[data-testid="lm-ollama-guide-different-provider"]');
        await act(async () => {
            ghost.click();
            await tick(5);
        });
        expect(onUseDifferentProvider).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('fires onDismiss when Esc is pressed at any step', async () => {
        const onDismiss = vi.fn();
        const { cleanup } = await mountAtStep(2, { onDismiss });
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await tick(5);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('contains Tab focus inside the dialog (focus trap)', async () => {
        const { cleanup } = await mountAtStep(1);
        const dialog = document.querySelector('[data-testid="lm-ollama-guide"]');
        const focusables = dialog.querySelectorAll('button, [href]');
        const last = focusables[focusables.length - 1];
        last.focus();
        expect(document.activeElement).toBe(last);
        // Tab from the last focusable cycles to the first.
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
            await tick(5);
        });
        expect(document.activeElement).toBe(focusables[0]);
        // Shift+Tab from the first cycles back to the last.
        await act(async () => {
            document.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
            );
            await tick(5);
        });
        expect(document.activeElement).toBe(last);
        cleanup();
    });

    it('does not render when open=false', () => {
        const { cleanup } = renderToDom(<OllamaOriginsGuide open={false} {...noopHandlers} />);
        expect(document.querySelector('[data-testid="lm-ollama-guide"]')).toBeNull();
        cleanup();
    });
});
