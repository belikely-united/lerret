// Tests for the right-click ContextMenu primitive + useContextMenu hook.
//
// The popover is portaled to document.body, so queries hit the whole document.
// Mirrors Menu.test.jsx's createRoot + act harness (which already drives
// portaled menu items via `.click()`).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { ContextMenu, useContextMenu } from './context-menu.jsx';

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
 };
}

const findMenu = () => document.querySelector('[data-testid="lm-context-menu"]');
const findItems = () => [...document.querySelectorAll('[role="menuitem"]')];

afterEach(() => {
 document.querySelectorAll('[data-testid="lm-context-menu"]').forEach((el) => el.remove());
});

describe('ContextMenu', () => {
 it('renders the items, portaled + fixed-positioned', () => {
 const items = [
 { kind: 'item', id: 'a', label: 'Alpha', onSelect: vi.fn() },
 { kind: 'separator', id: 's' },
 { kind: 'item', id: 'b', label: 'Beta', onSelect: vi.fn() },
 ];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 100, y: 80 }} items={items} onClose={vi.fn()} />,
 );
 const menu = findMenu();
 expect(menu).toBeTruthy();
 expect(menu.getAttribute('role')).toBe('menu');
 expect(menu.style.position).toBe('fixed');
 expect(findItems().map((n) => n.textContent)).toEqual(
 expect.arrayContaining(['Alpha', 'Beta']),
 );
 cleanup();
 });

 it('calls onSelect + onClose when an item is clicked', () => {
 const onSelect = vi.fn();
 const onClose = vi.fn();
 const items = [{ kind: 'item', id: 'a', label: 'Alpha', onSelect }];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 0, y: 0 }} items={items} onClose={onClose} />,
 );
 act(() => { findItems()[0].click(); });
 expect(onSelect).toHaveBeenCalledTimes(1);
 expect(onClose).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('keeps the menu open for a keepOpen item (inline delete-confirm)', () => {
 const onSelect = vi.fn();
 const onClose = vi.fn();
 const items = [{ kind: 'item', id: 'del', label: 'Delete…', onSelect, keepOpen: true }];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 0, y: 0 }} items={items} onClose={onClose} />,
 );
 act(() => { findItems()[0].click(); });
 expect(onSelect).toHaveBeenCalledTimes(1);
 expect(onClose).not.toHaveBeenCalled();
 cleanup();
 });

 it('does not activate a disabled item', () => {
 const onSelect = vi.fn();
 const onClose = vi.fn();
 const items = [{ kind: 'item', id: 'a', label: 'Alpha', disabled: true, onSelect }];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 0, y: 0 }} items={items} onClose={onClose} />,
 );
 act(() => { findItems()[0].click(); });
 expect(onSelect).not.toHaveBeenCalled();
 expect(onClose).not.toHaveBeenCalled();
 cleanup();
 });

 it('closes on Escape', () => {
 const onClose = vi.fn();
 const items = [{ kind: 'item', id: 'a', label: 'Alpha', onSelect: vi.fn() }];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 0, y: 0 }} items={items} onClose={onClose} />,
 );
 act(() => {
 findMenu().dispatchEvent(
 new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
 );
 });
 expect(onClose).toHaveBeenCalled();
 cleanup();
 });

 it('closes on an outside pointerdown', () => {
 const onClose = vi.fn();
 const items = [{ kind: 'item', id: 'a', label: 'Alpha', onSelect: vi.fn() }];
 const { cleanup } = renderToDom(
 <ContextMenu point={{ x: 0, y: 0 }} items={items} onClose={onClose} />,
 );
 act(() => {
 document.body.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
 });
 expect(onClose).toHaveBeenCalled();
 cleanup();
 });
});

describe('useContextMenu', () => {
 function Harness() {
 const ctx = useContextMenu();
 return (
 <div>
 <div data-testid="target" onContextMenu={ctx.openAt} style={{ width: 50, height: 50 }} />
 <span data-testid="state">{ctx.open ? `open:${ctx.point.x},${ctx.point.y}` : 'closed'}</span>
 <button type="button" data-testid="close" onClick={ctx.close}>close</button>
 </div>
 );
 }

 it('openAt opens at the cursor + suppresses the native menu/propagation; close resets', () => {
 const { container, cleanup } = renderToDom(<Harness />);
 const state = () => container.querySelector('[data-testid="state"]').textContent;
 expect(state()).toBe('closed');

 const evt = new window.MouseEvent('contextmenu', {
 bubbles: true, cancelable: true, clientX: 120, clientY: 200,
 });
 const pd = vi.spyOn(evt, 'preventDefault');
 const sp = vi.spyOn(evt, 'stopPropagation');
 act(() => { container.querySelector('[data-testid="target"]').dispatchEvent(evt); });

 expect(pd).toHaveBeenCalled();
 expect(sp).toHaveBeenCalled();
 expect(state()).toBe('open:120,200');

 act(() => { container.querySelector('[data-testid="close"]').click(); });
 expect(state()).toBe('closed');
 cleanup();
 });
});
