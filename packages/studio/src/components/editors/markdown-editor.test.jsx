// markdown-editor.test.jsx — Tests for the Markdown editor.
//
// Coverage:
// - Open/close lifecycle (sheet mounts and dismisses cleanly).
// - Text editing → debounced write after WRITE_DEBOUNCE_MS.
// - Blur → immediate write (the safety-net commit).
// - Failed-write shows a calm inline error with the file path.
// - Successful write shows the "Saved" flash.
// - Preview updates as the user types.
// - `prefers-reduced-motion` suppresses the preview transition.
// - Esc closes the sheet (via EditorSheet).
// - Re-seeding when a different entry is opened.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetSheetSingleton } from './editor-sheet.jsx';
import { MarkdownEditor } from './markdown-editor.jsx';

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => { root.render(element); });
 return {
 container,
 rerender(el) { act(() => root.render(el)); },
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

/** Advance fake timers by `ms` milliseconds inside an `act`. */
async function advanceTimers(ms) {
 await act(async () => {
 vi.advanceTimersByTime(ms);
 });
}

/**
 * Set a textarea's value the way React expects in jsdom (via the native value
 * setter so React's onChange picks it up).
 */
function setReactTextareaValue(el, value) {
 const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
 setter.call(el, value);
 el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Fire a blur event the React-friendly way (delegated via focusout). */
function fireBlur(el) {
 el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
}

/** Click the Source / Preview toggle (the editor shows one pane at a time). */
function clickTab(name) {
 const tab = document.querySelector(`[data-testid="lm-md-editor-tab-${name}"]`);
 act(() => { tab.click(); });
}

// ── Test fixtures ────────────────────────────────────────────────────────────

const releaseNotesEntry = {
 id: '/project/.lerret/documents/Release-Notes.md',
 asset: {
 path: '/project/.lerret/documents/Release-Notes.md',
 name: 'Release-Notes',
 assetKind: 'markdown',
 },
 label: 'Release Notes',
 text: '# Release Notes\n\nInitial content.',
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
 _resetSheetSingleton();
 vi.useFakeTimers({ shouldAdvanceTime: false });
 // Default: motion allowed, CLI mode on.
 vi.stubGlobal('matchMedia', (query) => ({
 matches: false,
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));
 globalThis.__LERRET_CLI_MODE__ = true;
});

afterEach(() => {
 _resetSheetSingleton();
 vi.useRealTimers();
 vi.unstubAllGlobals();
 vi.restoreAllMocks();
 delete globalThis.__LERRET_CLI_MODE__;
});

// ── Open / close lifecycle ────────────────────────────────────────────────────

describe('MarkdownEditor — open/close lifecycle', () => {
 it('renders the editor sheet when open=true', () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });
 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog).not.toBeNull();
 expect(dialog.getAttribute('aria-modal')).toBe('true');

 cleanup();
 });

 it('renders nothing when open=false', () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor open={false} onClose={() => {}} entry={releaseNotesEntry} />,
 );

 expect(document.querySelector('[role="dialog"]')).toBeNull();
 cleanup();
 });

 it('calls onClose when Esc is pressed (reduced-motion path — synchronous)', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });
 const onClose = vi.fn();

 // Stub reduced-motion so the EditorSheet's dismiss fires synchronously.
 vi.stubGlobal('matchMedia', (query) => ({
 matches: query === '(prefers-reduced-motion: reduce)',
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={onClose} entry={releaseNotesEntry} writer={writer} />,
 );

 act(() => {
 document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
 });

 expect(onClose).toHaveBeenCalled();
 cleanup();
 });

 it('pre-fills the textarea with the entry text', () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 expect(ta).not.toBeNull();
 expect(ta.value).toBe(releaseNotesEntry.text);

 cleanup();
 });

 it('uses initialText over entry.text when both are present', () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor
 open
 onClose={() => {}}
 entry={releaseNotesEntry}
 initialText="Override text"
 />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 expect(ta.value).toBe('Override text');
 cleanup();
 });
});

// ── Text editing → debounced write ────────────────────────────────────────────

describe('MarkdownEditor — debounced write on text change', () => {
 it('does NOT write immediately on keystroke (before debounce expires)', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => {
 setReactTextareaValue(ta, '# Updated\n\nHello');
 });

 // Writer should not have been called yet — still within the debounce window.
 expect(writer).not.toHaveBeenCalled();

 cleanup();
 });

 it('writes to the file path after the debounce delay', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => {
 setReactTextareaValue(ta, '# Updated\n\nHello');
 });

 // Advance time past the 400 ms debounce.
 await advanceTimers(450);
 // Allow promises to flush.
 await act(async () => {});

 expect(writer).toHaveBeenCalledTimes(1);
 const [path, content] = writer.mock.calls[0];
 expect(path).toBe(releaseNotesEntry.asset.path);
 expect(content).toBe('# Updated\n\nHello');

 cleanup();
 });

 it('resets the debounce on rapid keystrokes (only writes the final value)', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');

 // Two quick keystrokes within the debounce window.
 await act(async () => { setReactTextareaValue(ta, 'First'); });
 await advanceTimers(100);
 await act(async () => { setReactTextareaValue(ta, 'Second'); });
 await advanceTimers(450);
 await act(async () => {});

 // Only one write with the final value.
 expect(writer).toHaveBeenCalledTimes(1);
 const [, content] = writer.mock.calls[0];
 expect(content).toBe('Second');

 cleanup();
 });

 it('flashes "Saved" after a successful write', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => { setReactTextareaValue(ta, '## Updated'); });
 await advanceTimers(450);
 await act(async () => {});

 const saved = document.querySelector('[data-testid="lm-md-editor-saved"]');
 expect(saved).not.toBeNull();
 expect(saved.getAttribute('data-visible')).toBe('');

 cleanup();
 });
});

// ── Blur → immediate write ───────────────────────────────────────────────────

describe('MarkdownEditor — blur triggers immediate write', () => {
 it('writes immediately on blur, cancelling the pending debounce', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => {
 setReactTextareaValue(ta, '# Blur test');
 });

 // Blur BEFORE the debounce fires.
 await act(async () => {
 fireBlur(ta);
 });
 await act(async () => {});

 // The write happens immediately due to blur, not after 400 ms.
 expect(writer).toHaveBeenCalledTimes(1);
 const [path, content] = writer.mock.calls[0];
 expect(path).toBe(releaseNotesEntry.asset.path);
 expect(content).toBe('# Blur test');

 // Advance past the debounce — should not trigger a second write.
 await advanceTimers(450);
 await act(async () => {});
 expect(writer).toHaveBeenCalledTimes(1);

 cleanup();
 });
});

// ── Failed-write inline error ────────────────────────────────────────────────

describe('MarkdownEditor — failed-write inline error', () => {
 it('shows a calm error banner with the file path on write failure', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: false, error: 'disk full' });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => { setReactTextareaValue(ta, '# Error test'); });
 await advanceTimers(450);
 await act(async () => {});

 const banner = document.querySelector('[data-testid="lm-md-editor-error"]');
 expect(banner).not.toBeNull();
 expect(banner.textContent).toContain('disk full');
 // The error banner includes the file path for diagnosability (NFR9).
 expect(banner.textContent).toContain(releaseNotesEntry.asset.path);

 cleanup();
 });

 it('keeps the dialog open and usable after a write failure', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: false, error: 'network error' });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => { setReactTextareaValue(ta, '# Error test'); });
 await advanceTimers(450);
 await act(async () => {});

 // Editor sheet is still present.
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 // Textarea is still in the DOM.
 expect(document.querySelector('[data-testid="lm-md-editor-textarea"]')).not.toBeNull();

 cleanup();
 });

 it('clears the error banner on a subsequent successful write', async () => {
 const writer = vi.fn()
 .mockResolvedValueOnce({ ok: false, error: 'transient error' })
 .mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');

 // First write — fails.
 await act(async () => { setReactTextareaValue(ta, '# First'); });
 await advanceTimers(450);
 await act(async () => {});
 expect(document.querySelector('[data-testid="lm-md-editor-error"]')).not.toBeNull();

 // Second write — succeeds.
 await act(async () => { setReactTextareaValue(ta, '# Second'); });
 await advanceTimers(450);
 await act(async () => {});
 expect(document.querySelector('[data-testid="lm-md-editor-error"]')).toBeNull();

 cleanup();
 });
});

// ── Live preview updates ─────────────────────────────────────────────────────

describe('MarkdownEditor — live preview', () => {
 it('renders the initial text in the preview pane', () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} />,
 );

 clickTab('preview');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview).not.toBeNull();
 // The preview should contain rendered text from the initial markdown.
 expect(preview.textContent).toContain('Release Notes');

 cleanup();
 });

 it('updates the preview as the user types', async () => {
 const onTextChange = vi.fn();
 const { cleanup } = renderToDom(
 <MarkdownEditor
 open
 onClose={() => {}}
 entry={releaseNotesEntry}
 onTextChange={onTextChange}
 />,
 );

 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => {
 setReactTextareaValue(ta, '## Brand new heading');
 });

 clickTab('preview');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview.textContent).toContain('Brand new heading');
 // The onTextChange hook was called.
 expect(onTextChange).toHaveBeenCalledWith('## Brand new heading');

 cleanup();
 });

 it('shows "Empty document" when the text is blank', async () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor
 open
 onClose={() => {}}
 entry={{ ...releaseNotesEntry, text: '' }}
 initialText=""
 />,
 );

 clickTab('preview');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview.textContent).toContain('Empty document');

 cleanup();
 });
});

// ── prefers-reduced-motion ────────────────────────────────────────────────────

describe('MarkdownEditor — prefers-reduced-motion', () => {
 it('sets data-reduced-motion on the preview pane when motion is reduced', () => {
 // Stub reduced-motion preference.
 vi.stubGlobal('matchMedia', (query) => ({
 matches: query === '(prefers-reduced-motion: reduce)',
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} />,
 );

 clickTab('preview');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview).not.toBeNull();
 // The `data-reduced-motion` attribute drives the CSS `transition: none`.
 expect(preview.hasAttribute('data-reduced-motion')).toBe(true);

 cleanup();
 });

 it('does NOT set data-reduced-motion when motion is allowed', () => {
 vi.stubGlobal('matchMedia', (query) => ({
 matches: false, // motion allowed
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));

 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} />,
 );

 clickTab('preview');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview.hasAttribute('data-reduced-motion')).toBe(false);

 cleanup();
 });
});

// ── Re-seeding on entry change ────────────────────────────────────────────────

describe('MarkdownEditor — re-seeds when entry changes', () => {
 it('resets textarea and preview when a different entry is passed', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });
 const onClose = vi.fn();

 const entryA = {
 ...releaseNotesEntry,
 text: '# Document A',
 };
 const entryB = {
 id: '/project/.lerret/documents/Empty.md',
 asset: {
 path: '/project/.lerret/documents/Empty.md',
 name: 'Empty',
 assetKind: 'markdown',
 },
 label: 'Empty',
 text: '# Document B',
 };

 const { rerender, cleanup } = renderToDom(
 <MarkdownEditor open onClose={onClose} entry={entryA} writer={writer} />,
 );

 let ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 expect(ta.value).toBe('# Document A');

 // Swap to a different entry.
 rerender(<MarkdownEditor open onClose={onClose} entry={entryB} writer={writer} />);
 await act(async () => {});

 ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 expect(ta.value).toBe('# Document B');

 cleanup();
 });
});

// ── Source / Preview toggle ───────────────────────────────────────────────────

describe('MarkdownEditor — source/preview toggle', () => {
 it('defaults to Source and toggles to Preview and back (one pane at a time)', () => {
 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} />,
 );
 // Source by default: textarea shown, preview not mounted.
 expect(document.querySelector('[data-testid="lm-md-editor-textarea"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="lm-md-editor-preview"]')).toBeNull();
 expect(
 document.querySelector('[data-testid="lm-md-editor-tab-source"]').getAttribute('aria-selected'),
 ).toBe('true');

 // Switch to Preview: preview mounts full-width, textarea unmounts.
 clickTab('preview');
 expect(document.querySelector('[data-testid="lm-md-editor-preview"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="lm-md-editor-textarea"]')).toBeNull();
 expect(
 document.querySelector('[data-testid="lm-md-editor-tab-preview"]').getAttribute('aria-selected'),
 ).toBe('true');

 // Back to Source.
 clickTab('source');
 expect(document.querySelector('[data-testid="lm-md-editor-textarea"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="lm-md-editor-preview"]')).toBeNull();

 cleanup();
 });

 it('flushes a pending edit when switching to Preview (no lost text)', async () => {
 const writer = vi.fn().mockResolvedValue({ ok: true });
 const { cleanup } = renderToDom(
 <MarkdownEditor open onClose={() => {}} entry={releaseNotesEntry} writer={writer} />,
 );
 const ta = document.querySelector('[data-testid="lm-md-editor-textarea"]');
 await act(async () => { setReactTextareaValue(ta, '# Edited before toggle'); });
 // Switch to Preview before the debounce fires — the edit flushes + renders.
 clickTab('preview');
 expect(writer).toHaveBeenCalledWith(releaseNotesEntry.asset.path, '# Edited before toggle');
 const preview = document.querySelector('[data-testid="lm-md-editor-preview"]');
 expect(preview.textContent).toContain('Edited before toggle');
 cleanup();
 });
});
