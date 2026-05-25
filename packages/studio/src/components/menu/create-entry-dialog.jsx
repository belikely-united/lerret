// create-entry-dialog.jsx — the shared "create a page / group / asset" dialog.
//
// One calm, centered modal reused by every creation surface: the dock "+ New…"
// menu, the section kebab's "Add group / Add asset", and the empty-state CTAs.
// Portaled to <body> so it escapes the canvas's zoom/pan transform (same trick
// as move-picker / animated-export-dialog), and it suspends liveRefresh while
// open so a background artboard reload can't dismiss the field mid-type.
//
// Presentational + validation only — it does NOT call the create endpoint. The
// parent passes `onConfirm({ name, assetKind })` and performs the write. Name
// rules come from `@lerret/core`'s `validateEntryName`, the SAME function the
// server runs, so inline feedback never disagrees with the eventual result.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { validateEntryName, assetFileName } from '@lerret/core';

import { suspendLiveRefresh } from '../canvas/live-refresh-suspend.js';

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
  width: 380,
  maxWidth: '90vw',
  boxShadow: 'var(--lm-shadow-popup, 0 24px 64px rgba(15,23,42,0.28))',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const titleStyle = { margin: 0, fontSize: 16, fontWeight: 600 };

const subtitleStyle = {
  fontSize: 11,
  color: 'var(--lm-text-secondary, #6E6960)',
  marginTop: 2,
};

const hintRowStyle = {
  fontSize: 11,
  color: 'var(--lm-text-secondary, #6E6960)',
  marginTop: 6,
  lineHeight: 1.4,
};

const errorRowStyle = {
  fontSize: 12,
  color: '#B85B33',
  marginTop: 6,
  lineHeight: 1.4,
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

const buttonSecondary = {
  background: 'var(--lm-bg-tertiary)',
  color: 'inherit',
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

/**
 * @param {boolean} active
 * @returns {React.CSSProperties}
 */
function segStyle(active) {
  return {
    flex: 1,
    padding: '7px 0',
    borderRadius: 8,
    border: 'none',
    background: active ? 'var(--lm-accent-light, rgba(184,91,51,0.10))' : 'var(--lm-bg-tertiary)',
    color: active ? 'var(--lm-accent-text, #B85B33)' : 'var(--lm-text-secondary, #3A3530)',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  };
}

/**
 * @param {boolean} hasError
 * @returns {React.CSSProperties}
 */
function inputStyle(hasError) {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--lm-bg-tertiary)',
    color: 'var(--lm-text-primary, #1A1714)',
    fontFamily: 'inherit',
    fontSize: 14,
    outline: 'none',
    boxShadow: hasError
      ? 'inset 0 0 0 1.5px var(--lm-error, #A8412B)'
      : 'none',
    transition: 'box-shadow 120ms ease',
  };
}

const KIND_COPY = {
  page: {
    title: 'New page',
    cta: 'Create page',
    placeholder: 'e.g. landing',
    hint: 'A page is a top-level folder. Pages sort alphabetically — prefix with 01-, 02- to order them.',
  },
  group: {
    title: 'New group',
    cta: 'Create group',
    placeholder: 'e.g. social',
    hint: 'A group is a folder of assets inside a page.',
  },
  asset: {
    title: 'New asset',
    cta: 'Create asset',
    placeholder: 'e.g. hero',
    hint: null,
  },
};

const ASSET_TYPES = [
  ['component', 'Component', '.jsx'],
  ['markdown', 'Markdown', '.md'],
];

/**
 * The shared create dialog.
 *
 * @param {object} props
 * @param {() => void} props.onClose
 *   Close handler — Esc, click-outside, Cancel, or after a successful confirm.
 * @param {(args: { name: string, assetKind?: 'component'|'markdown' }) => Promise<void>} props.onConfirm
 *   Invoked with the validated base name (and asset kind, for assets). The
 *   dialog awaits it so it can show pending / inline-error state. Throw to
 *   surface a server error inline (the dialog stays open).
 * @param {'page'|'group'|'asset'} [props.kind]
 * @param {string} [props.parentLabel]
 *   Human-readable destination (e.g. the page/group name) shown as a subtitle.
 * @param {string[]} [props.existingNames]
 *   Sibling entry names (folder names, or asset filenames) for an instant
 *   case-insensitive collision check. The server remains authoritative.
 * @param {'component'|'markdown'} [props.defaultAssetKind]
 * @returns {React.ReactElement | null}
 */
export function CreateEntryDialog({
  onClose,
  onConfirm,
  kind = 'page',
  parentLabel,
  existingNames,
  defaultAssetKind = 'component',
}) {
  const copy = KIND_COPY[kind] || KIND_COPY.page;
  const isAsset = kind === 'asset';

  const [name, setName] = React.useState('');
  const [assetKind, setAssetKind] = React.useState(
    defaultAssetKind === 'markdown' ? 'markdown' : 'component',
  );
  const [pending, setPending] = React.useState(false);
  const [serverError, setServerError] = React.useState(null);
  const inputRef = React.useRef(null);

  // Suspend the liveRefresh reload timer while open so a background artboard
  // reload doesn't reconcile this subtree away mid-interaction.
  React.useEffect(() => suspendLiveRefresh(), []);

  // Autofocus the name field on mount.
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc closes (unless a create is in flight).
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const trimmed = name.trim();
  const validation = React.useMemo(() => validateEntryName(name, { kind }), [name, kind]);

  // Instant case-insensitive collision check against known siblings.
  const collision = React.useMemo(() => {
    if (!validation.ok || !Array.isArray(existingNames)) return false;
    const finalName = isAsset ? assetFileName(validation.name, assetKind) : validation.name;
    const lower = finalName.toLowerCase();
    return existingNames.some((n) => String(n).toLowerCase() === lower);
  }, [validation, existingNames, isAsset, assetKind]);

  const canCreate = trimmed.length > 0 && validation.ok && !collision && !pending;

  // Inline message: validation error or collision (only once the user typed).
  let inlineError = null;
  if (trimmed.length > 0) {
    if (!validation.ok) {
      inlineError = validation.error;
    } else if (collision) {
      const finalName = isAsset ? assetFileName(validation.name, assetKind) : validation.name;
      inlineError = `"${finalName}" already exists here.`;
    }
  }

  const submit = React.useCallback(async () => {
    // Re-derive guard inside the callback so a stale closure can't submit.
    const v = validateEntryName(name, { kind });
    if (!v.ok || pending) return;
    setServerError(null);
    setPending(true);
    try {
      await onConfirm({ name: v.name, assetKind: isAsset ? assetKind : undefined });
      onClose();
    } catch (err) {
      setServerError(err && err.message ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [name, kind, pending, onConfirm, isAsset, assetKind, onClose]);

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate) submit();
    }
  };

  if (typeof document === 'undefined') return null;

  return ReactDOM.createPortal(
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        style={sheetStyle}
        data-testid="lm-create-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 style={titleStyle}>{copy.title}</h2>
          {parentLabel ? <div style={subtitleStyle}>in {parentLabel}</div> : null}
        </div>

        {isAsset && (
          <div style={{ display: 'flex', gap: 6 }}>
            {ASSET_TYPES.map(([val, label, ext]) => {
              const active = assetKind === val;
              return (
                <button
                  key={val}
                  type="button"
                  className={'lm-seg' + (active ? ' lm-seg--on' : '')}
                  onClick={() => setAssetKind(val)}
                  aria-pressed={active}
                  data-testid={`lm-create-type-${val}`}
                  style={segStyle(active)}
                >
                  {label} <span style={{ opacity: 0.6, fontWeight: 500 }}>{ext}</span>
                </button>
              );
            })}
          </div>
        )}

        <div>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onInputKeyDown}
            onFocus={(e) => {
              e.currentTarget.style.boxShadow = inlineError
                ? 'inset 0 0 0 1.5px var(--lm-error, #A8412B), var(--lm-focus-ring, 0 0 0 2px rgba(184,91,51,0.20))'
                : 'var(--lm-focus-ring, 0 0 0 2px rgba(184,91,51,0.20))';
            }}
            onBlur={(e) => {
              e.currentTarget.style.boxShadow = inlineError
                ? 'inset 0 0 0 1.5px var(--lm-error, #A8412B)'
                : 'none';
            }}
            placeholder={copy.placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${copy.title} name`}
            aria-invalid={inlineError ? 'true' : undefined}
            data-testid="lm-create-name-input"
            style={inputStyle(!!inlineError)}
          />
          {inlineError ? (
            <div style={errorRowStyle} data-testid="lm-create-error">
              {inlineError}
            </div>
          ) : copy.hint ? (
            <div style={hintRowStyle}>{copy.hint}</div>
          ) : null}
        </div>

        {serverError && (
          <div style={errorRowStyle} data-testid="lm-create-server-error">
            {serverError}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            className="lm-focusable"
            style={buttonSecondary}
            onClick={onClose}
            disabled={pending}
            data-testid="lm-create-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="lm-focusable"
            style={{
              ...buttonPrimary,
              opacity: canCreate ? 1 : 0.5,
              cursor: canCreate ? 'pointer' : 'not-allowed',
            }}
            onClick={submit}
            disabled={!canCreate}
            data-testid="lm-create-confirm"
          >
            {pending ? 'Creating…' : copy.cta}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CreateEntryDialog;
