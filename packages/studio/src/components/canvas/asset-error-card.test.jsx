// Tests for the per-artboard error card and boundary containment.
//
// Covers two areas:
// 1. `AssetErrorCard` — pure rendering: the card shows a readable message,
// the file path, the error icon, the phase label, and uses error-token
// styling. Color is never the only signal (icon + text required, NFR8).
// 2. `AssetErrorBoundary` + `AssetErrorCard` integration — containment:
// a render-time throw is caught inside the boundary and shows the error
// card; sibling elements outside the boundary are unaffected (AR6).
// Recovery: when `resetKey` changes the boundary re-renders children,
// replacing the error card with the working component.
//
// Uses the same dependency-free `renderToDom` pattern as the other canvas
// tests — `react-dom/client` into a detached jsdom container.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AssetErrorCard } from './asset-error-card.jsx';
import { AssetErrorBoundary } from '../../runtime/asset-runtime.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mount an element into a detached jsdom container; returns it + a teardown. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 root,
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 rerender(el) {
 act(() => {
 root.render(el);
 });
 },
 };
}

/**
 * A component that throws unconditionally — simulates a broken user asset at
 * render time (e.g. BrokenBadge.jsx reading a property off `undefined`).
 */
function ThrowingComponent() {
 const data = undefined;
 void data.value; // throws TypeError — `void` avoids the no-unused-expressions lint rule
 return React.createElement('div', null, 'unreachable');
}

/** A component that renders successfully. */
function OkComponent() {
 return React.createElement('div', { 'data-ok': true }, 'success');
}

// Suppress React's error boundary console.error in these tests — the throws
// are intentional and the noise obscures test output.
let originalConsoleError;
beforeEach(() => {
 originalConsoleError = console.error;
 console.error = () => {};
});
afterEach(() => {
 console.error = originalConsoleError;
});

// ---------------------------------------------------------------------------
// AssetErrorCard — rendering
// ---------------------------------------------------------------------------

describe('AssetErrorCard', () => {
 it('renders the [data-asset-error] sentinel so automated checks can find it', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'evaluate', message: 'Module crashed' },
 filePath: '/.lerret/ui/Broken.jsx',
 }),
 );
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();
 cleanup();
 });

 it('shows a readable error message', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'load', message: 'Cannot find module ./missing' },
 filePath: null,
 }),
 );
 expect(container.textContent).toContain('Cannot find module ./missing');
 cleanup();
 });

 it('shows the asset file path when supplied', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'oops' },
 filePath: '/.lerret/brand-marks/BrokenBadge.jsx',
 }),
 );
 expect(container.textContent).toContain('/.lerret/brand-marks/BrokenBadge.jsx');
 cleanup();
 });

 it('omits the file path element when filePath is not supplied', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'oops' },
 }),
 );
 // No element with the error path text — path section is absent.
 const pathEls = Array.from(container.querySelectorAll('[data-asset-error] p'));
 // Only the message paragraph, no path paragraph.
 expect(pathEls.length).toBe(1);
 cleanup();
 });

 it('pairs color with an icon so meaning survives without color (UX-DR12)', () => {
 // The icon is an <svg aria-hidden> inside the card.
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'evaluate', message: 'top-level throw' },
 filePath: '/.lerret/BrokenOnLoad.jsx',
 }),
 );
 const card = container.querySelector('[data-asset-error]');
 // An SVG icon must be present alongside the text label.
 expect(card.querySelector('svg')).toBeTruthy();
 // And explicit text that conveys "error" — not only color.
 expect(card.textContent).toMatch(/error/i);
 cleanup();
 });

 it('carries role="alert" for screen readers', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'TypeError: data is undefined' },
 filePath: '/BrokenBadge.jsx',
 }),
 );
 expect(container.querySelector('[role="alert"]')).toBeTruthy();
 cleanup();
 });

 it('labels the phase correctly for each error phase', () => {
 for (const [phase, label] of [
 ['load', 'Load error'],
 ['evaluate', 'Module error'],
 ['render', 'Render error'],
 ]) {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase, message: 'msg' },
 filePath: null,
 }),
 );
 expect(container.textContent).toMatch(new RegExp(label, 'i'));
 cleanup();
 }
 });

 it('handles a null/undefined error gracefully (does not throw)', () => {
 expect(() => {
 const { cleanup } = renderToDom(
 React.createElement(AssetErrorCard, { error: null, filePath: null }),
 );
 cleanup();
 }).not.toThrow();
 });

 it('sets data-error-phase on the root element for automated inspection', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(AssetErrorCard, {
 error: { phase: 'evaluate', message: 'oops' },
 filePath: null,
 }),
 );
 expect(container.querySelector('[data-error-phase="evaluate"]')).toBeTruthy();
 cleanup();
 });
});

// ---------------------------------------------------------------------------
// AssetErrorBoundary + AssetErrorCard — containment & recovery
// ---------------------------------------------------------------------------

describe('AssetErrorBoundary + AssetErrorCard — containment', () => {
 it('catches a render-time throw and shows the error card fallback', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(
 AssetErrorBoundary,
 {
 fallback: React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'ThrowingComponent failed' },
 filePath: '/.lerret/BrokenBadge.jsx',
 }),
 },
 React.createElement(ThrowingComponent),
 ),
 );

 // The error card must appear.
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();
 expect(container.textContent).toContain('ThrowingComponent failed');
 cleanup();
 });

 it('does not affect sibling elements outside the boundary (containment AR6)', () => {
 // Wrap one broken boundary alongside a healthy sibling to assert isolation.
 const { container, cleanup } = renderToDom(
 React.createElement(
 'div',
 null,
 React.createElement(
 AssetErrorBoundary,
 {
 fallback: React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'isolated throw' },
 filePath: null,
 }),
 },
 React.createElement(ThrowingComponent),
 ),
 // Healthy sibling — must remain rendered.
 React.createElement(OkComponent),
 ),
 );

 // Error card inside the boundary.
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();
 // Sibling still rendered.
 expect(container.querySelector('[data-ok]')).toBeTruthy();
 cleanup();
 });

 it('does not show the error card when children render successfully', () => {
 const { container, cleanup } = renderToDom(
 React.createElement(
 AssetErrorBoundary,
 {
 fallback: React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'should not appear' },
 filePath: null,
 }),
 },
 React.createElement(OkComponent),
 ),
 );

 expect(container.querySelector('[data-asset-error]')).toBeNull();
 expect(container.querySelector('[data-ok]')).toBeTruthy();
 cleanup();
 });
});

describe('AssetErrorBoundary + AssetErrorCard — recovery via resetKey', () => {
 it('clears the caught error and re-renders children when resetKey changes', () => {
 // Render a BoundaryWrapper whose `throwing` prop controls whether the
 // child throws. The boundary wraps it; changing `resetKey` must reset the
 // caught error so the child gets another chance.
 function BoundaryWrapper({ throwing, resetKey }) {
 return React.createElement(
 AssetErrorBoundary,
 {
 resetKey,
 fallback: React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'throwing!' },
 filePath: null,
 }),
 },
 throwing ? React.createElement(ThrowingComponent) : React.createElement(OkComponent),
 );
 }

 // Initial render — child throws, error card appears.
 const { container, rerender, cleanup } = renderToDom(
 React.createElement(BoundaryWrapper, { throwing: true, resetKey: 'v1' }),
 );
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();
 expect(container.querySelector('[data-ok]')).toBeNull();

 // Simulate the asset being fixed: `throwing` becomes false AND `resetKey`
 // changes (as the reload loop changes the entry id/token).
 rerender(React.createElement(BoundaryWrapper, { throwing: false, resetKey: 'v2' }));

 // Error card must be gone; the working component must appear.
 expect(container.querySelector('[data-asset-error]')).toBeNull();
 expect(container.querySelector('[data-ok]')).toBeTruthy();

 cleanup();
 });

 it('keeps showing the error card when resetKey does NOT change', () => {
 // Same resetKey → boundary does NOT reset; the caught error persists even
 // if the child would now render successfully.
 function BoundaryWrapper({ throwing, resetKey }) {
 return React.createElement(
 AssetErrorBoundary,
 {
 resetKey,
 fallback: React.createElement(AssetErrorCard, {
 error: { phase: 'render', message: 'still caught' },
 filePath: null,
 }),
 },
 throwing ? React.createElement(ThrowingComponent) : React.createElement(OkComponent),
 );
 }

 const { container, rerender, cleanup } = renderToDom(
 React.createElement(BoundaryWrapper, { throwing: true, resetKey: 'same' }),
 );
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();

 // Re-render with a fixed child but the SAME resetKey — boundary keeps the
 // error, does not give the child another try.
 rerender(React.createElement(BoundaryWrapper, { throwing: false, resetKey: 'same' }));
 expect(container.querySelector('[data-asset-error]')).toBeTruthy();

 cleanup();
 });
});
