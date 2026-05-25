// size-control.jsx — the artboard label-row "canvas size" control.
//
// Dimensions live in the asset's `meta` export, which the kebab → "Edit meta"
// dialog buries two clicks deep. Size is the most spatial, most-tweaked
// property, so it gets a first-class, always-visible affordance: a subtle
// `1080×540` readout chip in the label row that opens a compact picker with
// aspect PRESETS (1:1 / 4:5 / 9:16 / 16:9 / OG) + a custom W×H entry.
//
// PRESENTATIONAL ONLY. The chip reports the current `meta.dimensions` and calls
// `onSelect({ width, height })`; the call site (ComponentArtboardKebab) does the
// source read → `rewriteMetaExport` → write, exactly as the meta editor does,
// so dimensions stay the source-of-truth in code.
//
// Mirrors live-refresh-control.jsx (badge + portaled popover) so the two
// label-row controls feel like one family.

import React from 'react';
import * as ReactDOM from 'react-dom';

/**
 * Aspect-ratio presets, in picker order. Values are the long-standing
 * social/canvas defaults designers reach for first.
 *
 * @type {ReadonlyArray<{ id: string, label: string, width: number, height: number }>}
 */
export const SIZE_PRESETS = Object.freeze([
  { id: 'square', label: '1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: '4:5', width: 1080, height: 1350 },
  { id: 'story', label: '9:16', width: 1080, height: 1920 },
  { id: 'wide', label: '16:9', width: 1920, height: 1080 },
  { id: 'og', label: 'OG', width: 1200, height: 630 },
]);

/** Smallest sensible edge (px). Below this an artboard is not meaningfully editable. */
export const MIN_DIMENSION = 16;
/** Largest edge (px) — guards a fat-fingered value from blowing up the canvas. */
export const MAX_DIMENSION = 10000;

/**
 * Format dimensions as a compact `W×H` string (true multiplication sign).
 *
 * @param {number} w
 * @param {number} h
 * @returns {string}
 */
export function formatSize(w, h) {
  return `${w}×${h}`;
}

/**
 * Whether a value is a usable pixel dimension: a finite integer in range.
 *
 * @param {unknown} n
 * @returns {n is number}
 */
export function isValidDimension(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_DIMENSION && n <= MAX_DIMENSION;
}

// ── Styles (injected once) ───────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('lm-size-control-styles')) {
  const s = document.createElement('style');
  s.id = 'lm-size-control-styles';
  s.textContent = `
/* Size readout — a quiet, monospace dimensions pill in the label row. */
.lm-size-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  height: 20px;
  font-family: var(--lm-font-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1;
  color: var(--lm-text-tertiary, #6E6960);
  background: transparent;
  border: 1px solid var(--lm-border, rgba(26, 23, 20, 0.14));
  border-radius: var(--lm-radius-pill, 999px);
  cursor: pointer;
  user-select: none;
  outline: none;
  transition: background var(--lm-duration-fast, 120ms) var(--lm-ease, ease),
    color var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
.lm-size-badge:hover {
  background: var(--lm-surface-hover, rgba(26, 23, 20, 0.05));
  color: var(--lm-text-secondary, #3A3530);
}
.lm-size-badge:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }

/* Picker popover. */
.lm-size-pop {
  position: fixed;
  z-index: 90;
  width: 252px;
  box-sizing: border-box;
  padding: 12px;
  background: var(--lm-surface, #FFFDF9);
  border: 1px solid var(--lm-border, rgba(26, 23, 20, 0.12));
  border-radius: var(--lm-radius-md, 12px);
  box-shadow: var(--lm-shadow-pop, 0 10px 30px rgba(26, 23, 20, 0.18));
  animation: lm-size-pop-in var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
@keyframes lm-size-pop-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
.lm-size-pop__label {
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--lm-text-tertiary, #6E6960);
  margin-bottom: 8px;
}
.lm-size-pop__chips { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.lm-size-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  padding: 8px 6px;
  border: 1px solid var(--lm-border, rgba(26, 23, 20, 0.14));
  border-radius: var(--lm-radius-sm, 8px);
  background: transparent;
  color: var(--lm-text-secondary, #3A3530);
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  cursor: pointer;
  outline: none;
  transition: background var(--lm-duration-fast, 120ms) var(--lm-ease, ease),
    border-color var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
.lm-size-chip--wide { grid-column: 1 / -1; }
.lm-size-chip:hover { background: var(--lm-surface-hover, rgba(26, 23, 20, 0.05)); }
.lm-size-chip:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-size-chip[aria-checked='true'] {
  border-color: var(--lm-accent, #B85B33);
  background: var(--lm-accent-light, rgba(184, 91, 51, 0.08));
  color: var(--lm-accent, #B85B33);
}
.lm-size-chip__ratio { font-size: 13px; font-weight: 600; line-height: 1; }
.lm-size-chip__dims {
  font-family: var(--lm-font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--lm-text-tertiary, #6E6960);
  line-height: 1;
}
.lm-size-chip[aria-checked='true'] .lm-size-chip__dims { color: var(--lm-accent, #B85B33); }

.lm-size-pop__custom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}
.lm-size-pop__custom input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--lm-border, rgba(26, 23, 20, 0.18));
  border-radius: var(--lm-radius-sm, 8px);
  background: var(--lm-surface-sunken, #FBF8F2);
  color: var(--lm-text-primary, #1A1714);
  font-family: var(--lm-font-mono, ui-monospace, monospace);
  font-size: 13px;
  outline: none;
}
.lm-size-pop__custom input:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-size-pop__times { font-size: 12px; color: var(--lm-text-tertiary, #6E6960); flex: 0 0 auto; }
.lm-size-pop__apply {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: none;
  border-radius: var(--lm-radius-sm, 8px);
  background: var(--lm-accent, #B85B33);
  color: #fff;
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  outline: none;
}
.lm-size-pop__apply:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-size-pop__error {
  margin-top: 8px;
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 11px;
  color: var(--lm-danger, #B4452E);
}
.lm-size-pop__reason {
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 12px;
  color: var(--lm-text-tertiary, #6E6960);
  line-height: 1.4;
}
@media (prefers-reduced-motion: reduce) {
  .lm-size-badge { transition: none !important; }
  .lm-size-pop { animation: none !important; }
}
`;
  document.head.appendChild(s);
}

// ── SizeBadge ────────────────────────────────────────────────────────────────

/**
 * The always-visible dimensions readout in the artboard label row. Renders
 * nothing unless both dimensions are valid (the asset's `meta` declares them).
 * Clicking it (real `<button>` — click / Enter / Space) opens the picker.
 *
 * @param {object} props
 * @param {number} props.width
 * @param {number} props.height
 * @param {() => void} props.onActivate
 * @returns {React.ReactElement | null}
 */
export function SizeBadge({ width, height, onActivate }) {
  if (!isValidDimension(width) || !isValidDimension(height)) return null;
  const dims = formatSize(width, height);
  const label = `Canvas size — ${dims}. Click to change.`;
  return (
    <button
      type="button"
      className="lm-size-badge"
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      data-testid="lm-size-badge"
    >
      <span>{dims}</span>
    </button>
  );
}

// ── SizePopover ──────────────────────────────────────────────────────────────

/**
 * Compact size picker anchored under `anchorEl`. Portaled to `document.body`
 * so no ancestor `overflow` clips it. Dismisses on outside-click or Escape.
 *
 * Selecting a preset or applying a valid custom value calls
 * `onSelect({ width, height })`; the call site writes meta and closes.
 *
 * @param {object} props
 * @param {Element | null} props.anchorEl
 * @param {number} props.width   Current width (px).
 * @param {number} props.height  Current height (px).
 * @param {boolean} [props.disabled]
 * @param {string} [props.disabledReason]
 * @param {(size: { width: number, height: number }) => void} props.onSelect
 * @param {() => void} props.onClose
 * @returns {React.ReactElement | null}
 */
export function SizePopover({ anchorEl, width, height, disabled = false, disabledReason, onSelect, onClose }) {
  const popRef = React.useRef(null);
  const [coords, setCoords] = React.useState(null);
  const [wText, setWText] = React.useState(isValidDimension(width) ? String(width) : '');
  const [hText, setHText] = React.useState(isValidDimension(height) ? String(height) : '');
  const [error, setError] = React.useState(null);

  // Position the popover (fixed, right-aligned under the anchor).
  React.useLayoutEffect(() => {
    if (!anchorEl) return undefined;
    const measure = () => {
      const r = anchorEl.getBoundingClientRect();
      setCoords({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [anchorEl]);

  React.useEffect(() => {
    if (coords && popRef.current) popRef.current.focus();
  }, [coords]);

  // Outside-click + Escape dismiss.
  React.useEffect(() => {
    const onPointerDown = (e) => {
      const inPop = popRef.current && popRef.current.contains(e.target);
      const inAnchor = anchorEl && anchorEl.contains(e.target);
      if (!inPop && !inAnchor) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorEl, onClose]);

  const activeId = SIZE_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? null;

  const commitCustom = () => {
    const w = Number.parseInt(wText, 10);
    const h = Number.parseInt(hText, 10);
    if (!isValidDimension(w) || !isValidDimension(h)) {
      setError(`Enter whole numbers between ${MIN_DIMENSION} and ${MAX_DIMENSION}.`);
      return;
    }
    onSelect({ width: w, height: h });
  };

  if (!coords) return null;

  const content = (
    <div
      ref={popRef}
      className="lm-size-pop"
      role="dialog"
      aria-label="Canvas size"
      tabIndex={-1}
      style={coords}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="lm-size-pop"
    >
      <div className="lm-size-pop__label">Canvas size</div>
      {disabled ? (
        <div className="lm-size-pop__reason">
          {disabledReason || 'Resizing needs `@lerret/cli dev`.'}
        </div>
      ) : (
        <>
          <div className="lm-size-pop__chips" role="radiogroup" aria-label="Aspect presets">
            {SIZE_PRESETS.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={activeId === p.id}
                className={
                  // The odd one out spans the full width so the 2-col grid has
                  // no empty cell.
                  i === SIZE_PRESETS.length - 1 ? 'lm-size-chip lm-size-chip--wide' : 'lm-size-chip'
                }
                data-testid={`lm-size-chip-${p.id}`}
                onClick={() => {
                  setError(null);
                  onSelect({ width: p.width, height: p.height });
                }}
              >
                <span className="lm-size-chip__ratio">{p.label}</span>
                <span className="lm-size-chip__dims">{formatSize(p.width, p.height)}</span>
              </button>
            ))}
          </div>
          <div className="lm-size-pop__custom">
            <input
              type="number"
              inputMode="numeric"
              aria-label="Width in pixels"
              value={wText}
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              onChange={(e) => {
                setError(null);
                setWText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCustom();
              }}
              data-testid="lm-size-w"
            />
            <span className="lm-size-pop__times" aria-hidden="true">
              ×
            </span>
            <input
              type="number"
              inputMode="numeric"
              aria-label="Height in pixels"
              value={hText}
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              onChange={(e) => {
                setError(null);
                setHText(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCustom();
              }}
              data-testid="lm-size-h"
            />
            <button
              type="button"
              className="lm-size-pop__apply"
              onClick={commitCustom}
              data-testid="lm-size-apply"
            >
              Set
            </button>
          </div>
          {error ? (
            <div className="lm-size-pop__error" role="alert">
              {error}
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
