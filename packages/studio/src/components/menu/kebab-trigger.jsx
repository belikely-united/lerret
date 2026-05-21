// kebab-trigger.jsx — small ghost-tier kebab (⋮) button for the per-entity
// kebab menus.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// The Menu primitive is type-agnostic — it just renders a trigger
// + popover. Every kebab in the studio (artboard, section, future surfaces)
// uses the same visual treatment: a 22×22 ghost-tier icon button with the
// three-dot glyph, a "Actions" tooltip, and a focus ring that meets NFR14.
// This file is the one place that styling and shape live, so a future change
// updates every kebab in the studio at once.
//
// The kebab is rendered INSIDE a `<Menu>` via the `renderTrigger` render prop,
// so it picks up the Menu primitive's keyboard/click handling automatically.
// Use:
//
// <Menu
// items={…}
// renderTrigger={({ open, getTriggerProps }) => (
// <KebabTrigger
// open={open}
// getTriggerProps={getTriggerProps}
// aria-label="Actions for HeroBanner"
// />
// )}
// />
//
// Spec: UX-DR9 (ghost-tier kebab with tooltip), UX-DR16 (`--lm-*` tokens),
// NFR14 (focus ring + keyboard reach).

import React from 'react';

// ── CSS injection (scoped, no global pollution) ─────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('lm-kebab-trigger-styles')) {
 const s = document.createElement('style');
 s.id = 'lm-kebab-trigger-styles';
 s.textContent = `
.lm-kebab-trigger {
 /* Ghost-tier: transparent at rest, hover-fill */
 display: inline-flex;
 align-items: center;
 justify-content: center;
 width: 22px;
 height: 22px;
 padding: 0;
 border: none;
 border-radius: var(--lm-radius-sm, 5px);
 background: transparent;
 color: var(--lm-text-secondary, #3A3530);
 cursor: pointer;
 outline: none;
 transition:
 background var(--lm-duration-fast, 120ms) var(--lm-ease, ease-out),
 color var(--lm-duration-fast, 120ms) var(--lm-ease, ease-out),
 opacity var(--lm-duration-fast, 120ms) var(--lm-ease, ease-out);
}
.lm-kebab-trigger:hover,
.lm-kebab-trigger[aria-expanded="true"] {
 background: var(--lm-bg-tertiary, #E8E2D4);
 color: var(--lm-text-primary, #1A1714);
}
.lm-kebab-trigger:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
 opacity: 1;
}
.lm-kebab-trigger svg {
 display: block;
}
@media (prefers-reduced-motion: reduce) {
 .lm-kebab-trigger { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

/**
 * Kebab (⋮) trigger button.
 *
 * @param {object} props
 * @param {boolean} props.open
 * Whether the associated menu is currently open. Used to keep the trigger's
 * filled state in sync with the popover.
 * @param {() => Record<string, unknown>} props.getTriggerProps
 * The factory returned by `Menu`'s `renderTrigger`. Spread its result onto
 * the button so the Menu primitive owns the ARIA + click/keydown wiring.
 * @param {string} props['aria-label']
 * Accessible name. Should be specific (e.g. "Actions for HeroBanner") so
 * screen-reader users can disambiguate multiple kebabs on a page.
 * @param {string} [props.className]
 * Optional extra class for positioning at the call site (e.g. an absolute-
 * position class). The base `.lm-kebab-trigger` class is always applied.
 * @param {React.CSSProperties} [props.style]
 * Inline style overrides — typically positional. Avoid changing visual
 * tokens here; that's the CSS sheet's job.
 * @param {string} [props.title]
 * Tooltip text. Defaults to "Actions".
 * @param {string} [props['data-testid']]
 * @returns {React.ReactElement}
 */
export function KebabTrigger({
 open,
 getTriggerProps,
 'aria-label': ariaLabel,
 className,
 style,
 title = 'Actions',
 ...rest
}) {
 const triggerProps = getTriggerProps();
 const onPointerDown = (e) => {
 // The kebab is layered above the artboard / section header — both have
 // their own pointerdown handlers (drag-reorder, focus, etc.). Stop the
 // event so a click on the kebab never propagates to those handlers.
 e.stopPropagation();
 };
 return (
 <button
 type="button"
 className={`lm-kebab-trigger${className ? ` ${className}` : ''}`}
 style={style}
 title={title}
 aria-label={ariaLabel || title}
 data-open={open ? 'true' : 'false'}
 onPointerDown={onPointerDown}
 {...triggerProps}
 {...rest}
 >
 <svg
 width="14"
 height="14"
 viewBox="0 0 14 14"
 fill="currentColor"
 aria-hidden="true"
 >
 <circle cx="7" cy="2.5" r="1.35" />
 <circle cx="7" cy="7" r="1.35" />
 <circle cx="7" cy="11.5" r="1.35" />
 </svg>
 </button>
 );
}

export default KebabTrigger;
