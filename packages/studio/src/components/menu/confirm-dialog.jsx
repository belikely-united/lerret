// confirm-dialog.jsx — a calm confirmation modal for weighty / destructive
// actions where the lightweight inline kebab confirm isn't enough (e.g.
// deleting a whole page and everything inside it).
//
// Mirrors CreateEntryDialog's modal shell: portaled to <body> so it escapes the
// canvas zoom/pan transform; Esc / click-outside / Cancel dismiss; the confirm
// handler is awaited so it can show a pending state and surface an inline error
// (the dialog stays open on failure).

import React from 'react';
import * as ReactDOM from 'react-dom';

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,15,15,0.42)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--lm-font-sans, system-ui)',
};

const sheetStyle = {
  background: 'var(--lm-bg-primary, #fdfaf3)',
  color: 'var(--lm-text-primary, #1A1714)',
  borderRadius: 14,
  padding: 24,
  width: 400,
  maxWidth: '90vw',
  boxShadow: '0 24px 64px rgba(15,23,42,0.28)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const titleStyle = { margin: 0, fontSize: 16, fontWeight: 600 };

const messageStyle = {
  fontSize: 13,
  lineHeight: 1.5,
  color: 'var(--lm-text-secondary, #3A3530)',
};

const errorRowStyle = {
  fontSize: 12,
  color: '#B85B33',
  lineHeight: 1.4,
};

const buttonSecondary = {
  background: 'transparent',
  color: 'inherit',
  border: '1px solid var(--lm-border, rgba(26,23,20,0.18))',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const buttonPrimary = {
  background: 'var(--lm-accent, #B85B33)',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonDestructive = {
  ...buttonPrimary,
  background: 'var(--lm-error, #A8412B)',
};

/**
 * A confirmation modal.
 *
 * @param {object} props
 * @param {string} props.title  The dialog heading (e.g. `Delete page "social"?`).
 * @param {React.ReactNode} [props.message]
 *   Body copy — the explanation + warning. May be a string or rich node.
 * @param {string} [props.confirmLabel='Confirm']
 * @param {string} [props.cancelLabel='Cancel']
 * @param {boolean} [props.destructive=false]  Paint the confirm button red.
 * @param {() => void | Promise<void>} props.onConfirm
 *   Awaited; the dialog shows a pending state and closes on success. Throw to
 *   surface an inline error and keep the dialog open.
 * @param {() => void} props.onClose
 * @returns {React.ReactElement | null}
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onClose,
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState(null);
  const confirmRef = React.useRef(null);

  // Focus the confirm button on mount (keyboard users land inside the dialog).
  React.useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // Esc closes (unless an action is in flight).
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const confirm = React.useCallback(async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [pending, onConfirm, onClose]);

  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        style={sheetStyle}
        data-testid="lm-confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={titleStyle}>{title}</h2>
        {message ? <div style={messageStyle}>{message}</div> : null}
        {error ? (
          <div style={errorRowStyle} data-testid="lm-confirm-error">
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            style={buttonSecondary}
            onClick={onClose}
            disabled={pending}
            data-testid="lm-confirm-cancel"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            style={{
              ...(destructive ? buttonDestructive : buttonPrimary),
              opacity: pending ? 0.6 : 1,
              cursor: pending ? 'wait' : 'pointer',
            }}
            onClick={confirm}
            disabled={pending}
            data-testid="lm-confirm-accept"
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ConfirmDialog;
