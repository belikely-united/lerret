// markdown-editor.jsx — Markdown asset editor: raw input + live preview.
//
// Opens inside an EditorSheet. Shows a raw-Markdown textarea on
// the left alongside a live preview rendered by the same react-markdown
// used in MarkdownAssetCard.
//
// ── Write model ─────────────────────────────────────────────────────────────
// Writes are debounced (400 ms after the last keystroke) so we don't hammer the
// disk on every character. A blur on the textarea triggers an immediate write as
// a safety net. Both paths use `writeProjectFile` from `write-client.js`.
//
// Because writes happen as the user types (not on an explicit "Save" button),
// dismissing the sheet (Esc / backdrop / close) never loses committed work.
//
// ── Failed-write UX ─────────────────────────────────────────────────────────
// A failed write shows a calm inline guidance message that includes the file
// path (NFR9, NFR8). The prior file content is left intact by the server's
// atomic temp-rename. The editor remains fully usable for a retry.
//
// ── Reduced-motion ───────────────────────────────────────────────────────────
// The preview pane update is instant (no fade) when `prefers-reduced-motion:
// reduce` matches (UX-DR18, NFR14). The EditorSheet already handles its own
// motion. The opening affordance ('s kebab) honors the same media
// query via the shared menu / kebab styles.
//
// ── Props ────────────────────────────────────────────────────────────────────
// open {boolean} Whether the editor is visible.
// onClose {() => void} Called when the sheet should close.
// entry {AssetEntry} The markdown entry from the runtime.
// Needs `entry.asset.path` (the .md LerretPath)
// and `entry.asset.name` / `entry.label` for
// the sheet title.
// initialText {string} The raw markdown source (from `entry.text`).
// writer {Function} [test] Override for writeProjectFile.
// onTextChange {Function} [test] Fired on every text state change.

import React from 'react';
import ReactMarkdown from 'react-markdown';

import { EditorSheet } from './editor-sheet.jsx';
import { writeProjectFile } from '../../runtime/write-client.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Debounce delay (ms) between the last keystroke and the disk write. */
const WRITE_DEBOUNCE_MS = 400;

// ── Reduced-motion helper ─────────────────────────────────────────────────────

function prefersReducedMotion() {
 if (typeof window === 'undefined') return false;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ── CSS injection (scoped, no global pollution) ───────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('markdown-editor-styles')) {
 const s = document.createElement('style');
 s.id = 'markdown-editor-styles';
 s.textContent = `
.lm-md-editor {
 display: flex;
 gap: var(--lm-space-4, 16px);
 min-height: 360px;
 /* Fill the EditorSheet body but never overflow it. */
 overflow: hidden;
}

/* ── Left pane: raw textarea ─────────────────────────────────────── */
.lm-md-editor__input-pane {
 flex: 1;
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-2, 8px);
 min-width: 0;
}
.lm-md-editor__pane-label {
 font: var(--lm-weight-semibold, 600) var(--lm-size-hint, 10px)/1 var(--lm-font-sans, sans-serif);
 letter-spacing: var(--lm-tracking-caps, 0.5px);
 text-transform: uppercase;
 color: var(--lm-text-tertiary, #6E6960);
 user-select: none;
}
.lm-md-editor__textarea {
 flex: 1;
 width: 100%;
 min-height: 320px;
 box-sizing: border-box;
 padding: var(--lm-space-3, 12px);
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, "Cascadia Code", monospace);
 font-size: var(--lm-size-body, 13px);
 line-height: var(--lm-lh-body, 1.45);
 color: var(--lm-text-primary, #1A1714);
 background: var(--lm-bg-primary, #FAF8F2);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 outline: none;
 resize: vertical;
 transition: border-color var(--lm-duration-fast, 120ms) var(--lm-ease);
}
.lm-md-editor__textarea:focus {
 border-color: var(--lm-accent, #B85B33);
 box-shadow: var(--lm-focus-ring);
}

/* ── Right pane: live preview ─────────────────────────────────────── */
.lm-md-editor__preview-pane {
 flex: 1;
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-2, 8px);
 min-width: 0;
 overflow: hidden;
}
.lm-md-editor__preview-scroll {
 flex: 1;
 overflow-y: auto;
 overflow-x: hidden;
 background: var(--lm-bg-secondary, #F2EEE6);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 padding: var(--lm-space-3, 12px) var(--lm-space-4, 16px);
 scrollbar-width: thin;
 scrollbar-color: var(--lm-border, #DDD7CA) transparent;

 /* Preview transitions: fade when motion is allowed, instant otherwise. */
 transition: opacity var(--lm-duration-fast, 120ms) var(--lm-ease);
}
.lm-md-editor__preview-scroll[data-reduced-motion] {
 transition: none !important;
}

/* ── Path / file metadata row ───────────────────────────────────────── */
.lm-md-editor__path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 letter-spacing: 0.04em;
 margin: 0 0 var(--lm-space-2, 8px);
 word-break: break-all;
}

/* ── Footer: error banner + saved indicator ──────────────────────── */
.lm-md-editor__error-banner {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 background: var(--lm-bg-tertiary, #E8E2D4);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-primary, #1A1714);
 line-height: var(--lm-lh-body, 1.45);
}
.lm-md-editor__saved {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-tertiary, #6E6960);
 opacity: 0;
 transition: opacity var(--lm-duration-base, 220ms) var(--lm-ease);
}
.lm-md-editor__saved[data-visible] { opacity: 1; }
.lm-md-editor__saved-dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-success, #4A6B3F);
}

/* Reduced-motion overrides */
@media (prefers-reduced-motion: reduce) {
 .lm-md-editor__textarea { transition: none !important; }
 .lm-md-editor__preview-scroll { transition: none !important; }
 .lm-md-editor__saved { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── MarkdownEditor ─────────────────────────────────────────────────────────────

/**
 * In-studio Markdown asset editor (FR26, FR34, NFR9, NFR14,
 * UX-DR8, UX-DR18).
 *
 * Renders inside an {@link EditorSheet}. Provides a split-pane UI:
 * - left: a raw-Markdown textarea for authoring
 * - right: a live preview rendered by react-markdown (the same library used
 * in {@link MarkdownAssetCard} so the preview fidelity is identical)
 *
 * Writes are debounced ({@link WRITE_DEBOUNCE_MS} ms) and committed
 * immediately on textarea blur so in-progress edits survive sheet dismissal.
 *
 * @param {object} props
 * @param {boolean} props.open Whether the sheet is open.
 * @param {() => void} props.onClose Called when the sheet should close.
 * @param {object} props.entry AssetEntry from the runtime.
 * - `entry.asset.path` {string} LerretPath of the `.md` file.
 * - `entry.asset.name` {string} File name without extension.
 * - `entry.label` {string} Human-readable label.
 * - `entry.text` {string} Raw markdown source (initial value).
 * @param {string} [props.initialText] Override for the initial text (used
 * by callers that have already loaded the text; falls back to entry.text).
 * @param {(path: string, content: string) => Promise<{ ok: boolean, error?: string }>} [props.writer]
 * Override the writer — used by tests. Defaults to {@link writeProjectFile}.
 * @param {(text: string) => void} [props.onTextChange]
 * Test hook — called whenever the draft text changes in state.
 * @returns {React.ReactElement | null}
 */
export function MarkdownEditor({ open, onClose, entry, initialText, writer, onTextChange }) {
 const write = writer || writeProjectFile;

 // ── Derivations ─────────────────────────────────────────────────────────────
 const asset = entry?.asset;
 const filePath = asset?.path || null;
 const label = entry?.label || asset?.name || 'Markdown';
 const seedText = typeof initialText === 'string' ? initialText
 : typeof entry?.text === 'string' ? entry.text
 : '';

 // ── State ────────────────────────────────────────────────────────────────────
 // `text` — the draft text shown in the textarea and the live preview.
 const [text, setText] = React.useState(seedText);
 // `saved` — flashes the "Saved" indicator briefly after a successful write.
 const [saved, setSaved] = React.useState(false);
 // `writeError` — a calm write-failure message (cleared on the next success).
 const [writeError, setWriteError] = React.useState(null);
 // `reducedMotion` — cached at mount so preview transitions can be suppressed.
 const [reducedMotion] = React.useState(() => prefersReducedMotion());

 // ── Refs ─────────────────────────────────────────────────────────────────────
 // Debounce timer ID.
 const debounceRef = React.useRef(null);
 // Nonce to ensure only the latest write flashes "Saved".
 const savedNonceRef = React.useRef(0);
 // Track the pending text for the blur handler (always up-to-date even if
 // the render hasn't committed yet).
 const pendingTextRef = React.useRef(text);

 // ── Re-seed when a different entry is opened ────────────────────────────────
 // We only re-seed on asset PATH change (i.e., a different file). `initialText`
 // and `entry.text` are positional — if they change for the same file, that is
 // an external prop change the caller should handle by remounting or keying.
 // The setState calls inside are intentional: we want to reset form state
 // synchronously when the entry changes, which is the pattern data-editor.jsx
 // also uses.
 React.useEffect(() => {
 const freshText = typeof initialText === 'string' ? initialText
 : typeof entry?.text === 'string' ? entry.text
 : '';
 setText(freshText);
 pendingTextRef.current = freshText;
 setWriteError(null);
 setSaved(false);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.asset?.path]);

 // ── Cleanup debounce on unmount ──────────────────────────────────────────────
 React.useEffect(() => {
 return () => {
 if (debounceRef.current) clearTimeout(debounceRef.current);
 };
 }, []);

 // ── Write helper ─────────────────────────────────────────────────────────────
 const performWrite = React.useCallback(
 async (content) => {
 if (!filePath) {
 setWriteError('cannot determine file path for this markdown asset');
 return;
 }
 const result = await write(filePath, content);
 if (!result.ok) {
 setWriteError(result.error || 'write failed');
 return;
 }
 setWriteError(null);
 // Flash "Saved" briefly.
 savedNonceRef.current += 1;
 const myNonce = savedNonceRef.current;
 setSaved(true);
 setTimeout(() => {
 if (savedNonceRef.current === myNonce) setSaved(false);
 }, 1500);
 },
 [filePath, write],
 );

 // ── Textarea change handler ──────────────────────────────────────────────────
 const handleChange = React.useCallback(
 (e) => {
 const next = e.target.value;
 setText(next);
 pendingTextRef.current = next;
 onTextChange?.(next);

 // Debounce the write.
 if (debounceRef.current) clearTimeout(debounceRef.current);
 debounceRef.current = setTimeout(() => {
 performWrite(next);
 }, WRITE_DEBOUNCE_MS);
 },
 [performWrite, onTextChange],
 );

 // ── Blur handler — immediate write for safety ────────────────────────────────
 const handleBlur = React.useCallback(() => {
 // Cancel the pending debounce and write immediately.
 if (debounceRef.current) {
 clearTimeout(debounceRef.current);
 debounceRef.current = null;
 }
 performWrite(pendingTextRef.current);
 }, [performWrite]);

 // ── Sheet title ──────────────────────────────────────────────────────────────
 const title = `Markdown · ${label}`;

 // ── Footer ───────────────────────────────────────────────────────────────────
 const footer = (
 <>
 {writeError && (
 <div
 className="lm-md-editor__error-banner"
 role="alert"
 aria-live="polite"
 data-testid="lm-md-editor-error"
 >
 <span>
 Write failed: {writeError}
 {filePath && (
 <> — <code>{filePath}</code></>
 )}
 </span>
 </div>
 )}
 <span
 className="lm-md-editor__saved"
 data-visible={saved ? '' : undefined}
 aria-live="polite"
 data-testid="lm-md-editor-saved"
 >
 <span className="lm-md-editor__saved-dot" aria-hidden="true" />
 Saved
 </span>
 </>
 );

 // ── Render ───────────────────────────────────────────────────────────────────
 return (
 <EditorSheet open={open} onClose={onClose} title={title} dirty={false} footer={footer}>
 <div className="lm-md-editor" data-testid="lm-md-editor">
 {/* File path hint */}
 {filePath && (
 <p className="lm-md-editor__path" style={{ gridColumn: '1 / -1' }}>
 {filePath}
 </p>
 )}

 {/* Left: raw textarea */}
 <div className="lm-md-editor__input-pane">
 <span className="lm-md-editor__pane-label" aria-hidden="true">
 Markdown source
 </span>
 <textarea
 className="lm-md-editor__textarea"
 value={text}
 onChange={handleChange}
 onBlur={handleBlur}
 aria-label="Markdown source editor"
 data-testid="lm-md-editor-textarea"
 spellCheck={false}
 autoCorrect="off"
 autoCapitalize="off"
 />
 </div>

 {/* Right: live preview */}
 <div className="lm-md-editor__preview-pane">
 <span className="lm-md-editor__pane-label" aria-hidden="true">
 Preview
 </span>
 <div
 className="lm-md-editor__preview-scroll lm-md-doc"
 data-testid="lm-md-editor-preview"
 data-reduced-motion={reducedMotion ? '' : undefined}
 aria-label="Markdown preview"
 aria-live="off"
 >
 {text.trim().length === 0 ? (
 <span
 style={{
 color: 'var(--lm-text-muted, #B8B3A8)',
 fontSize: 'var(--lm-size-body-sm, 12px)',
 fontStyle: 'italic',
 }}
 >
 Empty document
 </span>
 ) : (
 <ReactMarkdown>{text}</ReactMarkdown>
 )}
 </div>
 </div>
 </div>
 </EditorSheet>
 );
}

export default MarkdownEditor;
