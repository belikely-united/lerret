// walkthrough-overlay.jsx — extracted from studio-shell.jsx and extended for
// the folder→canvas model. The brownfield spotlight overlay + chrome (Skip / Back /
// Next / Esc) is preserved unchanged; the step sequence is the new 8-step one
// from walkthrough-steps.js; and the first-ever-visit "take the tour?" offer
// is implemented here via WalkthroughOffer.
//
// ── What changed from the brownfield ────────────────────────────────────────
// • Steps: replaced the 7-step dock tour with the 8-step folder→canvas tour.
// • WalkthroughOffer: a new calm dismissible prompt rendered after the first
// canvas render, shown only to first-ever visitors.
// • Persistence: completed/skipped state is recorded to localStorage (see
// walkthrough-persistence.js). Returning visitors never see the offer.
// • Accessibility: trapped focus (focusable children of the caption card),
// focus restored on close, Esc/Enter/←/→ keyboard nav — all preserved from
// the brownfield. prefers-reduced-motion switches spotlight transition to
// `none`.
// • Design tokens: --lm-* tokens used for accent colours / backgrounds, with
// static fallbacks so the overlay works without CSS custom properties.
// • Export ZIP step (step 7) requires `[data-tour="dock-export"]` which is
// only present when a project is loaded (`projectModel != null` in the dock).
// When it is absent the spotlight resolves null and the dim covers the full
// screen — behaviour consistent with the brownfield's `target: null` steps.
//
// ── Component tree ───────────────────────────────────────────────────────────
//
// WalkthroughOffer — "Take the tour?" dock-notice (first visit only).
// StudioWalkthroughOverlay — the full spotlight overlay.
// └── WalkthroughCaptionCard / WalkthroughDoneCard / StudioProTipCard
//
// These are exported for use in studio-shell.jsx (wiring).

import React from 'react';
import * as ReactDOM from 'react-dom';

import { WALKTHROUGH_STEPS } from './walkthrough-steps.js';
import {
 recordWalkthroughCompleted,
 recordWalkthroughSkipped,
} from './walkthrough-persistence.js';

// ── prefers-reduced-motion detection ────────────────────────────────────────
// When the user prefers reduced motion the spotlight transitions switch from a
// smooth animation to an instant snap. The hook returns a memoised boolean.

function usePrefersReducedMotion() {
 const mql = typeof window !== 'undefined' && window.matchMedia
 ? window.matchMedia('(prefers-reduced-motion: reduce)')
 : null;
 const [reduced, setReduced] = React.useState(() => mql ? mql.matches : false);
 React.useEffect(() => {
 if (!mql) return;
 const handler = (e) => setReduced(e.matches);
 mql.addEventListener('change', handler);
 return () => mql.removeEventListener('change', handler);
 }, []); // eslint-disable-line react-hooks/exhaustive-deps
 return reduced;
}

// ── Focus trap helpers ───────────────────────────────────────────────────────
// Returns all focusable children of a container node.
const FOCUSABLE = [
 'a[href]', 'button:not([disabled])', 'input:not([disabled])',
 'textarea:not([disabled])', 'select:not([disabled])',
 '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container) {
 if (!container) return [];
 return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
 (el) => !el.closest('[hidden]'),
 );
}

// ── Button styles — matching the brownfield's tourBtn* tokens ───────────────
const tourBtnGhost = {
 border: 'none', background: 'transparent',
 color: 'var(--lm-text-secondary, #3A3530)', fontSize: 13, fontWeight: 500,
 padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
 fontFamily: 'inherit',
};
const tourBtnPrimary = {
 border: 'none', background: 'var(--lm-accent, #B85B33)',
 color: 'var(--lm-surface, #FAF8F2)', fontSize: 13, fontWeight: 600,
 padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
 fontFamily: 'inherit',
};

// ── WalkthroughCaptionCard ───────────────────────────────────────────────────
// The per-step caption card. Manages focus trap via ref.

function WalkthroughCaptionCard({
 step, stepIdx, total, isFirst, isLast, captionPos, prefersReducedMotion,
 onBack, onNext, onSkip,
}) {
 const cardRef = React.useRef(null);

 // Move focus into the card on each step so keyboard users can operate it.
 React.useEffect(() => {
 if (!cardRef.current) return;
 // Find the first focusable child (usually the Skip button).
 const focusable = getFocusable(cardRef.current);
 if (focusable.length > 0) focusable[0].focus();
 }, [stepIdx]);

 // Focus trap: Tab / Shift+Tab cycle within the card.
 const onKeyDown = (e) => {
 if (e.key !== 'Tab') return;
 const focusable = getFocusable(cardRef.current);
 if (focusable.length === 0) return;
 const first = focusable[0];
 const last = focusable[focusable.length - 1];
 if (e.shiftKey) {
 if (document.activeElement === first) {
 e.preventDefault();
 last.focus();
 }
 } else {
 if (document.activeElement === last) {
 e.preventDefault();
 first.focus();
 }
 }
 };

 // Resolve the body — some steps have alternate copy for single-page projects.
 const singlePage = Boolean(
 document.querySelector('[data-page-picker="static"]'),
 );
 const body = (singlePage && step.singlePageBody) ? step.singlePageBody : step.body;

 return (
 <div
 ref={cardRef}
 role="dialog"
 aria-modal="true"
 aria-label={`Walkthrough step ${stepIdx + 1} of ${total}: ${step.title}`}
 tabIndex={-1}
 style={{
 position: 'absolute',
 ...captionPos,
 width: 320,
 background: 'var(--lm-surface, #FAF8F2)',
 borderRadius: 12,
 padding: '18px 20px 16px',
 boxShadow: 'var(--lm-shadow-popup, 0 18px 48px rgba(26,23,20,0.22))',
 color: 'var(--lm-text-primary, #1A1714)',
 pointerEvents: 'auto',
 // No transition when prefers-reduced-motion
 transition: prefersReducedMotion ? 'none' : undefined,
 outline: 'none',
 }}
 onClick={(e) => e.stopPropagation()}
 onKeyDown={onKeyDown}
 >
 <div style={{
 fontSize: 10, fontWeight: 600,
 letterSpacing: '0.14em', textTransform: 'uppercase',
 color: 'var(--lm-accent-muted, #92421E)',
 marginBottom: 10,
 }}>Step {stepIdx + 1} of {total}</div>
 <div style={{
 fontFamily: '"Instrument Serif", Georgia, serif',
 fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.01em',
 color: 'var(--lm-text-primary, #1A1714)',
 marginBottom: 8,
 }}>{step.title}</div>
 {body && (
 <div style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--lm-text-secondary, #3A3530)' }}>
 {body}
 </div>
 )}
 <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
 <button
 type="button"
 className="lm-focusable"
 onClick={onSkip}
 style={{ ...tourBtnGhost, marginRight: 'auto' }}
 >Skip</button>
 {!isFirst && (
 <button
 type="button"
 className="lm-focusable"
 onClick={onBack}
 style={tourBtnGhost}
 >← Back</button>
 )}
 <button
 type="button"
 className="lm-focusable"
 onClick={onNext}
 style={tourBtnPrimary}
 data-testid="walkthrough-next"
 >{isLast ? 'Done' : 'Next →'}</button>
 </div>
 </div>
 );
}

// ── WalkthroughDoneCard ──────────────────────────────────────────────────────
// The closing "you're all set" card — step 8.

function WalkthroughDoneCard({ stepIdx, total, onBack, onClose, prefersReducedMotion }) {
 const cardRef = React.useRef(null);
 React.useEffect(() => {
 if (!cardRef.current) return;
 const focusable = getFocusable(cardRef.current);
 if (focusable.length > 0) focusable[0].focus();
 }, []);

 const onKeyDown = (e) => {
 if (e.key !== 'Tab') return;
 const focusable = getFocusable(cardRef.current);
 if (!focusable.length) return;
 const first = focusable[0];
 const last = focusable[focusable.length - 1];
 if (e.shiftKey) {
 if (document.activeElement === first) { e.preventDefault(); last.focus(); }
 } else {
 if (document.activeElement === last) { e.preventDefault(); first.focus(); }
 }
 };

 return (
 <div
 ref={cardRef}
 role="dialog"
 aria-modal="true"
 aria-label="Walkthrough complete"
 tabIndex={-1}
 style={{
 position: 'absolute',
 top: '50%', left: '50%',
 transform: 'translate(-50%, -50%)',
 width: 420,
 background: 'var(--lm-surface, #FAF8F2)',
 borderRadius: 16,
 padding: '28px 28px 24px',
 boxShadow: 'var(--lm-shadow-popup, 0 18px 48px rgba(26,23,20,0.22))',
 color: 'var(--lm-text-primary, #1A1714)',
 pointerEvents: 'auto',
 outline: 'none',
 transition: prefersReducedMotion ? 'none' : undefined,
 }}
 onClick={(e) => e.stopPropagation()}
 onKeyDown={onKeyDown}
 >
 <div style={{
 fontSize: 10, fontWeight: 600,
 letterSpacing: '0.14em', textTransform: 'uppercase',
 color: 'var(--lm-accent-muted, #92421E)',
 marginBottom: 14,
 }}>Done · Step {stepIdx + 1} of {total}</div>
 <div style={{
 fontFamily: '"Instrument Serif", Georgia, serif',
 fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.02em',
 color: 'var(--lm-text-primary, #1A1714)',
 marginBottom: 14,
 }}>You&rsquo;re all set.</div>
 <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--lm-text-secondary, #3A3530)', marginBottom: 22 }}>
 Edit files in your code editor or with an AI tool — Lerret renders changes in real time.
 For data, config, meta, and Markdown, use the kebab menu forms inside the studio.
 Export single artboards or the whole project as a ZIP from the dock.
 </div>
 <div style={{
 background: 'var(--lm-accent-light, rgba(184,91,51,0.10))',
 borderRadius: 8,
 padding: '10px 14px',
 fontSize: 13,
 color: 'var(--lm-text-secondary, #3A3530)',
 marginBottom: 22,
 }}>
 Read the docs at{' '}
 <a
 className="lm-focusable"
 href="https://lerret.belikely.com/docs"
 target="_blank"
 rel="noopener noreferrer"
 style={{ color: 'var(--lm-accent, #B85B33)', fontWeight: 600, textDecoration: 'none' }}
 >
 lerret.belikely.com/docs
 </a>
 </div>
 <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 <button type="button" className="lm-focusable" onClick={onBack} style={{ ...tourBtnGhost, marginRight: 'auto' }}>← Back</button>
 <button
 type="button"
 className="lm-focusable"
 onClick={onClose}
 style={tourBtnPrimary}
 data-testid="walkthrough-done"
 >Got it</button>
 </div>
 </div>
 );
}

// ── StudioWalkthroughOverlay ─────────────────────────────────────────────────
// The full spotlight overlay. Extracted from studio-shell.jsx.
// The spotlight chrome (4-strip dim + dashed frame) is preserved unchanged;
// the step sequence is the new 8-step folder→canvas tour.

/**
 * @param {object} props
 * @param {() => void} props.onClose Called when the walkthrough is dismissed (skip OR done).
 * @param {boolean} [props.completed] If true, records completion; if false, records skip.
 * Managed by the overlay itself — callers just pass onClose.
 */
export function StudioWalkthroughOverlay({ onClose }) {
 const [stepIdx, setStepIdx] = React.useState(0);
 const [rect, setRect] = React.useState(null);
 const prefersReducedMotion = usePrefersReducedMotion();

 // The element that had focus before the overlay opened — restored on close.
 const prevFocusRef = React.useRef(
 typeof document !== 'undefined' ? document.activeElement : null,
 );

 const steps = WALKTHROUGH_STEPS;
 const step = steps[stepIdx];
 const total = steps.length;
 const isLast = stepIdx === total - 1;
 const isFirst = stepIdx === 0;

 // Restore focus to the previously-focused element on close.
 // Declared before the keyboard useEffect that references these handlers.
 const restoreFocus = () => {
 const prev = prevFocusRef.current;
 if (prev && typeof prev.focus === 'function') {
 try { prev.focus(); } catch { /* ignore */ }
 }
 };

 const handleSkip = () => {
 recordWalkthroughSkipped();
 restoreFocus();
 onClose();
 };

 const handleDone = () => {
 recordWalkthroughCompleted();
 restoreFocus();
 onClose();
 };

 const advance = () => {
 if (isLast) handleDone(); else setStepIdx((i) => i + 1);
 };

 // Measure the spotlight target on each step (and on resize/scroll).
 React.useEffect(() => {
 if (!step.target) { setRect(null); return; }
 const measure = () => {
 const el = document.querySelector(step.target);
 if (!el) { setRect(null); return; }
 const r = el.getBoundingClientRect();
 setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
 // Scroll the target into view if it is off-screen.
 if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) {
 el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'center' });
 }
 };
 measure();
 window.addEventListener('resize', measure);
 window.addEventListener('scroll', measure, true);
 // Re-measure after scroll animation settles (same as brownfield).
 const t = setTimeout(measure, 300);
 return () => {
 window.removeEventListener('resize', measure);
 window.removeEventListener('scroll', measure, true);
 clearTimeout(t);
 };
 }, [step.target, stepIdx, prefersReducedMotion]);

 // Global keyboard: Esc → skip; → / Enter → next; ← → back.
 // These work regardless of where focus is inside the overlay so keyboard
 // users can navigate without moving their hand to the mouse.
 React.useEffect(() => {
 const onKey = (e) => {
 if (e.key === 'Escape') {
 handleSkip();
 return;
 }
 if (e.key === 'ArrowRight') {
 e.preventDefault();
 if (isLast) handleDone(); else setStepIdx((i) => i + 1);
 }
 if (e.key === 'ArrowLeft' && !isFirst) {
 e.preventDefault();
 setStepIdx((i) => i - 1);
 }
 };
 document.addEventListener('keydown', onKey);
 return () => document.removeEventListener('keydown', onKey);
 }, [isLast, isFirst]); // eslint-disable-line react-hooks/exhaustive-deps

 // Caption card positioning — same algorithm as the brownfield.
 const captionPos = (() => {
 if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
 const cardW = 320;
 const cardH = 200;
 const margin = 16;
 const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
 const vh = typeof window !== 'undefined' ? window.innerHeight : 900;

 if (rect.top + rect.height + margin + cardH < vh) {
 const left = Math.max(margin, Math.min(vw - cardW - margin, rect.left + rect.width / 2 - cardW / 2));
 return { top: rect.top + rect.height + margin, left };
 }
 if (rect.top - cardH - margin > 0) {
 const left = Math.max(margin, Math.min(vw - cardW - margin, rect.left + rect.width / 2 - cardW / 2));
 return { top: rect.top - cardH - margin, left };
 }
 if (rect.left + rect.width + margin + cardW < vw) {
 const top = Math.max(margin, Math.min(vh - cardH - margin, rect.top + rect.height / 2 - cardH / 2));
 return { top, left: rect.left + rect.width + margin };
 }
 const top = Math.max(margin, Math.min(vh - cardH - margin, rect.top + rect.height / 2 - cardH / 2));
 return { top, left: Math.max(margin, rect.left - cardW - margin) };
 })();

 const dim = 'rgba(24,20,16,0.55)';
 // Pad so the dashed frame sits cleanly — same as brownfield.
 const PAD = 6;

 // The spotlight transition. Honor prefers-reduced-motion.
 const spotlightStyle = (extra) => ({
 ...extra,
 transition: prefersReducedMotion ? 'none' : undefined,
 });

 return ReactDOM.createPortal(
 <div
 data-testid="walkthrough-overlay"
 style={{
 position: 'fixed', inset: 0, zIndex: 200,
 pointerEvents: 'none',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 }}
 >
 {/* 4-strip dim backdrop — cutout lets clicks pass through to the spotlight target. */}
 {rect ? (
 <React.Fragment>
 <div style={spotlightStyle({ position: 'absolute', top: 0, left: 0, right: 0, height: Math.max(0, rect.top - PAD), background: dim, pointerEvents: 'auto' })} onClick={advance} />
 <div style={spotlightStyle({ position: 'absolute', top: rect.top + rect.height + PAD, left: 0, right: 0, bottom: 0, background: dim, pointerEvents: 'auto' })} onClick={advance} />
 <div style={spotlightStyle({ position: 'absolute', top: rect.top - PAD, left: 0, width: Math.max(0, rect.left - PAD), height: rect.height + PAD * 2, background: dim, pointerEvents: 'auto' })} onClick={advance} />
 <div style={spotlightStyle({ position: 'absolute', top: rect.top - PAD, left: rect.left + rect.width + PAD, right: 0, height: rect.height + PAD * 2, background: dim, pointerEvents: 'auto' })} onClick={advance} />
 {/* Sienna spotlight ring — flat: an accent glow ring (box-shadow), no border. Visual only, no pointer events. */}
 <div style={{
 position: 'absolute',
 top: rect.top - PAD,
 left: rect.left - PAD,
 width: rect.width + PAD * 2,
 height: rect.height + PAD * 2,
 borderRadius: 10,
 pointerEvents: 'none',
 boxShadow: '0 0 0 2px var(--lm-accent, #B85B33), 0 0 0 6px rgba(184,91,51,0.18), 0 0 28px rgba(184,91,51,0.32)',
 transition: prefersReducedMotion ? 'none' : 'top 120ms ease, left 120ms ease, width 120ms ease, height 120ms ease',
 }} />
 </React.Fragment>
 ) : (
 // No target → full-screen dim.
 <div style={{ position: 'absolute', inset: 0, background: dim, pointerEvents: 'auto' }} onClick={advance} />
 )}

 {/* Caption or Done card */}
 {step.isDone ? (
 <WalkthroughDoneCard
 stepIdx={stepIdx}
 total={total}
 onBack={() => setStepIdx((i) => i - 1)}
 onClose={handleDone}
 prefersReducedMotion={prefersReducedMotion}
 />
 ) : (
 <WalkthroughCaptionCard
 step={step}
 stepIdx={stepIdx}
 total={total}
 isFirst={isFirst}
 isLast={isLast}
 captionPos={captionPos}
 prefersReducedMotion={prefersReducedMotion}
 onBack={() => setStepIdx((i) => i - 1)}
 onNext={advance}
 onSkip={handleSkip}
 />
 )}
 </div>,
 document.body,
 );
}

// ── WalkthroughOffer ─────────────────────────────────────────────────────────
// Calm "Take the tour?" dock notice. Shown after the first canvas render for
// first-ever visitors. Not intrusive — can be dismissed with No or Esc.

/**
 * @param {object} props
 * @param {() => void} props.onAccept Called when the user clicks "Yes".
 * @param {() => void} props.onDecline Called when the user clicks "No" or presses Esc.
 */
export function WalkthroughOffer({ onAccept, onDecline }) {
 const containerRef = React.useRef(null);

 // Esc to dismiss.
 React.useEffect(() => {
 const onKey = (e) => { if (e.key === 'Escape') onDecline(); };
 document.addEventListener('keydown', onKey);
 return () => document.removeEventListener('keydown', onKey);
 }, [onDecline]);

 // Focus the "Yes" button on mount so keyboard users can accept immediately.
 React.useEffect(() => {
 const yes = containerRef.current?.querySelector('[data-testid="offer-yes"]');
 if (yes) yes.focus();
 }, []);

 return (
 <div
 ref={containerRef}
 role="dialog"
 aria-label="Take the tour?"
 data-testid="walkthrough-offer"
 style={{
 position: 'fixed',
 bottom: 80, // sits above the dock (bottom: 18 + ~44 dock height + gap)
 left: '50%',
 transform: 'translateX(-50%)',
 zIndex: 100,
 background: 'var(--lm-surface, rgba(255,255,255,0.95))',
 backdropFilter: 'blur(14px) saturate(120%)',
 WebkitBackdropFilter: 'blur(14px) saturate(120%)',
 borderRadius: 12,
 padding: '12px 16px',
 boxShadow: 'var(--lm-shadow-lg, 0 8px 24px rgba(26,23,20,0.16))',
 display: 'flex',
 alignItems: 'center',
 gap: 12,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 whiteSpace: 'nowrap',
 }}
 >
 <span style={{ fontSize: 13, color: 'var(--lm-text-secondary, #3A3530)' }}>
 First time here? Take the quick tour.
 </span>
 <button
 type="button"
 className="lm-focusable"
 data-testid="offer-yes"
 onClick={onAccept}
 style={tourBtnPrimary}
 >Yes, show me</button>
 <button
 type="button"
 className="lm-focusable"
 data-testid="offer-no"
 onClick={onDecline}
 style={tourBtnGhost}
 >No thanks</button>
 </div>
 );
}

export default StudioWalkthroughOverlay;
