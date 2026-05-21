// validation-badge.test.jsx: ValidationBadge component.
//
// Coverage:
// - Renders nothing when failedFields is empty (or propsSchema absent).
// - Renders the badge when failedFields is non-empty AND propsSchema is set.
// - Badge carries warning-amber color tokens (not error-red).
// - Badge has a warning icon AND text (meaning does not rely on color alone).
// - Accessible: button role, aria-label, focusable.
// - Clicking fires the onClick callback.
// - Keyboard: Enter and Space activate onClick.
// - Propagation is stopped (stopPropagation on click).

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

import { ValidationBadge } from './validation-badge.jsx';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const MINIMAL_SCHEMA = { headline: { type: 'string', required: true } };
const ONE_FAILURE = [{ prop: 'headline', reason: 'Required prop is absent.' }];
const TWO_FAILURES = [
 { prop: 'headline', reason: 'Required prop is absent.' },
 { prop: 'tone', reason: 'Expected one of: warm, cool, mono.' },
];

// ── "does not render" cases ───────────────────────────────────────────────────

describe('ValidationBadge — not rendered', () => {
 it('renders nothing when failedFields is empty', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={[]} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).toBeNull();
 cleanup();
 });

 it('renders nothing when propsSchema is null', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={null} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).toBeNull();
 cleanup();
 });

 it('renders nothing when propsSchema is undefined', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={undefined} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).toBeNull();
 cleanup();
 });

 it('renders nothing when failedFields is undefined', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={undefined} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).toBeNull();
 cleanup();
 });
});

// ── "renders" cases ───────────────────────────────────────────────────────────

describe('ValidationBadge — rendered', () => {
 it('renders the badge button when failedFields is non-empty and schema is set', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 expect(badge).not.toBeNull();
 cleanup();
 });

 it('is a button element (keyboard-operable, NFR14)', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 expect(badge.tagName).toBe('BUTTON');
 cleanup();
 });

 it('has an aria-label that mentions the offending prop', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 expect(badge.getAttribute('aria-label')).toMatch(/headline/);
 cleanup();
 });

 it('shows "Validation" text for a single failure', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 expect(badge.textContent).toMatch(/Validation/);
 cleanup();
 });

 it('shows a count for multiple failures', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={TWO_FAILURES} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 expect(badge.textContent).toMatch(/2/);
 cleanup();
 });

 it('contains an SVG icon paired with text (UX-DR18 — not color alone)', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 // SVG must be present
 expect(badge.querySelector('svg')).not.toBeNull();
 // Text must also be present
 expect(badge.querySelector('span')).not.toBeNull();
 cleanup();
 });

 it('SVG icon has aria-hidden so screen readers skip it', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 const svg = badge.querySelector('svg');
 expect(svg.getAttribute('aria-hidden')).toBe('true');
 cleanup();
 });

 it('uses Warning-amber class (not error-red)', () => {
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 // The class must be lm-validation-badge — the CSS uses --lm-warning tokens.
 expect(badge.className).toContain('lm-validation-badge');
 // Must NOT reference the error class.
 expect(badge.className).not.toContain('error');
 cleanup();
 });
});

// ── Interaction tests ─────────────────────────────────────────────────────────

describe('ValidationBadge — click behavior', () => {
 it('fires onClick when clicked', () => {
 const spy = vi.fn();
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={spy} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 act(() => { badge.click(); });
 expect(spy).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('fires onClick on Enter keydown', () => {
 const spy = vi.fn();
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={spy} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 act(() => {
 badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
 });
 expect(spy).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('fires onClick on Space keydown', () => {
 const spy = vi.fn();
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={spy} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 act(() => {
 badge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
 });
 expect(spy).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('does NOT fire onClick for other keys', () => {
 const spy = vi.fn();
 const { container, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={spy} />,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 act(() => {
 badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
 });
 expect(spy).not.toHaveBeenCalled();
 cleanup();
 });

 it('stops propagation on click (canvas drag guard)', () => {
 const canvasSpy = vi.fn();
 const { container, cleanup } = renderToDom(
 <div onClick={canvasSpy}>
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />
 </div>,
 );
 const badge = container.querySelector('[data-testid="lm-validation-badge"]');
 act(() => { badge.click(); });
 expect(canvasSpy).not.toHaveBeenCalled();
 cleanup();
 });
});

// ── Repair-clears-badge ───────────────────────────────────────────────────────

describe('ValidationBadge — repair clears badge', () => {
 it('disappears when failedFields becomes empty on re-render', () => {
 const { container, rerender, cleanup } = renderToDom(
 <ValidationBadge failedFields={ONE_FAILURE} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).not.toBeNull();

 // Simulate repair: empty failedFields.
 rerender(
 <ValidationBadge failedFields={[]} propsSchema={MINIMAL_SCHEMA} onClick={() => {}} />,
 );
 expect(container.querySelector('[data-testid="lm-validation-badge"]')).toBeNull();
 cleanup();
 });
});
