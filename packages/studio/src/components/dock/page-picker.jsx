// page-picker.jsx — the studio dock's page navigation control (,
// UX-DR1).
//
// The brownfield dock laid every page out as a row of buttons. For a project
// with many pages that row gets long and noisy, so — per UX-DR1 — the page
// nav becomes a compact *picker*:
//
// • More than one page → a compact dropdown showing the current page;
// selecting a page switches the canvas to it.
// • Exactly one page → a plain static label (no dropdown, nothing to
// pick).
//
// Routing stays hash-driven: the picker calls `onNavigate(pageId)` and the
// shell's `useHashRoute` updates the hash; the canvas swaps the page in place
// (no full-page reload). The picker owns no routing state of its own.
//
// Keyboard operability (NFR14, UX-DR1) — the picker is fully keyboard-driven,
// matching the studio's existing focus-mode / walkthrough key handling:
// • the trigger is a real <button> — Tab-focusable, with a visible focus
// ring; Enter / Space / ArrowDown / ArrowUp open it;
// • once open, ArrowUp / ArrowDown move the highlight between pages, Home /
// End jump to the first / last, Enter / Space selects, Esc closes and
// returns focus to the trigger;
// • the listbox follows the ARIA listbox pattern (`role="listbox"` +
// `role="option"`, `aria-activedescendant`, `aria-expanded`).
//
// Built from the `--lm-*` design tokens and the brownfield dock conventions
// (the popover mirrors `StudioBrandMenu`).

import React from 'react';
import * as ReactDOM from 'react-dom';

// A small chevron — rotates when the picker is open. Matches the dock's
// existing chevrons.
function PickerChevron({ open }) {
 return (
 <svg
 width="9"
 height="9"
 viewBox="0 0 11 11"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.6"
 strokeLinecap="round"
 aria-hidden="true"
 style={{
 opacity: 0.55,
 transform: open ? 'rotate(180deg)' : 'none',
 transition: 'transform 120ms ease',
 flex: 'none',
 }}
 >
 <path d="M2 4l3.5 3.5L9 4" />
 </svg>
 );
}

// A small pages glyph for the trigger — reads as "page navigation" at a
// glance. Stacked sheets.
function PagesGlyph() {
 return (
 <svg
 width="12"
 height="12"
 viewBox="0 0 12 12"
 fill="none"
 stroke="currentColor"
 strokeWidth="1.4"
 strokeLinejoin="round"
 aria-hidden="true"
 style={{ flex: 'none', opacity: 0.8 }}
 >
 <path d="M3.5 1.5h3L9 4v6.5h-5.5z" />
 <path d="M2.5 3.5v6.5H8" />
 </svg>
 );
}

/**
 * The dock's page picker.
 *
 * @param {object} props
 * @param {{ id: string, label: string }[]} props.pages
 * The navigable pages, in dock order — each `{ id, label }`. `id` is what
 * `onNavigate` is called with (the hash route / page path).
 * @param {string} props.current The currently-active page's `id`.
 * @param {(id: string) => void} props.onNavigate
 * Called with a page `id` when the user picks a different page.
 * @returns {React.ReactElement | null}
 */
export function PagePicker({ pages, current, onNavigate }) {
 const list = Array.isArray(pages) ? pages : [];

 // Zero pages — nothing to render. (A project with no pages shows its own
 // empty-state on the canvas; the dock simply has no page control.)
 if (list.length === 0) return null;

 // Exactly one page — a static label, no dropdown (UX-DR1).
 if (list.length === 1) {
 return <PagePickerStaticLabel label={list[0].label} />;
 }

 return <PagePickerDropdown pages={list} current={current} onNavigate={onNavigate} />;
}

/**
 * The single-page case — a plain, non-interactive label. No affordance to
 * open anything, because there is nothing to pick.
 *
 * @param {object} props
 * @param {string} props.label
 * @returns {React.ReactElement}
 */
function PagePickerStaticLabel({ label }) {
 return (
 <span
 data-tour="dock-pages"
 data-page-picker="static"
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 7,
 padding: '8px 12px',
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: 600,
 color: 'var(--lm-text-secondary, #3a3530)',
 whiteSpace: 'nowrap',
 }}
 >
 <span style={{ display: 'inline-flex', color: 'var(--lm-text-tertiary, #6e6960)' }}>
 <PagesGlyph />
 </span>
 <span>{label}</span>
 </span>
 );
}

/**
 * The multi-page case — a compact dropdown. Owns only the open/highlight UI
 * state; page selection is delegated up via `onNavigate`.
 *
 * @param {object} props
 * @param {{ id: string, label: string }[]} props.pages
 * @param {string} props.current
 * @param {(id: string) => void} props.onNavigate
 * @returns {React.ReactElement}
 */
function PagePickerDropdown({ pages, current, onNavigate }) {
 const [open, setOpen] = React.useState(false);
 // Index of the keyboard-highlighted option while the list is open.
 const [activeIdx, setActiveIdx] = React.useState(0);
 // Screen coordinates the portaled listbox anchors to — the trigger's rect.
 // The listbox is portaled to <body> (so the dock's `overflow` cannot clip
 // it), so it is positioned in viewport space rather than relative to the
 // trigger. `null` until the list opens.
 const [coords, setCoords] = React.useState(null);
 const rootRef = React.useRef(null);
 const triggerRef = React.useRef(null);
 const listRef = React.useRef(null);

 const currentIdx = Math.max(
 0,
 pages.findIndex((p) => p.id === current),
 );
 const currentPage = pages[currentIdx] || pages[0];

 // Measure the trigger so the portaled listbox can anchor to it (its
 // bottom-left, since the list opens upward above the dock).
 const measure = React.useCallback(() => {
 if (!triggerRef.current) return;
 const r = triggerRef.current.getBoundingClientRect();
 setCoords({ left: r.left, bottom: window.innerHeight - r.top });
 }, []);

 // Open the list with the highlight on the current page.
 const openList = React.useCallback(() => {
 setActiveIdx(currentIdx);
 measure();
 setOpen(true);
 }, [currentIdx, measure]);

 // Close and return focus to the trigger — so keyboard focus never gets lost
 // when the popover unmounts (NFR14).
 const closeList = React.useCallback((refocus = true) => {
 setOpen(false);
 if (refocus && triggerRef.current) triggerRef.current.focus();
 }, []);

 // Pick a page: navigate (only if it actually changed) and close.
 const pick = React.useCallback(
 (idx) => {
 const page = pages[idx];
 if (page && page.id !== current) onNavigate(page.id);
 closeList();
 },
 [pages, current, onNavigate, closeList],
 );

 // Outside pointerdown closes the list (mirrors StudioBrandMenu). The check
 // spans both the trigger (`rootRef`) and the portaled listbox (`listRef`),
 // since the listbox lives outside the trigger's DOM subtree.
 React.useEffect(() => {
 if (!open) return undefined;
 const onPointerDown = (e) => {
 const inTrigger = rootRef.current && rootRef.current.contains(e.target);
 const inList = listRef.current && listRef.current.contains(e.target);
 if (!inTrigger && !inList) setOpen(false);
 };
 document.addEventListener('pointerdown', onPointerDown);
 return () => document.removeEventListener('pointerdown', onPointerDown);
 }, [open]);

 // Re-anchor the portaled listbox if the viewport changes while it is open
 // (resize / scroll) so it stays glued to the trigger.
 React.useEffect(() => {
 if (!open) return undefined;
 const onChange = () => measure();
 window.addEventListener('resize', onChange);
 window.addEventListener('scroll', onChange, true);
 return () => {
 window.removeEventListener('resize', onChange);
 window.removeEventListener('scroll', onChange, true);
 };
 }, [open, measure]);

 // On open, move DOM focus to the listbox so the focus ring shows on it and
 // it is the active element. On close, `closeList` returns focus to the
 // trigger. The listbox is portaled to <body> (outside the React root
 // container), so its keyboard handler is attached natively below rather
 // than as a React `onKeyDown` prop — React event delegation does not reach
 // a portaled node whose DOM ancestors exclude the React root.
 React.useEffect(() => {
 if (open && listRef.current) listRef.current.focus();
 }, [open]);

 // Keep the highlighted option scrolled into view as the highlight moves.
 React.useEffect(() => {
 if (!open || !listRef.current) return;
 const node = listRef.current.querySelector('[data-page-active="true"]');
 if (node && typeof node.scrollIntoView === 'function') {
 node.scrollIntoView({ block: 'nearest' });
 }
 }, [open, activeIdx]);

 // Keyboard on the trigger — open on ArrowDown/ArrowUp/Enter/Space.
 const onTriggerKeyDown = (e) => {
 if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
 e.preventDefault();
 openList();
 }
 };

 // Keyboard while the list is open — arrow navigation, select, dismiss.
 // A `useCallback` so the native listener (attached below) has a stable
 // identity per (activeIdx, pages, pick) and re-binds only when needed.
 const onListKeyDown = React.useCallback(
 (e) => {
 switch (e.key) {
 case 'ArrowDown':
 e.preventDefault();
 setActiveIdx((i) => (i + 1) % pages.length);
 break;
 case 'ArrowUp':
 e.preventDefault();
 setActiveIdx((i) => (i - 1 + pages.length) % pages.length);
 break;
 case 'Home':
 e.preventDefault();
 setActiveIdx(0);
 break;
 case 'End':
 e.preventDefault();
 setActiveIdx(pages.length - 1);
 break;
 case 'Enter':
 case ' ':
 e.preventDefault();
 pick(activeIdx);
 break;
 case 'Escape':
 e.preventDefault();
 closeList();
 break;
 case 'Tab':
 // Leaving the control by Tab — close, but don't steal focus back.
 closeList(false);
 break;
 default:
 break;
 }
 },
 [pages.length, activeIdx, pick, closeList],
 );

 // Attach the listbox keyboard handler natively (see the focus effect above
 // for why a React `onKeyDown` prop is not used on the portaled listbox).
 React.useEffect(() => {
 if (!open) return undefined;
 const node = listRef.current;
 if (!node) return undefined;
 node.addEventListener('keydown', onListKeyDown);
 return () => node.removeEventListener('keydown', onListKeyDown);
 }, [open, onListKeyDown]);

 const listboxId = 'lerret-page-picker-listbox';
 const optionId = (idx) => `lerret-page-picker-option-${idx}`;

 return (
 <span
 ref={rootRef}
 data-tour="dock-pages"
 data-page-picker="dropdown"
 style={{ position: 'relative', display: 'inline-flex' }}
 >
 <button
 ref={triggerRef}
 type="button"
 onClick={() => (open ? closeList() : openList())}
 onKeyDown={onTriggerKeyDown}
 aria-haspopup="listbox"
 aria-expanded={open}
 aria-label={`Page: ${currentPage.label}. Switch page`}
 title="Switch page"
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 7,
 padding: '8px 12px',
 borderRadius: 8,
 border: 'none',
 background: open ? 'rgba(0,0,0,0.06)' : 'transparent',
 color: 'var(--lm-text-secondary, #3a3530)',
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: 600,
 cursor: 'pointer',
 transition: 'background 120ms ease',
 whiteSpace: 'nowrap',
 maxWidth: 240,
 }}
 onMouseEnter={(e) => {
 if (!open) e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
 }}
 onMouseLeave={(e) => {
 if (!open) e.currentTarget.style.background = 'transparent';
 }}
 >
 <span style={{ display: 'inline-flex', color: 'var(--lm-text-tertiary, #6e6960)' }}>
 <PagesGlyph />
 </span>
 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentPage.label}</span>
 <PickerChevron open={open} />
 </button>

 {/* The listbox is portaled to <body> so the dock's `overflow` never
 clips it, and positioned in viewport space anchored to the trigger
 (it opens upward, above the dock). Mirrors how `DCFocusOverlay` and
 the studio walkthrough escape transformed/clipped ancestors. */}
 {open && coords &&
 ReactDOM.createPortal(
 <ul
 ref={listRef}
 id={listboxId}
 role="listbox"
 tabIndex={-1}
 aria-label="Pages"
 aria-activedescendant={optionId(activeIdx)}
 style={{
 position: 'fixed',
 bottom: coords.bottom + 8,
 left: coords.left,
 listStyle: 'none',
 margin: 0,
 minWidth: 200,
 maxWidth: 300,
 maxHeight: 280,
 overflowY: 'auto',
 background: 'rgba(255,255,255,0.97)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 border: '1px solid rgba(26,23,20,0.10)',
 borderRadius: 12,
 padding: 6,
 boxShadow: '0 12px 32px rgba(15,23,42,0.18), 0 1px 3px rgba(15,23,42,0.06)',
 zIndex: 80,
 outline: 'none',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 }}
 >
 <li
 aria-hidden="true"
 style={{
 fontSize: 9.5,
 fontWeight: 600,
 letterSpacing: '0.14em',
 textTransform: 'uppercase',
 color: 'var(--lm-text-muted, #9a958c)',
 padding: '6px 12px 6px',
 }}
 >
 Pages
 </li>
 {pages.map((page, idx) => {
 const isCurrent = page.id === current;
 const isActive = idx === activeIdx;
 return (
 <li
 key={page.id}
 id={optionId(idx)}
 role="option"
 aria-selected={isCurrent}
 data-page-active={isActive}
 onClick={() => pick(idx)}
 onMouseEnter={() => setActiveIdx(idx)}
 style={{
 display: 'flex',
 alignItems: 'center',
 gap: 8,
 padding: '8px 12px',
 borderRadius: 8,
 cursor: 'pointer',
 fontSize: 13,
 fontWeight: isCurrent ? 600 : 500,
 color: 'var(--lm-text-primary, #1a1714)',
 // The keyboard highlight is the visible focus indicator for
 // options (the listbox itself holds DOM focus). NFR14.
 background: isActive ? 'var(--lm-accent-light, rgba(184,91,51,0.10))' : 'transparent',
 boxShadow: isActive
 ? 'inset 0 0 0 1.5px var(--lm-accent, #B85B33)'
 : 'none',
 }}
 >
 {/* Current-page check — keeps the active page legible even as
 the keyboard highlight moves elsewhere. */}
 <span
 aria-hidden="true"
 style={{
 width: 12,
 display: 'inline-flex',
 justifyContent: 'center',
 color: 'var(--lm-accent, #B85B33)',
 }}
 >
 {isCurrent ? (
 <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
 <path d="M2 5.8L4.4 8.2 9 2.8" />
 </svg>
 ) : null}
 </span>
 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
 {page.label}
 </span>
 </li>
 );
 })}
 </ul>,
 document.body,
 )}
 </span>
 );
}

export default PagePicker;
