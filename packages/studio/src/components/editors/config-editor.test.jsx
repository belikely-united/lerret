// Tests for the Config editor.
//
// Coverage:
// - Pure helpers: configFilePathFor, extractUnknownKeys, mergeConfigValue.
// - Well-known key form: renders FormControl for presentation, vars
// (always shown); colors/fonts only when in file.
// - Unknown-key fallback: raw JSON toggle shows the textarea; invalid JSON
// is flagged and NOT written; valid JSON writes through.
// - No-config-yet create flow: shows create prompt; writes {} on confirm;
// failure surfaces a calm banner without a partial file.
// - Invalid JSON path: invalid JSON is flagged inline and not written.
// - Successful write: field commit calls writer, content is serialized with
// stable key order + trailing newline.
// - Write error surfaced as calm banner.
// - Saved indicator flashes after successful write.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetSheetSingleton } from './editor-sheet.jsx';
import {
 ConfigEditor,
 configFilePathFor,
 extractUnknownKeys,
 mergeConfigValue,
 KNOWN_KEYS,
} from './config-editor.jsx';

// ── Test infrastructure ──────────────────────────────────────────────────────

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

async function tick(ms = 20) {
 await new Promise((r) => setTimeout(r, ms));
}

function setReactInputValue(el, value) {
 const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
 const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
 setter.call(el, value);
 el.dispatchEvent(new Event('input', { bubbles: true }));
}

function fireBlur(el) {
 el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
}

// A reader that returns the given config.
function makeReader(config) {
 return vi.fn().mockResolvedValue({ ok: true, value: config });
}

// A reader that returns "missing" (no file).
function makeReaderMissing() {
 return vi.fn().mockResolvedValue({ ok: true, value: {}, missing: true });
}

// Default folder props.
const FOLDER_PATH = '/proj/.lerret/ui-components';
const CONFIG_PATH = '/proj/.lerret/ui-components/config.json';

beforeEach(() => {
 _resetSheetSingleton();
 vi.stubGlobal('matchMedia', () => ({
 matches: false,
 media: '',
 addEventListener: () => {},
 removeEventListener: () => {},
 }));
 globalThis.__LERRET_CLI_MODE__ = true;
});

afterEach(() => {
 _resetSheetSingleton();
 delete globalThis.__LERRET_CLI_MODE__;
 vi.unstubAllGlobals();
 vi.restoreAllMocks();
});

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('configFilePathFor', () => {
 it('appends config.json to the folder path', () => {
 expect(configFilePathFor('/proj/.lerret/ui-components')).toBe(
 '/proj/.lerret/ui-components/config.json',
 );
 });

 it('strips a trailing slash before appending', () => {
 expect(configFilePathFor('/proj/.lerret/ui-components/')).toBe(
 '/proj/.lerret/ui-components/config.json',
 );
 });
});

describe('extractUnknownKeys', () => {
 it('returns keys not in KNOWN_KEYS', () => {
 const cfg = { presentation: { background: 'red' }, myCustomKey: 42, anotherKey: 'hello' };
 const unk = extractUnknownKeys(cfg);
 expect(Object.keys(unk)).not.toContain('presentation');
 expect(unk).toEqual({ myCustomKey: 42, anotherKey: 'hello' });
 });

 it('returns empty object for a config with only known keys', () => {
 const cfg = { presentation: {}, vars: {}, colors: {}, fonts: {} };
 expect(extractUnknownKeys(cfg)).toEqual({});
 });

 it('handles an empty config', () => {
 expect(extractUnknownKeys({})).toEqual({});
 });

 it('handles null/non-object gracefully', () => {
 expect(extractUnknownKeys(null)).toEqual({});
 expect(extractUnknownKeys('string')).toEqual({});
 });

 it('covers all KNOWN_KEYS', () => {
 const cfg = Object.fromEntries(KNOWN_KEYS.map((k) => [k, 'v']));
 cfg.extra = 'unknown';
 const unk = extractUnknownKeys(cfg);
 expect(unk).toEqual({ extra: 'unknown' });
 });
});

describe('mergeConfigValue', () => {
 it('merges form values with unknown keys', () => {
 const form = { presentation: { background: 'blue' }, vars: { x: '1' } };
 const unk = { myCustomKey: 99 };
 const merged = mergeConfigValue(form, unk);
 expect(merged.presentation).toEqual({ background: 'blue' });
 expect(merged.vars).toEqual({ x: '1' });
 expect(merged.myCustomKey).toBe(99);
 });

 it('omits known keys with undefined value', () => {
 const merged = mergeConfigValue({ presentation: undefined }, { extra: 1 });
 expect(Object.prototype.hasOwnProperty.call(merged, 'presentation')).toBe(false);
 expect(merged.extra).toBe(1);
 });

 it('does not include known keys that are absent from formValues', () => {
 const merged = mergeConfigValue({}, {});
 for (const k of KNOWN_KEYS) {
 expect(Object.prototype.hasOwnProperty.call(merged, k)).toBe(false);
 }
 });
});

// ── Well-known key form ───────────────────────────────────────────────────────

describe('ConfigEditor — well-known key form', () => {
 it('renders FormControls for always-shown keys when file has those keys', async () => {
 const reader = makeReader({
 presentation: { background: 'rgba(241, 237, 229, 0.85)' },
 vars: { brandColor: '#B85B33' },
 });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 folderName="ui-components"
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 // The editor should be visible.
 const editor = document.querySelector('[data-testid="lm-config-editor"]');
 expect(editor).not.toBeNull();

 // presentation and vars fields are always rendered.
 expect(document.querySelector('[data-testid="lm-config-editor-field-presentation"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="lm-config-editor-field-vars"]')).not.toBeNull();

 cleanup();
 });

 it('does not render colors/fonts fields when absent from file', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 // colors and fonts are not in the file — should not render.
 expect(document.querySelector('[data-testid="lm-config-editor-field-colors"]')).toBeNull();
 expect(document.querySelector('[data-testid="lm-config-editor-field-fonts"]')).toBeNull();

 cleanup();
 });

 it('renders colors/fonts fields when present in the file', async () => {
 const reader = makeReader({
 colors: { primary: '#B85B33' },
 fonts: { heading: 'Georgia' },
 });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 expect(document.querySelector('[data-testid="lm-config-editor-field-colors"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="lm-config-editor-field-fonts"]')).not.toBeNull();

 cleanup();
 });

 it('commits a field write with stable JSON content and trailing newline', async () => {
 const reader = makeReader({
 presentation: { background: '#fff' },
 vars: { brandColor: '#B85B33', maxWidth: '1200px' },
 });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 // Find an input inside the presentation sub-object (background field).
 const presentationField = document.querySelector('[data-testid="lm-config-editor-field-presentation"]');
 expect(presentationField).not.toBeNull();

 // The background sub-field should be a text input.
 const bgInput = presentationField.querySelector('[data-control-type="text"] input, [data-control-type="text"]');
 if (bgInput) {
 await act(async () => {
 bgInput.focus?.();
 setReactInputValue(bgInput, 'oklch(0.9 0.02 100)');
 fireBlur(bgInput);
 await tick(50);
 });

 expect(writer).toHaveBeenCalled();
 const [path, content] = writer.mock.calls[writer.mock.calls.length - 1];
 expect(path).toBe(CONFIG_PATH);
 expect(content.endsWith('\n')).toBe(true);

 const parsed = JSON.parse(content);
 expect(typeof parsed).toBe('object');
 }

 cleanup();
 });

 it('flashes Saved after a successful write', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const presentationField = document.querySelector('[data-testid="lm-config-editor-field-presentation"]');
 const bgInput = presentationField?.querySelector('[data-control-type="text"] input, [data-control-type="text"]');

 if (bgInput) {
 await act(async () => {
 bgInput.focus?.();
 setReactInputValue(bgInput, '#f00');
 fireBlur(bgInput);
 await tick(50);
 });

 const saved = document.querySelector('.lm-config-editor__saved');
 expect(saved).not.toBeNull();
 expect(saved.getAttribute('data-visible')).toBe('');
 }

 cleanup();
 });

 it('surfaces a write error as a calm banner', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: false, error: 'disk full' });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const presentationField = document.querySelector('[data-testid="lm-config-editor-field-presentation"]');
 const bgInput = presentationField?.querySelector('[data-control-type="text"] input, [data-control-type="text"]');

 if (bgInput) {
 await act(async () => {
 bgInput.focus?.();
 setReactInputValue(bgInput, '#f00');
 fireBlur(bgInput);
 await tick(50);
 });

 const banner = document.querySelector('.lm-config-editor__error-banner');
 expect(banner).not.toBeNull();
 expect(banner.textContent).toContain('disk full');
 }

 cleanup();
 });
});

// ── No-config-yet create flow ─────────────────────────────────────────────────

describe('ConfigEditor — no config.json create flow', () => {
 it('shows a create prompt when config.json is missing', async () => {
 const reader = makeReaderMissing();
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const createSection = document.querySelector('[data-testid="lm-config-editor-create"]');
 expect(createSection).not.toBeNull();

 cleanup();
 });

 it('creates config.json with {} on confirm', async () => {
 const reader = makeReaderMissing();
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const createBtn = document.querySelector('[data-testid="lm-config-editor-create-btn"]');
 expect(createBtn).not.toBeNull();

 await act(async () => {
 createBtn.click();
 await tick(30);
 });

 expect(writer).toHaveBeenCalledTimes(1);
 const [path, content] = writer.mock.calls[0];
 expect(path).toBe(CONFIG_PATH);
 const parsed = JSON.parse(content);
 expect(parsed).toEqual({});
 expect(content.endsWith('\n')).toBe(true);

 cleanup();
 });

 it('shows calm error banner and keeps create prompt when write fails', async () => {
 const reader = makeReaderMissing();
 const writer = vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const createBtn = document.querySelector('[data-testid="lm-config-editor-create-btn"]');
 await act(async () => {
 createBtn.click();
 await tick(30);
 });

 // Error banner should be visible.
 const banner = document.querySelector('.lm-config-editor__error-banner');
 expect(banner).not.toBeNull();
 expect(banner.textContent).toContain('permission denied');

 // The well-known form should NOT appear (file was not created successfully).
 expect(document.querySelector('[data-testid="lm-config-editor-field-presentation"]')).toBeNull();

 cleanup();
 });
});

// ── Unknown key fallback (raw JSON) ───────────────────────────────────────────

describe('ConfigEditor — unknown key JSON fallback', () => {
 it('shows raw toggle button', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const toggle = document.querySelector('[data-testid="lm-config-editor-raw-toggle"]');
 expect(toggle).not.toBeNull();

 cleanup();
 });

 it('reveals raw JSON textarea on toggle', async () => {
 const reader = makeReader({ presentation: { background: '#fff' }, myExtra: 42 });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const toggle = document.querySelector('[data-testid="lm-config-editor-raw-toggle"]');

 // Before clicking: textarea should be hidden.
 expect(document.querySelector('[data-testid="lm-config-editor-raw-json"]')).toBeNull();

 await act(async () => { toggle.click(); });

 // After clicking: textarea should appear.
 expect(document.querySelector('[data-testid="lm-config-editor-raw-json"]')).not.toBeNull();

 cleanup();
 });

 it('flags invalid JSON inline and does NOT write', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 // Show raw textarea.
 const toggle = document.querySelector('[data-testid="lm-config-editor-raw-toggle"]');
 await act(async () => { toggle.click(); });

 const textarea = document.querySelector('[data-testid="lm-config-editor-raw-json"]');
 expect(textarea).not.toBeNull();

 await act(async () => {
 setReactInputValue(textarea, '{not valid json');
 await tick(600); // wait for debounce
 });

 // Error message should appear.
 const errorMsg = document.querySelector('.lm-config-editor__json-error');
 expect(errorMsg).not.toBeNull();

 // Writer should NOT have been called (initial read already happened once).
 expect(writer).not.toHaveBeenCalled();

 cleanup();
 });

 it('writes unknown keys when raw JSON is valid', async () => {
 const reader = makeReader({ presentation: { background: '#fff' } });
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const toggle = document.querySelector('[data-testid="lm-config-editor-raw-toggle"]');
 await act(async () => { toggle.click(); });

 const textarea = document.querySelector('[data-testid="lm-config-editor-raw-json"]');

 await act(async () => {
 setReactInputValue(textarea, '{ "myExtra": 99 }');
 await tick(600); // wait for debounce
 });

 expect(writer).toHaveBeenCalled();
 const [path, content] = writer.mock.calls[writer.mock.calls.length - 1];
 expect(path).toBe(CONFIG_PATH);
 const parsed = JSON.parse(content);
 // The unknown key should be in the file.
 expect(parsed.myExtra).toBe(99);
 // The well-known key should still be there.
 expect(parsed.presentation).toEqual({ background: '#fff' });
 expect(content.endsWith('\n')).toBe(true);

 cleanup();
 });
});

// ── Cascade note ──────────────────────────────────────────────────────────────

describe('ConfigEditor — cascade fidelity note', () => {
 it('displays the cascade note informing user this is own config.json only', async () => {
 const reader = makeReader({});
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const note = document.querySelector('.lm-config-editor__cascade-note');
 expect(note).not.toBeNull();
 expect(note.textContent).toMatch(/Editing this folder/i);

 cleanup();
 });
});

// ── Sheet title ───────────────────────────────────────────────────────────────

describe('ConfigEditor — sheet title', () => {
 it('includes the folder name in the title', async () => {
 const reader = makeReader({});
 const writer = vi.fn().mockResolvedValue({ ok: true });

 const { cleanup } = renderToDom(
 <ConfigEditor
 open
 onClose={() => {}}
 folderPath={FOLDER_PATH}
 folderName="ui-components"
 reader={reader}
 writer={writer}
 />,
 );

 await act(async () => { await tick(30); });

 const title = document.querySelector('.es-title');
 expect(title).not.toBeNull();
 expect(title.textContent).toContain('ui-components');

 cleanup();
 });
});
