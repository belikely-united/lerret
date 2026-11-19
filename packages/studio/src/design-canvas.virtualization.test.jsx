// Viewport virtualization: an artboard's content mounts only near the view,
// export pins mount it on demand, markdown cards always stay mounted, and
// auto-refresh skips artboards that aren't mounted.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DesignCanvas, DCSection, DCArtboard } from './design-canvas.jsx';
import { pinForCapture } from './export/capture.js';
import { isShowing } from './components/canvas/live-refresh-manager.js';

/** IntersectionObserver stand-in the test drives by hand. */
class FakeIO {
 constructor(cb) { this.cb = cb; this.els = new Set(); FakeIO.last = this; }
 observe(el) { this.els.add(el); }
 unobserve(el) { this.els.delete(el); }
 disconnect() { this.els.clear(); }
 fire(el, isIntersecting) {
 const box = { x: 0, y: 0, width: 10, height: 10 };
 act(() => this.cb([{ target: el, isIntersecting, boundingClientRect: box, rootBounds: box }]));
 }
}

let root, container;
beforeEach(async () => {
 vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }));
 vi.stubGlobal('IntersectionObserver', FakeIO);
 // Run the mount queue's frame right away.
 vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
 container = document.createElement('div');
 document.body.appendChild(container);
 root = createRoot(container);
 act(() => root.render(
 <DesignCanvas>
 <DCSection id="s" title="S">
 <DCArtboard id="a" label="A" width={200} height={150} assetPath="/p/A.jsx"><p data-testid="content-a">A</p></DCArtboard>
 <DCArtboard id="m" label="M" width={380} height="auto" isMarkdown><p data-testid="content-m">M</p></DCArtboard>
 </DCSection>
 </DesignCanvas>,
 ));
 // The canvas renders after its async sidecar read.
 await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
});
afterEach(() => {
 act(() => root.unmount());
 container.remove();
 vi.useRealTimers();
 vi.unstubAllGlobals();
});

const slot = (id) => document.querySelector(`[data-dc-slot="${id}"]`);
const content = (id) => document.querySelector(`[data-testid="content-${id}"]`);

describe('artboard virtualization', () => {
 it('keeps an off-screen artboard as a sized, pending placeholder', () => {
 expect(content('a')).toBeNull();
 const card = slot('a').querySelector('.dc-card');
 expect(card.style.width).toBe('200px');
 expect(card.querySelector('[data-dc-virtual][data-lerret-pending]')).not.toBeNull();
 });

 it('mounts content when the slot nears the view, and unmounts it 2 s after it leaves', () => {
 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // keep the stubbed rAF
 FakeIO.last.fire(slot('a'), true);
 expect(content('a')).not.toBeNull();
 FakeIO.last.fire(slot('a'), false);
 expect(content('a')).not.toBeNull(); // not straight away
 act(() => vi.advanceTimersByTime(2000));
 expect(content('a')).toBeNull();
 });

 it('mounts an off-screen artboard at once when export pins it', () => {
 let release;
 act(() => { release = pinForCapture(slot('a').querySelector('.dc-card')); });
 expect(content('a')).not.toBeNull();
 act(() => release());
 });

 it('never unmounts a markdown card (auto-height; page maps measure it)', () => {
 expect(content('m')).not.toBeNull();
 });

 it('auto-refresh ticks only for artboards that are mounted', () => {
 expect(isShowing('/p/A.jsx')).toBe(false);
 FakeIO.last.fire(slot('a'), true);
 expect(isShowing('/p/A.jsx')).toBe(true);
 expect(isShowing('/p/not-on-canvas.jsx')).toBe(true); // no slot: old behaviour
 vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
 expect(isShowing('/p/A.jsx')).toBe(false);
 });
});
