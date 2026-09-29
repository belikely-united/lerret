// create-entry-dialog.test.jsx — render + interaction coverage for the shared
// "create a page / group / asset" dialog.
//
// The dialog is presentational + validation only; it doesn't call the create
// endpoint. We verify: the portaled dialog shape, the validation gating of the
// Create button, inline validation + collision errors, the asset type toggle,
// the onConfirm payload, server-error surfacing, and Cancel/Esc → onClose.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreateEntryDialog } from './create-entry-dialog.jsx';

function renderToDom(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Set a controlled <input>'s value the way React expects, then fire `input`.
function typeInput(value) {
  const input = document.querySelector('[data-testid="lm-create-name-input"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

const q = (sel) => document.querySelector(sel);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CreateEntryDialog', () => {
  it('portals a role="dialog" titled for the kind', () => {
    renderToDom(<CreateEntryDialog kind="page" onClose={vi.fn()} onConfirm={vi.fn()} />);
    const dlg = q('[data-testid="lm-create-dialog"]');
    expect(dlg).toBeTruthy();
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-label')).toBe('New page');
  });

  it('disables Create until a valid name is typed', () => {
    renderToDom(<CreateEntryDialog kind="group" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(q('[data-testid="lm-create-confirm"]').disabled).toBe(true);
    typeInput('social');
    expect(q('[data-testid="lm-create-confirm"]').disabled).toBe(false);
  });

  it('shows an inline error for an invalid name', () => {
    renderToDom(<CreateEntryDialog kind="page" onClose={vi.fn()} onConfirm={vi.fn()} />);
    typeInput('_secret');
    expect(q('[data-testid="lm-create-error"]').textContent).toMatch(/underscore/);
    expect(q('[data-testid="lm-create-confirm"]').disabled).toBe(true);
  });

  it('flags a collision against existingNames', () => {
    renderToDom(
      <CreateEntryDialog
        kind="group"
        existingNames={['social']}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    typeInput('social');
    expect(q('[data-testid="lm-create-error"]').textContent).toMatch(/already exists/);
    expect(q('[data-testid="lm-create-confirm"]').disabled).toBe(true);
  });

  it('a new asset starts on the platform step with Create hidden', () => {
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(q('[data-testid="lm-create-dialog"]').dataset.step).toBe('platform');
    expect(q('[data-testid="lm-create-platform-instagram"]')).toBeTruthy();
    expect(q('[data-testid="lm-create-platform-custom"]')).toBeTruthy();
    expect(q('[data-testid="lm-create-name-input"]')).toBeFalsy();
    expect(q('[data-testid="lm-create-confirm"]')).toBeFalsy();
  });

  it('picking a platform lists its formats, defaults to the first, and passes its size', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={onConfirm} />);
    act(() => {
      q('[data-testid="lm-create-platform-instagram"]').click();
    });
    expect(q('[data-testid="lm-create-dialog"]').getAttribute('aria-label')).toBe('New Instagram asset');
    expect(q('[data-testid="lm-create-format-post-portrait"]').getAttribute('aria-checked')).toBe('true');
    act(() => {
      q('[data-testid="lm-create-format-story"]').click();
    });
    typeInput('launch-story');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'launch-story',
      assetKind: 'component',
      dimensions: { width: 1080, height: 1920 },
    });
  });

  it('Back returns to the platform grid', () => {
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={vi.fn()} />);
    act(() => {
      q('[data-testid="lm-create-platform-appstore"]').click();
    });
    act(() => {
      q('[data-testid="lm-create-back"]').click();
    });
    expect(q('[data-testid="lm-create-dialog"]').dataset.step).toBe('platform');
  });

  it('custom size validates W×H and passes it through', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={onConfirm} />);
    act(() => {
      q('[data-testid="lm-create-platform-custom"]').click();
    });
    typeInput('banner');
    const setNumber = (edge, value) => {
      const input = q(`[data-testid="lm-create-custom-${edge}"]`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    setNumber('width', '5');
    expect(q('[data-testid="lm-create-size-error"]').textContent).toMatch(/between 16 and 10000/);
    expect(q('[data-testid="lm-create-confirm"]').disabled).toBe(true);
    setNumber('width', '1500');
    setNumber('height', '500');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(onConfirm).toHaveBeenCalledWith({
      name: 'banner',
      assetKind: 'component',
      dimensions: { width: 1500, height: 500 },
    });
  });

  it('the Markdown option skips sizing and sends no dimensions', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={onConfirm} />);
    act(() => {
      q('[data-testid="lm-create-type-markdown"]').click();
    });
    expect(q('[data-testid="lm-create-formats"]')).toBeFalsy();
    typeInput('notes');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(onConfirm).toHaveBeenCalledWith({ name: 'notes', assetKind: 'markdown' });
  });

  it('folders have no type toggle and confirm with name only', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="group" onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(q('[data-testid="lm-create-type-markdown"]')).toBeFalsy();
    typeInput('social');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(onConfirm).toHaveBeenCalledWith({ name: 'social', assetKind: undefined });
  });

  it('surfaces a thrown server error inline and stays open', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('"social" already exists here'));
    const onClose = vi.fn();
    renderToDom(<CreateEntryDialog kind="group" onClose={onClose} onConfirm={onConfirm} />);
    typeInput('social');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(q('[data-testid="lm-create-server-error"]').textContent).toMatch(/already exists/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel and Esc both call onClose without confirming', () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { cleanup } = renderToDom(
      <CreateEntryDialog kind="page" onClose={onClose} onConfirm={onConfirm} />,
    );
    act(() => {
      q('[data-testid="lm-create-cancel"]').click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    cleanup();
  });
});
