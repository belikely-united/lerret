// live-refresh-manager.test.js (auto-refresh timer-driven re-rendering)
//
// Per ADR-003 the refresh interval is per-asset: each component reads its own
// `Name.config.json` `autoRefresh` (ms), surfaced via the `getAssetConfig`
// accessor (`assetPath => config`). No folder cascade, no name-matching, no
// null/false "explicit off" sentinel.
//
// Tests cover:
// (a) an asset with a valid interval fires notifyChange on schedule.
// (b) multiple assets each fire on their own interval.
// (c) an asset with no config gets no timer.
// (d) invalid intervals (non-numeric / sub-frame / non-positive) are ignored
// with a console.warn; valid entries still take effect.
// (e) timer is cleared on unmount / page switch / removal from config.

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

/**
 * Build a per-asset `getAssetConfig` accessor from a plain map of
 * `{ assetPath: config }`. Returns `{}` for any path not in the map, mirroring
 * `useAssetConfig()` (see asset-config-context.jsx).
 */
function makeGetAssetConfig(byPath) {
 return (assetPath) => byPath[assetPath] || {};
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
function LiveRefreshHarness({ page, getAssetConfig, runtime }) {
 useLiveRefresh(page, getAssetConfig, runtime);
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
 it('returns an empty map when no asset has an autoRefresh config', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = () => ({});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 });

 it('maps an asset with a valid autoRefresh to its path', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(1);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(1000);
 });

 it('maps multiple assets, each from its own config', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const countdown = makeAsset('/.lerret/ui', 'Countdown');
 const page = makePage('/.lerret/ui', [clock, countdown]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 '/.lerret/ui/Countdown.jsx': { autoRefresh: 500 },
 });
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(2);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(1000);
 expect(map.get('/.lerret/ui/Countdown.jsx')).toBe(500);
 });

 it('walks into child groups to find each asset\'s config', () => {
 const clock = makeAsset('/.lerret/ui/live', 'Clock');
 const group = createGroupNode({
 name: 'live',
 path: '/.lerret/ui/live',
 assets: [clock],
 });
 const page = makePage('/.lerret/ui', [], [group]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/live/Clock.jsx': { autoRefresh: 200 },
 });
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.get('/.lerret/ui/live/Clock.jsx')).toBe(200);
 });

 it('an asset with no config (or no autoRefresh) is simply off — no warning', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 // Config object exists but has no autoRefresh key.
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { presentation: { background: '#fff' } },
 });
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).not.toHaveBeenCalled();
 warn.mockRestore();
 });

 it('treats a null autoRefresh as off — no timer, no warning', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: null },
 });
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).not.toHaveBeenCalled();
 warn.mockRestore();
 });

 it('ignores a non-positive interval (0) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 0 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 expect(warn.mock.calls[0][0]).toContain('/.lerret/ui/Clock.jsx');
 warn.mockRestore();
 });

 it('ignores a negative interval with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: -500 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalled();
 warn.mockRestore();
 });

 it('ignores a non-numeric interval (string) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 'fast' },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 warn.mockRestore();
 });

 it('ignores sub-16ms intervals (below one animation frame) with a console.warn', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 10 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(0);
 expect(warn).toHaveBeenCalledOnce();
 warn.mockRestore();
 });

 it('valid assets still take effect when another asset is invalid', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const broken = makeAsset('/.lerret/ui', 'Broken');
 const page = makePage('/.lerret/ui', [clock, broken]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 500 },
 '/.lerret/ui/Broken.jsx': { autoRefresh: 'bad' },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const map = buildIntervalMap(page, getAssetConfig);
 expect(map.size).toBe(1);
 expect(map.get('/.lerret/ui/Clock.jsx')).toBe(500);
 expect(warn).toHaveBeenCalledOnce();
 warn.mockRestore();
 });

 it('returns an empty map when getAssetConfig is not a function', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const map = buildIntervalMap(page, undefined);
 expect(map.size).toBe(0);
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

 // (a) An asset with a valid interval fires notifyChange on schedule.
 it('(a) fires notifyChange for an asset on its configured interval', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />);

 // No calls before the interval elapses.
 expect(runtime.notifyChange).not.toHaveBeenCalled();

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);
 expect(runtime.notifyChange).toHaveBeenCalledWith('/.lerret/ui/Clock.jsx');

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(2);
 });

 // (b) Multiple assets each fire on their own interval.
 it('(b) multiple assets fire independently on their own intervals', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const countdown = makeAsset('/.lerret/ui', 'Countdown');
 const page = makePage('/.lerret/ui', [clock, countdown]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 '/.lerret/ui/Countdown.jsx': { autoRefresh: 500 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />);

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

 // (c) An asset with no config gets no timer.
 it('(c) an asset with no config gets no timer — notifyChange is never called for it', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const hero = makeAsset('/.lerret/ui', 'Hero');
 const page = makePage('/.lerret/ui', [clock, hero]);
 // Only Clock has a config.
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(3000));

 const calledPaths = runtime.notifyChange.mock.calls.map((c) => c[0]);
 expect(calledPaths.every((p) => p.includes('Clock'))).toBe(true);
 expect(calledPaths.some((p) => p.includes('Hero'))).toBe(false);
 });

 // (d) Invalid entries are ignored + warned; valid entries still run.
 it('(d) ignores an invalid interval (warns) while valid entries still fire', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const broken = makeAsset('/.lerret/ui', 'Broken');
 const page = makePage('/.lerret/ui', [clock, broken]);
 // Broken's interval is not a positive number; Clock is valid.
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 500 },
 '/.lerret/ui/Broken.jsx': { autoRefresh: -5 },
 });
 const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(500));
 expect(runtime.notifyChange).toHaveBeenCalledWith('/.lerret/ui/Clock.jsx');
 expect(warn).toHaveBeenCalledOnce(); // Broken
 warn.mockRestore();
 });

 // (e) Timer is cleared on unmount.
 it('(e) clears all timers on unmount — notifyChange stops firing', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const runtime = makeRuntime();

 const { root } = mount(
 <LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />,
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

 // (e) Timer is cleared when the asset's autoRefresh is removed (config change).
 it('(e) clears timer when autoRefresh is removed from the asset config', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const runtime = makeRuntime();

 // Start with Clock configured.
 const onConfig = makeGetAssetConfig({ '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 } });
 mount(<LiveRefreshHarness page={page} getAssetConfig={onConfig} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Remove autoRefresh → re-render with a new (empty) accessor reference.
 const offConfig = makeGetAssetConfig({});
 rerender(<LiveRefreshHarness page={page} getAssetConfig={offConfig} runtime={runtime} />);

 runtime.notifyChange.mockClear();
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // (e) Timer is cleared on page switch.
 it('(e) clears timers when the page switches', () => {
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const pageA = makePage('/.lerret/ui', [clock]);
 const pageB = makePage('/.lerret/about', []);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={pageA} getAssetConfig={getAssetConfig} runtime={runtime} />);

 act(() => vi.advanceTimersByTime(1000));
 expect(runtime.notifyChange).toHaveBeenCalledTimes(1);

 // Switch to pageB — no assets.
 rerender(<LiveRefreshHarness page={pageB} getAssetConfig={makeGetAssetConfig({})} runtime={runtime} />);

 runtime.notifyChange.mockClear();
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // Null page → no timers started.
 it('does nothing when page is null', () => {
 const runtime = makeRuntime();
 mount(<LiveRefreshHarness page={null} getAssetConfig={() => ({})} runtime={runtime} />);
 act(() => vi.advanceTimersByTime(5000));
 expect(runtime.notifyChange).not.toHaveBeenCalled();
 });

 // Suspension: while a modal dialog is open, ticks skip notifyChange so the
 // background reload doesn't dismiss the dialog's native <select> popups.
 it('skips notifyChange while live refresh is suspended, resumes after release', () => {
 __resetLiveRefreshSuspendForTests();
 const clock = makeAsset('/.lerret/ui', 'Clock');
 const page = makePage('/.lerret/ui', [clock]);
 const getAssetConfig = makeGetAssetConfig({
 '/.lerret/ui/Clock.jsx': { autoRefresh: 1000 },
 });
 const runtime = makeRuntime();

 mount(<LiveRefreshHarness page={page} getAssetConfig={getAssetConfig} runtime={runtime} />);

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
