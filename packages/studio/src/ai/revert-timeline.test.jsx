// Tests for the Revert Timeline Panel (UX-delta §4.5, FR52). jsdom.
//
// Every test drives off a MOCKED getAi() (vi.mock('./lazy.js')) whose
// `snapshot` namespace is a set of vi.fn stubs — the real snapshot store is
// never touched (mirrors ai-input-cluster.test.jsx's harness). CLI mode is
// simulated via `globalThis.__LERRET_CLI_MODE__ = true` + a POSIX-absolute
// folderId, so the panel derives a real {projectRoot, fs} binding; the
// mocked snapshot functions receive (and the tests assert) that binding but
// never call into it.
//
// Coverage map (§4.5 → test):
//   - empty state (verbatim copy, no action buttons)
//   - unavailable notes: @lerret/ai absent; no CLI fs bridge (listing never
//     attempted); read-only when the snapshot barrel lacks createSandbox
//   - timeline lists manifests most-recent-first with §4.5 status labels
//   - selecting a row populates the right column (full prompt, model, provider)
//   - opening with focusTurnId preselects that turn
//   - file rows carry the §4.5 op labels (created / edited / deleted)
//   - per-file Restore → ai.snapshot.revertFile({projectRoot, fs, sandbox,
//     turnId, filePath}) with the sandbox built via ai.snapshot.createSandbox
//     (pins the snapshot-barrel re-export the panel consumes)
//   - Revert this turn → revertTurn + inline `Reverted` cue + re-list
//     (statuses change in place); the cue expires after 1500ms
//   - NO confirmation modal — one click calls straight through
//   - Revert to before this turn → revertToTurn
//   - Redo disabled until the selected turn's status is 'reverted', then
//     calls redoTurn
//   - Esc closes (onClose)

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── getAi() mock ───────────────────────────────────────────────────────────────
const aiMock = {
    current: /** @type {object | null} */ (null),
};
vi.mock('./lazy.js', () => ({
    getAi: async () => aiMock.current,
    _resetAiCache: () => {},
    lastLoadError: undefined,
}));

import {
    RevertTimelinePanel,
    EMPTY_STATE_TEXT,
    UNAVAILABLE_NOTES,
    STATUS_LABELS,
    OP_LABELS,
} from './revert-timeline.jsx';
import { AiContextProvider } from './ai-context.jsx';

// ── Test infra ─────────────────────────────────────────────────────────────────

const FOLDER_ID = '/Users/test/demo-app/.lerret';
const PROJECT_ROOT = '/Users/test/demo-app';

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

async function tick(ms = 20) {
    await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
    });
}

/** Build a well-formed turn manifest (snapshot/manifest.js shape). */
function manifest(over = {}) {
    return {
        id: 'turn-1',
        timestamp: '2026-06-10T10:00:00.000Z',
        prompt: 'Make the hero bolder',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        scope: { type: 'project' },
        files: [
            {
                path: 'pages/home/hero.jsx',
                op: 'edit',
                sha256: 'a'.repeat(64),
                snapshotKey: 'b'.repeat(64),
            },
        ],
        status: 'applied',
        kind: 'turn',
        ...over,
    };
}

/**
 * Build a fake @lerret/ai module whose snapshot namespace serves `store.list`
 * and whose revert/redo stubs flip statuses in the store — so a post-action
 * re-list observes changed statuses, like the real backend.
 */
function makeAi({ list = [], snapshot = {} } = {}) {
    const store = { list };
    const flip = (turnId, status) => {
        store.list = store.list.map((m) => (m.id === turnId ? { ...m, status } : m));
    };
    const ai = {
        snapshot: {
            listManifests: vi.fn(async () =>
                [...store.list].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
            ),
            createSandbox: vi.fn(({ projectRoot, fs }) => ({ kind: 'sandbox', projectRoot, fs })),
            revertFile: vi.fn(async ({ turnId }) => flip(turnId, 'reverted')),
            revertTurn: vi.fn(async ({ turnId }) => flip(turnId, 'reverted')),
            revertToTurn: vi.fn(async ({ turnId }) => flip(turnId, 'reverted')),
            redoTurn: vi.fn(async ({ turnId }) => flip(turnId, 'reverted-forward')),
            ...snapshot,
        },
        vault: {
            listProviderConfigs: async () => [],
            isDisclosureAcked: async () => false,
        },
    };
    ai._store = store;
    return ai;
}

function Harness({ open = true, onClose = () => {}, focusTurnId, folderId = FOLDER_ID }) {
    return (
        <AiContextProvider folderId={folderId}>
            <RevertTimelinePanel open={open} onClose={onClose} focusTurnId={focusTurnId} />
        </AiContextProvider>
    );
}

const rows = () => [...document.querySelectorAll('[data-testid="revert-timeline-row"]')];
const detailPrompt = () => document.querySelector('[data-testid="revert-timeline-detail-prompt"]');
const cueText = () =>
    document.querySelector('[data-testid="revert-timeline-cue"]')?.textContent ?? '';

beforeEach(() => {
    aiMock.current = makeAi();
    globalThis.__LERRET_CLI_MODE__ = true;
    vi.stubGlobal('matchMedia', () => ({
        matches: false,
        media: '',
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
    }));
});

afterEach(() => {
    delete globalThis.__LERRET_CLI_MODE__;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

// ── Empty + unavailable states ─────────────────────────────────────────────────

describe('RevertTimelinePanel — empty + unavailable states', () => {
    it('renders the verbatim §4.5 empty state when no turn has run', async () => {
        aiMock.current = makeAi({ list: [] });
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const empty = document.querySelector('[data-testid="revert-timeline-empty"]');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toBe(EMPTY_STATE_TEXT);
        expect(EMPTY_STATE_TEXT).toBe(
            'No AI history yet. Run an AI turn from the dock to get started.',
        );
        // No timeline rows, no action buttons — nothing broken to click.
        expect(rows().length).toBe(0);
        expect(document.querySelector('[data-testid="revert-timeline-revert-turn"]')).toBeNull();
        cleanup();
    });

    it('renders a calm unavailable note (not broken buttons) when @lerret/ai is absent', async () => {
        aiMock.current = null;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const note = document.querySelector('[data-testid="revert-timeline-unavailable"]');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe(UNAVAILABLE_NOTES['ai-absent']);
        expect(rows().length).toBe(0);
        expect(document.querySelector('[data-testid="revert-timeline-restore"]')).toBeNull();
        cleanup();
    });

    it('renders the CLI-only note outside CLI mode and never attempts a listing', async () => {
        delete globalThis.__LERRET_CLI_MODE__;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const note = document.querySelector('[data-testid="revert-timeline-unavailable"]');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe(UNAVAILABLE_NOTES['no-fs']);
        // Listing is impossible without an fs bridge — it must not be tried.
        expect(aiMock.current.snapshot.listManifests).not.toHaveBeenCalled();
        cleanup();
    });

    it('renders the timeline READ-ONLY (no Restore / footer actions) when the snapshot barrel lacks createSandbox', async () => {
        aiMock.current = makeAi({
            list: [manifest()],
            snapshot: { createSandbox: undefined },
        });
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        // The timeline itself renders…
        expect(rows().length).toBe(1);
        expect(detailPrompt()).not.toBeNull();
        // …but no mutation affordances do.
        expect(document.querySelector('[data-testid="revert-timeline-restore"]')).toBeNull();
        expect(document.querySelector('[data-testid="revert-timeline-revert-turn"]')).toBeNull();
        expect(document.querySelector('[data-testid="revert-timeline-redo"]')).toBeNull();
        cleanup();
    });
});

// ── Timeline list (left column) ────────────────────────────────────────────────

describe('RevertTimelinePanel — timeline list', () => {
    it('lists manifests most-recent-first with the §4.5 status labels', async () => {
        aiMock.current = makeAi({
            list: [
                manifest({ id: 't1', timestamp: '2026-06-10T10:00:00.000Z', prompt: 'First turn', status: 'applied' }),
                manifest({ id: 't2', timestamp: '2026-06-10T11:00:00.000Z', prompt: 'Second turn', status: 'stopped-mid-turn' }),
                manifest({ id: 't3', timestamp: '2026-06-10T12:00:00.000Z', prompt: 'Third turn', status: 'error' }),
            ],
        });
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const r = rows();
        expect(r.length).toBe(3);
        // Most recent at top — listManifests sorts ascending, the panel reverses.
        expect(r.map((el) => el.getAttribute('data-turn-id'))).toEqual(['t3', 't2', 't1']);
        const statusOf = (el) =>
            el.querySelector('.lm-revert-timeline__row-status').textContent;
        expect(statusOf(r[0])).toBe('Error');
        expect(statusOf(r[1])).toBe('Stopped mid-turn');
        expect(statusOf(r[2])).toBe('Applied');
        // The §4.5 label set is pinned (incl. the redo'd state).
        expect(STATUS_LABELS['reverted-forward']).toBe('Reverted forward');
        expect(STATUS_LABELS.reverted).toBe('Reverted');
        // Each row shows its one-line prompt + a timestamp.
        expect(r[0].querySelector('.lm-revert-timeline__row-prompt').textContent).toBe('Third turn');
        expect(r[0].querySelector('.lm-revert-timeline__row-time').textContent).not.toBe('');
        cleanup();
    });

    it('selecting a turn populates the right column with full prompt, model and provider', async () => {
        aiMock.current = makeAi({
            list: [
                manifest({ id: 't1', timestamp: '2026-06-10T10:00:00.000Z', prompt: 'Recolor the pricing table to match the brand palette', provider: 'openai', model: 'gpt-5.2' }),
                manifest({ id: 't2', timestamp: '2026-06-10T11:00:00.000Z', prompt: 'Newer turn' }),
            ],
        });
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        // The most recent turn is preselected by default.
        expect(detailPrompt().textContent).toBe('Newer turn');
        // Click the older row → right column repopulates.
        const t1 = rows().find((el) => el.getAttribute('data-turn-id') === 't1');
        await act(async () => { t1.click(); });
        expect(t1.getAttribute('data-selected')).toBe('true');
        expect(detailPrompt().textContent).toBe(
            'Recolor the pricing table to match the brand palette',
        );
        const provenance = document.querySelector(
            '[data-testid="revert-timeline-detail-provenance"]',
        );
        expect(provenance.textContent).toContain('gpt-5.2');
        expect(provenance.textContent).toContain('OpenAI');
        cleanup();
    });

    it('preselects the focus turn when opened with focusTurnId (quick-revert / thread entry)', async () => {
        aiMock.current = makeAi({
            list: [
                manifest({ id: 't1', timestamp: '2026-06-10T10:00:00.000Z', prompt: 'Old turn' }),
                manifest({ id: 't2', timestamp: '2026-06-10T11:00:00.000Z', prompt: 'Newest turn' }),
            ],
        });
        const { cleanup } = renderToDom(<Harness focusTurnId="t1" />);
        await tick(30);
        const t1 = rows().find((el) => el.getAttribute('data-turn-id') === 't1');
        expect(t1.getAttribute('data-selected')).toBe('true');
        expect(t1.getAttribute('aria-selected')).toBe('true');
        expect(detailPrompt().textContent).toBe('Old turn');
        cleanup();
    });

    it('renders the §4.5 op labels per file (created moss / edited Stone / deleted warm-error)', async () => {
        aiMock.current = makeAi({
            list: [
                manifest({
                    id: 't1',
                    files: [
                        { path: 'pages/a/new.jsx', op: 'create', sha256: 'a'.repeat(64), snapshotKey: null },
                        { path: 'pages/a/old.jsx', op: 'edit', sha256: 'a'.repeat(64), snapshotKey: 'b'.repeat(64) },
                        { path: 'pages/a/gone.jsx', op: 'delete', snapshotKey: 'b'.repeat(64) },
                    ],
                }),
            ],
        });
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const fileEls = [...document.querySelectorAll('[data-testid="revert-timeline-file"]')];
        expect(fileEls.length).toBe(3);
        const opOf = (el) => el.querySelector('.lm-revert-timeline__file-op');
        expect(opOf(fileEls[0]).textContent).toBe('created');
        expect(opOf(fileEls[0]).getAttribute('data-op')).toBe('create');
        expect(opOf(fileEls[1]).textContent).toBe('edited');
        expect(opOf(fileEls[2]).textContent).toBe('deleted');
        expect(opOf(fileEls[2]).getAttribute('data-op')).toBe('delete');
        expect(OP_LABELS).toEqual({ create: 'created', edit: 'edited', delete: 'deleted' });
        // Each file row has its inline ghost Restore button.
        expect(fileEls[0].querySelector('[data-testid="revert-timeline-restore"]')).not.toBeNull();
        cleanup();
    });
});

// ── Actions (right column) ─────────────────────────────────────────────────────

describe('RevertTimelinePanel — revert / redo actions', () => {
    it('per-file Restore calls ai.snapshot.revertFile with {projectRoot, fs, sandbox, turnId, filePath}', async () => {
        const ai = makeAi({ list: [manifest({ id: 't9' })] });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const restore = document.querySelector('[data-testid="revert-timeline-restore"]');
        await act(async () => { restore.click(); });
        await tick(20);
        // The sandbox is built through the snapshot barrel's createSandbox —
        // pinning the `ai.snapshot.createSandbox` re-export the panel consumes.
        expect(ai.snapshot.createSandbox).toHaveBeenCalledTimes(1);
        const sandboxArgs = ai.snapshot.createSandbox.mock.calls[0][0];
        expect(sandboxArgs.projectRoot).toBe(PROJECT_ROOT);
        expect(typeof sandboxArgs.fs.readDir).toBe('function');
        const sandbox = ai.snapshot.createSandbox.mock.results[0].value;
        expect(ai.snapshot.revertFile).toHaveBeenCalledTimes(1);
        expect(ai.snapshot.revertFile).toHaveBeenCalledWith({
            projectRoot: PROJECT_ROOT,
            fs: sandboxArgs.fs,
            sandbox,
            turnId: 't9',
            filePath: 'pages/home/hero.jsx',
        });
        // The same fs instance fed the listing — one binding end to end.
        expect(ai.snapshot.listManifests.mock.calls[0][0].fs).toBe(sandboxArgs.fs);
        cleanup();
    });

    it('Revert this turn calls revertTurn, shows the inline Reverted cue, and re-lists (status flips in place)', async () => {
        const ai = makeAi({ list: [manifest({ id: 't1', status: 'applied' })] });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        expect(ai.snapshot.listManifests).toHaveBeenCalledTimes(1);
        const btn = document.querySelector('[data-testid="revert-timeline-revert-turn"]');
        await act(async () => { btn.click(); });
        await tick(20);
        expect(ai.snapshot.revertTurn).toHaveBeenCalledTimes(1);
        expect(ai.snapshot.revertTurn.mock.calls[0][0].turnId).toBe('t1');
        expect(ai.snapshot.revertTurn.mock.calls[0][0].projectRoot).toBe(PROJECT_ROOT);
        // Inline cue (moss, §4.5) — no modal anywhere in the flow.
        expect(cueText()).toBe('Reverted');
        // Re-listed after the action…
        expect(ai.snapshot.listManifests).toHaveBeenCalledTimes(2);
        // …and the flipped status renders in the timeline row.
        const row = rows()[0];
        expect(row.querySelector('.lm-revert-timeline__row-status').textContent).toBe('Reverted');
        cleanup();
    });

    it('shows NO confirmation modal — one click calls straight through to the backend', async () => {
        const ai = makeAi({ list: [manifest({ id: 't1' })] });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        // Exactly one dialog (the panel itself) before and after the click.
        expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
        const btn = document.querySelector('[data-testid="revert-timeline-revert-turn"]');
        await act(async () => { btn.click(); });
        await tick(20);
        expect(ai.snapshot.revertTurn).toHaveBeenCalledTimes(1);
        expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        cleanup();
    });

    it('expires the Reverted cue after 1500ms', async () => {
        vi.useFakeTimers();
        try {
            const ai = makeAi({ list: [manifest({ id: 't1' })] });
            aiMock.current = ai;
            const { cleanup } = renderToDom(<Harness />);
            await act(async () => { await vi.advanceTimersByTimeAsync(30); });
            const btn = document.querySelector('[data-testid="revert-timeline-revert-turn"]');
            await act(async () => { btn.click(); });
            await act(async () => { await vi.advanceTimersByTimeAsync(20); });
            expect(cueText()).toBe('Reverted');
            await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
            expect(cueText()).toBe('');
            cleanup();
        } finally {
            vi.useRealTimers();
        }
    });

    it('Revert to before this turn calls revertToTurn with the selected turn id', async () => {
        const ai = makeAi({
            list: [
                manifest({ id: 't1', timestamp: '2026-06-10T10:00:00.000Z' }),
                manifest({ id: 't2', timestamp: '2026-06-10T11:00:00.000Z' }),
            ],
        });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness focusTurnId="t1" />);
        await tick(30);
        const btn = document.querySelector('[data-testid="revert-timeline-revert-before"]');
        await act(async () => { btn.click(); });
        await tick(20);
        expect(ai.snapshot.revertToTurn).toHaveBeenCalledTimes(1);
        expect(ai.snapshot.revertToTurn.mock.calls[0][0].turnId).toBe('t1');
        const sandbox = ai.snapshot.createSandbox.mock.results[0].value;
        expect(ai.snapshot.revertToTurn.mock.calls[0][0].sandbox).toBe(sandbox);
        cleanup();
    });

    it('Redo is disabled until a revert has been performed, then calls redoTurn', async () => {
        const ai = makeAi({ list: [manifest({ id: 't1', status: 'applied' })] });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const redo = () => document.querySelector('[data-testid="revert-timeline-redo"]');
        // Applied turn → nothing to redo.
        expect(redo().disabled).toBe(true);
        // Revert it (status flips via the re-list) → Redo lights up.
        const revertBtn = document.querySelector('[data-testid="revert-timeline-revert-turn"]');
        await act(async () => { revertBtn.click(); });
        await tick(20);
        expect(redo().disabled).toBe(false);
        await act(async () => { redo().click(); });
        await tick(20);
        expect(ai.snapshot.redoTurn).toHaveBeenCalledTimes(1);
        expect(ai.snapshot.redoTurn.mock.calls[0][0].turnId).toBe('t1');
        // The redo flipped the source to 'reverted-forward' → §4.5 label.
        expect(rows()[0].querySelector('.lm-revert-timeline__row-status').textContent)
            .toBe('Reverted forward');
        // …and Redo disarms again (only 'reverted' turns are redoable).
        expect(redo().disabled).toBe(true);
        cleanup();
    });

    it('shows a calm inline note (no danger styling) when an action fails', async () => {
        const ai = makeAi({ list: [manifest({ id: 't1' })] });
        ai.snapshot.revertTurn = vi.fn(async () => {
            throw new Error('BLOB_MISSING');
        });
        aiMock.current = ai;
        const { cleanup } = renderToDom(<Harness />);
        await tick(30);
        const btn = document.querySelector('[data-testid="revert-timeline-revert-turn"]');
        await act(async () => { btn.click(); });
        await tick(20);
        const note = document.querySelector('[data-testid="revert-timeline-action-note"]');
        expect(note).not.toBeNull();
        expect(note.textContent).toBe("Couldn't complete that action.");
        // No cue (the action did not complete), no alert-styled surface.
        expect(cueText()).toBe('');
        expect(document.querySelector('[role="alert"]')).toBeNull();
        cleanup();
    });
});

// ── Shell contract ─────────────────────────────────────────────────────────────

describe('RevertTimelinePanel — open/close contract', () => {
    it('renders nothing when open is false', async () => {
        const { cleanup } = renderToDom(<Harness open={false} />);
        await tick(20);
        expect(document.querySelector('[data-testid="revert-timeline-panel"]')).toBeNull();
        cleanup();
    });

    it('Esc closes the panel via onClose', async () => {
        const onClose = vi.fn();
        aiMock.current = makeAi({ list: [manifest()] });
        const { cleanup } = renderToDom(<Harness onClose={onClose} />);
        await tick(30);
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        cleanup();
    });

    it('the close button and backdrop click both call onClose', async () => {
        const onClose = vi.fn();
        aiMock.current = makeAi({ list: [manifest()] });
        const { cleanup } = renderToDom(<Harness onClose={onClose} />);
        await tick(30);
        await act(async () => {
            document.querySelector('[data-testid="revert-timeline-close"]').click();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        await act(async () => {
            document.querySelector('[data-testid="revert-timeline-backdrop"]').click();
        });
        expect(onClose).toHaveBeenCalledTimes(2);
        cleanup();
    });
});
