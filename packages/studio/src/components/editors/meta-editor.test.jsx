// Tests for the Meta editor.
//
// Coverage:
// - opens inside an EditorSheet, pre-fills form from entry.meta
// - per-field commit invokes the rewriter then the writer with the new source
// - the writer is called with the asset's path, not the data file path
// - rewriter-failure path: source the rewriter can't safely handle surfaces
// the calm "Cannot edit meta here" guidance and disables writes
// - "Saved" indicator flashes on a successful write
// - write error surfaced as a calm banner; editor remains open
// - Esc closes the editor (per-field commit means dismissal never loses work)

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { _resetSheetSingleton } from './editor-sheet.jsx';
import { MetaEditor } from './meta-editor.jsx';

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

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ASSET_PATH = '/proj/.lerret/ui/Hero.jsx';

const HERO_ENTRY = {
 id: ASSET_PATH,
 asset: { path: ASSET_PATH, name: 'Hero' },
 label: 'Hero',
 meta: {
 dimensions: { width: 640, height: 280 },
 label: 'Launch hero banner',
 tags: ['hero', 'marketing'],
 },
};

const HERO_SOURCE = [
 'import React from "react";',
 '',
 'export const meta = {',
 ' dimensions: { width: 640, height: 280 },',
 ' label: "Launch hero banner",',
 ' tags: ["hero", "marketing"],',
 '};',
 '',
 'export default function Hero() { return null; }',
 '',
].join('\n');

// A reader returning the canonical HERO_SOURCE.
function makeReader(source = HERO_SOURCE) {
 return vi.fn().mockResolvedValue({ ok: true, source });
}

// A writer that succeeds.
function makeWriter() {
 return vi.fn().mockResolvedValue({ ok: true });
}

// ── Form pre-fill ────────────────────────────────────────────────────────────

describe('MetaEditor — form pre-fill', () => {
 it('renders dimension/label/tag controls pre-filled from entry.meta', async () => {
 const reader = makeReader();
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // The editor sheet is open with the expected title.
 const dialog = document.querySelector('[role="dialog"]');
 expect(dialog).not.toBeNull();
 expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();

 // Width + height number inputs.
 const numberInputs = document.querySelectorAll('[data-control-type="number"]');
 expect(numberInputs.length).toBe(2);
 expect(numberInputs[0].value).toBe('640');
 expect(numberInputs[1].value).toBe('280');

 // Label text input.
 const textInputs = document.querySelectorAll('[data-control-type="text"]');
 // Two tag items (one input each) + one label input = 3 text inputs.
 expect(textInputs.length).toBe(3);
 // The first text input is the label.
 expect(textInputs[0].value).toBe('Launch hero banner');
 // The remaining two are the tag items.
 expect(textInputs[1].value).toBe('hero');
 expect(textInputs[2].value).toBe('marketing');

 // The asset file path is shown.
 const path = document.querySelector('[data-testid="lm-meta-editor-path"]');
 expect(path).not.toBeNull();
 expect(path.textContent).toBe(ASSET_PATH);

 cleanup();
 });

 it('shows an empty form when meta is empty', async () => {
 const bareEntry = {
 id: '/p/.lerret/Bare.jsx',
 asset: { path: '/p/.lerret/Bare.jsx', name: 'Bare' },
 label: 'Bare',
 meta: { dimensions: {}, label: undefined, tags: [] },
 };
 const reader = makeReader('export const meta = {};\nexport default function X() {}\n');
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={bareEntry} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // Two empty number inputs.
 const numberInputs = document.querySelectorAll('[data-control-type="number"]');
 expect(numberInputs.length).toBe(2);
 expect(numberInputs[0].value).toBe('');
 expect(numberInputs[1].value).toBe('');

 // One empty label input + zero tag items = 1 text input.
 const textInputs = document.querySelectorAll('[data-control-type="text"]');
 expect(textInputs.length).toBe(1);
 expect(textInputs[0].value).toBe('');

 cleanup();
 });
});

// ── Per-field commit ─────────────────────────────────────────────────────────

describe('MetaEditor — per-field commit', () => {
 it('commits a label edit by reading the source, rewriting, then writing back', async () => {
 const reader = makeReader();
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 const textInputs = document.querySelectorAll('[data-control-type="text"]');
 // Index 0 is the label input.
 const labelInput = textInputs[0];

 await act(async () => {
 labelInput.focus();
 setReactInputValue(labelInput, 'Renamed hero');
 fireBlur(labelInput);
 await tick(50);
 });

 // The writer was called once with the asset's path and the rewritten source.
 expect(writer).toHaveBeenCalled();
 const [path, content] = writer.mock.calls[writer.mock.calls.length - 1];
 expect(path).toBe(ASSET_PATH);
 // The new source contains the updated label and preserved component code.
 expect(content).toContain('label: "Renamed hero"');
 expect(content).toContain('export default function Hero() { return null; }');
 // The reader was called too (commit-time read).
 expect(reader).toHaveBeenCalled();

 cleanup();
 });

 it('commits a dimension edit and writes the new width into the source', async () => {
 const reader = makeReader();
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 const widthInput = document.querySelectorAll('[data-control-type="number"]')[0];

 await act(async () => {
 widthInput.focus();
 setReactInputValue(widthInput, '800');
 fireBlur(widthInput);
 await tick(50);
 });

 expect(writer).toHaveBeenCalled();
 const [path, content] = writer.mock.calls[writer.mock.calls.length - 1];
 expect(path).toBe(ASSET_PATH);
 expect(content).toContain('width: 800');
 // The height is preserved.
 expect(content).toContain('height: 280');

 cleanup();
 });

 it('commits a tags edit (adding a new tag) by writing through the rewriter', async () => {
 const reader = makeReader();
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // Click the "Add item" button on the tags array.
 const addBtn = document.querySelector('[data-array-add]');
 expect(addBtn).not.toBeNull();
 await act(async () => {
 addBtn.click();
 await tick(50);
 });

 // The writer was called with the new tag appended (default item is `""`).
 expect(writer).toHaveBeenCalled();
 const [path, content] = writer.mock.calls[writer.mock.calls.length - 1];
 expect(path).toBe(ASSET_PATH);
 // The original two tags are kept; the empty added tag is filtered out.
 expect(content).toContain('tags: ["hero", "marketing"]');

 cleanup();
 });
});

// ── "Saved" indicator ────────────────────────────────────────────────────────

describe('MetaEditor — saved indicator', () => {
 it('flashes "Saved" after a successful write', async () => {
 const reader = makeReader();
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 const labelInput = document.querySelectorAll('[data-control-type="text"]')[0];
 await act(async () => {
 labelInput.focus();
 setReactInputValue(labelInput, 'New');
 fireBlur(labelInput);
 await tick(50);
 });

 const saved = document.querySelector('.lm-meta-editor__saved');
 expect(saved).not.toBeNull();
 expect(saved.getAttribute('data-visible')).toBe('');

 cleanup();
 });
});

// ── Rewriter-failure path (calm guidance) ────────────────────────────────────

describe('MetaEditor — rewriter cannot edit source', () => {
 it('shows the "Cannot edit meta here" guidance when source uses a non-literal meta', async () => {
 // A source whose meta is not an object literal — rewriter returns ok:false.
 const exoticSource = 'export const meta = buildMeta();\nexport default function X() {}\n';
 const reader = vi.fn().mockResolvedValue({ ok: true, source: exoticSource });
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // The guidance panel is shown.
 const guidance = document.querySelector('[data-testid="lm-meta-editor-guidance"]');
 expect(guidance).not.toBeNull();
 expect(guidance.textContent).toContain('open the file in your editor');
 // The asset file path is shown in the guidance.
 expect(guidance.textContent).toContain(ASSET_PATH);

 // The form controls are disabled — the user cannot accidentally commit.
 const inputs = document.querySelectorAll('input');
 for (const el of inputs) {
 expect(el.disabled).toBe(true);
 }

 cleanup();
 });

 it('does NOT attempt a write when the rewriter cannot edit the source', async () => {
 const exoticSource = 'export const meta = computeMeta();\n';
 const reader = vi.fn().mockResolvedValue({ ok: true, source: exoticSource });
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // No write happened on open.
 expect(writer).not.toHaveBeenCalled();

 cleanup();
 });
});

// ── Write-failure UX ─────────────────────────────────────────────────────────

describe('MetaEditor — write error', () => {
 it('surfaces a calm banner on writer failure and keeps the editor open', async () => {
 const reader = makeReader();
 const writer = vi.fn().mockResolvedValue({ ok: false, error: 'disk full' });

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 const labelInput = document.querySelectorAll('[data-control-type="text"]')[0];
 await act(async () => {
 labelInput.focus();
 setReactInputValue(labelInput, 'Anything');
 fireBlur(labelInput);
 await tick(50);
 });

 const banner = document.querySelector('.lm-meta-editor__error-banner');
 expect(banner).not.toBeNull();
 expect(banner.textContent).toContain('disk full');
 // The dialog is still open.
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 cleanup();
 });

 it('surfaces a calm banner on reader failure', async () => {
 const reader = vi.fn().mockResolvedValue({ ok: false, error: 'network down' });
 const writer = makeWriter();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={() => {}} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 const banner = document.querySelector('.lm-meta-editor__error-banner');
 expect(banner).not.toBeNull();
 expect(banner.textContent).toContain('network down');
 // The writer is NOT called.
 expect(writer).not.toHaveBeenCalled();

 cleanup();
 });
});

// ── Sheet dismissal ──────────────────────────────────────────────────────────

describe('MetaEditor — Editor sheet dismissal', () => {
 it('calls onClose when Esc is pressed (per-field commit means no work is lost)', async () => {
 const reader = makeReader();
 const writer = makeWriter();
 const onClose = vi.fn();

 const { cleanup } = renderToDom(
 <MetaEditor open onClose={onClose} entry={HERO_ENTRY} reader={reader} writer={writer} />,
 );

 await act(async () => { await tick(30); });

 // Use the reduced-motion path so onClose fires synchronously.
 vi.stubGlobal('matchMedia', () => ({
 matches: true,
 media: '(prefers-reduced-motion: reduce)',
 addEventListener: () => {},
 removeEventListener: () => {},
 }));

 act(() => {
 document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
 });

 expect(onClose).toHaveBeenCalled();

 cleanup();
 });
});
