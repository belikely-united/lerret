// Tests for live-refresh-control.jsx — the pure config transform, the rate
// formatter, the label-row badge, and the rate-picker popover.
//
// No Testing Library in this repo; we mount with createRoot + act and query the
// DOM directly (the popover/badge portal to document.body), matching the
// live-refresh-manager test.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, it, expect, vi } from 'vitest';

import {
  nextAssetConfig,
  formatRate,
  LiveRefreshBadge,
  LiveRefreshPopover,
} from './live-refresh-control.jsx';

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
  document.querySelectorAll('[data-testid="lm-live-pop"]').forEach((el) => el.remove());
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

// ── nextAssetConfig (pure) ────────────────────────────────────────────────────
//
// ADR-003: an asset's auto-refresh rate lives in its own `Name.config.json`
// under `autoRefresh` (ms). `nextAssetConfig(ownConfig, ms)` returns the next
// config value to serialize — a numeric `ms` sets the key, `null` deletes it,
// and any other keys are preserved. No folder map, no name-key, no null sentinel.

describe('nextAssetConfig', () => {
  it('sets a rate on an empty config', () => {
    expect(nextAssetConfig({}, 1000)).toEqual({ autoRefresh: 1000 });
  });

  it('preserves other config keys when setting a rate', () => {
    const own = { presentation: { background: '#fff' } };
    expect(nextAssetConfig(own, 2000)).toEqual({
      presentation: { background: '#fff' },
      autoRefresh: 2000,
    });
  });

  it('overwrites an existing rate', () => {
    const own = { autoRefresh: 1000 };
    expect(nextAssetConfig(own, 500)).toEqual({ autoRefresh: 500 });
  });

  it('off (null) deletes the autoRefresh key', () => {
    const own = { autoRefresh: 1000 };
    expect(nextAssetConfig(own, null)).toEqual({});
  });

  it('off (null) keeps other keys while removing autoRefresh', () => {
    const own = { presentation: { background: '#fff' }, autoRefresh: 1000 };
    expect(nextAssetConfig(own, null)).toEqual({ presentation: { background: '#fff' } });
  });

  it('off (null) on a config without autoRefresh is a no-op merge', () => {
    const own = { presentation: { background: '#fff' } };
    expect(nextAssetConfig(own, null)).toEqual({ presentation: { background: '#fff' } });
  });

  it('treats a nullish/non-object input as an empty config', () => {
    expect(nextAssetConfig(undefined, 1000)).toEqual({ autoRefresh: 1000 });
    expect(nextAssetConfig(null, 1000)).toEqual({ autoRefresh: 1000 });
  });

  it('does not mutate the input config', () => {
    const own = { autoRefresh: 1000, presentation: { background: '#fff' } };
    const snapshot = JSON.stringify(own);
    nextAssetConfig(own, 2000);
    expect(JSON.stringify(own)).toBe(snapshot);
  });
});

// ── formatRate ────────────────────────────────────────────────────────────────

describe('formatRate', () => {
  it('formats whole and fractional seconds, trimming trailing zeros', () => {
    expect(formatRate(1000)).toBe('1s');
    expect(formatRate(2000)).toBe('2s');
    expect(formatRate(500)).toBe('0.5s');
    expect(formatRate(250)).toBe('0.25s');
  });
});

// ── LiveRefreshBadge ──────────────────────────────────────────────────────────

describe('LiveRefreshBadge', () => {
  it('renders the rate and calls onActivate on click', () => {
    const onActivate = vi.fn();
    const { container } = mount(<LiveRefreshBadge rateMs={1000} onActivate={onActivate} />);
    const badge = container.querySelector('[data-testid="lm-live-badge"]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('1s');
    act(() => badge.click());
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the rate is not a positive number', () => {
    const { container } = mount(<LiveRefreshBadge rateMs={null} onActivate={() => {}} />);
    expect(container.querySelector('[data-testid="lm-live-badge"]')).toBeNull();
  });
});

// ── LiveRefreshPopover ────────────────────────────────────────────────────────

describe('LiveRefreshPopover', () => {
  function mountPopover(props) {
    const anchor = document.createElement('div');
    const merged = {
      anchorEl: anchor,
      valueMs: null,
      onSelect: () => {},
      onClose: () => {},
      ...props,
    };
    mount(<LiveRefreshPopover {...merged} />);
    return { anchor };
  }
  const chip = (testid) => document.querySelector(`[data-testid="${testid}"]`);

  it('marks the active preset chip and leaves Off unchecked', () => {
    mountPopover({ valueMs: 1000 });
    expect(chip('lm-live-chip-1000').getAttribute('aria-checked')).toBe('true');
    expect(chip('lm-live-chip-off').getAttribute('aria-checked')).toBe('false');
  });

  it('marks Off when there is no rate', () => {
    mountPopover({ valueMs: null });
    expect(chip('lm-live-chip-off').getAttribute('aria-checked')).toBe('true');
  });

  it('calls onSelect with the preset ms when a chip is clicked', () => {
    const onSelect = vi.fn();
    mountPopover({ valueMs: null, onSelect });
    act(() => chip('lm-live-chip-2000').click());
    expect(onSelect).toHaveBeenCalledWith(2000);
  });

  it('calls onSelect(null) when Off is clicked', () => {
    const onSelect = vi.fn();
    mountPopover({ valueMs: 1000, onSelect });
    act(() => chip('lm-live-chip-off').click());
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('commits a custom rate entered in seconds as milliseconds', () => {
    const onSelect = vi.fn();
    mountPopover({ valueMs: null, onSelect });
    act(() => chip('lm-live-chip-custom').click());
    const input = document.querySelector('[data-testid="lm-live-custom-input"]');
    setInputValue(input, '0.25');
    act(() => chip('lm-live-custom-apply').click());
    expect(onSelect).toHaveBeenCalledWith(250);
  });

  it('rejects a custom rate below the frame floor and shows an error', () => {
    const onSelect = vi.fn();
    mountPopover({ valueMs: null, onSelect });
    act(() => chip('lm-live-chip-custom').click());
    const input = document.querySelector('[data-testid="lm-live-custom-input"]');
    setInputValue(input, '0.005');
    act(() => chip('lm-live-custom-apply').click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(document.querySelector('.lm-live-pop__error')).not.toBeNull();
  });

  it('shows the active custom value on the Custom chip for a non-preset rate', () => {
    mountPopover({ valueMs: 250 });
    const custom = chip('lm-live-chip-custom');
    expect(custom.getAttribute('aria-checked')).toBe('true');
    expect(custom.textContent).toContain('0.25s');
  });

  it('renders a reason and no chips when disabled', () => {
    mountPopover({ valueMs: null, disabled: true, disabledReason: 'needs the CLI' });
    expect(chip('lm-live-chip-off')).toBeNull();
    expect(document.querySelector('.lm-live-pop__reason').textContent).toContain('needs the CLI');
  });
});
