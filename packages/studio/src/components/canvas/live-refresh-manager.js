// live-refresh-manager.js: `liveRefresh` timer-driven re-rendering.
//
// When a folder's effective config includes a `liveRefresh` block, assets
// listed there should continuously re-render at their configured interval (in
// ms). This lets JavaScript-driven components — a clock, a countdown — visibly
// update in the studio canvas without requiring a file save.
//
// ── Design ─────────────────────────────────────────────────────────────────
// The re-render mechanism is already in place:
// `runtime.notifyChange(assetPath)` bumps the asset's cache-bust token and
// fans out to subscribed listeners, which reload only the affected artboard.
//
// This module reads the effective cascade config for a page — supplied via the
// `getConfigFor` accessor from `useCascadedConfig()` — to build an interval
// map: assetPath → intervalMs. It then holds `setInterval` handles keyed by
// asset path and fires `runtime.notifyChange(path)` on each tick.
//
// On every cascade change, or when the page's asset list changes, the timer
// set is **reconciled**: stale timers are cleared, new timers are started,
// unchanged timers keep running. On unmount (or page switch) all timers are
// cleared.
//
// ── Exported API ───────────────────────────────────────────────────────────
// useLiveRefresh(page, getConfigFor, runtime)
// A React hook. Call once per page render in `ProjectCanvas`.
// - `page` — the current `PageNode` (null → no-op).
// - `getConfigFor` — the accessor returned by `useCascadedConfig()`.
// - `runtime` — the `AssetRuntime` whose `notifyChange` drives reloads.
//
// ── Validation rules ───────────────────────────────────────────────────────
// Valid interval : typeof value === 'number' && isFinite(value) && value >= 16
// Valid asset name : must match the `name` property of an asset in the page
// (the name without extension, e.g. "ClockBanner").
// Invalid entries : ignored with a `console.warn` naming the bad entry;
// valid entries still take effect.
//
// ── Minimum interval ────────────────────────────────────────────────────────
// 16 ms (~one screen-refresh frame at 60 fps). Sub-frame intervals would fire
// faster than React can commit, producing meaningless re-render spam.

import { useEffect, useRef } from 'react';

import { isLiveRefreshSuspended } from './live-refresh-suspend.js';

/**
 * Minimum refresh interval in ms (one 60-fps frame).
 * Sub-frame intervals are clamped / rejected as invalid.
 * @type {number}
 */
const MIN_INTERVAL_MS = 16;

// ---------------------------------------------------------------------------
// Pure helpers — build the desired timer map from page + cascade config
// ---------------------------------------------------------------------------

/**
 * Walk the page (depth-first) and collect all `AssetNode`s that are components.
 *
 * @param {import('@lerret/core').PageNode | import('@lerret/core').GroupNode} container
 * @param {Map<string, import('@lerret/core').AssetNode>} out
 * Accumulator: asset.name → AssetNode.
 */
function collectAssetsByName(container, out) {
 for (const asset of container.assets || []) {
 if (asset && asset.assetKind === 'component') {
 out.set(asset.name, asset);
 }
 }
 for (const group of container.groups || []) {
 collectAssetsByName(group, out);
 }
}

/**
 * Derive the desired `Map<assetPath, intervalMs>` for the given page by
 * inspecting every section's effective `liveRefresh` config block.
 *
 * The cascade config is per folder path. Each section (page-level or group)
 * may carry a `liveRefresh` object that names assets and their intervals.
 * Assets are matched by **name** (without extension) against all component
 * assets on the page.
 *
 * Invalid entries are dropped here (with a warning) so the caller only sees
 * valid path → interval pairs.
 *
 * @param {import('@lerret/core').PageNode} page
 * @param {(path: string) => Record<string, unknown>} getConfigFor
 * @returns {Map<string, number>} assetPath → intervalMs for valid entries.
 */
export function buildIntervalMap(page, getConfigFor) {
 /** @type {Map<string, number>} */
 const intervals = new Map();

 // Build a flat name → AssetNode lookup for the whole page once.
 /** @type {Map<string, import('@lerret/core').AssetNode>} */
 const assetsByName = new Map();
 collectAssetsByName(page, assetsByName);

 /**
 * Inspect one container's effective config for a `liveRefresh` block.
 * @param {import('@lerret/core').PageNode | import('@lerret/core').GroupNode} container
 */
 function inspectContainer(container) {
 const cfg = getConfigFor(container.path);
 const liveRefresh = cfg && cfg.liveRefresh;
 if (liveRefresh && typeof liveRefresh === 'object' && !Array.isArray(liveRefresh)) {
 for (const [assetName, rawInterval] of Object.entries(liveRefresh)) {
 // Validate: interval must be a finite number >= MIN_INTERVAL_MS.
 if (
 typeof rawInterval !== 'number' ||
 !isFinite(rawInterval) ||
 rawInterval < MIN_INTERVAL_MS
 ) {
 console.warn(
 `[lerret/live-refresh] Ignoring liveRefresh entry "${assetName}" in "${container.path}": ` +
 `interval ${JSON.stringify(rawInterval)} is not a positive number ≥ ${MIN_INTERVAL_MS} ms.`,
 );
 continue;
 }

 // Validate: asset name must exist on the page.
 const assetNode = assetsByName.get(assetName);
 if (!assetNode) {
 console.warn(
 `[lerret/live-refresh] Ignoring liveRefresh entry "${assetName}" in "${container.path}": ` +
 `no component asset named "${assetName}" found on the current page.`,
 );
 continue;
 }

 // A path appearing in multiple containers uses the last-seen interval
 // (deepest wins, depth-first walk order). This is deliberate: a child
 // group's config overrides a parent's for the same asset.
 intervals.set(assetNode.path, rawInterval);
 }
 }

 // Recurse into child groups depth-first.
 for (const group of container.groups || []) {
 inspectContainer(group);
 }
 }

 inspectContainer(page);
 return intervals;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * React hook: set up (and reconcile) per-asset refresh timers for the current
 * page based on `liveRefresh` blocks in the cascaded config.
 *
 * Call this once per `ProjectCanvas` render, passing the current page, the
 * cascade accessor from `useCascadedConfig()`, and the asset runtime.
 *
 * Timer lifecycle:
 * - A timer is started for each valid `liveRefresh` entry found in any
 * folder of the current page's effective config.
 * - On every re-render (cascade change, page switch, asset list change),
 * the timer set is **reconciled**: new timers start, stale timers stop,
 * unchanged timers keep their existing handle.
 * - On unmount (or page switch via the `page` dependency), ALL timers are
 * cleared.
 *
 * Each timer tick calls `runtime.notifyChange(assetPath)`, which bumps the
 * asset's cache-bust token and triggers the studio's live-edit loop to reload
 * only that artboard — no canvas-wide re-render.
 *
 * @param {import('@lerret/core').PageNode | null | undefined} page
 * The current page. If null/undefined, all timers are cleared (no-op).
 * @param {(path: string) => Record<string, unknown>} getConfigFor
 * The cascade accessor from `useCascadedConfig()`.
 * @param {import('../../runtime/asset-runtime.js').AssetRuntime | null | undefined} runtime
 * The asset runtime. If null/undefined, no timers are started.
 */
export function useLiveRefresh(page, getConfigFor, runtime) {
 /**
 * Active timer handles: assetPath → setInterval id.
 * Held in a ref so reconciliation can compare previous vs. desired without
 * triggering re-renders.
 * @type {React.MutableRefObject<Map<string, ReturnType<typeof setInterval>>>}
 */
 const timersRef = useRef(new Map());

 useEffect(() => {
 const timers = timersRef.current;

 // No page or no runtime → clear everything and bail.
 if (!page || !runtime || typeof runtime.notifyChange !== 'function') {
 for (const id of timers.values()) clearInterval(id);
 timers.clear();
 return undefined;
 }

 // Build the desired interval map for the current page.
 const desired = buildIntervalMap(page, getConfigFor);

 // 1. Clear timers for paths no longer in the desired set.
 for (const [path, id] of timers.entries()) {
 if (!desired.has(path)) {
 clearInterval(id);
 timers.delete(path);
 }
 }

 // 2. Start timers for newly-desired paths (or update changed intervals).
 for (const [path, intervalMs] of desired.entries()) {
 // If a timer already exists for this path we keep it running. Interval
 // changes would require a restart; for simplicity we restart when the
 // interval changes (compare via a stored metadata approach is complex —
 // instead, always restart if an existing timer is for a DIFFERENT interval).
 // Since we don't store the interval alongside the handle, we cannot check
 // cheaply. The safe (and correct for cascade-change) approach: always
 // replace — clear the old one and start fresh. This is still O(n) and
 // fires once per cascade change, which is rare.
 if (timers.has(path)) {
 clearInterval(timers.get(path));
 }
 const id = setInterval(() => {
 // Skip the reload while a modal dialog is open (animated export / move
 // picker). A background reload re-renders the artboard subtree that hosts
 // the dialog and dismisses any open native `<select>` popup, making the
 // dialog's dropdowns unusable on a live page. The asset's own internal
 // animation keeps ticking; only the studio's reload timer pauses.
 if (isLiveRefreshSuspended()) return;
 runtime.notifyChange(path);
 }, intervalMs);
 timers.set(path, id);
 }

 // 3. Cleanup on unmount OR when dependencies change (page switch / cascade update).
 return () => {
 for (const id of timers.values()) clearInterval(id);
 timers.clear();
 };
 }, [page, getConfigFor, runtime]);
}
