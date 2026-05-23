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

  it('asset kind shows a Component/Markdown toggle and passes assetKind', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(q('[data-testid="lm-create-type-component"]')).toBeTruthy();
    expect(q('[data-testid="lm-create-type-markdown"]')).toBeTruthy();
    typeInput('hero');
    await act(async () => {
      q('[data-testid="lm-create-confirm"]').click();
    });
    expect(onConfirm).toHaveBeenCalledWith({ name: 'hero', assetKind: 'component' });
  });

  it('switching to Markdown changes the asset kind in the payload', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderToDom(<CreateEntryDialog kind="asset" onClose={vi.fn()} onConfirm={onConfirm} />);
    act(() => {
      q('[data-testid="lm-create-type-markdown"]').click();
    });
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
