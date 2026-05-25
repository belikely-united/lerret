// Tests for size-control.jsx — the dimension helpers, the label-row size chip,
// and the preset/custom size picker. No Testing Library here; we mount with
// createRoot + act and query the DOM directly (the popover portals to body),
// matching live-refresh-control.test.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  formatSize,
  isValidDimension,
  SIZE_PRESETS,
  MIN_DIMENSION,
  MAX_DIMENSION,
  SizeBadge,
  SizePopover,
} from './size-control.jsx';

// ── mount helpers ─────────────────────────────────────────────────────────────

let mountedRoot = null;
let mountedContainer = null;

afterEach(() => {
  if (mountedRoot) {
    act(() => mountedRoot.unmount());
    mountedRoot = null;
  }
  if (mountedContainer) {
    mountedContainer.remove();
    mountedContainer = null;
  }
  document.querySelectorAll('[data-testid="lm-size-pop"]').forEach((el) => el.remove());
});

function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  mountedContainer = container;
  mountedRoot = root;
  return { container };
}

/** Set a controlled input's value the React-friendly way, then fire `input`. */
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

// ── pure helpers ──────────────────────────────────────────────────────────────

describe('formatSize', () => {
  it('joins dimensions with a true multiplication sign', () => {
    expect(formatSize(1080, 540)).toBe('1080×540');
    expect(formatSize(1920, 1080)).toBe('1920×1080');
  });
});

describe('isValidDimension', () => {
  it('accepts integers within range', () => {
    expect(isValidDimension(16)).toBe(true);
    expect(isValidDimension(1080)).toBe(true);
    expect(isValidDimension(10000)).toBe(true);
  });

  it('rejects out-of-range, non-integer, and non-number values', () => {
    expect(isValidDimension(15)).toBe(false);
    expect(isValidDimension(10001)).toBe(false);
    expect(isValidDimension(100.5)).toBe(false);
    expect(isValidDimension(NaN)).toBe(false);
    expect(isValidDimension('1080')).toBe(false);
    expect(isValidDimension(undefined)).toBe(false);
  });
});

// ── SizeBadge ─────────────────────────────────────────────────────────────────

describe('SizeBadge', () => {
  it('renders the dimensions and calls onActivate on click', () => {
    const onActivate = vi.fn();
    const { container } = mount(<SizeBadge width={1080} height={540} onActivate={onActivate} />);
    const badge = container.querySelector('[data-testid="lm-size-badge"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('1080×540');
    act(() => badge.click());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when either dimension is invalid', () => {
    const { container } = mount(<SizeBadge width={undefined} height={540} onActivate={() => {}} />);
    expect(container.querySelector('[data-testid="lm-size-badge"]')).toBeNull();
  });
});

// ── SizePopover ───────────────────────────────────────────────────────────────

function mountPopover(props) {
  // The popover anchors to an element's rect; a detached div is fine in jsdom.
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onSelect = vi.fn();
  const onClose = vi.fn();
  mount(
    <SizePopover
      anchorEl={anchor}
      width={props.width}
      height={props.height}
      disabled={props.disabled}
      disabledReason={props.disabledReason}
      onSelect={onSelect}
      onClose={onClose}
    />,
  );
  const pop = document.querySelector('[data-testid="lm-size-pop"]');
  return { pop, onSelect, onClose, anchor };
}

describe('SizePopover', () => {
  it('renders every aspect preset', () => {
    const { pop } = mountPopover({ width: 900, height: 480 });
    expect(pop).not.toBeNull();
    for (const p of SIZE_PRESETS) {
      const chip = pop.querySelector(`[data-testid="lm-size-chip-${p.id}"]`);
      expect(chip, p.id).not.toBeNull();
      expect(chip.textContent).toContain(p.label);
      expect(chip.textContent).toContain(formatSize(p.width, p.height));
    }
  });

  it('marks the matching preset as checked', () => {
    const wide = SIZE_PRESETS.find((p) => p.id === 'wide');
    const { pop } = mountPopover({ width: wide.width, height: wide.height });
    const chip = pop.querySelector('[data-testid="lm-size-chip-wide"]');
    expect(chip.getAttribute('aria-checked')).toBe('true');
    // A non-matching preset stays unchecked.
    expect(pop.querySelector('[data-testid="lm-size-chip-square"]').getAttribute('aria-checked')).toBe('false');
  });

  it('calls onSelect with the preset dimensions on chip click', () => {
    const { pop, onSelect } = mountPopover({ width: 900, height: 480 });
    act(() => pop.querySelector('[data-testid="lm-size-chip-og"]').click());
    expect(onSelect).toHaveBeenCalledWith({ width: 1200, height: 630 });
  });

  it('applies a valid custom size', () => {
    const { pop, onSelect } = mountPopover({ width: 900, height: 480 });
    setInputValue(pop.querySelector('[data-testid="lm-size-w"]'), '640');
    setInputValue(pop.querySelector('[data-testid="lm-size-h"]'), '360');
    act(() => pop.querySelector('[data-testid="lm-size-apply"]').click());
    expect(onSelect).toHaveBeenCalledWith({ width: 640, height: 360 });
  });

  it('rejects an out-of-range custom size with an error and no onSelect', () => {
    const { pop, onSelect } = mountPopover({ width: 900, height: 480 });
    setInputValue(pop.querySelector('[data-testid="lm-size-w"]'), '8'); // < MIN_DIMENSION
    setInputValue(pop.querySelector('[data-testid="lm-size-h"]'), '360');
    act(() => pop.querySelector('[data-testid="lm-size-apply"]').click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(pop.querySelector('[role="alert"]')).not.toBeNull();
    expect(pop.textContent).toContain(String(MIN_DIMENSION));
    expect(pop.textContent).toContain(String(MAX_DIMENSION));
  });

  it('shows a reason instead of the picker when disabled', () => {
    const { pop, onSelect } = mountPopover({ width: 900, height: 480, disabled: true, disabledReason: 'nope' });
    expect(pop.textContent).toContain('nope');
    expect(pop.querySelector('[data-testid="lm-size-chip-square"]')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
