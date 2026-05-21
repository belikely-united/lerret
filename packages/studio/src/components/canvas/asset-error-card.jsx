// asset-error-card.jsx — the real per-artboard error card.
//
// Displayed when an asset fails to load/evaluate (status: 'error' in the
// runtime record) or when its component throws at render time (caught by
// `AssetErrorBoundary`). It is a pure function of an `AssetError` and the
// asset's file path.
//
// Design rules (UX-DR12, NFR8):
// • Calm and contained — occupies the artboard slot, NOT a full-screen overlay.
// • Styled with `--lm-*` Error status tokens (error-warm, light bg, border).
// • Error color is ALWAYS paired with an icon + text label — color is never
// the sole signal (accessibility requirement, UX-DR12).
// • Displays a readable message and the asset's file path.

// ---------------------------------------------------------------------------
// Inline SVG icon — a simple exclamation-circle, zero extra deps.
// ---------------------------------------------------------------------------
// An icon is a required part of the design: color must always be paired with
// an icon or text so meaning survives for color-blind users (UX-DR12).
//
// We encode it as an inline SVG (12×12px) rather than a font icon or image
// import — no additional dependency, no network request, no flash of missing
// glyph.

function ErrorIcon({ size = 13 }) {
 return (
 <svg
 aria-hidden="true"
 focusable="false"
 width={size}
 height={size}
 viewBox="0 0 16 16"
 fill="none"
 xmlns="http://www.w3.org/2000/svg"
 style={{ flexShrink: 0 }}
 >
 <circle cx="8" cy="8" r="7.25" stroke="currentColor" strokeWidth="1.5" />
 <line
 x1="8"
 y1="4.5"
 x2="8"
 y2="9"
 stroke="currentColor"
 strokeWidth="1.5"
 strokeLinecap="round"
 />
 <circle cx="8" cy="11.5" r="0.875" fill="currentColor" />
 </svg>
 );
}

// ---------------------------------------------------------------------------
// Phase label map — human-readable description of where the failure happened.
// ---------------------------------------------------------------------------

const PHASE_LABELS = {
 load: 'Load error',
 evaluate: 'Module error',
 render: 'Render error',
};

// ---------------------------------------------------------------------------
// AssetErrorCard — public component
// ---------------------------------------------------------------------------

/**
 * A contained per-artboard error card for a broken asset.
 *
 * Displays a readable error message, the failure phase (load / module-eval /
 * render), and the asset's file path. Styled entirely with `--lm-*` tokens.
 * Color is always paired with an icon and the "Error" text label so meaning
 * survives without color (UX-DR12, NFR8).
 *
 * @param {object} props
 * @param {import('../../runtime/asset-runtime.js').AssetError | null | undefined} props.error
 * The structured asset failure from the runtime or the error boundary.
 * @param {string} [props.filePath]
 * The asset's file path to show in the card (e.g. `entry.asset.path`).
 * @returns {React.ReactElement}
 */
export function AssetErrorCard({ error, filePath }) {
 const phase = error?.phase ?? 'render';
 const message = error?.message ?? 'Unknown error';
 const phaseLabel = PHASE_LABELS[phase] ?? 'Error';

 return (
 <div
 data-asset-error
 data-error-phase={phase}
 role="alert"
 aria-label={`Asset error: ${message}`}
 style={{
 // Fill the artboard slot — contained, NOT full-screen.
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: 'var(--lm-space-4, 16px)',
 // Error status tokens (calm warm red range from colors_and_type.css).
 background: 'var(--lm-error-light)',
 border: '1px solid var(--lm-error-border)',
 borderRadius: 'var(--lm-radius-sm, 6px)',
 // Layout.
 display: 'flex',
 flexDirection: 'column',
 gap: 'var(--lm-space-2, 8px)',
 overflow: 'hidden',
 }}
 >
 {/* ── Header row: icon + "Error" label + phase ─────────────────────── */}
 {/* Icon is REQUIRED — color must always be paired with icon or text. */}
 <div
 style={{
 display: 'flex',
 alignItems: 'center',
 gap: 'var(--lm-space-1, 4px)',
 color: 'var(--lm-error)',
 }}
 >
 <ErrorIcon size={13} />
 <span
 style={{
 fontFamily: 'var(--lm-font-sans)',
 fontSize: 'var(--lm-size-hint, 10px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 letterSpacing: 'var(--lm-tracking-caps, 0.5px)',
 textTransform: 'uppercase',
 lineHeight: 1,
 }}
 >
 {/* "Error" text label — ensures meaning survives for color-blind users. */}
 Error &middot; {phaseLabel}
 </span>
 </div>

 {/* ── Message ──────────────────────────────────────────────────────── */}
 <p
 style={{
 margin: 0,
 fontFamily: 'var(--lm-font-mono)',
 fontSize: 'var(--lm-size-body-sm, 12px)',
 lineHeight: 'var(--lm-lh-body, 1.45)',
 color: 'var(--lm-error)',
 wordBreak: 'break-word',
 // Allow the message to show ~3 lines in a compact artboard.
 display: '-webkit-box',
 WebkitLineClamp: 4,
 WebkitBoxOrient: 'vertical',
 overflow: 'hidden',
 }}
 >
 {message}
 </p>

 {/* ── File path ───────────────────────────────────────────────────── */}
 {filePath && (
 <p
 style={{
 margin: 0,
 fontFamily: 'var(--lm-font-mono)',
 fontSize: 'var(--lm-size-hint, 10px)',
 lineHeight: 'var(--lm-lh-body, 1.45)',
 color: 'var(--lm-error)',
 opacity: 0.7,
 wordBreak: 'break-all',
 overflow: 'hidden',
 textOverflow: 'ellipsis',
 whiteSpace: 'nowrap',
 }}
 title={filePath}
 >
 {filePath}
 </p>
 )}
 </div>
 );
}
