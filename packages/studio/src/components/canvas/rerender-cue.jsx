// rerender-cue.jsx — the brief, calm "this artboard just re-rendered" cue
// (; UX-DR17 — quiet confirmation, never decorative).
//
// The cue is a thin sienna ring that flashes around the artboard frame for
// roughly half a second after a successful live re-render, then fades. Sized
// from `--lm-*` tokens (accent + border-radius) so it stays consistent with
// the rest of the studio. It is purely decorative: pointer-events none,
// aria-hidden, no interactivity.
//
// Honors `prefers-reduced-motion`:
// - default — opacity 1 → 0 with a short transition,
// - reduced — opacity is set instantly (CSS `transition: none`), so the
// ring appears, holds for the same duration, then disappears, with no
// animation at all (UX-DR17 falls back to "an instant state change").
//
// Implementation: a CSS `@keyframes` is avoided so we don't need to inject a
// stylesheet at runtime — a single `useEffect` flips an opacity state.

import React from 'react';

/**
 * How long the cue is visible, in milliseconds. Short enough to feel like a
 * confirmation rather than chrome; long enough that the user reliably
 * notices it. (The 1-second NFR2 budget covers detect → re-render; the cue
 * lives entirely after the re-render lands.)
 *
 * @type {number}
 */
const CUE_VISIBLE_MS = 520;

/**
 * Detect `prefers-reduced-motion: reduce`. Safe at module-load on the studio
 * (jsdom returns a default of `false`); the `MediaQueryList` is re-queried
 * each time the cue mounts so a user toggling the OS preference mid-session
 * is honored on the *next* re-render (no setup overhead for a poll).
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
 if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
 return false;
 }
 try {
 return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 } catch {
 return false;
 }
}

/**
 * The re-render cue. Renders an absolutely-positioned ring at the artboard
 * frame's edges. The parent positions the cue (it is `position: absolute`
 * inset 0). The `cueKey` prop drives the cue's animation lifecycle — change
 * it (a fresh timestamp / counter per re-render) to trigger another cue;
 * leave it alone to keep the cue at rest.
 *
 * @param {object} props
 * @param {unknown} props.cueKey
 * A value that changes whenever the parent re-rendered an artboard. The
 * cue runs once per distinct value. `undefined` keeps the cue at rest.
 * @returns {React.ReactElement | null}
 */
export function RerenderCue({ cueKey }) {
 // `phase` carries the cue's lifecycle: `'idle'` (invisible, default),
 // `'show'` (just appeared, fully opaque), `'fade'` (fading out).
 // The two-step show → fade lets the CSS opacity transition handle the
 // animation by transitioning between the two states.
 /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
 const [phase, setPhase] = React.useState('idle');
 const reduceMotion = React.useMemo(prefersReducedMotion, [cueKey]);

 React.useEffect(() => {
 if (cueKey === undefined || cueKey === null) {
 // First mount, or the parent reset to no-cue — stay idle.
 setPhase('idle');
 return undefined;
 }
 // Cue cycle: appear → after the visible window, fade → after the fade
 // window, idle (so a subsequent identical cueKey would still re-trigger
 // because the parent always bumps the key for each re-render).
 setPhase('show');
 const fadeTimer = setTimeout(
 () => setPhase('fade'),
 reduceMotion ? CUE_VISIBLE_MS : Math.max(80, CUE_VISIBLE_MS - 240),
 );
 const resetTimer = setTimeout(() => setPhase('idle'), CUE_VISIBLE_MS);
 return () => {
 clearTimeout(fadeTimer);
 clearTimeout(resetTimer);
 };
 }, [cueKey, reduceMotion]);

 if (phase === 'idle') return null;

 // The ring itself — outlined, not filled, so the artboard content stays
 // fully visible. Inset by 1px so the ring sits *just* outside the frame's
 // own border, never covering it. `boxShadow` rather than `border` so we
 // don't shift the layout of the underlying artboard.
 const opacity = phase === 'show' ? 1 : 0;
 const transition = reduceMotion
 ? 'none'
 : `opacity ${CUE_VISIBLE_MS - 240}ms ease-out, box-shadow ${CUE_VISIBLE_MS - 240}ms ease-out`;

 return (
 <div
 data-lm-rerender-cue
 aria-hidden="true"
 style={{
 position: 'absolute',
 inset: -3,
 borderRadius: 'var(--lm-radius-md, 6px)',
 pointerEvents: 'none',
 opacity,
 transition,
 // A two-stop ring: a soft outer glow + a sharper accent border. Both
 // sourced from `--lm-accent` so the cue ties to the studio's accent
 // palette.
 boxShadow:
 phase === 'show'
 ? '0 0 0 1.5px var(--lm-accent, #B85B33), 0 0 12px 1px var(--lm-accent-border, rgba(184,91,51,0.35))'
 : '0 0 0 1.5px transparent, 0 0 0 0 transparent',
 }}
 />
 );
}

export default RerenderCue;
