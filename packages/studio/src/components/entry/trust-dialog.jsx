/**
 * TrustDialog
 * One-time trust acknowledgement overlay before running a folder's code.
 *
 * ─── Design intent (UX-DR14) ────────────────────────────────────────────────
 * Calm and informative — not alarming. States plainly that code from the
 * chosen folder will run in the browser and lets the user make an informed
 * choice. One dialog per folder, per browser; trusted folders skip it entirely.
 *
 * ─── Shell pattern ───────────────────────────────────────────────────────────
 * Mirrors EditorSheet exactly:
 * • Portal to document.body
 * • Backdrop-dimmed, focus-trapped overlay
 * • Esc / backdrop click / × button = decline (same as "Cancel")
 * • Auto-focus on the primary action button on open
 * • Focus restored to the triggering element on close
 * • `prefers-reduced-motion: reduce` → instant open/close (no animation)
 * • All styling from `--lm-*` design tokens
 *
 * ─── API ─────────────────────────────────────────────────────────────────────
 * Component: <TrustDialog open handle onResolve />
 *
 * open {boolean}
 * Whether the dialog is currently shown.
 *
 * handle {FileSystemDirectoryHandle | null}
 * The folder handle being evaluated. The folder name is displayed
 * in the dialog body.
 *
 * onResolve {(result: { trusted: boolean }) => void}
 * Called with { trusted: true } on accept; { trusted: false } on any
 * form of decline (Cancel / Esc / backdrop / ×).
 * The CALLER owns the `open` state — set it to false inside onResolve.
 *
 * usage:
 * ```jsx
 * const [dialogOpen, setDialogOpen] = useState(false);
 * const [pendingHandle, setPendingHandle] = useState(null);
 *
 * // After picking a folder and detecting it's not yet trusted:
 * setPendingHandle(handle);
 * setDialogOpen(true);
 *
 * <TrustDialog
 * open={dialogOpen}
 * handle={pendingHandle}
 * onResolve={({ trusted }) => {
 * setDialogOpen(false);
 * if (trusted) mountProject(pendingHandle);
 * else showOpenFolder();
 * }}
 * />
 * ```
 *
 * Already-trusted folders must NEVER reach this dialog — callers short-circuit
 * via `isTrusted(handle)` from persistence.js before setting `open`.
 *
 * ─── Keyboard (NFR14) ────────────────────────────────────────────────────────
 * Tab / Shift+Tab : focus cycles within the dialog only
 * Esc : decline and dismiss
 * Enter / Space : activates the focused button
 *
 * ─── Accessibility ───────────────────────────────────────────────────────────
 * role="dialog" + aria-modal="true" + aria-labelledby → heading
 * Two buttons: "Trust this folder" (primary) and "Cancel" (secondary).
 */

import React from 'react';
import { createPortal } from 'react-dom';

import { recordTrust } from '../../state/persistence.js';

// ─── Focusable selector (same as EditorSheet) ────────────────────────────────

const FOCUSABLE_SELECTORS =
 'a[href]:not([disabled]),button:not([disabled]),input:not([disabled]),' +
 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// ─── Reduced-motion helper ────────────────────────────────────────────────────

function prefersReducedMotion() {
 if (typeof window === 'undefined') return false;
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ─── CSS injection (td- prefix, scoped to TrustDialog) ───────────────────────

if (typeof document !== 'undefined' && !document.getElementById('trust-dialog-styles')) {
 const s = document.createElement('style');
 s.id = 'trust-dialog-styles';
 s.textContent = `
/* ── Backdrop ──────────────────────────────────────────────────────────── */
.td-backdrop {
 position: fixed;
 inset: 0;
 z-index: 300;
 background: rgba(26, 23, 20, 0.55);
 backdrop-filter: blur(6px);
 display: flex;
 align-items: center;
 justify-content: center;
 animation: td-backdrop-in var(--lm-duration-base, 220ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}
.td-backdrop[data-closing] {
 animation: td-backdrop-out var(--lm-duration-fast, 120ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}

/* ── Dialog panel ──────────────────────────────────────────────────────── */
.td-dialog {
 position: relative;
 background: var(--lm-bg-primary, #FAF8F2);
 border-radius: var(--lm-radius-xl, 14px);
 box-shadow: var(--lm-shadow-popup, 0 18px 48px rgba(26, 23, 20, 0.22));
 width: min(480px, calc(100vw - var(--lm-space-8, 32px) * 2));
 display: flex;
 flex-direction: column;
 overflow: hidden;
 animation: td-panel-in var(--lm-duration-base, 220ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}
.td-dialog[data-closing] {
 animation: td-panel-out var(--lm-duration-fast, 120ms) var(--lm-ease, cubic-bezier(0.2, 0.7, 0.2, 1)) both;
}

/* ── Header ─────────────────────────────────────────────────────────────── */
.td-header {
 display: flex;
 align-items: center;
 gap: var(--lm-space-3, 12px);
 padding: var(--lm-space-5, 20px) var(--lm-space-6, 24px) var(--lm-space-4, 16px);
}
.td-title {
 flex: 1;
 font: var(--lm-weight-semibold, 600) var(--lm-size-h3, 16px)/var(--lm-lh-tight, 1.2) var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
 color: var(--lm-text-primary, #1A1714);
 margin: 0;
}
.td-close {
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
.td-close:hover {
 background: var(--lm-bg-tertiary, #E8E2D4);
 color: var(--lm-text-primary, #1A1714);
}
.td-close:focus-visible {
 outline: none;
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}

/* ── Body ───────────────────────────────────────────────────────────────── */
.td-body {
 padding: var(--lm-space-6, 24px);
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-4, 16px);
}
.td-description {
 font: var(--lm-weight-regular, 400) var(--lm-size-body, 13px)/var(--lm-lh-relaxed, 1.6) var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
 color: var(--lm-text-secondary, #3A3530);
 margin: 0;
}
.td-folder-name {
 display: inline-block;
 font: var(--lm-weight-semibold, 600) var(--lm-size-body, 13px)/1 var(--lm-font-mono, monospace);
 background: var(--lm-bg-tertiary, #E8E2D4);
 color: var(--lm-text-primary, #1A1714);
 border-radius: var(--lm-radius-xs, 4px);
 padding: 2px 6px;
}
.td-note {
 font: var(--lm-weight-regular, 400) var(--lm-size-body-sm, 12px)/var(--lm-lh-body, 1.45) var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
 color: var(--lm-text-tertiary, #6E6960);
 margin: 0;
}

/* ── Footer ─────────────────────────────────────────────────────────────── */
.td-footer {
 padding: var(--lm-space-4, 16px) var(--lm-space-6, 24px);
 display: flex;
 align-items: center;
 justify-content: flex-end;
 gap: var(--lm-space-3, 12px);
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.td-btn {
 display: inline-flex;
 align-items: center;
 justify-content: center;
 border-radius: var(--lm-radius-sm, 6px);
 padding: 0 var(--lm-space-4, 16px);
 height: 34px;
 font: var(--lm-weight-medium, 500) var(--lm-size-body, 13px)/1 var(--lm-font-sans, -apple-system, BlinkMacSystemFont, sans-serif);
 cursor: pointer;
 transition: background var(--lm-duration-fast, 120ms), color var(--lm-duration-fast, 120ms);
 white-space: nowrap;
}
.td-btn:focus-visible {
 outline: none;
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}
.td-btn-primary {
 background: var(--lm-accent, #B85B33);
 color: #fff;
 border: none;
}
.td-btn-primary:hover {
 background: var(--lm-accent-hover, #92421E);
}
.td-btn-primary:disabled {
 opacity: 0.55;
 cursor: not-allowed;
}
.td-btn-secondary {
 background: var(--lm-bg-tertiary, #E8E2D4);
 color: var(--lm-text-secondary, #3A3530);
 border: none;
}
.td-btn-secondary:hover {
 background: var(--lm-bg-secondary, #F2EEE6);
 color: var(--lm-text-primary, #1A1714);
}

/* ── Keyframes ───────────────────────────────────────────────────────────── */
@keyframes td-backdrop-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes td-backdrop-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes td-panel-in {
 from { opacity: 0; transform: translateY(8px) scale(0.97) }
 to { opacity: 1; transform: translateY(0) scale(1) }
}
@keyframes td-panel-out {
 from { opacity: 1; transform: translateY(0) scale(1) }
 to { opacity: 0; transform: translateY(6px) scale(0.97) }
}

/* ── Reduced-motion ──────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
 .td-backdrop, .td-backdrop[data-closing],
 .td-dialog, .td-dialog[data-closing] {
 animation: none !important;
 }
}
 `.trim();
 document.head.appendChild(s);
}

// ─── TrustDialog component ────────────────────────────────────────────────────

/**
 * TrustDialog — one-time per-folder trust acknowledgement overlay.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the dialog is shown.
 * @param {FileSystemDirectoryHandle | null} props.handle - The folder handle.
 * @param {(result: { trusted: boolean }) => void} props.onResolve
 * Called with { trusted: true } on accept; { trusted: false } on decline.
 */
export function TrustDialog({ open, handle, onResolve }) {
 const [closing, setClosing] = React.useState(false);
 const [busy, setBusy] = React.useState(false);

 const dialogRef = React.useRef(null);
 const trustBtnRef = React.useRef(null); // primary action — auto-focus target
 const prevFocusRef = React.useRef(null);

 const titleId = React.useId();

 // ── Save / restore focus ──────────────────────────────────────────────────

 React.useEffect(() => {
 if (!open) return;

 prevFocusRef.current = document.activeElement;
 // Reset closing/busy in a timeout to avoid setState-in-effect lint warning.
 // (These are resets for rapid re-open — setting them synchronously here
 // would cause a cascading render; wrapping in a microtask avoids that.)
 Promise.resolve().then(() => {
 setClosing(false);
 setBusy(false);
 });

 // Auto-focus the primary button after the portal paints.
 const raf = requestAnimationFrame(() => {
 if (trustBtnRef.current) trustBtnRef.current.focus();
 });

 return () => {
 cancelAnimationFrame(raf);
 // Restore focus to wherever it was before the dialog opened.
 const prev = prevFocusRef.current;
 if (prev && typeof prev.focus === 'function') {
 requestAnimationFrame(() => prev.focus());
 }
 };
 }, [open]);

 // ── Decline (close without trusting) ──────────────────────────────────────

 const decline = React.useCallback(() => {
 if (busy || closing) return;
 if (prefersReducedMotion()) {
 onResolve?.({ trusted: false });
 return;
 }
 setClosing(true);
 }, [busy, closing, onResolve]);

 // ── Accept (record trust then resolve) ────────────────────────────────────

 const accept = React.useCallback(async () => {
 if (busy || closing || !handle) return;
 setBusy(true);
 try {
 await recordTrust(handle);
 } finally {
 setBusy(false);
 }
 // Resolve immediately — no need for exit animation on the happy path, but
 // we honour reduced-motion correctly by letting the caller's state change
 // (open → false) drive the removal from the DOM. We always resolve with
 // trusted: true regardless of animation preference.
 onResolve?.({ trusted: true });
 }, [busy, closing, handle, onResolve]);

 // ── animationEnd — fire resolve after exit animation ─────────────────────

 const onAnimationEnd = React.useCallback(
 (e) => {
 if (e.target !== dialogRef.current) return;
 if (closing) onResolve?.({ trusted: false });
 },
 [closing, onResolve],
 );

 // ── Keyboard: Esc + focus trap ────────────────────────────────────────────

 React.useEffect(() => {
 if (!open) return;

 const handleKey = (e) => {
 if (e.key === 'Escape') {
 e.preventDefault();
 decline();
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
 }, [open, decline]);

 // ── Guard ─────────────────────────────────────────────────────────────────

 if (!open) return null;

 const folderName = handle?.name ?? 'this folder';
 const closingAttr = closing ? '' : undefined;

 return createPortal(
 <div
 className="td-backdrop"
 data-closing={closingAttr}
 data-testid="td-backdrop"
 onClick={decline}
 onWheel={(e) => e.preventDefault()}
 >
 <div
 ref={dialogRef}
 role="dialog"
 aria-modal="true"
 aria-labelledby={titleId}
 data-closing={closingAttr}
 data-testid="td-dialog"
 className="td-dialog"
 onClick={(e) => e.stopPropagation()}
 onAnimationEnd={onAnimationEnd}
 >
 {/* Header */}
 <div className="td-header">
 <h2 id={titleId} className="td-title">
 Trust this folder?
 </h2>
 <button
 className="td-close"
 data-testid="td-close"
 onClick={decline}
 aria-label="Decline and dismiss"
 type="button"
 >
 {/* × icon */}
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
 <div className="td-body">
 <p className="td-description">
 You are about to open{' '}
 <span className="td-folder-name">{folderName}</span>.
 Files in this folder contain JavaScript that will run in your
 browser as you use the studio.
 </p>
 <p className="td-description">
 Only open folders you own or trust the author of. Lerret does not
 sandbox asset code — it runs with the same permissions as this page.
 </p>
 <p className="td-note">
 This prompt appears once per folder. You can revoke access by
 clearing your browser&apos;s IndexedDB for this site.
 </p>
 </div>

 {/* Footer */}
 <div className="td-footer">
 <button
 className="td-btn td-btn-secondary"
 data-testid="td-cancel"
 onClick={decline}
 type="button"
 disabled={busy}
 >
 Cancel
 </button>
 <button
 ref={trustBtnRef}
 className="td-btn td-btn-primary"
 data-testid="td-trust"
 onClick={accept}
 type="button"
 disabled={busy}
 aria-busy={busy}
 >
 {busy ? 'Trusting…' : 'Trust this folder'}
 </button>
 </div>
 </div>
 </div>,
 document.body,
 );
}
