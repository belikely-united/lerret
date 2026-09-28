// markdown-editor.jsx — Markdown asset editor: raw input + live preview.
//
// Edits IN PLACE — no modal. While editing, the markdown card on the canvas
// becomes the raw-Markdown source, and a temporary live preview (the same
// react-markdown the card uses) docks on the right of the screen. Done, Esc,
// or a click outside the card and the preview finishes editing.
//
// ── Write model ─────────────────────────────────────────────────────────────
// Writes are debounced (400 ms after the last keystroke) so we don't hammer the
// disk on every character. A blur on the textarea triggers an immediate write as
// a safety net. Both paths use `writeProjectFile` from `write-client.js`.
//
// Because writes happen as the user types (not on an explicit "Save" button),
// finishing (Done / Esc / click outside) flushes the pending write first.
//
// ── Failed-write UX ─────────────────────────────────────────────────────────
// A failed write shows a calm inline guidance message that includes the file
// path (NFR9, NFR8). The prior file content is left intact by the server's
// atomic temp-rename. The editor remains fully usable for a retry.
//
// ── Reduced-motion ───────────────────────────────────────────────────────────
// The preview pane update is instant (no fade) when `prefers-reduced-motion:
// reduce` matches (UX-DR18, NFR14); the preview panel then fades without
// sliding.
//
// ── Props ────────────────────────────────────────────────────────────────────
// open {boolean} Whether the editor is visible.
// onClose {() => void} Called when editing finishes.
// entry {AssetEntry} The markdown entry from the runtime.
// Needs `entry.asset.path` (the .md LerretPath)
// and `entry.asset.name` / `entry.label` for
// the sheet title.
// initialText {string} The raw markdown source (from `entry.text`).
// writer {Function} [test] Override for writeProjectFile.
// onTextChange {Function} [test] Fired on every text state change.

import React from 'react';
import ReactMarkdown from 'react-markdown';

import { createPortal } from 'react-dom';
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
/* ── In place: the card becomes the source editor ─────────────────── */
.lm-md-editor {
 position: relative;
 width: 100%;
 box-sizing: border-box;
 border-radius: var(--lm-radius-lg, 12px);
 background: var(--lm-bg-primary, #FAF8F2);
 box-shadow: 0 0 0 2px var(--lm-accent, #B85B33), var(--lm-shadow-md);
}
.lm-md-editor__textarea {
 display: block;
 width: 100%;
 min-height: 240px;
 box-sizing: border-box;
 padding: var(--lm-space-5, 20px) var(--lm-space-5, 20px);
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, "Cascadia Code", monospace);
 font-size: var(--lm-size-body, 13px);
 line-height: var(--lm-lh-relaxed, 1.6);
 color: var(--lm-text-primary, #1A1714);
 background: transparent;
 border: none;
 border-radius: inherit;
 outline: none;
 resize: none;
 overflow: hidden; /* grows with its content (auto-height) */
}

/* ── Right: temporary live preview (non-modal; canvas stays usable) ── */
.lm-md-preview {
 position: fixed;
 top: 12px;
 right: 12px;
 bottom: 96px;
 width: min(440px, 40vw);
 z-index: 60;
 display: flex;
 flex-direction: column;
 background: var(--lm-popover-bg, var(--lm-bg-primary, #FAF8F2));
 border-radius: var(--lm-radius-lg, 12px);
 box-shadow: var(--lm-shadow-popup);
 -webkit-backdrop-filter: blur(12px);
 backdrop-filter: blur(12px);
 font-family: var(--lm-font-sans, system-ui, sans-serif);
 transition: opacity var(--lm-duration-base, 220ms) var(--lm-ease), translate var(--lm-duration-base, 220ms) var(--lm-ease);
}
@starting-style { .lm-md-preview { opacity: 0; translate: 16px 0; } }
.lm-md-preview__head {
 flex: none;
 display: flex;
 align-items: center;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-3, 12px) var(--lm-space-3, 12px) var(--lm-space-2, 8px) var(--lm-space-4, 16px);
}
.lm-md-editor__pane-label {
 font: var(--lm-weight-semibold, 600) var(--lm-size-hint, 10px)/1 var(--lm-font-sans, sans-serif);
 letter-spacing: var(--lm-tracking-caps, 0.5px);
 text-transform: uppercase;
 color: var(--lm-text-tertiary, #6E6960);
 user-select: none;
}
.lm-md-preview__name {
 flex: 1;
 min-width: 0;
 font-size: var(--lm-size-body-sm, 12px);
 font-weight: var(--lm-weight-semibold, 600);
 color: var(--lm-text-primary, #1A1714);
 overflow: hidden;
 text-overflow: ellipsis;
 white-space: nowrap;
}
.lm-md-preview__done {
 flex: none;
 border: 0;
 border-radius: var(--lm-radius-md, 8px);
 padding: 6px 12px;
 background: var(--lm-text-primary, #1A1714);
 color: var(--lm-bg-primary, #FAF8F2);
 font: var(--lm-weight-semibold, 600) var(--lm-size-body-sm, 12px)/1 var(--lm-font-sans, sans-serif);
 cursor: pointer;
}
.lm-md-preview__done:focus-visible { box-shadow: var(--lm-focus-ring); outline: none; }
.lm-md-editor__preview-scroll {
 flex: 1;
 min-height: 0;
 overflow-y: auto;
 overflow-x: hidden;
 padding: var(--lm-space-2, 8px) var(--lm-space-5, 20px) var(--lm-space-5, 20px);
 scrollbar-width: thin;
}
.lm-md-preview__foot {
 flex: none;
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-2, 8px) var(--lm-space-4, 16px) var(--lm-space-3, 12px);
}
.lm-md-editor__error-banner {
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 background: var(--lm-error-light);
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
@media (prefers-reduced-motion: reduce) {
 .lm-md-preview { transition-property: opacity; }
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
 * Renders in place of the markdown card: the card becomes a raw-Markdown
 * textarea, and a live preview (react-markdown, same as
 * {@link MarkdownAssetCard}) docks on the right of the screen while editing.
 *
 * Writes are debounced ({@link WRITE_DEBOUNCE_MS} ms), committed immediately on
 * textarea blur, and flushed when editing finishes.
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

 // ── Finish editing: flush any pending write, then close ──────────────────
 const finish = React.useCallback(() => {
 if (debounceRef.current) {
 clearTimeout(debounceRef.current);
 debounceRef.current = null;
 }
 performWrite(pendingTextRef.current);
 onClose && onClose();
 }, [performWrite, onClose]);

 // ── In place: focus the source, grow it with its content ─────────────────
 const textareaRef = React.useRef(null);
 const hostRef = React.useRef(null);
 const panelRef = React.useRef(null);
 React.useLayoutEffect(() => {
 const el = textareaRef.current;
 if (!el) return;
 el.style.height = 'auto';
 el.style.height = `${el.scrollHeight}px`;
 }, [text, open]);
 React.useEffect(() => {
 if (!open) return;
 textareaRef.current?.focus({ preventScroll: true });
 // Keep the card visible beside the preview panel: if the panel would cover
 // it, pan the canvas left just enough (24px clear of the panel).
 const host = hostRef.current;
 const panel = panelRef.current;
 if (!host || !panel || typeof window === 'undefined') return;
 // Measure against the panel's resting place (it may still be sliding in).
 const panelLeft = window.innerWidth - parseFloat(getComputedStyle(panel).right || '0') - panel.offsetWidth;
 const overlap = host.getBoundingClientRect().right - (panelLeft - 24);
 if (overlap > 0) window.dispatchEvent(new CustomEvent('lerret:pan-by', { detail: { dx: -overlap } }));
 }, [open]);

 // Esc, or a click outside the card and the preview, finishes editing.
 React.useEffect(() => {
 if (!open) return undefined;
 const onKey = (e) => {
 if (e.key === 'Escape') {
 e.stopPropagation();
 finish();
 }
 };
 const onDown = (e) => {
 if (hostRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
 finish();
 };
 document.addEventListener('keydown', onKey, true);
 document.addEventListener('pointerdown', onDown, true);
 return () => {
 document.removeEventListener('keydown', onKey, true);
 document.removeEventListener('pointerdown', onDown, true);
 };
 }, [open, finish]);

 if (!open) return null;

 // ── Render: source in the card · live preview docked on the right ───────
 return (
 <div ref={hostRef} className="lm-md-editor" data-testid="lm-md-editor">
 <textarea
 ref={textareaRef}
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
 {typeof document !== 'undefined' && createPortal(
 <aside ref={panelRef} className="lm-md-preview" aria-label={`Preview of ${label}`} data-testid="lm-md-preview-panel">
 <header className="lm-md-preview__head">
 <span className="lm-md-editor__pane-label">Preview</span>
 <span className="lm-md-preview__name" title={filePath || label}>{label}</span>
 <span
 className="lm-md-editor__saved"
 data-visible={saved ? '' : undefined}
 aria-live="polite"
 data-testid="lm-md-editor-saved"
 >
 <span className="lm-md-editor__saved-dot" aria-hidden="true" />
 Saved
 </span>
 <button type="button" className="lm-md-preview__done" onClick={finish} title="Done (Esc)">Done</button>
 </header>
 <div
 className="lm-md-editor__preview-scroll lm-md-doc"
 data-testid="lm-md-editor-preview"
 data-reduced-motion={reducedMotion ? '' : undefined}
 aria-live="off"
 >
 {text.trim().length === 0 ? (
 <span style={{ color: 'var(--lm-text-muted, #B8B3A8)', fontSize: 'var(--lm-size-body-sm, 12px)', fontStyle: 'italic' }}>
 Empty document
 </span>
 ) : (
 <ReactMarkdown>{text}</ReactMarkdown>
 )}
 </div>
 {writeError && (
 <footer className="lm-md-preview__foot">
 <div className="lm-md-editor__error-banner" role="alert" aria-live="polite" data-testid="lm-md-editor-error">
 Write failed: {writeError}
 {filePath && <> — <code>{filePath}</code></>}
 </div>
 </footer>
 )}
 </aside>,
 document.body,
 )}
 </div>
 );
}

export default MarkdownEditor;
