// Tests for the re-render cue (`rerender-cue.jsx`, / UX-DR17).
//
// The cue is a small UI primitive — it has no business logic to test, but
// the contract matters: it stays invisible at rest, animates briefly when
// `cueKey` changes, and falls back to an instant state change when the user
// prefers reduced motion. These tests pin all three.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { RerenderCue } from './rerender-cue.jsx';

/** Mount a React element into a detached container for inspection. */
function renderToDom(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => {
 root.render(element);
 });
 return {
 container,
 rerender(next) {
 act(() => {
 root.render(next);
 });
 },
 cleanup() {
 act(() => root.unmount());
 container.remove();
 },
 };
}

// Provide a deterministic matchMedia stub so the cue's reduced-motion path
// is testable without depending on the jsdom default (which is `matches: false`).
function stubMatchMedia(matches) {
 const original = window.matchMedia;
 window.matchMedia = (query) => ({
 matches,
 media: query,
 onchange: null,
 addListener: () => {},
 removeListener: () => {},
 addEventListener: () => {},
 removeEventListener: () => {},
 dispatchEvent: () => false,
 });
 return () => {
 window.matchMedia = original;
 };
}

describe('RerenderCue', () => {
 let restoreMatchMedia;

 beforeEach(() => {
 vi.useFakeTimers();
 // Default to motion enabled (no reduced-motion preference).
 restoreMatchMedia = stubMatchMedia(false);
 });

 afterEach(() => {
 vi.useRealTimers();
 if (restoreMatchMedia) restoreMatchMedia();
 });

 it('renders nothing when cueKey is undefined (idle at rest)', () => {
 const { container, cleanup } = renderToDom(<RerenderCue cueKey={undefined} />);
 expect(container.querySelector('[data-lm-rerender-cue]')).toBeNull();
 cleanup();
 });

 it('renders the cue when cueKey changes and removes it after the visible window', () => {
 const { container, rerender, cleanup } = renderToDom(<RerenderCue cueKey={undefined} />);
 expect(container.querySelector('[data-lm-rerender-cue]')).toBeNull();

 // First non-undefined cueKey — the cue appears.
 rerender(<RerenderCue cueKey={1} />);
 expect(container.querySelector('[data-lm-rerender-cue]')).not.toBeNull();
 // The visible ring is fully opaque while showing.
 const cue = container.querySelector('[data-lm-rerender-cue]');
 expect(cue.getAttribute('aria-hidden')).toBe('true');

 // Advance past the full visible window — the cue is removed entirely.
 act(() => {
 vi.advanceTimersByTime(600);
 });
 expect(container.querySelector('[data-lm-rerender-cue]')).toBeNull();
 cleanup();
 });

 it('animates again when cueKey changes to a new value', () => {
 const { container, rerender, cleanup } = renderToDom(<RerenderCue cueKey={1} />);
 expect(container.querySelector('[data-lm-rerender-cue]')).not.toBeNull();
 act(() => {
 vi.advanceTimersByTime(600);
 });
 expect(container.querySelector('[data-lm-rerender-cue]')).toBeNull();

 rerender(<RerenderCue cueKey={2} />);
 expect(container.querySelector('[data-lm-rerender-cue]')).not.toBeNull();
 cleanup();
 });

 it('honors prefers-reduced-motion — instant state change, no CSS transition', () => {
 restoreMatchMedia();
 restoreMatchMedia = stubMatchMedia(true);

 const { container, cleanup } = renderToDom(<RerenderCue cueKey={1} />);
 const cue = container.querySelector('[data-lm-rerender-cue]');
 expect(cue).not.toBeNull();
 // With reduced motion the cue uses `transition: none` so the appearance
 // is an instant state change rather than an animated fade.
 expect(cue.style.transition).toBe('none');
 cleanup();
 });

 it('sources its visual style from --lm-* tokens (no hardcoded color literal)', () => {
 const { container, cleanup } = renderToDom(<RerenderCue cueKey={42} />);
 const cue = container.querySelector('[data-lm-rerender-cue]');
 // boxShadow references `var(--lm-accent...)` — verify the variable name
 // is present rather than a raw hex value.
 expect(cue.style.boxShadow).toMatch(/var\(--lm-accent/);
 // borderRadius pulls from the radius token.
 expect(cue.style.borderRadius).toMatch(/var\(--lm-radius/);
 cleanup();
 });
});
