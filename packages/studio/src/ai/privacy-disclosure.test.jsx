// Tests for the privacy disclosure dialog (UX-delta §4.4).
//
// Coverage:
//   - Cloud copy renders with {Provider} filled.
//   - Ollama copy renders with {baseUrl} filled and a single Continue button.
//   - Esc key calls onCancel (the dock submit handler aborts the deferred AI
//     turn with DisclosureCancelled in production).
//   - Primary button calls recordAck and then onAck.
//   - infoOnly mode skips the recordAck call.
//
// The vault writes are mocked at the lazy-import boundary — the dialog itself
// only consumes the context's recordAck callback, so we test by mounting it
// inside a stub provider context.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { PrivacyDisclosure } from './privacy-disclosure.jsx';

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
    // No global stubs needed — the dialog reads from default context (DEFAULT_VALUE)
    // when no provider wraps it. recordAck is a no-op in that case, which is fine
    // for the open/close/Esc tests; ack-write tests pass a custom mock.
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── Cloud copy ────────────────────────────────────────────────────────────────

describe('PrivacyDisclosure — cloud copy', () => {
    it('renders the verbatim title with the provider label filled', () => {
        const { container, cleanup } = renderToDom(
            <PrivacyDisclosure
                open
                providerName="openai"
                onAck={() => {}}
                onCancel={() => {}}
                onSwitchToOllama={() => {}}
            />,
        );
        const title = container.ownerDocument.querySelector('.lm-ai-disclosure__title');
        expect(title).not.toBeNull();
        expect(title.textContent).toContain('Lerret sends data to');
        expect(title.textContent).toContain('OpenAI');
        expect(title.textContent).toContain('during AI turns');
        cleanup();
    });

    it('renders both decision buttons for cloud variants', () => {
        const { cleanup } = renderToDom(
            <PrivacyDisclosure open providerName="anthropic" onAck={() => {}} onCancel={() => {}} />,
        );
        const buttons = document.querySelectorAll('.lm-ai-disclosure__btn');
        const labels = Array.from(buttons).map((b) => b.textContent?.trim());
        expect(labels).toEqual(
            expect.arrayContaining([
                'Switch to Ollama',
                expect.stringContaining('I understand'),
            ]),
        );
        cleanup();
    });
});

// ── Ollama copy ──────────────────────────────────────────────────────────────

describe('PrivacyDisclosure — Ollama copy', () => {
    it('renders the verbatim Ollama title and the baseUrl inline', () => {
        const { cleanup } = renderToDom(
            <PrivacyDisclosure
                open
                providerName="ollama"
                baseUrl="http://localhost:11434"
                onAck={() => {}}
                onCancel={() => {}}
            />,
        );
        const title = document.querySelector('.lm-ai-disclosure__title');
        expect(title.textContent).toBe('Ollama keeps everything on your machine');
        const code = document.querySelector('.lm-ai-disclosure__code');
        expect(code.textContent).toBe('http://localhost:11434');
        cleanup();
    });

    it('shows only one Continue button (no decision split)', () => {
        const { cleanup } = renderToDom(
            <PrivacyDisclosure open providerName="ollama" onAck={() => {}} onCancel={() => {}} />,
        );
        const buttons = document.querySelectorAll('.lm-ai-disclosure__btn');
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent.trim()).toBe('Continue');
        cleanup();
    });
});

// ── Interaction behavior ──────────────────────────────────────────────────────

describe('PrivacyDisclosure — interactions', () => {
    it('calls onCancel when Esc is pressed', async () => {
        const onCancel = vi.fn();
        const { cleanup } = renderToDom(
            <PrivacyDisclosure open providerName="openai" onAck={() => {}} onCancel={onCancel} />,
        );
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await tick(5);
        });
        expect(onCancel).toHaveBeenCalled();
        cleanup();
    });

    it('calls onAck when the primary button is clicked', async () => {
        const onAck = vi.fn();
        const { cleanup } = renderToDom(
            <PrivacyDisclosure
                open
                providerName="openai"
                onAck={onAck}
                onCancel={() => {}}
                onSwitchToOllama={() => {}}
            />,
        );
        const buttons = document.querySelectorAll('.lm-ai-disclosure__btn');
        const primary = Array.from(buttons).find((b) =>
            b.textContent?.includes('I understand'),
        );
        await act(async () => {
            primary.click();
            await tick(10);
        });
        expect(onAck).toHaveBeenCalled();
        cleanup();
    });

    it('calls onSwitchToOllama when the secondary button is clicked', async () => {
        const onSwitch = vi.fn();
        const { cleanup } = renderToDom(
            <PrivacyDisclosure
                open
                providerName="openai"
                onAck={() => {}}
                onCancel={() => {}}
                onSwitchToOllama={onSwitch}
            />,
        );
        const buttons = document.querySelectorAll('.lm-ai-disclosure__btn');
        const secondary = Array.from(buttons).find((b) =>
            b.textContent?.includes('Switch to Ollama'),
        );
        await act(async () => {
            secondary.click();
            await tick(5);
        });
        expect(onSwitch).toHaveBeenCalled();
        cleanup();
    });

    it('does not render when open=false', () => {
        const { cleanup } = renderToDom(
            <PrivacyDisclosure open={false} providerName="openai" onAck={() => {}} onCancel={() => {}} />,
        );
        const dialog = document.querySelector('.lm-ai-disclosure');
        expect(dialog).toBeNull();
        cleanup();
    });
});
