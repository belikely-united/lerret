// live-refresh-control.jsx — on-artboard control for an asset's timed auto-refresh.
//
// NOTE: the user-facing label is "Auto-refresh" (distinct from the file-save live
// reload the docs call "Live refresh"). The config key and code identifiers keep
// the `liveRefresh` name on purpose — only the visible label changed.
//
// Auto-refresh re-renders an asset's artboard on a timer (see
// live-refresh-manager.js). The *rate* is stored in the asset's folder
// config.json under `liveRefresh: { <assetName>: <ms> }`, cascade-inherited.
// This module is the friendly control surface over that data — it never
// introduces per-asset metadata; it only reads/writes that one map.
//
// Two pieces (plus a pure transform):
//   • LiveRefreshBadge   — a small "● 1s" pill shown in the artboard label row
//     when refresh is ON. Clicking it opens the picker. It is confirmation that
//     the asset is live AND the discovery hook for the whole feature.
//   • LiveRefreshPopover — a compact rate picker: Off · 0.5s · 1s · 2s · 5s ·
//     Custom… The asset name is implicit (you are acting on this artboard), so
//     there is nothing to type and no milliseconds to reason about.
//   • nextAssetConfig — pure: given the asset's current config and a rate
//     change, return the next `Name.config.json` value to serialize + write.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { MIN_INTERVAL_MS } from './live-refresh-manager.js';

// ── Presets ──────────────────────────────────────────────────────────────────
// Friendly cadences in seconds. "Off" is modeled as `null`, not a chip value.
// "Custom…" reveals an inline seconds field for anything else, down to the
// MIN_INTERVAL_MS frame floor.

/** @type {Array<{ label: string, ms: number }>} */
export const RATE_PRESETS = [
  { label: '0.5s', ms: 500 },
  { label: '1s', ms: 1000 },
  { label: '2s', ms: 2000 },
  { label: '5s', ms: 5000 },
];

/** Smallest custom rate the user may enter, in seconds (the 60fps frame floor). */
export const MIN_INTERVAL_SECONDS = MIN_INTERVAL_MS / 1000;

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format a refresh interval (ms) as a short human cadence: 1000 → "1s",
 * 500 → "0.5s", 250 → "0.25s". Trailing zeros are trimmed.
 *
 * @param {number} ms
 * @returns {string}
 */
export function formatRate(ms) {
  const seconds = ms / 1000;
  const text = Number(seconds.toFixed(2)).toString();
  return `${text}s`;
}

// ── Pure config transform ────────────────────────────────────────────────────

/**
 * Compute the next `Name.config.json` value when an asset's auto-refresh rate
 * changes (ADR-003). Merges onto the asset's current config so any other keys
 * survive.
 *
 * - Set a rate (`ms` is a positive number): `autoRefresh = ms`.
 * - Turn off (`ms` is `null`): delete the `autoRefresh` key.
 *
 * The caller writes the result — or deletes the file when it comes back empty.
 *
 * @param {Record<string, unknown>} ownConfig The asset's current config (or `{}`).
 * @param {number | null} ms Positive ms to enable, or `null` to turn off.
 * @returns {Record<string, unknown>} A fresh config object to serialize + write.
 */
export function nextAssetConfig(ownConfig, ms) {
  const base =
    ownConfig && typeof ownConfig === 'object' && !Array.isArray(ownConfig) ? ownConfig : {};
  const next = { ...base };
  if (ms == null) {
    delete next.autoRefresh;
  } else {
    next.autoRefresh = ms;
  }
  return next;
}

// ── CSS (injected once; uses shared design tokens, mirrors validation-badge) ──

if (typeof document !== 'undefined' && !document.getElementById('lm-live-refresh-styles')) {
  const s = document.createElement('style');
  s.id = 'lm-live-refresh-styles';
  s.textContent = `
/* Live-refresh badge — a calm "live" pill in the artboard label row. */
.lm-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  height: 20px;
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 11px;
  font-weight: var(--lm-weight-semibold, 600);
  letter-spacing: 0.02em;
  line-height: 1;
  color: var(--lm-text-secondary, #3A3530);
  background: var(--lm-success-light, rgba(74, 107, 63, 0.10));
  border: 1px solid var(--lm-success-border, rgba(74, 107, 63, 0.20));
  border-radius: var(--lm-radius-pill, 999px);
  cursor: pointer;
  user-select: none;
  outline: none;
  transition: background var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
.lm-live-badge:hover { background: var(--lm-success-light, rgba(74, 107, 63, 0.18)); }
.lm-live-badge:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-live-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--lm-success, #4A6B3F);
  animation: lm-live-pulse 1.6s var(--lm-ease, ease) infinite;
}
@keyframes lm-live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.78); }
}

/* Rate picker popover. */
.lm-live-pop {
  position: fixed;
  z-index: 90;
  min-width: 208px;
  max-width: 280px;
  padding: 10px;
  background: var(--lm-surface-raised, #fff);
  border: 1px solid var(--lm-border, #DDD7CA);
  border-radius: var(--lm-radius-md, 10px);
  box-shadow: var(--lm-shadow-popup, 0 18px 48px rgba(26, 23, 20, 0.22));
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  outline: none;
  animation: lm-live-pop-in var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
@keyframes lm-live-pop-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
.lm-live-pop__label {
  margin: 0 2px 8px;
  font-size: 10px;
  font-weight: var(--lm-weight-semibold, 600);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--lm-text-tertiary, #6E6960);
}
.lm-live-pop__chips { display: flex; flex-wrap: wrap; gap: 4px; }
.lm-live-chip {
  appearance: none;
  border: 1px solid var(--lm-border, #DDD7CA);
  background: transparent;
  color: var(--lm-text-secondary, #3A3530);
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 12px;
  font-weight: var(--lm-weight-semibold, 600);
  line-height: 1;
  padding: 5px 10px;
  border-radius: var(--lm-radius-pill, 999px);
  cursor: pointer;
  outline: none;
  transition:
    background var(--lm-duration-fast, 120ms) var(--lm-ease, ease),
    border-color var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
.lm-live-chip:hover { background: var(--lm-accent-light, rgba(184, 91, 51, 0.10)); }
.lm-live-chip:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-live-chip[aria-checked="true"] {
  background: var(--lm-accent, #B85B33);
  border-color: var(--lm-accent, #B85B33);
  color: #fff;
}
.lm-live-pop__custom {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.lm-live-pop__custom input {
  width: 64px;
  padding: 5px 7px;
  font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
  font-size: 12px;
  color: var(--lm-text-primary, #1A1714);
  background: var(--lm-surface, #fff);
  border: 1px solid var(--lm-border, #DDD7CA);
  border-radius: var(--lm-radius-sm, 6px);
  outline: none;
}
.lm-live-pop__custom input:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-live-pop__unit { font-size: 12px; color: var(--lm-text-tertiary, #6E6960); }
.lm-live-pop__apply {
  appearance: none;
  border: 1px solid var(--lm-accent, #B85B33);
  background: var(--lm-accent, #B85B33);
  color: #fff;
  font-size: 12px;
  font-weight: var(--lm-weight-semibold, 600);
  padding: 5px 10px;
  border-radius: var(--lm-radius-sm, 6px);
  cursor: pointer;
  outline: none;
}
.lm-live-pop__apply:focus-visible { box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20)); }
.lm-live-pop__error {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--lm-error, #A8412B);
}
.lm-live-pop__reason {
  margin: 0 2px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--lm-text-tertiary, #6E6960);
}

@media (prefers-reduced-motion: reduce) {
  .lm-live-badge { transition: none !important; }
  .lm-live-badge__dot { animation: none !important; }
  .lm-live-pop { animation: none !important; }
}
  `.trim();
  document.head.appendChild(s);
}

// ── LiveRefreshBadge ─────────────────────────────────────────────────────────

/**
 * A small "live" pill rendered in the artboard label row while live refresh is
 * ON. Renders nothing when `rateMs` is not a positive number. Activating it
 * (click / Enter / Space — it is a real `<button>`) opens the rate picker.
 *
 * @param {object} props
 * @param {number} props.rateMs The effective refresh interval in ms.
 * @param {() => void} props.onActivate Open the rate picker.
 * @returns {React.ReactElement | null}
 */
export function LiveRefreshBadge({ rateMs, onActivate }) {
  if (typeof rateMs !== 'number' || rateMs <= 0) return null;
  const rate = formatRate(rateMs);
  const label = `Auto-refresh — every ${rate}. Click to change.`;
  return (
    <button
      type="button"
      className="lm-live-badge"
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      data-testid="lm-live-badge"
    >
      <span className="lm-live-badge__dot" aria-hidden="true" />
      <span>{rate}</span>
    </button>
  );
}

// ── LiveRefreshPopover ───────────────────────────────────────────────────────

/**
 * Compact rate picker anchored under `anchorEl`. Portaled to `document.body`
 * so no ancestor `overflow` can clip it. Dismisses on outside-click or Escape.
 *
 * Selecting a chip calls `onSelect(ms | null)` — a preset's ms, `null` for Off,
 * or the parsed custom value. The call site performs the config write and then
 * closes the popover.
 *
 * @param {object} props
 * @param {Element | null} props.anchorEl Element to anchor under (the kebab cluster / badge).
 * @param {number | null | undefined} props.valueMs Current effective rate (ms), or nullish for off.
 * @param {boolean} [props.disabled] When true, show a reason instead of the chips (non-CLI mode).
 * @param {string} [props.disabledReason]
 * @param {(ms: number | null) => void} props.onSelect
 * @param {() => void} props.onClose
 * @returns {React.ReactElement | null}
 */
export function LiveRefreshPopover({
  anchorEl,
  valueMs,
  disabled = false,
  disabledReason,
  onSelect,
  onClose,
}) {
  const popRef = React.useRef(null);
  const [coords, setCoords] = React.useState(null);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customText, setCustomText] = React.useState('');
  const [error, setError] = React.useState(null);

  // Measure the anchor and position the popover (fixed, right-aligned under it).
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

  // Move focus into the dialog once it is positioned (keyboard + a11y).
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

  const activeMs = typeof valueMs === 'number' && valueMs > 0 ? valueMs : null;
  const isPreset = activeMs != null && RATE_PRESETS.some((p) => p.ms === activeMs);
  const customActive = activeMs != null && !isPreset;

  const commitCustom = () => {
    const seconds = Number.parseFloat(customText);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setError('Enter a number of seconds.');
      return;
    }
    const ms = Math.round(seconds * 1000);
    if (ms < MIN_INTERVAL_MS) {
      setError(`Minimum is ${MIN_INTERVAL_SECONDS}s.`);
      return;
    }
    onSelect(ms);
  };

  if (!coords) return null;

  const content = (
    <div
      ref={popRef}
      className="lm-live-pop"
      role="dialog"
      aria-label="Auto-refresh rate"
      tabIndex={-1}
      style={coords}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="lm-live-pop"
    >
      <div className="lm-live-pop__label">Auto-refresh</div>
      {disabled ? (
        <div className="lm-live-pop__reason">
          {disabledReason || 'Auto-refresh editing needs `@lerret/cli dev`.'}
        </div>
      ) : (
        <>
          <div className="lm-live-pop__chips" role="radiogroup" aria-label="Refresh rate">
            <button
              type="button"
              role="radio"
              aria-checked={activeMs == null}
              className="lm-live-chip"
              data-testid="lm-live-chip-off"
              onClick={() => {
                setError(null);
                onSelect(null);
              }}
            >
              Off
            </button>
            {RATE_PRESETS.map((p) => (
              <button
                key={p.ms}
                type="button"
                role="radio"
                aria-checked={activeMs === p.ms}
                className="lm-live-chip"
                data-testid={`lm-live-chip-${p.ms}`}
                onClick={() => {
                  setError(null);
                  onSelect(p.ms);
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={customActive}
              className="lm-live-chip"
              data-testid="lm-live-chip-custom"
              onClick={() => {
                setError(null);
                setCustomText(customActive ? String(activeMs / 1000) : '');
                setCustomOpen(true);
              }}
            >
              {customActive ? formatRate(activeMs) : 'Custom…'}
            </button>
          </div>
          {customOpen && (
            <div className="lm-live-pop__custom">
              <input
                type="number"
                min={MIN_INTERVAL_SECONDS}
                step="0.1"
                inputMode="decimal"
                value={customText}
                placeholder="1"
                aria-label="Custom interval in seconds"
                data-testid="lm-live-custom-input"
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCustom();
                  }
                }}
                /* eslint-disable-next-line jsx-a11y/no-autofocus */
                autoFocus
              />
              <span className="lm-live-pop__unit">seconds</span>
              <button
                type="button"
                className="lm-live-pop__apply"
                data-testid="lm-live-custom-apply"
                onClick={commitCustom}
              >
                Set
              </button>
            </div>
          )}
          {error && (
            <div className="lm-live-pop__error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}
