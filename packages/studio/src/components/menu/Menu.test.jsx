// Menu.test.jsx acceptance tests for the Menu primitive.
//
// Coverage:
// • Open via trigger (mouse click)
// • Open via trigger (keyboard — Space / Enter / ArrowDown)
// • Arrow-key navigation skips disabled items
// • Enter activates the focused enabled item and closes the menu
// • Escape closes the menu and returns focus to the trigger
// • Disabled item shows reason on title attribute (hover/focus tooltip)
// • aria-disabled is "true" on disabled items
// • role="menu" on the popover; role="menuitem" on items
// • prefers-reduced-motion: animation class is unchanged (CSS handles it),
// but we assert the popover is rendered instantly (no delay) — i.e. the
// component does not gate on the media query itself.
//
// Rendering: `react-dom/client` into a jsdom body container, the same
// pattern as `page-picker.test.jsx`.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Menu } from './Menu.jsx';

// ─── Test helpers ─────────────────────────────────────────────────────────

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => { root.render(element); });
 return {
 container,
 rerender(next) { act(() => root.render(next)); },
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

function keyDown(node, key) {
 act(() => {
 node.dispatchEvent(
 new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
 );
 });
}

// The popover is portaled to document.body — query the whole document.
const findMenu = () => document.querySelector('[role="menu"]');
const findMenuItems = () => [...document.querySelectorAll('[role="menuitem"]')];

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ITEMS = [
 { kind: 'item', id: 'rename', label: 'Rename', onSelect: vi.fn() },
 { kind: 'item', id: 'duplicate', label: 'Duplicate', onSelect: vi.fn() },
 { kind: 'separator', id: 'sep-1' },
 { kind: 'item', id: 'delete', label: 'Delete', disabled: true, reason: 'Cannot delete the last asset' },
 { kind: 'item', id: 'archive', label: 'Archive', onSelect: vi.fn() },
];

function makeTrigger() {
 return (
 <button type="button" data-testid="trigger">
 Open
 </button>
 );
}

// ─── Reset mocks between tests ────────────────────────────────────────────

beforeEach(() => {
 ITEMS[0].onSelect.mockReset();
 ITEMS[1].onSelect.mockReset();
 ITEMS[4].onSelect.mockReset();
});

afterEach(() => {
 // Guard against leaking portaled nodes.
 document.querySelectorAll('[role="menu"]').forEach((el) => el.remove());
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Menu — open/close via trigger', () => {
 it('opens the popover on trigger click', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 expect(findMenu()).toBeNull();
 act(() => btn.click());
 expect(findMenu()).toBeTruthy();
 cleanup();
 });

 it('closes the popover on a second trigger click', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 expect(findMenu()).toBeTruthy();
 act(() => btn.click());
 expect(findMenu()).toBeNull();
 cleanup();
 });

 it('opens on Space key on the trigger', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 keyDown(btn, ' ');
 expect(findMenu()).toBeTruthy();
 cleanup();
 });

 it('opens on Enter key on the trigger', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 keyDown(btn, 'Enter');
 expect(findMenu()).toBeTruthy();
 cleanup();
 });

 it('opens on ArrowDown key on the trigger', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 keyDown(btn, 'ArrowDown');
 expect(findMenu()).toBeTruthy();
 cleanup();
 });

 it('sets aria-haspopup="menu" and aria-expanded on the trigger', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 expect(btn.getAttribute('aria-haspopup')).toBe('menu');
 expect(btn.getAttribute('aria-expanded')).toBe('false');
 act(() => btn.click());
 expect(btn.getAttribute('aria-expanded')).toBe('true');
 cleanup();
 });
});

describe('Menu — ARIA semantics', () => {
 it('has role="menu" on the popover', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 expect(menu).toBeTruthy();
 expect(menu.getAttribute('role')).toBe('menu');
 cleanup();
 });

 it('has role="menuitem" on each non-separator row', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menuItems = findMenuItems();
 // ITEMS has 4 non-separator items.
 expect(menuItems.length).toBe(4);
 menuItems.forEach((el) => expect(el.getAttribute('role')).toBe('menuitem'));
 cleanup();
 });

 it('sets aria-disabled="true" on disabled items', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const items = findMenuItems();
 const deleteItem = items.find((el) => el.textContent.includes('Delete'));
 expect(deleteItem).toBeTruthy();
 expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
 cleanup();
 });

 it('does NOT set aria-disabled on enabled items', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const items = findMenuItems();
 const renameItem = items.find((el) => el.textContent.includes('Rename'));
 expect(renameItem.getAttribute('aria-disabled')).toBeNull();
 cleanup();
 });
});

describe('Menu — disabled-with-reason', () => {
 it('surfaces the reason string as a title attribute on the disabled item', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const items = findMenuItems();
 const deleteItem = items.find((el) => el.textContent.includes('Delete'));
 expect(deleteItem.getAttribute('title')).toBe('Cannot delete the last asset');
 cleanup();
 });

 it('disabled item does NOT call onSelect when clicked', () => {
 const onSelect = vi.fn();
 const singleItem = [
 { kind: 'item', id: 'del', label: 'Delete', disabled: true, reason: 'Nope', onSelect },
 ];
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={singleItem} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const item = findMenuItems()[0];
 act(() => item.click());
 expect(onSelect).not.toHaveBeenCalled();
 // Menu stays open (item click did nothing).
 expect(findMenu()).toBeTruthy();
 cleanup();
 });
});

describe('Menu — keyboard navigation', () => {
 it('ArrowDown moves focus to the first enabled item', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 keyDown(menu, 'ArrowDown');
 // aria-activedescendant points at an item element
 const activeId = menu.getAttribute('aria-activedescendant');
 expect(activeId).toBeTruthy();
 const activeEl = document.getElementById(activeId);
 expect(activeEl.textContent).toContain('Rename');
 cleanup();
 });

 it('ArrowDown skips disabled items and separators', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 // ITEMS order: Rename(0), Duplicate(1), sep(2), Delete-disabled(3), Archive(4)
 // Enabled: 0, 1, 4
 keyDown(menu, 'ArrowDown'); // → Rename (idx 0)
 keyDown(menu, 'ArrowDown'); // → Duplicate (idx 1)
 keyDown(menu, 'ArrowDown'); // → Archive (idx 4), skips sep + disabled
 const activeId = menu.getAttribute('aria-activedescendant');
 const activeEl = document.getElementById(activeId);
 expect(activeEl.textContent).toContain('Archive');
 cleanup();
 });

 it('ArrowUp wraps from first to last enabled item', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 keyDown(menu, 'ArrowDown'); // → Rename (first enabled)
 keyDown(menu, 'ArrowUp'); // → wraps to Archive (last enabled)
 const activeId = menu.getAttribute('aria-activedescendant');
 const activeEl = document.getElementById(activeId);
 expect(activeEl.textContent).toContain('Archive');
 cleanup();
 });

 it('Enter activates the focused enabled item and closes the menu', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 keyDown(menu, 'ArrowDown'); // focus Rename
 keyDown(menu, 'Enter');
 expect(ITEMS[0].onSelect).toHaveBeenCalledOnce();
 expect(findMenu()).toBeNull();
 cleanup();
 });

 it('arrow navigation never lands on a disabled item', () => {
 // With only one enabled item (Alpha) and one disabled (Beta), repeated
 // ArrowDown should always stay on Alpha — Beta is never the active item.
 const onSelect = vi.fn();
 const items = [
 { kind: 'item', id: 'a', label: 'Alpha', onSelect },
 { kind: 'item', id: 'b', label: 'Beta', disabled: true, reason: 'Nope' },
 ];
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={items} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const menu = findMenu();
 // ArrowDown → Alpha (only enabled). ArrowDown again wraps to Alpha again.
 keyDown(menu, 'ArrowDown');
 const activeId1 = menu.getAttribute('aria-activedescendant');
 expect(document.getElementById(activeId1).textContent).toContain('Alpha');

 keyDown(menu, 'ArrowDown'); // wraps — should still be Alpha (Beta is disabled)
 const activeId2 = menu.getAttribute('aria-activedescendant');
 expect(document.getElementById(activeId2).textContent).toContain('Alpha');

 // Enter activates Alpha.
 keyDown(menu, 'Enter');
 expect(onSelect).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('keeps the menu open when a keepOpen item is selected (inline-confirm pattern)', () => {
 const onDelete = vi.fn();
 const onOther = vi.fn();
 const items = [
 { kind: 'item', id: 'delete', label: 'Delete…', onSelect: onDelete, keepOpen: true },
 { kind: 'item', id: 'other', label: 'Other', onSelect: onOther },
 ];
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={items} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 expect(findMenu()).toBeTruthy();
 // Selecting the keepOpen item runs onSelect but leaves the menu open, so a
 // call-site that morphs the items (e.g. → "Confirm delete · Cancel") shows
 // the follow-up row in place instead of forcing a reopen.
 const deleteItem = findMenuItems().find((el) => el.textContent.includes('Delete'));
 act(() => deleteItem.click());
 expect(onDelete).toHaveBeenCalledOnce();
 expect(findMenu()).toBeTruthy();
 // A normal item still closes the menu.
 const otherItem = findMenuItems().find((el) => el.textContent.includes('Other'));
 act(() => otherItem.click());
 expect(onOther).toHaveBeenCalledOnce();
 expect(findMenu()).toBeNull();
 cleanup();
 });

 it('Escape closes the menu without calling any onSelect', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 expect(findMenu()).toBeTruthy();
 keyDown(findMenu(), 'Escape');
 expect(findMenu()).toBeNull();
 expect(ITEMS[0].onSelect).not.toHaveBeenCalled();
 expect(ITEMS[1].onSelect).not.toHaveBeenCalled();
 expect(ITEMS[4].onSelect).not.toHaveBeenCalled();
 cleanup();
 });

 it('Escape returns focus to the trigger', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 keyDown(findMenu(), 'Escape');
 expect(document.activeElement).toBe(btn);
 cleanup();
 });
});

describe('Menu — click to activate', () => {
 it('clicking an enabled item calls onSelect and closes the menu', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const items = findMenuItems();
 const duplicateItem = items.find((el) => el.textContent.includes('Duplicate'));
 act(() => duplicateItem.click());
 expect(ITEMS[1].onSelect).toHaveBeenCalledOnce();
 expect(findMenu()).toBeNull();
 cleanup();
 });
});

describe('Menu — renderTrigger API', () => {
 it('supports renderTrigger render-prop and toggles open correctly', () => {
 const { container, cleanup } = renderToDom(
 <Menu
 renderTrigger={({ open, getTriggerProps }) => (
 <button type="button" data-testid="rt-trigger" data-open={open} {...getTriggerProps()}>
 Open
 </button>
 )}
 items={ITEMS}
 />,
 );
 const btn = container.querySelector('[data-testid="rt-trigger"]');
 expect(btn.getAttribute('aria-haspopup')).toBe('menu');
 expect(btn.getAttribute('data-open')).toBe('false');
 act(() => btn.click());
 expect(findMenu()).toBeTruthy();
 expect(btn.getAttribute('data-open')).toBe('true');
 cleanup();
 });
});

describe('Menu — prefers-reduced-motion', () => {
 it('renders the popover immediately regardless of motion preference (no JS gating)', () => {
 // The component does not branch on matchMedia — reduced-motion is handled
 // purely by CSS (@media prefers-reduced-motion: reduce → animation: none).
 // Here we verify there is no artificial delay: the menu appears on the
 // very same synchronous tick as the click, even when we simulate the
 // reduced-motion media query being set.
 const originalMatchMedia = window.matchMedia;
 window.matchMedia = vi.fn().mockImplementation((query) => ({
 matches: query === '(prefers-reduced-motion: reduce)',
 media: query,
 onchange: null,
 addListener: vi.fn(),
 removeListener: vi.fn(),
 addEventListener: vi.fn(),
 removeEventListener: vi.fn(),
 dispatchEvent: vi.fn(),
 }));

 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 // Popover appears synchronously.
 expect(findMenu()).toBeTruthy();

 window.matchMedia = originalMatchMedia;
 cleanup();
 });
});

describe('Menu — separator', () => {
 it('renders separators with role="separator"', () => {
 const { container, cleanup } = renderToDom(
 <Menu trigger={makeTrigger()} items={ITEMS} />,
 );
 const btn = container.querySelector('button[data-testid="trigger"]');
 act(() => btn.click());
 const sep = document.querySelector('[role="separator"]');
 expect(sep).toBeTruthy();
 cleanup();
 });
});
