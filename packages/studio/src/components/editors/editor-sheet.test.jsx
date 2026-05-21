/**
 * Tests for — EditorSheet: the summoned-overlay shell
 *
 * Coverage:
 * 1. Open/close lifecycle — renders when open, absent when closed.
 * 2. Close control dismisses (calls onClose).
 * 3. Esc key dismisses (calls onClose).
 * 4. Backdrop click dismisses (calls onClose).
 * 5. Focus restore — focus returns to the triggering element when the
 * parent re-renders with open=false after onClose fires.
 * 6. Auto-focus — focus moves inside the dialog on open.
 * 7. Focus trap — Tab cycles forward through focusable descendants.
 * 8. Focus trap — Shift+Tab cycles backward through focusable descendants.
 * 9. dirty prop — dirty-dot indicator is shown when dirty=true.
 * 10. dirty prop — dirty-dot absent when dirty=false.
 * 11. Footer slot — optional footer renders when provided.
 * 12. Footer absent — no footer element when prop is omitted.
 * 13. Reduced-motion — onClose called immediately (no animation delay).
 * 14. dialog role + aria-labelledby — accessibility attributes are correct.
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EditorSheet, _resetSheetSingleton } from './editor-sheet.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mount a React element into document.body; returns helpers + teardown.
 * IMPORTANT: always call cleanup() at the end of each test.
 */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => { root.render(element); });
 return {
 container,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 rerender(el) {
 act(() => { root.render(el); });
 },
 };
}

/** Fire a keydown event on document. */
function fireKey(key, options = {}) {
 const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
 document.dispatchEvent(e);
 return e;
}

/** Stub matchMedia to simulate prefers-reduced-motion: reduce. */
function stubReducedMotion() {
 vi.stubGlobal('matchMedia', (query) => ({
 matches: query === '(prefers-reduced-motion: reduce)',
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));
}

/** Stub matchMedia to report no motion preference. */
function stubNoReducedMotion() {
 vi.stubGlobal('matchMedia', () => ({
 matches: false,
 media: '',
 addEventListener: () => {},
 removeEventListener: () => {},
 }));
}

/**
 * Query focusable elements inside a dialog element.
 * Uses the same selector as EditorSheet's focus trap, and matches the
 * jsdom workaround used by design-canvas.test.jsx: accepts any element
 * inside the dialog even if offsetParent is null (jsdom always returns null
 * for non-rendered elements).
 */
function getFocusable(dialog) {
 return Array.from(
 dialog.querySelectorAll(
 'a[href]:not([disabled]),button:not([disabled]),input:not([disabled]),' +
 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
 ),
 ).filter((n) => dialog.contains(n));
}

// ─── Lifecycle stubs ─────────────────────────────────────────────────────────

beforeEach(() => {
 stubNoReducedMotion();
 // Reset module-level singleton so each test starts from a clean state.
 _resetSheetSingleton();
});

afterEach(() => {
 vi.unstubAllGlobals();
 vi.restoreAllMocks();
 // Belt-and-suspenders: ensure singleton is released between tests.
 _resetSheetSingleton();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EditorSheet', () => {
 // ── 1. Open/close lifecycle ────────────────────────────────────────────────

 it('renders dialog when open=true', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="Test" onClose={() => {}}>Body</EditorSheet>,
 );
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 cleanup();
 });

 it('renders nothing when open=false', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open={false} title="Test" onClose={() => {}}>Body</EditorSheet>,
 );
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 cleanup();
 });

 // ── 2. Close control dismisses ────────────────────────────────────────────

 it('calls onClose when close button is clicked', () => {
 stubReducedMotion();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <EditorSheet open title="Test" onClose={onClose}>Body</EditorSheet>,
 );
 const btn = document.querySelector('.es-close');
 expect(btn).not.toBeNull();
 act(() => { btn.click(); });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 // ── 3. Esc key dismisses ──────────────────────────────────────────────────

 it('calls onClose when Escape is pressed', () => {
 stubReducedMotion();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <EditorSheet open title="Esc test" onClose={onClose}>Body</EditorSheet>,
 );
 act(() => { fireKey('Escape'); });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 // ── 4. Backdrop click dismisses ───────────────────────────────────────────

 it('calls onClose when backdrop is clicked', () => {
 stubReducedMotion();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <EditorSheet open title="Backdrop test" onClose={onClose}>Body</EditorSheet>,
 );
 const backdrop = document.querySelector('.es-backdrop');
 expect(backdrop).not.toBeNull();
 act(() => { backdrop.click(); });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 // ── 5. Focus restore ──────────────────────────────────────────────────────
 // Simulate a controlled open→close cycle: the parent component tracks `open`
 // and sets it to false when onClose fires. When the sheet unmounts, it
 // restores focus to the element that was active before it opened.

 it('restores focus to the triggering element when parent closes the sheet', async () => {
 stubReducedMotion();

 // Create a trigger button, focus it before opening.
 const trigger = document.createElement('button');
 trigger.textContent = 'Open editor';
 document.body.appendChild(trigger);
 act(() => { trigger.focus(); });
 expect(document.activeElement).toBe(trigger);

 // Controlled wrapper that owns open state.
 function ControlledSheet() {
 const [open, setOpen] = React.useState(true);
 return (
 <EditorSheet
 open={open}
 title="Restore test"
 onClose={() => setOpen(false)}
 >
 Body
 </EditorSheet>
 );
 }

 const { cleanup } = renderToDom(<ControlledSheet />);

 // Sheet should be open.
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 // Dismiss via Esc — onClose fires → state → open=false → unmount.
 act(() => { fireKey('Escape'); });

 // Sheet should now be gone.
 expect(document.querySelector('[role="dialog"]')).toBeNull();

 // Allow rAF for focus restore to fire.
 await act(async () => {
 await new Promise((r) => setTimeout(r, 50));
 });

 expect(document.activeElement).toBe(trigger);

 cleanup();
 trigger.remove();
 });

 // ── 6. Auto-focus ─────────────────────────────────────────────────────────

 it('moves focus inside the dialog on open', async () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="Focus test" onClose={() => {}}>Body</EditorSheet>,
 );

 // Allow the rAF auto-focus to fire.
 await act(async () => {
 await new Promise((r) => setTimeout(r, 50));
 });

 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog).not.toBeNull();
 // Active element must be inside the dialog (we auto-focus the close button).
 expect(dialog.contains(document.activeElement)).toBe(true);

 cleanup();
 });

 // ── 7. Focus trap — Tab cycles forward ────────────────────────────────────

 it('traps Tab: wraps from last focusable element back to first', () => {
 const { cleanup } = renderToDom(
 <EditorSheet
 open
 title="Trap test"
 onClose={() => {}}
 footer={<button type="button">Footer btn</button>}
 >
 <button type="button">Body btn</button>
 </EditorSheet>,
 );

 const dialog = document.querySelector('[role="dialog"]');
 const focusable = getFocusable(dialog);
 expect(focusable.length).toBeGreaterThan(1);

 // Focus the last focusable element.
 act(() => { focusable[focusable.length - 1].focus(); });
 expect(document.activeElement).toBe(focusable[focusable.length - 1]);

 // Tab should wrap to the first.
 act(() => { fireKey('Tab'); });
 expect(document.activeElement).toBe(focusable[0]);

 cleanup();
 });

 // ── 8. Focus trap — Shift+Tab cycles backward ─────────────────────────────

 it('traps Shift+Tab: wraps from first focusable element back to last', () => {
 const { cleanup } = renderToDom(
 <EditorSheet
 open
 title="Shift+Tab trap"
 onClose={() => {}}
 footer={<button type="button">Footer btn</button>}
 >
 <button type="button">Body btn</button>
 </EditorSheet>,
 );

 const dialog = document.querySelector('[role="dialog"]');
 const focusable = getFocusable(dialog);
 expect(focusable.length).toBeGreaterThan(1);

 // Focus the first focusable element.
 act(() => { focusable[0].focus(); });
 expect(document.activeElement).toBe(focusable[0]);

 // Shift+Tab should wrap to the last.
 act(() => { fireKey('Tab', { shiftKey: true }); });
 expect(document.activeElement).toBe(focusable[focusable.length - 1]);

 cleanup();
 });

 // ── 9. dirty state — dot shown ────────────────────────────────────────────

 it('shows dirty-dot indicator when dirty=true', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="Dirty test" onClose={() => {}} dirty>Body</EditorSheet>,
 );
 expect(document.querySelector('.es-dirty-dot')).not.toBeNull();
 cleanup();
 });

 // ── 10. dirty state — dot absent ─────────────────────────────────────────

 it('does not show dirty-dot when dirty=false', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="Clean test" onClose={() => {}} dirty={false}>Body</EditorSheet>,
 );
 expect(document.querySelector('.es-dirty-dot')).toBeNull();
 cleanup();
 });

 // ── 11. Footer slot ───────────────────────────────────────────────────────

 it('renders footer when footer prop is provided', () => {
 const { cleanup } = renderToDom(
 <EditorSheet
 open
 title="Footer test"
 onClose={() => {}}
 footer={<button type="button">Save</button>}
 >
 Body
 </EditorSheet>,
 );
 const dialog = document.querySelector('[role="dialog"]');
 const footer = dialog.querySelector('.es-footer');
 expect(footer).not.toBeNull();
 expect(footer.textContent).toContain('Save');
 cleanup();
 });

 // ── 12. Footer absent ─────────────────────────────────────────────────────

 it('does not render footer element when footer prop is omitted', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="No footer" onClose={() => {}}>Body</EditorSheet>,
 );
 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog.querySelector('.es-footer')).toBeNull();
 cleanup();
 });

 // ── 13. Reduced-motion — instant dismiss ─────────────────────────────────

 it('calls onClose immediately on dismiss when prefers-reduced-motion is set', () => {
 stubReducedMotion();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <EditorSheet open title="Reduced motion" onClose={onClose}>Body</EditorSheet>,
 );
 // With reduced motion, dismiss calls onClose synchronously — no animationend wait.
 act(() => { fireKey('Escape'); });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 // ── 14. Accessibility — role + aria-labelledby ────────────────────────────

 it('has role=dialog, aria-modal=true, and aria-labelledby pointing to the title', () => {
 const { cleanup } = renderToDom(
 <EditorSheet open title="A11y test" onClose={() => {}}>Body</EditorSheet>,
 );
 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog).not.toBeNull();
 expect(dialog.getAttribute('aria-modal')).toBe('true');
 const labelId = dialog.getAttribute('aria-labelledby');
 expect(labelId).toBeTruthy();
 const heading = document.getElementById(labelId);
 expect(heading).not.toBeNull();
 expect(heading.textContent).toContain('A11y test');
 cleanup();
 });
});
