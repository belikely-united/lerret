// move-picker.jsx — destination picker for the "Move to…" kebab item.
//
// ── Why this exists ────────────────────────────────────────────────────────
// The kebab's "Move to…" item needs a destination chooser. The picker lives
// at `<body>` (portaled) so it escapes the canvas's `transform` zoom/pan
// container — same trick as `animated-export-dialog.jsx`. Inside it lists every
// folder reachable from the cascade map; the current parent of the source,
// the source itself (if it's a folder), and any descendant of the source are
// rendered disabled with a reason. The user picks one, optionally toggles
// "Carry liveRefresh setting", and clicks Confirm. The caller handles the
// actual `moveProjectFile` call.
//
// ── Shape ─────────────────────────────────────────────────────────────────
// Props (see JSDoc on `MovePicker` below). The picker is intentionally
// presentational: it does NOT fetch or call the move endpoint. The parent
// passes a precomputed `destinations` array (or a `cascadeEntries` array we
// turn into one) and an `onConfirm` callback.
//
// ── Cycle prevention ──────────────────────────────────────────────────────
// The backend refuses cycle moves (folder → its own descendant) with 400. The
// picker ALSO disables those entries up-front so the user can't even attempt
// the invalid move. Cycle detection here is a string-prefix check on the
// LerretPath ("path === source || path.startsWith(source + '/')") — same shape
// the backend uses.

import React from 'react';
import * as ReactDOM from 'react-dom';

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
 minWidth: 380,
 maxWidth: 520,
 maxHeight: '80vh',
 boxShadow: '0 24px 64px rgba(15,23,42,0.28)',
 display: 'flex',
 flexDirection: 'column',
 gap: 14,
};

const headerRowStyle = {
 display: 'flex',
 justifyContent: 'space-between',
 alignItems: 'baseline',
};

const titleStyle = {
 margin: 0,
 fontSize: 16,
 fontWeight: 600,
};

const subtitleStyle = {
 fontSize: 11,
 color: 'var(--lm-text-secondary, #6E6960)',
 marginTop: 2,
};

const listStyle = {
 listStyle: 'none',
 padding: 0,
 margin: 0,
 overflowY: 'auto',
 maxHeight: '52vh',
 border: '1px solid var(--lm-border, rgba(26,23,20,0.10))',
 borderRadius: 8,
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
 background: 'transparent',
 color: 'inherit',
 border: '1px solid var(--lm-border, rgba(26,23,20,0.18))',
 borderRadius: 8,
 padding: '8px 16px',
 fontSize: 13,
 fontWeight: 500,
 cursor: 'pointer',
};

const checkboxRowStyle = {
 display: 'flex',
 alignItems: 'center',
 gap: 8,
 fontSize: 12,
 color: 'var(--lm-text-primary, #1A1714)',
 cursor: 'pointer',
 padding: '4px 0',
};

const errorRowStyle = {
 fontSize: 12,
 color: '#B85B33',
 lineHeight: 1.4,
};

/**
 * @typedef {Object} DestinationCandidate
 * @property {string} path     The destination folder's LerretPath.
 * @property {string} label    Human-readable name to show in the list.
 *  Typically the folder's basename, or its full path for disambiguation.
 * @property {boolean} [disabled]
 *   Pre-computed disabled flag from the caller (e.g. for "destination is
 *   read-only" cases). The picker also applies its own disabling logic
 *   (current parent, source-self, descendants of source).
 * @property {string} [reason] Disabled-with-reason tooltip text.
 */

/**
 * Compute the list of destinations from a serialized cascade entries array.
 * Returns one candidate per folder path. The caller can pass the result
 * straight to `MovePicker` as `destinations`.
 *
 * Use this when you already have the cascade entries in hand (e.g. from
 * `useCascadedConfig`'s map — note: `useCascadedConfig` returns a function,
 * not the entries; the canvas wiring passes entries directly from the
 * provider's source).
 *
 * @param {Array<[string, unknown]>} cascadeEntries
 * @returns {Array<DestinationCandidate>}
 */
export function destinationsFromCascadeEntries(cascadeEntries) {
 if (!Array.isArray(cascadeEntries)) return [];
 return cascadeEntries.map(([path]) => ({
 path,
 label: deriveLabel(path),
 }));
}

function deriveLabel(path) {
 if (typeof path !== 'string' || path.length === 0) return '(root)';
 const trimmed = path.replace(/\/+$/, '');
 const slash = trimmed.lastIndexOf('/');
 const tail = slash === -1 ? trimmed : trimmed.slice(slash + 1);
 return tail || trimmed || '(root)';
}

/**
 * Predicate: is `candidate` a descendant of (or equal to) `sourcePath`?
 * Matches the backend's cycle-prevention check.
 *
 * @param {string} candidate
 * @param {string} sourcePath
 * @returns {boolean}
 */
function isInsideSource(candidate, sourcePath) {
 if (!candidate || !sourcePath) return false;
 if (candidate === sourcePath) return true;
 return candidate.startsWith(sourcePath + '/');
}

/**
 * The "Move to…" destination picker overlay.
 *
 * @param {Object} props
 * @param {() => void} props.onClose
 *   Called when the picker should close — Esc, click outside, Cancel, or
 *   after a successful Confirm. The parent is expected to unmount the
 *   picker (controlled-style).
 * @param {(args: { toFolderPath: string, carryLiveRefresh: boolean }) => Promise<void>} props.onConfirm
 *   Invoked when the user picks a destination and clicks Confirm. The picker
 *   awaits this so it can show inline pending / error state.
 * @param {string} props.sourcePath
 *   The asset or folder being moved. Used for the title + for disabling the
 *   source-self / its descendants in the list.
 * @param {string} props.currentParentPath
 *   The source's current parent folder. Disabled in the list (you can't
 *   "move" into where you already are).
 * @param {Array<DestinationCandidate>} [props.destinations]
 *   The candidate destinations. If omitted, `cascadeEntries` is used. If
 *   BOTH are provided, `destinations` wins.
 * @param {Array<[string, unknown]>} [props.cascadeEntries]
 *   Serialized cascade entries — when provided, the picker derives
 *   destinations from them via {@link destinationsFromCascadeEntries}.
 * @param {string} [props.liveRefreshKey]
 *   The asset's basename (without extension) when the source folder has a
 *   `liveRefresh` entry for it. Controls whether to render the carry-over
 *   checkbox. When omitted (no liveRefresh on this asset), the checkbox is
 *   not rendered at all.
 * @returns {React.ReactElement | null}
 */
export function MovePicker({
 onClose,
 onConfirm,
 sourcePath,
 currentParentPath,
 destinations: destinationsProp,
 cascadeEntries,
 liveRefreshKey,
}) {
 const destinations = React.useMemo(() => {
 if (Array.isArray(destinationsProp)) return destinationsProp;
 if (Array.isArray(cascadeEntries)) return destinationsFromCascadeEntries(cascadeEntries);
 return [];
 }, [destinationsProp, cascadeEntries]);

 // The list with the picker's own disabling overlaid on top of the caller's
 // hints. Sorted by path for predictable order.
 const decorated = React.useMemo(() => {
 const out = destinations.map((d) => {
 let disabled = !!d.disabled;
 let reason = d.reason;
 if (!disabled && d.path === currentParentPath) {
 disabled = true;
 reason = 'already in this folder';
 } else if (!disabled && isInsideSource(d.path, sourcePath)) {
 disabled = true;
 reason = d.path === sourcePath
 ? 'cannot move into itself'
 : 'cannot move into a descendant of itself';
 }
 return { ...d, disabled, reason };
 });
 out.sort((a, b) => a.path.localeCompare(b.path));
 return out;
 }, [destinations, currentParentPath, sourcePath]);

 const [selectedPath, setSelectedPath] = React.useState(null);
 const [carryLiveRefresh, setCarryLiveRefresh] = React.useState(false);
 const [pending, setPending] = React.useState(false);
 const [errorMsg, setErrorMsg] = React.useState(null);
 const dialogRef = React.useRef(null);

 // Suspend the studio's liveRefresh reload timer while the picker is open, so
 // a background artboard reload (e.g. moving a live asset) doesn't reconcile
 // the dialog subtree and dismiss its controls mid-interaction. Released on
 // unmount. See live-refresh-suspend.js.
 React.useEffect(() => suspendLiveRefresh(), []);

 // Esc closes; focus the dialog when it mounts for screen-reader announcement.
 React.useEffect(() => {
 const onKey = (e) => {
 if (e.key === 'Escape' && !pending) onClose();
 };
 document.addEventListener('keydown', onKey);
 dialogRef.current?.focus();
 return () => document.removeEventListener('keydown', onKey);
 }, [onClose, pending]);

 const onConfirmClick = React.useCallback(async () => {
 if (!selectedPath || pending) return;
 setErrorMsg(null);
 setPending(true);
 try {
 await onConfirm({ toFolderPath: selectedPath, carryLiveRefresh });
 // Caller is expected to unmount us; if they don't, close ourselves.
 onClose();
 } catch (err) {
 setErrorMsg(err && err.message ? err.message : String(err));
 } finally {
 setPending(false);
 }
 }, [selectedPath, pending, onConfirm, carryLiveRefresh, onClose]);

 if (typeof document === 'undefined') return null;

 const sourceLabel = deriveLabel(sourcePath);

 return ReactDOM.createPortal(
 <div
 style={overlayStyle}
 onClick={(e) => {
 if (e.target === e.currentTarget && !pending) onClose();
 }}
 >
 <div
 ref={dialogRef}
 role="dialog"
 aria-modal="true"
 aria-label={`Move ${sourceLabel} to another folder`}
 tabIndex={-1}
 style={sheetStyle}
 data-testid="lm-move-picker"
 onClick={(e) => e.stopPropagation()}
 >
 <div style={headerRowStyle}>
 <div>
 <h2 style={titleStyle}>Move {sourceLabel} to…</h2>
 <div style={subtitleStyle}>{sourcePath}</div>
 </div>
 </div>

 {decorated.length === 0 ? (
 <div
 style={{
 fontSize: 13,
 color: 'var(--lm-text-secondary, #6E6960)',
 padding: 16,
 textAlign: 'center',
 border: '1px solid var(--lm-border, rgba(26,23,20,0.10))',
 borderRadius: 8,
 }}
 >
 No destination folders available.
 </div>
 ) : (
 <ul style={listStyle} data-testid="lm-move-picker-list">
 {decorated.map((d) => {
 const isSelected = d.path === selectedPath;
 return (
 <li key={d.path}>
 <button
 type="button"
 onClick={() => {
 if (!d.disabled) setSelectedPath(d.path);
 }}
 disabled={d.disabled}
 aria-disabled={d.disabled || undefined}
 aria-current={isSelected ? 'true' : undefined}
 title={d.reason || undefined}
 data-testid={`lm-move-picker-row-${d.path}`}
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-start',
 width: '100%',
 padding: '8px 12px',
 background: isSelected ? 'rgba(184,91,51,0.10)' : 'transparent',
 border: 'none',
 borderBottom: '1px solid rgba(26,23,20,0.06)',
 textAlign: 'left',
 color: d.disabled
 ? 'var(--lm-text-tertiary, #9C968A)'
 : 'var(--lm-text-primary, #1A1714)',
 cursor: d.disabled ? 'not-allowed' : 'pointer',
 fontFamily: 'inherit',
 fontSize: 13,
 }}
 >
 <span style={{ fontWeight: isSelected ? 600 : 500 }}>{d.label}</span>
 <span
 style={{
 fontSize: 11,
 color: 'var(--lm-text-secondary, #6E6960)',
 marginTop: 2,
 }}
 >
 {d.path}
 {d.disabled && d.reason ? ` · ${d.reason}` : ''}
 </span>
 </button>
 </li>
 );
 })}
 </ul>
 )}

 {typeof liveRefreshKey === 'string' && liveRefreshKey.length > 0 && (
 <label style={checkboxRowStyle}>
 <input
 type="checkbox"
 checked={carryLiveRefresh}
 onChange={(e) => setCarryLiveRefresh(e.target.checked)}
 data-testid="lm-move-picker-carry-checkbox"
 />
 <span>
 Carry liveRefresh setting for <code>{liveRefreshKey}</code> to the destination
 folder
 </span>
 </label>
 )}

 {errorMsg && <div style={errorRowStyle}>{errorMsg}</div>}

 <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
 <button
 type="button"
 style={buttonSecondary}
 onClick={onClose}
 disabled={pending}
 data-testid="lm-move-picker-cancel"
 >
 Cancel
 </button>
 <button
 type="button"
 style={{
 ...buttonPrimary,
 opacity: !selectedPath || pending ? 0.6 : 1,
 cursor: !selectedPath || pending ? 'not-allowed' : 'pointer',
 }}
 onClick={onConfirmClick}
 disabled={!selectedPath || pending}
 data-testid="lm-move-picker-confirm"
 >
 {pending ? 'Moving…' : 'Move here'}
 </button>
 </div>
 </div>
 </div>,
 document.body,
 );
}

export default MovePicker;
