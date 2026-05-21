// Menu.jsx — reusable popover action list
//
// Generalizes the `StudioBrandMenu` pattern into a fully accessible, keyboard-
// operable primitive that any entity kebab menu (+) or future popover
// can compose from.
//
// Spec: UX-DR4, UX-DR16, UX-DR18, NFR14
//
// API
// ───
// <Menu
// trigger={<button>…</button>}
// A single React element — cloned and augmented with the ARIA button
// attributes (aria-haspopup, aria-expanded) and an onClick that toggles
// the menu. The original element's onClick, if any, is composed.
// Alternatively, supply `renderTrigger` for a render-prop style.
//
// renderTrigger={({ open, getTriggerProps }) => <button {...getTriggerProps()}>…</button>}
// Render-prop alternative to `trigger`. Receives the current `open` state
// and a `getTriggerProps()` factory that returns the props to spread onto
// the trigger element. `trigger` takes precedence if both are supplied.
//
// items={[
// { kind: 'item', id, label, onSelect, icon? }
// A clickable action row. `onSelect()` is called on click or Enter.
//
// { kind: 'item', id, label, disabled: true, reason: 'why' }
// Visibly disabled, skipped by arrow-key navigation, not activatable.
// Surfaces `reason` on hover/focus as an accessible tooltip via the
// `title` attribute.
//
// { kind: 'separator' }
// A visual divider between groups of items. Not focusable.
// ]}
//
// align="bottom-start" | "bottom-end" | "top-start" | "top-end"
// Where the popover anchors relative to the trigger.
// Default: "bottom-start".
//
// open? — controlled open state. When omitted the component manages it.
// onOpen? — called when the menu opens (controlled or uncontrolled).
// onClose? — called when the menu closes (controlled or uncontrolled).
// />
//
// Keyboard
// ────────
// ArrowDown / ArrowUp — move focus between enabled items (skip disabled)
// Enter — activate the currently focused enabled item
// Escape — close the menu, return focus to the trigger
// Tab — close (without refocusing the trigger) and let
// focus move naturally
//
// Accessibility
// ─────────────
// • role="menu" on the popover
// • role="menuitem" on each item (future: role="menuitemcheckbox" if needed)
// • aria-disabled="true" on disabled items
// • aria-expanded on the trigger
// • aria-haspopup="menu" on the trigger
// • The popover is portaled to document.body so `overflow` on any ancestor
// cannot clip it.
//
// prefers-reduced-motion
// ──────────────────────
// The open animation is a CSS keyframe. The CSS sheet sets
// `animation: none` inside `@media (prefers-reduced-motion: reduce)`, so
// the menu pops in instantly without any JS branch.

import React from 'react';
import * as ReactDOM from 'react-dom';
import './menu.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns the sorted list of indices for items that can receive focus. */
function enabledIndices(items) {
 const out = [];
 items.forEach((item, idx) => {
 if (item.kind !== 'separator' && !item.disabled) out.push(idx);
 });
 return out;
}

/** Move within `enabled` indices by `delta` (±1), wrapping around. */
function nextEnabled(enabled, currentFlatIdx, delta) {
 if (enabled.length === 0) return -1;
 const pos = enabled.indexOf(currentFlatIdx);
 if (pos === -1) {
 // Nothing focused yet → jump to first (down) or last (up).
 return delta > 0 ? enabled[0] : enabled[enabled.length - 1];
 }
 const next = (pos + delta + enabled.length) % enabled.length;
 return enabled[next];
}

// ─── MenuItem ───────────────────────────────────────────────────────────────

/**
 * A single row in the menu popover.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.reason] — shown on hover/focus when disabled
 * @param {React.ReactNode}[props.icon]
 * @param {boolean} props.active — keyboard highlight
 * @param {() => void} [props.onSelect]
 * @param {(idx: number) => void} props.onMouseEnter
 * @param {number} props.itemIndex — flat array index (for hover update)
 * @param {string} props.itemId — for aria-activedescendant
 */
export function MenuItem({
 id,
 label,
 disabled = false,
 reason,
 icon,
 active,
 onSelect,
 onMouseEnter,
 itemIndex,
 itemId,
}) {
 const handleClick = () => {
 if (!disabled && onSelect) onSelect();
 };

 return (
 <li
 id={itemId}
 role="menuitem"
 aria-disabled={disabled ? 'true' : undefined}
 data-active={active ? 'true' : 'false'}
 className="lm-menu-item"
 // title doubles as an accessible tooltip for the disabled reason. Screen
 // readers also read it when the item is focused.
 title={disabled && reason ? reason : undefined}
 tabIndex={-1}
 onClick={handleClick}
 onMouseEnter={() => !disabled && onMouseEnter && onMouseEnter(itemIndex)}
 >
 {icon && <span className="lm-menu-item-icon" aria-hidden="true">{icon}</span>}
 <span className="lm-menu-item-label">{label}</span>
 {disabled && reason && (
 <span className="lm-menu-item-reason" aria-hidden="true">{reason}</span>
 )}
 </li>
 );
}

// ─── MenuSeparator ──────────────────────────────────────────────────────────

/**
 * A visual divider between item groups.
 * Uses `role="separator"` per the ARIA menu pattern.
 */
export function MenuSeparator() {
 return <li role="separator" className="lm-menu-separator" />;
}

// ─── Popover ────────────────────────────────────────────────────────────────

/**
 * The portaled popover that renders the item list.
 * Positioned using viewport-space coordinates anchored to the trigger rect.
 *
 * @internal — composed inside `Menu`.
 */
function MenuPopover({
 items,
 coords,
 align,
 menuRef,
 activeIdx,
 onItemSelect,
 onMouseEnterItem,
 idPrefix,
}) {
 // Build the position style from the trigger rect + alignment.
 const posStyle = React.useMemo(() => {
 if (!coords) return { top: 0, left: 0 };
 const { top, bottom, left, right } = coords;

 switch (align) {
 case 'top-start':
 return { bottom: window.innerHeight - top + 8, left };
 case 'top-end':
 return { bottom: window.innerHeight - top + 8, right: window.innerWidth - right };
 case 'bottom-end':
 return { top: bottom + 8, right: window.innerWidth - right };
 case 'bottom-start':
 default:
 return { top: bottom + 8, left };
 }
 }, [coords, align]);

 const optionId = (idx) => `${idPrefix}-item-${idx}`;
 const activeId = activeIdx >= 0 ? optionId(activeIdx) : undefined;

 return ReactDOM.createPortal(
 <ul
 ref={menuRef}
 role="menu"
 tabIndex={-1}
 className="lm-menu-popover"
 aria-activedescendant={activeId}
 style={{ ...posStyle, position: 'fixed' }}
 >
 {items.map((item, idx) => {
 if (item.kind === 'separator') {
 return <MenuSeparator key={item.id ?? `sep-${idx}`} />;
 }
 return (
 <MenuItem
 key={item.id}
 id={item.id}
 label={item.label}
 disabled={!!item.disabled}
 reason={item.reason}
 icon={item.icon}
 active={idx === activeIdx}
 onSelect={() => onItemSelect(item)}
 onMouseEnter={onMouseEnterItem}
 itemIndex={idx}
 itemId={optionId(idx)}
 />
 );
 })}
 </ul>,
 document.body,
 );
}

// ─── Menu ───────────────────────────────────────────────────────────────────

/**
 * Reusable popover action list.
 *
 * @param {object} props
 * @param {React.ReactElement} [props.trigger]
 * A single React element to use as the toggle trigger. The component clones
 * it and merges in the ARIA props (aria-haspopup, aria-expanded, onClick).
 * If the element already has an `onClick`, both are called. Supply either
 * `trigger` or `renderTrigger` — `trigger` takes precedence.
 *
 * @param {(args: { open: boolean, getTriggerProps: () => object }) => React.ReactElement} [props.renderTrigger]
 * Render-prop alternative. Receives `open` and `getTriggerProps()`.
 *
 * @param {Array<
 * | { kind?: 'item', id: string, label: string, onSelect?: () => void, icon?: React.ReactNode, disabled?: boolean, reason?: string }
 * | { kind: 'separator', id?: string }
 * >} props.items
 *
 * @param {'bottom-start'|'bottom-end'|'top-start'|'top-end'} [props.align='bottom-start']
 *
 * @param {boolean} [props.open] — controlled open state
 * @param {() => void} [props.onOpen]
 * @param {() => void} [props.onClose]
 */
export function Menu({
 trigger,
 renderTrigger,
 items = [],
 align = 'bottom-start',
 open: controlledOpen,
 onOpen,
 onClose,
}) {
 const isControlled = controlledOpen !== undefined;
 const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
 const open = isControlled ? controlledOpen : uncontrolledOpen;

 // Keyboard highlight — index into `items` (flat). -1 = nothing highlighted.
 const [activeIdx, setActiveIdx] = React.useState(-1);

 // Viewport rect of the trigger — used to position the portaled popover.
 const [coords, setCoords] = React.useState(null);

 const triggerRef = React.useRef(null);
 const menuRef = React.useRef(null);

 // Unique prefix for ARIA IDs so multiple Menus on the same page coexist.
 const idPrefix = React.useId().replace(/:/g, '');

 // ── open / close helpers ────────────────────────────────────────────────

 const measureTrigger = React.useCallback(() => {
 if (!triggerRef.current) return null;
 const r = triggerRef.current.getBoundingClientRect();
 return {
 top: r.top,
 bottom: r.bottom,
 left: r.left,
 right: r.right,
 width: r.width,
 height: r.height,
 };
 }, []);

 const openMenu = React.useCallback(() => {
 const rect = measureTrigger();
 setCoords(rect);
 // Start with nothing highlighted; first ArrowDown will move to first item.
 setActiveIdx(-1);
 if (!isControlled) setUncontrolledOpen(true);
 onOpen && onOpen();
 }, [isControlled, measureTrigger, onOpen]);

 const closeMenu = React.useCallback((refocus = true) => {
 if (!isControlled) setUncontrolledOpen(false);
 onClose && onClose();
 setActiveIdx(-1);
 // Return focus to the trigger so keyboard context is never lost (NFR14).
 if (refocus && triggerRef.current) triggerRef.current.focus();
 }, [isControlled, onClose]);

 const toggle = React.useCallback(() => {
 if (open) closeMenu();
 else openMenu();
 }, [open, openMenu, closeMenu]);

 // ── focus management ────────────────────────────────────────────────────

 // Move DOM focus into the popover as soon as it opens.
 React.useEffect(() => {
 if (open && menuRef.current) menuRef.current.focus();
 }, [open]);

 // Scroll the active item into view when the highlight moves.
 React.useEffect(() => {
 if (!open || !menuRef.current || activeIdx < 0) return;
 const node = menuRef.current.querySelector('[data-active="true"]');
 if (node && typeof node.scrollIntoView === 'function') {
 node.scrollIntoView({ block: 'nearest' });
 }
 }, [open, activeIdx]);

 // ── outside-click dismiss ───────────────────────────────────────────────

 React.useEffect(() => {
 if (!open) return undefined;
 const onPointerDown = (e) => {
 const inTrigger = triggerRef.current && triggerRef.current.contains(e.target);
 const inMenu = menuRef.current && menuRef.current.contains(e.target);
 if (!inTrigger && !inMenu) closeMenu(false);
 };
 document.addEventListener('pointerdown', onPointerDown);
 return () => document.removeEventListener('pointerdown', onPointerDown);
 }, [open, closeMenu]);

 // ── re-anchor on resize / scroll ────────────────────────────────────────

 React.useEffect(() => {
 if (!open) return undefined;
 const update = () => setCoords(measureTrigger());
 window.addEventListener('resize', update);
 window.addEventListener('scroll', update, true);
 return () => {
 window.removeEventListener('resize', update);
 window.removeEventListener('scroll', update, true);
 };
 }, [open, measureTrigger]);

 // ── keyboard: trigger ────────────────────────────────────────────────────

 const onTriggerKeyDown = React.useCallback((e) => {
 if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
 e.preventDefault();
 if (!open) openMenu();
 }
 }, [open, openMenu]);

 // ── keyboard: popover ────────────────────────────────────────────────────

 const enabled = React.useMemo(() => enabledIndices(items), [items]);

 const onMenuKeyDown = React.useCallback((e) => {
 switch (e.key) {
 case 'ArrowDown':
 e.preventDefault();
 setActiveIdx((cur) => nextEnabled(enabled, cur, 1));
 break;
 case 'ArrowUp':
 e.preventDefault();
 setActiveIdx((cur) => nextEnabled(enabled, cur, -1));
 break;
 case 'Home':
 e.preventDefault();
 setActiveIdx(enabled[0] ?? -1);
 break;
 case 'End':
 e.preventDefault();
 setActiveIdx(enabled[enabled.length - 1] ?? -1);
 break;
 case 'Enter':
 case ' ': {
 e.preventDefault();
 if (activeIdx < 0) break;
 const item = items[activeIdx];
 if (item && item.kind !== 'separator' && !item.disabled) {
 item.onSelect && item.onSelect();
 closeMenu();
 }
 break;
 }
 case 'Escape':
 e.preventDefault();
 closeMenu();
 break;
 case 'Tab':
 // Tab naturally moves focus away — close but don't steal focus back.
 closeMenu(false);
 break;
 default:
 break;
 }
 }, [enabled, activeIdx, items, closeMenu]);

 // Attach the keyboard handler natively to the portaled menu node so React
 // event delegation (which operates on the React root) can still reach it.
 // This mirrors the `page-picker.jsx` pattern.
 React.useEffect(() => {
 if (!open) return undefined;
 const node = menuRef.current;
 if (!node) return undefined;
 node.addEventListener('keydown', onMenuKeyDown);
 return () => node.removeEventListener('keydown', onMenuKeyDown);
 }, [open, onMenuKeyDown]);

 // ── item selection ───────────────────────────────────────────────────────

 const handleItemSelect = React.useCallback((item) => {
 if (item.disabled) return;
 item.onSelect && item.onSelect();
 closeMenu();
 }, [closeMenu]);

 const handleMouseEnterItem = React.useCallback((idx) => {
 setActiveIdx(idx);
 }, []);

 // ── trigger props factory ────────────────────────────────────────────────

 const getTriggerProps = React.useCallback(() => ({
 ref: triggerRef,
 'aria-haspopup': 'menu',
 'aria-expanded': open,
 onClick: toggle,
 onKeyDown: onTriggerKeyDown,
 }), [open, toggle, onTriggerKeyDown]);

 // ── render ───────────────────────────────────────────────────────────────

 let triggerEl;

 if (trigger) {
 // Clone the supplied trigger element, merging in the ARIA / event props.
 triggerEl = React.cloneElement(trigger, {
 ref: triggerRef,
 'aria-haspopup': 'menu',
 'aria-expanded': open,
 onClick: (e) => {
 trigger.props.onClick && trigger.props.onClick(e);
 toggle();
 },
 onKeyDown: (e) => {
 trigger.props.onKeyDown && trigger.props.onKeyDown(e);
 onTriggerKeyDown(e);
 },
 });
 } else if (renderTrigger) {
 triggerEl = renderTrigger({ open, getTriggerProps });
 }

 return (
 <>
 {triggerEl}
 {open && coords && (
 <MenuPopover
 items={items}
 coords={coords}
 align={align}
 menuRef={menuRef}
 activeIdx={activeIdx}
 onItemSelect={handleItemSelect}
 onMouseEnterItem={handleMouseEnterItem}
 idPrefix={idPrefix}
 />
 )}
 </>
 );
}

export default Menu;
