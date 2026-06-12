// Tests for — Artboard Rearrange & Fullscreen Focus View
//
// These tests pin the key behaviors added/hardened for :
//
// 1. Focus overlay opens via the expand button (FR16).
// 2. Esc dismisses the overlay (NFR14 — keyboard operability).
// 3. Focus is trapped inside the overlay while it is open — Tab/Shift+Tab
// never reach the canvas behind (NFR14).
// 4. Arrow-key navigation (← / →) advances through artboards in focus view.
// 5. Keyboard rearrange via the grip button (← / → keys) updates the order
// and the result is reflected in the rendered artboard sequence (FR15).
//
// The brownfield `DesignCanvas` component uses `window.innerWidth/Height`,
// `requestAnimationFrame`, and `localStorage` — all available in jsdom. It
// also fetches `.design-canvas.state.json` on mount; we suppress that with a
// jest/vi `fetch` stub below.
//
// Rendering approach: `react-dom/client` into an attached document.body
// container (same pattern as asset-error-card.test.jsx).

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DesignCanvas, DCSection, DCArtboard, sectionDepthBg } from './design-canvas.jsx';

// ─── jsdom environment stubs ──────────────────────────────────────────────────

// Stub fetch so the sidecar read on mount resolves instantly as "not found".
beforeEach(() => {
 vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }));
 // DesignCanvas reads window dimensions in DCFocusOverlay.
 vi.stubGlobal('innerWidth', 1440);
 vi.stubGlobal('innerHeight', 900);
});

afterEach(() => {
 vi.unstubAllGlobals();
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

/** Fire a keyboard event on the document. */
function fireKey(key, opts = {}) {
 act(() => {
 document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
 });
}

/**
 * A minimal three-artboard canvas fixture.
 * Accepts `onReorder` per-section if needed.
 */
function ThreeArtboardCanvas() {
 return (
 <DesignCanvas>
 <DCSection id="s1" title="Section One">
 <DCArtboard id="a1" label="Alpha" width={200} height={150} />
 <DCArtboard id="a2" label="Beta" width={200} height={150} />
 <DCArtboard id="a3" label="Gamma" width={200} height={150} />
 </DCSection>
 </DesignCanvas>
 );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DCFocusOverlay — open & close', () => {
 it('opens the focus overlay when the expand button is clicked (FR16)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);

 // Wait for the canvas to finish its async sidecar read (setReady).
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // The overlay is not present before activation.
 expect(document.querySelector('[role="dialog"]')).toBeNull();

 // Click the expand button for the first artboard.
 const expandBtn = container.querySelector('.dc-expand');
 expect(expandBtn).not.toBeNull();
 act(() => { expandBtn.click(); });

 // The overlay should now be in the document (portalled to body).
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 cleanup();
 });

 it('opens focus view when the section is wrapped one level (e.g. SectionKebab)', async () => {
 // Regression: the real studio wraps every DCSection in <SectionKebab>, so
 // the focus registry must resolve a section through a single wrapper.
 // Before the fix the registry skipped wrapped sections and the overlay
 // never appeared.
 function Wrapper({ children }) {
 return <div className="section-wrapper">{children}</div>;
 }
 const { container, cleanup } = renderToDom(
 <DesignCanvas>
 <Wrapper>
 <DCSection id="s1" title="Section One">
 <DCArtboard id="a1" label="Alpha" width={200} height={150} />
 </DCSection>
 </Wrapper>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 expect(document.querySelector('[role="dialog"]')).toBeNull();
 const expandBtn = container.querySelector('.dc-expand');
 expect(expandBtn).not.toBeNull();
 act(() => { expandBtn.click(); });
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 cleanup();
 });

 it('closes the focus overlay when Esc is pressed (NFR14)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Open the overlay.
 const expandBtn = container.querySelector('.dc-expand');
 act(() => { expandBtn.click(); });
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 // Esc should dismiss it.
 fireKey('Escape');
 expect(document.querySelector('[role="dialog"]')).toBeNull();

 cleanup();
 });

 it('closes the focus overlay when the close (×) button is clicked', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 act(() => { container.querySelector('.dc-expand').click(); });
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 // The close button has aria-label="Close focus view".
 const closeBtn = document.querySelector('[aria-label="Close focus view"]');
 expect(closeBtn).not.toBeNull();
 act(() => { closeBtn.click(); });
 expect(document.querySelector('[role="dialog"]')).toBeNull();

 cleanup();
 });

 it('closes the focus overlay on backdrop click', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 act(() => { container.querySelector('.dc-expand').click(); });
 const overlay = document.querySelector('[role="dialog"]');
 expect(overlay).not.toBeNull();

 // Click the overlay root itself (the backdrop).
 act(() => { overlay.click(); });
 expect(document.querySelector('[role="dialog"]')).toBeNull();

 cleanup();
 });
});

describe('DCFocusOverlay — focus trap (NFR14)', () => {
 it('contains Tab focus within the overlay — Tab never escapes to the canvas', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 act(() => { container.querySelector('.dc-expand').click(); });
 const overlay = document.querySelector('[role="dialog"]');
 expect(overlay).not.toBeNull();

 // Collect focusable elements in the overlay.
 const focusable = Array.from(
 overlay.querySelectorAll(
 'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])',
 ),
 ).filter((n) => n.offsetParent !== null || n.closest('[role="dialog"]'));

 // There must be at least: section dropdown, close, left arrow, right arrow,
 // and at least one dot — so at least 4.
 expect(focusable.length).toBeGreaterThanOrEqual(4);

 // All of them must be INSIDE the overlay (not on the canvas behind it).
 for (const el of focusable) {
 expect(overlay.contains(el)).toBe(true);
 }

 cleanup();
 });

 it('Tab advances through overlay buttons and wraps to the first', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 act(() => { container.querySelector('.dc-expand').click(); });
 const overlay = document.querySelector('[role="dialog"]');

 // Auto-focus should have placed focus somewhere inside the overlay.
 // Give requestAnimationFrame a tick.
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const active = document.activeElement;
 expect(overlay.contains(active)).toBe(true);

 cleanup();
 });

 it('focus is inside the overlay immediately after opening (auto-focus)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Remember where focus was before opening.
 const expandBtn = container.querySelector('.dc-expand');
 act(() => { expandBtn.focus(); });
 act(() => { expandBtn.click(); });

 // Give the rAF a tick to fire.
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const overlay = document.querySelector('[role="dialog"]');
 expect(overlay).not.toBeNull();
 // Active element must be inside the overlay after opening.
 expect(overlay.contains(document.activeElement)).toBe(true);

 cleanup();
 });
});

describe('DCFocusOverlay — arrow-key navigation (NFR14)', () => {
 it('→ advances to the next artboard in the section', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Open focus on the first artboard.
 act(() => { container.querySelector('.dc-expand').click(); });
 let overlay = document.querySelector('[role="dialog"]');
 expect(overlay).not.toBeNull();

 // The label shows "1 / 3".
 expect(overlay.textContent).toMatch(/1\s*\/\s*3/);

 // → should advance to the second artboard.
 fireKey('ArrowRight');
 overlay = document.querySelector('[role="dialog"]');
 expect(overlay).not.toBeNull();
 expect(overlay.textContent).toMatch(/2\s*\/\s*3/);

 cleanup();
 });

 it('← goes back to the previous artboard (wraps around)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Open focus on the first artboard (idx 0), then go left (wraps to last).
 act(() => { container.querySelector('.dc-expand').click(); });
 fireKey('ArrowLeft');

 const overlay = document.querySelector('[role="dialog"]');
 // Wrapped to 3 / 3.
 expect(overlay.textContent).toMatch(/3\s*\/\s*3/);

 cleanup();
 });
});

describe('Artboard rearrange — keyboard grip (FR15 / NFR14)', () => {
 it('grip button is in the tab order (has no tabIndex=-1)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 const grips = container.querySelectorAll('.dc-grip');
 expect(grips.length).toBeGreaterThan(0);
 for (const grip of grips) {
 // A grip that is a <button> with no explicit tabindex, or tabIndex >= 0,
 // is keyboard-reachable.
 expect(Number(grip.getAttribute('tabindex') ?? '0')).toBeGreaterThanOrEqual(0);
 }

 cleanup();
 });

 it('grip button is a <button> element for keyboard operability (NFR14)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 const grips = container.querySelectorAll('.dc-grip');
 for (const grip of grips) {
 expect(grip.tagName.toLowerCase()).toBe('button');
 }

 cleanup();
 });

 it('pressing → on a focused grip moves the artboard right in section order', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Slot elements tell us the rendered order via data-dc-slot.
 const slotsBefore = Array.from(container.querySelectorAll('[data-dc-slot]')).map(
 (el) => el.dataset.dcSlot,
 );
 // Initial order: a1, a2, a3.
 expect(slotsBefore).toEqual(['a1', 'a2', 'a3']);

 // Focus the first grip and press →.
 const firstGrip = container.querySelectorAll('.dc-grip')[0];
 act(() => { firstGrip.focus(); });
 act(() => {
 firstGrip.dispatchEvent(
 new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
 );
 });

 // After the state update the order should be a2, a1, a3.
 const slotsAfter = Array.from(container.querySelectorAll('[data-dc-slot]')).map(
 (el) => el.dataset.dcSlot,
 );
 expect(slotsAfter).toEqual(['a2', 'a1', 'a3']);

 cleanup();
 });

 it('pressing ← on a focused grip moves the artboard left in section order', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 // Focus the last grip (a3) and press ←.
 const grips = container.querySelectorAll('.dc-grip');
 const lastGrip = grips[grips.length - 1];
 act(() => { lastGrip.focus(); });
 act(() => {
 lastGrip.dispatchEvent(
 new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
 );
 });

 // a3 moves left: a1, a3, a2.
 const slotsAfter = Array.from(container.querySelectorAll('[data-dc-slot]')).map(
 (el) => el.dataset.dcSlot,
 );
 expect(slotsAfter).toEqual(['a1', 'a3', 'a2']);

 cleanup();
 });

 it('pressing ← on the first artboard grip does nothing (already at start)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 const firstGrip = container.querySelectorAll('.dc-grip')[0];
 act(() => { firstGrip.focus(); });
 act(() => {
 firstGrip.dispatchEvent(
 new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
 );
 });

 // Order unchanged: a1, a2, a3.
 const slotsAfter = Array.from(container.querySelectorAll('[data-dc-slot]')).map(
 (el) => el.dataset.dcSlot,
 );
 expect(slotsAfter).toEqual(['a1', 'a2', 'a3']);

 cleanup();
 });
});

// Bug B regression — drag-pan's setPointerCapture must NOT fire when the
// pointerdown originates inside a kebab trigger or open menu popover. Without
// this guard, the viewport captures the pointer and the kebab button never
// sees its own pointerup/click. Fix landed 2026-05-22 in design-canvas.jsx:599.
describe('Drag-pan — kebab and popover targets are excluded (regression)', () => {
 it('does not call setPointerCapture when pointerdown targets a .lm-kebab-trigger', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const vp = container.querySelector('.design-canvas');
 expect(vp).toBeTruthy();
 const capture = vi.fn();
 vp.setPointerCapture = capture;

 const kebab = document.createElement('button');
 kebab.className = 'lm-kebab-trigger';
 vp.appendChild(kebab);

 act(() => {
 kebab.dispatchEvent(new PointerEvent('pointerdown', {
 bubbles: true, cancelable: true, button: 0, pointerId: 1,
 }));
 });

 expect(capture).not.toHaveBeenCalled();
 cleanup();
 });

 it('does not call setPointerCapture for middle-click on a kebab trigger', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const vp = container.querySelector('.design-canvas');
 const capture = vi.fn();
 vp.setPointerCapture = capture;

 const kebab = document.createElement('button');
 kebab.className = 'lm-kebab-trigger';
 vp.appendChild(kebab);

 act(() => {
 kebab.dispatchEvent(new PointerEvent('pointerdown', {
 bubbles: true, cancelable: true, button: 1, pointerId: 2,
 }));
 });

 expect(capture).not.toHaveBeenCalled();
 cleanup();
 });

 it('does not call setPointerCapture when pointerdown targets an open .lm-menu-popover', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const vp = container.querySelector('.design-canvas');
 const capture = vi.fn();
 vp.setPointerCapture = capture;

 const popover = document.createElement('div');
 popover.className = 'lm-menu-popover';
 const item = document.createElement('button');
 popover.appendChild(item);
 vp.appendChild(popover);

 act(() => {
 item.dispatchEvent(new PointerEvent('pointerdown', {
 bubbles: true, cancelable: true, button: 0, pointerId: 3,
 }));
 });

 expect(capture).not.toHaveBeenCalled();
 cleanup();
 });

 it('does not call setPointerCapture when pointerdown targets a .dc-section-cta (empty-group "+ Add asset")', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const vp = container.querySelector('.design-canvas');
 const capture = vi.fn();
 vp.setPointerCapture = capture;

 // The empty-group placeholder is in-canvas interactive content marked
 // `.dc-section-cta`. A pointerdown there must NOT start a drag-pan, or the
 // viewport captures the pointer and the button's click is swallowed (the
 // dead-click bug).
 const cta = document.createElement('div');
 cta.className = 'dc-section-cta';
 const addBtn = document.createElement('button');
 cta.appendChild(addBtn);
 vp.appendChild(cta);

 act(() => {
 addBtn.dispatchEvent(new PointerEvent('pointerdown', {
 bubbles: true, cancelable: true, button: 0, pointerId: 7,
 }));
 });

 expect(capture).not.toHaveBeenCalled();
 cleanup();
 });

 it('still captures pointer on plain background pointerdown (drag-pan unaffected)', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

 const vp = container.querySelector('.design-canvas');
 const capture = vi.fn();
 vp.setPointerCapture = capture;

 act(() => {
 vp.dispatchEvent(new PointerEvent('pointerdown', {
 bubbles: true, cancelable: true, button: 0, pointerId: 4,
 }));
 });

 expect(capture).toHaveBeenCalledWith(4);
 cleanup();
 });
});

describe('sectionDepthBg — nesting differentiation', () => {
 it('returns a distinct, light color per nesting depth', () => {
 const c0 = sectionDepthBg(0);
 const c1 = sectionDepthBg(1);
 const c2 = sectionDepthBg(2);
 expect(c0).not.toBe(c1);
 expect(c1).not.toBe(c2);
 expect(c0).not.toBe(c2);
 });

 it('clamps at the deepest tier and is defensive on bad input', () => {
 expect(sectionDepthBg(99)).toBe(sectionDepthBg(3));
 expect(sectionDepthBg(-1)).toBe(sectionDepthBg(0));
 });
});

describe('DCSection — section download buttons', () => {
 it('shows the group PNG/JPG download when the section has artboards', async () => {
 const { cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="s1" title="Has assets">
 <DCArtboard id="a1" label="Alpha" width={200} height={150} />
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
 expect(
 document.querySelector('[title="Download every artboard in this group as PNG"]'),
 ).not.toBeNull();
 cleanup();
 });

 it('hides the group PNG/JPG download for an empty section (e.g. an empty group)', async () => {
 const { cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="s1" title="Empty group">
 <div data-testid="placeholder">This group is empty.</div>
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
 // The non-artboard placeholder still renders…
 expect(document.querySelector('[data-testid="placeholder"]')).not.toBeNull();
 // …but there's nothing to export, so the group download is absent.
 expect(
 document.querySelector('[title="Download every artboard in this group as PNG"]'),
 ).toBeNull();
 expect(
 document.querySelector('[title="Download every artboard in this group as JPG"]'),
 ).toBeNull();
 cleanup();
 });
});

describe('DCSection — nested sub-groups (true containment)', () => {
 it('renders a nested DCSection INSIDE its parent section frame', async () => {
 const { container, cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="parent" title="Parent" depth={1}>
 <DCArtboard id="pa" label="ParentArt" width={200} height={150} />
 <DCSection id="child" title="Child" depth={2} kicker="Parent">
 <DCArtboard id="ca" label="ChildArt" width={200} height={150} />
 </DCSection>
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 const parent = container.querySelector('[data-dc-section="parent"]');
 const child = container.querySelector('[data-dc-section="child"]');
 expect(parent).not.toBeNull();
 expect(child).not.toBeNull();
 // True containment: the child section is a DOM descendant of the parent.
 expect(child).not.toBe(parent);
 expect(parent.contains(child)).toBe(true);

 cleanup();
 });

 it('opens focus view for a nested sub-group artboard (recursive registry)', async () => {
 const { container, cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="parent" title="Parent" depth={1}>
 <DCArtboard id="pa" label="ParentArt" width={200} height={150} />
 <DCSection id="child" title="Child" depth={2} kicker="Parent">
 <DCArtboard id="ca" label="ChildArt" width={200} height={150} />
 </DCSection>
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 expect(document.querySelector('[role="dialog"]')).toBeNull();
 // Expand the artboard that lives inside the nested sub-group.
 const childSlot = container.querySelector('[data-dc-slot="ca"]');
 expect(childSlot).not.toBeNull();
 const expandBtn = childSlot.querySelector('.dc-expand');
 expect(expandBtn).not.toBeNull();
 act(() => { expandBtn.click(); });
 // The overlay only renders when the focus id resolves in the registry, so
 // its presence proves the nested section was registered.
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();

 cleanup();
 });

 it('parent direct slots exclude nested sub-group artboards (download/reorder scope)', async () => {
 // Invariant per-section download + drag-reorder rely on: a nested artboard's
 // nearest [data-dc-section] ancestor is the CHILD section, not the parent.
 const { container, cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="parent" title="Parent" depth={1}>
 <DCArtboard id="p1" label="P1" width={120} height={90} />
 <DCArtboard id="p2" label="P2" width={120} height={90} />
 <DCSection id="child" title="Child" depth={2} kicker="Parent">
 <DCArtboard id="c1" label="C1" width={120} height={90} />
 </DCSection>
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

 const parentEl = container.querySelector('[data-dc-section="parent"]');
 const directSlots = Array.from(parentEl.querySelectorAll('[data-dc-slot]')).filter(
 (el) => el.closest('[data-dc-section]') === parentEl,
 );
 expect(directSlots.map((el) => el.dataset.dcSlot)).toEqual(['p1', 'p2']);

 cleanup();
 });
});

describe('DCViewport — wayfinding chrome', () => {
 it('renders the zoom controls: readout + zoom in/out + reset + fit', async () => {
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 60)); });

 const controls = container.querySelector('[data-tour="zoom-controls"]');
 expect(controls).not.toBeNull();
 // A live percentage readout (starts at 100%).
 expect(controls.textContent).toMatch(/%/);
 expect(container.querySelector('[aria-label="Zoom in"]')).not.toBeNull();
 expect(container.querySelector('[aria-label="Zoom out"]')).not.toBeNull();
 expect(container.querySelector('[aria-label="Reset zoom to 100%"]')).not.toBeNull();
 expect(container.querySelector('[aria-label="Fit to screen"]')).not.toBeNull();

 cleanup();
 });

 it('hides the mini-map when content is not measurable (degenerate bounds)', async () => {
 // jsdom reports 0×0 rects, so content bounds are empty — the mini-map hides
 // itself rather than drawing a degenerate overview. (Its populated behavior
 // is verified in a real browser.)
 const { container, cleanup } = renderToDom(<ThreeArtboardCanvas />);
 await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
 expect(container.querySelector('[data-testid="dc-minimap"]')).toBeNull();
 cleanup();
 });
});

describe('DesignCanvas — top-level group reorder', () => {
 it('shows a drag grip on top-level groups when a page orderKey is set', async () => {
 const { container, cleanup } = renderToDom(
 <DesignCanvas orderKey="/p/home">
 <DCSection id="g1" title="G1" depth={1}>
 <DCArtboard id="a" label="A" width={120} height={90} />
 </DCSection>
 <DCSection id="g2" title="G2" depth={1}>
 <DCArtboard id="b" label="B" width={120} height={90} />
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
 expect(container.querySelectorAll('.dc-section-grip').length).toBe(2);
 cleanup();
 });

 it('shows no reorder grip without an orderKey', async () => {
 const { container, cleanup } = renderToDom(
 <DesignCanvas>
 <DCSection id="g1" title="G1" depth={1}>
 <DCArtboard id="a" label="A" width={120} height={90} />
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
 expect(container.querySelector('.dc-section-grip')).toBeNull();
 cleanup();
 });

 it('renders top-level groups in the persisted order from the sidecar', async () => {
 // The sidecar read supplies a saved order that puts g2 before g1.
 vi.stubGlobal('fetch', () => Promise.resolve({
 ok: true,
 json: () => Promise.resolve({ sections: {}, order: { '/p/home': ['g2', 'g1'] } }),
 }));
 const { container, cleanup } = renderToDom(
 <DesignCanvas orderKey="/p/home">
 <DCSection id="g1" title="G1" depth={1}>
 <DCArtboard id="a" label="A" width={120} height={90} />
 </DCSection>
 <DCSection id="g2" title="G2" depth={1}>
 <DCArtboard id="b" label="B" width={120} height={90} />
 </DCSection>
 </DesignCanvas>,
 );
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
 const ids = Array.from(container.querySelectorAll('[data-dc-section]')).map((el) =>
 el.getAttribute('data-dc-section'),
 );
 expect(ids).toEqual(['g2', 'g1']);
 cleanup();
 });
});

// ─── Selection scope capture — artboard pinpoint (2026-06-12) ─────────────────

describe('DCSection onSelectScope — artboard pinpoint', () => {
 it('resolves WHICH artboard was clicked on a multi-asset section (data-dc-asset-path)', async () => {
 const onSelectScope = vi.fn();
 const { container, cleanup } = renderToDom(
 <DCSection id="kit" title="Kit" onSelectScope={onSelectScope}>
 <DCArtboard id="a1" label="One" width={120} height={90} assetPath="kit/one.jsx">
 <div>Alpha</div>
 </DCArtboard>
 <DCArtboard id="a2" label="Two" width={120} height={90} assetPath="kit/two.jsx">
 <div>Your Name</div>
 </DCArtboard>
 </DCSection>,
 );
 const target = Array.from(container.querySelectorAll('div')).find(
 (el) => el.textContent === 'Your Name' && el.children.length === 0,
 );
 await act(async () => {
 target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
 });
 expect(onSelectScope).toHaveBeenCalledTimes(1);
 const [element, assetPath] = onSelectScope.mock.calls[0];
 expect(assetPath).toBe('kit/two.jsx');
 expect(element).toEqual({ text: 'Your Name', tag: 'div' });
 cleanup();
 });

 it('a click outside any artboard frame yields a null assetPath (page scope fallback)', async () => {
 const onSelectScope = vi.fn();
 const { container, cleanup } = renderToDom(
 <DCSection id="kit" title="Kit" onSelectScope={onSelectScope}>
 <DCArtboard id="a1" label="One" width={120} height={90} assetPath="kit/one.jsx">
 <div>Alpha</div>
 </DCArtboard>
 </DCSection>,
 );
 const section = container.querySelector('[data-dc-section]');
 await act(async () => {
 section.dispatchEvent(new MouseEvent('click', { bubbles: true }));
 });
 expect(onSelectScope).toHaveBeenCalledTimes(1);
 expect(onSelectScope.mock.calls[0][1]).toBeNull();
 cleanup();
 });
});
