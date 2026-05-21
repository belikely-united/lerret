// asset-artboard.jsx — turns one runtime `AssetEntry` into a brownfield
// `DCArtboard` element for the canvas.
//
// This is the real studio canvas code that the dev-harness used to inline.
// Given an `AssetEntry` from the runtime, `artboardForEntry` returns
// the `DCArtboard` element the canvas section renders — sized from the
// entry's `meta` dimensions for a component, auto-height for a
// Markdown document card, or the real error card for
// a failed load/evaluate or a render-time throw.
//
// It returns a `DCArtboard` element DIRECTLY (not a wrapper component): the
// brownfield `DCSection` only treats *direct* `DCArtboard` children as
// artboards, so a wrapper would be filtered out.

import React from 'react';

import { DCArtboard } from '../../design-canvas.jsx';
import { AssetErrorBoundary, assetRuntimeStatus } from '../../runtime/asset-runtime.js';
import { AssetErrorCard } from './asset-error-card.jsx';
import { RerenderCue } from './rerender-cue.jsx';
import { VarsWrapper, assetFolderPath } from './vars-injector.jsx';
// per-entity kebab menus + lifecycle actions. Replaces the
// temporary Edit data / Edit markdown triggers from Stories 3.4 / 3.7.
import { ComponentArtboardKebab, MarkdownCardKebab } from './artboard-kebab.jsx';

// Default artboard size for a component asset that declares no `meta`
// dimensions — a `meta`-less asset still renders at a sensible size (NFR8).
export const DEFAULT_ARTBOARD_WIDTH = 260;
export const DEFAULT_ARTBOARD_HEIGHT = 200;

// A Markdown document card is auto-height — it grows with its
// content rather than being clipped to a declared box. It still needs a fixed
// *width* so the canvas row can lay it out; height is `'auto'`. Wider than a
// component artboard so a document reads as a document.
export const MARKDOWN_CARD_WIDTH = 380;

/**
 * Resolve the width/height a component entry's artboard should render at.
 *
 * an entry carries `dimensions` parsed from its `meta` export. Each
 * axis is used when present and a positive number, and falls back to the
 * canvas default otherwise — so a partial or absent `meta` still yields a
 * sensible artboard.
 *
 * @param {import('../../runtime/asset-runtime.js').AssetEntry} entry
 * @returns {{ width: number, height: number }}
 */
export function artboardSize(entry) {
 const dims = (entry && entry.dimensions) || {};
 return {
 width:
 typeof dims.width === 'number' && dims.width > 0 ? dims.width : DEFAULT_ARTBOARD_WIDTH,
 height:
 typeof dims.height === 'number' && dims.height > 0
 ? dims.height
 : DEFAULT_ARTBOARD_HEIGHT,
 };
}

/**
 * Build the `DCArtboard` element for one runtime asset entry.
 *
 * Every artboard's component is wrapped in its own `AssetErrorBoundary` so a
 * render-time throw is contained at the artboard level — it never propagates
 * to the canvas (AR6, NFR8). The boundary's `fallback` is the real error card
 *; `resetKey` is the entry's `id` + the per-render `cueKey` so a
 * live re-load resets the boundary and replaces the error card
 * with the new working component.
 *
 * A markdown (`.md`) entry renders as an auto-height document card; a failed
 * load/evaluate entry (`status: 'error'`) shows the real error card directly
 * (no component to render); a component entry wraps its component in the
 * boundary.
 *
 * when `cueKey` is set and changes between renders, the
 * artboard flashes a quiet {@link RerenderCue} (UX-DR17) — visible
 * confirmation that the live-edit loop just refreshed this artboard,
 * sourced from `--lm-*` tokens and honoring `prefers-reduced-motion`.
 *
 * @param {import('../../runtime/asset-runtime.js').AssetEntry} entry
 * @param {object} [opts]
 * @param {unknown} [opts.cueKey]
 * A value that changes per live re-render of this artboard. When supplied,
 * the artboard renders a `RerenderCue` keyed off it; when omitted the cue
 * stays at rest (the initial render of an artboard never flashes).
 * @returns {React.ReactElement} A `DCArtboard` element.
 */
export function artboardForEntry(entry, opts = {}) {
 const isMarkdown = entry.assetKind === 'markdown';
 const { width, height } = artboardSize(entry);

 // The file path to surface in the error card — the asset's canonical path.
 const filePath = entry.asset?.path ?? null;

 // The cue's key. The cue itself only animates when `cueKey` is defined
 // *and* differs from its previous value, so it stays silent on the very
 // first mount of an artboard (initial canvas paint), then flashes once
 // per subsequent live re-load.
 const cueKey = opts.cueKey;

 // derive the asset's owning folder path from its file path so
 // the `VarsWrapper` can look up the effective `vars` for that folder in the
 // cascade context. The folder path is the directory part of the asset path
 // (everything before the last `/`). When the asset path is absent, an empty
 // string is passed — `getConfigFor('')` returns `{}` and no vars are added.
 const folderPath = assetFolderPath(filePath ?? '');

 // the asset stem (file name without extension) used for the
 // `<ComponentName>-<purpose>.<ext>` download filename convention.
 // `asset.name` is already the stem (the runtime strips the extension).
 const assetName = entry.asset?.name ?? null;

 // A failed load/evaluate — surfaced by the runtime as an `'error'` entry.
 // Show the real error card in the artboard slot so the broken
 // asset is visible on the canvas while every other artboard renders normally.
 // Error artboards do not apply vars (no meaningful component is rendering).
 if (entry.status === assetRuntimeStatus.ERROR) {
 return (
 <DCArtboard
 key={entry.id}
 id={entry.id}
 label={`${entry.label} (error)`}
 width={isMarkdown ? MARKDOWN_CARD_WIDTH : width}
 height={isMarkdown ? 120 : height}
 isError={true}
 assetName={assetName}
 >
 <div style={{ position: 'relative', width: '100%', height: '100%' }}>
 <AssetErrorCard error={entry.error} filePath={filePath} />
 <RerenderCue cueKey={cueKey} />
 </div>
 </DCArtboard>
 );
 }

 const Component = entry.Component;

 // The boundary's reset key includes the cue key so a re-load of a
 // previously-broken artboard clears the boundary's caught error and gives
 // the new component a fresh chance to render (the ACs: "the next
 // good save recovers it").
 const boundaryResetKey =
 cueKey === undefined || cueKey === null ? entry.id : `${entry.id}::${String(cueKey)}`;

 // A Markdown document card — auto-height. The artboard carries a fixed
 // width but `height: 'auto'`, and the brownfield artboard frame drops its
 // `overflow: hidden`/fixed-`height` defaults when `style` overrides them.
 // Wrapped in AssetErrorBoundary so a render-time throw is contained here too.
 //
 // `VarsWrapper` replaces the raw `<div>` wrapper — it uses the
 // cascade context to inject `vars` entries as CSS custom properties scoped
 // to this artboard. When the folder has no `vars`, `VarsWrapper` renders
 // an identical plain `<div>` with the same `style`.
 if (isMarkdown) {
 return (
 <DCArtboard
 key={entry.id}
 id={entry.id}
 label={entry.label}
 width={MARKDOWN_CARD_WIDTH}
 height="auto"
 assetName={assetName}
 variantName={entry.variantName}
 style={{
 height: 'auto',
 overflow: 'visible',
 background: 'transparent',
 boxShadow: 'none',
 borderRadius: 0,
 }}
 >
 <VarsWrapper folderPath={folderPath} style={{ position: 'relative' }}>
 <MarkdownCardKebab entry={entry}>
 <AssetErrorBoundary
 resetKey={boundaryResetKey}
 fallback={
 <AssetErrorCard
 error={{ phase: 'render', message: `${entry.label} threw while rendering` }}
 filePath={filePath}
 />
 }
 >
 <Component />
 </AssetErrorBoundary>
 <RerenderCue cueKey={cueKey} />
 </MarkdownCardKebab>
 </VarsWrapper>
 </DCArtboard>
 );
 }

 // Component artboard — wrapped in its own AssetErrorBoundary (AR6, NFR8).
 // Each artboard has its own boundary: a throw in one never propagates to the
 // canvas or any other artboard. The re-render cue sits as a
 // sibling so it overlays the artboard frame without affecting its layout.
 //
 // `VarsWrapper` injects the effective `vars` as CSS custom
 // properties on the artboard's inner `div`. The component's own CSS can then
 // reference them with `var(--key)`. The wrapper merges the vars style with
 // the positional `style` so both apply to the same element.
 //
 // `ComponentArtboardKebab` wraps the component artboard with the
 // per-entity kebab menu (Edit data / Edit meta / Duplicate / Rename / Delete /
 // Export / Reveal …) and hosts the Data + Meta editor sheets. It also still
 // performs the data-fetch + four-tier prop resolution so the
 // rendered component reflects the data file on disk.
 return (
 <DCArtboard key={entry.id} id={entry.id} label={entry.label} width={width} height={height}
 assetName={assetName} variantName={entry.variantName}>
 <VarsWrapper
 folderPath={folderPath}
 style={{ position: 'relative', width: '100%', height: '100%' }}
 >
 <ComponentArtboardKebab
 entry={entry}
 renderComponent={(props) => (
 <AssetErrorBoundary
 resetKey={boundaryResetKey}
 fallback={
 <AssetErrorCard
 error={{ phase: 'render', message: `${entry.label} threw while rendering` }}
 filePath={filePath}
 />
 }
 >
 <Component {...props} />
 </AssetErrorBoundary>
 )}
 >
 <RerenderCue cueKey={cueKey} />
 </ComponentArtboardKebab>
 </VarsWrapper>
 </DCArtboard>
 );
}
