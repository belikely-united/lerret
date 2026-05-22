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
 /* Portaled into .dc-labelrow as an inline flex child. */
 display: inline-flex;
 align-items: center;
 z-index: 5;
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

 // Locate the brownfield label row to portal the kebab into. Walks up from
 // our host to the data-dc-slot wrapper, then finds the .dc-labelrow inside.
 // useLayoutEffect runs synchronously after DOM mutations so the portal
 // target is current before paint.
 const hostRef = React.useRef(null);
 const [labelRowEl, setLabelRowEl] = React.useState(null);
 React.useLayoutEffect(() => {
 setLabelRowEl(findLabelRow(hostRef.current));
 }, [entry?.id]);

 const kebab = (
 <div className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-start" />
 </div>
 );

 return (
 <div ref={hostRef} className="lm-artboard-kebab-host">
 {renderComponent(resolvedProps)}
 {children}
 <ValidationBadge
 failedFields={failedFields}
 propsSchema={propsSchema}
 onClick={handleBadgeClick}
 />
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

 // Portal the kebab into the markdown card's brownfield label row (same
 // pattern as ComponentArtboardKebab above).
 const hostRef = React.useRef(null);
 const [labelRowEl, setLabelRowEl] = React.useState(null);
 React.useLayoutEffect(() => {
 setLabelRowEl(findLabelRow(hostRef.current));
 }, [entry?.id]);

 const kebab = (
 <div className="lm-artboard-kebab" data-testid="lm-artboard-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-start" />
 </div>
 );

 return (
 <div ref={hostRef} className="lm-artboard-kebab-host">
 {children}
 {labelRowEl ? ReactDOM.createPortal(kebab, labelRowEl) : null}
 <MarkdownEditorHost open={open} onClose={() => setOpen(false)} entry={entry} />
 </div>
 );
}

export default ComponentArtboardKebab;
