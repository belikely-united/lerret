// asset-runtime.js — the deploy-mode-agnostic asset-runtime *interface*.
//
// The architecture (AR4) fixes one contract for loading assets, in its own
// words: *given the project model, yield a React component per asset and
// signal changes.* The studio consumes this interface and NEVER branches on
// deploy mode — the CLI/self-host path and the hosted path are two
// implementations of the SAME shape. CLI mode lands in `vite-runtime.js`;
// hosted mode (Sucrase + service worker) lands later behind this
// identical interface.
//
// This file is the contract, not an implementation. It owns:
// - the JSDoc `@typedef`s for the runtime and its per-asset record,
// - `AssetErrorBoundary` — the shared React error boundary that turns a
// render-time throw into a per-asset error rather than a canvas crash,
// - `assetRuntimeStatus` — the frozen status enum a record carries.
//
// ── Designed for forward compatibility ──────────────────────────────────────
// The interface is deliberately shaped so the additional asset kinds slot in
// with no redesign:
// • Markdown assets — a record exposes `assetKind`; a non-Vite
// runtime (or the same one) can yield a markdown record. `Component` stays
// the single "what to render" field whatever the asset kind.
// • Variants + `meta` — one asset file may yield 1..N records.
// `loadAsset` returns `AssetEntry[]` (an array, never a bare record), and a
// record carries optional `variantName` / `meta` fields, populated later.
// • Error-card UI — a failed record is `status: 'error'`
// with a structured `error`; the card UI is a pure function of that data.
// • Reload on change — `subscribe(listener)` signals that an
// asset changed; the caller re-invokes `loadAsset` for the changed path.

import React from 'react';

import { MarkdownAssetCard } from '../components/canvas/markdown-asset-card.jsx';

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

/**
 * The lifecycle status of a single {@link AssetEntry}.
 *
 * - `'ok'` — the asset module loaded and yielded a renderable component.
 * - `'error'` — the asset failed to load, evaluate, or (via the error
 * boundary) render; `entry.error` holds the structured failure.
 * - `'loading'` — the asset's module request is in flight (a runtime that
 * resolves asynchronously may surface this transiently).
 *
 * @typedef {'ok' | 'error' | 'loading'} AssetRuntimeStatus
 */

/**
 * Frozen string constants for {@link AssetRuntimeStatus} — importing these
 * keeps stray status literals out of the studio and tests.
 *
 * @type {Readonly<{ OK: 'ok', ERROR: 'error', LOADING: 'loading' }>}
 */
export const assetRuntimeStatus = Object.freeze({
 OK: 'ok',
 ERROR: 'error',
 LOADING: 'loading',
});

// ---------------------------------------------------------------------------
// Structured per-asset error
// ---------------------------------------------------------------------------

/**
 * A contained asset failure — a load error, a module-evaluation throw, or a
 * render-time throw caught by {@link AssetErrorBoundary}. It is plain data so
 * 's error-card UI can render it as a pure function with no access
 * to the original `Error` object.
 *
 * @typedef {object} AssetError
 * @property {'load' | 'evaluate' | 'render'} phase
 * Where the failure happened: `'load'` (the module request itself failed —
 * missing file, bad import specifier), `'evaluate'` (the module threw while
 * its top-level code ran), or `'render'` (the component threw while React
 * rendered it — caught by the error boundary).
 * @property {string} message
 * The human-readable error message — `error.message`, or a string fallback.
 * @property {string} [stack]
 * The error's stack trace when one is available.
 */

/**
 * Normalize an arbitrary thrown value into a plain {@link AssetError}.
 *
 * Anything can be thrown in JS (a string, `null`, a custom object) — this
 * funnels every case to the same shape so downstream code never has to sniff.
 *
 * @param {unknown} thrown The caught value.
 * @param {AssetError['phase']} phase The phase the failure happened in.
 * @returns {AssetError}
 */
export function toAssetError(thrown, phase) {
 if (thrown instanceof Error) {
 return {
 phase,
 message: thrown.message || String(thrown),
 stack: thrown.stack,
 };
 }
 return { phase, message: typeof thrown === 'string' ? thrown : String(thrown) };
}

// ---------------------------------------------------------------------------
// Per-asset record
// ---------------------------------------------------------------------------

/**
 * One renderable unit produced by the runtime from an {@link AssetNode}.
 *
 * For a `.jsx`/`.tsx` component asset this is its default export wrapped for
 * the canvas; later stories add markdown entries (1.6) and named-export
 * variants (1.7), each still an `AssetEntry`. A single asset file yields an
 * *array* of these — exactly one , possibly several once variants
 * exist — which is why {@link AssetRuntime.loadAsset} always returns an array.
 *
 * @typedef {object} AssetEntry
 * @property {string} id
 * A stable, canvas-unique id for this entry. A default-export (primary)
 * entry uses the asset's bare `LerretPath`; a named-export variant (1.7) uses
 * `"<path>#<variantName>"`. Stable across reloads of the same asset so the
 * canvas keeps an artboard's place and per-artboard UI state.
 * @property {AssetNode} asset
 * The source {@link AssetNode} from the project model this entry came from.
 * @property {import('../../../core/src/loader/model.js').AssetKind} assetKind
 * The asset's kind, mirrored from `asset.assetKind` for convenience —
 * `'component'` ; `'markdown'` arrives with .
 * @property {AssetRuntimeStatus} status
 * `'ok'`, `'error'`, or `'loading'` — see {@link AssetRuntimeStatus}.
 * @property {React.ComponentType<any> | null} Component
 * The React component to render for this entry when `status === 'ok'` — for
 * a primary entry the module's default export, for a variant entry that
 * variant's named export. `null` when `status` is `'error'` or
 * `'loading'`. Callers should still wrap it in {@link AssetErrorBoundary} so
 * a render-time throw is contained.
 * @property {AssetError | null} error
 * The structured failure when `status === 'error'`; otherwise `null`.
 * @property {string} [label]
 * Display label for the artboard. sets this from `meta.label` when
 * present, otherwise a name derived from the asset / variant.
 * @property {string} [variantName]
 * The variant this entry came from: a named export's identifier
 * for a variant entry, `'default'` for the file's primary (default-export)
 * entry. `undefined` only on an `'error'` entry produced before variants
 * could be resolved.
 * @property {{ width?: number, height?: number }} [dimensions]
 * Artboard dimensions parsed from the asset's `meta.dimensions`.
 * A field is `undefined` when `meta` omits it — the canvas then falls back to
 * its default artboard size for that axis.
 * @property {string[]} [tags]
 * Tags parsed from the asset's `meta.tags` — carried on the entry
 * for later use (search / filtering). `[]` when `meta` has no tags.
 * @property {import('../../../core/src/assets/meta.js').AssetMeta} [meta]
 * The asset's parsed `meta` export — the full canonical
 * {@link import('../../../core/src/assets/meta.js').AssetMeta} object
 * (`dimensions`, `label`, `tags`, `propsSchema`, `hasMeta`, `error`).
 * `undefined` only on an `'error'` entry produced before `meta` was parsed.
 * @property {string} [text]
 * For a markdown entry, the `.md` file's raw Markdown source —
 * carried so the canvas can re-render or hand it to the Markdown editor
 * later. `undefined` for a component entry.
 */

// ---------------------------------------------------------------------------
// The runtime interface
// ---------------------------------------------------------------------------

/**
 * The asset-runtime interface — the single boundary the studio uses to turn
 * the project model into renderable artboards (AR4). Both the CLI/self-host
 * runtime ({@link module:vite-runtime}) and the future hosted runtime
 * implement this exact shape; the studio depends only on the shape.
 *
 * A runtime is created by a factory bound to the project model (see
 * {@link AssetRuntimeFactory}); `loadAsset` is then called per asset node.
 *
 * @typedef {object} AssetRuntime
 * @property {(asset: AssetNode) => Promise<AssetEntry[]>} loadAsset
 * Load one asset node and resolve to its renderable entries. ALWAYS resolves
 * — never rejects: a load or module-evaluation failure resolves to a
 * one-element array whose entry is `status: 'error'`. Returns an array
 * because one file can yield multiple artboards (variants); a markdown asset
 * always resolves to exactly one entry.
 * @property {(listener: (changedPath: LerretPath) => void) => () => void} subscribe
 * Register a `listener` invoked with an asset's `LerretPath` whenever the
 * runtime detects that asset changed; returns an unsubscribe function. The
 * caller responds by re-invoking `loadAsset` for that path.
 * In CLI mode the runtime emits in response to a `notifyChange(path)` call
 * driven by the watcher (from the dev harness in the fixture path; from the
 * real chokidar watcher under `@lerret/cli dev`).
 * @property {(changedPath: LerretPath) => void} notifyChange
 * Tell the runtime an asset at `changedPath` has been written. The runtime
 * bumps the asset's cache-bust token so the next `loadAsset(asset)` for
 * that path imports a fresh module instance, and fans out the path to
 * every `subscribe`d listener so the studio canvas can re-load it
 *. Calling for a path the runtime doesn't track (e.g. a
 * resource file rather than an asset file) is a safe no-op.
 * @property {() => void} dispose
 * Release everything the runtime holds (listeners, timers, caches). Called
 * when the studio unmounts or switches projects. Idempotent.
 */

/**
 * A factory that builds an {@link AssetRuntime} for a given project model.
 *
 * Each deploy mode ships exactly one factory. The studio is handed a factory
 * (it does not pick one — that choice is made at the app entry by mode), calls
 * it with the scanned {@link ProjectNode}, and then talks only to the returned
 * {@link AssetRuntime}. The project model gives the factory the asset paths it
 * will be asked to load.
 *
 * @callback AssetRuntimeFactory
 * @param {ProjectNode} project The scanned project model.
 * @param {object} [options] Mode-specific options (the `vite-runtime`
 * takes the base URL its asset modules are served from). Kept opaque here so
 * mode differences never leak into this interface.
 * @returns {AssetRuntime}
 */

/**
 * @typedef {import('../../../core/src/loader/model.js').AssetNode} AssetNode
 * @typedef {import('../../../core/src/loader/model.js').ProjectNode} ProjectNode
 * @typedef {import('../../../core/src/fs/filesystem.js').LerretPath} LerretPath
 */

// ---------------------------------------------------------------------------
// Shared error boundary
// ---------------------------------------------------------------------------
//
// A load/evaluate failure is caught by the runtime and surfaced as an
// `error` record. A *render-time* throw, though, happens later — inside React,
// when the canvas renders the component. This boundary catches that case so a
// single broken asset fails inside its own artboard instead of unmounting the
// whole canvas (architecture: "a React error boundary per artboard", NFR8).
//
// It is part of the runtime interface module — not the canvas — because the
// "contain a render throw and surface it as an `AssetError`" guarantee belongs
// to the runtime contract: a caller wrapping every `Component` in this boundary
// gets the same per-asset isolation whatever the deploy mode.

/**
 * A React error boundary that contains a render-time throw from a single
 * asset's component and reports it as a structured {@link AssetError}.
 *
 * Wrap each entry's `Component` in one of these. On a caught render error it
 * renders `props.fallback` (or `null`) instead of the subtree, and calls
 * `props.onError(assetError)` once with a `phase: 'render'` error — letting the
 * caller flip its record to `status: 'error'`. supplies the actual
 * error-card as `fallback`.
 *
 * `resetKey` lets a caller clear a previously-caught error: when it changes
 * (e.g. the asset was edited and reloaded), the boundary drops its
 * error state and re-renders `children`.
 *
 * @augments {React.Component<{
 * children?: React.ReactNode,
 * fallback?: React.ReactNode,
 * onError?: (error: AssetError) => void,
 * resetKey?: unknown,
 * }, { error: AssetError | null }>}
 */
export class AssetErrorBoundary extends React.Component {
 constructor(props) {
 super(props);
 /** @type {{ error: AssetError | null }} */
 this.state = { error: null };
 }

 /**
 * React calls this on a child throw to derive the next error state.
 * @param {unknown} thrown
 * @returns {{ error: AssetError }}
 */
 static getDerivedStateFromError(thrown) {
 return { error: toAssetError(thrown, 'render') };
 }

 /**
 * Side-effect hook — surface the structured error to the caller exactly
 * once per catch.
 * @param {unknown} thrown
 */
 componentDidCatch(thrown) {
 if (typeof this.props.onError === 'function') {
 this.props.onError(toAssetError(thrown, 'render'));
 }
 }

 /**
 * Clear a caught error when `resetKey` changes — the asset was reloaded, so
 * give its component a fresh chance to render.
 * @param {{ resetKey?: unknown }} prevProps
 */
 componentDidUpdate(prevProps) {
 if (this.state.error !== null && prevProps.resetKey !== this.props.resetKey) {
 this.setState({ error: null });
 }
 }

 render() {
 if (this.state.error !== null) {
 // `fallback` may be `undefined`; React renders `undefined` as nothing,
 // but normalize to `null` so the contract ("renders fallback or null")
 // is explicit.
 return this.props.fallback ?? null;
 }
 return this.props.children ?? null;
 }
}

// ---------------------------------------------------------------------------
// Record constructors — used by every runtime implementation
// ---------------------------------------------------------------------------
//
// Building an `AssetEntry` in exactly one place keeps the shape consistent
// across the CLI runtime, the future hosted runtime, and tests.

/**
 * Build an `'ok'` {@link AssetEntry} for a successfully-loaded asset.
 *
 * This builds a *primary* (default-export) entry with no variant or `meta`
 * information — the single-artboard case. The {@link makeVariantEntry}
 * is the variant-aware constructor; this one is kept for the simple case
 * and for tests.
 *
 * @param {AssetNode} asset The source asset node.
 * @param {React.ComponentType<any>} Component The component to render.
 * @returns {AssetEntry}
 */
export function makeOkEntry(asset, Component) {
 return {
 id: asset.path,
 asset,
 assetKind: asset.assetKind,
 status: assetRuntimeStatus.OK,
 Component,
 error: null,
 label: asset.name,
 };
}

/**
 * Build an `'ok'` {@link AssetEntry} for one *variant* of a successfully-loaded
 * asset — the variant path. A single asset file resolves to 1..N of these,
 * one per component-valued export.
 *
 * The entry's identity, label, dimensions, and tags are derived from the
 * variant descriptor and the asset's parsed `meta`:
 * - `id` is the asset path for the primary (default-export) variant, and
 * `"<path>#<variantName>"` for a named-export variant — so every artboard
 * across the canvas has a stable, unique id.
 * - `label` is `meta.label` when present; otherwise the asset's `name` for
 * the primary variant, or `"<name> · <variantName>"` for a named variant.
 * - `dimensions` / `tags` / `meta` carry the parsed `meta` straight through.
 *
 * @param {AssetNode} asset
 * The source asset node the variant belongs to.
 * @param {import('../../../core/src/assets/variants.js').AssetVariant} variant
 * The resolved variant descriptor (export name, component, primary flag).
 * @param {import('../../../core/src/assets/meta.js').AssetMeta} meta
 * The asset's parsed `meta` — shared by every variant of the same file.
 * @returns {AssetEntry}
 */
export function makeVariantEntry(asset, variant, meta) {
 const isPrimary = variant.isPrimary;
 // A named-export variant gets a `#variant` suffix so its artboard id is
 // unique among the file's variants; the primary variant keeps the bare path.
 const id = isPrimary ? asset.path : `${asset.path}#${variant.variantName}`;
 // Label precedence: an explicit `meta.label` wins; else fall back to a name
 // derived from the asset (primary) or the asset + export name (a variant).
 const fallbackLabel = isPrimary
 ? asset.name
 : `${asset.name} · ${variant.variantName}`;
 return {
 id,
 asset,
 assetKind: asset.assetKind,
 status: assetRuntimeStatus.OK,
 Component: variant.component,
 error: null,
 label: meta.label || fallbackLabel,
 variantName: variant.variantName,
 dimensions: meta.dimensions,
 tags: meta.tags,
 meta,
 };
}

/**
 * Build an `'ok'` {@link AssetEntry} for a markdown (`.md`) asset — the
 * path. A `.md` file is not loaded as a module; the runtime reads
 * its **raw text** and this constructor turns that text into a renderable
 * entry whose `Component` draws the {@link MarkdownAssetCard} document card.
 *
 * The contract stays uniform with component entries: `Component` is still the
 * single "what to render" field, so the canvas renders a markdown entry with
 * exactly the same `<Component />` call it uses for a component artboard — it
 * never branches on `assetKind`. The raw `text` is also carried on the entry
 * (for a later Markdown editor / re-render). One `.md` file yields exactly one
 * entry. An empty `.md` is NOT an error — the card renders an empty document.
 *
 * @param {AssetNode} asset The source markdown asset node.
 * @param {string} text The `.md` file's raw Markdown source.
 * @returns {AssetEntry}
 */
export function makeMarkdownEntry(asset, text) {
 const source = typeof text === 'string' ? text : '';
 // A zero-arg component bound to this asset's text — so the canvas's uniform
 // `<entry.Component />` render path works for markdown with no special case.
 const MarkdownEntryCard = () => React.createElement(MarkdownAssetCard, { text: source });
 MarkdownEntryCard.displayName = `MarkdownAssetCard(${asset.fileName})`;
 return {
 id: asset.path,
 asset,
 assetKind: asset.assetKind,
 status: assetRuntimeStatus.OK,
 Component: MarkdownEntryCard,
 error: null,
 label: asset.name,
 text: source,
 };
}

/**
 * Build an `'error'` {@link AssetEntry} for an asset that failed to load or
 * evaluate. The artboard still appears on the canvas — as an error card —
 * rather than vanishing.
 *
 * @param {AssetNode} asset The source asset node.
 * @param {AssetError} error The structured failure.
 * @returns {AssetEntry}
 */
export function makeErrorEntry(asset, error) {
 return {
 id: asset.path,
 asset,
 assetKind: asset.assetKind,
 status: assetRuntimeStatus.ERROR,
 Component: null,
 error,
 label: asset.name,
 };
}
