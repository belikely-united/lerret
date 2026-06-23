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
import { setRecentsStore } from '../../runtime/hosted-recents.js';

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
 // Reset the injectable recents store so one test's fixtures can't leak.
 setRecentsStore(null);
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

 // Initial state: the primary "Open" action + the "Try a demo" (OPFS)
 // shortcut. No recents yet, so exactly these two (Epic 10 / H8).
 const allButtons = container.querySelectorAll('button');
 expect(allButtons.length).toBe(2);
 expect(container.querySelector('[data-testid="try-demo-button"]')).toBeTruthy();

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

 it('renders the connect-a-project screen in cliMode', () => {
 const { container, cleanup } = renderToDom(<OpenFolder cliMode />);

 // CLI mode is the runtime "connect a project" surface (POST switch-folder),
 // not the hosted FSA picker.
 const screen = container.querySelector('[data-testid="cli-connect-screen"]');
 expect(screen).toBeTruthy();

 // A folder-path field + a Connect button drive the switch.
 expect(container.querySelector('[data-testid="cli-connect-input"]')).toBeTruthy();
 expect(container.querySelector('[data-testid="cli-connect-button"]')).toBeTruthy();

 cleanup();
 });

 // ── 2.7 Resume affordance ────────────────────────────────────────────────

 it('renders a prominent Resume button for a resumeEntry and opens it on click', async () => {
 const handle = makeRecentHandle({ permission: 'prompt' });
 const onFolderPicked = vi.fn();
 const { container, cleanup } = renderToDom(
 <OpenFolder onFolderPicked={onFolderPicked} resumeEntry={{ id: 'p', name: 'My Deck', handle }} />,
 );

 const resumeBtn = container.querySelector('[data-testid="resume-project-button"]');
 expect(resumeBtn).toBeTruthy();
 expect(resumeBtn.textContent).toContain('My Deck');
 // The folder picker demotes to "Open a different folder".
 const openBtn = container.querySelector('[data-testid="open-folder-button"]');
 expect(openBtn.textContent).toContain('different');

 click(resumeBtn);
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
 expect(onFolderPicked).toHaveBeenCalledWith(handle);

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

 it('renders <OpenFolder> when File System Access API is supported (no recents)', async () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();
 setRecentsStore({ getAll: async () => [], put: async () => {}, remove: async () => {} });

 const { container, cleanup } = renderToDom(<EntryRoot onReady={vi.fn()} />);
 // The boot resume-probe runs first (brief splash); with no recents it
 // resolves straight to the picker.
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

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

 it('passes the onReady callback to <OpenFolder> via onFolderPicked (manual pick)', async () => {
 window.FileSystemDirectoryHandle = vi.fn();
 setRecentsStore({ getAll: async () => [], put: async () => {}, remove: async () => {} });

 const mockHandle = makeMockHandle({ hasLerret: true });
 window.showDirectoryPicker = vi.fn().mockResolvedValue(mockHandle);
 const onReady = vi.fn();

 const { container, cleanup } = renderToDom(<EntryRoot onReady={onReady} />);
 // Let the resume-probe resolve to the picker (no recents).
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

 const btn = container.querySelector('[data-testid="open-folder-button"]');
 click(btn);

 await act(async () => {
 await Promise.resolve();
 await Promise.resolve();
 });

 expect(onReady).toHaveBeenCalledWith(mockHandle);

 cleanup();
 });

 it('auto-restores the last project with ZERO clicks when permission is still granted', async () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();
 const handle = makeRecentHandle({ permission: 'granted' });
 setRecentsStore({
 getAll: async () => [{ id: 'Lerret-Test-project', name: 'Lerret-Test-project', handle, lastOpened: 1 }],
 put: async () => {},
 remove: async () => {},
 });
 const onReady = vi.fn();

 const { container, cleanup } = renderToDom(<EntryRoot onReady={onReady} />);
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

 // Probed silently (no gesture) and re-opened the folder — no picker shown.
 expect(handle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
 expect(onReady).toHaveBeenCalledWith(handle);
 expect(container.querySelector('[data-testid="open-folder-screen"]')).toBeNull();

 cleanup();
 });

 it('offers a ONE-CLICK Resume (no silent open) when permission has lapsed', async () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();
 const handle = makeRecentHandle({ permission: 'prompt' });
 setRecentsStore({
 getAll: async () => [{ id: 'Lerret-Test-project', name: 'Lerret-Test-project', handle, lastOpened: 1 }],
 put: async () => {},
 remove: async () => {},
 });
 const onReady = vi.fn();

 const { container, cleanup } = renderToDom(<EntryRoot onReady={onReady} />);
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

 // No silent open — the browser needs a user gesture to re-grant.
 expect(onReady).not.toHaveBeenCalled();
 // The picker shows a prominent Resume button naming the project.
 const resumeBtn = container.querySelector('[data-testid="resume-project-button"]');
 expect(resumeBtn).toBeTruthy();
 expect(resumeBtn.textContent).toContain('Lerret-Test-project');

 // Clicking it re-grants (the gesture) and opens.
 click(resumeBtn);
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
 expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
 expect(onReady).toHaveBeenCalledWith(handle);

 cleanup();
 });

 it('does NOT auto-restore when autoResume is false (Switch / Close project)', async () => {
 window.showDirectoryPicker = vi.fn();
 window.FileSystemDirectoryHandle = vi.fn();
 const handle = makeRecentHandle({ permission: 'granted' });
 setRecentsStore({
 getAll: async () => [{ id: 'Lerret-Test-project', name: 'Lerret-Test-project', handle, lastOpened: 1 }],
 put: async () => {},
 remove: async () => {},
 });
 const onReady = vi.fn();

 // Granted permission, but the user came here on purpose (returnedHome) — the
 // parent passes autoResume=false so we must NOT silently reopen.
 const { container, cleanup } = renderToDom(<EntryRoot onReady={onReady} autoResume={false} />);
 await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

 expect(onReady).not.toHaveBeenCalled();
 expect(container.querySelector('[data-testid="open-folder-screen"]')).toBeTruthy();
 const resumeBtn = container.querySelector('[data-testid="resume-project-button"]');
 expect(resumeBtn).toBeTruthy();
 expect(resumeBtn.textContent).toContain('Lerret-Test-project');

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

/**
 * Build a mock recent-project handle with a controllable permission state, for
 * the resume-on-load path. `queryPermission` drives the silent boot probe;
 * `requestPermission` is the one-click re-grant.
 *
 * @param {{ permission?: 'granted' | 'prompt' | 'denied' }} [opts]
 * @returns {FileSystemDirectoryHandle}
 */
function makeRecentHandle({ permission = 'granted' } = {}) {
 return {
 kind: 'directory',
 name: 'Lerret-Test-project',
 queryPermission: vi.fn().mockResolvedValue(permission),
 requestPermission: vi.fn().mockResolvedValue('granted'),
 getDirectoryHandle: vi.fn().mockResolvedValue({ kind: 'directory', name: '.lerret' }),
 };
}
