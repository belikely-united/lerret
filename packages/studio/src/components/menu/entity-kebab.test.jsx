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
 applyDeleteConfirm,
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
 it('includes Edit data / Edit meta / Duplicate / Rename / Move / Delete / Export / Reveal', () => {
 const items = buildComponentItems(baseCtx());
 expect(itemIds(items)).toEqual([
 'edit-data',
 'edit-meta',
 'duplicate',
 'rename',
 'move',
 'delete',
 'export',
 'reveal-editor',
 'reveal-finder',
 ]);
 });

 it('positions "Move to…" between Rename and Delete', () => {
 const ids = itemIds(buildComponentItems(baseCtx()));
 const renameIdx = ids.indexOf('rename');
 const moveIdx = ids.indexOf('move');
 const deleteIdx = ids.indexOf('delete');
 expect(renameIdx).toBeGreaterThanOrEqual(0);
 expect(moveIdx).toBe(renameIdx + 1);
 expect(deleteIdx).toBe(moveIdx + 1);
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
 it('uses Edit (not Edit data/meta) and omits component-only items', () => {
 const items = buildMarkdownItems(baseCtx());
 const ids = itemIds(items);
 expect(ids).toContain('edit');
 expect(ids).not.toContain('edit-data');
 expect(ids).not.toContain('edit-meta');
 // Lifecycle items are present.
 expect(ids).toEqual([
 'edit',
 'duplicate',
 'rename',
 'move',
 'delete',
 'export',
 'reveal-editor',
 'reveal-finder',
 ]);
 });

 it('positions "Move to…" between Rename and Delete', () => {
 const ids = itemIds(buildMarkdownItems(baseCtx()));
 const renameIdx = ids.indexOf('rename');
 const moveIdx = ids.indexOf('move');
 const deleteIdx = ids.indexOf('delete');
 expect(moveIdx).toBe(renameIdx + 1);
 expect(deleteIdx).toBe(moveIdx + 1);
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
 it('includes Edit config / Rename / Move / Delete / Export / Reveal — no Duplicate', () => {
 const items = buildSectionItems(baseCtx());
 expect(itemIds(items)).toEqual([
 'edit-config',
 'rename',
 'move',
 'delete',
 'export',
 'reveal-editor',
 'reveal-finder',
 ]);
 // Folder kebab does NOT expose Duplicate — folder duplication isn't a
 // first-class surface (see the ACs).
 expect(itemIds(items)).not.toContain('duplicate');
 });

 it('positions "Move to…" between Rename and Delete', () => {
 const ids = itemIds(buildSectionItems(baseCtx()));
 const renameIdx = ids.indexOf('rename');
 const moveIdx = ids.indexOf('move');
 const deleteIdx = ids.indexOf('delete');
 expect(moveIdx).toBe(renameIdx + 1);
 expect(deleteIdx).toBe(moveIdx + 1);
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
});

// ── Delete confirmation ─────────────────────────────────────────────────────

describe('applyDeleteConfirm', () => {
 it('keeps the original items when not confirming', () => {
 const items = buildComponentItems(baseCtx());
 const out = applyDeleteConfirm(items, { confirming: false });
 expect(out).toBe(items);
 });

 it('replaces the delete item with Confirm + Cancel when confirming', () => {
 const items = buildComponentItems(baseCtx());
 const onConfirmDelete = vi.fn();
 const onCancelDelete = vi.fn();
 const out = applyDeleteConfirm(items, {
 confirming: true,
 onConfirmDelete,
 onCancelDelete,
 });
 const ids = itemIds(out);
 expect(ids).not.toContain('delete');
 expect(ids).toContain('delete-confirm');
 expect(ids).toContain('delete-cancel');
 findItem(out, 'delete-confirm').onSelect();
 expect(onConfirmDelete).toHaveBeenCalledOnce();
 findItem(out, 'delete-cancel').onSelect();
 expect(onCancelDelete).toHaveBeenCalledOnce();
 });
});

// ── EntityKebab render — kebab opens the Menu ───────────────────────────────

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
