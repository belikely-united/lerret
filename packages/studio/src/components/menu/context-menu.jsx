// context-menu.jsx — point-anchored right-click context menu.
//
// The `Menu` primitive is trigger-driven: it owns a trigger element and anchors
// its popover to that element's rect. A right-click menu has no trigger — it
// appears at the CURSOR — so this is its sibling: a portaled `role="menu"`
// popover positioned at a point, reusing the same `MenuItem` / `MenuSeparator`
// rows and `menu.css` styling so a context menu is visually + behaviourally
// identical to the one the `⋯` kebab opens (same items, same keyboard model,
// same inline "Confirm delete" via `keepOpen`).
//
// ── Why a separate component (not a mode on `Menu`) ──────────────────────────
// `Menu` is used by every kebab on the canvas; bolting a point-anchor branch +
// edge-clamping onto it would add risk to that hot path. This file is small,
// self-contained, and owns the two things `Menu` doesn't need: cursor anchoring
// and viewport edge-clamping (so the menu never spills off-screen).
//
// ── Item shape ───────────────────────────────────────────────────────────────
// Identical to `Menu`'s items: `{ kind?: 'item', id, label, onSelect, icon?,
// disabled?, reason?, keepOpen? }` or `{ kind: 'separator', id? }`. Call sites
// reuse the exact `items` array they already build for the kebab.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { MenuItem, MenuSeparator } from './Menu.jsx';
import './menu.css';

// ── Keyboard helpers (mirror Menu.jsx's, kept local so this file stands alone) ─

/** Sorted indices of items that can receive focus (skip separators + disabled). */
function enabledIndices(items) {
 const out = [];
 items.forEach((item, idx) => {
 if (item.kind !== 'separator' && !item.disabled) out.push(idx);
 });
 return out;
}

/** Move within `enabled` by `delta` (±1), wrapping; jump to first/last if none. */
function nextEnabled(enabled, currentFlatIdx, delta) {
 if (enabled.length === 0) return -1;
 const pos = enabled.indexOf(currentFlatIdx);
 if (pos === -1) return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
 return enabled[(pos + delta + enabled.length) % enabled.length];
}

/** Keep the menu this far from any viewport edge when clamping. */
const EDGE_MARGIN = 8;

/**
 * A right-click context menu anchored at a viewport point.
 *
 * @param {object} props
 * @param {{ x: number, y: number }} props.point Cursor position (clientX/Y).
 * @param {Array<object>} props.items Menu items — same shape as {@link Menu}.
 * @param {() => void} props.onClose Called on select (non-keepOpen), Esc,
 *   outside-pointerdown, scroll, or resize.
 * @returns {React.ReactElement | null}
 */
export function ContextMenu({ point, items = [], onClose }) {
 const menuRef = React.useRef(null);
 const [activeIdx, setActiveIdx] = React.useState(-1);
 // Start at the cursor; clamp to the viewport after measuring (pre-paint, so
 // there is no visible jump). `ready` hides the menu for that single frame.
 const [pos, setPos] = React.useState({ left: point.x, top: point.y, ready: false });
 const idPrefix = React.useId().replace(/:/g, '');

 // Clamp so the menu never spills off-screen. Runs before paint.
 React.useLayoutEffect(() => {
 const node = menuRef.current;
 if (!node) return;
 const r = node.getBoundingClientRect();
 const vw = window.innerWidth;
 const vh = window.innerHeight;
 let left = point.x;
 let top = point.y;
 if (left + r.width > vw - EDGE_MARGIN) left = Math.max(EDGE_MARGIN, vw - r.width - EDGE_MARGIN);
 if (top + r.height > vh - EDGE_MARGIN) top = Math.max(EDGE_MARGIN, vh - r.height - EDGE_MARGIN);
 setPos({ left, top, ready: true });
 }, [point.x, point.y, items.length]);

 // Move DOM focus into the popover so keyboard nav works immediately.
 React.useEffect(() => {
 if (menuRef.current) menuRef.current.focus();
 }, []);

 // Dismiss on outside-pointerdown / scroll (not our own scroll) / resize.
 React.useEffect(() => {
 const onPointerDown = (e) => {
 if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
 };
 const onScroll = (e) => {
 // A scroll INSIDE the menu (a tall list) must not dismiss it.
 if (menuRef.current && menuRef.current.contains(e.target)) return;
 onClose();
 };
 document.addEventListener('pointerdown', onPointerDown, true);
 window.addEventListener('scroll', onScroll, true);
 window.addEventListener('resize', onClose);
 return () => {
 document.removeEventListener('pointerdown', onPointerDown, true);
 window.removeEventListener('scroll', onScroll, true);
 window.removeEventListener('resize', onClose);
 };
 }, [onClose]);

 const enabled = React.useMemo(() => enabledIndices(items), [items]);

 const selectItem = React.useCallback((item) => {
 if (!item || item.disabled) return;
 item.onSelect && item.onSelect();
 // `keepOpen` items (Delete… → inline Confirm/Cancel) leave the menu open so
 // the follow-up row renders in place — exactly like the kebab.
 if (!item.keepOpen) onClose();
 }, [onClose]);

 // Keyboard handler bound natively to the portaled node (React event
 // delegation operates on the React root, which the portal escapes).
 React.useEffect(() => {
 const node = menuRef.current;
 if (!node) return undefined;
 const onKeyDown = (e) => {
 switch (e.key) {
 case 'ArrowDown': e.preventDefault(); setActiveIdx((c) => nextEnabled(enabled, c, 1)); break;
 case 'ArrowUp': e.preventDefault(); setActiveIdx((c) => nextEnabled(enabled, c, -1)); break;
 case 'Home': e.preventDefault(); setActiveIdx(enabled[0] ?? -1); break;
 case 'End': e.preventDefault(); setActiveIdx(enabled[enabled.length - 1] ?? -1); break;
 case 'Enter':
 case ' ':
 e.preventDefault();
 if (activeIdx >= 0) selectItem(items[activeIdx]);
 break;
 case 'Escape': e.preventDefault(); onClose(); break;
 case 'Tab': onClose(); break;
 default: break;
 }
 };
 node.addEventListener('keydown', onKeyDown);
 return () => node.removeEventListener('keydown', onKeyDown);
 }, [enabled, activeIdx, items, selectItem, onClose]);

 // Scroll the active item into view as the highlight moves.
 React.useEffect(() => {
 if (!menuRef.current || activeIdx < 0) return;
 const node = menuRef.current.querySelector('[data-active="true"]');
 if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
 }, [activeIdx]);

 const optionId = (idx) => `${idPrefix}-ctx-item-${idx}`;

 return ReactDOM.createPortal(
 <ul
 ref={menuRef}
 role="menu"
 tabIndex={-1}
 className="lm-menu-popover"
 data-testid="lm-context-menu"
 aria-activedescendant={activeIdx >= 0 ? optionId(activeIdx) : undefined}
 style={{
 position: 'fixed',
 top: pos.top,
 left: pos.left,
 visibility: pos.ready ? 'visible' : 'hidden',
 }}
 >
 {items.map((item, idx) => {
 if (item.kind === 'separator') return <MenuSeparator key={item.id ?? `sep-${idx}`} />;
 return (
 <MenuItem
 key={item.id}
 id={item.id}
 label={item.label}
 disabled={!!item.disabled}
 reason={item.reason}
 icon={item.icon}
 active={idx === activeIdx}
 onSelect={() => selectItem(item)}
 onMouseEnter={setActiveIdx}
 itemIndex={idx}
 itemId={optionId(idx)}
 />
 );
 })}
 </ul>,
 document.body,
 );
}

/**
 * Hook that manages a context menu's open state + cursor anchor. Returns an
 * `openAt(event)` to wire to a target's `onContextMenu` — it suppresses the
 * native menu, stops propagation (so the INNERMOST target wins when artboards
 * nest inside groups inside pages), and records the cursor point.
 *
 * @returns {{ open: boolean, point: { x: number, y: number }, openAt: (e: MouseEvent) => void, close: () => void }}
 */
export function useContextMenu() {
 const [state, setState] = React.useState({ open: false, x: 0, y: 0 });
 const openAt = React.useCallback((e) => {
 if (e && typeof e.preventDefault === 'function') e.preventDefault();
 if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
 setState({ open: true, x: e?.clientX ?? 0, y: e?.clientY ?? 0 });
 }, []);
 const close = React.useCallback(() => setState((s) => ({ ...s, open: false })), []);
 return { open: state.open, point: { x: state.x, y: state.y }, openAt, close };
}

export default ContextMenu;
