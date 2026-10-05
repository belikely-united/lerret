// create-entry-dialog.jsx — the shared "create a page / group / asset" dialog.
//
// One calm, centered modal reused by every creation surface: the dock "+ New…"
// menu, the section kebab's "Add group / Add asset", and the empty-state CTAs.
// Portaled to <body> so it escapes the canvas's zoom/pan transform (same trick
// as move-picker / animated-export-dialog), and it suspends liveRefresh while
// open so a background artboard reload can't dismiss the field mid-type.
//
// Creating an ASSET is two steps: first "where will it be published?" (a
// platform grid — Instagram, App Store, … — plus Custom size and a Markdown
// note), then that platform's formats (Story, Post, …) or a free W×H, beside
// the name field. The picked size becomes the starter's `meta.dimensions`.
// Pages, groups, variants and renames stay a single name step.
//
// Presentational + validation only — it does NOT call the create endpoint. The
// parent passes `onConfirm({ name, assetKind, dimensions })` and performs the
// write. Name
// rules come from `@lerret/core`'s `validateEntryName`, the SAME function the
// server runs, so inline feedback never disagrees with the eventual result.

import React from 'react';
import * as ReactDOM from 'react-dom';

import {
  validateEntryName,
  assetFileName,
  validateAssetDimensions,
  MIN_ASSET_DIMENSION,
  MAX_ASSET_DIMENSION,
} from '@lerret/core';

import { suspendLiveRefresh } from '../canvas/live-refresh-suspend.js';
import { formatSize } from '../canvas/size-control.jsx';
import {
  ASSET_PLATFORMS,
  CUSTOM_PLATFORM_ID,
  findPlatform,
  formatRatio,
} from './asset-platforms.js';

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
  background: 'var(--lm-bg-primary, #ffffff)',
  color: 'var(--lm-text-primary, #0A0A0A)',
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
  color: 'var(--lm-text-secondary, #6B6B6B)',
  marginTop: 2,
};

const hintRowStyle = {
  fontSize: 11,
  color: 'var(--lm-text-secondary, #6B6B6B)',
  marginTop: 6,
  lineHeight: 1.4,
};

const errorRowStyle = {
  fontSize: 12,
  color: 'var(--lm-error, #D92D20)',
  marginTop: 6,
  lineHeight: 1.4,
};

const buttonPrimary = {
  background: 'var(--lm-accent, #111111)',
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

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--lm-text-tertiary, #6B6B6B)',
  margin: 0,
};

const platformGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
  gap: 8,
};

/**
 * A platform tile or a format row. Active state rides on `.lm-seg--on` (the
 * accent inset ring) so it composes with the keyboard focus ring.
 *
 * @param {boolean} active
 * @returns {React.CSSProperties}
 */
function choiceStyle(active) {
  return {
    border: 'none',
    borderRadius: 10,
    background: active ? 'var(--lm-accent-light, rgba(17, 17, 17,0.10))' : 'var(--lm-bg-secondary, #F5F5F5)',
    color: 'var(--lm-text-primary, #0A0A0A)',
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  };
}

const monoStyle = {
  fontFamily: 'var(--lm-font-mono, ui-monospace, monospace)',
  fontSize: 11,
  color: 'var(--lm-text-tertiary, #6B6B6B)',
};

const backButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: 'var(--lm-text-secondary, #6B6B6B)',
  borderRadius: 6,
  width: 26,
  height: 26,
  marginLeft: -6,
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  flexShrink: 0,
};

const linkButtonStyle = {
  border: 'none',
  background: 'transparent',
  padding: '8px 4px',
  color: 'var(--lm-text-secondary, #6B6B6B)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  borderRadius: 6,
};

/**
 * A to-scale outline of an artboard size, fitted inside a `box`×`box` square —
 * the at-a-glance shape cue on platform tiles and format rows.
 *
 * @param {{ width: number, height: number, box?: number, dashed?: boolean }} props
 */
function RatioShape({ width, height, box = 28, dashed = false }) {
  const scale = box / Math.max(width, height);
  return (
    <span
      aria-hidden="true"
      style={{
        width: box,
        height: box,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: Math.max(4, Math.round(width * scale)),
          height: Math.max(4, Math.round(height * scale)),
          borderRadius: 3,
          border: `1.5px ${dashed ? 'dashed' : 'solid'} currentColor`,
          boxSizing: 'border-box',
          opacity: 0.55,
        }}
      />
    </span>
  );
}

/** A platform tile's preview: its first three distinct shapes, side by side. */
function PlatformShapes({ formats }) {
  const seen = new Set();
  const shapes = [];
  for (const f of formats) {
    const key = formatRatio(f.width, f.height);
    if (seen.has(key)) continue;
    seen.add(key);
    shapes.push(f);
    if (shapes.length === 3) break;
  }
  return (
    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
      {shapes.map((f) => (
        <RatioShape key={f.id} width={f.width} height={f.height} box={20} />
      ))}
    </span>
  );
}

const DEFAULT_CUSTOM_SIZE = { width: '1080', height: '1080' };

/**
 * Parse the custom W/H text fields into a dimensions object + validation.
 *
 * @param {{ width: string, height: string }} fields
 */
function parseCustomSize(fields) {
  const dims = { width: Number(fields.width), height: Number(fields.height) };
  if (fields.width.trim() === '' || fields.height.trim() === '') {
    return { dims, check: { ok: false, error: 'Enter a width and a height.' } };
  }
  return { dims, check: validateAssetDimensions(dims) };
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
    color: 'var(--lm-text-primary, #0A0A0A)',
    fontFamily: 'inherit',
    fontSize: 14,
    outline: 'none',
    boxShadow: hasError
      ? 'inset 0 0 0 1.5px var(--lm-error, #D92D20)'
      : 'none',
    transition: 'box-shadow 120ms ease',
  };
}

// A variant is a new export of the same component — its name is a JS
// identifier, not a file name. (Mirrors VARIANT_NAME in @lerret/core/source-edit;
// kept inline so this dialog doesn't pull the parser into the main bundle.)
const VARIANT_NAME = /^[A-Z][A-Za-z0-9_]*$/;

function validateName(name, kind) {
  if (kind !== 'variant') return validateEntryName(name, { kind });
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Give the variant a name.' };
  if (!VARIANT_NAME.test(trimmed)) {
    return { ok: false, error: 'Start with a capital letter; letters and numbers only (e.g. Dark, Holiday2).' };
  }
  return { ok: true, name: trimmed };
}

const KIND_COPY = {
  variant: {
    title: 'New variant',
    cta: 'Create variant',
    placeholder: 'e.g. Dark',
    hint: 'Adds another artboard from the same component. Its content gets its own slot in the data file, so you can change it independently.',
  },
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

/**
 * The shared create dialog.
 *
 * @param {object} props
 * @param {() => void} props.onClose
 *   Close handler — Esc, click-outside, Cancel, or after a successful confirm.
 * @param {(args: {
 *   name: string,
 *   assetKind?: 'component'|'markdown',
 *   dimensions?: { width: number, height: number },
 * }) => Promise<void>} props.onConfirm
 *   Invoked with the validated base name — plus, for assets, the asset kind and
 *   (components only) the picked artboard size. The dialog awaits it so it can
 *   show pending / inline-error state. Throw to surface a server error inline
 *   (the dialog stays open).
 * @param {'page'|'group'|'asset'|'variant'} [props.kind]
 * @param {string} [props.parentLabel]
 *   Human-readable destination (e.g. the page/group name) shown as a subtitle.
 * @param {string[]} [props.existingNames]
 *   Sibling entry names (folder names, or asset filenames) for an instant
 *   case-insensitive collision check. The server remains authoritative.
 * @param {'component'|'markdown'} [props.defaultAssetKind]
 *   `markdown` skips the platform step (Markdown sizes to its content).
 * @param {'create'|'rename'} [props.mode]
 *   `rename` pre-fills the field with `initialName`, swaps the title/CTA to
 *   "Rename", and keeps confirm disabled until the name actually changes.
 * @param {string} [props.initialName]
 * @returns {React.ReactElement | null}
 */
export function CreateEntryDialog({
  onClose,
  onConfirm,
  kind = 'page',
  parentLabel,
  existingNames,
  defaultAssetKind = 'component',
  mode = 'create',
  initialName = '',
}) {
  const isAsset = kind === 'asset';
  const isRename = mode === 'rename';
  // New assets get the platform → format flow; everything else is name-only.
  const pickSize = isAsset && !isRename;
  const baseCopy = KIND_COPY[kind] || KIND_COPY.page;

  const [name, setName] = React.useState(initialName);
  const [assetKind, setAssetKind] = React.useState(
    defaultAssetKind === 'markdown' ? 'markdown' : 'component',
  );
  // 'platform' → the grid; 'details' → formats (or custom W×H) + name.
  const [step, setStep] = React.useState(
    pickSize && defaultAssetKind !== 'markdown' ? 'platform' : 'details',
  );
  // Which way the last step change went — drives the slide direction.
  const [stepDir, setStepDir] = React.useState('fwd');
  const [platformId, setPlatformId] = React.useState(null);
  const [formatId, setFormatId] = React.useState(null);
  const [customSize, setCustomSize] = React.useState(DEFAULT_CUSTOM_SIZE);
  const [pending, setPending] = React.useState(false);
  const [serverError, setServerError] = React.useState(null);
  const inputRef = React.useRef(null);
  const firstTileRef = React.useRef(null);

  const platform = platformId ? findPlatform(platformId) : undefined;
  const isCustom = platformId === CUSTOM_PLATFORM_ID;
  const isComponent = assetKind === 'component';

  // Suspend the liveRefresh reload timer while open so a background artboard
  // reload doesn't reconcile this subtree away mid-interaction.
  React.useEffect(() => suspendLiveRefresh(), []);

  // Focus follows the step: the first platform tile on the grid, the name
  // field on the details step (so typing a name + Enter creates). Rename
  // pre-selects so typing replaces.
  React.useEffect(() => {
    if (step === 'platform') {
      firstTileRef.current?.focus();
      return;
    }
    inputRef.current?.focus();
    if (isRename) inputRef.current?.select();
  }, [step, isRename]);

  // Esc closes (unless a create is in flight).
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  const choosePlatform = (id) => {
    setPlatformId(id);
    setAssetKind('component');
    const p = findPlatform(id);
    setFormatId(p ? p.formats[0].id : null);
    setStepDir('fwd');
    setStep('details');
  };
  const chooseMarkdown = () => {
    setPlatformId(null);
    setAssetKind('markdown');
    setStepDir('fwd');
    setStep('details');
  };
  const goBack = () => {
    setServerError(null);
    setStepDir('back');
    setStep('platform');
  };

  // The artboard size the create will write — undefined for Markdown and for
  // non-asset kinds; `sizeCheck` gates Create on a bad custom W×H.
  const { dimensions, sizeCheck } = React.useMemo(() => {
    if (!pickSize || !isComponent) return { dimensions: undefined, sizeCheck: { ok: true } };
    if (isCustom) {
      const { dims, check } = parseCustomSize(customSize);
      return { dimensions: check.ok ? dims : undefined, sizeCheck: check };
    }
    const f = platform?.formats.find((x) => x.id === formatId);
    return f
      ? { dimensions: { width: f.width, height: f.height }, sizeCheck: { ok: true } }
      : { dimensions: undefined, sizeCheck: { ok: true } };
  }, [pickSize, isComponent, isCustom, customSize, platform, formatId]);

  let copy = isRename ? { ...baseCopy, title: `Rename ${kind}`, cta: 'Rename' } : baseCopy;
  if (pickSize && step === 'details') {
    if (!isComponent) copy = { ...copy, title: 'New Markdown note', placeholder: 'e.g. notes' };
    else if (isCustom) copy = { ...copy, title: 'New custom-size asset' };
    else if (platform) copy = { ...copy, title: `New ${platform.label} asset` };
  }

  const trimmed = name.trim();
  const validation = React.useMemo(() => validateName(name, kind), [name, kind]);

  // Instant case-insensitive collision check against known siblings.
  const collision = React.useMemo(() => {
    if (!validation.ok || !Array.isArray(existingNames)) return false;
    const finalName = isAsset ? assetFileName(validation.name, assetKind) : validation.name;
    const lower = finalName.toLowerCase();
    return existingNames.some((n) => String(n).toLowerCase() === lower);
  }, [validation, existingNames, isAsset, assetKind]);

  // In rename mode the unchanged name is a no-op — keep confirm disabled.
  const unchanged = isRename && validation.ok && validation.name === initialName;
  const canCreate =
    step === 'details' &&
    trimmed.length > 0 &&
    validation.ok &&
    sizeCheck.ok &&
    !collision &&
    !unchanged &&
    !pending;

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
    const v = validateName(name, kind);
    if (!v.ok || pending || !sizeCheck.ok) return;
    setServerError(null);
    setPending(true);
    try {
      const payload = { name: v.name, assetKind: isAsset ? assetKind : undefined };
      if (dimensions) payload.dimensions = dimensions;
      await onConfirm(payload);
      onClose();
    } catch (err) {
      setServerError(err && err.message ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }, [name, kind, pending, sizeCheck, onConfirm, isAsset, assetKind, dimensions, onClose]);

  const onInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canCreate) submit();
    }
  };

  if (typeof document === 'undefined') return null;

  const header = (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      {pickSize && step === 'details' && (
        <button
          type="button"
          className="lm-focusable"
          style={backButtonStyle}
          onClick={goBack}
          disabled={pending}
          aria-label="Back to platforms"
          data-testid="lm-create-back"
        >
          ‹
        </button>
      )}
      <div>
        <h2 style={titleStyle}>{copy.title}</h2>
        {parentLabel ? <div style={subtitleStyle}>in {parentLabel}</div> : null}
      </div>
    </div>
  );

  const cancelButton = (
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
  );

  // ── Step 1: where will it be published? ─────────────────────────────────
  const platformStep = (
    <>
      <p style={sectionLabelStyle}>Where will it be published?</p>
      <div style={platformGridStyle} role="list" data-testid="lm-create-platforms">
        {ASSET_PLATFORMS.map((p, i) => (
          <button
            key={p.id}
            ref={i === 0 ? firstTileRef : undefined}
            type="button"
            role="listitem"
            className="lm-seg lm-create-choice"
            style={{ ...choiceStyle(false), padding: '10px 10px 9px', display: 'flex', flexDirection: 'column', gap: 8 }}
            onClick={() => choosePlatform(p.id)}
            data-testid={`lm-create-platform-${p.id}`}
          >
            <PlatformShapes formats={p.formats} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: 'var(--lm-text-tertiary, #6B6B6B)' }}>
                {p.formats.length} sizes
              </span>
            </span>
          </button>
        ))}
        <button
          type="button"
          role="listitem"
          className="lm-seg lm-create-choice"
          style={{ ...choiceStyle(false), padding: '10px 10px 9px', display: 'flex', flexDirection: 'column', gap: 8 }}
          onClick={() => choosePlatform(CUSTOM_PLATFORM_ID)}
          data-testid={`lm-create-platform-${CUSTOM_PLATFORM_ID}`}
        >
          <span style={{ display: 'flex', alignItems: 'flex-end', height: 22 }}>
            <RatioShape width={3} height={2} box={20} dashed />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Custom size</span>
            <span style={{ fontSize: 11, color: 'var(--lm-text-tertiary, #6B6B6B)' }}>Any W × H</span>
          </span>
        </button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="lm-focusable"
          style={linkButtonStyle}
          onClick={chooseMarkdown}
          data-testid="lm-create-type-markdown"
        >
          Write a Markdown note instead
        </button>
        {cancelButton}
      </div>
    </>
  );

  // ── Step 2 (sizing part): the platform's formats, or a free W×H ─────────
  let sizePicker = null;
  if (pickSize && isComponent && platform) {
    sizePicker = (
      <div>
        <p style={{ ...sectionLabelStyle, marginBottom: 8 }}>Format</p>
        <div
          role="radiogroup"
          aria-label={`${platform.label} format`}
          data-testid="lm-create-formats"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 264,
            overflowY: 'auto',
            margin: -3,
            padding: 3,
          }}
        >
          {platform.formats.map((f) => {
            const active = f.id === formatId;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={'lm-seg lm-create-choice' + (active ? ' lm-seg--on' : '')}
                style={{
                  ...choiceStyle(active),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  color: active ? 'var(--lm-accent-text, #111111)' : 'var(--lm-text-primary, #0A0A0A)',
                }}
                onClick={() => setFormatId(f.id)}
                data-testid={`lm-create-format-${f.id}`}
              >
                <RatioShape width={f.width} height={f.height} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{f.label}</span>
                <span style={monoStyle}>{formatSize(f.width, f.height)}</span>
                <span style={{ ...monoStyle, width: 50, textAlign: 'right' }}>
                  {formatRatio(f.width, f.height)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  } else if (pickSize && isComponent && isCustom) {
    // Outline only the edge that is actually out of range.
    const edgeInvalid = (edge) => {
      const raw = customSize[edge];
      const n = Number(raw);
      return (
        raw.trim() === '' ||
        !Number.isInteger(n) ||
        n < MIN_ASSET_DIMENSION ||
        n > MAX_ASSET_DIMENSION
      );
    };
    const numberField = (edge) => (
      <input
        type="number"
        inputMode="numeric"
        min={MIN_ASSET_DIMENSION}
        max={MAX_ASSET_DIMENSION}
        step={1}
        value={customSize[edge]}
        onChange={(e) => setCustomSize((cur) => ({ ...cur, [edge]: e.target.value }))}
        onKeyDown={onInputKeyDown}
        aria-label={edge === 'width' ? 'Width in pixels' : 'Height in pixels'}
        data-testid={`lm-create-custom-${edge}`}
        style={{ ...inputStyle(edgeInvalid(edge)), width: 96, fontFamily: 'var(--lm-font-mono, ui-monospace, monospace)' }}
      />
    );
    const preview = parseCustomSize(customSize);
    sizePicker = (
      <div>
        <p style={{ ...sectionLabelStyle, marginBottom: 8 }}>Size (px)</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {numberField('width')}
          <span aria-hidden="true" style={{ color: 'var(--lm-text-tertiary, #6B6B6B)' }}>×</span>
          {numberField('height')}
          {preview.check.ok ? (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--lm-text-secondary, #6B6B6B)' }}>
              <RatioShape width={preview.dims.width} height={preview.dims.height} />
              <span style={monoStyle}>{formatRatio(preview.dims.width, preview.dims.height)}</span>
            </span>
          ) : null}
        </div>
        {!sizeCheck.ok ? (
          <div style={errorRowStyle} data-testid="lm-create-size-error">
            {sizeCheck.error}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Step 2 / single step: name + confirm ────────────────────────────────
  const detailsStep = (
    <>
      {sizePicker}

      <div>
        {sizePicker ? <p style={{ ...sectionLabelStyle, marginBottom: 8 }}>Name</p> : null}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onInputKeyDown}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = inlineError
              ? 'inset 0 0 0 1.5px var(--lm-error, #D92D20), var(--lm-focus-ring, 0 0 0 2px rgba(17, 17, 17,0.20))'
              : 'var(--lm-focus-ring, 0 0 0 2px rgba(17, 17, 17,0.20))';
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow = inlineError
              ? 'inset 0 0 0 1.5px var(--lm-error, #D92D20)'
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
        ) : dimensions ? (
          <div style={hintRowStyle}>
            Starts at {formatSize(dimensions.width, dimensions.height)} — change it any time from
            the artboard&rsquo;s size chip.
          </div>
        ) : null}
      </div>

      {serverError && (
        <div style={errorRowStyle} data-testid="lm-create-server-error">
          {serverError}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {cancelButton}
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
          {pending ? (isRename ? 'Renaming…' : 'Creating…') : copy.cta}
        </button>
      </div>
    </>
  );

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
        style={pickSize ? { ...sheetStyle, width: 460 } : sheetStyle}
        data-testid="lm-create-dialog"
        data-step={pickSize ? step : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {pickSize ? (
          // Keyed per step so each step mounts fresh and its `@starting-style`
          // entry (motion.css `.lm-create-step`) slides in from the side the
          // user is heading.
          <div
            key={step}
            className="lm-create-step"
            data-dir={stepDir}
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            {step === 'platform' ? platformStep : detailsStep}
          </div>
        ) : (
          detailsStep
        )}
      </div>
    </div>,
    document.body,
  );
}

export default CreateEntryDialog;
