// Tests for the dock page picker (`page-picker.jsx`, , UX-DR1).
//
// These assert the two shapes the picker takes and its keyboard operability:
// • exactly one page → a static label, no dropdown;
// • more than one page → a dropdown that shows the current page, switches
// pages on selection, and is fully keyboard-operable (open, arrow-nav,
// Enter to select, Esc to dismiss).
//
// Rendering uses `react-dom/client` into a detached jsdom container — the same
// dependency-free pattern as the other studio component tests.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PagePicker } from './page-picker.jsx';

/** Mount an element into a detached jsdom container; returns it + a teardown. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 rerender(next) {
 act(() => root.render(next));
 },
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

/** Dispatch a keydown for `key` on `node`. */
function keyDown(node, key) {
 act(() => {
 node.dispatchEvent(
 new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
 );
 });
}

// The dropdown's listbox is portaled to `document.body` (so the dock's
// `overflow` cannot clip it), so it is NOT inside the test render container —
// these helpers query the whole document for the portaled popover.
const findListbox = () => document.querySelector('[role="listbox"]');
const findOptions = () => [...document.querySelectorAll('[role="option"]')];

const ONE_PAGE = [{ id: '/p/home', label: 'Home' }];
const THREE_PAGES = [
 { id: '/p/home', label: 'Home' },
 { id: '/p/about', label: 'About' },
 { id: '/p/contact', label: 'Contact' },
];

describe('PagePicker — single page', () => {
 it('renders a static label, not a dropdown, for exactly one page', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={ONE_PAGE} current="/p/home" onNavigate={() => {}} />,
 );
 const root = container.querySelector('[data-page-picker]');
 expect(root).toBeTruthy();
 expect(root.getAttribute('data-page-picker')).toBe('static');
 // No interactive trigger, no listbox.
 expect(container.querySelector('button')).toBeNull();
 expect(container.querySelector('[role="listbox"]')).toBeNull();
 expect(container.textContent).toContain('Home');
 cleanup();
 });

 it('renders nothing for a project with zero pages', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={[]} current="" onNavigate={() => {}} />,
 );
 expect(container.querySelector('[data-page-picker]')).toBeNull();
 cleanup();
 });
});

describe('PagePicker — multiple pages', () => {
 it('renders a dropdown trigger showing the current page', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/about" onNavigate={() => {}} />,
 );
 const root = container.querySelector('[data-page-picker]');
 expect(root.getAttribute('data-page-picker')).toBe('dropdown');
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 expect(trigger).toBeTruthy();
 expect(trigger.getAttribute('aria-expanded')).toBe('false');
 // The trigger shows the *current* page label.
 expect(trigger.textContent).toContain('About');
 cleanup();
 });

 it('opens the listbox on click and lists every page', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={() => {}} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 act(() => trigger.click());
 const listbox = findListbox();
 expect(listbox).toBeTruthy();
 expect(trigger.getAttribute('aria-expanded')).toBe('true');
 const options = findOptions();
 expect(options.length).toBe(3);
 // The current page's option is aria-selected.
 const selected = document.querySelector('[role="option"][aria-selected="true"]');
 expect(selected.textContent).toContain('Home');
 cleanup();
 });

 it('switches pages when an option is clicked', () => {
 const onNavigate = vi.fn();
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={onNavigate} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 act(() => trigger.click());
 const contact = findOptions().find((o) => o.textContent.includes('Contact'));
 act(() => contact.click());
 expect(onNavigate).toHaveBeenCalledWith('/p/contact');
 // The listbox closes after a pick.
 expect(findListbox()).toBeNull();
 cleanup();
 });

 it('does not navigate when the already-current page is picked', () => {
 const onNavigate = vi.fn();
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={onNavigate} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 act(() => trigger.click());
 const home = findOptions().find((o) => o.textContent.includes('Home'));
 act(() => home.click());
 expect(onNavigate).not.toHaveBeenCalled();
 cleanup();
 });

 it('is keyboard-operable: ArrowDown opens, arrows navigate, Enter selects', () => {
 const onNavigate = vi.fn();
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={onNavigate} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 // ArrowDown on the trigger opens the listbox.
 keyDown(trigger, 'ArrowDown');
 const listbox = findListbox();
 expect(listbox).toBeTruthy();
 // The highlight starts on the current page (index 0 = Home).
 expect(listbox.getAttribute('aria-activedescendant')).toBe('lerret-page-picker-option-0');
 // ArrowDown twice → highlight on index 2 (Contact).
 keyDown(listbox, 'ArrowDown');
 keyDown(listbox, 'ArrowDown');
 expect(listbox.getAttribute('aria-activedescendant')).toBe('lerret-page-picker-option-2');
 // Enter selects the highlighted page.
 keyDown(listbox, 'Enter');
 expect(onNavigate).toHaveBeenCalledWith('/p/contact');
 cleanup();
 });

 it('ArrowUp from the first option wraps to the last', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={() => {}} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 keyDown(trigger, 'ArrowDown');
 const listbox = findListbox();
 // Highlight is on index 0; ArrowUp wraps to the last (index 2).
 keyDown(listbox, 'ArrowUp');
 expect(listbox.getAttribute('aria-activedescendant')).toBe('lerret-page-picker-option-2');
 cleanup();
 });

 it('Escape closes the listbox without navigating', () => {
 const onNavigate = vi.fn();
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/home" onNavigate={onNavigate} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 act(() => trigger.click());
 expect(findListbox()).toBeTruthy();
 keyDown(findListbox(), 'Escape');
 expect(findListbox()).toBeNull();
 expect(onNavigate).not.toHaveBeenCalled();
 cleanup();
 });

 it('Home / End jump the highlight to the first / last page', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={THREE_PAGES} current="/p/about" onNavigate={() => {}} />,
 );
 const trigger = container.querySelector('button[aria-haspopup="listbox"]');
 keyDown(trigger, 'ArrowDown');
 const listbox = findListbox();
 keyDown(listbox, 'End');
 expect(listbox.getAttribute('aria-activedescendant')).toBe('lerret-page-picker-option-2');
 keyDown(listbox, 'Home');
 expect(listbox.getAttribute('aria-activedescendant')).toBe('lerret-page-picker-option-0');
 cleanup();
 });
});

describe('PagePicker — manager mode (CLI)', () => {
 const PROJECT = {
 path: '/.lerret',
 pages: [
 { path: '/p/home', name: 'home', groups: [{}], assets: [{}, {}] },
 { path: '/p/about', name: 'about', groups: [], assets: [] },
 ],
 };
 const pages = [
 { id: '/p/home', label: 'home' },
 { id: '/p/about', label: 'about' },
 ];

 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 document.querySelectorAll('[role="listbox"],[data-testid="lm-confirm-dialog"],[data-testid="lm-create-dialog"]').forEach((el) => el.remove());
 });

 it('offers "New page" + a per-page delete in the dropdown', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={pages} current="/p/home" onNavigate={() => {}} projectModel={PROJECT} />,
 );
 const trigger = container.querySelector('button');
 act(() => trigger.click());
 expect(document.querySelector('[data-testid="page-picker-new"]')).not.toBeNull();
 expect(document.querySelectorAll('[data-testid="page-picker-delete"]').length).toBe(2);
 cleanup();
 });

 it('opens a confirm dialog (with a warning) when a page delete is clicked', () => {
 const { container, cleanup } = renderToDom(
 <PagePicker pages={pages} current="/p/home" onNavigate={() => {}} projectModel={PROJECT} />,
 );
 act(() => container.querySelector('button').click());
 const del = document.querySelector('[data-testid="page-picker-delete"]');
 act(() => del.click());
 const dialog = document.querySelector('[data-testid="lm-confirm-dialog"]');
 expect(dialog).not.toBeNull();
 expect(dialog.textContent).toMatch(/delete page/i);
 // The home page has 1 group + 2 assets → the warning names the contents.
 expect(dialog.textContent).toMatch(/can.t be undone/i);
 cleanup();
 });

 it('stays a switch-only static label outside CLI mode', () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const { container, cleanup } = renderToDom(
 <PagePicker pages={[{ id: '/p/home', label: 'home' }]} current="/p/home" onNavigate={() => {}} projectModel={PROJECT} />,
 );
 // One page, non-CLI → static label, no dropdown trigger, no manage affordances.
 expect(container.querySelector('[data-page-picker="static"]')).not.toBeNull();
 cleanup();
 });
});
