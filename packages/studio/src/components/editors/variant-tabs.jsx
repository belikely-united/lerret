// variant-tabs.jsx — keyboard-operable variant tab picker for multi-variant
// assets in the Data editor (FR27, UX-DR5, NFR14).
//
// ── Design ───────────────────────────────────────────────────────────────────
// A single horizontal row of tabs — one per named export (variant). The active
// tab is marked with bold text AND a filled indicator dot so the distinction
// does NOT rely on color alone (UX-DR18). Arrow keys (Left/Right) cycle through
// tabs; focus follows. The tab panel (the form body) is managed by the parent.
//
// ── Accessibility ─────────────────────────────────────────────────────────────
// - role="tablist" / role="tab" following ARIA patterns.
// - aria-selected on the active tab.
// - Left/Right arrow keys cycle tab focus (roving tabindex: only the active
// tab is in the tab order; siblings have tabIndex=-1).
// - The visible focus ring uses `--lm-focus-ring` so it meets NFR14.

import React from 'react';

// ── CSS (scoped, injected once) ───────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('variant-tabs-styles')) {
 const s = document.createElement('style');
 s.id = 'variant-tabs-styles';
 s.textContent = `
.lm-variant-tabs {
 display: flex;
 flex-direction: row;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 margin-bottom: var(--lm-space-4, 16px);
 /* Horizontal scroll for very many variants. */
 overflow-x: auto;
}
.lm-variant-tab {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 padding: var(--lm-space-1, 4px) var(--lm-space-3, 12px);
 font: var(--lm-weight-regular, 400) var(--lm-size-body, 13px)/var(--lm-lh-body, 1.45) var(--lm-font-sans, ui-sans-serif);
 color: var(--lm-text-tertiary, #6E6960);
 background: transparent;
 border: none;
 border-radius: var(--lm-radius-pill, 999px);
 cursor: pointer;
 white-space: nowrap;
 transition:
 background var(--lm-duration-fast, 120ms) var(--lm-ease, ease),
 color var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
 outline: none;
}
.lm-variant-tab:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
 border-radius: var(--lm-radius-pill, 999px);
}
.lm-variant-tab[aria-selected="true"] {
 font-weight: var(--lm-weight-medium, 600);
 color: var(--lm-accent-text, #B85B33);
 background: var(--lm-accent-light, rgba(184,91,51,0.10));
}
.lm-variant-tab__dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-accent, #B85B33);
 flex-shrink: 0;
 /* Only visible on the active tab (icon/text + dot, not color alone). */
 visibility: hidden;
}
.lm-variant-tab[aria-selected="true"] .lm-variant-tab__dot {
 visibility: visible;
}

@media (prefers-reduced-motion: reduce) {
 .lm-variant-tab { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Keyboard-operable variant tab picker.
 *
 * @param {object} props
 * @param {string[]} props.variants
 * Ordered list of variant export names (e.g. `['default', 'Dark', 'Compact']`).
 * @param {string} props.activeVariant
 * The currently-selected variant export name.
 * @param {(variant: string) => void} props.onChange
 * Called when the user selects a different tab.
 * @returns {React.ReactElement}
 */
export function VariantTabs({ variants, activeVariant, onChange }) {
 const tabRefs = React.useRef([]);

 const handleKeyDown = React.useCallback(
 (e, idx) => {
 if (e.key === 'ArrowRight') {
 e.preventDefault();
 const next = (idx + 1) % variants.length;
 onChange(variants[next]);
 // Move focus after React state update so the tab button is re-rendered.
 setTimeout(() => {
 tabRefs.current[next]?.focus();
 }, 0);
 } else if (e.key === 'ArrowLeft') {
 e.preventDefault();
 const prev = (idx - 1 + variants.length) % variants.length;
 onChange(variants[prev]);
 setTimeout(() => {
 tabRefs.current[prev]?.focus();
 }, 0);
 }
 },
 [variants, onChange],
 );

 return (
 <div
 role="tablist"
 aria-label="Variants"
 className="lm-variant-tabs"
 data-testid="lm-variant-tabs"
 >
 {variants.map((name, idx) => {
 const isActive = name === activeVariant;
 return (
 <button
 key={name}
 role="tab"
 aria-selected={isActive}
 tabIndex={isActive ? 0 : -1}
 className="lm-variant-tab"
 data-testid={`lm-variant-tab-${name}`}
 ref={(el) => { tabRefs.current[idx] = el; }}
 onClick={() => onChange(name)}
 onKeyDown={(e) => handleKeyDown(e, idx)}
 >
 {/* Active indicator dot — pairs with bold text (not color alone). */}
 <span className="lm-variant-tab__dot" aria-hidden="true" />
 {name}
 </button>
 );
 })}
 </div>
 );
}

export default VariantTabs;
