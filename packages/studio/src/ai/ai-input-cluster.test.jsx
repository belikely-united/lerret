// Tests for the dock AI input cluster (Story 8.2). jsdom.
//
// Every test drives off a MOCKED getAi() (vi.mock('./lazy.js')) whose runTurn
// is an inline async generator yielding scripted TurnEvents, and whose vault.*
// methods are stubbed. The real orchestrator is never called — the mock keeps
// the suite fast + deterministic (story testing guidance).
//
// Coverage map (AC → test):
//   AC-2  resting render (placeholder + idle pill)
//   AC-3/4 selection chip render + clear (× click, Delete, Backspace) + persists
//   AC-5  submit → running (input disabled, stop button BESIDE the live pill)
//   AC-6/7 pill transitions thinking→reading→writing→done, asserted live at
//          every step (the pill stays mounted while a turn runs)
//   AC-8  stopped + error pill paths (+ the error {class, message} payload
//          rendered in the errored turn's thread card)
//   AC-7/8 4s quick-revert appears + expires (+ carries the turnId through)
//   AC-9/10 thread expand/collapse (chevron re-click + Esc) + reverse-chron
//          cards + secondary actions + NO raw transcript (files-derived only)
//   AC-11/12 AI-absent idle-only fallback + sibling dock children still work
//   AC-13 first-run setup gating (no providers → setup opens, turn suspended)
//   AC-14 cloud-disclosure gating (unacked → disclosure opens; Esc aborts;
//          Switch to Ollama resumes against Ollama or opens setup)
//   AC-15 tab order: input first in the DOM, chip × second (visual order via CSS)
//   AC-16 Esc cancels a running turn (transient Stopping…, one action per
//          keypress — an open thread stays open); reduced-motion fallback
//   NFR18 stopped summary derives from writes observed during the run

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mark this as a React act() environment so async post-mount state updates (the
// getAi() presence probe) are flushed under act without the "not configured to
// support act(...)" warning.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── getAi() mock ───────────────────────────────────────────────────────────────
// A module-level handle the tests reconfigure per-spec before rendering.
const aiMock = {
    current: /** @type {object | null} */ (null),
};
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import { _resetSheetSingleton } from '../components/editors/editor-sheet.jsx';
import {
    AiInputCluster,
    summarizeOutcome,
    resolveChipLabel,
    deriveProjectRoot,
    _setBabelParserLoader,
} from './ai-input-cluster.jsx';
import { AiContextProvider } from './ai-context.jsx';
import {
    SelectionScopeProvider,
    useSelectionScope,
    fileScope,
} from './selection-scope-context.jsx';

// ── Test infra ─────────────────────────────────────────────────────────────────

function renderToDom(element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(element));
    return {
        container,
        rerender(el) { act(() => root.render(el)); },
        cleanup() { act(() => root.unmount()); container.remove(); },
    };
}

async function tick(ms = 10) {
    await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
    });
}

function setReactInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A deferred so a scripted runTurn can pause mid-stream until the test resumes. */
function deferred() {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    return { promise, resolve };
}

/**
 * Stage one PNG attachment through the attach button's hidden file input —
 * the real staging path (change event → async base64 encode → onAttach →
 * pendingAttachments). jsdom's File may lack arrayBuffer; stub it with the
 * known bytes when absent.
 */
async function stageImageAttachment(container, name = 'shot.png') {
    const bytes = new Uint8Array([137, 80, 78, 71]); // PNG magic
    const file = new File([bytes], name, { type: 'image/png' });
    if (typeof file.arrayBuffer !== 'function') {
        Object.defineProperty(file, 'arrayBuffer', {
            value: async () => bytes.buffer.slice(0),
        });
    }
    const picker = container.querySelector('[data-testid="vision-attach-input"]');
    Object.defineProperty(picker, 'files', { value: [file], configurable: true });
    await act(async () => {
        picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await tick(10); // the encode → onAttach is async
}

/** Build a fake @lerret/ai module with a scripted runTurn + stubbed vault. */
function makeAi({ events = [], vault = {}, runTurnImpl } = {}) {
    return {
        runTurn:
            runTurnImpl ||
            (async function* () {
                for (const ev of events) yield ev;
            }),
        vault: {
            listProviderConfigs: async () => [{ providerName: 'anthropic', active: true }],
            isDisclosureAcked: async () => true,
            ...vault,
        },
    };
}

function reducedMotionStub(matches) {
    return vi.fn().mockImplementation((q) => ({
        matches: matches && String(q).includes('reduce'),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
    }));
}

beforeEach(() => {
    _resetSheetSingleton();
    aiMock.current = makeAi();
    vi.stubGlobal('matchMedia', reducedMotionStub(false));
    // Wide window → full placeholder by default.
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true, writable: true });
});

afterEach(() => {
    _resetSheetSingleton();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// A small wrapper that mounts the cluster under the selection-scope provider and
// (optionally) lets a test drive the scope. `onScopeReady` receives the scope
// context so a test can set a selection programmatically.
function Harness({ onScopeReady, onOpenRevertTimeline, folderId = 'folder:test:abc' }) {
    return (
        <AiContextProvider folderId={folderId}>
            <SelectionScopeProvider>
                <ScopeBridge onScopeReady={onScopeReady} />
                <AiInputCluster onOpenRevertTimeline={onOpenRevertTimeline} />
            </SelectionScopeProvider>
        </AiContextProvider>
    );
}
function ScopeBridge({ onScopeReady }) {
    const ctx = useSelectionScope();
    React.useEffect(() => { onScopeReady && onScopeReady(ctx); }, [ctx, onScopeReady]);
    return null;
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

describe('summarizeOutcome (FR57 — derived from files only)', () => {
    it('summarizes a single edit / create / delete by basename', () => {
        expect(summarizeOutcome([{ op: 'edit', path: 'a/twitter-card.jsx' }], 'done'))
            .toBe('Edited twitter-card.jsx');
        expect(summarizeOutcome([{ op: 'create', path: '_brand/logo.svg' }], 'done'))
            .toBe('Created logo.svg');
        expect(summarizeOutcome([{ op: 'delete', path: 'x/old.jsx' }], 'done'))
            .toBe('Deleted old.jsx');
    });

    it('collapses multiple files of one op to a count', () => {
        const files = [
            { op: 'edit', path: 'a.jsx' },
            { op: 'edit', path: 'b.jsx' },
            { op: 'create', path: 'c.jsx' },
        ];
        expect(summarizeOutcome(files, 'done')).toBe('Created c.jsx · Edited 2 files');
    });

    it('handles empty / stopped / error without inventing transcript text', () => {
        expect(summarizeOutcome([], 'done')).toBe('No files changed.');
        expect(summarizeOutcome([], 'stopped')).toBe('Stopped — no files changed.');
        expect(summarizeOutcome([{ op: 'edit', path: 'x.jsx' }], 'error'))
            .toBe('The turn ended with an error.');
    });

    it('summarizes a stopped turn from the writes observed during the run (NFR18)', () => {
        // An in-flight write may have completed before the stop took effect —
        // the summary must reflect it, never claim "nothing changed".
        expect(summarizeOutcome([{ op: 'edit', path: 'pages/a/card.jsx' }], 'stopped'))
            .toBe('Stopped after writing card.jsx');
        expect(
            summarizeOutcome(
                [
                    { op: 'edit', path: 'a.jsx' },
                    { op: 'delete', path: 'b.jsx' },
                ],
                'stopped',
            ),
        ).toBe('Stopped after writing 2 files');
    });
});

describe('resolveChipLabel (best-effort @babel/parser; basename fallback)', () => {
    it('falls back to the file basename when no source is supplied', async () => {
        expect(await resolveChipLabel('pages/x/card.jsx')).toBe('card.jsx');
    });
    it('falls back to the basename on malformed JSX', async () => {
        expect(await resolveChipLabel('pages/x/card.jsx', 'export default function (')).toBe('card.jsx');
    });
    it('resolves the exported component name through the parser branch', async () => {
        // @babel/parser is NOT installed in this workspace, so the success
        // path is exercised through the test seam: a minimal parser double
        // whose parse() returns the AST shape the branch walks. Deleting the
        // component-name branch makes this return the basename and fail.
        _setBabelParserLoader(async () => ({
            parse: () => ({
                program: {
                    body: [
                        {
                            type: 'ExportDefaultDeclaration',
                            declaration: { type: 'FunctionDeclaration', id: { name: 'TwitterCard' } },
                        },
                    ],
                },
            }),
        }));
        try {
            expect(
                await resolveChipLabel('pages/x/card.jsx', 'export default function TwitterCard() {}'),
            ).toBe('TwitterCard');
        } finally {
            _setBabelParserLoader(null);
        }
    });
    it('resolves a named-export component declaration name', async () => {
        _setBabelParserLoader(async () => ({
            parse: () => ({
                program: {
                    body: [
                        {
                            type: 'ExportNamedDeclaration',
                            declaration: {
                                type: 'VariableDeclaration',
                                declarations: [{ id: { name: 'HeroBanner' } }],
                            },
                        },
                    ],
                },
            }),
        }));
        try {
            expect(
                await resolveChipLabel('pages/x/hero.jsx', 'export const HeroBanner = () => null;'),
            ).toBe('HeroBanner');
        } finally {
            _setBabelParserLoader(null);
        }
    });
});

// ── AC-2: resting state ─────────────────────────────────────────────────────────

describe('AiInputCluster — resting state (AC-2)', () => {
    it('renders the full placeholder + an idle status pill', async () => {
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        expect(input).not.toBeNull();
        expect(input.placeholder).toBe('Ask Lerret to design or edit…');
        expect(input.disabled).toBe(false);
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill).not.toBeNull();
        expect(pill.getAttribute('data-status')).toBe('idle');
        cleanup();
    });

    it('truncates the placeholder to "Ask Lerret…" on a narrow window', async () => {
        Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true, writable: true });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        expect(input.placeholder).toBe('Ask Lerret…');
        cleanup();
    });
});

// ── AC-3 / AC-4: selection chip ──────────────────────────────────────────────────

describe('AiInputCluster — selection chip (AC-3, AC-4)', () => {
    it('renders the chip with the file basename when a file scope is set', async () => {
        let scopeCtx;
        const { container, cleanup } = renderToDom(
            <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
        );
        await tick();
        act(() => scopeCtx.setScope(fileScope('pages/social/twitter-card.jsx')));
        const chip = container.querySelector('[data-testid="ai-selection-chip"]');
        expect(chip).not.toBeNull();
        expect(chip.textContent).toContain('twitter-card.jsx');
        cleanup();
    });

    it('clears the scope when the chip × is clicked', async () => {
        let scopeCtx;
        const { container, cleanup } = renderToDom(
            <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
        );
        await tick();
        act(() => scopeCtx.setScope(fileScope('a/card.jsx')));
        expect(container.querySelector('[data-testid="ai-selection-chip"]')).not.toBeNull();
        const x = container.querySelector('[data-testid="ai-selection-chip-clear"]');
        await act(async () => { x.click(); });
        expect(container.querySelector('[data-testid="ai-selection-chip"]')).toBeNull();
        expect(scopeCtx.scope).toBeNull();
        cleanup();
    });

    it('clears the scope on Delete / Backspace while the chip × is focused', async () => {
        for (const key of ['Delete', 'Backspace']) {
            let scopeCtx;
            const { container, cleanup } = renderToDom(
                <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
            );
            await tick();
            act(() => scopeCtx.setScope(fileScope('a/card.jsx')));
            const x = container.querySelector('[data-testid="ai-selection-chip-clear"]');
            await act(async () => {
                x.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            });
            expect(scopeCtx.scope, `key=${key}`).toBeNull();
            cleanup();
        }
    });

    it('places the chip AFTER the input in the DOM (AC-15 tab order: input → chip ×)', async () => {
        let scopeCtx;
        const { container, cleanup } = renderToDom(
            <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
        );
        await tick();
        act(() => scopeCtx.setScope(fileScope('a/card.jsx')));
        const input = container.querySelector('[data-testid="ai-input"]');
        const chipX = container.querySelector('[data-testid="ai-selection-chip-clear"]');
        // Tab order follows DOM order: the chip × must FOLLOW the input.
        expect(input.compareDocumentPosition(chipX) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        // The chip still sits at the visual left edge via the stylesheet's
        // flex `order: -1` on .lm-ai-cluster__chip.
        const styles = document.getElementById('ai-input-cluster-styles')?.textContent ?? '';
        const chipRule = styles.split('.lm-ai-cluster__chip {')[1]?.split('}')[0] ?? '';
        expect(chipRule).toContain('order: -1');
        cleanup();
    });

    it('keeps the chip across a completed turn (scope persists, AC-4)', async () => {
        let scopeCtx;
        aiMock.current = makeAi({
            events: [{ type: 'thinking' }, { type: 'done', files: [{ op: 'edit', path: 'a/card.jsx' }] }],
        });
        const { container, cleanup } = renderToDom(
            <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
        );
        await tick();
        act(() => scopeCtx.setScope(fileScope('a/card.jsx')));
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'tweak it');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // The turn finished; the chip must still be present.
        expect(container.querySelector('[data-testid="ai-selection-chip"]')).not.toBeNull();
        expect(scopeCtx.scope).not.toBeNull();
        cleanup();
    });
});

// ── AC-5 / AC-6 / AC-7: submit → running → pill transitions ──────────────────────

describe('AiInputCluster — submit + pill transitions (AC-5, AC-6, AC-7)', () => {
    it('disables the input and shows the stop button BESIDE the live pill while running', async () => {
        const gate = deferred();
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                yield { type: 'thinking' };
                await gate.promise; // hold the turn open
                yield { type: 'done', files: [] };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'make a card');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        // Running: input disabled, stop button present, pill STILL mounted and
        // showing the in-flight label (spec §4.1 [ status pill | stop button ];
        // a permanently-mounted pill keeps the aria-live announcements firing).
        expect(container.querySelector('[data-testid="ai-input"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="ai-stop"]')).not.toBeNull();
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill).not.toBeNull();
        expect(pill.getAttribute('data-status')).toBe('thinking');
        expect(pill.textContent).toBe('Thinking…');
        await act(async () => { gate.resolve(); });
        await tick(40);
        // Terminal: the stop button leaves; the pill stays.
        expect(container.querySelector('[data-testid="ai-stop"]')).toBeNull();
        expect(container.querySelector('[data-testid="ai-status-pill"]')).not.toBeNull();
        cleanup();
    });

    it('cycles the pill thinking → reading → writing → done (moss), asserted at every step', async () => {
        // Deferred-paced generator: the test resumes the stream step by step
        // and asserts the visible pill TEXT after every yield — pinning that
        // the in-flight labels actually render while the turn runs (AC-6).
        const steps = [deferred(), deferred(), deferred()];
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                yield { type: 'thinking' };
                await steps[0].promise;
                yield { type: 'reading', file: 'a.jsx' };
                await steps[1].promise;
                yield { type: 'writing', file: 'a.jsx' };
                await steps[2].promise;
                yield { type: 'done', files: [{ op: 'edit', path: 'a/twitter-card.jsx' }] };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'edit it');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        const pill = () => container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill().getAttribute('data-status')).toBe('thinking');
        expect(pill().textContent).toBe('Thinking…');
        await act(async () => { steps[0].resolve(); });
        await tick(20);
        expect(pill().getAttribute('data-status')).toBe('reading');
        expect(pill().textContent).toBe('Reading…');
        await act(async () => { steps[1].resolve(); });
        await tick(20);
        expect(pill().getAttribute('data-status')).toBe('writing');
        expect(pill().textContent).toBe('Writing files…');
        await act(async () => { steps[2].resolve(); });
        await tick(40);
        expect(pill().getAttribute('data-status')).toBe('done');
        expect(pill().textContent).toBe('Done');
        cleanup();
    });

    it('shows the 4s quick-revert button on done then expires it', async () => {
        vi.useFakeTimers();
        try {
            aiMock.current = makeAi({
                events: [
                    { type: 'thinking' },
                    { type: 'done', files: [{ op: 'edit', path: 'a.jsx' }], turnId: 'turn-q1' },
                ],
            });
            const onOpenRevertTimeline = vi.fn();
            const { container, cleanup } = renderToDom(
                <Harness onOpenRevertTimeline={onOpenRevertTimeline} />,
            );
            await act(async () => { await vi.advanceTimersByTimeAsync(5); });
            const input = container.querySelector('[data-testid="ai-input"]');
            await act(async () => {
                setReactInputValue(input, 'go');
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            });
            await act(async () => { await vi.advanceTimersByTimeAsync(10); });
            // Revert button present within the 4s window.
            const revert = container.querySelector('[data-testid="ai-quick-revert"]');
            expect(revert).not.toBeNull();
            await act(async () => { revert.click(); });
            // The done event's turnId travels through the record to the
            // revert-timeline opener (Story 8.5 wiring).
            expect(onOpenRevertTimeline).toHaveBeenCalledWith('turn-q1');
            // After 4s it disappears.
            await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
            expect(container.querySelector('[data-testid="ai-quick-revert"]')).toBeNull();
            cleanup();
        } finally {
            vi.useRealTimers();
        }
    });

    it('gates the quick-revert off when no revert-timeline panel is wired', async () => {
        aiMock.current = makeAi({
            events: [{ type: 'thinking' }, { type: 'done', files: [{ op: 'edit', path: 'a.jsx' }] }],
        });
        // No onOpenRevertTimeline prop → revert unavailable.
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        expect(container.querySelector('[data-testid="ai-quick-revert"]')).toBeNull();
        cleanup();
    });
});

// ── AC-8: stopped + error paths ──────────────────────────────────────────────────

describe('AiInputCluster — stopped + error (AC-8)', () => {
    it('shows the Stopped pill and derives the stopped summary from observed writes (NFR18)', async () => {
        aiMock.current = makeAi({
            events: [{ type: 'thinking' }, { type: 'writing', file: 'a.jsx' }, { type: 'stopped' }],
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-status')).toBe('stopped');
        expect(pill.textContent).toBe('Stopped');
        // The stopped event carries no files, but the run wrote a.jsx before
        // stopping — the thread summary must say so, not "no files changed".
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread-outcome"]').textContent)
            .toBe('Stopped after writing a.jsx');
        cleanup();
    });

    it('accumulates + de-dupes observed writes for a stopped turn and lands its turnId on the record', async () => {
        const onOpenRevertTimeline = vi.fn();
        aiMock.current = makeAi({
            events: [
                { type: 'thinking' },
                { type: 'writing', file: 'a.jsx' },
                { type: 'writing', file: 'a.jsx' }, // duplicate path → one entry
                { type: 'deleting', file: 'c.jsx' },
                { type: 'stopped', turnId: 'turn-s1' },
            ],
        });
        const { container, cleanup } = renderToDom(
            <Harness onOpenRevertTimeline={onOpenRevertTimeline} />,
        );
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread-outcome"]').textContent)
            .toBe('Stopped after writing 2 files');
        // The stopped event's turnId travels through the thread record to the
        // revert-timeline opener.
        const revertBtn = Array.from(document.querySelectorAll('.lm-ai-thread__action'))
            .find((b) => b.textContent === 'Revert this turn');
        await act(async () => { revertBtn.click(); });
        expect(onOpenRevertTimeline).toHaveBeenCalledWith('turn-s1');
        cleanup();
    });

    it('shows "Error — see thread", renders the error payload in the thread card, never alerts', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        aiMock.current = makeAi({
            events: [
                { type: 'thinking' },
                { type: 'error', error: { class: 'RateLimited', message: 'rate limited' } },
            ],
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-status')).toBe('error');
        expect(pill.textContent).toBe('Error — see thread');
        expect(alertSpy).not.toHaveBeenCalled();
        // "see thread" must lead somewhere: the errored turn's card carries
        // the factual {class}: {message} one-liner, not an empty card.
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread-outcome"]').textContent)
            .toBe('RateLimited: rate limited');
        cleanup();
    });

    it('maps an unexpected throw in the iterable to the error pill', async () => {
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                yield { type: 'thinking' };
                throw new Error('producer blew up');
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-status')).toBe('error');
        cleanup();
    });
});

// ── AC-16: Esc cancels a running turn; transient "Stopping…" ────────────────────

describe('AiInputCluster — Esc cancels a running turn (AC-16)', () => {
    it('aborts the controller and shows the transient Stopping… label on Esc', async () => {
        let aborted = false;
        // The generator holds AFTER the abort (the orchestrator finishes the
        // in-flight write per NFR18) until the test releases it — so the
        // transient "Stopping…" label is observable between Esc and the
        // stopped event.
        const release = deferred();
        aiMock.current = makeAi({
            runTurnImpl: async function* ({ signal }) {
                signal.addEventListener('abort', () => { aborted = true; });
                yield { type: 'thinking' };
                yield { type: 'writing', file: 'a.jsx' };
                // Hold until aborted…
                await new Promise((r) => {
                    if (signal.aborted) return r();
                    signal.addEventListener('abort', () => r());
                });
                // …then hold again until the test has asserted Stopping….
                await release.promise;
                yield { type: 'stopped' };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        // Global Esc while running → abort + transient Stopping… BEFORE the
        // stopped event arrives.
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(10);
        expect(aborted).toBe(true);
        let pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-status')).toBe('stopping');
        expect(pill.textContent).toBe('Stopping…');
        // Release the held write → the stopped event lands.
        await act(async () => { release.resolve(); });
        await tick(40);
        pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-status')).toBe('stopped');
        cleanup();
    });

    it('registers the global Esc-cancel only while a turn runs (none while idle)', async () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        const keydownAdds = () => addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
        const keydownRemoves = () =>
            removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;
        const gate = deferred();
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                yield { type: 'thinking' };
                await gate.promise;
                yield { type: 'done', files: [] };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        // Idle: the cluster has NOT registered any window keydown listener…
        expect(keydownAdds()).toBe(0);
        // …and Esc is a no-op (nothing to cancel; the pill stays idle).
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick();
        expect(container.querySelector('[data-testid="ai-status-pill"]').getAttribute('data-status'))
            .toBe('idle');
        // Submit → running: the capture-phase Esc-cancel listener registers.
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        expect(keydownAdds()).toBe(1);
        // Turn ends → the listener is released again.
        await act(async () => { gate.resolve(); });
        await tick(40);
        expect(keydownRemoves()).toBe(1);
        cleanup();
    });

    it('Esc while a turn runs cancels the turn ONLY — an open thread stays open', async () => {
        // One action per keypress: the running-turn cancel takes the keypress;
        // the EditorSheet's Esc-collapse must NOT also fire. Reduced motion
        // makes any (wrongful) sheet close instant — so this would fail loudly.
        vi.stubGlobal('matchMedia', reducedMotionStub(true));
        let aborted = false;
        aiMock.current = makeAi({
            runTurnImpl: async function* ({ signal }) {
                signal.addEventListener('abort', () => { aborted = true; });
                yield { type: 'thinking' };
                yield { type: 'writing', file: 'a.jsx' };
                await new Promise((r) => {
                    if (signal.aborted) return r();
                    signal.addEventListener('abort', () => r());
                });
                yield { type: 'stopped' };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        // Open the thread while the turn runs.
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread"]')).not.toBeNull();
        // Esc (dispatched on document — the sheet's own listener target):
        // cancels the turn; the thread DOES NOT collapse on the same keypress.
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(40);
        expect(aborted).toBe(true);
        expect(document.querySelector('[data-testid="ai-thread"]')).not.toBeNull();
        // With no turn running anymore, the NEXT Esc collapses the thread.
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(20);
        expect(document.querySelector('[data-testid="ai-thread"]')).toBeNull();
        cleanup();
    });
});

// ── AC-9 / AC-10: thread overlay ─────────────────────────────────────────────────

describe('AiInputCluster — thread overlay (AC-9, AC-10)', () => {
    it('expands the thread on the chevron and collapses it on chevron re-click and Esc', async () => {
        // Reduced motion → the EditorSheet's Esc-dismiss is instant (no exit
        // animation), so the collapse is observable synchronously in jsdom.
        vi.stubGlobal('matchMedia', reducedMotionStub(true));
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        expect(chevron.getAttribute('aria-expanded')).toBe('false');
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread"]')).not.toBeNull();
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        // Chevron re-click collapses: the overlay unmounts.
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread"]')).toBeNull();
        expect(chevron.getAttribute('aria-expanded')).toBe('false');
        // Esc (no turn running) also collapses, via the EditorSheet.
        await act(async () => { chevron.click(); });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread"]')).not.toBeNull();
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(20);
        expect(document.querySelector('[data-testid="ai-thread"]')).toBeNull();
        cleanup();
    });

    it('renders cards in reverse-chronological order with files-derived outcomes and secondary actions; never a raw transcript', async () => {
        // Two turns: first edits a.jsx, second creates b.jsx. Newest (b) first.
        const scripts = [
            [
                { type: 'thinking' },
                { type: 'done', files: [{ op: 'edit', path: 'pages/a.jsx' }], turnId: 'turn-a' },
            ],
            [
                { type: 'thinking' },
                { type: 'done', files: [{ op: 'create', path: '_brand/b.jsx' }], turnId: 'turn-b' },
            ],
        ];
        let call = 0;
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                const ev = scripts[Math.min(call, scripts.length - 1)];
                call += 1;
                for (const e of ev) yield e;
            },
        });
        const onOpenRevertTimeline = vi.fn();
        const { container, cleanup } = renderToDom(
            <Harness onOpenRevertTimeline={onOpenRevertTimeline} />,
        );
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        // Turn 1
        await act(async () => {
            setReactInputValue(input, 'edit a');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // Turn 2
        await act(async () => {
            setReactInputValue(input, 'make b');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // Open thread.
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        await act(async () => { chevron.click(); });
        await tick();
        const cards = document.querySelectorAll('[data-testid="ai-thread-card"]');
        expect(cards.length).toBe(2);
        // Reverse-chron: newest (create b.jsx) first.
        expect(cards[0].textContent).toContain('make b');
        expect(cards[0].querySelector('[data-testid="ai-thread-outcome"]').textContent)
            .toBe('Created b.jsx');
        expect(cards[1].textContent).toContain('edit a');
        expect(cards[1].querySelector('[data-testid="ai-thread-outcome"]').textContent)
            .toBe('Edited a.jsx');
        // Secondary actions present.
        const actions = Array.from(cards[0].querySelectorAll('.lm-ai-thread__action')).map((b) => b.textContent);
        expect(actions).toEqual(expect.arrayContaining(['Revert this turn', 'View files', 'Open revert timeline']));
        // Each card's revert opens the timeline on ITS turnId (newest = turn-b).
        const revertBtn = Array.from(cards[0].querySelectorAll('.lm-ai-thread__action'))
            .find((b) => b.textContent === 'Revert this turn');
        await act(async () => { revertBtn.click(); });
        expect(onOpenRevertTimeline).toHaveBeenCalledWith('turn-b');
        // No raw transcript: the only outcome text is the files-derived summary.
        // The agent's intermediate node text would say e.g. "Plan:" — assert none.
        expect(document.querySelector('[data-testid="ai-thread"]').textContent).not.toContain('Plan:');
        cleanup();
    });
});

// ── AC-11 / AC-12: AI-absent idle-only fallback + sibling resilience ─────────────

describe('AiInputCluster — AI absent (AC-11, AC-12)', () => {
    it('renders the idle-only fallback and a calm note when getAi() returns null', async () => {
        aiMock.current = null;
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        expect(input.disabled).toBe(true);
        expect(input.placeholder).toBe('AI not installed');
        // Pill + chevron hidden in the absent state.
        expect(container.querySelector('[data-testid="ai-status-pill"]')).toBeNull();
        expect(container.querySelector('[data-testid="ai-thread-chevron"]')).toBeNull();
        // Clicking the field (the disabled input cannot receive clicks itself)
        // shows the calm install note.
        const field = container.querySelector('[data-testid="ai-absent-field"]');
        await act(async () => { field.click(); });
        const note = container.querySelector('[data-testid="ai-absent-note"]');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe('Run npm install @lerret/ai to enable AI features');
        cleanup();
    });

    it('a sibling dock control still renders + works alongside the absent cluster', async () => {
        aiMock.current = null;
        let clicked = 0;
        function Dock() {
            return (
                <AiContextProvider folderId={null}>
                    <SelectionScopeProvider>
                        <button data-testid="sibling" onClick={() => { clicked += 1; }}>Page</button>
                        <AiInputCluster />
                    </SelectionScopeProvider>
                </AiContextProvider>
            );
        }
        const { container, cleanup } = renderToDom(<Dock />);
        await tick();
        // Cluster is in its idle-only fallback…
        expect(container.querySelector('[data-testid="ai-input"]').disabled).toBe(true);
        // …and the sibling remains interactive.
        const sibling = container.querySelector('[data-testid="sibling"]');
        await act(async () => { sibling.click(); });
        expect(clicked).toBe(1);
        cleanup();
    });
});

// ── AC-13: first-run setup gating ────────────────────────────────────────────────

describe('AiInputCluster — first-run setup gating (AC-13)', () => {
    it('suspends the turn and opens the setup screen when no provider is configured', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [], // no providers
                isDisclosureAcked: async () => false,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'design something');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        // Setup screen is open; the turn has NOT run yet (suspended).
        expect(document.querySelector('[data-provider="openai"]')).not.toBeNull();
        expect(runTurn).not.toHaveBeenCalled();
        // Skip discards the turn.
        const skip = document.querySelector('[data-testid="lm-ai-setup-skip"]');
        await act(async () => { skip.click(); });
        await tick(20);
        expect(runTurn).not.toHaveBeenCalled();
        cleanup();
    });
});

// ── AC-14: cloud-disclosure gating ───────────────────────────────────────────────

describe('AiInputCluster — cloud disclosure gating (AC-14)', () => {
    it('opens the disclosure for an unacked cloud provider and aborts the turn on Esc', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [{ providerName: 'anthropic', active: true }],
                isDisclosureAcked: async () => false, // unacked → gate
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go cloud');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        // Disclosure is up; the turn is suspended.
        expect(document.querySelector('.lm-ai-disclosure')).not.toBeNull();
        expect(runTurn).not.toHaveBeenCalled();
        // Esc aborts the deferred turn.
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(30);
        expect(runTurn).not.toHaveBeenCalled();
        cleanup();
    });

    it('runs the turn after the disclosure primary is acknowledged', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [{ providerName: 'anthropic', active: true }],
                isDisclosureAcked: async () => false,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go cloud');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        const primary = Array.from(document.querySelectorAll('.lm-ai-disclosure__btn'))
            .find((b) => b.textContent?.includes('I understand'));
        expect(primary).not.toBeUndefined();
        await act(async () => { primary.click(); });
        await tick(40);
        expect(runTurn).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('"Switch to Ollama" with an Ollama config makes it active and RESUMES the turn', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        const setProviderConfig = vi.fn(async () => {});
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [
                    { providerName: 'anthropic', active: true, configuredAt: '2026-01-01' },
                    { providerName: 'ollama', active: false, configuredAt: '2026-01-02' },
                ],
                isDisclosureAcked: async () => false, // cloud unacked → gate
                setProviderConfig,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go cloud');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(document.querySelector('.lm-ai-disclosure')).not.toBeNull();
        const switchBtn = Array.from(document.querySelectorAll('.lm-ai-disclosure__btn'))
            .find((b) => b.textContent === 'Switch to Ollama');
        expect(switchBtn).not.toBeUndefined();
        await act(async () => { switchBtn.click(); });
        await tick(40);
        // Ollama became the folder's active provider…
        expect(setProviderConfig).toHaveBeenCalledWith(
            expect.objectContaining({
                providerName: 'ollama',
                config: expect.objectContaining({ active: true }),
            }),
        );
        // …and the suspended turn RESUMED (not discarded).
        expect(runTurn).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.lm-ai-disclosure')).toBeNull();
        cleanup();
    });

    it('"Switch to Ollama" without an Ollama config discards the turn and opens setup', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [{ providerName: 'anthropic', active: true }],
                isDisclosureAcked: async () => false,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'go cloud');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        const switchBtn = Array.from(document.querySelectorAll('.lm-ai-disclosure__btn'))
            .find((b) => b.textContent === 'Switch to Ollama');
        await act(async () => { switchBtn.click(); });
        await tick(30);
        // The turn is discarded (Ollama cannot run it — it is not configured)…
        expect(runTurn).not.toHaveBeenCalled();
        // …the disclosure is gone, and the setup screen opened so the user
        // can configure Ollama (no preselection — SetupScreen opens plainly).
        expect(document.querySelector('.lm-ai-disclosure')).toBeNull();
        expect(document.querySelector('[data-provider="ollama"]')).not.toBeNull();
        cleanup();
    });
});

// ── AC-16: reduced-motion fallback ───────────────────────────────────────────────

describe('AiInputCluster — reduced motion (AC-16)', () => {
    it('marks the pill + chevron as instant under prefers-reduced-motion: reduce', async () => {
        vi.stubGlobal('matchMedia', reducedMotionStub(true));
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const pill = container.querySelector('[data-testid="ai-status-pill"]');
        expect(pill.getAttribute('data-motion')).toBe('instant');
        const chevron = container.querySelector('[data-testid="ai-thread-chevron"]');
        expect(chevron.getAttribute('data-motion')).toBe('instant');
        cleanup();
    });

    it('marks the pill + chevron as animated when reduced motion is off', async () => {
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        expect(container.querySelector('[data-testid="ai-status-pill"]').getAttribute('data-motion'))
            .toBe('animate');
        expect(container.querySelector('[data-testid="ai-thread-chevron"]').getAttribute('data-motion'))
            .toBe('animate');
        cleanup();
    });
});

// ─── Phase 5 wiring integration (Stories 8.7 + 8.9 mounted into the cluster) ──

describe('mode toggle wiring (Story 8.9)', () => {
    it('renders the Ask/Inspect toggle; Inspect swaps the placeholder and passes mode to runTurn', async () => {
        const runTurnSpy = vi.fn(async function* (args) {
            void args;
            yield { type: 'thinking' };
            yield { type: 'inspector-response', answer: 'Three artboards use the brand color.' };
            yield { type: 'done', files: [] }; // inspect: no files, NO turnId
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();

        // The toggle is mounted in the field.
        expect(container.querySelector('[data-testid="ai-mode-toggle"]')).toBeTruthy();

        // Switch to Inspect → placeholder swaps (AC-2 of 8.9).
        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        const input = container.querySelector('[data-testid="ai-input"]');
        expect(input.placeholder).toBe('Ask Lerret about your project…');

        // Submit → runTurn receives mode: 'inspect'.
        act(() => setReactInputValue(input, 'how many artboards use our brand color?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(runTurnSpy.mock.calls[0][0].mode).toBe('inspect');
        cleanup();
    });

    it('an inspect turn renders the ANSWER as the thread-card body with no file actions and no quick-revert', async () => {
        const answer = 'Three artboards use the brand color.';
        aiMock.current = makeAi({
            events: [
                { type: 'thinking' },
                { type: 'inspector-response', answer },
                { type: 'done', files: [] },
            ],
        });
        const onOpenRevertTimeline = vi.fn();
        const { container, cleanup } = renderToDom(<Harness onOpenRevertTimeline={onOpenRevertTimeline} />);
        await tick();

        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'which artboards?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);

        // No quick-revert affordance: the inspect done carries no turnId.
        expect(container.querySelector('[data-testid="ai-quick-revert"]')).toBeNull();

        // Open the thread: the inspect card body is the ANSWER (FR58), revert
        // disabled with the calm reason, file actions omitted.
        act(() => {
            container.querySelector('[data-testid="ai-thread-chevron"]').click();
        });
        await tick();
        const card = document.querySelector('[data-testid="ai-thread-card"]');
        expect(card.getAttribute('data-mode')).toBe('inspect');
        expect(card.querySelector('[data-testid="ai-thread-outcome"]').textContent).toBe(answer);
        const actions = [...card.querySelectorAll('.lm-ai-thread__action')];
        const revertBtn = actions.find((b) => b.textContent === 'Revert this turn');
        expect(revertBtn.disabled).toBe(true);
        expect(revertBtn.title).toBe('Nothing to revert');
        expect(actions.some((b) => b.textContent === 'View files')).toBe(false);
        expect(actions.some((b) => b.textContent === 'Open revert timeline')).toBe(false);
        cleanup();
    });

    it('ask mode still passes mode: "ask" and keeps the file-outcome card', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'writing', file: '.lerret/a.jsx' };
            yield { type: 'done', files: [{ path: '.lerret/a.jsx', op: 'create' }], turnId: 'turn-1' };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'make a'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(runTurnSpy.mock.calls[0][0].mode).toBe('ask');
        cleanup();
    });
});

describe('vision gate wiring (Story 8.7)', () => {
    it('mounts the attach button in the cluster field', async () => {
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        expect(container.querySelector('[data-testid="vision-attach-button"]')).toBeTruthy();
        cleanup();
    });

    it('State A: vision required + no eligible cloud fallback → submission consumed, note + pill flash, runTurn NOT called', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true, // stub: this prompt needs vision
                supportsVision: () => false, // active model can't see images
                eligibleVisionProviders: () => [], // ...and nothing can serve a fallback
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);

        expect(runTurnSpy).not.toHaveBeenCalled();
        const note = container.querySelector('[data-testid="ai-vision-note"]');
        expect(note).toBeTruthy();
        expect(note.textContent).toMatch(/can't see images/);
        // The pill flashes the State A label (over idle).
        expect(container.querySelector('[data-testid="ai-status-pill"]').textContent).toBe(
            'Vision unavailable',
        );
        cleanup();
    });

    it('State B: eligible cloud fallback → prompt renders; accept runs the turn with providerOverride + the staged attachments (one-off)', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [], turnId: 't-vision' };
        });
        const eligible = [
            { providerName: 'openai', variant: 'cloud-byok', source: 'configured', model: 'gpt-4o' },
        ];
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => eligible,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        await stageImageAttachment(container);
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);

        // The one-off fallback prompt is open; the turn has not run yet.
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeTruthy();
        expect(runTurnSpy).not.toHaveBeenCalled();

        act(() => {
            container.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        await tick(30);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        const call = runTurnSpy.mock.calls[0][0];
        expect(call.providerOverride).toBe('openai');
        // The staged image rode the resumed turn toward the override…
        expect(call.attachments).toHaveLength(1);
        expect(call.attachments[0].mimeType).toBe('image/png');
        // …and the mid-turn decision mirror is wired for the orchestrator.
        expect(typeof call.onVisionDecision).toBe('function');
        // The prompt closed; the override was one-off (no vault write here).
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
        cleanup();
    });

    it('State B cancel: discards the submission (runTurn never called) and refocuses the input', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => [
                    { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                ],
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        act(() => {
            container.querySelector('[data-testid="vision-fallback-cancel"]').click();
        });
        await tick(30);
        expect(runTurnSpy).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(input);
        cleanup();
    });

    it('AC-15: the State B ack is never remembered — a second vision-requiring submit prompts AGAIN', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => [
                    { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                ],
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        // Turn 1: prompt → accept → runs.
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        act(() => {
            container.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
        // Turn 2: the SAME consent question is asked afresh — the ack from
        // turn 1 must not be remembered anywhere.
        act(() => setReactInputValue(input, 'match it again'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).not.toBeNull();
        expect(runTurnSpy).toHaveBeenCalledTimes(1); // turn 2 still suspended
        act(() => {
            container.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(2);
        cleanup();
    });

    it('a second Enter while the State B prompt is open consumes nothing; accept runs exactly ONE turn (S1)', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => [
                    { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                ],
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).not.toBeNull();
        // While the prompt is open `running` is false and the input is
        // enabled — a second Enter must start NOTHING and consume NOTHING.
        act(() => setReactInputValue(input, 'and another thing'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(runTurnSpy).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).not.toBeNull();
        expect(input.value).toBe('and another thing'); // second prompt untouched
        // The prompt is still answerable: accept resumes the FIRST submission
        // — exactly one turn.
        act(() => {
            container.querySelector('[data-testid="vision-fallback-yes"]').click();
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(runTurnSpy.mock.calls[0][0].prompt).toBe('match this screenshot');
        cleanup();
    });
});

// ── S2: Esc during a MID-TURN vision prompt ─────────────────────────────────────

describe('AiInputCluster — Esc answers a mid-turn vision prompt before stopping (S2)', () => {
    it('first Esc declines the prompt without aborting the turn; second Esc stops it', async () => {
        let aborted = false;
        const decisions = [];
        aiMock.current = makeAi({
            runTurnImpl: async function* ({ signal, onVisionDecision }) {
                signal.addEventListener('abort', () => { aborted = true; });
                yield { type: 'thinking' };
                // The planner blocks awaiting the mid-turn vision decision —
                // the cluster's onVisionDecision mirror opens the prompt.
                decisions.push(
                    await onVisionDecision({
                        type: 'needs-vision-fallback',
                        eligibleProviders: [
                            { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                        ],
                    }),
                );
                // Keep the turn ALIVE after the decline so the second Esc has
                // a live turn to stop (the real orchestrator raises
                // VisionUnavailable on decline — the turn then ends as a calm
                // error; this impl pins the keypress semantics instead).
                await new Promise((r) => {
                    if (signal.aborted) return r();
                    signal.addEventListener('abort', () => r());
                });
                yield { type: 'stopped' };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'compare with the screenshot');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        // The mid-turn prompt is open WHILE the turn runs.
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="ai-stop"]')).not.toBeNull();
        // Esc #1: answers the prompt (decline) — one action per keypress; the
        // turn is NOT aborted and the pill is NOT wedged on Stopping….
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(10);
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
        expect(decisions).toEqual([{ accept: false }]);
        expect(aborted).toBe(false);
        expect(container.querySelector('[data-testid="ai-status-pill"]').getAttribute('data-status'))
            .not.toBe('stopping');
        // Esc #2: with no prompt left, NOW the turn stops.
        await act(async () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await tick(10);
        expect(aborted).toBe(true);
        await tick(40);
        expect(container.querySelector('[data-testid="ai-status-pill"]').getAttribute('data-status'))
            .toBe('stopped');
        cleanup();
    });

    it('a vision prompt never outlives its turn — the turn ending settles + closes an open prompt', async () => {
        // The generator ends (error) while the decision is still pending —
        // driveTurn's finally must settle the deferred and unmount the prompt.
        aiMock.current = makeAi({
            runTurnImpl: async function* ({ onVisionDecision }) {
                yield { type: 'thinking' };
                // Fire-and-forget: the prompt opens, but the turn does NOT
                // await the answer — it errors immediately.
                void onVisionDecision({
                    eligibleProviders: [
                        { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                    ],
                });
                await new Promise((r) => setTimeout(r, 5));
                yield { type: 'error', error: { class: 'ProviderAuthFailed', message: 'bad key' } };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'compare with the screenshot');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // The turn ended (error pill); the orphaned prompt was closed with it.
        expect(container.querySelector('[data-testid="ai-status-pill"]').getAttribute('data-status'))
            .toBe('error');
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).toBeNull();
        cleanup();
    });
});

// ── S3 + Story 8.9: mode-toggle gating ──────────────────────────────────────────

describe('AiInputCluster — mode toggle gating (S3)', () => {
    it('the toggle is disabled while a turn runs and re-enables after it ends', async () => {
        const gate = deferred();
        aiMock.current = makeAi({
            runTurnImpl: async function* () {
                yield { type: 'thinking' };
                await gate.promise;
                yield { type: 'done', files: [] };
            },
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(false);
        await act(async () => {
            setReactInputValue(input, 'go');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(20);
        // Mid-run: the mode is pinned for the duration of the turn.
        expect(container.querySelector('[data-testid="ai-mode-ask"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(true);
        await act(async () => { gate.resolve(); });
        await tick(40);
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(false);
        cleanup();
    });

    it('the toggle is disabled while a submit is suspended at the setup gate', async () => {
        const runTurn = vi.fn(async function* () { yield { type: 'done', files: [] }; });
        aiMock.current = {
            runTurn,
            vault: {
                listProviderConfigs: async () => [], // no providers → setup gate
                isDisclosureAcked: async () => false,
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, 'design something');
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        // The setup gate holds a suspended submission that already captured
        // its mode — the visible toggle must not be flippable underneath it.
        expect(document.querySelector('[data-provider="openai"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="ai-mode-ask"]').disabled).toBe(true);
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(true);
        // Discarding the gate releases the toggle.
        const skip = document.querySelector('[data-testid="lm-ai-setup-skip"]');
        await act(async () => { skip.click(); });
        await tick(20);
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(false);
        cleanup();
    });

    it('the toggle is disabled while the State B vision prompt is open', async () => {
        aiMock.current = {
            ...makeAi(),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => [
                    { providerName: 'openai', variant: 'cloud-byok', source: 'configured' },
                ],
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(container.querySelector('[data-testid="vision-fallback-prompt"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(true);
        act(() => {
            container.querySelector('[data-testid="vision-fallback-cancel"]').click();
        });
        await tick(20);
        expect(container.querySelector('[data-testid="ai-mode-inspect"]').disabled).toBe(false);
        cleanup();
    });
});

// ── S4: deterministic workflow turns skip the vision gate ───────────────────────

describe('AiInputCluster — recognized workflow turns skip the vision gate (S4)', () => {
    // A recognizer stub mirroring ai.workflows.recognizeWorkflow's shape; the
    // vision stub would BLOCK any gated prompt as State A (no fallback).
    const workflows = {
        recognizeWorkflow: (p) =>
            /launch\s+kit/i.test(String(p))
                ? { kind: 'launch-kit', platforms: ['twitter'] }
                : { kind: 'generic' },
    };
    const blockingVision = {
        isVisionRequired: () => true,
        supportsVision: () => false,
        eligibleVisionProviders: () => [],
    };

    it('a recognized launch-kit prompt runs the turn — no State A block, no note', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            workflows,
            vision: blockingVision,
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'launch kit for twitter'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // The gate would have blocked this as State A — the recognized
        // workflow shape skips it entirely (zero provider calls to protect).
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="ai-vision-note"]')).toBeNull();
        cleanup();
    });

    it('staged images are dropped from a workflow turn with the calm inline note', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            workflows,
            vision: blockingVision,
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        await stageImageAttachment(container);
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'launch kit for twitter'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        // The turn ran WITHOUT the attachments (kit generation ignores them)…
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(runTurnSpy.mock.calls[0][0].attachments).toBeUndefined();
        // …and the drop is explained calmly, not silently.
        const note = container.querySelector('[data-testid="ai-vision-note"]');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe('Image ignored — kit generation runs without vision.');
        // The dropped image does NOT linger for the next submit.
        act(() => setReactInputValue(input, 'launch kit for twitter again'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(2);
        expect(runTurnSpy.mock.calls[1][0].attachments).toBeUndefined();
        expect(container.querySelector('[data-testid="ai-vision-note"]')).toBeNull();
        cleanup();
    });
});

// ── S6: inspect submits + staged attachments ────────────────────────────────────

describe('AiInputCluster — inspect submits leave attachments staged (S6)', () => {
    it('an inspect submit neither sends nor clears staged attachments; the next ask turn consumes them', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy }); // no vision ns → gate fail-safe 'run'
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        await stageImageAttachment(container);
        // Inspect submit: text-only — the staged image must NOT ride…
        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'what pages exist?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        expect(runTurnSpy.mock.calls[0][0].mode).toBe('inspect');
        expect(runTurnSpy.mock.calls[0][0].attachments).toBeUndefined();
        // …and must still be staged for the NEXT ask submit.
        act(() => {
            container.querySelector('[data-testid="ai-mode-ask"]').click();
        });
        act(() => setReactInputValue(input, 'use the image'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        expect(runTurnSpy).toHaveBeenCalledTimes(2);
        expect(runTurnSpy.mock.calls[1][0].attachments).toHaveLength(1);
        expect(runTurnSpy.mock.calls[1][0].attachments[0].mimeType).toBe('image/png');
        cleanup();
    });

    it('an inspect submit clears a stale State A note', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = {
            ...makeAi({ runTurnImpl: runTurnSpy }),
            vision: {
                isVisionRequired: () => true,
                supportsVision: () => false,
                eligibleVisionProviders: () => [], // ask submits block as State A
            },
        };
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        const input = container.querySelector('[data-testid="ai-input"]');
        // Arm State A via a blocked ask submit.
        act(() => setReactInputValue(input, 'match this screenshot'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        expect(runTurnSpy).not.toHaveBeenCalled();
        expect(container.querySelector('[data-testid="ai-vision-note"]')).not.toBeNull();
        // An inspect submit reads fresh: the stale note clears, the turn runs.
        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        act(() => setReactInputValue(input, 'what pages exist?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
        expect(container.querySelector('[data-testid="ai-vision-note"]')).toBeNull();
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        cleanup();
    });
});

// ── S5 / AC-9: inspect answers — clickable file paths ───────────────────────────

describe('AiInputCluster — inspect answers render file paths as actions (AC-9)', () => {
    it('a detected path renders as a button; clicking scopes the next prompt and closes the thread', async () => {
        // Reduced motion → the EditorSheet close is instant in jsdom.
        vi.stubGlobal('matchMedia', reducedMotionStub(true));
        const answer = 'The card lives at .lerret/social/card.jsx beside its page.';
        aiMock.current = makeAi({
            events: [
                { type: 'thinking' },
                { type: 'inspector-response', answer },
                { type: 'done', files: [] },
            ],
        });
        let scopeCtx;
        const { container, cleanup } = renderToDom(
            <Harness onScopeReady={(c) => { scopeCtx = c; }} />,
        );
        await tick();
        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'where is the card?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        act(() => {
            container.querySelector('[data-testid="ai-thread-chevron"]').click();
        });
        await tick();
        // The path is an inline action inside the answer; the surrounding
        // text stays plain (React-escaped) text.
        const pathBtn = document.querySelector('[data-testid="ai-thread-path"]');
        expect(pathBtn).not.toBeNull();
        expect(pathBtn.tagName).toBe('BUTTON');
        expect(pathBtn.textContent).toBe('.lerret/social/card.jsx');
        expect(document.querySelector('[data-testid="ai-thread-outcome"]').textContent).toBe(answer);
        // Click: the selection scope becomes the file; the thread closes.
        await act(async () => { pathBtn.click(); });
        await tick(20);
        expect(scopeCtx.scope).toMatchObject({
            kind: 'file',
            filePath: '.lerret/social/card.jsx',
            label: 'card.jsx',
        });
        expect(document.querySelector('[data-testid="ai-thread"]')).toBeNull();
        // The chip reflects the new scope back at the dock.
        expect(container.querySelector('[data-testid="ai-selection-chip"]').textContent)
            .toContain('card.jsx');
        cleanup();
    });

    it('an answer without paths renders as plain text — no action buttons', async () => {
        const answer = 'Three artboards use the brand color.';
        aiMock.current = makeAi({
            events: [
                { type: 'thinking' },
                { type: 'inspector-response', answer },
                { type: 'done', files: [] },
            ],
        });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        act(() => {
            container.querySelector('[data-testid="ai-mode-inspect"]').click();
        });
        const input = container.querySelector('[data-testid="ai-input"]');
        act(() => setReactInputValue(input, 'how many?'));
        act(() => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(30);
        act(() => {
            container.querySelector('[data-testid="ai-thread-chevron"]').click();
        });
        await tick();
        expect(document.querySelector('[data-testid="ai-thread-path"]')).toBeNull();
        expect(document.querySelector('[data-testid="ai-thread-outcome"]').textContent).toBe(answer);
        cleanup();
    });
});

// ── folderId + CLI filesystem bridge wiring (cross-story integration) ─────────
//
// The real-browser smoke found runTurn invoked WITHOUT folderId/projectRoot/fs
// — the vault resolver then throws (`listProviderConfigs: folderId must be a
// non-empty string`) and the snapshot store has no filesystem. These tests pin
// the wiring: folderId always rides along; in CLI mode with an absolute
// folderId the memoized ai-fs adapter + derived projectRoot ride too; outside
// CLI mode they are omitted.

describe('AiInputCluster — runTurn receives folderId (+ fs/projectRoot in CLI mode)', () => {
    /** Submit a prompt through the input and wait for the turn to finish. */
    async function submitPrompt(container, prompt = 'make a card') {
        const input = container.querySelector('[data-testid="ai-input"]');
        await act(async () => {
            setReactInputValue(input, prompt);
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await tick(40);
    }

    afterEach(() => {
        delete globalThis.__LERRET_CLI_MODE__;
    });

    it('passes the context folderId and OMITS fs/projectRoot outside CLI mode', async () => {
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        await submitPrompt(container);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        const call = runTurnSpy.mock.calls[0][0];
        expect(call.folderId).toBe('folder:test:abc');
        // jsdom default: no __LERRET_CLI_MODE__ → the CLI bridge must not ride.
        expect('fs' in call).toBe(false);
        expect('projectRoot' in call).toBe(false);
        cleanup();
    });

    it('CLI mode + absolute folderId: passes the derived projectRoot and the ai-fs adapter', async () => {
        globalThis.__LERRET_CLI_MODE__ = true;
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(
            <Harness folderId="/Users/me/my-project/.lerret" />,
        );
        await tick();
        await submitPrompt(container);
        expect(runTurnSpy).toHaveBeenCalledTimes(1);
        const call = runTurnSpy.mock.calls[0][0];
        // The vault identity stays the folderId (the `.lerret/` path)…
        expect(call.folderId).toBe('/Users/me/my-project/.lerret');
        // …while the sandbox root is the folder CONTAINING `.lerret/`.
        expect(call.projectRoot).toBe('/Users/me/my-project');
        // The fs is the v1 FilesystemAccess-shaped CLI adapter.
        expect(call.fs).toBeTruthy();
        expect(call.fs.capabilities).toEqual({
            canWrite: true,
            canWatch: false,
            canReveal: false,
        });
        for (const method of ['readDir', 'readFile', 'writeFile', 'watch', 'deleteFile', 'mkdir', 'exists']) {
            expect(typeof call.fs[method]).toBe('function');
        }
        cleanup();
    });

    it('memoizes the adapter per folderId — two turns share ONE fs instance', async () => {
        globalThis.__LERRET_CLI_MODE__ = true;
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(
            <Harness folderId="/Users/me/my-project/.lerret" />,
        );
        await tick();
        await submitPrompt(container, 'first turn');
        // Let the terminal dwell pass so the input re-enables for turn two.
        await tick(1600);
        await submitPrompt(container, 'second turn');
        expect(runTurnSpy).toHaveBeenCalledTimes(2);
        const first = runTurnSpy.mock.calls[0][0];
        const second = runTurnSpy.mock.calls[1][0];
        expect(first.fs).toBe(second.fs);
        expect(first.projectRoot).toBe(second.projectRoot);
        cleanup();
    });

    it('CLI mode with a NON-absolute folderId still omits fs/projectRoot (no bridge target)', async () => {
        globalThis.__LERRET_CLI_MODE__ = true;
        const runTurnSpy = vi.fn(async function* () {
            yield { type: 'done', files: [] };
        });
        aiMock.current = makeAi({ runTurnImpl: runTurnSpy });
        const { container, cleanup } = renderToDom(<Harness />);
        await tick();
        await submitPrompt(container);
        const call = runTurnSpy.mock.calls[0][0];
        expect(call.folderId).toBe('folder:test:abc');
        expect('fs' in call).toBe(false);
        expect('projectRoot' in call).toBe(false);
        cleanup();
    });
});

describe('deriveProjectRoot — folderId → project root', () => {
    it('strips the trailing /.lerret segment (the CLI scan root form)', () => {
        expect(deriveProjectRoot('/Users/me/my-project/.lerret')).toBe('/Users/me/my-project');
        expect(deriveProjectRoot('/Users/me/my-project/.lerret/')).toBe('/Users/me/my-project');
    });

    it('passes an absolute non-.lerret path through as the root (defensive)', () => {
        expect(deriveProjectRoot('/Users/me/my-project')).toBe('/Users/me/my-project');
    });

    it('returns null for non-absolute / non-string identities', () => {
        expect(deriveProjectRoot('folder:test:abc')).toBeNull();
        expect(deriveProjectRoot('')).toBeNull();
        expect(deriveProjectRoot(null)).toBeNull();
        expect(deriveProjectRoot(undefined)).toBeNull();
        // A bare `/.lerret` has no containing folder — no usable root.
        expect(deriveProjectRoot('/.lerret')).toBeNull();
    });
});
