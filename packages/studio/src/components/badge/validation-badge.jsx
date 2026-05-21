// validation-badge.jsx — calm, non-blocking validation badge for artboards
// that have resolved props failing their propsSchema (FR32, FR33).
//
// ── Design intent (UX-DR10) ──────────────────────────────────────────────────
// A small warning badge rendered in the corner of an artboard whose resolved
// props fail their declared `propsSchema`. It is an INVITATION — never an
// alarm — using Warning-amber (--lm-warning) paired with a warning icon and
// text so meaning survives without color (UX-DR18, NFR15). It reads as calm
// and actionable: "something needs attention, click to fix it."
//
// ── Keyboard operability (NFR14) ─────────────────────────────────────────────
// The badge is a `<button>` — focusable, Enter/Space activate it, and it
// exposes a visible focus ring using `--lm-focus-ring`. Tab reaches it.
//
// ── Non-blocking (NFR8) ──────────────────────────────────────────────────────
// The badge only annotates the artboard. It never blocks render, never forces
// a modal, never intercepts canvas interaction beyond its own small surface.
// The artboard underneath renders normally using defaults/empties.
//
// ── Repair-clears (FR33) ─────────────────────────────────────────────────────
// When the data editor is used to fix the offending values, the file-watcher
// re-renders the artboard, `validateProps` re-evaluates, and `failedFields`
// becomes empty — the badge disappears automatically without any extra logic.
//
// ── Placement ────────────────────────────────────────────────────────────────
// Rendered in the top-left corner of the artboard's inner `div` (opposite the
// "Edit data" trigger that sits top-right). Positioned `absolute` within the
// artboard's `position: relative` host.
//
// ── CSS token note ───────────────────────────────────────────────────────────
// Warning-amber tokens (`--lm-warning`, `--lm-warning-light`, etc.) already
// exist in `colors_and_type.css`. The component uses them inline here;
// will consolidate all badge/chip CSS into the token system.

// ── CSS injection (scoped, single instance) ───────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('validation-badge-styles')) {
 const s = document.createElement('style');
 s.id = 'validation-badge-styles';
 s.textContent = `
/* Validation badge */

/* Wrapper button: positioned absolutely at the top-left of the artboard host. */
.lm-validation-badge {
 position: absolute;
 top: 6px;
 left: 6px;
 z-index: 10;
 display: inline-flex;
 align-items: center;
 gap: 4px;
 padding: 2px 8px;
 height: 22px;
 font-family: var(--lm-font-sans, ui-sans-serif, system-ui, sans-serif);
 font-size: 11px;
 font-weight: var(--lm-weight-semibold, 600);
 letter-spacing: 0.04em;
 line-height: 1;
 /* Warning-amber (calm, never error-red) */
 color: var(--lm-warning, #B07B1F);
 background: var(--lm-warning-light, rgba(176, 123, 31, 0.10));
 border: 1px solid var(--lm-warning-border, rgba(176, 123, 31, 0.20));
 border-radius: var(--lm-radius-sm, 6px);
 box-shadow: var(--lm-shadow-xs, 0 1px 2px rgba(26, 23, 20, 0.05));
 cursor: pointer;
 user-select: none;
 outline: none;
 transition:
 background var(--lm-duration-fast, 120ms) var(--lm-ease, ease),
 box-shadow var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}

.lm-validation-badge:hover {
 background: var(--lm-warning-hover, rgba(176, 123, 31, 0.16));
 box-shadow: var(--lm-shadow-sm, 0 1px 3px rgba(26, 23, 20, 0.10));
}

/* NFR14: keyboard focus ring — uses the shared accent-border focus token */
.lm-validation-badge:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}

/* Tooltip (shown on hover and focus via HTML title attribute — native, no JS) */
/* Rendered by the browser's native tooltip; we just set the title attribute. */

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
 .lm-validation-badge { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── Warning icon (inline SVG) ─────────────────────────────────────────────────
//
// A triangle with an exclamation mark — universally recognized warning symbol.
// Inline SVG so it inherits `currentColor` from the amber `.lm-validation-badge`
// and requires no external icon dependency. `aria-hidden` because the button's
// text label and accessible name carry the meaning.

function WarningIcon() {
 return (
 <svg
 aria-hidden="true"
 focusable="false"
 width="12"
 height="12"
 viewBox="0 0 12 12"
 fill="none"
 xmlns="http://www.w3.org/2000/svg"
 style={{ flexShrink: 0 }}
 >
 {/* Triangle outline */}
 <path
 d="M5.134 1.5C5.52 0.833 6.48 0.833 6.866 1.5L11.196 9C11.582 9.667 11.102 10.5 10.33 10.5H1.67C0.898 10.5 0.418 9.667 0.804 9L5.134 1.5Z"
 fill="currentColor"
 opacity="0.15"
 />
 <path
 d="M5.134 1.5C5.52 0.833 6.48 0.833 6.866 1.5L11.196 9C11.582 9.667 11.102 10.5 10.33 10.5H1.67C0.898 10.5 0.418 9.667 0.804 9L5.134 1.5Z"
 stroke="currentColor"
 strokeWidth="1"
 fill="none"
 />
 {/* Exclamation body */}
 <line x1="6" y1="4.5" x2="6" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
 {/* Exclamation dot */}
 <circle cx="6" cy="9" r="0.6" fill="currentColor" />
 </svg>
 );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Validation badge rendered on an artboard whose resolved props fail their
 * declared `propsSchema` (FR32, FR33).
 *
 * Renders ONLY when `failedFields.length > 0` AND `propsSchema` is truthy.
 * The badge is a calm Warning-amber invitation — never an alarm (UX-DR10).
 * Clicking or activating it (Enter/Space) opens the Data editor scrolled and
 * focused onto the first offending field (`onClick` prop).
 *
 * @param {object} props
 * @param {Array<{ prop: string, reason: string }>} props.failedFields
 * The list returned by `validateProps`. Badge renders when non-empty.
 * @param {unknown} props.propsSchema
 * The asset's `meta.propsSchema`. Badge only renders when this is truthy.
 * @param {() => void} props.onClick
 * Called when the user activates the badge (click / Enter / Space).
 * Typically opens the Data editor with `initialFocusField` pre-set.
 * @returns {React.ReactElement | null}
 */
export function ValidationBadge({ failedFields, propsSchema, onClick }) {
 // Only render when the schema exists AND there are failures (FR32).
 if (!propsSchema || !Array.isArray(failedFields) || failedFields.length === 0) {
 return null;
 }

 const count = failedFields.length;
 const firstProp = failedFields[0].prop;

 // Build a descriptive accessible label (survives color-blind reading, NFR15).
 const label = count === 1
 ? `1 prop needs attention — click to fix "${firstProp}"`
 : `${count} props need attention — click to fix`;

 // Text shown inside the badge: "Validation" for a single field, the count
 // for multiple. Always paired with the WarningIcon (UX-DR18: icon + text,
 // meaning does not rely on color alone).
 const badgeText = count === 1 ? 'Validation' : `${count} issues`;

 return (
 <button
 type="button"
 className="lm-validation-badge"
 onClick={(e) => {
 // Prevent the click from bubbling to canvas grip/drag handlers.
 e.stopPropagation();
 onClick();
 }}
 onPointerDown={(e) => e.stopPropagation()}
 onKeyDown={(e) => {
 if (e.key === 'Enter' || e.key === ' ') {
 e.preventDefault();
 e.stopPropagation();
 onClick();
 }
 }}
 title={label}
 aria-label={label}
 data-testid="lm-validation-badge"
 >
 <WarningIcon />
 <span>{badgeText}</span>
 </button>
 );
}

export default ValidationBadge;
