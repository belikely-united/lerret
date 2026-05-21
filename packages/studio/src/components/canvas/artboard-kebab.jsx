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

import { resolveProps, resolveVariantData, validateProps } from '@lerret/core';

import { ValidationBadge } from '../badge/validation-badge.jsx';
import {
 EntityKebab,
 ComponentEditorHost,
 MarkdownEditorHost,
 applyDeleteConfirm,
 buildComponentItems,
 buildMarkdownItems,
 destroy,
 duplicate,
 inCliMode,
 reveal,
} from '../menu/index.js';
import { bindOneShotRename } from './use-inline-rename.js';

// ── CSS injection ────────────────────────────────────────────────────────────
//
// The wrapper provides a positioning root for the kebab (top-right of the
// artboard's card) and matches the hover-reveal behavior of the existing
// dc-expand / dc-dl PNG/JPG buttons in design-canvas.jsx — the kebab fades in
// on hover, focus, and when its menu is open. Keyboard-focused users always
// see it.

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
 position: absolute;
 top: 6px;
 right: 6px;
 z-index: 5;
 opacity: 0;
}
.lm-artboard-kebab-host:hover .lm-artboard-kebab,
.lm-artboard-kebab-host:focus-within .lm-artboard-kebab,
.lm-artboard-kebab[data-open="true"],
.lm-artboard-kebab:focus-visible {
 opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
 .lm-artboard-kebab { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
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

// ── Data-fetch helper (carried over 's EditableComponentArtboard)

/**
 * Best-effort GET of the asset's co-located `.data.json` file. Used by the
 * component-artboard wrapper to drive prop resolution for the rendered
 * component.
 *
 * @param {string} dataPath
 * @returns {Promise<unknown>}
 */
async function fetchDataValue(dataPath) {
 if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') {
 return {};
 }
 const idx = dataPath.indexOf('/.lerret/');
 const rel = idx === -1 ? dataPath.replace(/^\/+/, '') : dataPath.slice(idx + '/.lerret/'.length);
 const bust = `?t=${Date.now()}`;
 for (const base of ['/@lerret-project', '/@fixture-lerret']) {
 try {
 const response = await globalThis.fetch(`${base}/${rel}${bust}`, { cache: 'no-store' });
 if (response.status === 404) continue;
 if (!response.ok) continue;
 const ct = response.headers.get('content-type') || '';
 if (!ct.includes('json') && !ct.includes('text/plain')) continue;
 const text = await response.text();
 try {
 return JSON.parse(text);
 } catch (err) {
 console.warn('[lerret] failed to parse data file', dataPath, err);
 return {};
 }
 } catch {
 // try the next candidate
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
 let unsubscribe = () => {};
 if (typeof import.meta !== 'undefined' && import.meta.hot) {
 const handler = (payload) => {
 if (!payload || !payload.event || typeof payload.event.path !== 'string') return;
 if (payload.event.path === dataPath) reload();
 };
 import.meta.hot.on('lerret:change', handler);
 unsubscribe = () => { cancelled = true; };
 }
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
 onDuplicate,
 onRename,
 onDelete,
 onExport,
 onRevealEditor,
 onRevealFinder,
 cliMode,
 }),
 [onDuplicate, onRename, onDelete, onExport, onRevealEditor, onRevealFinder, cliMode],
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

 return (
 <div className="lm-artboard-kebab-host">
 {renderComponent(resolvedProps)}
 {children}
 <ValidationBadge
 failedFields={failedFields}
 propsSchema={propsSchema}
 onClick={handleBadgeClick}
 />
 <div className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-end" />
 </div>
 <ComponentEditorHost
 dataOpen={dataOpen}
 onCloseData={() => setDataOpen(false)}
 metaOpen={metaOpen}
 onCloseMeta={() => setMetaOpen(false)}
 entry={entry}
 initialFocusField={focusField}
 initialActiveVariant={focusVariant}
 />
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
 onDelete,
 onExport,
 onRevealEditor,
 onRevealFinder,
 cliMode,
 }),
 [onDuplicate, onRename, onDelete, onExport, onRevealEditor, onRevealFinder, cliMode],
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

 return (
 <div className="lm-artboard-kebab-host">
 {children}
 <div className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-end" />
 </div>
 <MarkdownEditorHost open={open} onClose={() => setOpen(false)} entry={entry} />
 </div>
 );
}

export default ComponentArtboardKebab;
