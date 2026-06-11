/**
 * revert-timeline.jsx — UX-delta §4.5 Revert Timeline Panel (FR52).
 *
 * A summoned Editor-sheet VARIANT — wider than the editor family (≈ 720 × 600)
 * — that shows the current folder's AI turn history and lets the user revert
 * at three granularities: per-file within a turn, whole-turn, and
 * step-back-to-before-a-turn, plus redo-forward. EditorSheet itself has a
 * fixed 640px width, so this panel renders its OWN backdrop + dialog + focus
 * trap at the §4.5 size, mirroring ollama-origins-guide.jsx (the established
 * own-dialog pattern) and portaled to <body> like the dock's
 * ConnectProjectDialog (the dock's backdrop-filter is a containing block for
 * fixed-position descendants).
 *
 * Layout — two columns:
 *   LEFT (≈35%)  — vertical timeline, most recent first; each row: one-line
 *                  truncated prompt (12px sans), timestamp (Stone, mono), and
 *                  the status label (Applied / Reverted / Reverted forward /
 *                  Stopped mid-turn / Error). Selecting a row populates the
 *                  right column.
 *   RIGHT (≈65%) — header (full prompt, model, provider); file list with op
 *                  labels (`created` moss, `edited` Stone, `deleted`
 *                  warm-error) and an inline `Restore` ghost button per file;
 *                  footer actions: `Revert this turn`, `Revert to before this
 *                  turn`, `Redo` (enabled only when the selected turn's
 *                  status is 'reverted' — the only status redoTurn accepts).
 *
 * Confirmation behavior — NO modals. The live-edit loop is the confirmation:
 * as the snapshot rewrites files the canvas re-renders in place. A small
 * inline `Reverted` cue (moss, 1500ms) appears at the panel bottom after an
 * action, then the manifests are re-listed (statuses change). Calm voice
 * throughout; no danger styling (the timeline is descriptive, not alarmist).
 *
 * ── Dynamic-import boundary (non-negotiable) ────────────────────────────────
 * This file reaches @lerret/ai ONLY via `await getAi()` from ./lazy.js — it
 * never `import`s '@lerret/ai'. The revert backend is consumed as
 * `ai.snapshot.{listManifests, revertFile, revertTurn, revertToTurn,
 * redoTurn}` and the Story 8.4 sandbox the revert API requires is built via
 * `ai.snapshot.createSandbox({ projectRoot, fs })` — the SAME @lerret/core
 * helper run-turn.js uses, re-exported through the snapshot barrel so the
 * panel needs no second import path.
 *
 * ── Filesystem reach (CLI mode only, v1) ────────────────────────────────────
 * The manifests live on disk under `<projectRoot>/.lerret/.state/history/`,
 * so listing needs a real FilesystemAccess. In CLI mode the folderId from
 * useAiContext() is the absolute `.lerret/` path; `deriveProjectRoot` strips
 * the suffix and `createCliAiFs` bridges to the dev server's endpoints —
 * exactly the binding the dock cluster hands runTurn. Outside CLI mode (or
 * when @lerret/ai is absent) listing is impossible, so the panel shows a calm
 * unavailable note instead of broken buttons.
 */

import React from 'react';
import * as ReactDOM from 'react-dom';

import { getAi } from './lazy.js';
import { useAiContext, PROVIDER_LABELS } from './ai-context.jsx';
import { createCliAiFs } from './ai-fs.js';
import { deriveProjectRoot } from './ai-input-cluster.jsx';
import { inCliMode } from '../runtime/write-client.js';

// ─── Copy (single sources of truth — tests reference these exports) ──────────

/**
 * Empty state — verbatim per UX-delta §4.5.
 *
 * @type {string}
 */
export const EMPTY_STATE_TEXT = 'No AI history yet. Run an AI turn from the dock to get started.';

/**
 * Calm unavailable notes, keyed by reason. §4.5's panel never renders broken
 * buttons: when listing is impossible the body is one of these notes.
 *
 * @type {Readonly<Record<'ai-absent' | 'no-fs' | 'list-failed', string>>}
 */
export const UNAVAILABLE_NOTES = Object.freeze({
    'ai-absent': 'AI history is not available — the AI package is not installed.',
    'no-fs': 'AI history is available when the studio runs from the Lerret CLI.',
    'list-failed': "Couldn't read the AI history for this project.",
});

/**
 * Status → §4.5 status label. Manifest statuses come from the snapshot
 * subsystem's enum (manifest.js ALLOWED_STATUSES); `applied-in-progress` is
 * the transient mid-turn state — it can appear if the panel is opened while a
 * turn runs, so it gets a calm label too.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_LABELS = Object.freeze({
    'applied-in-progress': 'In progress',
    applied: 'Applied',
    reverted: 'Reverted',
    'reverted-forward': 'Reverted forward',
    'stopped-mid-turn': 'Stopped mid-turn',
    error: 'Error',
});

/**
 * File op → §4.5 change-type label. Color is carried by data-op CSS, not here.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OP_LABELS = Object.freeze({
    create: 'created',
    edit: 'edited',
    delete: 'deleted',
});

/** The inline post-action cue (moss, 1500ms) — §4.5 confirmation behavior. */
const CUE_REVERTED = 'Reverted';
/** Redo's cue — same calm mechanic, accurate verb. */
const CUE_REDONE = 'Redone';
/** How long the cue stays visible. */
const CUE_MS = 1500;

/** Calm inline note when a revert/redo call fails — no danger styling. */
const ACTION_FAILED_NOTE = "Couldn't complete that action.";

/**
 * Format a manifest ISO timestamp for the timeline row (Stone, mono). Locale
 * display only — tests assert presence, not the exact string.
 *
 * @param {string} iso
 * @returns {string}
 */
export function formatTurnTimestamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} · ${time}`;
}

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('revert-timeline-styles')) {
    const s = document.createElement('style');
    s.id = 'revert-timeline-styles';
    s.textContent = `
.lm-revert-timeline-backdrop {
    position: fixed;
    inset: 0;
    z-index: 220;
    background: rgba(26, 23, 20, 0.45);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
}
.lm-revert-timeline {
    background: var(--lm-bg-primary, #FAF8F2);
    border-radius: var(--lm-radius-xl, 14px);
    box-shadow: var(--lm-shadow-popup, 0 18px 48px rgba(26, 23, 20, 0.22));
    width: min(720px, calc(100vw - 32px));
    height: min(600px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--lm-text-primary, #1A1714);
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
}
.lm-revert-timeline__header {
    display: flex;
    align-items: center;
    gap: var(--lm-space-3, 12px);
    padding: var(--lm-space-5, 20px) var(--lm-space-6, 24px) var(--lm-space-4, 16px);
    background: var(--lm-bg-secondary, #F2EEE6);
    flex-shrink: 0;
}
.lm-revert-timeline__title {
    flex: 1;
    font: 600 16px/1.2 var(--lm-font-sans, sans-serif);
    margin: 0;
}
.lm-revert-timeline__close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--lm-radius-sm, 6px);
    background: transparent;
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    transition: background var(--lm-duration-fast, 120ms);
    flex-shrink: 0;
}
.lm-revert-timeline__close:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-revert-timeline__close:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-revert-timeline__body {
    flex: 1;
    display: grid;
    grid-template-columns: 35% 1fr;
    gap: var(--lm-space-5, 20px);
    padding: var(--lm-space-5, 20px) var(--lm-space-6, 24px);
    min-height: 0;
}
.lm-revert-timeline__body[data-state="empty"],
.lm-revert-timeline__body[data-state="unavailable"],
.lm-revert-timeline__body[data-state="loading"] {
    display: flex;
    align-items: center;
    justify-content: center;
}
.lm-revert-timeline__note {
    font: 400 13px/1.5 var(--lm-font-sans);
    color: var(--lm-text-secondary, #44403A);
    text-align: center;
    max-width: 44ch;
    margin: 0;
}
.lm-revert-timeline__list {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-1, 4px);
    overflow-y: auto;
    min-height: 0;
    scrollbar-width: thin;
}
.lm-revert-timeline__row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: var(--lm-radius-sm, 6px);
    background: transparent;
    cursor: pointer;
    font-family: inherit;
}
.lm-revert-timeline__row[data-selected="true"] {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-revert-timeline__row:hover:not([data-selected="true"]) {
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-revert-timeline__row:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: -2px;
}
.lm-revert-timeline__row-prompt {
    font: 400 12px/1.35 var(--lm-font-sans);
    color: var(--lm-text-primary, #1A1714);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lm-revert-timeline__row-meta {
    display: flex;
    align-items: baseline;
    gap: var(--lm-space-2, 8px);
}
.lm-revert-timeline__row-time {
    font: 400 10.5px/1.2 var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--lm-stone, #6E6960);
    white-space: nowrap;
}
.lm-revert-timeline__row-status {
    font: 500 10.5px/1.2 var(--lm-font-sans);
    color: var(--lm-text-tertiary, #6E6960);
}
.lm-revert-timeline__row-status[data-status="applied"] { color: var(--lm-moss, #4A6B3F); }
.lm-revert-timeline__row-status[data-status="reverted"],
.lm-revert-timeline__row-status[data-status="reverted-forward"] { color: var(--lm-stone, #6E6960); }
.lm-revert-timeline__detail {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-4, 16px);
    border-left: 1px solid var(--lm-border, #D8D2C4);
    padding-left: var(--lm-space-5, 20px);
    overflow-y: auto;
    min-height: 0;
    scrollbar-width: thin;
}
.lm-revert-timeline__detail-prompt {
    font: 500 13px/1.45 var(--lm-font-sans);
    color: var(--lm-text-primary, #1A1714);
    margin: 0;
    overflow-wrap: break-word;
}
.lm-revert-timeline__detail-provenance {
    font: 400 11px/1.3 var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--lm-text-tertiary, #6E6960);
    margin: 0;
}
.lm-revert-timeline__files {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-1, 4px);
    flex: 1;
}
.lm-revert-timeline__file {
    display: flex;
    align-items: center;
    gap: var(--lm-space-2, 8px);
    padding: 5px 0;
}
.lm-revert-timeline__file-op {
    font: 500 10.5px/1.2 var(--lm-font-sans);
    width: 52px;
    flex-shrink: 0;
}
.lm-revert-timeline__file-op[data-op="create"] { color: var(--lm-moss, #4A6B3F); }
.lm-revert-timeline__file-op[data-op="edit"] { color: var(--lm-stone, #6E6960); }
.lm-revert-timeline__file-op[data-op="delete"] { color: var(--lm-error-text, #8A3A1F); }
.lm-revert-timeline__file-path {
    flex: 1;
    font: 400 12px/1.3 var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--lm-text-secondary, #44403A);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.lm-revert-timeline__btn {
    font-family: inherit;
    font-size: 12px;
    border-radius: var(--lm-radius-sm, 6px);
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background var(--lm-duration-fast, 120ms);
}
.lm-revert-timeline__btn:disabled {
    opacity: 0.5;
    cursor: default;
}
.lm-revert-timeline__btn[data-tier="secondary"] {
    background: var(--lm-bg-secondary, #F2EEE6);
    color: var(--lm-text-primary, #1A1714);
    border-color: var(--lm-border, #D8D2C4);
}
.lm-revert-timeline__btn[data-tier="secondary"]:hover:not(:disabled) {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-revert-timeline__btn[data-tier="ghost"] {
    background: transparent;
    color: var(--lm-text-tertiary, #6E6960);
    border-color: transparent;
    padding: 4px 10px;
}
.lm-revert-timeline__btn[data-tier="ghost"]:hover:not(:disabled) {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-revert-timeline__btn:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 2px;
}
.lm-revert-timeline__footer-actions {
    display: flex;
    align-items: center;
    gap: var(--lm-space-2, 8px);
    flex-wrap: wrap;
    padding-top: var(--lm-space-3, 12px);
    border-top: 1px solid var(--lm-border, #D8D2C4);
}
.lm-revert-timeline__cue-strip {
    flex-shrink: 0;
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: var(--lm-space-3, 12px);
    padding: 0 var(--lm-space-6, 24px) var(--lm-space-3, 12px);
}
.lm-revert-timeline__cue {
    font: 500 12px/1.2 var(--lm-font-sans);
    color: var(--lm-moss, #4A6B3F);
}
.lm-revert-timeline__action-note {
    font: 400 12px/1.2 var(--lm-font-sans);
    color: var(--lm-stone, #6E6960);
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * The §4.5 Revert Timeline Panel.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the panel is rendered.
 * @param {() => void} props.onClose - Esc / close button / backdrop click.
 * @param {string | null} [props.focusTurnId] - When opened from the dock's
 *   quick-revert or a thread card's revert action, the turn to preselect in
 *   the timeline. Null/omitted → the most recent turn is preselected.
 */
export function RevertTimelinePanel({ open, onClose, focusTurnId = null }) {
    // ── Data state ──────────────────────────────────────────────────────────
    // manifests: null = not loaded yet; [] = loaded, empty; array = display
    // order (most recent FIRST — listManifests sorts ascending, we reverse).
    const [manifests, setManifests] = React.useState(
        /** @type {Array<object> | null} */ (null),
    );
    const [unavailable, setUnavailable] = React.useState(
        /** @type {'ai-absent' | 'no-fs' | 'list-failed' | null} */ (null),
    );
    const [selectedId, setSelectedId] = React.useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = React.useState(false);
    const [cue, setCue] = React.useState(/** @type {string | null} */ (null));
    const [actionNote, setActionNote] = React.useState(/** @type {string | null} */ (null));
    // The resolved @lerret/ai module — kept in state so render-time gating
    // (canMutate) is synchronous. Null until the first load resolves.
    const [aiModule, setAiModule] = React.useState(/** @type {object | null} */ (null));

    const { folderId } = useAiContext();
    const dialogRef = React.useRef(null);
    const closeRef = React.useRef(null);
    const cueTimerRef = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const titleId = React.useId();

    // ── CLI filesystem binding (same derivation as the dock cluster) ────────
    const binding = React.useMemo(() => {
        if (!inCliMode()) return null;
        const projectRoot = deriveProjectRoot(folderId);
        if (!projectRoot) return null;
        return { projectRoot, fs: createCliAiFs({ projectRoot }) };
    }, [folderId]);

    // ── Manifest (re-)listing ────────────────────────────────────────────────
    // `isCancelled` lets the open-effect drop a late-resolving load after the
    // panel closed (or the binding changed) instead of repopulating stale
    // state; post-action re-lists run while the panel is open + busy, so they
    // use the default never-cancelled probe.
    const reload = React.useCallback(
        async (isCancelled = () => false) => {
            const ai = await getAi();
            if (isCancelled()) return;
            setAiModule(ai ?? null);
            if (!ai || typeof ai.snapshot?.listManifests !== 'function') {
                setUnavailable('ai-absent');
                setManifests(null);
                return;
            }
            if (!binding) {
                setUnavailable('no-fs');
                setManifests(null);
                return;
            }
            try {
                const list = await ai.snapshot.listManifests({
                    projectRoot: binding.projectRoot,
                    fs: binding.fs,
                });
                if (isCancelled()) return;
                // listManifests sorts oldest-first; §4.5 wants most recent at top.
                setUnavailable(null);
                setManifests([...list].reverse());
            } catch {
                if (isCancelled()) return;
                setUnavailable('list-failed');
                setManifests(null);
            }
        },
        [binding],
    );

    // Load on every open; reset everything on close so a re-open starts fresh
    // (and the focusTurnId preselect applies cleanly each time).
    React.useEffect(() => {
        if (!open) {
            setManifests(null);
            setUnavailable(null);
            setSelectedId(null);
            setCue(null);
            setActionNote(null);
            setBusy(false);
            return;
        }
        let cancelled = false;
        reload(() => cancelled);
        return () => {
            cancelled = true;
        };
    }, [open, reload]);

    // Selection: keep a still-present selection across re-lists; otherwise
    // preselect the focus turn (quick-revert / thread entry points) or the
    // most recent turn.
    React.useEffect(() => {
        if (!open || !manifests || manifests.length === 0) return;
        setSelectedId((prev) => {
            if (prev && manifests.some((m) => m.id === prev)) return prev;
            if (focusTurnId && manifests.some((m) => m.id === focusTurnId)) return focusTurnId;
            return manifests[0].id;
        });
    }, [open, manifests, focusTurnId]);

    // ── Esc + Tab-containment + focus restore (mirrors ollama-origins-guide) ─
    React.useEffect(() => {
        if (!open) return;
        const previouslyFocused =
            typeof document !== 'undefined' ? document.activeElement : null;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose?.();
                return;
            }
            if (e.key !== 'Tab') return;
            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusables = dialog.querySelectorAll(
                'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (e.shiftKey) {
                if (active === first || !dialog.contains(active)) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (active === last || !dialog.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                previouslyFocused.focus();
            }
        };
    }, [open, onClose]);

    // Auto-focus the close button on open (EditorSheet idiom).
    React.useEffect(() => {
        if (!open) return;
        const raf = requestAnimationFrame(() => {
            if (closeRef.current) closeRef.current.focus();
        });
        return () => cancelAnimationFrame(raf);
    }, [open]);

    // Clear the cue timer on unmount.
    React.useEffect(
        () => () => {
            if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
        },
        [],
    );

    // ── Post-action cue (moss, 1500ms) ──────────────────────────────────────
    const showCue = React.useCallback((text) => {
        setCue(text);
        if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
        cueTimerRef.current = setTimeout(() => setCue(null), CUE_MS);
    }, []);

    // ── Action runner — NO confirmation modal (§4.5): call straight through,
    // cue, then re-list so the flipped statuses render. ──────────────────────
    const runAction = React.useCallback(
        async (fn, cueText) => {
            if (busy) return;
            const ai = aiModule;
            if (!ai?.snapshot || !binding) return;
            if (typeof ai.snapshot.createSandbox !== 'function') return;
            setBusy(true);
            setActionNote(null);
            try {
                const sandbox = ai.snapshot.createSandbox({
                    projectRoot: binding.projectRoot,
                    fs: binding.fs,
                });
                await fn({
                    snapshot: ai.snapshot,
                    projectRoot: binding.projectRoot,
                    fs: binding.fs,
                    sandbox,
                });
                showCue(cueText);
                await reload();
            } catch {
                // Calm degrade — the snapshot store reports typed errors; the
                // panel never surfaces raw messages (no danger styling).
                setActionNote(ACTION_FAILED_NOTE);
            } finally {
                setBusy(false);
            }
        },
        [busy, aiModule, binding, showCue, reload],
    );

    const selected = manifests?.find((m) => m.id === selectedId) ?? null;

    const onRestoreFile = React.useCallback(
        (filePath) => {
            if (!selected) return;
            runAction(
                ({ snapshot, projectRoot, fs, sandbox }) =>
                    snapshot.revertFile({ projectRoot, fs, sandbox, turnId: selected.id, filePath }),
                CUE_REVERTED,
            );
        },
        [runAction, selected],
    );
    const onRevertTurn = React.useCallback(() => {
        if (!selected) return;
        runAction(
            ({ snapshot, projectRoot, fs, sandbox }) =>
                snapshot.revertTurn({ projectRoot, fs, sandbox, turnId: selected.id }),
            CUE_REVERTED,
        );
    }, [runAction, selected]);
    const onRevertToTurn = React.useCallback(() => {
        if (!selected) return;
        runAction(
            ({ snapshot, projectRoot, fs, sandbox }) =>
                snapshot.revertToTurn({ projectRoot, fs, sandbox, turnId: selected.id }),
            CUE_REVERTED,
        );
    }, [runAction, selected]);
    const onRedoTurn = React.useCallback(() => {
        if (!selected) return;
        runAction(
            ({ snapshot, projectRoot, fs, sandbox }) =>
                snapshot.redoTurn({ projectRoot, fs, sandbox, turnId: selected.id }),
            CUE_REDONE,
        );
    }, [runAction, selected]);

    if (!open) return null;

    // Read-only gating: when the timeline can render but mutations can't run
    // (the snapshot barrel lacks createSandbox — an older @lerret/ai), the
    // action buttons are simply not rendered. Listing-impossible cases never
    // reach here (they render the unavailable note instead).
    const canMutate = Boolean(
        binding && aiModule?.snapshot && typeof aiModule.snapshot.createSandbox === 'function',
    );
    // §4.5: Redo is enabled only when a revert has been performed — derived
    // from the selected manifest's status ('reverted' is the only status
    // redoTurn accepts; 'reverted-forward' means the redo already happened).
    const redoEnabled = canMutate && !busy && selected?.status === 'reverted';

    const bodyState = unavailable
        ? 'unavailable'
        : manifests === null
            ? 'loading'
            : manifests.length === 0
                ? 'empty'
                : 'ready';

    return ReactDOM.createPortal(
        <div
            className="lm-revert-timeline-backdrop"
            data-testid="revert-timeline-backdrop"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="lm-revert-timeline"
                data-testid="revert-timeline-panel"
            >
                <div className="lm-revert-timeline__header">
                    <h2 id={titleId} className="lm-revert-timeline__title">
                        Revert AI history
                    </h2>
                    <button
                        ref={closeRef}
                        type="button"
                        className="lm-revert-timeline__close"
                        aria-label="Close"
                        onClick={() => onClose?.()}
                        data-testid="revert-timeline-close"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 14 14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            aria-hidden="true"
                        >
                            <path d="M2 2l10 10M12 2L2 12" />
                        </svg>
                    </button>
                </div>

                <div className="lm-revert-timeline__body" data-state={bodyState}>
                    {bodyState === 'unavailable' && (
                        <p
                            className="lm-revert-timeline__note"
                            data-testid="revert-timeline-unavailable"
                        >
                            {UNAVAILABLE_NOTES[unavailable]}
                        </p>
                    )}
                    {bodyState === 'empty' && (
                        <p className="lm-revert-timeline__note" data-testid="revert-timeline-empty">
                            {EMPTY_STATE_TEXT}
                        </p>
                    )}
                    {bodyState === 'ready' && (
                        <React.Fragment>
                            {/* LEFT — the vertical timeline, most recent first. */}
                            <div
                                className="lm-revert-timeline__list"
                                role="listbox"
                                aria-label="AI turns"
                            >
                                {manifests.map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        role="option"
                                        aria-selected={m.id === selectedId}
                                        className="lm-revert-timeline__row"
                                        data-selected={m.id === selectedId}
                                        data-turn-id={m.id}
                                        data-testid="revert-timeline-row"
                                        onClick={() => setSelectedId(m.id)}
                                    >
                                        <span className="lm-revert-timeline__row-prompt">
                                            {m.prompt}
                                        </span>
                                        <span className="lm-revert-timeline__row-meta">
                                            <span className="lm-revert-timeline__row-time">
                                                {formatTurnTimestamp(m.timestamp)}
                                            </span>
                                            <span
                                                className="lm-revert-timeline__row-status"
                                                data-status={m.status}
                                            >
                                                {STATUS_LABELS[m.status] ?? m.status}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                            </div>

                            {/* RIGHT — the selected turn's detail. */}
                            <div className="lm-revert-timeline__detail">
                                {!selected ? (
                                    <p className="lm-revert-timeline__note">
                                        Select a turn to see its files.
                                    </p>
                                ) : (
                                    <React.Fragment>
                                        <div>
                                            <p
                                                className="lm-revert-timeline__detail-prompt"
                                                data-testid="revert-timeline-detail-prompt"
                                            >
                                                {selected.prompt}
                                            </p>
                                            <p
                                                className="lm-revert-timeline__detail-provenance"
                                                data-testid="revert-timeline-detail-provenance"
                                            >
                                                {selected.model} ·{' '}
                                                {PROVIDER_LABELS[selected.provider] ?? selected.provider}
                                            </p>
                                        </div>
                                        <div className="lm-revert-timeline__files" role="list">
                                            {selected.files.length === 0 ? (
                                                <p className="lm-revert-timeline__note" style={{ textAlign: 'left' }}>
                                                    No files changed in this turn.
                                                </p>
                                            ) : (
                                                selected.files.map((f) => (
                                                    <div
                                                        key={f.path}
                                                        role="listitem"
                                                        className="lm-revert-timeline__file"
                                                        data-testid="revert-timeline-file"
                                                        data-path={f.path}
                                                    >
                                                        <span
                                                            className="lm-revert-timeline__file-op"
                                                            data-op={f.op}
                                                        >
                                                            {OP_LABELS[f.op] ?? f.op}
                                                        </span>
                                                        <span className="lm-revert-timeline__file-path">
                                                            {f.path}
                                                        </span>
                                                        {canMutate && (
                                                            <button
                                                                type="button"
                                                                className="lm-revert-timeline__btn"
                                                                data-tier="ghost"
                                                                disabled={busy}
                                                                onClick={() => onRestoreFile(f.path)}
                                                                data-testid="revert-timeline-restore"
                                                            >
                                                                Restore
                                                            </button>
                                                        )}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                        {canMutate && (
                                            <div className="lm-revert-timeline__footer-actions">
                                                <button
                                                    type="button"
                                                    className="lm-revert-timeline__btn"
                                                    data-tier="secondary"
                                                    disabled={busy}
                                                    onClick={onRevertTurn}
                                                    data-testid="revert-timeline-revert-turn"
                                                >
                                                    Revert this turn
                                                </button>
                                                <button
                                                    type="button"
                                                    className="lm-revert-timeline__btn"
                                                    data-tier="secondary"
                                                    disabled={busy}
                                                    onClick={onRevertToTurn}
                                                    data-testid="revert-timeline-revert-before"
                                                >
                                                    Revert to before this turn
                                                </button>
                                                <button
                                                    type="button"
                                                    className="lm-revert-timeline__btn"
                                                    data-tier="secondary"
                                                    disabled={!redoEnabled}
                                                    onClick={onRedoTurn}
                                                    data-testid="revert-timeline-redo"
                                                >
                                                    Redo
                                                </button>
                                            </div>
                                        )}
                                    </React.Fragment>
                                )}
                            </div>
                        </React.Fragment>
                    )}
                </div>

                {/* The §4.5 inline cue strip — always mounted so the aria-live
                    region announces the post-action cue; text toggles. */}
                <div className="lm-revert-timeline__cue-strip">
                    <span
                        className="lm-revert-timeline__cue"
                        role="status"
                        aria-live="polite"
                        data-testid="revert-timeline-cue"
                    >
                        {cue ?? ''}
                    </span>
                    {actionNote && (
                        <span
                            className="lm-revert-timeline__action-note"
                            role="status"
                            data-testid="revert-timeline-action-note"
                        >
                            {actionNote}
                        </span>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
