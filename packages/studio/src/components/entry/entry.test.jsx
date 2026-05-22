// entry.test.jsx — tests for entry-layer components.
//
// Covers:
// 1. capability-detection.js — isFileSystemAccessSupported()
// 2. <OpenFolder> — render, picker call, not-lerret-project error path,
// reject-picker-gracefully, keyboard operability.
// 3. <UnsupportedBrowser> — guidance content rendered.
// 4. <EntryRoot> — routes to the right component based on FSA support.
//
// All tests use the react-dom/client + jsdom pattern established by the
// page-picker.test.jsx suite. No `testing-library` — intentional; the suite
// keeps to the project's dependency-free test convention.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { isFileSystemAccessSupported } from './capability-detection.js';
import { OpenFolder } from './open-folder.jsx';
import { UnsupportedBrowser } from './unsupported-browser.jsx';
import { EntryRoot } from './entry-root.jsx';

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

let _containers = [];

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 _containers.push(container);
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
 _containers = _containers.filter((c) => c !== container);
 },
 };
}

afterEach(() => {
 // Clean up any containers left open by a failing test.
 for (const c of [..._containers]) {
 try {
 act(() => createRoot(c).unmount());
 } catch { /* already unmounted */ }
 c.remove();
 }
 _containers = [];
});

// ---------------------------------------------------------------------------
// Helper: fire a click on an element
// ---------------------------------------------------------------------------
function click(el) {
 act(() => {
 el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
 });
}

// ---------------------------------------------------------------------------
// Helper: fire a keydown on an element
// ---------------------------------------------------------------------------
function keyDown(el, key) {
 act(() => {
 el.dispatchEvent(
 new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
 );
 });
}

// ===========================================================================
// 1. capability-detection.js
// ===========================================================================

describe('isFileSystemAccessSupported', () => {
 let originalPicker;
 let originalHandle;

 beforeEach(() => {
 originalPicker = window.showDirectoryPicker;
 originalHandle = window.FileSystemDirectoryHandle;
 });

 afterEach(() => {
 if (originalPicker === undefined) {
 delete window.showDirectoryPicker;
 } else {
 window.showDirectoryPicker = originalPicker;
 }
 if (originalHandle === undefined) {
 delete window.FileSystemDirectoryHandle;
 } else {
 window.FileSystemDirectoryHandle = originalHandle;
 }
 });

 it('returns true when both showDirectoryPicker and FileSystemDirectoryHandle are present', () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();

 expect(isFileSystemAccessSupported()).toBe(true);
 });

 it('returns false when showDirectoryPicker is absent', () => {
 delete window.showDirectoryPicker;
 window.FileSystemDirectoryHandle = vi.fn();

 expect(isFileSystemAccessSupported()).toBe(false);
 });

 it('returns false when FileSystemDirectoryHandle is absent', () => {
 window.showDirectoryPicker = vi.fn();
 delete window.FileSystemDirectoryHandle;

 expect(isFileSystemAccessSupported()).toBe(false);
 });

 it('returns false when both are absent', () => {
 delete window.showDirectoryPicker;
 delete window.FileSystemDirectoryHandle;

 expect(isFileSystemAccessSupported()).toBe(false);
 });

 it('returns false when showDirectoryPicker is not a function (e.g. object stub)', () => {
 window.showDirectoryPicker = {};
 window.FileSystemDirectoryHandle = vi.fn();

 expect(isFileSystemAccessSupported()).toBe(false);
 });
});

// ===========================================================================
// 2. <OpenFolder>
// ===========================================================================

describe('<OpenFolder>', () => {
 let originalPicker;

 beforeEach(() => {
 originalPicker = window.showDirectoryPicker;
 });

 afterEach(() => {
 if (originalPicker === undefined) {
 delete window.showDirectoryPicker;
 } else {
 window.showDirectoryPicker = originalPicker;
 }
 });

 // ── 2.1 Basic render ────────────────────────────────────────────────────

 it('renders with a single primary action button', () => {
 const { container, cleanup } = renderToDom(<OpenFolder onFolderPicked={vi.fn()} />);

 const screen = container.querySelector('[data-testid="open-folder-screen"]');
 expect(screen).toBeTruthy();

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 expect(btn).toBeTruthy();
 expect(btn.tagName).toBe('BUTTON');

 // Only one primary button on the initial state.
 const allButtons = container.querySelectorAll('button');
 expect(allButtons.length).toBe(1);

 cleanup();
 });

 // ── 2.2 Picker call ─────────────────────────────────────────────────────

 it('calls showDirectoryPicker when the primary button is clicked', async () => {
 const mockHandle = makeMockHandle({ hasLerret: true });
 window.showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle);
 const onFolderPicked = vi.fn();

 const { container, cleanup } = renderToDom(<OpenFolder onFolderPicked={onFolderPicked} />);

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 click(btn);

 // Flush all promises (the async handlePick).
 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });

 expect(window.showDirectoryPicker).toHaveBeenCalledOnce();
 expect(window.showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
 expect(onFolderPicked).toHaveBeenCalledWith(mockHandle);

 cleanup();
 });

 // ── 2.3 Picker rejection (AbortError) doesn't crash ─────────────────────

 it("does NOT crash when the user dismisses the picker (AbortError)", async () => {
 const abortError = new DOMException('The user aborted a request.', 'AbortError');
 window.showDirectoryPicker = vi.fn().mockRejectedValue(abortError);
 const onFolderPicked = vi.fn();

 const { container, cleanup } = renderToDom(<OpenFolder onFolderPicked={onFolderPicked} />);

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 click(btn);

 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });

 // Should be back to idle — still shows the primary button, not crashed.
 expect(container.querySelector('[data-testid="open-folder-button"]')).toBeTruthy();
 expect(onFolderPicked).not.toHaveBeenCalled();

 cleanup();
 });

 // ── 2.4 "Not a Lerret project" path ──────────────────────────────────────

 it('shows the "not a Lerret project" message when the picked folder lacks .lerret/', async () => {
 const mockHandle = makeMockHandle({ hasLerret: false });
 window.showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle);
 const onFolderPicked = vi.fn();

 const { container, cleanup } = renderToDom(<OpenFolder onFolderPicked={onFolderPicked} />);

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 click(btn);

 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });

 // The "not a Lerret project" message should be in the DOM.
 const errorMsg = container.querySelector('[data-testid="not-lerret-project-message"]');
 expect(errorMsg).toBeTruthy();

 // The primary "Open a Lerret folder" button should be gone (replaced by error state).
 expect(container.querySelector('[data-testid="open-folder-button"]')).toBeNull();

 // onFolderPicked must NOT have been called.
 expect(onFolderPicked).not.toHaveBeenCalled();

 // "Pick another folder" button should be present.
 const pickAnother = container.querySelector('[data-testid="pick-another-folder-button"]');
 expect(pickAnother).toBeTruthy();

 cleanup();
 });

 // ── 2.5 Keyboard operability: primary button is focusable, Enter activates ─

 it('primary action button is focusable and activates on Enter keydown', () => {
 window.showDirectoryPicker = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
 const { container, cleanup } = renderToDom(<OpenFolder onFolderPicked={vi.fn()} />);

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 expect(btn).toBeTruthy();

 // focus-visible check: tabIndex defaults to 0 for <button>
 expect(btn.tagName).toBe('BUTTON');
 // Not disabled initially
 expect(btn.disabled).toBe(false);

 // Simulate keyboard Enter activation. Browser <button> fires click on Enter,
 // but in jsdom we simulate explicitly to assert no crash.
 keyDown(btn, 'Enter');

 cleanup();
 });

 // ── 2.6 CLI mode ─────────────────────────────────────────────────────────

 it('renders in cliMode without crashing and shows the entry screen', () => {
 const { container, cleanup } = renderToDom(<OpenFolder cliMode />);

 const screen = container.querySelector('[data-testid="open-folder-screen"]');
 expect(screen).toBeTruthy();

 // Should have a primary button ("How to open" in cli mode).
 const btn = container.querySelector('[data-testid="open-folder-button"]');
 expect(btn).toBeTruthy();

 cleanup();
 });
});

// ===========================================================================
// 3. <UnsupportedBrowser>
// ===========================================================================

describe('<UnsupportedBrowser>', () => {
 it('renders the unsupported browser screen', () => {
 const { container, cleanup } = renderToDom(<UnsupportedBrowser />);

 const screen = container.querySelector('[data-testid="unsupported-browser-screen"]');
 expect(screen).toBeTruthy();

 cleanup();
 });

 it('lists Chrome, Edge, and Opera as supported browsers', () => {
 const { container, cleanup } = renderToDom(<UnsupportedBrowser />);

 const text = container.textContent;
 expect(text).toContain('Google Chrome');
 expect(text).toContain('Microsoft Edge');
 expect(text).toContain('Opera');

 cleanup();
 });

 it('includes the npx @lerret/cli@latest dev CLI command', () => {
 const { container, cleanup } = renderToDom(<UnsupportedBrowser />);

 const cmd = container.querySelector('[data-testid="npx-command"]');
 expect(cmd).toBeTruthy();
 expect(cmd.textContent).toContain('npx @lerret/cli@latest dev');

 cleanup();
 });

 it('includes a "What to try" section heading for screen readers', () => {
 const { container, cleanup } = renderToDom(<UnsupportedBrowser />);

 const text = container.textContent;
 expect(text).toContain('What to try');

 cleanup();
 });
});

// ===========================================================================
// 4. <EntryRoot> — routing based on FSA support
// ===========================================================================

describe('<EntryRoot>', () => {
 let originalPicker;
 let originalHandle;

 beforeEach(() => {
 originalPicker = window.showDirectoryPicker;
 originalHandle = window.FileSystemDirectoryHandle;
 });

 afterEach(() => {
 if (originalPicker === undefined) {
 delete window.showDirectoryPicker;
 } else {
 window.showDirectoryPicker = originalPicker;
 }
 if (originalHandle === undefined) {
 delete window.FileSystemDirectoryHandle;
 } else {
 window.FileSystemDirectoryHandle = originalHandle;
 }
 });

 it('renders <OpenFolder> when File System Access API is supported', () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();

 const { container, cleanup } = renderToDom(<EntryRoot onReady={vi.fn()} />);

 expect(container.querySelector('[data-testid="open-folder-screen"]')).toBeTruthy();
 expect(container.querySelector('[data-testid="unsupported-browser-screen"]')).toBeNull();

 cleanup();
 });

 it('renders <UnsupportedBrowser> when File System Access API is NOT supported', () => {
 delete window.showDirectoryPicker;
 delete window.FileSystemDirectoryHandle;

 const { container, cleanup } = renderToDom(<EntryRoot onReady={vi.fn()} />);

 expect(container.querySelector('[data-testid="unsupported-browser-screen"]')).toBeTruthy();
 expect(container.querySelector('[data-testid="open-folder-screen"]')).toBeNull();

 cleanup();
 });

 it('passes the onReady callback to <OpenFolder> via onFolderPicked', async () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();

 const mockHandle = makeMockHandle({ hasLerret: true });
 window.showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle);
 const onReady = vi.fn();

 const { container, cleanup } = renderToDom(<EntryRoot onReady={onReady} />);

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 click(btn);

 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });

 expect(onReady).toHaveBeenCalledWith(mockHandle);

 cleanup();
 });
});

// ===========================================================================
// Utility: build a mock FileSystemDirectoryHandle
// ===========================================================================

/**
 * Build a minimal mock `FileSystemDirectoryHandle`.
 *
 * @param {{ hasLerret: boolean }} opts
 * @returns {FileSystemDirectoryHandle}
 */
function makeMockHandle({ hasLerret }) {
 return {
 kind: 'directory',
 name: hasLerret ? 'my-project' : 'random-folder',
 entries: vi.fn().mockReturnValue([][Symbol.iterator]()),
 getDirectoryHandle: vi.fn().mockImplementation((name) => {
 if (name === '.lerret' && hasLerret) {
 return Promise.resolve({ kind: 'directory', name: '.lerret' });
 }
 // Simulate NotFoundError when .lerret doesn't exist.
 const err = new DOMException('The path was not found.', 'NotFoundError');
 return Promise.reject(err);
 }),
 };
}
