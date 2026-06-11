/**
 * ai-input-cluster.jsx — the dock-mounted AI input cluster (Story 8.2,
 * UX-delta §4.1). The single place a user starts every AI turn (FR50).
 *
 * It renders, visually left → right:
 *   [Ask/Inspect toggle] [selection chip?] [ text input ] [ attach ] [ status pill | stop button? ] [ chevron ]
 *
 * (DOM order puts the input FIRST, then the chip, then the mode toggle —
 * AC-15's tab order starts at the input — with CSS `order` keeping the toggle
 * at the visual left edge (order -2) and the chip beside it (order -1). The
 * status pill is permanently mounted so its aria-live region announces every
 * in-flight state; the stop button appears BESIDE it while a turn runs, per
 * spec §4.1's [ status pill | stop button ] layout.)
 *
 * Story 8.7 adds the vision surfaces: the image-attach affordance (reactive
 * disabled-with-reason), the submit-side vision gate (State A inline note +
 * 1500ms "Vision unavailable" pill flash; State B one-off cloud-fallback
 * prompt), and the mid-turn `onVisionDecision` mirror passed into runTurn.
 * Story 8.9 adds the Ask/Inspect mode toggle: inspect turns route read-only
 * (mode passed to runTurn), render the ANSWER as the thread-card body — with
 * detected file paths actionable (AC-9: click scopes the next prompt to the
 * file and closes the thread) — and carry no revert affordance (nothing to
 * revert — no manifest).
 *
 * and, on expand, a session-scoped thread overlay (an EditorSheet variant). The
 * cluster owns:
 *   - the turn-state status-pill state machine (idle → thinking → reading →
 *     writing → done / stopped / error, + transient "stopping"),
 *   - the AbortController + global-Esc cancel while a turn runs (one action
 *     per keypress: while running, Esc cancels the turn ONLY — the thread-
 *     collapse Esc applies only when no turn is running),
 *   - the 4-second quick-revert affordance after done / stopped,
 *   - the first-run SetupScreen + cloud PrivacyDisclosure gating (consuming
 *     Story 8.1's components),
 *   - the in-memory, session-scoped thread history (never persisted).
 *
 * ── Dynamic-import boundary (non-negotiable) ────────────────────────────────
 * This file reaches @lerret/ai ONLY via `await getAi()` from ./lazy.js. It
 * NEVER `import`s '@lerret/ai'. The no-static-imports CI check (Story 8.0)
 * fails the whole workspace if it does. The best-effort selection → JSX mapping
 * uses a SEPARATE lazy import of `@babel/parser` (a @lerret/studio dependency,
 * not @lerret/ai) — also lazy, kept out of the main bundle, and guarded so a
 * missing parser degrades to the file basename.
 *
 * ── getAi() can return null ─────────────────────────────────────────────────
 * When @lerret/ai is not installed, getAi() resolves to null and the cluster
 * renders an idle-only fallback (AC-11/12) — it never throws.
 *
 * ── Calm voice ──────────────────────────────────────────────────────────────
 * Placeholder / pill / outcome copy is factual: no exclamation marks, no
 * celebration. The only motion is a 220ms pill color transition + chevron
 * rotation + the quick-revert fade, all gated behind prefers-reduced-motion.
 */

import React from 'react';

import { getAi } from './lazy.js';
import { useAiContext } from './ai-context.jsx';
import { useSelectionScope, fileScope } from './selection-scope-context.jsx';
import { SetupScreen } from './setup-screen.jsx';
import { PrivacyDisclosure } from './privacy-disclosure.jsx';
import { EditorSheet } from '../components/editors/editor-sheet.jsx';
import { ModeToggle, useInspectMode, MODE_INSPECT } from './mode-toggle.jsx';
import { VisionAttachButton } from './vision-attach-button.jsx';
import { VisionFallbackPrompt } from './vision-fallback-prompt.jsx';
import { useVisionGate, VISION_PILL_LABEL } from './use-vision-gate.js';

// ─── Tokens / copy ────────────────────────────────────────────────────────────

const PLACEHOLDER_FULL = 'Ask Lerret to design or edit…';
const PLACEHOLDER_NARROW = 'Ask Lerret…';
const PLACEHOLDER_ABSENT = 'AI not installed';
const ABSENT_NOTE = 'Run npm install @lerret/ai to enable AI features';
/**
 * Calm inline note when staged images are dropped because the submit resolved
 * to a deterministic generation workflow (Story 8.8 W2/W3) — those turns make
 * zero provider calls and ignore attachments, so the image can never ride.
 */
const WORKFLOW_IMAGE_NOTE = 'Image ignored — kit generation runs without vision.';

/** Narrow-window breakpoint — mirrors the setup-screen's 880px and §4.1's ~860. */
const NARROW_BP = 860;

/** Cloud providers gate on the one-time privacy disclosure; Ollama is local. */
const CLOUD_PROVIDERS = Object.freeze(new Set(['openai', 'anthropic', 'openrouter']));

/**
 * The bare specifier for @babel/parser, stored in a variable so the dynamic
 * `import()` call site receives a non-literal — Vite then defers resolution to
 * runtime and does NOT fail the build when the (optional, best-effort) parser
 * is absent. NOTE this is deliberately different from lazy.js's literal
 * `import('@lerret/ai')`: @lerret/ai is always present at build time (so the
 * literal form code-splits a real chunk), whereas @babel/parser is genuinely
 * not installed in this workspace.
 *
 * @type {string}
 */
const BABEL_PARSER_SPECIFIER = '@babel/parser';

/**
 * Pill descriptors per status. Colors are sourced from --lm-* tokens with the
 * literal fallbacks UX-delta §4.1 specifies (Mist / amber / moss / stone / warm
 * error). Only `idle | done | stopped | error` carry a fixed background; the
 * in-flight states use the same neutral chrome so the pill reads as one calm
 * surface that only changes text + a 220ms color tween.
 *
 * @type {Record<string, { label: string, color: string, bg: string }>}
 */
const PILL_STATES = Object.freeze({
    idle: { label: 'Idle', color: 'var(--lm-text-tertiary, #6E6960)', bg: 'var(--lm-mist, #B8B3A8)' },
    thinking: { label: 'Thinking…', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-warning, #C98A3C)' },
    reading: { label: 'Reading…', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-warning, #C98A3C)' },
    writing: { label: 'Writing files…', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-warning, #C98A3C)' },
    stopping: { label: 'Stopping…', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-stone, #6E6960)' },
    done: { label: 'Done', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-moss, #4A6B3F)' },
    stopped: { label: 'Stopped', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-stone, #6E6960)' },
    error: { label: 'Error — see thread', color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-error, #B4503C)' },
    // Story 8.7 State A: a 1500ms transient flash while the gate's inline note
    // explains why the vision turn did not run (Stone — calm, not an error).
    'vision-unavailable': { label: VISION_PILL_LABEL, color: 'var(--lm-text-onAccent, #FAF8F2)', bg: 'var(--lm-stone, #6E6960)' },
});

/** Terminal-label dwell (ms) before the pill fades to idle (AC-7/8). */
const TERMINAL_DWELL_MS = 1500;
/** Quick-revert affordance window (ms) after done / stopped (AC-7/8). */
const REVERT_WINDOW_MS = 4000;

// ─── Reduced-motion hook ──────────────────────────────────────────────────────

/**
 * Read `prefers-reduced-motion: reduce` reactively. jsdom does not implement
 * matchMedia; tests stub `window.matchMedia` with a vi.fn(), so this hook reads
 * the stub safely and defaults to "no reduction" when matchMedia is absent.
 *
 * @returns {boolean} True when the user prefers reduced motion.
 */
function useReducedMotion() {
    const get = () => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
        } catch {
            return false;
        }
    };
    const [reduced, setReduced] = React.useState(get);
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        let mql;
        try {
            mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        } catch {
            return undefined;
        }
        const onChange = () => setReduced(get());
        // addEventListener is the modern API; some stubs only have it.
        if (typeof mql.addEventListener === 'function') {
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        }
        return undefined;
    }, []);
    return reduced;
}

// ─── Narrow-window hook ───────────────────────────────────────────────────────

/**
 * True when the viewport is at/below the narrow breakpoint — the placeholder
 * truncates to "Ask Lerret…" (AC-2). Defaults to false (full placeholder) when
 * there is no window or innerWidth is unknown.
 *
 * @returns {boolean}
 */
function useNarrowWindow() {
    const get = () => {
        if (typeof window === 'undefined' || typeof window.innerWidth !== 'number') return false;
        return window.innerWidth <= NARROW_BP;
    };
    const [narrow, setNarrow] = React.useState(get);
    React.useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onResize = () => setNarrow(get());
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    return narrow;
}

// ─── Scoped styles ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('ai-input-cluster-styles')) {
    const s = document.createElement('style');
    s.id = 'ai-input-cluster-styles';
    s.textContent = `
.lm-ai-cluster {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
    font-family: var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif);
}
.lm-ai-cluster__field {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-border-light, #E8E2D4);
    border-radius: 10px;
    padding: 4px 6px 4px 8px;
    transition: border-color var(--lm-duration-fast, 120ms);
}
.lm-ai-cluster__field[data-focused="true"] {
    border-color: var(--lm-accent, #B85B33);
    box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}
.lm-ai-cluster__field[data-absent="true"] {
    background: var(--lm-bg-secondary, #F2EEE6);
    border-color: var(--lm-border-light, #E8E2D4);
}
.lm-ai-cluster__input {
    border: none;
    background: transparent;
    outline: none;
    font: 400 13px/1.3 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-primary, #1A1714);
    width: 220px;
    min-width: 80px;
    padding: 4px 2px;
}
.lm-ai-cluster__input::placeholder {
    color: var(--lm-text-tertiary, #9A958C);
}
.lm-ai-cluster__input:disabled {
    color: var(--lm-text-tertiary, #6E6960);
    cursor: default;
}
@media (max-width: ${NARROW_BP}px) {
    .lm-ai-cluster__input { width: 130px; }
}
.lm-ai-cluster__chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--lm-bg-primary, #FAF8F2);
    border: 1px solid var(--lm-accent, #B85B33);
    border-radius: 999px;
    padding: 2px 4px 2px 8px;
    max-width: 160px;
    /* The chip FOLLOWS the input in the DOM (AC-15 tab order: input → chip ×)
       but stays at the field's visual left edge via flex order. */
    order: -1;
}
/* The Ask/Inspect mode toggle sits at the field's visual LEFT edge (before the
   chip), while following the input + chip in the DOM (tab order: input → chip
   → toggle). */
.lm-ai-cluster__field .lm-ai-mode-toggle {
    order: -2;
}
.lm-ai-cluster__chip-label {
    font: 400 11px/1.2 var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
    color: var(--lm-text-secondary, #44403A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.lm-ai-cluster__chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--lm-text-tertiary, #6E6960);
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
}
.lm-ai-cluster__chip-x:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
    color: var(--lm-text-primary, #1A1714);
}
.lm-ai-cluster__chip-x:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 1px;
}
.lm-ai-cluster__pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 3px 9px;
    font: 500 11px/1.2 var(--lm-font-sans, -apple-system, sans-serif);
    white-space: nowrap;
    flex-shrink: 0;
}
.lm-ai-cluster__pill[data-motion="animate"] {
    transition: background-color 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)),
        color 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
.lm-ai-cluster__stop,
.lm-ai-cluster__chevron,
.lm-ai-cluster__revert {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--lm-text-secondary, #44403A);
    border-radius: 6px;
    flex-shrink: 0;
}
.lm-ai-cluster__stop {
    width: 24px;
    height: 24px;
}
.lm-ai-cluster__stop:hover,
.lm-ai-cluster__chevron:hover,
.lm-ai-cluster__revert:hover {
    background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-ai-cluster__stop:focus-visible,
.lm-ai-cluster__chevron:focus-visible,
.lm-ai-cluster__revert:focus-visible {
    outline: 2px solid var(--lm-accent, #B85B33);
    outline-offset: 1px;
}
.lm-ai-cluster__revert {
    font: 500 11px/1.2 var(--lm-font-sans, -apple-system, sans-serif);
    padding: 3px 9px;
    color: var(--lm-accent, #B85B33);
}
.lm-ai-cluster__chevron {
    width: 22px;
    height: 22px;
}
.lm-ai-cluster__chevron svg {
    transition: transform 220ms var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
.lm-ai-cluster__chevron[data-motion="instant"] svg {
    transition: none;
}
.lm-ai-cluster__chevron[data-expanded="true"] svg {
    transform: rotate(180deg);
}
.lm-ai-cluster__absent-note {
    font: 400 11px/1.4 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-tertiary, #6E6960);
    white-space: nowrap;
}
/* Thread overlay cards */
.lm-ai-thread {
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-3, 12px);
}
.lm-ai-thread__empty {
    font: 400 13px/1.5 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-tertiary, #6E6960);
}
.lm-ai-thread__card {
    border: 1px solid var(--lm-border-light, #E8E2D4);
    border-radius: var(--lm-radius-md, 8px);
    padding: var(--lm-space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--lm-space-2, 8px);
    background: var(--lm-bg-secondary, #F2EEE6);
}
.lm-ai-thread__prompt {
    font: 400 13px/1.4 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-primary, #1A1714);
    margin: 0;
}
.lm-ai-thread__outcome {
    font: 400 12px/1.45 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-text-secondary, #44403A);
    margin: 0;
}
.lm-ai-thread__actions {
    display: flex;
    gap: var(--lm-space-3, 12px);
    flex-wrap: wrap;
    margin-top: var(--lm-space-1, 4px);
}
.lm-ai-thread__action {
    font: 500 11px/1.2 var(--lm-font-sans, -apple-system, sans-serif);
    color: var(--lm-accent, #B85B33);
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 0;
}
.lm-ai-thread__action:hover { text-decoration: underline; }
.lm-ai-thread__action:disabled {
    color: var(--lm-text-tertiary, #9A958C);
    cursor: default;
    text-decoration: none;
}
    `.trim();
    document.head.appendChild(s);
}

// ─── Outcome-summary derivation (FR57 — never raw transcript) ─────────────────

/**
 * Derive a one/two-line turn-outcome summary from the turn's `files` payload —
 * the ONLY thing the thread is allowed to render (FR57 / UX-delta Anti-goal
 * #3). Never derived from agent transcripts or intermediate node output.
 *
 * For a STOPPED turn the files are the writes observed during the run (the
 * `stopped` event itself carries none) — an in-flight write may have completed
 * before the stop took effect (NFR18), so the summary must reflect what was
 * actually written, never claim "nothing changed" unconditionally.
 *
 * @param {Array<{ path: string, op: 'create'|'edit'|'delete' }>} files
 * @param {string} status - 'done' | 'stopped' | 'error'
 * @returns {string}
 */
export function summarizeOutcome(files, status) {
    const list = Array.isArray(files) ? files : [];
    const base = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
    if (status === 'error') return 'The turn ended with an error.';
    if (status === 'stopped') {
        if (list.length === 0) return 'Stopped — no files changed.';
        if (list.length === 1) return `Stopped after writing ${base(list[0].path)}`;
        return `Stopped after writing ${list.length} files`;
    }
    if (list.length === 0) return 'No files changed.';
    const creates = list.filter((f) => f.op === 'create');
    const edits = list.filter((f) => f.op === 'edit');
    const deletes = list.filter((f) => f.op === 'delete');
    const parts = [];
    const phrase = (verb, arr) => {
        if (arr.length === 0) return;
        if (arr.length === 1) parts.push(`${verb} ${base(arr[0].path)}`);
        else parts.push(`${verb} ${arr.length} files`);
    };
    phrase('Created', creates);
    phrase('Edited', edits);
    phrase('Deleted', deletes);
    return parts.join(' · ');
}

// ─── Chip label resolution (best-effort @babel/parser) ────────────────────────

/**
 * Test-only seam: override the lazy `@babel/parser` import with a stub loader.
 * `@babel/parser` is NOT installed in this workspace, so the success path of
 * {@link resolveChipLabel} is unreachable in tests without this hook. Pass
 * `null` to restore the real dynamic import. Production code MUST NOT call it.
 *
 * @type {(() => Promise<{ parse: Function }>) | null}
 */
let babelParserLoader = null;
export function _setBabelParserLoader(loader) {
    babelParserLoader = loader;
}

/**
 * Best-effort: resolve a richer chip label for a single-file selection by
 * lazily importing `@babel/parser` and reading the exported component's name
 * out of the parsed JSX. On any failure — parser absent, malformed JSX, no
 * source available — fall back to the file basename (the prompt is then
 * implicitly file-scoped), per the spec's degrade-gracefully contract
 * (architecture §Risks).
 *
 * HONESTY NOTE (v1): this is the spec's best-effort hook, and it is currently
 * UNWIRED in production. The canvas emits `fileScope(path)` directly
 * (project-canvas.jsx) because the project model does not expose a component
 * asset's source text to the canvas (only markdown entries carry `text`), and
 * `@babel/parser` is not installed as a @lerret/studio dependency — so
 * basename chip labels ARE the v1 behavior. The function stays exported (and
 * pinned by tests via {@link _setBabelParserLoader}) so a future story that
 * surfaces asset source can wire label refinement without re-deriving the
 * AST walk.
 *
 * @param {string} filePath
 * @param {string} [source] - The file's source text, when the canvas can supply it.
 * @returns {Promise<string>} The resolved label (component name or basename).
 */
export async function resolveChipLabel(filePath, source) {
    const basename = String(filePath).split('/').filter(Boolean).pop() || String(filePath);
    if (!source || typeof source !== 'string') return basename;
    try {
        // Route the specifier through a variable so Vite defers resolution to
        // runtime and does NOT fail the build when @babel/parser is not
        // installed. (Unlike @lerret/ai in lazy.js — always present at build
        // time — the parser is genuinely absent from this workspace, so the
        // variable-specifier escape hatch is required here.) The parser is a
        // best-effort enhancement; a missing parser degrades to the basename.
        const specifier = BABEL_PARSER_SPECIFIER;
        const parser = babelParserLoader
            ? await babelParserLoader()
            : await import(/* @vite-ignore */ specifier);
        const parse = parser.parse || parser.default?.parse;
        if (typeof parse !== 'function') return basename;
        const ast = parse(source, {
            sourceType: 'module',
            plugins: ['jsx'],
        });
        // Walk the top-level body for an exported component declaration name.
        const body = ast?.program?.body ?? [];
        for (const node of body) {
            if (node.type === 'ExportDefaultDeclaration') {
                const decl = node.declaration;
                if (decl?.id?.name) return decl.id.name;
            }
            if (node.type === 'ExportNamedDeclaration' && node.declaration) {
                const decl = node.declaration;
                if (decl.type === 'FunctionDeclaration' && decl.id?.name) return decl.id.name;
                if (decl.type === 'VariableDeclaration' && decl.declarations?.[0]?.id?.name) {
                    return decl.declarations[0].id.name;
                }
            }
        }
        return basename;
    } catch {
        // Parser absent or malformed JSX → basename (best-effort contract).
        return basename;
    }
}

// ─── Deferred-promise helper (suspend → gate → resume/discard) ────────────────

/**
 * Create a deferred-promise handle for the first-run / disclosure gating. The
 * submit handler awaits `promise`; the gating overlays call `resolve()` to
 * resume the turn or `reject()` to discard it.
 *
 * @returns {{ promise: Promise<void>, resolve: () => void, reject: (reason?: unknown) => void }}
 */
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// ─── Status pill ──────────────────────────────────────────────────────────────

/**
 * The calm status pill. Reports its state via aria-live="polite" so screen
 * readers hear the turn progress. The 220ms color tween is gated behind
 * prefers-reduced-motion (instant fallback).
 *
 * @param {object} props
 * @param {string} props.status - One of PILL_STATES keys.
 * @param {boolean} props.reducedMotion
 */
function StatusPill({ status, reducedMotion }) {
    const desc = PILL_STATES[status] || PILL_STATES.idle;
    const isIdle = status === 'idle';
    return (
        <span
            className="lm-ai-cluster__pill"
            data-testid="ai-status-pill"
            data-status={status}
            data-motion={reducedMotion ? 'instant' : 'animate'}
            role="status"
            aria-live="polite"
            style={{
                background: desc.bg,
                color: desc.color,
                // The idle pill is a small dot-like swatch with no label text
                // (UX-delta §4.1: Mist, no animation). Non-idle states show the label.
                ...(isIdle ? { width: 10, height: 10, padding: 0 } : null),
            }}
        >
            {isIdle ? '' : desc.label}
        </span>
    );
}

// ─── Selection chip ───────────────────────────────────────────────────────────

/**
 * The selection chip at the input's VISUAL left edge (CSS `order: -1`; in the
 * DOM it follows the input so AC-15's tab order is input → chip ×). Shows the
 * scope label; the × clears the scope (also Delete / Backspace while the chip
 * is focused). The × is in Tab order between the input and the stop button.
 *
 * @param {object} props
 * @param {import('./selection-scope-context.jsx').SelectionScope} props.scope
 * @param {() => void} props.onClear
 */
function SelectionChip({ scope, onClear }) {
    const onChipKeyDown = (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onClear();
        }
    };
    return (
        <span
            className="lm-ai-cluster__chip"
            data-testid="ai-selection-chip"
            data-kind={scope.kind}
        >
            <span className="lm-ai-cluster__chip-label" title={scope.label}>
                {scope.label}
            </span>
            <button
                type="button"
                className="lm-ai-cluster__chip-x"
                data-testid="ai-selection-chip-clear"
                aria-label="Clear selection scope"
                onClick={onClear}
                onKeyDown={onChipKeyDown}
            >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 2l6 6M8 2L2 8" />
                </svg>
            </button>
        </span>
    );
}

// ─── Inspect-answer path linking (Story 8.9, AC-9) ────────────────────────────

/**
 * Detect project-relative file paths in an inspector answer (word-bounded,
 * optionally `.lerret/`-prefixed, known asset/document extensions). Used with
 * String#split — the single capture group lands matched paths at ODD indices,
 * plain text at even ones.
 *
 * @type {RegExp}
 */
const ANSWER_PATH_RE = /((?:\.lerret\/)?[\w@/-]+\.(?:jsx|json|md|css|svg)\b)/g;

/**
 * Render an inspect answer with detected file paths as inline actions
 * (Story 8.9 AC-9): clicking a path scopes the next prompt to that file
 * (`setScope(fileScope(path))`) and closes the thread. Non-path text renders
 * as plain React-escaped text — never dangerouslySetInnerHTML.
 *
 * @param {object} props
 * @param {string} props.answer
 * @param {(path: string) => void} props.onOpenPath
 */
function InspectAnswer({ answer, onOpenPath }) {
    const parts = String(answer ?? '').split(ANSWER_PATH_RE);
    return (
        <p className="lm-ai-thread__outcome" data-testid="ai-thread-outcome">
            {parts.map((part, i) =>
                i % 2 === 1 ? (
                    <button
                        key={`path-${i}`}
                        type="button"
                        className="lm-ai-thread__action"
                        data-testid="ai-thread-path"
                        title={`Scope the next prompt to ${part}`}
                        onClick={() => onOpenPath(part)}
                    >
                        {part}
                    </button>
                ) : (
                    <React.Fragment key={`text-${i}`}>{part}</React.Fragment>
                ),
            )}
        </p>
    );
}

// ─── Thread overlay ───────────────────────────────────────────────────────────

/**
 * Session-scoped thread overlay (an EditorSheet variant). Renders turns in
 * reverse-chronological order as cards: prompt + outcome summary + a secondary
 * actions row. NEVER renders raw transcripts (FR57) — only the summary derived
 * from the terminal event's `files` payload. Inspect-card answers render via
 * {@link InspectAnswer} so detected file paths are actionable (AC-9).
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {Array<{ id: string, prompt: string, status: string, files: Array<object>, outcome: string, turnId: string|null, error: { class: string, message: string }|null }>} props.turns
 * @param {(turn: object) => void} props.onRevertTurn
 * @param {(turn: object) => void} props.onViewFiles
 * @param {(turn: object) => void} props.onOpenTimeline
 * @param {(path: string) => void} props.onOpenPath - Inspect-answer path click:
 *   scope the next prompt to the file and close the thread (AC-9).
 * @param {boolean} props.revertAvailable
 */
function ThreadOverlay({ open, onClose, turns, onRevertTurn, onViewFiles, onOpenTimeline, onOpenPath, revertAvailable }) {
    // Reverse-chronological: newest turn first.
    const ordered = React.useMemo(() => [...turns].reverse(), [turns]);
    return (
        <EditorSheet open={open} onClose={onClose} title="AI thread">
            <div className="lm-ai-thread" data-testid="ai-thread">
                {ordered.length === 0 ? (
                    <p className="lm-ai-thread__empty" data-testid="ai-thread-empty">
                        No turns yet. Ask Lerret to design or edit to start one.
                    </p>
                ) : (
                    ordered.map((turn) => {
                        // Inspect turns (Story 8.9): the card body is the
                        // inspector's ANSWER; there is no manifest, so the
                        // revert/files actions do not apply — `Revert this
                        // turn` renders disabled ("Nothing to revert"), the
                        // file-scoped actions are omitted.
                        const isInspect = turn.mode === 'inspect';
                        return (
                            <div
                                className="lm-ai-thread__card"
                                data-testid="ai-thread-card"
                                data-mode={isInspect ? 'inspect' : 'ask'}
                                key={turn.id}
                            >
                                <p className="lm-ai-thread__prompt">{turn.prompt}</p>
                                {isInspect ? (
                                    <InspectAnswer answer={turn.outcome} onOpenPath={onOpenPath} />
                                ) : (
                                    <p className="lm-ai-thread__outcome" data-testid="ai-thread-outcome">
                                        {turn.outcome}
                                    </p>
                                )}
                                <div className="lm-ai-thread__actions">
                                    <button
                                        type="button"
                                        className="lm-ai-thread__action"
                                        onClick={() => onRevertTurn(turn)}
                                        disabled={isInspect || !revertAvailable}
                                        title={
                                            isInspect
                                                ? 'Nothing to revert'
                                                : revertAvailable
                                                  ? undefined
                                                  : 'Revert timeline not available'
                                        }
                                    >
                                        Revert this turn
                                    </button>
                                    {!isInspect && (
                                        <button
                                            type="button"
                                            className="lm-ai-thread__action"
                                            onClick={() => onViewFiles(turn)}
                                        >
                                            View files
                                        </button>
                                    )}
                                    {!isInspect && (
                                        <button
                                            type="button"
                                            className="lm-ai-thread__action"
                                            onClick={() => onOpenTimeline(turn)}
                                            disabled={!revertAvailable}
                                            title={revertAvailable ? undefined : 'Revert timeline not available'}
                                        >
                                            Open revert timeline
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </EditorSheet>
    );
}

// ─── Main cluster ─────────────────────────────────────────────────────────────

/**
 * The dock AI input cluster.
 *
 * @param {object} props
 * @param {(turnId: string | null) => void} [props.onOpenRevertTimeline] - Opens
 *   the Story 8.5 revert-timeline panel on the given turn. When omitted, the
 *   revert affordances are gated off (the panel is not present in the tree).
 */
export function AiInputCluster({ onOpenRevertTimeline }) {
    const aiCtx = useAiContext();
    const { scope, clearScope, setScope } = useSelectionScope();
    const reducedMotion = useReducedMotion();
    const narrow = useNarrowWindow();
    const inputId = React.useId();
    // Ask/Inspect mode (Story 8.9). Toggle is disabled while a turn runs, so
    // the mode is stable for the duration of a run.
    const { mode, setMode, placeholder: inspectPlaceholder } = useInspectMode();

    // ── AI presence (getAi() null → idle-only fallback, AC-11/12) ───────────
    // undefined = not yet resolved, true = present, false = absent.
    const [aiPresent, setAiPresent] = React.useState(/** @type {boolean | undefined} */ (undefined));
    React.useEffect(() => {
        let cancelled = false;
        (async () => {
            const ai = await getAi();
            if (!cancelled) setAiPresent(Boolean(ai));
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // ── Local UI state ──────────────────────────────────────────────────────
    const [text, setText] = React.useState('');
    const [focused, setFocused] = React.useState(false);
    const [absentNoteVisible, setAbsentNoteVisible] = React.useState(false);
    const [status, setStatus] = React.useState('idle'); // PILL_STATES key
    const [running, setRunning] = React.useState(false);
    const [revertVisible, setRevertVisible] = React.useState(false);
    const [lastTurnId, setLastTurnId] = React.useState(/** @type {string | null} */ (null));
    const [threadOpen, setThreadOpen] = React.useState(false);
    const [turns, setTurns] = React.useState(/** @type {Array<object>} */ ([]));

    // ── Gating overlay state (first-run setup + cloud disclosure) ───────────
    const [setupOpen, setSetupOpen] = React.useState(false);
    const [discloseFor, setDiscloseFor] = React.useState(/** @type {string | null} */ (null));
    // The deferred for the in-flight gate; resolve → resume, reject → discard.
    const gateRef = React.useRef(/** @type {ReturnType<typeof createDeferred> | null} */ (null));

    // ── Vision state (Story 8.7) ────────────────────────────────────────────
    // Image attachments staged by the attach button for the NEXT submit.
    const [pendingAttachments, setPendingAttachments] = React.useState(
        /** @type {Array<object>} */ ([]),
    );
    // Non-null while the State B one-off fallback prompt is open (the eligible
    // cloud handles to offer). The prompt resolves the vision deferred.
    const [visionPromptProviders, setVisionPromptProviders] = React.useState(
        /** @type {Array<object> | null} */ (null),
    );
    // Calm inline note when a deterministic workflow submit dropped staged
    // images (Story 8.8: W2/W3 turns ignore attachments). Cleared on the next
    // accepted submission.
    const [workflowNote, setWorkflowNote] = React.useState(/** @type {string | null} */ (null));
    const visionDeferredRef = React.useRef(
        /** @type {{ promise: Promise<object>, resolve: (v: object) => void, reject: (e?: unknown) => void } | null} */ (null),
    );
    /**
     * Host-side prompt machinery for the vision gate: render the fallback
     * prompt for the given eligible providers and resolve with the user's
     * choice — `{ accept: true, handle }` or `{ accept: false }`. Serves BOTH
     * the submit-side State B path and the mid-turn `onVisionDecision` mirror.
     */
    const requestVisionPrompt = React.useCallback((eligibleProviders) => {
        // Settle any prior pending decision as a decline BEFORE replacing it —
        // a deferred must never be orphaned (its awaiting closure would hang
        // forever and could later resume into a clobbered world).
        visionDeferredRef.current?.resolve({ accept: false });
        const d = createDeferred();
        visionDeferredRef.current = d;
        setVisionPromptProviders(eligibleProviders);
        return d.promise;
    }, []);
    const visionGate = useVisionGate({ requestDecision: requestVisionPrompt });
    const onVisionAccept = React.useCallback((handle) => {
        setVisionPromptProviders(null);
        visionDeferredRef.current?.resolve({ accept: true, handle });
        visionDeferredRef.current = null;
    }, []);
    const onVisionCancel = React.useCallback(() => {
        setVisionPromptProviders(null);
        visionDeferredRef.current?.resolve({ accept: false });
        visionDeferredRef.current = null;
        // AC-14: focus returns to the dock input on cancel.
        inputRef.current?.focus();
    }, []);

    // ── Refs ────────────────────────────────────────────────────────────────
    const inputRef = React.useRef(null);
    const controllerRef = React.useRef(/** @type {AbortController | null} */ (null));
    const terminalTimerRef = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const revertTimerRef = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
    const mountedRef = React.useRef(true);
    // Mirrors `threadOpen` so timer callbacks read the value AT FIRE TIME —
    // the 1500ms terminal-dwell refocus must not steal focus from a thread the
    // user opened after the timer was armed (stale-closure guard).
    const threadOpenRef = React.useRef(false);
    React.useEffect(() => {
        threadOpenRef.current = threadOpen;
    }, [threadOpen]);

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            // Abort any in-flight turn and clear timers on unmount.
            controllerRef.current?.abort();
            if (terminalTimerRef.current) clearTimeout(terminalTimerRef.current);
            if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
            // Release a suspended submit if a setup/disclosure gate is still
            // open at unmount — otherwise its deferred never settles and the
            // awaiting submit closure leaks. The rejection is swallowed by the
            // submit handler's catch (gate-discard path).
            const gate = gateRef.current;
            gateRef.current = null;
            gate?.reject(new Error('GateUnmounted'));
            // Same for a vision fallback prompt left open at unmount: settle it
            // as a decline so the awaiting submit/onVisionDecision releases.
            const vision = visionDeferredRef.current;
            visionDeferredRef.current = null;
            vision?.resolve({ accept: false });
        };
    }, []);

    const clearTerminalTimers = React.useCallback(() => {
        if (terminalTimerRef.current) {
            clearTimeout(terminalTimerRef.current);
            terminalTimerRef.current = null;
        }
        if (revertTimerRef.current) {
            clearTimeout(revertTimerRef.current);
            revertTimerRef.current = null;
        }
    }, []);

    // ── Stop semantics (stop button + global Esc while running) ─────────────
    const requestStop = React.useCallback(() => {
        if (!controllerRef.current) return;
        // The pill keeps moving: Writing files… → Stopping… → Stopped. The
        // in-flight write finishes per NFR18, so we show the transient
        // "stopping" until the orchestrator's `stopped` event arrives.
        setStatus('stopping');
        controllerRef.current.abort();
    }, []);

    // Global Esc: registered ONLY while a turn runs. One action per keypress:
    // while a turn runs, Esc cancels the turn ONLY — the open thread must NOT
    // also collapse on the same keypress. The listener is capture-phase on
    // window (it fires before the EditorSheet's document-level handler) and
    // stops the event so the thread-collapse Esc applies only when no turn is
    // running.
    //
    // When a MID-TURN vision prompt is open (the planner is blocked awaiting
    // the decision), Esc answers the PROMPT first — settle it as a decline and
    // do NOT stop the turn on the same keypress; a second Esc then stops.
    // Calling requestStop while the planner awaits the decision would leave
    // the prompt unreachable and the pill wedged on "Stopping…".
    React.useEffect(() => {
        if (!running) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (visionDeferredRef.current) {
                    onVisionCancel();
                    return;
                }
                requestStop();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [running, requestStop, onVisionCancel]);

    // ── Terminal handling: dwell on label, then idle + 4s revert window ─────
    const finishTurn = React.useCallback(
        (terminalStatus, files, prompt, turnId, errorInfo, extra = {}) => {
            setStatus(terminalStatus);
            setRunning(false);
            controllerRef.current = null;

            // Append the turn to the in-memory, session-scoped thread (FR57:
            // only the prompt + outcome summary derived from `files`, plus —
            // for an errored turn — the orchestrator's {class, message} so the
            // thread card has a factual one-liner instead of an empty card).
            // An INSPECT turn's card body is the inspector's ANSWER (the
            // `inspector-response` payload — the user-facing outcome of FR58),
            // never a file summary and never raw agent internals.
            const isInspect = extra.mode === MODE_INSPECT;
            const summary =
                terminalStatus === 'error' && errorInfo && errorInfo.message
                    ? `${errorInfo.class || 'Error'}: ${errorInfo.message}`
                    : isInspect
                      ? (extra.answer || 'No answer.')
                      : summarizeOutcome(files, terminalStatus);
            const record = {
                id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                prompt,
                status: terminalStatus,
                mode: isInspect ? MODE_INSPECT : 'ask',
                answer: isInspect ? (extra.answer ?? '') : null,
                files: Array.isArray(files) ? files : [],
                outcome: summary,
                turnId: turnId ?? null,
                error: terminalStatus === 'error' ? (errorInfo ?? null) : null,
            };
            setTurns((prev) => [...prev, record]);

            if (terminalStatus === 'error') {
                // Keep the error label until the user opens the thread / submits
                // again. No revert window, no auto-idle.
                return;
            }

            // done / stopped: show the terminal label for 1500ms, then idle.
            // The 4s quick-revert affordance only arms when there is a turn
            // manifest to revert TO — inspect turns carry no turnId (no
            // manifest, nothing to revert; AC group C of Story 8.9).
            const revertible = record.turnId != null;
            setLastTurnId(record.turnId);
            if (revertible) setRevertVisible(true);
            clearTerminalTimers();
            terminalTimerRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                setStatus('idle');
                terminalTimerRef.current = null;
                // Re-focus the input for the next turn — unless the thread is
                // open AT FIRE TIME (read via ref: the user may have opened it
                // during the dwell, and focus must not be stolen from it).
                if (!threadOpenRef.current && inputRef.current) inputRef.current.focus();
            }, TERMINAL_DWELL_MS);
            revertTimerRef.current = setTimeout(() => {
                if (!mountedRef.current) return;
                setRevertVisible(false);
                revertTimerRef.current = null;
            }, REVERT_WINDOW_MS);
        },
        [clearTerminalTimers],
    );

    // ── Drive a turn against the orchestrator (after gating passes) ─────────
    const driveTurn = React.useCallback(
        async (ai, prompt, opts = {}) => {
            const controller = new AbortController();
            controllerRef.current = controller;
            setRunning(true);
            setStatus('thinking');
            setRevertVisible(false);
            clearTerminalTimers();

            // The turn scope: the selection scope (persisted across turns) folds
            // into the runTurn call; project-wide when no chip is set.
            const turnScope = scope
                ? { kind: scope.kind, filePath: scope.filePath, count: scope.count }
                : { kind: 'project' };
            const turnMode = opts.mode === MODE_INSPECT ? MODE_INSPECT : 'ask';

            let terminalSeen = false;
            let turnId = null;
            // The inspector's answer (Story 8.9) — arrives via the
            // `inspector-response` event, always before `done`.
            let inspectAnswer = '';
            // Files observed via writing/deleting events DURING the run. The
            // `stopped` event carries no files, but an in-flight write may
            // have completed before the stop took effect (NFR18) — so the
            // stopped summary + record derive from this list, never from a
            // blanket "nothing changed" claim. De-duplicated by path.
            /** @type {Array<{ path: string, op: 'edit' | 'delete' }>} */
            const seenFiles = [];
            const seenPaths = new Set();
            const recordSeenFile = (path, op) => {
                if (!path || seenPaths.has(path)) return;
                seenPaths.add(path);
                seenFiles.push({ path, op });
            };
            try {
                for await (const ev of ai.runTurn({
                    prompt,
                    scope: turnScope,
                    mode: turnMode,
                    signal: controller.signal,
                    ...(Array.isArray(opts.attachments) && opts.attachments.length > 0
                        ? { attachments: opts.attachments }
                        : null),
                    ...(opts.providerOverride ? { providerOverride: opts.providerOverride } : null),
                    ...(typeof opts.onVisionDecision === 'function'
                        ? { onVisionDecision: opts.onVisionDecision }
                        : null),
                })) {
                    if (!mountedRef.current) break;
                    switch (ev.type) {
                        case 'thinking':
                            setStatus((s) => (s === 'stopping' ? s : 'thinking'));
                            break;
                        case 'reading':
                            setStatus((s) => (s === 'stopping' ? s : 'reading'));
                            break;
                        case 'writing':
                        case 'deleting':
                            // Create-vs-edit is not distinguishable from the
                            // in-flight event stream; 'edit' is the
                            // conservative op (the stopped summary counts
                            // paths and never branches on op).
                            recordSeenFile(ev.file, ev.type === 'deleting' ? 'delete' : 'edit');
                            setStatus((s) => (s === 'stopping' ? s : 'writing'));
                            break;
                        case 'tool-call':
                        case 'mkdir':
                            // All file-mutation progress folds into "Writing files…".
                            setStatus((s) => (s === 'stopping' ? s : 'writing'));
                            break;
                        case 'inspector-response':
                            // Story 8.9: the read-only answer (FR58). Always
                            // arrives before `done`; the thread card renders it
                            // as the body for inspect turns.
                            inspectAnswer = typeof ev.answer === 'string' ? ev.answer : '';
                            break;
                        case 'done':
                            terminalSeen = true;
                            if (ev.turnId) turnId = ev.turnId;
                            finishTurn('done', ev.files, prompt, ev.turnId ?? turnId, null, {
                                mode: turnMode,
                                answer: inspectAnswer,
                            });
                            break;
                        case 'stopped':
                            terminalSeen = true;
                            // No files on the event → fall back to the writes
                            // observed during the run (NFR18).
                            finishTurn('stopped', ev.files ?? seenFiles, prompt, ev.turnId ?? turnId, null, {
                                mode: turnMode,
                                answer: inspectAnswer,
                            });
                            break;
                        case 'error':
                            terminalSeen = true;
                            finishTurn('error', [], prompt, null, ev.error ?? null, { mode: turnMode });
                            break;
                        default:
                            // needs-vision-fallback ignored here (Story 8.7's
                            // surface).
                            break;
                    }
                    // A terminal event ends the turn. The orchestrator closes
                    // the stream after one, but the cluster must not rely on
                    // that — stop consuming defensively. (Breaking triggers
                    // the iterable's .return(); the orchestrator's finally
                    // finalizes + cleans up on that path.)
                    if (terminalSeen) break;
                }
                if (!terminalSeen && mountedRef.current) {
                    // The iterable completed without a terminal event — treat as
                    // a clean (empty) done so the pill never freezes.
                    finishTurn('done', [], prompt, turnId, null, {
                        mode: turnMode,
                        answer: inspectAnswer,
                    });
                }
            } catch (err) {
                if (mountedRef.current) {
                    finishTurn(
                        'error',
                        [],
                        prompt,
                        null,
                        {
                            class: (err && typeof err === 'object' && err.name) || 'Error',
                            message:
                                (err && typeof err === 'object' && err.message) || String(err),
                        },
                        { mode: turnMode },
                    );
                }
            } finally {
                if (controllerRef.current === controller) controllerRef.current = null;
                if (mountedRef.current) setRunning(false);
                // A vision prompt must never outlive its turn: settle any
                // still-open mid-turn decision as a decline and close the
                // prompt UI (the orchestrator side already ended).
                const vision = visionDeferredRef.current;
                if (vision) {
                    visionDeferredRef.current = null;
                    vision.resolve({ accept: false });
                    if (mountedRef.current) setVisionPromptProviders(null);
                }
            }
        },
        [scope, finishTurn, clearTerminalTimers],
    );

    // ── Gating: first-run setup + cloud disclosure (consumes Story 8.1) ─────
    /**
     * Resolve the gate for the given provider, opening the setup screen when no
     * provider is configured, or the privacy disclosure when a cloud provider
     * is configured but unacked. Returns the provider name to run against, or
     * throws to discard the turn (Esc / Skip).
     *
     * @param {object} ai
     * @returns {Promise<string>} The active provider name to run the turn with.
     */
    const passGate = React.useCallback(
        async (ai) => {
            // 1. Is any provider configured for this folder? Prefer the vault
            //    (authoritative); fall back to the context snapshot.
            let configs = aiCtx.providerConfigs;
            try {
                if (ai?.vault?.listProviderConfigs && aiCtx.folderId) {
                    configs = await ai.vault.listProviderConfigs({ folderId: aiCtx.folderId });
                }
            } catch {
                configs = aiCtx.providerConfigs;
            }
            if (!configs || configs.length === 0) {
                // First-run: suspend the turn, open the setup screen. onCommit
                // resolves the gate; onSkip / Esc rejects it (turn discarded).
                const gate = createDeferred();
                gateRef.current = gate;
                setSetupOpen(true);
                await gate.promise; // resolves on onCommit
                // After commit, the active provider is configured; re-read it.
                const after = await getActiveProviderName(ai, aiCtx);
                return after;
            }

            // 2. A provider is configured — resolve the active one.
            const activeName = await getActiveProviderName(ai, aiCtx);

            // 3. Cloud provider whose disclosure is not acked for this
            //    (folderId, providerName) → open the disclosure first.
            if (activeName && CLOUD_PROVIDERS.has(activeName)) {
                let acked = aiCtx.isDisclosureAcked(activeName);
                try {
                    if (ai?.vault?.isDisclosureAcked && aiCtx.folderId) {
                        acked = await ai.vault.isDisclosureAcked({
                            folderId: aiCtx.folderId,
                            providerName: activeName,
                        });
                    }
                } catch {
                    acked = aiCtx.isDisclosureAcked(activeName);
                }
                if (!acked) {
                    const gate = createDeferred();
                    gateRef.current = gate;
                    setDiscloseFor(activeName);
                    await gate.promise; // resolves on onAck; rejects on Esc/onCancel
                }
            }
            return activeName;
        },
        [aiCtx],
    );

    // ── Submit handler ──────────────────────────────────────────────────────
    const submit = React.useCallback(async () => {
        const prompt = text.trim();
        if (!prompt || running) return;
        // A vision decision is pending (the State B prompt is open; `running`
        // is false and the input is enabled while it waits) — the prompt must
        // be answered first. This keypress consumes NOTHING: a second Enter
        // must never start a concurrent turn or steal the pending submission.
        if (visionDeferredRef.current) return;

        const ai = await getAi();
        if (!ai) {
            // AI absent — idle-only fallback already rendered; surface the note.
            setAbsentNoteVisible(true);
            return;
        }

        // Clear the input immediately so the user can see the turn take it.
        setText('');
        // A fresh submission clears the previous workflow note (the State A
        // note clears via the gate's own evaluate / clearStateA below).
        setWorkflowNote(null);

        try {
            await passGate(ai);
        } catch {
            // Gate discarded (Skip / Esc) — do not run the turn. Restore nothing
            // (the input was cleared; the prompt is dropped by design).
            return;
        }

        // ── Vision gate (Story 8.7, FR56) — submit-side, after the provider
        // gates pass. Inspect turns never carry attachments toward the model
        // (the inspector is text-only), so the gate applies to ask mode only.
        let attachments = [];
        let providerOverride;
        if (mode === MODE_INSPECT) {
            // Inspect submits leave staged attachments STAGED — they apply to
            // the NEXT ask turn, never silently consumed by a text-only turn —
            // and clear any stale State A note so the inspect submit reads
            // fresh.
            visionGate.clearStateA();
        } else {
            // Recognized deterministic workflow turns (Story 8.8 W2 launch-kit
            // / W3 social-variants) make ZERO provider calls and ignore
            // attachments — the vision gate must not block them (State A) or
            // charge consent (State B) for a turn that never sends an image.
            const shape = ai.workflows?.recognizeWorkflow?.(prompt);
            if (shape?.kind === 'launch-kit' || shape?.kind === 'social-variants') {
                visionGate.clearStateA();
                if (pendingAttachments.length > 0) {
                    // Staged images cannot ride a deterministic kit turn —
                    // drop them with a calm note instead of gating the submit.
                    setPendingAttachments([]);
                    setWorkflowNote(WORKFLOW_IMAGE_NOTE);
                }
            } else {
                attachments = pendingAttachments;
                setPendingAttachments([]);
                const decision = await visionGate.evaluate({ prompt, attachments });
                if (decision.action === 'blocked-state-a') {
                    // State A: the submission is consumed — the hook armed the
                    // inline note + the 1500ms pill flash (AC-9: no modal).
                    return;
                }
                if (decision.action === 'prompt') {
                    // State B: one-off cloud fallback. Accept routes JUST this
                    // turn through the override (no makeActive, never
                    // remembered).
                    const res = await requestVisionPrompt(decision.eligibleProviders);
                    if (!res || res.accept !== true) return; // AC-14: discard
                    // Re-check before resuming: the world may have moved while
                    // the prompt was open — never resume into a second
                    // concurrent turn (the controller ref is the live truth).
                    if (running || controllerRef.current) return;
                    providerOverride = res.handle?.providerName ?? res.handle?.name;
                }
            }
        }

        await driveTurn(ai, prompt, {
            mode,
            attachments,
            providerOverride,
            onVisionDecision: visionGate.onVisionDecision,
        });
    }, [text, running, passGate, driveTurn, mode, pendingAttachments, visionGate, requestVisionPrompt]);

    const onInputKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    // ── Gating overlay callbacks ────────────────────────────────────────────
    const resolveGate = React.useCallback(() => {
        const gate = gateRef.current;
        gateRef.current = null;
        gate?.resolve();
    }, []);
    const discardGate = React.useCallback(() => {
        const gate = gateRef.current;
        gateRef.current = null;
        gate?.reject(new Error('GateDiscarded'));
    }, []);

    const onSetupCommit = React.useCallback(() => {
        setSetupOpen(false);
        resolveGate();
    }, [resolveGate]);
    const onSetupSkip = React.useCallback(() => {
        setSetupOpen(false);
        discardGate();
    }, [discardGate]);
    const onSetupClose = React.useCallback(() => {
        // Close without commit == discard (Esc / backdrop). If a commit already
        // resolved the gate, gateRef is null and this is a no-op reject.
        setSetupOpen(false);
        discardGate();
    }, [discardGate]);

    const onDiscloseAck = React.useCallback(() => {
        setDiscloseFor(null);
        resolveGate();
    }, [resolveGate]);
    const onDiscloseCancel = React.useCallback(() => {
        setDiscloseFor(null);
        discardGate();
    }, [discardGate]);
    // "Switch to Ollama" on the cloud disclosure: never silently discard the
    // suspended turn. When an Ollama provider config exists for this folder,
    // make it active and RESUME the turn against it (runTurn re-resolves the
    // active provider from the vault at turn start; Ollama is local, so no
    // disclosure gate applies). When Ollama is NOT configured, the turn cannot
    // run — discard it and open the setup screen so the user can configure
    // Ollama. (SetupScreen has no initial-provider preselection prop, so it
    // opens plainly.)
    const onDiscloseSwitchToOllama = React.useCallback(async () => {
        setDiscloseFor(null);
        // Prefer the vault (authoritative) for "is Ollama configured here?";
        // fall back to the context snapshot.
        let configs = aiCtx.providerConfigs ?? [];
        try {
            const ai = await getAi();
            if (ai?.vault?.listProviderConfigs && aiCtx.folderId) {
                configs = await ai.vault.listProviderConfigs({ folderId: aiCtx.folderId });
            }
        } catch {
            configs = aiCtx.providerConfigs ?? [];
        }
        const hasOllama = configs.some((c) => c?.providerName === 'ollama');
        if (hasOllama) {
            try {
                await aiCtx.makeActive('ollama');
            } catch {
                // Activation failure → calm degrade: the turn still resumes
                // against whatever provider is active.
            }
            resolveGate();
            return;
        }
        discardGate();
        setSetupOpen(true);
    }, [aiCtx, resolveGate, discardGate]);

    // ── Quick-revert + thread revert wiring (Story 8.5 panel, gated) ────────
    const revertAvailable = typeof onOpenRevertTimeline === 'function';
    const onQuickRevert = React.useCallback(() => {
        if (!revertAvailable) return;
        onOpenRevertTimeline(lastTurnId);
    }, [revertAvailable, onOpenRevertTimeline, lastTurnId]);
    const onThreadRevert = React.useCallback(
        (turn) => {
            if (!revertAvailable) return;
            onOpenRevertTimeline(turn.turnId);
        },
        [revertAvailable, onOpenRevertTimeline],
    );
    const onThreadViewFiles = React.useCallback(() => {
        // View files opens the same revert timeline scoped to the turn's files
        // (Story 8.5 UI); when the panel is absent this is a no-op.
        // Intentionally minimal — the thread card lists the outcome already.
    }, []);
    // Inspect answers (Story 8.9 AC-9): clicking a detected file path scopes
    // the next prompt to that file and closes the thread.
    const onThreadPathOpen = React.useCallback(
        (path) => {
            setScope(fileScope(path));
            setThreadOpen(false);
        },
        [setScope],
    );

    // ── Thread expand/collapse + Esc-collapse (when no turn runs) ───────────
    const toggleThread = React.useCallback(() => {
        setThreadOpen((o) => !o);
    }, []);
    const closeThread = React.useCallback(() => setThreadOpen(false), []);

    // ── Chevron click ───────────────────────────────────────────────────────
    const onAbsentInputActivate = React.useCallback(() => {
        if (aiPresent === false) setAbsentNoteVisible(true);
    }, [aiPresent]);

    // ─── Render: AI-absent idle-only fallback (AC-11/12) ────────────────────
    if (aiPresent === false) {
        return (
            <span className="lm-ai-cluster" data-tour="dock-ai" data-ai-absent="true">
                {/* The input is disabled, so it cannot receive clicks itself —
                    the calm-note activation lives on the field wrapper, which
                    still catches a click over the disabled input. */}
                <span
                    className="lm-ai-cluster__field"
                    data-absent="true"
                    data-testid="ai-absent-field"
                    onClick={onAbsentInputActivate}
                >
                    <input
                        ref={inputRef}
                        id={inputId}
                        className="lm-ai-cluster__input"
                        type="text"
                        value=""
                        readOnly
                        disabled
                        placeholder={PLACEHOLDER_ABSENT}
                        aria-label="AI input (not installed)"
                        data-testid="ai-input"
                    />
                    {/* The mode toggle stays visible-but-inert in the AI-absent
                        chrome (calm: no affordance disappears, none invites). */}
                    <ModeToggle value="ask" disabled />
                </span>
                {absentNoteVisible && (
                    <span className="lm-ai-cluster__absent-note" data-testid="ai-absent-note">
                        {ABSENT_NOTE}
                    </span>
                )}
            </span>
        );
    }

    // ─── Render: live cluster (AI present, or not-yet-resolved) ─────────────
    // Inspect mode swaps the placeholder (Story 8.9 AC-2); the narrow-window
    // truncation applies to ask mode only.
    const placeholder = inspectPlaceholder ?? (narrow ? PLACEHOLDER_NARROW : PLACEHOLDER_FULL);
    // Story 8.7 State A: flash `Vision unavailable` over an idle pill while the
    // inline note explains; in-flight/terminal states always win.
    const pillStatus = visionGate.pillFlash && status === 'idle' ? 'vision-unavailable' : status;

    return (
        <span className="lm-ai-cluster" data-tour="dock-ai">
            <span className="lm-ai-cluster__field" data-focused={focused ? 'true' : 'false'}>
                {/* State B one-off vision-fallback prompt (Story 8.7) — renders
                    inline-near-dock, self-positioned above the field. */}
                {visionPromptProviders && (
                    <VisionFallbackPrompt
                        eligibleProviders={visionPromptProviders}
                        onAccept={onVisionAccept}
                        onCancel={onVisionCancel}
                    />
                )}
                {/* DOM order: input FIRST, chip second, mode toggle third —
                    AC-15's tab order starts at the input. CSS `order` keeps
                    the toggle at the visual left edge (-2) and the chip beside
                    it (-1). */}
                <input
                    ref={inputRef}
                    id={inputId}
                    className="lm-ai-cluster__input"
                    type="text"
                    value={text}
                    disabled={running}
                    placeholder={placeholder}
                    aria-label="Ask Lerret to design or edit"
                    data-testid="ai-input"
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                />
                {scope && <SelectionChip scope={scope} onClear={clearScope} />}
                {/* Ask/Inspect mode toggle (Story 8.9). Disabled while a turn
                    runs AND while a submit is suspended at any gate (setup /
                    disclosure / vision prompt) — the suspended submission
                    captured its mode, so the visible toggle must not diverge
                    from what will actually run. */}
                <ModeToggle
                    value={mode}
                    onChange={setMode}
                    disabled={
                        running || setupOpen || Boolean(discloseFor) || Boolean(visionPromptProviders)
                    }
                />

                {/* Image-attach affordance (Story 8.7) — reactive
                    disabled-with-reason when the active model lacks vision. */}
                <VisionAttachButton
                    onAttach={(items) => setPendingAttachments((prev) => [...prev, ...items])}
                />

                {/* [ status pill | stop button ] — spec §4.1. The pill is
                    PERMANENTLY mounted (its aria-live region announces every
                    in-flight state: Thinking… / Reading… / Writing files… /
                    Stopping…, AC-6); the stop button sits beside it while a
                    turn runs (AC-5). */}
                <StatusPill status={pillStatus} reducedMotion={reducedMotion} />
                {running && (
                    <button
                        type="button"
                        className="lm-ai-cluster__stop"
                        data-testid="ai-stop"
                        aria-label="Stop AI turn"
                        onClick={requestStop}
                    >
                        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                            <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" fill="currentColor" />
                        </svg>
                    </button>
                )}

                {/* Quick-revert affordance (4s window after done/stopped). Gated
                    behind the Story 8.5 timeline panel availability. */}
                {revertVisible && revertAvailable && (
                    <button
                        type="button"
                        className="lm-ai-cluster__revert"
                        data-testid="ai-quick-revert"
                        onClick={onQuickRevert}
                    >
                        Revert
                    </button>
                )}

                {/* Chevron — expand-to-thread. */}
                <button
                    type="button"
                    className="lm-ai-cluster__chevron"
                    data-testid="ai-thread-chevron"
                    data-expanded={threadOpen ? 'true' : 'false'}
                    data-motion={reducedMotion ? 'instant' : 'animate'}
                    aria-expanded={threadOpen}
                    aria-label={threadOpen ? 'Collapse AI thread' : 'Expand AI thread'}
                    onClick={toggleThread}
                >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor"
                        strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                        <path d="M2 4l3.5 3.5L9 4" />
                    </svg>
                </button>
            </span>

            {/* Story 8.7 State A inline note: vision required, no cloud
                provider can serve a fallback — calm guidance, no modal. The
                same span carries the Story 8.8 workflow note (staged images
                dropped — kit turns run without vision); State A wins when
                both are armed. */}
            {(visionGate.stateANote || workflowNote) && (
                <span className="lm-ai-cluster__absent-note" data-testid="ai-vision-note">
                    {visionGate.stateANote || workflowNote}
                </span>
            )}

            {/* Thread overlay */}
            <ThreadOverlay
                open={threadOpen}
                onClose={closeThread}
                turns={turns}
                onRevertTurn={onThreadRevert}
                onViewFiles={onThreadViewFiles}
                onOpenTimeline={onThreadRevert}
                onOpenPath={onThreadPathOpen}
                revertAvailable={revertAvailable}
            />

            {/* First-run setup gating (consumes Story 8.1 SetupScreen). */}
            {setupOpen && (
                <SetupScreen
                    open={setupOpen}
                    onClose={onSetupClose}
                    onCommit={onSetupCommit}
                    onSkip={onSetupSkip}
                />
            )}

            {/* Cloud privacy-disclosure gating (consumes Story 8.1). */}
            {discloseFor && (
                <PrivacyDisclosure
                    open={Boolean(discloseFor)}
                    providerName={discloseFor}
                    onAck={onDiscloseAck}
                    onCancel={onDiscloseCancel}
                    onSwitchToOllama={onDiscloseSwitchToOllama}
                />
            )}
        </span>
    );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the active provider name, preferring the vault (authoritative) and
 * falling back to the context's activeProvider snapshot.
 *
 * @param {object} ai
 * @param {import('./ai-context.jsx').AiContextValue} aiCtx
 * @returns {Promise<string | null>}
 */
async function getActiveProviderName(ai, aiCtx) {
    try {
        if (ai?.vault?.listProviderConfigs && aiCtx.folderId) {
            const configs = await ai.vault.listProviderConfigs({ folderId: aiCtx.folderId });
            const active = configs.find((c) => c.active);
            if (active) return active.providerName;
        }
    } catch {
        // fall through to context snapshot
    }
    return aiCtx.activeProvider ?? null;
}

export default AiInputCluster;

