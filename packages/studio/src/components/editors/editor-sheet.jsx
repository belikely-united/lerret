/**
 * EditorSheet
 * Centered, backdrop-dimmed overlay shell for all in-studio editors.
 *
 * Props contract
 * ─────────────────────────────────────────────────────────────
 * open {boolean} Whether the sheet is rendered/visible.
 * onClose {() => void} Called when the sheet should close (Esc,
 * backdrop click, close button). The caller
 * owns the `open` state — set it to false
 * inside onClose.
 * title {string} Accessible sheet title, shown in the header
 * and used as aria-label on the dialog element.
 * dirty {boolean} True when there are uncommitted edits. A
 * subtle dot indicator appears next to the
 * title. Dismissal is never blocked
 * (verb-free commit model).
 * children {React.ReactNode} The body content of the sheet.
 * footer {React.ReactNode} Optional footer slot (buttons, status).
 *
 * Internal state
 * ─────────────────────────────────────────────────────────────
 * closing The sheet is in its exit animation phase. Managed internally;
 * exposed via the `data-closing` attribute on the dialog element
 * so tests and CSS can observe it.
 *
 * Accessibility
 * ─────────────────────────────────────────────────────────────
 * - role="dialog" + aria-modal="true" + aria-labelledby → title heading.
 * - Focus trap: Tab/Shift+Tab are confined to focusable descendants.
 * - Auto-focus: the close button receives focus on mount.
 * - Focus restore: the element that was active before open returns focus on
 * close.
 *
 * One-overlay-at-a-time
 * ─────────────────────────────────────────────────────────────
 * A module-level flag (`_sheetOpen`) tracks whether any EditorSheet is
 * currently open. A second sheet renders nothing (returns null) while the
 * flag is held by another instance. The flag is released on unmount.
 *
 * Reduced-motion
 * ─────────────────────────────────────────────────────────────
 * When `prefers-reduced-motion: reduce` matches, open/close are instant
 * (no CSS animation, no closing-state delay).
 */

import React from 'react';
import { createPortal } from 'react-dom';

// ─── Module-level singleton guard ────────────────────────────────────────────

let _sheetOpen = false;

/**
 * Reset the singleton guard. Intended for test environments only — lets test
 * suites start each test from a clean state without needing to unmount every
 * previous tree.
 */
export function _resetSheetSingleton() {
 _sheetOpen = false;
}

// ─── Focusable-selector (mirrors DCFocusOverlay's FOCUSABLE_SELECTORS) ───────

const FOCUSABLE_SELECTORS =
 'a[href]:not([disabled]),button:not([disabled]),input:not([disabled]),' +
 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// ─── Reduced-motion helper ────────────────────────────────────────────────────

function prefersReducedMotion() {
 if (typeof window === 'undefined') return false;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── CSS injection (sheet-prefixed, no global pollution) ─────────────────────

if (typeof document !== 'undefined' && !document.getElementById('editor-sheet-styles')) {
 const s = document.createElement('style');
 s.id = 'editor-sheet-styles';
 s.textContent = `
/* Backdrop */
.es-backdrop {
 position: fixed;
 inset: 0;
 z-index: 200;
 background: rgba(26, 23, 20, 0.55);
 backdrop-filter: blur(6px);
 display: flex;
 align-items: center;
 justify-content: center;
 animation: es-backdrop-in var(--lm-duration-base, 220ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}
.es-backdrop[data-closing] {
 animation: es-backdrop-out var(--lm-duration-fast, 120ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}

/* Dialog panel */
.es-dialog {
 position: relative;
 background: var(--lm-bg-primary, #FAF8F2);
 border-radius: var(--lm-radius-xl, 14px);
 box-shadow: var(--lm-shadow-popup, 0 18px 48px rgba(26, 23, 20, 0.22));
 width: min(640px, calc(100vw - var(--lm-space-8, 32px) * 2));
 max-height: calc(100vh - var(--lm-space-8, 32px) * 2);
 display: flex;
 flex-direction: column;
 overflow: hidden;
 animation: es-panel-in var(--lm-duration-base, 220ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}
.es-dialog[data-closing] {
 animation: es-panel-out var(--lm-duration-fast, 120ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}

/* Header */
.es-header {
 display: flex;
 align-items: center;
 gap: var(--lm-space-3, 12px);
 padding: var(--lm-space-5, 20px) var(--lm-space-6, 24px) var(--lm-space-4, 16px);
 background: var(--lm-bg-secondary, #F2EEE6);
 flex-shrink: 0;
}
.es-title {
 flex: 1;
 font: var(--lm-weight-semibold, 600) var(--lm-size-h3, 16px)/var(--lm-lh-tight, 1.2) var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
 color: var(--lm-text-primary, #1A1714);
 margin: 0;
 display: flex;
 align-items: center;
 gap: var(--lm-space-2, 8px);
}
/* Dirty indicator dot */
.es-dirty-dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-accent, #B85B33);
 flex-shrink: 0;
}
/* Close button */
.es-close {
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
 transition: background var(--lm-duration-fast, 120ms), color var(--lm-duration-fast, 120ms);
 flex-shrink: 0;
}
.es-close:hover {
 background: var(--lm-bg-tertiary, #E8E2D4);
 color: var(--lm-text-primary, #1A1714);
}
.es-close:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}

/* Body */
.es-body {
 flex: 1;
 overflow-y: auto;
 padding: var(--lm-space-6, 24px);
 scrollbar-width: thin;
 scrollbar-color: var(--lm-bg-tertiary, #E8E2D4) transparent;
}

/* Footer */
.es-footer {
 background: var(--lm-bg-secondary, #F2EEE6);
 padding: var(--lm-space-4, 16px) var(--lm-space-6, 24px);
 flex-shrink: 0;
 display: flex;
 align-items: center;
 justify-content: flex-end;
 gap: var(--lm-space-3, 12px);
}

/* Keyframes */
@keyframes es-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes es-backdrop-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes es-panel-in {
 from { opacity: 0; transform: translateY(8px) scale(0.97) }
 to { opacity: 1; transform: translateY(0) scale(1) }
}
@keyframes es-panel-out {
 from { opacity: 1; transform: translateY(0) scale(1) }
 to { opacity: 0; transform: translateY(6px) scale(0.97) }
}

/* Reduced-motion overrides — collapse all animations to instant */
@media (prefers-reduced-motion: reduce) {
 .es-backdrop, .es-backdrop[data-closing],
 .es-dialog, .es-dialog[data-closing] {
 animation: none !important;
 }
}
 `.trim();
 document.head.appendChild(s);
}

// ─── EditorSheet ──────────────────────────────────────────────────────────────

/**
 * EditorSheet primitive — the summoned-overlay shell for in-studio editors.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the sheet is open.
 * @param {() => void} props.onClose - Callback to close the sheet.
 * @param {string} props.title - Accessible title (shown in header).
 * @param {boolean} [props.dirty] - True when there are unsaved edits.
 * @param {React.ReactNode} props.children - Body content.
 * @param {React.ReactNode} [props.footer] - Optional footer content.
 */
export function EditorSheet({ open, onClose, title, dirty = false, children, footer }) {
 // Internal closing state — entered before actual unmount for exit animation.
 const [closing, setClosing] = React.useState(false);

 // Singleton guard:
 // isSlotHolder (state) — drives the render-time guard so React can re-render
 // when this instance acquires or releases the slot.
 // slotHolderRef (ref) — sync flag used in effects/cleanup to avoid stale closures.
 const [isSlotHolder, setIsSlotHolder] = React.useState(false);
 const slotHolderRef = React.useRef(false);

 // Ref to the dialog panel (for focus trap).
 const dialogRef = React.useRef(null);
 // Ref to the close button (auto-focus target).
 const closeRef = React.useRef(null);
 // Track the element that had focus before we opened.
 const prevFocusRef = React.useRef(null);

 // Unique id for aria-labelledby.
 const titleId = React.useId();

 // ── Singleton: acquire/release the global slot ──────────────────────────

 React.useEffect(() => {
 if (!open) {
 // Released via cleanup below; nothing to do here.
 return;
 }

 // Another instance already holds the slot.
 if (_sheetOpen && !slotHolderRef.current) return;

 // Acquire the slot.
 _sheetOpen = true;
 slotHolderRef.current = true;
 setIsSlotHolder(true);

 return () => {
 // Release only if we held it.
 if (slotHolderRef.current) {
 _sheetOpen = false;
 slotHolderRef.current = false;
 setIsSlotHolder(false);
 }
 };
 }, [open]);

 // ── Open/close lifecycle: focus save, auto-focus, restore ───────────────

 React.useEffect(() => {
 if (!open || !slotHolderRef.current) return;

 // Save the element that triggered the sheet.
 prevFocusRef.current = document.activeElement;
 // Reset closing state in case of rapid re-open.
 setClosing(false);

 // Auto-focus the close button after the portal has painted.
 const raf = requestAnimationFrame(() => {
 if (closeRef.current) closeRef.current.focus();
 });

 return () => {
 cancelAnimationFrame(raf);
 // Restore focus to the triggering element.
 const prev = prevFocusRef.current;
 if (prev && typeof prev.focus === 'function') {
 // Defer by one frame so the DOM has settled after unmount.
 requestAnimationFrame(() => prev.focus());
 }
 };
 }, [open]);

 // ── Dismiss: enter closing state, then call onClose ─────────────────────

 const dismiss = React.useCallback(() => {
 if (closing) return;
 if (prefersReducedMotion()) {
 // Instant — no animation phase.
 onClose?.();
 return;
 }
 setClosing(true);
 }, [closing, onClose]);

 // When closing animation finishes, notify caller.
 const onAnimationEnd = React.useCallback(
 (e) => {
 // Only react to the panel's own animation end, not children's.
 if (e.target !== dialogRef.current) return;
 if (closing) onClose?.();
 },
 [closing, onClose],
 );

 // ── Keyboard handler: Esc + focus trap ──────────────────────────────────

 React.useEffect(() => {
 if (!open || !slotHolderRef.current) return;

 const handleKey = (e) => {
 if (e.key === 'Escape') {
 e.preventDefault();
 dismiss();
 return;
 }
 if (e.key === 'Tab') {
 const el = dialogRef.current;
 if (!el) return;
 const focusable = Array.from(el.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
 (n) => !n.closest('[inert]'),
 );
 if (focusable.length === 0) { e.preventDefault(); return; }
 const cur = document.activeElement;
 const ci = focusable.indexOf(cur);
 if (e.shiftKey) {
 e.preventDefault();
 const target = ci <= 0 ? focusable[focusable.length - 1] : focusable[ci - 1];
 target.focus();
 } else {
 e.preventDefault();
 const target = ci >= focusable.length - 1 ? focusable[0] : focusable[ci + 1];
 target.focus();
 }
 }
 };

 document.addEventListener('keydown', handleKey);
 return () => document.removeEventListener('keydown', handleKey);
 }, [open, dismiss]);

 // ── Guard: don't render if not open or another sheet holds the slot ─────

 if (!open) return null;
 // If another instance holds the singleton slot (and we haven't acquired
 // ours yet), don't render. `isSlotHolder` is React state so this is safe
 // to read during render and will trigger a re-render when the slot is
 // eventually acquired.
 if (!isSlotHolder) return null;

 const closingAttr = closing ? '' : undefined;

 return createPortal(
 <div
 className="es-backdrop"
 data-closing={closingAttr}
 onClick={dismiss}
 // Prevent wheel events from reaching the canvas behind.
 onWheel={(e) => e.preventDefault()}
 >
 <div
 ref={dialogRef}
 role="dialog"
 aria-modal="true"
 aria-labelledby={titleId}
 data-closing={closingAttr}
 className="es-dialog"
 onClick={(e) => e.stopPropagation()}
 onAnimationEnd={onAnimationEnd}
 >
 {/* Header */}
 <div className="es-header">
 <h2 id={titleId} className="es-title">
 {title}
 {dirty && (
 <span
 className="es-dirty-dot"
 aria-label="unsaved changes"
 title="Unsaved changes"
 />
 )}
 </h2>
 <button
 ref={closeRef}
 className="es-close"
 onClick={dismiss}
 aria-label="Close editor"
 type="button"
 >
 {/* × close icon */}
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

 {/* Body */}
 <div className="es-body">{children}</div>

 {/* Footer (optional) */}
 {footer && <div className="es-footer">{footer}</div>}
 </div>
 </div>,
 document.body,
 );
}
