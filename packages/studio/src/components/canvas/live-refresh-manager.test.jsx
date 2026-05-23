// live-refresh-manager.test.js (liveRefresh timer-driven re-rendering)
//
// Tests cover:
// (a) a listed asset with a valid interval fires notifyChange on schedule.
// (b) multiple listed assets each fire on their own interval.
// (c) unlisted assets get no timer.
// (d) invalid entries (non-existent asset, non-positive / non-numeric interval)
// are ignored with a console.warn, valid entries still take effect.
// (e) timer is cleared on unmount / page switch / removal from cascade list.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
 afterEach,
 beforeEach,
 describe,
 it,
 expect,
 vi,
} from 'vitest';

import { createPageNode, createGroupNode, createAssetNode } from '@lerret/core';

import { buildIntervalMap, useLiveRefresh } from './live-refresh-manager.js';
import {
 suspendLiveRefresh,
 isLiveRefreshSuspended,
 __resetLiveRefreshSuspendForTests,
} from './live-refresh-suspend.js';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeAsset(dir, name) {
 return createAssetNode({
 name,
 fileName: `${name}.jsx`,
 path: `${dir}/${name}.jsx`,
 assetKind: 'component',
 ext: '.jsx',
 });
}

function makePage(path, assets, groups = []) {
 return createPageNode({ name: path.split('/').pop(), path, assets, groups });
}

/** A minimal runtime stub with a spied `notifyChange`. */
function makeRuntime() {
 return {
 notifyChange: vi.fn(),
 subscribe: vi.fn(() => () => {}),
 loadAsset: vi.fn(async () => []),
 dispose: vi.fn(),
 };
}

// ────────────────────────────────────────────────────────────────────────────
// Mount/unmount helpers for the hook
// ────────────────────────────────────────────────────────────────────────────

let mountedRoot = null;
let mountedContainer = null;

afterEach(() => {
 if (mountedRoot) {
 act(() => mountedRoot.unmount());
 mountedRoot = null;
 }
 if (mountedContainer) {
 mountedContainer.remove();
 mountedContainer = null;
 }
});

/** A minimal component that invokes `useLiveRefresh` with the given props. */
function LiveRefreshHarness({ page, getConfigFor, runtime }) {
 useLiveRefresh(page, getConfigFor, runtime);
 return null;
}

function mount(element) {
 const container = document.createElement('div');
 document.body.appendChild(container);
 const root = createRoot(container);
 act(() => root.render(element));
 mountedContainer = container;
 mountedRoot = root;
 return { root, container };
}

function rerender(element) {
 act(() => mountedRoot.render(element));
}

// ────────────────────────────────────────────────────────────────────────────
// Unit tests for buildIntervalMap
// ────────────────────────────────────────────────────────────────────────────

describe('buildIntervalMap', () => {
 it('returns an empty map when no liveRefresh config exists', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(0);
 });

 it('maps a valid asset name + interval to the asset path', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = (p) =>
 p === '/.lerret/ui' ? { liveRefresh: { Clock: 1000 } } : {};
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(1);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(1000);
 });

 it('maps multiple valid assets from the same config block', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const countdown = makeAsset('/.lerret/ui', 'Countdown');
 const page = makePage('/.lerret/ui', [clock, countdown]);
 const getConfigFor = () => ({
 liveRefresh: { Clock: 1000, Countdown: 500 },
 });
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(2);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(1000);
 expect(map.get('/.lerret/ui/Countdown.jsx')).toBe(500);
 });

 it('walks into child groups to find liveRefresh config', () => {
 const clock = makeAsset('/.lerret/ui/live', 'Clock');
 const group = createGroupNode({
 name: 'live',
 path: '/.lerret/ui/live',
 assets: [clock],
 });
 const page = makePage('/.lerret/ui', [], [group]);
 const getConfigFor = (p) =>
 p === '/.lerret/ui/live' ? { liveRefresh: { Clock: 200 } } : {};
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.get('/.lerret/ui/live/Clock.jsx')).toBe(200);
 });

 it('ignores a non-existent asset name with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({
 liveRefresh: { Ghost: 1000, Clock: 500 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(1);
 expect(map.has('/.lerret/ui/Clock.jsx')).toBe(true);
 expect(warn).toHaveBeenCalledOnce();
 expect(warn.mock.calls[0][0]).toContain('Ghost');
 warn.mockRestore();
 });

 it('ignores a non-positive interval (0) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 0 } });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 expect(warn.mock.calls[0][0]).toContain('Clock');
 warn.mockRestore();
 });

 it('ignores a negative interval with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: -500 } });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalled();
 warn.mockRestore();
 });

 it('ignores a non-numeric interval (string) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 'fast' } });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 warn.mockRestore();
 });

 it('ignores sub-16ms intervals (below one animation frame) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 10 } });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 warn.mockRestore();
 });

 it('valid entries still take effect when some entries are invalid', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({
 liveRefresh: { Ghost: 1000, Clock: 500, Zombie: 'bad' },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getConfigFor);
 expect(map.size).toBe(1);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(500);
 expect(warn).toHaveBeenCalledTimes(2);
 warn.mockRestore();
 });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration tests for the useLiveRefresh hook (fake timers)
// ────────────────────────────────────────────────────────────────────────────

describe('useLiveRefresh hook', () => {
 beforeEach(() => {
 vi.useFakeTimers();
 });

 afterEach(() => {
 vi.useRealTimers();
 });

 // (a) A listed asset with a valid interval fires notifyChange on schedule.
 it('(a) fires notifyChange for a listed asset on its configured interval', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 1000 } });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 // No calls before the interval elapses.
 expect(runtime.notifyChange).not.toHaveBeenCalled();

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);
 expect(runtime.notifyChange).toHaveBeenCalledWith('/.lerret/ui/Clock.jsx');

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(2);
 });

 // (b) Multiple listed assets each fire on their own interval.
 it('(b) multiple assets fire independently on their own intervals', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const countdown = makeAsset('/.lerret/ui', 'Countdown');
 const page = makePage('/.lerret/ui', [clock, countdown]);
 const getConfigFor = () => ({
 liveRefresh: { Clock: 1000, Countdown: 500 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(500));
 // Countdown fired once, Clock not yet.
 const calls500 = runtime.notifyChange.mock.calls.map((c) => c[0]);
 expect(calls500.filter((p) => p.includes('Countdown'))).toHaveLength(1);
 expect(calls500.filter((p) => p.includes('Clock'))).toHaveLength(0);

 act(() => vi.advanceTimersByTime(500));
 // Both fired at 1000ms mark.
 const calls1000 = runtime.notifyChange.mock.calls.map((c) => c[0]);
 expect(calls1000.filter((p) => p.includes('Countdown'))).toHaveLength(2);
 expect(calls1000.filter((p) => p.includes('Clock'))).toHaveLength(1);
 });

 // (c) Unlisted assets get no timer.
 it('(c) unlisted assets get no timer — notifyChange is never called for them', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const hero = makeAsset('/.lerret/ui', 'Hero');
 const page = makePage('/.lerret/ui', [clock, hero]);
 // Only Clock is listed.
 const getConfigFor = () => ({ liveRefresh: { Clock: 1000 } });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(3000));

 const calledPaths = runtime.notifyChange.mock.calls.map((c) => c[0]);
 expect(calledPaths.every((p) => p.includes('Clock'))).toBe(true);
 expect(calledPaths.some((p) => p.includes('Hero'))).toBe(false);
 });

 // (d) Invalid entries are ignored + warned; valid entries still run.
 it('(d) ignores invalid entries (warns) while valid entries still fire', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 // Ghost does not exist; BadInterval is not a positive number; Clock is valid.
 const getConfigFor = () => ({
 liveRefresh: { Ghost: 1000, BadInterval: -5, Clock: 500 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(500));
 expect(runtime.notifyChange).toHaveBeenCalledWith('/.lerret/ui/Clock.jsx');
 expect(warn).toHaveBeenCalledTimes(2); // Ghost + BadInterval
 warn.mockRestore();
 });

 // (e) Timer is cleared on unmount.
 it('(e) clears all timers on unmount — notifyChange stops firing', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 1000 } });
 const runtime = makeRuntime();

 const { root } = mount(
 <LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />,
 );

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Unmount — timers must stop.
 act(() => root.unmount());
 mountedRoot = null; // prevent afterEach double-unmount

 runtime.notifyChange.mockClear();
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // (e) Timer is cleared when liveRefresh is removed from config (cascade change).
 it('(e) clears timer when liveRefresh is removed from config (cascade change)', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const runtime = makeRuntime();

 // Start with Clock listed.
 let cfgWithClock = { liveRefresh: { Clock: 1000 } };
 const getConfigFor = (p) => (p === '/.lerret/ui' ? cfgWithClock : {});

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Remove liveRefresh from config → re-render with empty config.
 cfgWithClock = {};
 // Force re-render by re-mounting with a new getConfigFor reference.
 rerender(<LiveRefreshHarness page={page} getConfigFor={(p) => (p === '/.lerret/ui' ? cfgWithClock : {})} runtime={runtime} />);

 runtime.notifyChange.mockClear();
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // (e) Timer is cleared on page switch.
 it('(e) clears timers when the page switches', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const pageA = makePage('/.lerret/ui', [clock]);
 const pageB = makePage('/.lerret/about', []);
 const getConfigFor = () => ({ liveRefresh: { Clock: 1000 } });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={pageA} getConfigFor={getConfigFor} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Switch to pageB — no assets, no liveRefresh.
 rerender(<LiveRefreshHarness page={pageB} getConfigFor={() => ({})} runtime={runtime} />);

 runtime.notifyChange.mockClear();
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // Null page → no timers started.
 it('does nothing when page is null', () => {
 const runtime = makeRuntime();
 mount(<LiveRefreshHarness page={null} getConfigFor={() => ({})} runtime={runtime} />);
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // Suspension: while a modal dialog is open, ticks skip notifyChange so the
 // background reload doesn't dismiss the dialog's native <select> popups.
 it('skips notifyChange while liveRefresh is suspended, resumes after release', () => {
 __resetLiveRefreshSuspendForTests();
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getConfigFor = () => ({ liveRefresh: { Clock: 1000 } });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getConfigFor={getConfigFor} runtime={runtime} />);

 // Baseline: one tick fires normally.
 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Open a "dialog": suspend. Ticks now fire but skip notifyChange.
 const release = suspendLiveRefresh();
 expect(isLiveRefreshSuspended()).toBe(true);
 act(() => vi.advanceTimersByTime(3000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1); // unchanged

 // Close the dialog: release. Ticks resume.
 release();
 expect(isLiveRefreshSuspended()).toBe(false);
 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(2);
 });

 // Overlapping suspensions compose (counter, not boolean).
 it('stays suspended until every overlapping suspension is released', () => {
 __resetLiveRefreshSuspendForTests();
 const release1 = suspendLiveRefresh();
 const release2 = suspendLiveRefresh();
 expect(isLiveRefreshSuspended()).toBe(true);
 release1();
 expect(isLiveRefreshSuspended()).toBe(true); // release2 still holds
 release2();
 expect(isLiveRefreshSuspended()).toBe(false);
 // Idempotent: double-release doesn't underflow.
 release1();
 expect(isLiveRefreshSuspended()).toBe(false);
 });
});
