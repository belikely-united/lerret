// artboard-kebab.jsx — kebab wrapper around a single artboard's content
//. Replaces the temporary `EditableComponentArtboard` and
// `EditableMarkdownCard` triggers from Stories 3.4 / 3.7.
//
// ── What this does ──────────────────────────────────────────────────────────
// 1. Wraps the artboard's rendered content (component or markdown card).
// 2. Mounts the per-entity kebab trigger on top-right of the card.
// 3. Owns the editor-host (Data + Meta for components, Markdown for `.md`).
// 4. Owns the delete-confirm inline UI state.
// 5. For COMPONENT entries — preserves the data-fetch / prop-resolve / validation
// behavior the old `EditableComponentArtboard` had. The artboard's rendered
// component still wakes up with resolved data, the validation badge still
// fires, and click-to-fix still opens the Data editor.
//
// The kebab itself is `<EntityKebab>` from `entity-kebab.jsx`; this file is
// just the call site that glues that menu to a single artboard.
//
// ── Source-edit contract (— FR25) ────────────────────────────────
// The studio is VIEW-ONLY for component code by default. There is no in-studio
// component-code editor and no property panel for component source. The correct
// source-edit path is:
// 1. The user (or an AI tool) edits the component's .jsx/.tsx file externally.
// 2. The chokidar watcher in the CLI server detects the change and emits
// `lerret:change` via the Vite HMR channel.
// 3. The live-reload loop in `asset-artboard.jsx` picks up the
// event and re-renders the affected artboard with the updated component.
//
// The in-studio editors are for DATA (.data.json), CONFIG (config.json),
// META (the `meta` export in the source file), and MARKDOWN (.md)
// content — never for component code itself.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { resolveProps, resolveVariantData, validateProps, serializeJson, assetConfigPath } from '@lerret/core';

import { ValidationBadge } from '../badge/validation-badge.jsx';
import {
 ContextMenu,
 EntityKebab,
 ComponentEditorHost,
 MarkdownEditorHost,
 MovePicker,
 applyDeleteConfirm,
 buildComponentItems,
 buildMarkdownItems,
 destroy,
 duplicate,
 inCliMode,
 move,
 reveal,
 useContextMenu,
} from '../menu/index.js';
import { AnimatedExportDialog } from '../export/animated-export-dialog.jsx';
import { useCascadedConfig } from './cascade-context.jsx';
import { useAssetConfig } from './asset-config-context.jsx';
import { bindOneShotRename } from './use-inline-rename.js';
import { onLerretChange } from '../../runtime/cli-hmr.js';
import {
 LiveRefreshBadge,
 LiveRefreshPopover,
 nextAssetConfig,
 formatRate,
} from './live-refresh-control.jsx';
import { suspendLiveRefresh } from './live-refresh-suspend.js';
import { SizeBadge, SizePopover } from './size-control.jsx';
import { writeProjectFile, deleteProjectFile } from '../../runtime/write-client.js';
import { rewriteMetaExport } from '../editors/meta-source-rewriter.js';
import { defaultReadAssetSource } from '../editors/meta-editor.jsx';

/**
 * Derive the parent folder LerretPath for an asset path. Strips the file
 * basename. Returns `''` for a bare filename (no path components).
 *
 * @param {string | undefined | null} assetPath
 * @returns {string}
 */
function parentFolderOf(assetPath) {
 if (typeof assetPath !== 'string') return '';
 const slash = assetPath.lastIndexOf('/');
 return slash === -1 ? '' : assetPath.slice(0, slash);
}

function findArtboardElement(slotId) {
 if (typeof document === 'undefined' || !slotId) return null;
 const escaped = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(slotId) : String(slotId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
 return (
  document.querySelector(`[data-dc-slot="${escaped}"] [data-asset-id]`) ||
  document.querySelector(`[data-asset-id="${escaped}"]`) ||
  document.querySelector(`[data-dc-slot="${escaped}"]`)
 );
}

export function liveRefreshIntervalFor(entry, getAssetConfig) {
 if (!entry?.asset?.path) return undefined;
 // Only COMPONENT assets are eligible — the manager gates timers on assetKind,
 // and animated export only makes sense for components. Guarding here keeps a
 // stray `autoRefresh` on a markdown card from lighting up the ANIM button.
 if (entry.assetKind && entry.assetKind !== 'component') return undefined;
 if (typeof getAssetConfig !== 'function') return undefined;
 // The interval lives in the asset's own `Name.config.json` (ADR-003), surfaced
 // per asset-path via `getAssetConfig`. No folder lookup, no name-matching.
 const cfg = getAssetConfig(entry.asset.path);
 const value = cfg && typeof cfg === 'object' ? cfg.autoRefresh : undefined;
 return typeof value === 'number' && value > 0 ? value : undefined;
}

// ── CSS injection ────────────────────────────────────────────────────────────
//
// The host wraps the rendered component inside the dc-card. The kebab itself
// is portaled OUT of the host into the artboard's brownfield `.dc-labelrow`
// (rendered above the card by design-canvas.jsx), so it sits in the same row
// as the drag-grip and the asset's title — alongside the asset's identity
// controls rather than overlaying the asset's content. The kebab is always
// visible (user choice, see spec change log 2026-05-22) so identical labels
// stay readable next to it.

if (typeof document !== 'undefined' && !document.getElementById('lm-artboard-kebab-styles')) {
 const s = document.createElement('style');
 s.id = 'lm-artboard-kebab-styles';
 s.textContent = `
.lm-artboard-kebab-host {
 position: relative;
 width: 100%;
 height: 100%;
}
.lm-artboard-kebab {
 /* Portaled into .dc-labelrow as an inline flex child.
    margin-left: auto pushes the kebab to the right edge of the labelrow
    (now stretched to the card width). Right-side cluster order, L to R:
    [ANIM*][JPG][PNG][expand][kebab]. */
 display: inline-flex;
 align-items: center;
 gap: 6px;
 margin-left: auto;
 z-index: 5;
 /* Counter-scale with the canvas zoom so the chip cluster (validation / size /
    auto-refresh / kebab) stays a constant screen size. --dc-inv (= 1/scale) is
    published per-slot by DCArtboardFrame; right-bottom origin keeps it pinned to
    the artboard's top-right corner. */
 transform: scale(var(--dc-inv, 1));
 transform-origin: right bottom;
}
 `.trim();
 document.head.appendChild(s);
}

/**
 * Find the brownfield `.dc-labelrow` element that pairs with the given host
 * element. Walks up to the `[data-dc-slot]` wrapper, then queries for the
 * label row inside it. Returns `null` if either is missing (e.g. during
 * initial mount before the brownfield frame renders).
 *
 * @param {Element | null} hostEl
 * @returns {Element | null}
 */
function findLabelRow(hostEl) {
 let cur = hostEl;
 while (cur && !(cur.hasAttribute && cur.hasAttribute('data-dc-slot'))) {
 cur = cur.parentElement;
 }
 if (!cur) return null;
 return cur.querySelector(':scope > .dc-labelrow') || cur.querySelector('.dc-labelrow');
}

// ── Per-artboard export — reuses the brownfield window.dcDownloadSlots ──────
//
// The brownfield design-canvas exposes `window.dcDownloadSlots(slots, fmt)`
// for any host to drive a per-artboard PNG capture. Per-slot is the same
// mechanism the dc-dl PNG/JPG buttons use, so the kebab's "Export" item is
// indistinguishable behaviour-wise from the existing per-artboard PNG button.

/**
 * Capture a single artboard's slot as PNG via the brownfield helper.
 *
 * @param {string} artboardId The slot id (matches `data-dc-slot`).
 * @returns {Promise<void>}
 */
async function exportArtboardSlot(artboardId) {
 if (typeof document === 'undefined') return;
 const slot = document.querySelector(`[data-dc-slot="${cssEscape(artboardId)}"]`);
 if (!slot) {
 console.warn('[lerret] export: no slot for', artboardId);
 return;
 }
 if (typeof window === 'undefined' || typeof window.dcDownloadSlots !== 'function') {
 console.warn('[lerret] export: window.dcDownloadSlots unavailable');
 return;
 }
 await window.dcDownloadSlots([slot], 'png');
}

function cssEscape(value) {
 if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
 return String(value).replace(/[^\w-]/g, '\\$&');
}

// ── Data-fetch helper ────────────────────────────────────────────────────────

/**
 * The default dynamic-import implementation used by {@link fetchDataValue}.
 * Wrapped with `@vite-ignore` so Vite does not try to pre-bundle the runtime-
 * computed URL. Exposed via the `importModule` injection seam below so tests
 * can swap a deterministic fake in jsdom.
 *
 * @param {string} url
 * @returns {Promise<unknown>}
 */
const defaultImportModule = (url) => import(/* @vite-ignore */ url);

/**
 * Best-effort load of the asset's co-located `.data.json` file. Used by the
 * component-artboard wrapper to drive prop resolution for the rendered
 * component.
 *
 * Uses dynamic `import()` rather than `fetch()` so that the Vite alias
 * `'/@lerret-project'` (and `'/@fixture-lerret'`) — declared by
 * `vite-plugin-lerret-project.js` and the standalone fixture wiring — is
 * honored. Vite's `resolve.alias` is applied to module-imports only;
 * a raw `fetch()` against the same URL bypasses the alias and falls through
 * to the studio's SPA `index.html` (200 text/html), silently masking the
 * data file. Vite serves `.json` files as ES modules whose default export
 * is the parsed value.
 *
 * A `?t=<timestamp>` query is appended to defeat the module-import cache,
 * matching the `studio/runtime/data-loader.js` reload-token convention so
 * each call re-evaluates the current file.
 *
 * Returns `{}` on every failure mode (file missing, parse error, alias not
 * configured) — the caller treats `{}` as "no Tier-1 data" and the
 * propsSchema defaults take over for that render.
 *
 * @param {string} dataPath
 *   The asset's `.data.json` file path on disk (absolute, with `.lerret/`
 *   somewhere in the prefix). The substring after `/.lerret/` becomes the
 *   URL leaf appended to each candidate base.
 * @param {object} [deps]
 *   Test-only injection seam.
 * @param {(url: string) => Promise<unknown>} [deps.importModule]
 *   Override the dynamic import — used by unit tests to assert URL shape
 *   without booting a real Vite server.
 * @returns {Promise<Record<string, unknown>>}
 *   The parsed JSON value, or `{}` when the file could not be loaded.
 */
export async function fetchDataValue(dataPath, deps = {}) {
 const idx = dataPath.indexOf('/.lerret/');
 const rel = idx === -1 ? dataPath.replace(/^\/+/, '') : dataPath.slice(idx + '/.lerret/'.length);
 const bust = `?t=${Date.now()}`;
 const importModule = deps.importModule || defaultImportModule;
 for (const base of ['/@lerret-project', '/@fixture-lerret']) {
 try {
 const mod = await importModule(`${base}/${rel}${bust}`);
 // Vite serves `.json` files as ES modules where the default export is
 // the parsed value. Some bundlers expose the value at the top level
 // instead — handle both shapes defensively.
 const value = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
 if (value && typeof value === 'object') return value;
 return {};
 } catch {
 // The import rejected — most commonly the file does not exist at this
 // base (404), or the URL did not match either alias. Try the next base.
 }
 }
 return {};
}

function computeResolvedProps(entry, dataValue) {
 const variantName = entry?.variantName || 'default';
 const propsSchema = entry?.meta?.propsSchema;
 const syntheticAssetData = dataValue && typeof dataValue === 'object'
 ? { source: 'json', value: dataValue }
 : { source: 'absent' };
 const variantMap = resolveVariantData(syntheticAssetData, [variantName]);
 const record = variantMap.get(variantName);
 const data = record && record.source !== 'absent' ? record.value : undefined;
 return resolveProps({ data, propsSchema });
}

// ── ComponentArtboardKebab ──────────────────────────────────────────────────

/**
 * Wraps a single component artboard: renders the wrapped component with
 * resolved props, overlays the validation badge + the kebab menu, and mounts
 * Data + Meta editor hosts that the kebab toggles.
 *
 * This is the direct replacement for the previous `EditableComponentArtboard`
 * (now removed).
 *
 * @param {object} props
 * @param {object} props.entry The runtime `AssetEntry` (a component variant).
 * @param {(props: Record<string, unknown>) => React.ReactNode} props.renderComponent
 * The brownfield-friendly render-prop: receives resolved props, returns the
 * wrapped component (already inside an AssetErrorBoundary).
 * @param {React.ReactNode} [props.children]
 * Optional siblings rendered after the component (the re-render cue overlay).
 * @returns {React.ReactElement}
 */
export function ComponentArtboardKebab({ entry, renderComponent, children }) {
 const [dataOpen, setDataOpen] = React.useState(false);
 const [metaOpen, setMetaOpen] = React.useState(false);
 const [confirming, setConfirming] = React.useState(false);

 // Click-to-fix support (validation badge).
 const [focusField, setFocusField] = React.useState(undefined);
 const [focusVariant, setFocusVariant] = React.useState(undefined);

 // Data fetch (same logic as the removed `EditableComponentArtboard`).
 const [dataValue, setDataValue] = React.useState(null);
 const dataPath = React.useMemo(() => {
 const asset = entry?.asset;
 if (!asset || typeof asset.path !== 'string') return null;
 const slash = asset.path.lastIndexOf('/');
 const dir = slash === -1 ? '' : asset.path.slice(0, slash + 1);
 return `${dir}${asset.name}.data.json`;
 }, [entry]);

 React.useEffect(() => {
 if (!dataPath) return undefined;
 let cancelled = false;
 const reload = async () => {
 const value = await fetchDataValue(dataPath);
 if (!cancelled) setDataValue(value);
 };
 reload();
 // Re-fetch this asset's `.data.json` when the CLI watcher reports it
 // changed. Subscribed via `onLerretChange` (not `import.meta.hot`) so live
 // data edits keep working from the pre-built `dist-studio` bundle the
 // published CLI serves — see `runtime/cli-hmr.js`.
 const unsubscribe = onLerretChange((payload) => {
 if (!payload || !payload.event || typeof payload.event.path !== 'string') return;
 if (payload.event.path === dataPath) reload();
 });
 return () => {
 cancelled = true;
 unsubscribe();
 };
 }, [dataPath, entry?.id, entry?.Component]);

 const resolvedProps = React.useMemo(
 () => computeResolvedProps(entry, dataValue),
 [entry, dataValue],
 );
 const propsSchema = entry?.meta?.propsSchema || null;
 const failedFields = React.useMemo(
 () => validateProps(resolvedProps, propsSchema ?? {}),
 [resolvedProps, propsSchema],
 );

 // badge → click-to-fix.
 const handleBadgeClick = React.useCallback(() => {
 const firstProp = failedFields.length > 0 ? failedFields[0].prop : undefined;
 setFocusField(firstProp);
 setFocusVariant(entry?.variantName || undefined);
 setDataOpen(true);
 }, [failedFields, entry?.variantName]);

 // Rename: focus the brownfield inline-rename affordance AND bind a one-shot
 // listener that captures the next commit (blur / Enter) and calls
 // `renameProjectFile` so the change lands on disk. The brownfield's own
 // patchSection already updates the in-studio label — we ride along.
 const onRename = React.useCallback(() => {
 if (typeof document === 'undefined') return;
 const slotId = entry?.id;
 const assetPath = entry?.asset?.path;
 if (!slotId || !assetPath) return;
 const slot = document.querySelector(`[data-dc-slot="${cssEscape(slotId)}"]`);
 if (!slot) return;
 const editable = slot.querySelector('.dc-labeltext .dc-editable');
 if (!editable || typeof editable.focus !== 'function') return;
 editable.focus();
 const range = document.createRange();
 range.selectNodeContents(editable);
 const sel = window.getSelection();
 sel.removeAllRanges();
 sel.addRange(range);
 // Attach a one-shot listener for the next commit so the file is renamed
 // on blur / Enter.
 bindOneShotRename(editable, { fromPath: assetPath, kind: 'file' });
 }, [entry]);

 const onDuplicate = React.useCallback(async () => {
 const path = entry?.asset?.path;
 if (!path) return;
 await duplicate(path);
 // Watcher → loader patcher → fresh project → canvas re-renders with
 // the new file automatically. No client-side projection needed.
 }, [entry]);

 const [moveOpen, setMoveOpen] = React.useState(false);
 const onMove = React.useCallback(() => {
 if (!entry?.asset?.path) return;
 setMoveOpen(true);
 }, [entry]);

 const onDelete = React.useCallback(() => {
 setConfirming(true);
 }, []);
 const onCancelDelete = React.useCallback(() => setConfirming(false), []);
 const onConfirmDelete = React.useCallback(async () => {
 setConfirming(false);
 const path = entry?.asset?.path;
 if (!path) return;
 await destroy(path);
 }, [entry]);

 const onExport = React.useCallback(() => {
 if (!entry?.id) return;
 exportArtboardSlot(entry.id);
 }, [entry]);

 // Animated-export dialog open/close — Story 7.7.
 const [animatedDialogOpen, setAnimatedDialogOpen] = React.useState(false);
 const getConfigFor = useCascadedConfig();
 const onExportAnimated = React.useCallback(() => {
 setAnimatedDialogOpen(true);
 }, []);

 // Bridge: the standalone ANIM export button (rendered by design-canvas.jsx
 // in the right-edge cluster, gated on liveRefresh) dispatches a window event
 // when clicked. Open this artboard's dialog if the event names our slot.
 React.useEffect(() => {
 if (typeof window === 'undefined') return undefined;
 const slotId = entry?.id;
 if (!slotId) return undefined;
 const onOpen = (e) => {
 if (e?.detail?.slotId === slotId) setAnimatedDialogOpen(true);
 };
 window.addEventListener('lerret:openAnimatedDialog', onOpen);
 return () => window.removeEventListener('lerret:openAnimatedDialog', onOpen);
 }, [entry?.id]);

 // ── Auto-refresh (on-artboard rate control, ADR-003) ─────────────────────────
 // The interval lives in the asset's own `Name.config.json` (`{ autoRefresh }`),
 // surfaced per asset-path via `useAssetConfig`. Drives the label-row badge and
 // the picker's active chip; undefined = off.
 const getAssetConfig = useAssetConfig();
 const liveRefreshMs = React.useMemo(
 () => liveRefreshIntervalFor(entry, getAssetConfig),
 [entry, getAssetConfig],
 );
 const [liveRefreshOpen, setLiveRefreshOpen] = React.useState(false);
 const clusterRef = React.useRef(null);
 const onLiveRefresh = React.useCallback(() => setLiveRefreshOpen(true), []);

 // Pause refresh ticks while the picker is open so the artboard doesn't reload
 // underneath the popover (matches the animated-export / move dialogs).
 React.useEffect(() => {
 if (!liveRefreshOpen) return undefined;
 const release = suspendLiveRefresh();
 return release;
 }, [liveRefreshOpen]);

 // Apply a rate change by writing the asset's own `Name.config.json`. Merge onto
 // the current config (preserving any other keys, read from the in-memory map —
 // no disk round-trip); an emptied config deletes the file. The chokidar watcher
 // re-reads it and the badge / timer / ANIM button update.
 const handleSelectRate = React.useCallback(
 async (ms) => {
 const asset = entry?.asset;
 if (!asset?.path || !asset?.name) {
 setLiveRefreshOpen(false);
 return;
 }
 const configPath = assetConfigPath(asset);
 const nextCfg = nextAssetConfig(getAssetConfig(asset.path), ms);
 if (Object.keys(nextCfg).length === 0) {
 await deleteProjectFile(configPath);
 } else {
 await writeProjectFile(configPath, serializeJson(nextCfg));
 }
 setLiveRefreshOpen(false);
 },
 [entry, getAssetConfig],
 );

 // ── Canvas size (on-artboard meta.dimensions control) ────────────────────────
 // Dimensions live in `meta` (code) but are buried under "Edit meta". Surface
 // them as a label-row chip + picker that writes back through the exact same
 // source-rewrite the meta editor uses — dimensions stay source-of-truth.
 const metaDims = entry?.meta?.dimensions || {};
 const [sizeOpen, setSizeOpen] = React.useState(false);
 const onEditSize = React.useCallback(() => setSizeOpen(true), []);

 // Pause refresh ticks while the size picker is open (same as the rate picker).
 React.useEffect(() => {
 if (!sizeOpen) return undefined;
 return suspendLiveRefresh();
 }, [sizeOpen]);

 const handleApplySize = React.useCallback(
 async ({ width, height }) => {
 const asset = entry?.asset;
 const meta = entry?.meta || {};
 if (!asset?.path) {
 setSizeOpen(false);
 return;
 }
 const read = await defaultReadAssetSource(asset.path);
 if (read.ok && typeof read.source === 'string') {
 // Change ONLY dimensions; pass the existing label/tags so they are
 // preserved (undefined drops the key) and propsSchema stays verbatim —
 // the same nextMeta contract the meta editor commits.
 const rewrite = rewriteMetaExport(read.source, {
 dimensions: { width, height },
 label: meta.label,
 tags: meta.tags,
 });
 if (rewrite.ok) await writeProjectFile(asset.path, rewrite.source);
 }
 setSizeOpen(false);
 },
 [entry],
 );

 const onRevealEditor = React.useCallback(() => {
 if (entry?.asset?.path) reveal(entry.asset.path, 'editor');
 }, [entry]);
 const onRevealFinder = React.useCallback(() => {
 if (entry?.asset?.path) reveal(entry.asset.path, 'finder');
 }, [entry]);

 const cliMode = inCliMode();

 const baseItems = React.useMemo(
 () => buildComponentItems({
 onEditData: () => {
 setFocusField(undefined);
 setFocusVariant(undefined);
 setDataOpen(true);
 },
 onEditMeta: () => setMetaOpen(true),
 onLiveRefresh,
 liveRefreshLabel:
 liveRefreshMs != null ? `Auto-refresh · ${formatRate(liveRefreshMs)}` : 'Auto-refresh…',
 onDuplicate,
 onRename,
 onMove,
 onDelete,
 onExport,
 onExportAnimated,
 onRevealEditor,
 onRevealFinder,
 cliMode,
 }),
 [onLiveRefresh, liveRefreshMs, onDuplicate, onRename, onMove, onDelete, onExport, onExportAnimated, onRevealEditor, onRevealFinder, cliMode],
 );

 const items = React.useMemo(
 () => applyDeleteConfirm(baseItems, {
 confirming,
 onConfirmDelete,
 onCancelDelete,
 }),
 [baseItems, confirming, onConfirmDelete, onCancelDelete],
 );

 const ariaLabel = `Actions for ${entry?.label || entry?.asset?.name || 'this asset'}`;

 // Right-click anywhere on the artboard opens the SAME action set as the kebab.
 const ctx = useContextMenu();

 // Locate the brownfield label row to portal the kebab into. Walks up from
 // our host to the data-dc-slot wrapper, then finds the .dc-labelrow inside.
 // useLayoutEffect runs synchronously after DOM mutations so the portal
 // target is current before paint.
 const hostRef = React.useRef(null);
 const [labelRowEl, setLabelRowEl] = React.useState(null);
 React.useLayoutEffect(() => {
 setLabelRowEl(findLabelRow(hostRef.current));
 }, [entry?.id]);

 // Reserve room for the always-visible right cluster (size chip + auto-refresh
 // badge + kebab) so the hover action buttons (ANIM/JPG/PNG/expand) — absolutely
 // positioned at fixed right offsets — never overlap it. We publish the cluster's
 // measured width as `--dc-cluster-w` on the slot; design-canvas offsets each
 // hover button from it. `offsetWidth` is layout px (transform-independent), so
 // this stays correct at any zoom. The size chip is always present, so we always
 // measure; a ResizeObserver keeps it current as the badge/dims change width.
 React.useLayoutEffect(() => {
 const slot = hostRef.current ? hostRef.current.closest('[data-dc-slot]') : null;
 if (!slot) return undefined;
 const apply = () => {
 const cluster = clusterRef.current;
 if (cluster) {
 slot.style.setProperty('--dc-cluster-w', `${cluster.offsetWidth}px`);
 } else {
 slot.style.removeProperty('--dc-cluster-w');
 }
 };
 apply();
 const cluster = clusterRef.current;
 if (!cluster || typeof ResizeObserver === 'undefined') return undefined;
 const ro = new ResizeObserver(apply);
 ro.observe(cluster);
 return () => ro.disconnect();
 }, [liveRefreshMs, labelRowEl]);

 const kebab = (
 <div ref={clusterRef} className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <ValidationBadge failedFields={failedFields} propsSchema={propsSchema} onClick={handleBadgeClick} />
 <SizeBadge width={metaDims.width} height={metaDims.height} onActivate={onEditSize} />
 {liveRefreshMs != null && (
 <LiveRefreshBadge rateMs={liveRefreshMs} onActivate={onLiveRefresh} />
 )}
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-end" />
 </div>
 );

 // Build the destination list for the Move-to picker. We derive it lazily
 // when the picker is open so we don't allocate a Map walk on every render.
 // `knownFolders` is attached to the cascade's `getConfigFor` (see
 // cascade-context.jsx). When no cascade exists we still return [] and the
 // picker shows its empty-state.
 const sourcePath = entry?.asset?.path || '';
 const parentPath = parentFolderOf(sourcePath);

 const destinations = React.useMemo(() => {
 if (!moveOpen) return [];
 const knownFolders =
 typeof getConfigFor.knownFolders === 'function' ? getConfigFor.knownFolders() : [];
 return knownFolders.map((p) => ({ path: p, label: p.split('/').filter(Boolean).pop() || p }));
 }, [moveOpen, getConfigFor]);

 const onConfirmMove = React.useCallback(
 async ({ toFolderPath }) => {
 if (!sourcePath || !toFolderPath) return;
 // `move()` resolves with `{ ok, error }` rather than throwing. Re-throw on
 // `!ok` so MovePicker's catch surfaces the error inline (otherwise the
 // picker would close silently on 400 cycle / 409 collision / 500 fs-fail,
 // breaking the spec's AC4 / AC5 / AC6 user-visible-error promise).
 const result = await move(sourcePath, toFolderPath);
 if (!result?.ok) throw new Error(result?.error || 'Move failed');
 // Watcher → loader patcher → canvas re-renders automatically.
 },
 [sourcePath],
 );

 return (
 <div ref={hostRef} className="lm-artboard-kebab-host" onContextMenu={ctx.openAt}>
 {ctx.open && <ContextMenu point={ctx.point} items={items} onClose={ctx.close} />}
 {renderComponent(resolvedProps)}
 {children}
 {labelRowEl ? ReactDOM.createPortal(kebab, labelRowEl) : null}
 <ComponentEditorHost
 dataOpen={dataOpen}
 onCloseData={() => setDataOpen(false)}
 metaOpen={metaOpen}
 onCloseMeta={() => setMetaOpen(false)}
 entry={entry}
 initialFocusField={focusField}
 initialActiveVariant={focusVariant}
 />
 {animatedDialogOpen && (
 <AnimatedExportDialog
 element={findArtboardElement(entry?.id)}
 assetName={entry?.label || entry?.asset?.name || 'artboard'}
 dimensions={entry?.meta?.dimensions || { width: 1280, height: 720 }}
 persistKey={entry?.id}
 onClose={() => setAnimatedDialogOpen(false)}
 />
 )}
 {liveRefreshOpen && (
 <LiveRefreshPopover
 anchorEl={clusterRef.current}
 valueMs={liveRefreshMs}
 disabled={!cliMode}
 disabledReason="Auto-refresh editing needs `@lerret/cli dev`."
 onSelect={handleSelectRate}
 onClose={() => setLiveRefreshOpen(false)}
 />
 )}
 {sizeOpen && (
 <SizePopover
 anchorEl={clusterRef.current}
 width={metaDims.width}
 height={metaDims.height}
 disabled={!cliMode}
 disabledReason="Resizing needs `@lerret/cli dev`."
 onSelect={handleApplySize}
 onClose={() => setSizeOpen(false)}
 />
 )}
 {moveOpen && (
 <MovePicker
 onClose={() => setMoveOpen(false)}
 onConfirm={onConfirmMove}
 sourcePath={sourcePath}
 currentParentPath={parentPath}
 destinations={destinations}
 />
 )}
 </div>
 );
}

/**
 * Markdown-card kebab wrapper. The markdown card itself is unchanged — this
 * just adds the kebab + the inline confirm + the editor host. Direct
 * replacement for `EditableMarkdownCard`.
 *
 * @param {object} props
 * @param {object} props.entry The runtime `AssetEntry` for the `.md` asset.
 * @param {React.ReactNode} props.children The rendered markdown card node.
 * @returns {React.ReactElement}
 */
export function MarkdownCardKebab({ entry, children }) {
 const [open, setOpen] = React.useState(false);
 const [confirming, setConfirming] = React.useState(false);
 const [moveOpen, setMoveOpen] = React.useState(false);
 const getConfigFor = useCascadedConfig();

 // Bridge: the standalone EDIT button (rendered by design-canvas.jsx in the
 // markdown card's right-edge cluster) dispatches a window event when clicked.
 // Open this card's editor sheet if the event names our slot — same pattern as
 // the ANIM bridge in ComponentArtboardKebab.
 React.useEffect(() => {
 if (typeof window === 'undefined') return undefined;
 const slotId = entry?.id;
 if (!slotId) return undefined;
 const onOpen = (e) => { if (e?.detail?.slotId === slotId) setOpen(true); };
 window.addEventListener('lerret:openMarkdownEditor', onOpen);
 return () => window.removeEventListener('lerret:openMarkdownEditor', onOpen);
 }, [entry?.id]);

 const onRename = React.useCallback(() => {
 if (typeof document === 'undefined') return;
 const slotId = entry?.id;
 const assetPath = entry?.asset?.path;
 if (!slotId || !assetPath) return;
 const slot = document.querySelector(`[data-dc-slot="${cssEscape(slotId)}"]`);
 if (!slot) return;
 const editable = slot.querySelector('.dc-labeltext .dc-editable');
 if (!editable || typeof editable.focus !== 'function') return;
 editable.focus();
 const range = document.createRange();
 range.selectNodeContents(editable);
 const sel = window.getSelection();
 sel.removeAllRanges();
 sel.addRange(range);
 bindOneShotRename(editable, { fromPath: assetPath, kind: 'file' });
 }, [entry]);

 const onDuplicate = React.useCallback(async () => {
 const path = entry?.asset?.path;
 if (path) await duplicate(path);
 }, [entry]);

 const onMove = React.useCallback(() => {
 if (!entry?.asset?.path) return;
 setMoveOpen(true);
 }, [entry]);

 const onDelete = React.useCallback(() => setConfirming(true), []);
 const onCancelDelete = React.useCallback(() => setConfirming(false), []);
 const onConfirmDelete = React.useCallback(async () => {
 setConfirming(false);
 const path = entry?.asset?.path;
 if (path) await destroy(path);
 }, [entry]);

 const onExport = React.useCallback(() => {
 if (entry?.id) exportArtboardSlot(entry.id);
 }, [entry]);

 const onRevealEditor = React.useCallback(() => {
 if (entry?.asset?.path) reveal(entry.asset.path, 'editor');
 }, [entry]);
 const onRevealFinder = React.useCallback(() => {
 if (entry?.asset?.path) reveal(entry.asset.path, 'finder');
 }, [entry]);

 const cliMode = inCliMode();

 const baseItems = React.useMemo(
 () => buildMarkdownItems({
 onEdit: () => setOpen(true),
 onDuplicate,
 onRename,
 onMove,
 onDelete,
 onExport,
 onRevealEditor,
 onRevealFinder,
 cliMode,
 }),
 [onDuplicate, onRename, onMove, onDelete, onExport, onRevealEditor, onRevealFinder, cliMode],
 );

 const items = React.useMemo(
 () => applyDeleteConfirm(baseItems, {
 confirming,
 onConfirmDelete,
 onCancelDelete,
 }),
 [baseItems, confirming, onConfirmDelete, onCancelDelete],
 );

 const ariaLabel = `Actions for ${entry?.label || entry?.asset?.name || 'this markdown asset'}`;

 // Right-click anywhere on the card opens the SAME action set as the kebab.
 const ctx = useContextMenu();

 // Portal the kebab into the markdown card's brownfield label row (same
 // pattern as ComponentArtboardKebab above).
 const hostRef = React.useRef(null);
 const [labelRowEl, setLabelRowEl] = React.useState(null);
 React.useLayoutEffect(() => {
 setLabelRowEl(findLabelRow(hostRef.current));
 }, [entry?.id]);

 const kebab = (
 <div className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-end" />
 </div>
 );

 // Move-picker destinations — same shape as ComponentArtboardKebab.
 const sourcePath = entry?.asset?.path || '';
 const parentPath = parentFolderOf(sourcePath);
 const destinations = React.useMemo(() => {
 if (!moveOpen) return [];
 const knownFolders =
 typeof getConfigFor.knownFolders === 'function' ? getConfigFor.knownFolders() : [];
 return knownFolders.map((p) => ({ path: p, label: p.split('/').filter(Boolean).pop() || p }));
 }, [moveOpen, getConfigFor]);

 const onConfirmMove = React.useCallback(
 async ({ toFolderPath }) => {
 if (!sourcePath || !toFolderPath) return;
 // `move()` resolves with `{ ok, error }` rather than throwing. Re-throw on
 // `!ok` so MovePicker's catch surfaces the error inline (otherwise the
 // picker would close silently on 400/409/500). See artboard-kebab fix above.
 const result = await move(sourcePath, toFolderPath);
 if (!result?.ok) throw new Error(result?.error || 'Move failed');
 },
 [sourcePath],
 );

 return (
 <div ref={hostRef} className="lm-artboard-kebab-host" onContextMenu={ctx.openAt}>
 {ctx.open && <ContextMenu point={ctx.point} items={items} onClose={ctx.close} />}
 {children}
 {labelRowEl ? ReactDOM.createPortal(kebab, labelRowEl) : null}
 <MarkdownEditorHost open={open} onClose={() => setOpen(false)} entry={entry} />
 {moveOpen && (
 <MovePicker
 onClose={() => setMoveOpen(false)}
 onConfirm={onConfirmMove}
 sourcePath={sourcePath}
 currentParentPath={parentPath}
 destinations={destinations}
 />
 )}
 </div>
 );
}

export default ComponentArtboardKebab;
