// Tests for ConfirmDialog — the modal confirmation used for weighty actions
// (e.g. deleting a page). Rendering uses react-dom/client into a detached
// jsdom container; the dialog itself portals to document.body.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ConfirmDialog } from './confirm-dialog.jsx';

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(element));
 return {
 container,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

afterEach(() => {
 document.querySelectorAll('[data-testid="lm-confirm-dialog"]').forEach((el) => el.remove());
});

const findDialog = () => document.querySelector('[data-testid="lm-confirm-dialog"]');

describe('ConfirmDialog', () => {
 it('renders the title and message', () => {
 const { cleanup } = renderToDom(
 <ConfirmDialog
 title={'Delete page "social"?'}
 message="This permanently deletes the page. This can't be undone."
 onConfirm={() => {}}
 onClose={() => {}}
 />,
 );
 const dialog = findDialog();
 expect(dialog).not.toBeNull();
 expect(dialog.getAttribute('role')).toBe('alertdialog');
 expect(dialog.textContent).toContain('Delete page "social"?');
 expect(dialog.textContent).toMatch(/can.t be undone/i);
 cleanup();
 });

 it('calls onConfirm then onClose when the confirm button is clicked', async () => {
 const onConfirm = vi.fn().mockResolvedValue(undefined);
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <ConfirmDialog title="Delete?" confirmLabel="Delete page" destructive onConfirm={onConfirm} onClose={onClose} />,
 );
 const btn = document.querySelector('[data-testid="lm-confirm-accept"]');
 expect(btn.textContent).toContain('Delete page');
 await act(async () => {
 btn.click();
 await Promise.resolve();
 });
 expect(onConfirm).toHaveBeenCalledOnce();
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });

 it('keeps the dialog open and shows an inline error if onConfirm throws', async () => {
 const onConfirm = vi.fn().mockRejectedValue(new Error('delete failed: permission denied'));
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <ConfirmDialog title="Delete?" onConfirm={onConfirm} onClose={onClose} />,
 );
 await act(async () => {
 document.querySelector('[data-testid="lm-confirm-accept"]').click();
 await Promise.resolve();
 });
 expect(onClose).not.toHaveBeenCalled();
 expect(document.querySelector('[data-testid="lm-confirm-error"]').textContent).toMatch(/permission denied/);
 cleanup();
 });

 it('cancel closes without confirming', () => {
 const onConfirm = vi.fn();
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <ConfirmDialog title="Delete?" onConfirm={onConfirm} onClose={onClose} />,
 );
 act(() => document.querySelector('[data-testid="lm-confirm-cancel"]').click());
 expect(onClose).toHaveBeenCalledOnce();
 expect(onConfirm).not.toHaveBeenCalled();
 cleanup();
 });

 it('Escape closes the dialog', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(
 <ConfirmDialog title="Delete?" onConfirm={() => {}} onClose={onClose} />,
 );
 act(() => {
 document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
 });
 expect(onClose).toHaveBeenCalledOnce();
 cleanup();
 });
});
