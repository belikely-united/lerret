// move-picker.test.jsx — render + interaction coverage for the destination
// picker that powers the kebab's "Move to…" item.
//
// The picker is presentational: it doesn't fetch or call the move endpoint.
// We verify the surface a caller depends on:
//
//   1. Renders a portaled dialog with role="dialog" + aria-modal.
//   2. Lists every destination, disables source-self, current parent, and
//      descendants of the source (cycle prevention parity with the backend).
//   3. Confirm button is gated until a row is picked, then wires onConfirm
//      with { toFolderPath }.
//   4. Cancel + Esc invoke onClose without calling onConfirm.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MovePicker, destinationsFromCascadeEntries } from './move-picker.jsx';

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => { root.render(element); });
 return {
 container,
 update(next) {
 act(() => { root.render(next); });
 },
 cleanup() {
 act(() => root.unmount());
 container.remove();
 // Strip any portaled overlay nodes the picker leaves on body in tests.
 document.querySelectorAll('[data-testid="lm-move-picker"]').forEach((el) => el.remove());
 },
 };
}

const sampleDestinations = [
 { path: '/proj/.lerret/landing', label: 'landing' },
 { path: '/proj/.lerret/social', label: 'social' },
 { path: '/proj/.lerret/social/sub', label: 'sub' },
 { path: '/proj/.lerret/brand', label: 'brand' },
];

afterEach(() => {
 document.body.innerHTML = '';
});

describe('MovePicker — render shape', () => {
 it('portals a role="dialog" with aria-modal to body', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const dlg = document.querySelector('[data-testid="lm-move-picker"]');
 expect(dlg).toBeTruthy();
 expect(dlg.getAttribute('role')).toBe('dialog');
 expect(dlg.getAttribute('aria-modal')).toBe('true');
 cleanup();
 });

 it('renders one row per destination', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const rows = document.querySelectorAll('[data-testid^="lm-move-picker-row-"]');
 expect(rows.length).toBe(sampleDestinations.length);
 cleanup();
 });

 it('disables the current parent with a reason', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const social = document.querySelector(
 '[data-testid="lm-move-picker-row-/proj/.lerret/social"]',
 );
 expect(social).toBeTruthy();
 expect(social.getAttribute('aria-disabled')).toBe('true');
 expect(social.getAttribute('title')).toMatch(/already in this folder/);
 cleanup();
 });

 it('disables source-self and any descendant of source when source is a folder', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social"
 currentParentPath="/proj/.lerret"
 destinations={sampleDestinations}
 />,
 );
 const selfRow = document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/social"]');
 const descRow = document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/social/sub"]');
 expect(selfRow.getAttribute('aria-disabled')).toBe('true');
 expect(descRow.getAttribute('aria-disabled')).toBe('true');
 expect(descRow.getAttribute('title')).toMatch(/descendant/);
 // A sibling unrelated to the source is NOT disabled by this picker.
 const sibling = document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/landing"]');
 expect(sibling.getAttribute('aria-disabled')).toBeNull();
 cleanup();
 });

 it('falls back to cascadeEntries when destinations is not provided', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 cascadeEntries={[
 ['/proj/.lerret/landing', {}],
 ['/proj/.lerret/brand', {}],
 ]}
 />,
 );
 expect(
 document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/landing"]'),
 ).toBeTruthy();
 expect(
 document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/brand"]'),
 ).toBeTruthy();
 cleanup();
 });

 it('renders an empty-state message when there are no destinations', () => {
 const { container, cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={[]}
 />,
 );
 expect(document.body.textContent).toContain('No destination folders available');
 cleanup();
 // touch container so it's used (linter)
 expect(container).toBeTruthy();
 });
});

describe('MovePicker — interaction', () => {
 it('Confirm button is disabled until a destination is selected, then enabled', () => {
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={vi.fn()}
 onConfirm={vi.fn().mockResolvedValue(undefined)}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const confirm = document.querySelector('[data-testid="lm-move-picker-confirm"]');
 expect(confirm.disabled).toBe(true);
 const landing = document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/landing"]');
 act(() => landing.click());
 expect(confirm.disabled).toBe(false);
 cleanup();
 });

 it('calls onConfirm with { toFolderPath } when a destination is confirmed', async () => {
 const onConfirm = vi.fn().mockResolvedValue(undefined);
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={onClose}
 onConfirm={onConfirm}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const landing = document.querySelector('[data-testid="lm-move-picker-row-/proj/.lerret/landing"]');
 act(() => landing.click());
 const confirm = document.querySelector('[data-testid="lm-move-picker-confirm"]');
 await act(async () => { confirm.click(); });
 expect(onConfirm).toHaveBeenCalledOnce();
 expect(onConfirm.mock.calls[0][0]).toEqual({
 toFolderPath: '/proj/.lerret/landing',
 });
 // onClose is called after a successful confirm so the parent can unmount.
 expect(onClose).toHaveBeenCalled();
 cleanup();
 });

 it('Cancel invokes onClose and does NOT call onConfirm', () => {
 const onConfirm = vi.fn();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={onClose}
 onConfirm={onConfirm}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 const cancel = document.querySelector('[data-testid="lm-move-picker-cancel"]');
 act(() => cancel.click());
 expect(onClose).toHaveBeenCalledOnce();
 expect(onConfirm).not.toHaveBeenCalled();
 cleanup();
 });

 it('Escape key triggers onClose', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={onClose}
 onConfirm={vi.fn()}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 act(() => {
 document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
 });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 // D.M1 regression — onConfirm rejection surfaces as inline error, dialog
 // stays open, onClose NOT called. Previously the picker swallowed the
 // result and closed the dialog on collision/cycle/standalone failures.
 it('surfaces the inline error when onConfirm rejects and does not call onClose', async () => {
 const onClose = vi.fn();
 const onConfirm = vi.fn().mockRejectedValue(new Error('destination already has an asset named og-card.jsx'));
 const { cleanup } = renderToDom(
 <MovePicker
 onClose={onClose}
 onConfirm={onConfirm}
 sourcePath="/proj/.lerret/social/og-card.jsx"
 currentParentPath="/proj/.lerret/social"
 destinations={sampleDestinations}
 />,
 );
 // Pick landing
 const landingRow = Array.from(document.querySelectorAll('button')).find(
 (b) => (b.textContent || '').includes('landing') && !b.disabled,
 );
 await act(async () => { landingRow.click(); });
 const confirmBtn = document.querySelector('[data-testid="lm-move-picker-confirm"]');
 await act(async () => { confirmBtn.click(); });
 // Let the onConfirm rejection settle.
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

 expect(onConfirm).toHaveBeenCalledOnce();
 expect(onClose).not.toHaveBeenCalled();
 expect(document.body.textContent).toContain('destination already has an asset named og-card.jsx');
 cleanup();
 });
});

describe('destinationsFromCascadeEntries', () => {
 it('maps each [path, _] entry to { path, label } with the basename as label', () => {
 const ds = destinationsFromCascadeEntries([
 ['/proj/.lerret/landing', {}],
 ['/proj/.lerret/social/sub', {}],
 ]);
 expect(ds).toEqual([
 { path: '/proj/.lerret/landing', label: 'landing' },
 { path: '/proj/.lerret/social/sub', label: 'sub' },
 ]);
 });

 it('returns [] for non-array input', () => {
 expect(destinationsFromCascadeEntries(null)).toEqual([]);
 expect(destinationsFromCascadeEntries(undefined)).toEqual([]);
 });
});
