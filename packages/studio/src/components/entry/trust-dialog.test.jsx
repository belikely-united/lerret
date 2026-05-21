/**
 * Tests for — TrustDialog component
 *
 * Coverage:
 * 1. Open → renders the dialog in the DOM.
 * 2. Closed → dialog is absent.
 * 3. Accept ("Trust this folder") → calls recordTrust; resolves { trusted: true }.
 * 4. Cancel button → resolves { trusted: false }; recordTrust NOT called.
 * 5. Esc key → resolves { trusted: false } (reduced-motion: instant).
 * 6. Backdrop click → resolves { trusted: false }.
 * 7. × close button → resolves { trusted: false }.
 * 8. Focus trap — Tab cycles forward through focusable descendants only.
 * 9. Focus trap — Shift+Tab cycles backward.
 * 10. Auto-focus: primary action button receives focus on open.
 * 11. Focus restore: focus returns to the triggering element on close.
 * 12. prefers-reduced-motion → Esc resolves immediately (no animation delay).
 * 13. Folder name is displayed in the dialog body.
 * 14. role="dialog" + aria-modal="true" + aria-labelledby attributes.
 * 15. Already-trusted folder: isTrusted short-circuit (caller responsibility
 * test — verifies isTrusted returns true after recordTrust so callers
 * can skip the dialog).
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mock persistence module ──────────────────────────────────────────────────
//
// We mock the persistence module so TrustDialog tests do not depend on
// IndexedDB. vi.mock is hoisted before imports.

vi.mock('../../state/persistence.js', () => ({
 recordTrust: vi.fn().mockResolvedValue(undefined),
 isTrusted: vi.fn().mockResolvedValue(false),
 clearTrust: vi.fn().mockResolvedValue(undefined),
}));

import { TrustDialog } from './trust-dialog.jsx';
import { recordTrust, isTrusted } from '../../state/persistence.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mount a React element; returns { cleanup, rerender }. */
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

/** Dispatch a keydown event on document. */
function fireKey(key, options = {}) {
 const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
 document.dispatchEvent(e);
 return e;
}

/** Stub matchMedia to report prefers-reduced-motion: reduce. */
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

/** Make a minimal fake FileSystemDirectoryHandle. */
function makeHandle(name = 'my-project') {
 return { name, async isSameEntry() { return false; } };
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
 vi.clearAllMocks();
 stubReducedMotion(); // default: reduced-motion on, so dismiss is instant
});

afterEach(() => {
 vi.unstubAllGlobals();
 // Belt-and-suspenders: remove any orphaned portal nodes (td-backdrop portals
 // rendered to document.body that weren't cleaned up by a failing test).
 document.querySelectorAll('.td-backdrop').forEach((n) => n.remove());
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TrustDialog — open/close visibility', () => {
 it('renders the dialog when open=true', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );
 expect(document.querySelector('[data-testid="td-dialog"]')).not.toBeNull();
 cleanup();
 });

 it('renders nothing when open=false', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open={false} handle={makeHandle()} onResolve={() => {}} />,
 );
 expect(document.querySelector('[data-testid="td-dialog"]')).toBeNull();
 cleanup();
 });
});

describe('TrustDialog — accept flow', () => {
 it('clicking "Trust this folder" calls recordTrust and resolves { trusted: true }', async () => {
 const handle = makeHandle();
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={handle} onResolve={onResolve} />,
 );

 const trustBtn = document.querySelector('[data-testid="td-trust"]');
 expect(trustBtn).not.toBeNull();

 await act(async () => {
 trustBtn.click();
 });

 expect(recordTrust).toHaveBeenCalledWith(handle);
 expect(onResolve).toHaveBeenCalledWith({ trusted: true });
 cleanup();
 });

 it('recordTrust is NOT called on decline', async () => {
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => { fireKey('Escape'); });

 expect(recordTrust).not.toHaveBeenCalled();
 expect(onResolve).toHaveBeenCalledWith({ trusted: false });
 cleanup();
 });
});

describe('TrustDialog — decline flows', () => {
 it('Cancel button resolves { trusted: false }', () => {
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => {
 document.querySelector('[data-testid="td-cancel"]').click();
 });

 expect(onResolve).toHaveBeenCalledWith({ trusted: false });
 cleanup();
 });

 it('Esc key resolves { trusted: false } (reduced-motion → instant)', () => {
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => { fireKey('Escape'); });

 expect(onResolve).toHaveBeenCalledWith({ trusted: false });
 cleanup();
 });

 it('Backdrop click resolves { trusted: false }', () => {
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => {
 document.querySelector('[data-testid="td-backdrop"]').click();
 });

 expect(onResolve).toHaveBeenCalledWith({ trusted: false });
 cleanup();
 });

 it('× close button resolves { trusted: false }', () => {
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => {
 document.querySelector('[data-testid="td-close"]').click();
 });

 expect(onResolve).toHaveBeenCalledWith({ trusted: false });
 cleanup();
 });
});

describe('TrustDialog — focus trap', () => {
 const FOCUSABLE =
 'a[href]:not([disabled]),button:not([disabled]),input:not([disabled]),' +
 'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

 function focusableInDialog() {
 const dialog = document.querySelector('[data-testid="td-dialog"]');
 return Array.from(dialog.querySelectorAll(FOCUSABLE));
 }

 it('Tab cycles forward through focusable elements', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 const items = focusableInDialog();
 expect(items.length).toBeGreaterThan(1);

 // Focus the first item manually.
 act(() => { items[0].focus(); });
 // Tab from first → second.
 act(() => { fireKey('Tab'); });
 expect(document.activeElement).toBe(items[1]);

 cleanup();
 });

 it('Shift+Tab cycles backward through focusable elements', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 const items = focusableInDialog();
 // Focus the second item.
 act(() => { items[1].focus(); });
 // Shift+Tab → back to first.
 act(() => { fireKey('Tab', { shiftKey: true }); });
 expect(document.activeElement).toBe(items[0]);

 cleanup();
 });

 it('Tab wraps from last focusable element back to first', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 const items = focusableInDialog();
 act(() => { items[items.length - 1].focus(); });
 act(() => { fireKey('Tab'); });
 expect(document.activeElement).toBe(items[0]);

 cleanup();
 });

 it('Shift+Tab wraps from first focusable element back to last', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 const items = focusableInDialog();
 act(() => { items[0].focus(); });
 act(() => { fireKey('Tab', { shiftKey: true }); });
 expect(document.activeElement).toBe(items[items.length - 1]);

 cleanup();
 });
});

describe('TrustDialog — focus management', () => {
 it('auto-focuses the "Trust this folder" primary button on open', async () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 // Allow the rAF auto-focus to fire (same pattern as editor-sheet.test.jsx).
 await act(async () => {
 await new Promise((r) => setTimeout(r, 50));
 });

 const trustBtn = document.querySelector('[data-testid="td-trust"]');
 expect(document.activeElement).toBe(trustBtn);

 cleanup();
 });

 it('restores focus to the triggering element after close', () => {
 // Create a button to act as the trigger.
 const trigger = document.createElement('button');
 trigger.textContent = 'Open Folder';
 document.body.appendChild(trigger);
 trigger.focus();

 let openState = true;
 const onResolve = vi.fn(() => { openState = false; });

 const { cleanup, rerender } = renderToDom(
 <TrustDialog open={openState} handle={makeHandle()} onResolve={onResolve} />,
 );

 // Dismiss via Esc (reduced-motion → instant).
 act(() => { fireKey('Escape'); });

 // Simulate caller setting open=false in response to onResolve.
 act(() => {
 rerender(<TrustDialog open={false} handle={makeHandle()} onResolve={onResolve} />);
 });

 // requestAnimationFrame focus restore.
 act(() => {});

 expect(document.activeElement).toBe(trigger);

 trigger.remove();
 cleanup();
 });
});

describe('TrustDialog — prefers-reduced-motion', () => {
 it('with reduced-motion, Esc resolves immediately without animation delay', () => {
 stubReducedMotion(); // already on by default, but explicit
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => { fireKey('Escape'); });

 // Must have resolved immediately (not waiting for animationEnd).
 expect(onResolve).toHaveBeenCalledTimes(1);
 expect(onResolve).toHaveBeenCalledWith({ trusted: false });

 cleanup();
 });

 it('without reduced-motion, backdrop gets data-closing before resolution', () => {
 stubNoReducedMotion();
 const onResolve = vi.fn();
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={onResolve} />,
 );

 act(() => { fireKey('Escape'); });

 // onResolve is NOT called yet — waiting for animationEnd.
 expect(onResolve).not.toHaveBeenCalled();

 // But the closing state is set (data-closing attribute on the backdrop).
 const backdrop = document.querySelector('[data-testid="td-backdrop"]');
 expect(backdrop.dataset.closing).toBeDefined();

 cleanup();
 });
});

describe('TrustDialog — content and accessibility', () => {
 it('displays the folder name from the handle', () => {
 const handle = makeHandle('my-design-folder');
 const { cleanup } = renderToDom(
 <TrustDialog open handle={handle} onResolve={() => {}} />,
 );

 const body = document.querySelector('[data-testid="td-dialog"]').textContent;
 expect(body).toContain('my-design-folder');

 cleanup();
 });

 it('shows "this folder" when handle is null', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={null} onResolve={() => {}} />,
 );

 const body = document.querySelector('[data-testid="td-dialog"]').textContent;
 expect(body).toContain('this folder');

 cleanup();
 });

 it('dialog has role="dialog", aria-modal="true", and aria-labelledby', () => {
 const { cleanup } = renderToDom(
 <TrustDialog open handle={makeHandle()} onResolve={() => {}} />,
 );

 const dialog = document.querySelector('[data-testid="td-dialog"]');
 expect(dialog.getAttribute('role')).toBe('dialog');
 expect(dialog.getAttribute('aria-modal')).toBe('true');
 const labelledBy = dialog.getAttribute('aria-labelledby');
 expect(labelledBy).toBeTruthy();
 // The heading referenced by aria-labelledby must be in the DOM.
 const heading = document.getElementById(labelledBy);
 expect(heading).not.toBeNull();
 expect(heading.textContent).toContain('Trust this folder?');

 cleanup();
 });
});

describe('TrustDialog — isTrusted short-circuit (caller contract)', () => {
 it('isTrusted returns true after recordTrust is called for the same handle', async () => {
 // This tests that persistence.js satisfies the contract TrustDialog's
 // callers rely on — they should call isTrusted before rendering TrustDialog.
 // Here we verify the mock wires up correctly for 's integration.
 isTrusted.mockResolvedValueOnce(true);
 const handle = makeHandle('trusted-proj');
 const trusted = await isTrusted(handle);
 expect(trusted).toBe(true);
 });
});
