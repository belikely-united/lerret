// section-kebab.jsx — kebab wrapper for one section (page or group).
//
// Replaces the temporary `SectionWithConfigTrigger`.
//
// ── What this does ──────────────────────────────────────────────────────────
// Wraps a `<DCSection>` in a positioning host that hangs a ghost-tier kebab
// trigger above the section header. The kebab exposes the folder/section
// items: Edit config / Rename / Delete (with inline confirm) / Export / Reveal
// in editor / Reveal in file manager. Mode-limited items render disabled-with-
// reason via the Menu primitive.
//
// The Config editor and the delete-confirm state live here so opening one
// section's editor never bleeds into another's.
//
// the "Export" item now opens a small inline format-picker popover
// (PNG/JPG × structured/flat) and runs `runBulkExport`. Progress is shown
// inline in the popover button; skipped and unembedded-font notices appear as
// calm inline text below the trigger.

import React from 'react';

import {
 ContextMenu,
 CreateEntryDialog,
 EntityKebab,
 MovePicker,
 SectionEditorHost,
 applyDeleteConfirm,
 buildSectionItems,
 create,
 destroy,
 inCliMode,
 move,
 reveal,
 useContextMenu,
} from '../menu/index.js';
import { runBulkExport, triggerBulkDownload } from '../../export/bulk.js';
import { useCascadedConfig } from './cascade-context.jsx';
import { bindOneShotRename } from './use-inline-rename.js';

/**
 * Derive the parent folder LerretPath for a folder path. Strips the last
 * path component. Returns `''` for a top-level folder.
 *
 * @param {string | undefined | null} folderPath
 * @returns {string}
 */
function parentFolderOf(folderPath) {
 if (typeof folderPath !== 'string') return '';
 const trimmed = folderPath.replace(/\/+$/, '');
 const slash = trimmed.lastIndexOf('/');
 return slash === -1 ? '' : trimmed.slice(0, slash);
}

/**
 * Find the page/group node at `path` in the project model, so the create
 * dialog can pre-check name collisions against its existing children. Returns
 * the node's child folder names + asset filenames, or `[]` if not found.
 *
 * @param {object | null | undefined} project
 * @param {string} path
 * @returns {string[]}
 */
function childNamesAt(project, path) {
 if (!project || !path) return [];
 const stack = [...(project.pages || [])];
 while (stack.length) {
 const node = stack.pop();
 if (node && node.path === path) {
 return [
 ...(node.groups || []).map((g) => g.name),
 ...(node.assets || []).map((a) => a.fileName),
 ];
 }
 if (node && node.groups) for (const g of node.groups) stack.push(g);
 }
 return [];
}

// ── CSS injection ────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('lm-section-kebab-styles')) {
 const s = document.createElement('style');
 s.id = 'lm-section-kebab-styles';
 s.textContent = `
.lm-section-kebab-host {
 position: relative;
}
.lm-section-kebab {
 position: absolute;
 top: 18px;
 left: 18px;
 z-index: 10;
}
 `.trim();
 document.head.appendChild(s);
}

function cssEscape(value) {
 if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
 return String(value).replace(/[^\w-]/g, '\\$&');
}

// ── Section export format-picker popover ─────────────────────────

/**
 * Small inline popover with format (PNG / JPG) and layout (structured / flat)
 * choices, an export trigger button, and inline progress + notice text.
 *
 * Rendered above the section kebab host; positioned by the caller via
 * `position: absolute` so it stays anchored to the kebab icon.
 *
 * @param {object} props
 * @param {'png'|'jpg'} props.format
 * @param {boolean} props.flat
 * @param {(f: 'png'|'jpg') => void} props.onFormatChange
 * @param {(v: boolean) => void} props.onFlatChange
 * @param {string | null} props.progress Inline progress text e.g. "0/3…"
 * @param {string | null} props.notice Calm notice text (skipped / fonts)
 * @param {() => void} props.onExport
 * @param {() => void} props.onClose
 * @returns {React.ReactElement}
 */
function SectionExportPopover({ format, flat, onFormatChange, onFlatChange, progress, notice, onExport, onClose }) {
 // Close on Escape or click-outside.
 const ref = React.useRef(null);
 React.useEffect(() => {
 const onKey = (e) => { if (e.key === 'Escape') onClose(); };
 const onPd = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
 document.addEventListener('keydown', onKey);
 document.addEventListener('pointerdown', onPd);
 return () => {
 document.removeEventListener('keydown', onKey);
 document.removeEventListener('pointerdown', onPd);
 };
 }, [onClose]);

 const busy = progress !== null;

 return (
 <div
 ref={ref}
 data-testid="lm-section-export-popover"
 style={{
 position: 'absolute',
 top: 0,
 left: 32,
 zIndex: 50,
 background: 'rgba(255,255,255,0.97)',
 backdropFilter: 'blur(12px) saturate(120%)',
 WebkitBackdropFilter: 'blur(12px) saturate(120%)',
 border: '1px solid rgba(26,23,20,0.10)',
 borderRadius: 10,
 padding: '10px 12px',
 boxShadow: '0 8px 24px rgba(15,23,42,0.14), 0 1px 3px rgba(15,23,42,0.06)',
 minWidth: 180,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 fontSize: 12,
 color: '#1A1714',
 }}
 >
 {/* Format row */}
 <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
 {['png', 'jpg'].map((f) => (
 <button
 key={f}
 type="button"
 onClick={() => onFormatChange(f)}
 style={{
 flex: 1,
 padding: '4px 0',
 borderRadius: 6,
 border: '1px solid',
 borderColor: format === f ? '#B85B33' : 'rgba(26,23,20,0.14)',
 background: format === f ? '#B85B33' : 'transparent',
 color: format === f ? '#FAF8F2' : '#3A3530',
 fontFamily: 'inherit',
 fontSize: 11,
 fontWeight: 600,
 cursor: 'pointer',
 letterSpacing: '0.04em',
 textTransform: 'uppercase',
 }}
 >{f}</button>
 ))}
 </div>

 {/* Flat toggle */}
 <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, cursor: 'pointer' }}>
 <input
 type="checkbox"
 checked={flat}
 onChange={(e) => onFlatChange(e.target.checked)}
 style={{ margin: 0 }}
 />
 <span style={{ fontSize: 11, color: '#6E6960' }}>Flat (no folders)</span>
 </label>

 {/* Export button */}
 <button
 type="button"
 onClick={onExport}
 disabled={busy}
 style={{
 width: '100%',
 padding: '6px 10px',
 borderRadius: 7,
 border: 'none',
 background: busy ? 'rgba(184,91,51,0.35)' : '#B85B33',
 color: '#FAF8F2',
 fontFamily: 'inherit',
 fontSize: 12,
 fontWeight: 600,
 cursor: busy ? 'default' : 'pointer',
 transition: 'background .12s',
 }}
 >
 {progress !== null ? progress : 'Export ZIP'}
 </button>

 {/* Calm notices (skipped / unembedded fonts) */}
 {notice && (
 <div style={{
 marginTop: 6,
 fontSize: 11,
 color: '#6E6960',
 lineHeight: 1.4,
 maxWidth: 220,
 }}>{notice}</div>
 )}
 </div>
 );
}

/**
 * Kebab wrapper for one section (page or group). Hosts the kebab trigger,
 * the inline delete-confirm, and the ConfigEditor sheet.
 *
 * also hosts the export format-picker popover and the bulk-export
 * state machine (idle → in-progress → idle, with calm notices for skipped /
 * unembedded-font results).
 *
 * @param {object} props
 * @param {string} props.sectionId The section's LerretPath (= folder path).
 * @param {string} props.sectionTitle Display name (for the trigger's aria-label).
 * @param {object} [props.project] The ProjectNode — required for bulk export.
 * @param {'page' | 'group'} [props.sectionKind] Whether this section is a page
 * or a group — used to build the `collectArtboards` scope.
 * @param {React.ReactNode} props.children The `<DCSection>` to wrap.
 * @returns {React.ReactElement}
 */
export function SectionKebab({ sectionId, sectionTitle, sectionKind = 'page', project, children }) {
 const [configOpen, setConfigOpen] = React.useState(false);
 const [confirming, setConfirming] = React.useState(false);

 // ── Export state ──────────────────────────────────────────────
 const [exportOpen, setExportOpen] = React.useState(false);
 const [exportFormat, setExportFormat] = React.useState('png');
 const [exportFlat, setExportFlat] = React.useState(false);
 const [exportProgress, setExportProgress] = React.useState(null); // null = idle
 const [exportNotice, setExportNotice] = React.useState(null);

 // ── Move state ────────────────────────────────────────────────
 const [moveOpen, setMoveOpen] = React.useState(false);

 // ── Create state ──────────────────────────────────────────────
 // 'group' | 'asset' while the create dialog is open; null when closed.
 const [createKind, setCreateKind] = React.useState(null);

 // Cascaded per-folder config — used to honor `excludeFromExport: true` (FR52).
 const getConfigFor = useCascadedConfig();

 const onRename = React.useCallback(() => {
 if (typeof document === 'undefined' || !sectionId) return;
 const root = document.querySelector(`[data-dc-section="${cssEscape(sectionId)}"]`);
 if (!root) return;
 // The section title is the first `.dc-editable` in the section's tree.
 const editable = root.querySelector('.dc-editable');
 if (!editable || typeof editable.focus !== 'function') return;
 editable.focus();
 const range = document.createRange();
 range.selectNodeContents(editable);
 const sel = window.getSelection();
 sel.removeAllRanges();
 sel.addRange(range);
 bindOneShotRename(editable, { fromPath: sectionId, kind: 'folder' });
 }, [sectionId]);

 const onMove = React.useCallback(() => {
 if (!sectionId) return;
 setMoveOpen(true);
 }, [sectionId]);

 const onAddGroup = React.useCallback(() => setCreateKind('group'), []);
 const onAddAsset = React.useCallback(() => setCreateKind('asset'), []);
 const onConfirmCreate = React.useCallback(
 async ({ name, assetKind }) => {
 if (!sectionId || !createKind) return;
 // 'group' creates a folder inside this section; 'asset' a starter file.
 const endpointKind = createKind === 'asset' ? 'asset' : 'folder';
 const result = await create(sectionId, name, endpointKind, { assetKind });
 if (!result?.ok) throw new Error(result?.error || 'Create failed');
 },
 [sectionId, createKind],
 );
 const createChildNames = React.useMemo(
 () => (createKind ? childNamesAt(project, sectionId) : []),
 [createKind, project, sectionId],
 );

 const onDelete = React.useCallback(() => setConfirming(true), []);
 const onCancelDelete = React.useCallback(() => setConfirming(false), []);
 const onConfirmDelete = React.useCallback(async () => {
 setConfirming(false);
 if (sectionId) await destroy(sectionId);
 }, [sectionId]);

 // "Export" opens the format-picker popover instead of directly
 // triggering the legacy brownfield download.
 const onExport = React.useCallback(() => {
 setExportNotice(null);
 setExportOpen((o) => !o);
 }, []);

 // run the bulk export when the user confirms in the popover.
 const onRunBulkExport = React.useCallback(async () => {
 if (!project || !sectionId || exportProgress !== null) return;

 setExportNotice(null);

 const scope = { kind: sectionKind, path: sectionId };

 const result = await runBulkExport({
 project,
 scope,
 format: exportFormat,
 flat: exportFlat,
 getConfigFor,
 onProgress: (i, total) => {
 setExportProgress(i === total ? null : `${i}/${total}…`);
 },
 });

 setExportProgress(null);

 if (!result.blob) {
 // Empty scope, all skipped, or every artboard was excluded.
 if (result.excludedFolders?.length) {
 setExportNotice('Nothing to export — every page in this scope is excludeFromExport.');
 return;
 }
 const skippedMsg = result.skipped.length > 0
 ? ` (${result.skipped.length} skipped)`
 : '';
 setExportNotice(`Nothing to export${skippedMsg}.`);
 return;
 }

 // Trigger the download.
 triggerBulkDownload(result.blob, result.filename);

 // Build calm notice text for skipped artboards, excluded folders, and unembedded fonts.
 const notices = [];
 if (result.skipped.length > 0) {
 const names = result.skipped.map((s) => s.artboard?.asset?.name || '?').join(', ');
 notices.push(`Skipped: ${names}`);
 }
 if (result.excludedFolders?.length > 0) {
 notices.push(
 `Excluded (excludeFromExport): ${result.excludedFolders
 .map((p) => p.split('/').filter(Boolean).pop() || p)
 .join(', ')}`,
 );
 }
 if (result.unembeddedFonts.length > 0) {
 notices.push(`Fonts not embedded: ${result.unembeddedFonts.join(', ')}`);
 }

 setExportNotice(notices.length > 0 ? notices.join(' · ') : null);

 // Auto-close the popover after a successful export if there are no notices.
 if (notices.length === 0) {
 setExportOpen(false);
 }
 }, [project, sectionId, sectionKind, exportFormat, exportFlat, exportProgress, getConfigFor]);

 const onRevealEditor = React.useCallback(() => {
 if (sectionId) reveal(sectionId, 'editor');
 }, [sectionId]);
 const onRevealFinder = React.useCallback(() => {
 if (sectionId) reveal(sectionId, 'finder');
 }, [sectionId]);

 const cliMode = inCliMode();

 const baseItems = React.useMemo(
 () => buildSectionItems({
 onAddAsset,
 onAddGroup,
 onEditConfig: () => setConfigOpen(true),
 onRename,
 onMove,
 onDelete,
 onExport,
 onRevealEditor,
 onRevealFinder,
 cliMode,
 }),
 [onAddAsset, onAddGroup, onRename, onMove, onDelete, onExport, onRevealEditor, onRevealFinder, cliMode],
 );

 const items = React.useMemo(
 () => applyDeleteConfirm(baseItems, {
 confirming,
 onConfirmDelete,
 onCancelDelete,
 }),
 [baseItems, confirming, onConfirmDelete, onCancelDelete],
 );

 const ariaLabel = `Actions for ${sectionTitle || 'this section'}`;

 // Right-click on the section's own area (header / padding, not a child artboard
 // or sub-group — those stopPropagation) opens the same actions as the kebab.
 const ctx = useContextMenu();

 // Compute destinations from the cascade map when the picker is open. The
 // picker's internal isInsideSource() check disables the section itself and
 // any descendant of it — server-side cycle prevention is a backstop.
 const sectionParent = parentFolderOf(sectionId);
 const destinations = React.useMemo(() => {
 if (!moveOpen) return [];
 const knownFolders =
 typeof getConfigFor.knownFolders === 'function' ? getConfigFor.knownFolders() : [];
 return knownFolders.map((p) => ({ path: p, label: p.split('/').filter(Boolean).pop() || p }));
 }, [moveOpen, getConfigFor]);

 const onConfirmMove = React.useCallback(
 async ({ toFolderPath, carryLiveRefresh }) => {
 if (!sectionId || !toFolderPath) return;
 // `move()` resolves with `{ ok, error }` rather than throwing. Re-throw on
 // `!ok` so MovePicker's catch surfaces the error inline (otherwise the
 // picker would close silently on 400 cycle / 409 collision / 500 fs-fail).
 const result = await move(sectionId, toFolderPath, { carryLiveRefresh });
 if (!result?.ok) throw new Error(result?.error || 'Move failed');
 },
 [sectionId],
 );

 return (
 <div className="lm-section-kebab-host" onContextMenu={ctx.openAt}>
 {ctx.open && <ContextMenu point={ctx.point} items={items} onClose={ctx.close} />}
 <div className="lm-section-kebab" data-testid="lm-section-kebab">
 <EntityKebab items={items} ariaLabel={ariaLabel} align="bottom-start" />
 {exportOpen && (
 <SectionExportPopover
 format={exportFormat}
 flat={exportFlat}
 onFormatChange={setExportFormat}
 onFlatChange={setExportFlat}
 progress={exportProgress}
 notice={exportNotice}
 onExport={onRunBulkExport}
 onClose={() => setExportOpen(false)}
 />
 )}
 </div>
 {children}
 <SectionEditorHost
 open={configOpen}
 onClose={() => setConfigOpen(false)}
 folderPath={sectionId}
 folderName={sectionTitle}
 />
 {moveOpen && (
 <MovePicker
 onClose={() => setMoveOpen(false)}
 onConfirm={onConfirmMove}
 sourcePath={sectionId}
 currentParentPath={sectionParent}
 destinations={destinations}
 />
 )}
 {createKind && (
 <CreateEntryDialog
 kind={createKind}
 parentLabel={sectionTitle}
 existingNames={createChildNames}
 onConfirm={onConfirmCreate}
 onClose={() => setCreateKind(null)}
 />
 )}
 </div>
 );
}

export default SectionKebab;
