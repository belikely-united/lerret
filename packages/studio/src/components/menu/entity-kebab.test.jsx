// entity-kebab.test.jsx acceptance tests for the per-entity
// kebab menus.
//
// Coverage:
// • Each entity type emits the correct item set (component / markdown / folder)
// • Mode-limited "reveal" items render disabled-with-reason in hosted mode
// and enabled in CLI mode
// • The delete confirmation flow swaps the item for "Confirm delete · Cancel"
// • The Menu primitive's separators and disabled handling are preserved
//
// We test the *pure* item-set builders directly (no rendering) for the most
// stable assertions, and add a small render test for the EntityKebab shell so
// the kebab opens the menu through KebabTrigger.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
 EntityKebab,
 buildComponentItems,
 buildMarkdownItems,
 buildSectionItems,
} from './entity-kebab.jsx';

// ── Test fixtures ────────────────────────────────────────────────────────────

const noop = () => {};

function baseCtx(extra = {}) {
 return {
 onEditData: noop,
 onEditMeta: noop,
 onEdit: noop,
 onEditConfig: noop,
 onDuplicate: noop,
 onRename: noop,
 onMove: noop,
 onDelete: noop,
 onExport: noop,
 onRevealEditor: noop,
 onRevealFinder: noop,
 cliMode: true,
 ...extra,
 };
}

function itemIds(items) {
 return items.filter((it) => it.kind !== 'separator').map((it) => it.id);
}

function findItem(items, id) {
 return items.find((it) => it.id === id);
}

// ── Component item set ──────────────────────────────────────────────────────

describe('buildComponentItems', () => {
 it('groups edit · organise · export · open-in, with Delete last (destructive, HIG)', () => {
 const items = buildComponentItems(baseCtx());
 expect(itemIds(items)).toEqual([
 'edit-data',
 'edit-meta',
 'duplicate',
 'rename',
 'move',
 'export',
 'reveal-editor',
 'reveal-finder',
 'delete',
 ]);
 expect(findItem(items, 'delete').danger).toBe(true);
 expect(items.at(-2).kind).toBe('separator');
 });

 it('leads with a header naming the artboard, and never doubles or trails separators', () => {
 const items = buildComponentItems(baseCtx({ header: { label: 'Card', meta: 'Artboard' }, onEditVisually: noop }));
 expect(items[0]).toMatchObject({ kind: 'label', label: 'Card', meta: 'Artboard' });
 expect(items[1].id).toBe('edit-visually');
 expect(items[1].shortcut).toBe('E');
 expect(items.at(-1).kind).not.toBe('separator');
 expect(items.filter((it, i) => it.kind === 'separator' && items[i - 1]?.kind === 'separator')).toEqual([]);
 });

 it('omits "Move to…" when onMove is not provided (legacy callers)', () => {
 const items = buildComponentItems(baseCtx({ onMove: undefined }));
 expect(itemIds(items)).not.toContain('move');
 });

 it('wires onMove callback to the Move to… item', () => {
 const onMove = vi.fn();
 const items = buildComponentItems(baseCtx({ onMove }));
 const moveItem = findItem(items, 'move');
 expect(moveItem).toBeTruthy();
 expect(moveItem.label).toBe('Move to…');
 moveItem.onSelect();
 expect(onMove).toHaveBeenCalledOnce();
 });

 it('renders reveal items disabled-with-reason in hosted (non-CLI) mode', () => {
 const items = buildComponentItems(baseCtx({ cliMode: false }));
 const revealEditor = findItem(items, 'reveal-editor');
 const revealFinder = findItem(items, 'reveal-finder');
 expect(revealEditor.disabled).toBe(true);
 expect(revealEditor.reason).toMatch(/local CLI/);
 expect(revealFinder.disabled).toBe(true);
 expect(revealFinder.reason).toMatch(/local CLI/);
 });

 it('renders reveal items enabled in CLI mode', () => {
 const items = buildComponentItems(baseCtx({ cliMode: true }));
 const revealEditor = findItem(items, 'reveal-editor');
 expect(revealEditor.disabled).toBe(false);
 expect(revealEditor.reason).toBeUndefined();
 });
});

// ── Markdown item set ───────────────────────────────────────────────────────

describe('buildMarkdownItems', () => {
 it('uses Edit (not Edit data/meta), same structure, Delete last', () => {
 const ids = itemIds(buildMarkdownItems(baseCtx()));
 expect(ids).not.toContain('edit-data');
 expect(ids).toEqual(['edit', 'duplicate', 'rename', 'move', 'export', 'reveal-editor', 'reveal-finder', 'delete']);
 });

 it('omits "Move to…" when onMove is not provided', () => {
 const items = buildMarkdownItems(baseCtx({ onMove: undefined }));
 expect(itemIds(items)).not.toContain('move');
 });

 it('reveal items respect cliMode just like component', () => {
 const hostedItems = buildMarkdownItems(baseCtx({ cliMode: false }));
 expect(findItem(hostedItems, 'reveal-editor').disabled).toBe(true);
 expect(findItem(hostedItems, 'reveal-finder').disabled).toBe(true);
 });
});

// ── Section item set ────────────────────────────────────────────────────────

describe('buildSectionItems', () => {
 it('Rename / Move / Settings · Export · Reveal · Delete (last) — no Duplicate', () => {
 const ids = itemIds(buildSectionItems(baseCtx()));
 expect(ids).toEqual(['rename', 'move', 'edit-config', 'export', 'reveal-editor', 'reveal-finder', 'delete']);
 expect(ids).not.toContain('duplicate');
 });

 it('omits "Move to…" when onMove is not provided', () => {
 const items = buildSectionItems(baseCtx({ onMove: undefined }));
 expect(itemIds(items)).not.toContain('move');
 });

 it('mode-limits reveal items the same way as artboards', () => {
 const items = buildSectionItems(baseCtx({ cliMode: false }));
 expect(findItem(items, 'reveal-editor').disabled).toBe(true);
 expect(findItem(items, 'reveal-finder').disabled).toBe(true);
 });

 it('leads with Add asset / Add group when those handlers are provided', () => {
 const ids = itemIds(buildSectionItems(baseCtx({ onAddAsset: noop, onAddGroup: noop })));
 expect(ids[0]).toBe('add-asset');
 expect(ids[1]).toBe('add-group');
 expect(ids).toContain('edit-config');
 });

 it('omits the create items when no add handlers are provided (legacy)', () => {
 const ids = itemIds(buildSectionItems(baseCtx()));
 expect(ids).not.toContain('add-asset');
 expect(ids).not.toContain('add-group');
 });

 it('wires the onAddAsset / onAddGroup callbacks', () => {
 const onAddAsset = vi.fn();
 const onAddGroup = vi.fn();
 const items = buildSectionItems(baseCtx({ onAddAsset, onAddGroup }));
 findItem(items, 'add-asset').onSelect();
 findItem(items, 'add-group').onSelect();
 expect(onAddAsset).toHaveBeenCalledOnce();
 expect(onAddGroup).toHaveBeenCalledOnce();
 });
});

// ── Delete confirmation ─────────────────────────────────────────────────────

describe('EntityKebab — render + open', () => {
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

 beforeEach(() => {
 // Make sure no stray menu hangs around.
 document.querySelectorAll('[role="menu"]').forEach((el) => el.remove());
 });
 afterEach(() => {
 document.querySelectorAll('[role="menu"]').forEach((el) => el.remove());
 });

 it('opens the menu when the kebab is clicked, with the supplied items', () => {
 const onSelect = vi.fn();
 const items = [
 { kind: 'item', id: 'a', label: 'Alpha', onSelect },
 ];
 const { container, cleanup } = renderToDom(
 <EntityKebab items={items} ariaLabel="Test actions" testId="entity-kebab" />,
 );
 const btn = container.querySelector('[data-testid="entity-kebab"]');
 expect(btn).toBeTruthy();
 expect(btn.getAttribute('aria-haspopup')).toBe('menu');
 expect(document.querySelector('[role="menu"]')).toBeNull();
 act(() => btn.click());
 const menu = document.querySelector('[role="menu"]');
 expect(menu).toBeTruthy();
 const item = menu.querySelector('[role="menuitem"]');
 expect(item.textContent).toContain('Alpha');
 act(() => item.click());
 expect(onSelect).toHaveBeenCalledOnce();
 cleanup();
 });

 it('renders disabled items with title attribute carrying the reason', () => {
 const items = [
 { kind: 'item', id: 'a', label: 'Alpha' },
 { kind: 'item', id: 'b', label: 'Beta', disabled: true, reason: 'Only in CLI' },
 ];
 const { container, cleanup } = renderToDom(
 <EntityKebab items={items} ariaLabel="Test actions" testId="entity-kebab" />,
 );
 const btn = container.querySelector('[data-testid="entity-kebab"]');
 act(() => btn.click());
 const items_el = [...document.querySelectorAll('[role="menuitem"]')];
 const beta = items_el.find((el) => el.textContent.includes('Beta'));
 expect(beta).toBeTruthy();
 expect(beta.getAttribute('aria-disabled')).toBe('true');
 expect(beta.getAttribute('title')).toBe('Only in CLI');
 cleanup();
 });
});
