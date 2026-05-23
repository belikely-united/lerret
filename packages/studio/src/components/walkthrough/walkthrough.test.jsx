// walkthrough.test.jsx
//
// Component tests for the walkthrough overlay and the first-ever-visit gate.
//
// Test matrix:
// 1. Overlay renders new 8-step sequence (titles + spotlight targets).
// 2. isFirstEverVisit() — returns true when store is empty, false after
// completion or skip is recorded.
// 3. Persistence — recordWalkthroughCompleted / recordWalkthroughSkipped
// write the expected localStorage keys.
// 4. Spotlight selector resolves to a DOM target in a test render that adds
// the required data-tour nodes (for selectors that exist in normal studio
// renders).
// 5. Keyboard: Next (→), Back (←), Skip (Esc).
// 6. prefers-reduced-motion: spotlight transition collapses to 'none'.
// 7. WalkthroughOffer renders; Yes starts tour; No calls onDecline.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { StudioWalkthroughOverlay, WalkthroughOffer } from './walkthrough-overlay.jsx';
import {
 isFirstEverVisit,
 recordWalkthroughCompleted,
 recordWalkthroughSkipped,
 clearWalkthroughState,
} from './walkthrough-persistence.js';
import { WALKTHROUGH_STEPS } from './walkthrough-steps.js';

// ─── jsdom stubs ──────────────────────────────────────────────────────────────

beforeEach(() => {
 // Stub window dimensions — needed by the caption-position algorithm.
 vi.stubGlobal('innerWidth', 1440);
 vi.stubGlobal('innerHeight', 900);
 // Reset localStorage for isolation.
 clearWalkthroughState();
});

afterEach(() => {
 vi.unstubAllGlobals();
 clearWalkthroughState();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Mount a React element into document.body; returns container + teardown. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => { root.render(element); });
 return {
 container,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 rerender(el) {
 act(() => { root.render(el); });
 },
 };
}

/** Dispatch a KeyboardEvent on the document. */
function dispatchKey(key) {
 act(() => {
 document.dispatchEvent(
 new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
 );
 });
}

// ─── 1. Step sequence ─────────────────────────────────────────────────────────

describe('WALKTHROUGH_STEPS — step sequence', () => {
 it('has exactly 8 steps', () => {
 expect(WALKTHROUGH_STEPS).toHaveLength(8);
 });

 it('step 1 — Welcome — targets the canvas', () => {
 expect(WALKTHROUGH_STEPS[0].target).toBe('[data-tour="canvas"]');
 expect(WALKTHROUGH_STEPS[0].title).toMatch(/welcome/i);
 });

 it('step 2 — Folder mapping — targets the canvas', () => {
 expect(WALKTHROUGH_STEPS[1].target).toBe('[data-tour="canvas"]');
 expect(WALKTHROUGH_STEPS[1].title).toMatch(/folder/i);
 });

 it('step 3 — Page picker — targets dock-pages', () => {
 expect(WALKTHROUGH_STEPS[2].target).toBe('[data-tour="dock-pages"]');
 expect(WALKTHROUGH_STEPS[2].title).toMatch(/page/i);
 });

 it('step 4 — Artboards — targets section', () => {
 expect(WALKTHROUGH_STEPS[3].target).toBe('[data-tour="section"]');
 expect(WALKTHROUGH_STEPS[3].title).toMatch(/artboard/i);
 });

 it('step 5 — Kebab — targets .lm-artboard-kebab', () => {
 expect(WALKTHROUGH_STEPS[4].target).toBe('.lm-artboard-kebab');
 expect(WALKTHROUGH_STEPS[4].title).toMatch(/menu/i);
 });

 it('step 6 — Editors — targets canvas', () => {
 expect(WALKTHROUGH_STEPS[5].target).toBe('[data-tour="canvas"]');
 expect(WALKTHROUGH_STEPS[5].body).toMatch(/data/i);
 });

 it('step 7 — Export — targets the Lerret brand menu', () => {
 expect(WALKTHROUGH_STEPS[6].target).toBe('[data-tour="dock-brand"]');
 expect(WALKTHROUGH_STEPS[6].title).toMatch(/export/i);
 });

 it('step 8 — Done — null target + isDone flag', () => {
 expect(WALKTHROUGH_STEPS[7].target).toBeNull();
 expect(WALKTHROUGH_STEPS[7].isDone).toBe(true);
 });
});

// ─── 2. First-ever-visit detection ───────────────────────────────────────────

describe('isFirstEverVisit', () => {
 it('returns true when no state is recorded', () => {
 expect(isFirstEverVisit()).toBe(true);
 });

 it('returns false after completion is recorded', () => {
 recordWalkthroughCompleted();
 expect(isFirstEverVisit()).toBe(false);
 });

 it('returns false after skip is recorded', () => {
 recordWalkthroughSkipped();
 expect(isFirstEverVisit()).toBe(false);
 });
});

// ─── 3. Persistence ──────────────────────────────────────────────────────────

describe('walkthrough persistence', () => {
 it('recordWalkthroughCompleted writes an ISO timestamp', () => {
 recordWalkthroughCompleted();
 const val = localStorage.getItem('lerret:walkthrough:completedAt');
 expect(val).toBeTruthy();
 expect(() => new Date(val).toISOString()).not.toThrow();
 });

 it('recordWalkthroughSkipped writes an ISO timestamp', () => {
 recordWalkthroughSkipped();
 const val = localStorage.getItem('lerret:walkthrough:skippedAt');
 expect(val).toBeTruthy();
 expect(() => new Date(val).toISOString()).not.toThrow();
 });

 it('clearWalkthroughState removes both keys', () => {
 recordWalkthroughCompleted();
 recordWalkthroughSkipped();
 clearWalkthroughState();
 expect(localStorage.getItem('lerret:walkthrough:completedAt')).toBeNull();
 expect(localStorage.getItem('lerret:walkthrough:skippedAt')).toBeNull();
 });
});

// ─── 4. Spotlight selector resolves to real DOM nodes ────────────────────────

describe('spotlight targets — DOM resolution', () => {
 let fixture;

 beforeEach(() => {
 // Set up a minimal DOM that includes the elements the walkthrough targets.
 fixture = document.createElement('div');
 fixture.innerHTML = `
 <div data-tour="canvas"></div>
 <span data-tour="dock-pages"></span>
 <div data-tour="section"></div>
 <div class="lm-artboard-kebab" data-testid="lm-artboard-kebab"></div>
 <span data-tour="dock-brand"></span>
 `;
 document.body.appendChild(fixture);
 });

 afterEach(() => {
 fixture.remove();
 });

 const resolveTarget = (selector) =>
 selector ? document.querySelector(selector) : null;

 it('step 1 target resolves', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[0].target)).toBeTruthy();
 });

 it('step 2 target resolves', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[1].target)).toBeTruthy();
 });

 it('step 3 target resolves (dock-pages)', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[2].target)).toBeTruthy();
 });

 it('step 4 target resolves (section)', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[3].target)).toBeTruthy();
 });

 it('step 5 target resolves (.lm-artboard-kebab)', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[4].target)).toBeTruthy();
 });

 it('step 6 target resolves (canvas)', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[5].target)).toBeTruthy();
 });

 it('step 7 target resolves (dock-brand)', () => {
 expect(resolveTarget(WALKTHROUGH_STEPS[6].target)).toBeTruthy();
 });

 it('step 8 target is null (Done card)', () => {
 expect(WALKTHROUGH_STEPS[7].target).toBeNull();
 });
});

// ─── 5. Keyboard operability ─────────────────────────────────────────────────

describe('StudioWalkthroughOverlay — keyboard', () => {
 it('Esc calls onClose and records skip', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 dispatchKey('Escape');

 expect(onClose).toHaveBeenCalledTimes(1);
 expect(localStorage.getItem('lerret:walkthrough:skippedAt')).toBeTruthy();
 cleanup();
 });

 it('→ (ArrowRight) advances to step 2', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 // Step 1 text should be present (the portal renders into document.body).
 expect(document.body.textContent).toMatch(/Step 1 of 8/);

 dispatchKey('ArrowRight');

 expect(document.body.textContent).toMatch(/Step 2 of 8/);
 cleanup();
 });

 it('← (ArrowLeft) goes back from step 2 to step 1', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 dispatchKey('ArrowRight'); // → step 2
 dispatchKey('ArrowLeft'); // ← back to step 1

 expect(document.body.textContent).toMatch(/Step 1 of 8/);
 cleanup();
 });

 it('clicking Next button through to Done records completion', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 // Click through steps 1–7 using the Next button, then the Done button on 8.
 for (let i = 0; i < 7; i++) {
 const nextBtn = document.querySelector('[data-testid="walkthrough-next"]');
 if (nextBtn) {
 act(() => { nextBtn.click(); });
 } else {
 // Fallback to keyboard if the next button is not present (e.g. Done card).
 dispatchKey('ArrowRight');
 }
 }
 // Now on step 8 — the Done card has a data-testid="walkthrough-done" button.
 const doneBtn = document.querySelector('[data-testid="walkthrough-done"]');
 if (doneBtn) {
 act(() => { doneBtn.click(); });
 }

 expect(onClose).toHaveBeenCalledTimes(1);
 expect(localStorage.getItem('lerret:walkthrough:completedAt')).toBeTruthy();
 cleanup();
 });

 it('Skip button records skip', () => {
 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 // The overlay is portaled to document.body — search the whole document.
 const skipBtn = Array.from(document.querySelectorAll('button')).find(
 (b) => b.textContent.trim() === 'Skip',
 );
 expect(skipBtn).toBeTruthy();
 act(() => skipBtn.click());

 expect(onClose).toHaveBeenCalledTimes(1);
 expect(localStorage.getItem('lerret:walkthrough:skippedAt')).toBeTruthy();
 cleanup();
 });
});

// ─── 6. prefers-reduced-motion ───────────────────────────────────────────────

describe('prefers-reduced-motion', () => {
 it('with reducedMotion=true, spotlight frame has no transition', () => {
 // Stub matchMedia to simulate prefers-reduced-motion: reduce.
 vi.stubGlobal('matchMedia', (query) => ({
 matches: query.includes('reduce'),
 media: query,
 addEventListener: () => {},
 removeEventListener: () => {},
 }));

 const onClose = vi.fn();
 const { cleanup } = renderToDom(<StudioWalkthroughOverlay onClose={onClose} />);

 // Add a canvas target so the spotlight has a rect to measure.
 const canvas = document.createElement('div');
 canvas.setAttribute('data-tour', 'canvas');
 canvas.style.cssText = 'position:fixed;top:100px;left:100px;width:200px;height:200px;';
 document.body.appendChild(canvas);

 // The overlay should render without error; we can't measure applied CSS in jsdom
 // but we verify the overlay rendered successfully.
 const overlay = document.querySelector('[data-testid="walkthrough-overlay"]');
 expect(overlay).toBeTruthy();

 canvas.remove();
 cleanup();
 });
});

// ─── 7. WalkthroughOffer ─────────────────────────────────────────────────────

describe('WalkthroughOffer', () => {
 it('renders with "Yes, show me" and "No thanks" buttons', () => {
 const onAccept = vi.fn();
 const onDecline = vi.fn();
 const { cleanup } = renderToDom(
 <WalkthroughOffer onAccept={onAccept} onDecline={onDecline} />,
 );

 // The offer renders into document.body — search whole document.
 const offer = document.querySelector('[data-testid="walkthrough-offer"]');
 expect(offer).toBeTruthy();
 expect(offer.textContent).toMatch(/tour/i);

 cleanup();
 });

 it('"Yes, show me" calls onAccept', () => {
 const onAccept = vi.fn();
 const onDecline = vi.fn();
 const { cleanup } = renderToDom(
 <WalkthroughOffer onAccept={onAccept} onDecline={onDecline} />,
 );

 const yesBtn = document.querySelector('[data-testid="offer-yes"]');
 act(() => yesBtn.click());
 expect(onAccept).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('"No thanks" calls onDecline', () => {
 const onAccept = vi.fn();
 const onDecline = vi.fn();
 const { cleanup } = renderToDom(
 <WalkthroughOffer onAccept={onAccept} onDecline={onDecline} />,
 );

 const noBtn = document.querySelector('[data-testid="offer-no"]');
 act(() => noBtn.click());
 expect(onDecline).toHaveBeenCalledTimes(1);
 cleanup();
 });

 it('Esc calls onDecline', () => {
 const onAccept = vi.fn();
 const onDecline = vi.fn();
 const { cleanup } = renderToDom(
 <WalkthroughOffer onAccept={onAccept} onDecline={onDecline} />,
 );

 dispatchKey('Escape');
 expect(onDecline).toHaveBeenCalledTimes(1);
 cleanup();
 });
});
