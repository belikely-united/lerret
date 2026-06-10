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
