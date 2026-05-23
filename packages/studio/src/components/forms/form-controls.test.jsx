// form-controls.test.jsx: Schema-driven typed form controls.
//
// Tests cover for each control type:
// - default state (renders label, description, default placeholder)
// - disabled state
// - invalid state with inline message (icon + text, not color-only)
// - keyboard operation
// - schema-driven labeling / description / required / default rendering
// - array control: add / remove / reorder
// - FormControl dispatcher routes to the right control

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

import {
 FormControl,
 TextControl,
 NumberControl,
 BooleanControl,
 SelectControl,
 ArrayControl,
 ObjectControl,
} from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mount a React element into document.body; returns container + teardown. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 root,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 rerender(el) {
 act(() => root.render(el));
 },
 };
}

function fire(element, EventClass, props) {
 act(() => {
 element.dispatchEvent(new EventClass(props.type, { bubbles: true, ...props }));
 });
}

// ─── FieldWrapper / label / description / required / default placeholder ──────

describe('FieldWrapper — schema-driven labelling', () => {
 it('renders a visible label from the schema key', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'title',
 schema: { type: 'string' },
 value: '',
 }),
 );
 expect(container.textContent).toMatch(/title/i);
 cleanup();
 });

 it('renders camelCase key as a readable label', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'backgroundColor',
 schema: { type: 'string' },
 value: '',
 }),
 );
 // "backgroundColor" → "background Color" (split at capitals)
 expect(container.textContent).toMatch(/background/i);
 cleanup();
 });

 it('shows description as help text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'label',
 schema: { type: 'string', description: 'The button label text.' },
 value: '',
 }),
 );
 expect(container.textContent).toContain('The button label text.');
 cleanup();
 });

 it('visibly marks required fields with an asterisk', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'name',
 schema: { type: 'string', required: true },
 value: '',
 }),
 );
 expect(container.textContent).toContain('*');
 cleanup();
 });

 it('shows schema default as placeholder ghost text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'title',
 schema: { type: 'string', default: 'Untitled' },
 value: '',
 }),
 );
 const input = container.querySelector('input');
 expect(input.placeholder).toBe('Untitled');
 cleanup();
 });
});

// ─── TextControl ──────────────────────────────────────────────────────────────

describe('TextControl', () => {
 it('renders an input with the current value', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'label',
 schema: { type: 'string' },
 value: 'hello',
 }),
 );
 const input = container.querySelector('input');
 expect(input).toBeTruthy();
 expect(input.value).toBe('hello');
 cleanup();
 });

 it('is disabled when disabled prop is true', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'label',
 schema: { type: 'string' },
 value: '',
 disabled: true,
 }),
 );
 const input = container.querySelector('input');
 expect(input.disabled).toBe(true);
 cleanup();
 });

 it('renders invalid state with inline message (icon + text, not color alone)', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'count',
 schema: { type: 'string', required: true },
 value: '',
 onCommit,
 }),
 );
 // A required string with an empty value — invalid.
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 // Must contain both an icon (svg) AND text — not color alone (UX-DR18).
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent).toMatch(/required|invalid/i);
 cleanup();
 });

 it('calls onCommit on blur', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'x',
 schema: { type: 'string' },
 value: 'foo',
 onCommit,
 }),
 );
 const input = container.querySelector('input');
 // React 19 in jsdom: dispatch a real blur event that React's delegation picks up.
 act(() => {
 input.focus();
 // React delegates onBlur via focusout which bubbles.
 input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
 });
 expect(onCommit).toHaveBeenCalledWith('foo');
 cleanup();
 });

 it('has aria-invalid when invalid', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'x',
 schema: { type: 'string', required: true },
 value: '',
 }),
 );
 const input = container.querySelector('input');
 expect(input.getAttribute('aria-invalid')).toBe('true');
 cleanup();
 });

 it('has aria-required when required', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'x',
 schema: { type: 'string', required: true },
 value: 'present',
 }),
 );
 const input = container.querySelector('input');
 expect(input.getAttribute('aria-required')).toBe('true');
 cleanup();
 });

 it('does not show invalid message for valid value', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'x',
 schema: { type: 'string' },
 value: 'valid string',
 }),
 );
 expect(container.querySelector('[data-invalid-message]')).toBeNull();
 cleanup();
 });
});

// ─── NumberControl ────────────────────────────────────────────────────────────

describe('NumberControl', () => {
 it('renders with numeric value', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'count',
 schema: { type: 'number' },
 value: 42,
 }),
 );
 const input = container.querySelector('input[type="number"]');
 expect(input).toBeTruthy();
 expect(input.value).toBe('42');
 cleanup();
 });

 it('is disabled when disabled prop is true', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'n',
 schema: { type: 'number' },
 value: 0,
 disabled: true,
 }),
 );
 expect(container.querySelector('input').disabled).toBe(true);
 cleanup();
 });

 it('renders invalid state when value is below min', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'n',
 schema: { type: 'number', min: 10 },
 value: 3,
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent).toMatch(/at least 10/i);
 cleanup();
 });

 it('renders invalid state when value is above max', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'n',
 schema: { type: 'number', max: 5 },
 value: 99,
 }),
 );
 expect(container.querySelector('[data-invalid-message]')).toBeTruthy();
 cleanup();
 });

 it('calls onCommit on blur with the parsed number', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'n',
 schema: { type: 'number' },
 value: 7,
 onCommit,
 }),
 );
 const input = container.querySelector('input');
 act(() => {
 input.focus();
 // React delegates onBlur via focusout which bubbles.
 input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
 });
 expect(onCommit).toHaveBeenCalledWith(7);
 cleanup();
 });

 it('shows schema default as placeholder', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'opacity',
 schema: { type: 'number', default: 100 },
 value: null,
 }),
 );
 expect(container.querySelector('input').placeholder).toBe('100');
 cleanup();
 });
});

// ─── BooleanControl ───────────────────────────────────────────────────────────

describe('BooleanControl', () => {
 it('renders a toggle button with role="switch"', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'visible',
 schema: { type: 'boolean' },
 value: true,
 }),
 );
 const btn = container.querySelector('[role="switch"]');
 expect(btn).toBeTruthy();
 expect(btn.getAttribute('aria-checked')).toBe('true');
 cleanup();
 });

 it('shows Off when value is false', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'visible',
 schema: { type: 'boolean' },
 value: false,
 }),
 );
 expect(container.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false');
 expect(container.textContent).toContain('Off');
 cleanup();
 });

 it('toggles via click', () => {
 const onChange = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'visible',
 schema: { type: 'boolean' },
 value: false,
 onChange,
 }),
 );
 act(() => {
 container.querySelector('[role="switch"]').click();
 });
 expect(onChange).toHaveBeenCalledWith(true);
 cleanup();
 });

 it('toggles via Space key', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'x',
 schema: { type: 'boolean' },
 value: true,
 onCommit,
 }),
 );
 const btn = container.querySelector('[role="switch"]');
 fire(btn, KeyboardEvent, { type: 'keydown', key: ' ' });
 expect(onCommit).toHaveBeenCalledWith(false);
 cleanup();
 });

 it('toggles via Enter key', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'x',
 schema: { type: 'boolean' },
 value: false,
 onCommit,
 }),
 );
 const btn = container.querySelector('[role="switch"]');
 fire(btn, KeyboardEvent, { type: 'keydown', key: 'Enter' });
 expect(onCommit).toHaveBeenCalledWith(true);
 cleanup();
 });

 it('does not toggle when disabled', () => {
 const onChange = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'x',
 schema: { type: 'boolean' },
 value: false,
 onChange,
 disabled: true,
 }),
 );
 act(() => {
 container.querySelector('[role="switch"]').click();
 });
 expect(onChange).not.toHaveBeenCalled();
 cleanup();
 });

 it('shows invalid state with icon+text when value type is wrong', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'x',
 schema: { type: 'boolean' },
 value: 'oops',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 expect(msg.querySelector('svg')).toBeTruthy();
 cleanup();
 });

 it('uses schema default when value is absent', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(BooleanControl, {
 fieldKey: 'x',
 schema: { type: 'boolean', default: true },
 value: null,
 }),
 );
 // Default is true → toggle should be checked.
 expect(container.querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true');
 cleanup();
 });
});

// ─── SelectControl ────────────────────────────────────────────────────────────

describe('SelectControl', () => {
 const schema = { type: 'select', options: ['small', 'medium', 'large'] };

 it('renders a native <select> with options', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema,
 value: 'medium',
 }),
 );
 const sel = container.querySelector('select');
 expect(sel).toBeTruthy();
 expect(sel.value).toBe('medium');
 // All three options present.
 const opts = Array.from(sel.options).map((o) => o.value).filter(Boolean);
 expect(opts).toEqual(expect.arrayContaining(['small', 'medium', 'large']));
 cleanup();
 });

 it('shows placeholder option when value is absent', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema,
 value: '',
 }),
 );
 const placeholderOpt = container.querySelector('option[value=""]');
 expect(placeholderOpt).toBeTruthy();
 cleanup();
 });

 it('shows schema default as the placeholder text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema: { ...schema, default: 'medium' },
 value: null,
 }),
 );
 const placeholderOpt = container.querySelector('option[value=""]');
 expect(placeholderOpt.textContent).toContain('medium');
 cleanup();
 });

 it('is disabled when disabled prop is true', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema,
 value: 'small',
 disabled: true,
 }),
 );
 expect(container.querySelector('select').disabled).toBe(true);
 cleanup();
 });

 it('renders invalid state when value is out of enum', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema,
 value: 'xxl',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent).toMatch(/small|medium|large/i);
 cleanup();
 });

 it('calls onCommit when selection changes', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'size',
 schema,
 value: 'small',
 onCommit,
 }),
 );
 const sel = container.querySelector('select');
 // Simulate change event.
 act(() => {
 Object.defineProperty(sel, 'value', { writable: true, value: 'large' });
 sel.dispatchEvent(new Event('change', { bubbles: true }));
 });
 expect(onCommit).toHaveBeenCalledWith('large');
 cleanup();
 });
});

// ─── ArrayControl ─────────────────────────────────────────────────────────────

describe('ArrayControl', () => {
 it('renders items as a list', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta'],
 }),
 );
 const items = container.querySelectorAll('[data-array-index]');
 expect(items.length).toBe(2);
 cleanup();
 });

 it('shows the add button', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: [],
 }),
 );
 expect(container.querySelector('[data-array-add]')).toBeTruthy();
 cleanup();
 });

 it('calls onCommit with a new item appended when Add is clicked', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha'],
 onCommit,
 }),
 );
 act(() => {
 container.querySelector('[data-array-add]').click();
 });
 expect(onCommit).toHaveBeenCalledWith(['alpha', '']);
 cleanup();
 });

 it('calls onCommit with item removed when remove button is clicked', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta', 'gamma'],
 onCommit,
 }),
 );
 // Remove the second item (index 1).
 act(() => {
 container.querySelector('[data-array-remove="1"]').click();
 });
 expect(onCommit).toHaveBeenCalledWith(['alpha', 'gamma']);
 cleanup();
 });

 it('calls onCommit with items swapped when move-up is clicked', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta'],
 onCommit,
 }),
 );
 // Move item at index 1 up.
 act(() => {
 container.querySelector('[data-array-move-up="1"]').click();
 });
 expect(onCommit).toHaveBeenCalledWith(['beta', 'alpha']);
 cleanup();
 });

 it('calls onCommit with items swapped when move-down is clicked', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta'],
 onCommit,
 }),
 );
 // Move item at index 0 down.
 act(() => {
 container.querySelector('[data-array-move-down="0"]').click();
 });
 expect(onCommit).toHaveBeenCalledWith(['beta', 'alpha']);
 cleanup();
 });

 it('move-up button is disabled for the first item', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta'],
 }),
 );
 expect(container.querySelector('[data-array-move-up="0"]').disabled).toBe(true);
 cleanup();
 });

 it('move-down button is disabled for the last item', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha', 'beta'],
 }),
 );
 expect(container.querySelector('[data-array-move-down="1"]').disabled).toBe(true);
 cleanup();
 });

 it('is fully disabled when disabled prop is true', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: ['alpha'],
 disabled: true,
 }),
 );
 expect(container.querySelector('[data-array-add]').disabled).toBe(true);
 expect(container.querySelector('[data-array-remove="0"]').disabled).toBe(true);
 cleanup();
 });

 it('renders invalid state when value is not an array', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array' },
 value: 'not-an-array',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 expect(msg.querySelector('svg')).toBeTruthy();
 cleanup();
 });

 it('shows description text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', description: 'List of tags.' },
 value: [],
 }),
 );
 expect(container.textContent).toContain('List of tags.');
 cleanup();
 });

 it('add button is keyboard-reachable (not disabled when enabled)', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ArrayControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: [],
 }),
 );
 const addBtn = container.querySelector('[data-array-add]');
 expect(addBtn.disabled).toBe(false);
 expect(addBtn.tagName.toLowerCase()).toBe('button');
 cleanup();
 });
});

// ─── ObjectControl ────────────────────────────────────────────────────────────

describe('ObjectControl', () => {
 it('renders sub-controls for declared properties', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'style',
 schema: {
 type: 'object',
 properties: {
 color: { type: 'string' },
 opacity: { type: 'number' },
 },
 },
 value: { color: 'red', opacity: 0.8 },
 }),
 );
 // Should have sub-fields for both properties.
 expect(container.querySelector('[data-field-key="color"]')).toBeTruthy();
 expect(container.querySelector('[data-field-key="opacity"]')).toBeTruthy();
 cleanup();
 });

 it('calls onCommit with updated object when a sub-field changes', () => {
 const onCommit = vi.fn();
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'style',
 schema: {
 type: 'object',
 properties: { color: { type: 'string' } },
 },
 value: { color: 'red' },
 onCommit,
 }),
 );
 const input = container.querySelector('[data-field-key="color"] input');
 act(() => {
 input.focus();
 // React delegates onBlur via focusout which bubbles.
 input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
 });
 expect(onCommit).toHaveBeenCalled();
 cleanup();
 });

 it('is disabled when disabled prop is true', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'style',
 schema: {
 type: 'object',
 properties: { color: { type: 'string' } },
 },
 value: { color: '' },
 disabled: true,
 }),
 );
 const input = container.querySelector('input');
 expect(input.disabled).toBe(true);
 cleanup();
 });

 it('offers an add-property row for a free-form object (no declared properties)', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'vars',
 schema: { type: 'object' },
 value: {},
 }),
 );
 // Free-form + empty → the add-property affordance, not a dead-end message.
 expect(container.querySelector('[data-object-add-key]')).not.toBeNull();
 expect(container.querySelector('[data-object-add-btn]')).not.toBeNull();
 cleanup();
 });

 it('adds a free-form property via the + Add row', () => {
 const commits = [];
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'vars',
 schema: { type: 'object' },
 value: {},
 onCommit: (v) => commits.push(v),
 }),
 );
 const input = container.querySelector('[data-object-add-key]');
 // Update the controlled input through React's value tracker, then fire input.
 const setValue = Object.getOwnPropertyDescriptor(
 window.HTMLInputElement.prototype,
 'value',
 ).set;
 act(() => {
 setValue.call(input, 'brandHue');
 input.dispatchEvent(new Event('input', { bubbles: true }));
 });
 const addBtn = container.querySelector('[data-object-add-btn]');
 act(() => { addBtn.click(); });
 expect(commits[commits.length - 1]).toEqual({ brandHue: '' });
 cleanup();
 });

 it('removes a free-form property via its remove button', () => {
 const commits = [];
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'vars',
 schema: { type: 'object' },
 value: { a: '1', b: '2' },
 onCommit: (v) => commits.push(v),
 }),
 );
 // First remove button corresponds to the first key ('a').
 const removeBtn = container.querySelector('.lm-object__remove');
 act(() => { removeBtn.click(); });
 expect(commits[commits.length - 1]).toEqual({ b: '2' });
 cleanup();
 });

 it('does not offer add/remove for an object with declared properties', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'presentation',
 schema: { type: 'object', properties: { background: { type: 'string' } } },
 value: {},
 }),
 );
 expect(container.querySelector('[data-object-add-key]')).toBeNull();
 expect(container.querySelector('.lm-object__remove')).toBeNull();
 cleanup();
 });

 it('renders invalid state when value is not an object', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(ObjectControl, {
 fieldKey: 'data',
 schema: { type: 'object' },
 value: 'not-an-object',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg).toBeTruthy();
 expect(msg.querySelector('svg')).toBeTruthy();
 cleanup();
 });
});

// ─── FormControl dispatcher ───────────────────────────────────────────────────

describe('FormControl dispatcher', () => {
 it('renders TextControl for type string', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'name',
 schema: { type: 'string' },
 value: '',
 }),
 );
 expect(container.querySelector('[data-control-type="text"]')).toBeTruthy();
 cleanup();
 });

 it('renders NumberControl for type number', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'count',
 schema: { type: 'number' },
 value: 0,
 }),
 );
 expect(container.querySelector('[data-control-type="number"]')).toBeTruthy();
 cleanup();
 });

 it('renders BooleanControl for type boolean', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'visible',
 schema: { type: 'boolean' },
 value: true,
 }),
 );
 expect(container.querySelector('[data-control-type="boolean"]')).toBeTruthy();
 cleanup();
 });

 it('renders SelectControl for type select', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'size',
 schema: { type: 'select', options: ['sm', 'md', 'lg'] },
 value: 'md',
 }),
 );
 expect(container.querySelector('[data-control-type="select"]')).toBeTruthy();
 cleanup();
 });

 it('renders ArrayControl for type array', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'tags',
 schema: { type: 'array', itemSchema: { type: 'string' } },
 value: [],
 }),
 );
 expect(container.querySelector('[data-control-type="array"]')).toBeTruthy();
 cleanup();
 });

 it('renders ObjectControl for type object', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'style',
 schema: { type: 'object', properties: {} },
 value: {},
 }),
 );
 expect(container.querySelector('[data-control-type="object"]')).toBeTruthy();
 cleanup();
 });

 it('falls back to TextControl for an unknown type', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(FormControl, {
 fieldKey: 'x',
 schema: { type: 'exotic' },
 value: '',
 }),
 );
 expect(container.querySelector('[data-control-type="text"]')).toBeTruthy();
 cleanup();
 });
});

// ─── Cross-cutting: invalid state is not color-alone (UX-DR18) ───────────────

describe('Invalid state — color is never the sole signal (UX-DR18)', () => {
 it('TextControl: invalid state has an SVG icon alongside text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(TextControl, {
 fieldKey: 'x',
 schema: { type: 'string', required: true },
 value: '',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent.trim().length).toBeGreaterThan(0);
 cleanup();
 });

 it('NumberControl: invalid state has an SVG icon alongside text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(NumberControl, {
 fieldKey: 'x',
 schema: { type: 'number', min: 10 },
 value: 1,
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent.trim().length).toBeGreaterThan(0);
 cleanup();
 });

 it('SelectControl: invalid state has an SVG icon alongside text', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(SelectControl, {
 fieldKey: 'x',
 schema: { type: 'select', options: ['a', 'b'] },
 value: 'c',
 }),
 );
 const msg = container.querySelector('[data-invalid-message]');
 expect(msg.querySelector('svg')).toBeTruthy();
 expect(msg.textContent.trim().length).toBeGreaterThan(0);
 cleanup();
 });
});
