// entity-kebab.jsx — per-entity kebab menus for artboards and sections.
//
// ── What this owns ───────────────────────────────────────────────────────────
// The integration seam for the in-studio editors. The Menu primitive and the
// KebabTrigger (above) are type-agnostic — this file is the one that knows
// what items each entity type exposes and wires each item to its action:
//
// Component artboard (.jsx / .tsx):
// · Edit data → DataEditor
// · Edit meta → MetaEditor
// · Duplicate / Rename / Delete (lifecycle endpoints)
// · Export → per-artboard PNG/JPG capture (brownfield)
// · Reveal in editor / file manager (mode-limited, UX-DR9)
//
// Markdown card (.md):
// · Edit → MarkdownEditor
// · Duplicate / Rename / Delete
// · Export / Reveal …
//
// Folder / section (page or group):
// · Edit config → ConfigEditor
// · Rename / Delete (no Duplicate — folders don't duplicate from this surface)
// · Export → bulk PNG/JPG capture of the section
// · Reveal …
//
// ── Mode-limited items ───────────────────────────────────────────────────────
// "Reveal in editor" and "Reveal in file manager" require OS-level reveal,
// which exists only in CLI / self-host mode. In hosted (no `window.__LERRET_
// CLI_MODE__`) the items render disabled-with-reason via the Menu primitive's
// `{ disabled: true, reason: '…' }` shape (UX-DR9). NEVER hidden, NEVER a
// dead control.
//
// ── Delete confirmation (UX-DR9 destructive-actions-are-confirmed) ───────────
// Delete shows a brief inline confirmation in the menu — the item morphs into
// a "Confirm delete · Cancel" pair instead of opening a modal. Non-destructive
// actions (rename, duplicate, export, reveal) commit immediately.
//
// ── Rename ───────────────────────────────────────────────────────────────────
// "Rename" forwards to a caller-supplied callback that focuses the brownfield
// `DCEditable` inline-rename affordance. On commit, the section / artboard
// wrapper writes the new file/folder name via `renameProjectFile`. See
// `kebab-artboard.jsx` and `kebab-section.jsx` for the call-site wiring.

import React from 'react';

import { Menu, KebabTrigger } from './index.js';
import { DataEditor } from '../editors/data-editor.jsx';
import { MetaEditor } from '../editors/meta-editor.jsx';
import { MarkdownEditor } from '../editors/markdown-editor.jsx';
import { ConfigEditor } from '../editors/config-editor.jsx';
import {
 createProjectEntry,
 deleteProjectFile,
 duplicateProjectFile,
 inCliMode,
 moveProjectFile,
 revealProjectFile,
} from '../../runtime/write-client.js';

// ─── CSS injection ───────────────────────────────────────────────────────────
//
// The inline confirm-delete sub-row uses Menu items + a tiny set of inline
// classes. We do NOT add a heavier modal; the menu primitive's popover is the
// container, and the confirm row is just two adjacent items.

if (typeof document !== 'undefined' && !document.getElementById('lm-entity-kebab-styles')) {
 const s = document.createElement('style');
 s.id = 'lm-entity-kebab-styles';
 s.textContent = `
.lm-kebab-confirm-row {
 font: var(--lm-weight-medium, 600) var(--lm-size-body-sm, 12px)/1.3 var(--lm-font-sans, sans-serif);
 color: var(--lm-error, #A8412B);
}
.lm-kebab-item-destructive { color: var(--lm-error, #A8412B); }
.lm-kebab-item-destructive:hover { background: var(--lm-error-light, rgba(168, 65, 43, 0.10)) !important; }
 `.trim();
 document.head.appendChild(s);
}

// ─── Item-set builders ───────────────────────────────────────────────────────

const REVEAL_EDITOR_DISABLED_REASON = 'Available in the local CLI';
const REVEAL_FINDER_DISABLED_REASON = 'Available in the local CLI';

/**
 * Build the items for a component-artboard kebab.
 *
 * @param {object} ctx
 * @param {() => void} ctx.onEditData
 * @param {() => void} ctx.onEditMeta
 * @param {() => void} [ctx.onLiveRefresh]
 *   When provided, a "Auto-refresh" item appears after "Edit meta" that opens
 *   the on-artboard rate picker. Omitted in legacy callers (no live-refresh UI).
 * @param {string} [ctx.liveRefreshLabel]
 *   Label for the live-refresh item (e.g. "Auto-refresh · 1s"). Defaults to
 *   "Auto-refresh…".
 * @param {() => void} ctx.onDuplicate
 * @param {() => void} ctx.onRename
 * @param {() => void} [ctx.onMove]
 *   Move-to picker opener. When provided, a "Move to…" item appears
 *   between "Rename" and "Delete". Omitted in legacy callers (no UI for move).
 * @param {() => void} ctx.onDelete The "open the inline confirm" path.
 * @param {() => void} ctx.onExport
 * @param {() => void} [ctx.onExportAnimated]  When provided, an "Export animated…" entry appears
 *   below the static "Export" entry (Story 7.7). Omitted in legacy callers.
 * @param {() => void} ctx.onRevealEditor
 * @param {() => void} ctx.onRevealFinder
 * @param {boolean} ctx.cliMode
 * @returns {Array<object>}
 */
export function buildComponentItems(ctx) {
 const items = [
 { kind: 'item', id: 'edit-data', label: 'Edit data', onSelect: ctx.onEditData },
 { kind: 'item', id: 'edit-meta', label: 'Edit meta', onSelect: ctx.onEditMeta },
 ...(typeof ctx.onLiveRefresh === 'function'
 ? [{
 kind: 'item',
 id: 'live-refresh',
 label: ctx.liveRefreshLabel || 'Auto-refresh…',
 onSelect: ctx.onLiveRefresh,
 }]
 : []),
 { kind: 'separator', id: 'sep-1' },
 { kind: 'item', id: 'duplicate', label: 'Duplicate', onSelect: ctx.onDuplicate },
 { kind: 'item', id: 'rename', label: 'Rename', onSelect: ctx.onRename },
 ];
 if (typeof ctx.onMove === 'function') {
 items.push({ kind: 'item', id: 'move', label: 'Move to…', onSelect: ctx.onMove });
 }
 items.push(
 {
 kind: 'item',
 id: 'delete',
 label: 'Delete…',
 onSelect: ctx.onDelete,
 // Keep the menu open so the inline "Confirm delete · Cancel" row appears
 // in place (selecting it flips `confirming` at the call site).
 keepOpen: true,
 },
 { kind: 'separator', id: 'sep-2' },
 { kind: 'item', id: 'export', label: 'Export', onSelect: ctx.onExport },
 );
 if (typeof ctx.onExportAnimated === 'function') {
 items.push({
 kind: 'item',
 id: 'export-animated',
 label: 'Export animated…',
 onSelect: ctx.onExportAnimated,
 });
 }
 items.push(
 {
 kind: 'item',
 id: 'reveal-editor',
 label: 'Reveal in editor',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_EDITOR_DISABLED_REASON,
 onSelect: ctx.onRevealEditor,
 },
 {
 kind: 'item',
 id: 'reveal-finder',
 label: 'Reveal in file manager',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_FINDER_DISABLED_REASON,
 onSelect: ctx.onRevealFinder,
 },
 );
 return items;
}

/**
 * Build the items for a markdown-asset kebab. Mirrors `buildComponentItems`
 * minus "edit data"/"edit meta" (those don't apply to Markdown).
 *
 * @param {object} ctx
 * @param {() => void} ctx.onEdit
 * @param {() => void} ctx.onDuplicate
 * @param {() => void} ctx.onRename
 * @param {() => void} [ctx.onMove]
 *   When provided, a "Move to…" item appears between "Rename" and "Delete".
 * @param {() => void} ctx.onDelete
 * @param {() => void} ctx.onExport
 * @param {() => void} ctx.onRevealEditor
 * @param {() => void} ctx.onRevealFinder
 * @param {boolean} ctx.cliMode
 * @returns {Array<object>}
 */
export function buildMarkdownItems(ctx) {
 const items = [
 { kind: 'item', id: 'edit', label: 'Edit', onSelect: ctx.onEdit },
 { kind: 'separator', id: 'sep-1' },
 { kind: 'item', id: 'duplicate', label: 'Duplicate', onSelect: ctx.onDuplicate },
 { kind: 'item', id: 'rename', label: 'Rename', onSelect: ctx.onRename },
 ];
 if (typeof ctx.onMove === 'function') {
 items.push({ kind: 'item', id: 'move', label: 'Move to…', onSelect: ctx.onMove });
 }
 items.push(
 { kind: 'item', id: 'delete', label: 'Delete…', onSelect: ctx.onDelete, keepOpen: true },
 { kind: 'separator', id: 'sep-2' },
 { kind: 'item', id: 'export', label: 'Export', onSelect: ctx.onExport },
 {
 kind: 'item',
 id: 'reveal-editor',
 label: 'Reveal in editor',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_EDITOR_DISABLED_REASON,
 onSelect: ctx.onRevealEditor,
 },
 {
 kind: 'item',
 id: 'reveal-finder',
 label: 'Reveal in file manager',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_FINDER_DISABLED_REASON,
 onSelect: ctx.onRevealFinder,
 },
 );
 return items;
}

/**
 * Build the items for a folder/section kebab.
 *
 * @param {object} ctx
 * @param {() => void} [ctx.onAddAsset]
 *   "Add asset…" opener. When provided, leads the menu (in-studio creation).
 * @param {() => void} [ctx.onAddGroup]
 *   "Add group…" opener. When provided, leads the menu (in-studio creation).
 * @param {() => void} ctx.onEditConfig
 * @param {() => void} ctx.onRename
 * @param {() => void} [ctx.onMove]
 *   When provided, a "Move to…" item appears between "Rename" and "Delete".
 * @param {() => void} ctx.onDelete
 * @param {() => void} ctx.onExport
 * @param {() => void} ctx.onRevealEditor
 * @param {() => void} ctx.onRevealFinder
 * @param {boolean} ctx.cliMode
 * @returns {Array<object>}
 */
export function buildSectionItems(ctx) {
 const items = [];
 // Creation actions lead the menu when wired (in-studio "New group / asset").
 // Optional so legacy callers keep the original item set.
 if (typeof ctx.onAddAsset === 'function' || typeof ctx.onAddGroup === 'function') {
 if (typeof ctx.onAddAsset === 'function') {
 items.push({ kind: 'item', id: 'add-asset', label: 'Add asset…', onSelect: ctx.onAddAsset });
 }
 if (typeof ctx.onAddGroup === 'function') {
 items.push({ kind: 'item', id: 'add-group', label: 'Add group…', onSelect: ctx.onAddGroup });
 }
 items.push({ kind: 'separator', id: 'sep-add' });
 }
 items.push(
 { kind: 'item', id: 'edit-config', label: 'Edit config', onSelect: ctx.onEditConfig },
 { kind: 'separator', id: 'sep-1' },
 { kind: 'item', id: 'rename', label: 'Rename', onSelect: ctx.onRename },
 );
 if (typeof ctx.onMove === 'function') {
 items.push({ kind: 'item', id: 'move', label: 'Move to…', onSelect: ctx.onMove });
 }
 items.push(
 { kind: 'item', id: 'delete', label: 'Delete…', onSelect: ctx.onDelete, keepOpen: true },
 { kind: 'separator', id: 'sep-2' },
 { kind: 'item', id: 'export', label: 'Export', onSelect: ctx.onExport },
 );
 if (typeof ctx.onExportAnimated === 'function') {
 items.push({
 kind: 'item',
 id: 'export-animated',
 label: 'Export animated all…',
 onSelect: ctx.onExportAnimated,
 });
 }
 items.push(
 {
 kind: 'item',
 id: 'reveal-editor',
 label: 'Reveal in editor',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_EDITOR_DISABLED_REASON,
 onSelect: ctx.onRevealEditor,
 },
 {
 kind: 'item',
 id: 'reveal-finder',
 label: 'Reveal in file manager',
 disabled: !ctx.cliMode,
 reason: ctx.cliMode ? undefined : REVEAL_FINDER_DISABLED_REASON,
 onSelect: ctx.onRevealFinder,
 },
 );
 return items;
}

/**
 * Wrap a base item set with an inline "confirm delete · cancel" treatment.
 * When `confirming` is true, the delete item is REPLACED by a pair of items —
 * "Confirm delete" (destructive) and "Cancel" — rather than the original.
 *
 * @param {Array<object>} items The base item set, must contain an item with id "delete".
 * @param {object} ctx
 * @param {boolean} ctx.confirming
 * @param {() => void} ctx.onConfirmDelete
 * @param {() => void} ctx.onCancelDelete
 * @returns {Array<object>}
 */
export function applyDeleteConfirm(items, { confirming, onConfirmDelete, onCancelDelete }) {
 if (!confirming) return items;
 const out = [];
 for (const item of items) {
 if (item.kind === 'item' && item.id === 'delete') {
 out.push({
 kind: 'item',
 id: 'delete-confirm',
 label: 'Confirm delete',
 onSelect: onConfirmDelete,
 });
 out.push({
 kind: 'item',
 id: 'delete-cancel',
 label: 'Cancel',
 onSelect: onCancelDelete,
 // Cancel reverts to the normal item set but keeps the menu open.
 keepOpen: true,
 });
 } else {
 out.push(item);
 }
 }
 return out;
}

// ─── Action helpers (the shared, action-level glue) ─────────────────────────

/**
 * Reveal a path, swallowing any error to a `console.warn` so the kebab item
 * never throws into the React tree. The endpoint already returns a calm
 * `{ ok, error }`; the call site doesn't need to surface that — the user's
 * editor / finder either opens, or it doesn't (a missing `code` binary is
 * already implicit from "Reveal in editor — available in the local CLI").
 *
 * @param {string} path
 * @param {'editor'|'finder'} target
 * @returns {Promise<void>}
 */
export async function reveal(path, target) {
 if (!path) return;
 const result = await revealProjectFile(path, target);
 if (!result.ok) {
 console.warn(`[lerret] reveal ${target} failed:`, result.error);
 }
}

/**
 * Duplicate a path, surfacing any failure through `console.warn`. The
 * brownfield watcher reflects success/failure on the canvas automatically.
 *
 * @param {string} path
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function duplicate(path) {
 const result = await duplicateProjectFile(path);
 if (!result.ok) {
 console.warn('[lerret] duplicate failed:', result.error);
 }
 return result;
}

/**
 * Move a file or folder into `toFolderPath`. Surfaces any failure through
 * `console.warn` and emits a brief `console.log` toast on success
 * (no in-studio toast surface exists yet — minor v1 UX gap). The brownfield
 * watcher reflects the new path on the canvas automatically.
 *
 * @param {string} fromPath The asset / folder being moved.
 * @param {string} toFolderPath The destination parent folder's LerretPath.
 * @param {object} [opts]
 * @param {boolean} [opts.carryLiveRefresh]
 *   When `true`, carry the source folder's `liveRefresh[<basename>]` entry
 *   over to the destination folder's `config.json`.
 * @returns {Promise<{
 *   ok: boolean,
 *   newPath?: string,
 *   rewroteLiveRefresh?: 'stripped'|'carried-over'|'none'|'skipped-malformed',
 *   error?: string,
 * }>}
 */
export async function move(fromPath, toFolderPath, opts = {}) {
 const result = await moveProjectFile(fromPath, toFolderPath, opts);
 if (!result.ok) {
 console.warn('[lerret] move failed:', result.error);
 return result;
 }
 // The studio has no toast surface (yet). Log a calm success line so the
 // user has SOME signal in devtools — and surface the liveRefresh-strip
 // side effect per AC7 of the spec.
 const liveRefreshNote =
 result.rewroteLiveRefresh === 'stripped'
 ? '; removed liveRefresh entry from source folder'
 : result.rewroteLiveRefresh === 'carried-over'
 ? '; carried liveRefresh entry to destination'
 : result.rewroteLiveRefresh === 'skipped-malformed'
 ? '; warning: source config.json was malformed, liveRefresh untouched'
 : '';
 console.log(`[lerret] Moved to ${result.newPath || toFolderPath}${liveRefreshNote}`);
 return result;
}

/**
 * Create a new page/group folder, or a starter asset, inside `parentPath`.
 * Surfaces any failure through `console.warn`; the brownfield watcher reflects
 * the new entry on the canvas automatically.
 *
 * @param {string} parentPath The destination folder's LerretPath (the bare
 *   `.lerret/` root is allowed for a new top-level page).
 * @param {string} name The raw entry name (server validates + normalizes).
 * @param {'folder'|'asset'} kind
 * @param {object} [opts]
 * @param {'component'|'markdown'} [opts.assetKind]
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function create(parentPath, name, kind, opts = {}) {
 const result = await createProjectEntry(parentPath, name, kind, opts);
 if (!result.ok) {
 console.warn('[lerret] create failed:', result.error);
 return result;
 }
 console.log(`[lerret] Created ${result.path || name}`);
 return result;
}

/**
 * Delete a path. Surfaces any failure through `console.warn`. The watcher
 * fires `remove` on success; the canvas reflects it.
 *
 * @param {string} path
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function destroy(path) {
 const result = await deleteProjectFile(path);
 if (!result.ok) {
 console.warn('[lerret] delete failed:', result.error);
 }
 return result;
}

// ─── EntityKebab — composes Menu + KebabTrigger with one of the item sets ──

/**
 * Shared shell that wraps the Menu primitive with a KebabTrigger. The call
 * site supplies the item set and the trigger's accessible name.
 *
 * @param {object} props
 * @param {Array<object>} props.items
 * @param {string} props.ariaLabel
 * @param {string} [props.testId]
 * Optional `data-testid` for the trigger button (helpful in tests).
 * @param {React.CSSProperties} [props.style]
 * Positional style for the trigger.
 * @param {string} [props.className]
 * Extra positional class for the trigger.
 * @param {'bottom-start'|'bottom-end'|'top-start'|'top-end'} [props.align='bottom-end']
 * @returns {React.ReactElement}
 */
export function EntityKebab({ items, ariaLabel, testId, style, className, align = 'bottom-end' }) {
 return (
 <Menu
 items={items}
 align={align}
 renderTrigger={({ open, getTriggerProps }) => (
 <KebabTrigger
 open={open}
 getTriggerProps={getTriggerProps}
 aria-label={ariaLabel}
 className={className}
 style={style}
 data-testid={testId}
 />
 )}
 />
 );
}

// ─── Editor-host: a shared mount point for the editor sheets ─────────────────
//
// The kebab is a small button. The editors it opens (Data, Meta, Markdown,
// Config) are full overlay sheets. Each artboard/section kebab carries a tiny
// "editor host" beside the trigger that mounts the active editor and toggles
// its `open` prop. The host is local to the artboard/section so opening the
// editor for one entity doesn't bleed into another.

/**
 * Editor host for component artboards — owns `DataEditor` + `MetaEditor`
 * open state. The kebab toggles one or the other.
 *
 * @param {object} props
 * @param {boolean} props.dataOpen
 * @param {() => void} props.onCloseData
 * @param {boolean} props.metaOpen
 * @param {() => void} props.onCloseMeta
 * @param {object} props.entry
 * @param {string} [props.initialFocusField]
 * : pre-focus this field when the Data editor opens. Forwarded
 * straight to {@link DataEditor}.
 * @param {string} [props.initialActiveVariant]
 * : pre-select this variant tab when the Data editor opens.
 * @returns {React.ReactElement}
 */
export function ComponentEditorHost({
 dataOpen,
 onCloseData,
 metaOpen,
 onCloseMeta,
 entry,
 initialFocusField,
 initialActiveVariant,
}) {
 return (
 <>
 <DataEditor
 open={dataOpen}
 onClose={onCloseData}
 entry={entry}
 initialFocusField={initialFocusField}
 initialActiveVariant={initialActiveVariant}
 />
 <MetaEditor open={metaOpen} onClose={onCloseMeta} entry={entry} />
 </>
 );
}

/**
 * Editor host for markdown cards — owns `MarkdownEditor` open state.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object} props.entry
 * @returns {React.ReactElement}
 */
export function MarkdownEditorHost({ open, onClose, entry }) {
 const initialText = typeof entry?.text === 'string' ? entry.text : '';
 return <MarkdownEditor open={open} onClose={onClose} entry={entry} initialText={initialText} />;
}

/**
 * Editor host for folder/section — owns `ConfigEditor` open state.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} props.folderPath
 * @param {string} props.folderName
 * @returns {React.ReactElement}
 */
export function SectionEditorHost({ open, onClose, folderPath, folderName }) {
 return (
 <ConfigEditor
 open={open}
 onClose={onClose}
 folderPath={folderPath}
 folderName={folderName}
 />
 );
}

// Convenience accessor used by call sites to gate UI affordances on CLI mode.
export { inCliMode };
