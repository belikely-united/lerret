// meta-editor.jsx — in-studio form for an asset's `meta` export.
//
// ── What it does ─────────────────────────────────────────────────────────────
// Renders inside an {@link EditorSheet}. For an asset (.jsx/.tsx)
// whose source declares `export const meta = { … }`, it shows a form built
// from {@link FormControl} for the three user-editable well-known
// fields:
// • dimensions.width (number)
// • dimensions.height (number)
// • label (text)
// • tags (array of text — ArrayControl)
// `propsSchema` is NOT edited here ('s Data editor handles fields
// based on it; meta-editor only modifies `dimensions`/`label`/`tags`).
//
// ── Source-surgery write path ────────────────────────────────────────────────
// Each field commit (blur / debounced change) triggers:
// 1. fetch the asset's *current* source via the dev server (same alias the
// data-editor uses — `/@lerret-project/...` / `/@fixture-lerret/...`),
// 2. call `rewriteMetaExport(sourceText, nextMeta)`,
// 3. on `ok: true` → `writeProjectFile(asset.path, result.source)` writes
// the new source. Chokidar fires → reload loop re-renders the
// affected artboard (FR30, FR34).
// 4. on `ok: false` → a calm "Cannot edit `meta` here — open the file in
// your editor" guidance is shown with the file path (NFR8). The editor
// remains open and usable; no write is attempted (NFR9).
//
// ── Failure UX ───────────────────────────────────────────────────────────────
// "Saved" indicator (same as the data editor) flashes on a successful write.
// "Write failed: …" banner for write errors; the editor stays open and the
// user can retry. The rewriter-failure path keeps the form usable but
// disables the writes (the form is now a no-op display until the user opens
// the file by hand).

import React from 'react';

import { EditorSheet } from './editor-sheet.jsx';
import { FormControl } from '../forms/index.js';
import { writeProjectFile } from '../../runtime/write-client.js';
import { rewriteMetaExport } from './meta-source-rewriter.js';

// ── Default source reader (mirrors data-editor's defaultReadDataFile) ────────

/**
 * Fetch the asset's source text via the Vite dev server. The dev server
 * serves the original `.jsx`/`.tsx` text at the same `/@lerret-project/...`
 * alias the asset-runtime uses to import the module — by going through the
 * raw URL with `?raw` we get the file's source text (Vite's `raw` query is
 * stable across versions and used by other studio code paths).
 *
 * Exported so other tool-managed meta edits (e.g. the label-row size chip)
 * can reuse the exact same source read the meta editor uses.
 *
 * @param {string} assetPath The asset file's {@link LerretPath}.
 * @returns {Promise<{ ok: boolean, source?: string, error?: string }>}
 */
export async function defaultReadAssetSource(assetPath) {
 if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') {
 return { ok: false, error: 'no fetch implementation available' };
 }
 const idx = assetPath.indexOf('/.lerret/');
 const rel =
 idx === -1
 ? assetPath.replace(/^\/+/, '')
 : assetPath.slice(idx + '/.lerret/'.length);
 const candidates = [
 `/@lerret-project/${rel}?raw`,
 `/@fixture-lerret/${rel}?raw`,
 ];
 for (const url of candidates) {
 try {
 const response = await globalThis.fetch(url, { method: 'GET', cache: 'no-store' });
 if (response.status === 404) continue;
 if (!response.ok) continue;
 const text = await response.text();
 // Vite's `?raw` returns a JS module: `export default "…"`. We extract the
 // string from that wrapper. If the response looks like raw text already
 // (no wrapper), use it directly.
 const m = /^export default (?<json>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/m.exec(text);
 if (m) {
 try {
 // The wrapper is a JS string literal; JSON.parse handles the
 // double-quoted case directly. For single-quoted/backtick we fall
 // through to manual unwrap.
 const literal = m.groups.json;
 if (literal.startsWith('"')) {
 return { ok: true, source: JSON.parse(literal) };
 }
 // For backtick/single-quote fall back to a safer eval-free unescape:
 // strip the outer quotes and process common escapes.
 const inner = literal.slice(1, -1);
 const unescaped = inner.replace(/\\(.)/g, (_, ch) => {
 if (ch === 'n') return '\n';
 if (ch === 't') return '\t';
 if (ch === 'r') return '\r';
 return ch;
 });
 return { ok: true, source: unescaped };
 } catch {
 // Fall through to use the raw text as-is.
 }
 }
 // Not a Vite raw-module wrapper — return the text directly.
 return { ok: true, source: text };
 } catch {
 // Try the next candidate.
 }
 }
 return { ok: false, error: 'could not fetch asset source' };
}

// ── CSS injection (scoped, no global pollution) ──────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('meta-editor-styles')) {
 const s = document.createElement('style');
 s.id = 'meta-editor-styles';
 s.textContent = `
.lm-meta-editor {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-4, 16px);
}
.lm-meta-editor__path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 margin: 0;
 letter-spacing: 0.04em;
}
.lm-meta-editor__dim-row {
 display: grid;
 grid-template-columns: 1fr 1fr;
 gap: var(--lm-space-3, 12px);
}
.lm-meta-editor__saved {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-tertiary, #6E6960);
 opacity: 0;
 transition: opacity var(--lm-duration-base, 220ms) var(--lm-ease);
}
.lm-meta-editor__saved[data-visible] { opacity: 1; }
.lm-meta-editor__saved-dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-success, #4A6B3F);
}
.lm-meta-editor__error-banner {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 background: var(--lm-error-light);
 border-radius: var(--lm-radius-sm, 6px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-primary, #1A1714);
 line-height: var(--lm-lh-body, 1.45);
 word-break: break-all;
}
/* Calm guidance panel for the rewriter-failure path (NFR8). */
.lm-meta-editor__guidance {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-3, 12px) var(--lm-space-4, 16px);
 background: var(--lm-accent-light, rgba(184,91,51,0.07));
 border-radius: var(--lm-radius-sm, 6px);
}
.lm-meta-editor__guidance-title {
 font: var(--lm-weight-semibold, 600) var(--lm-size-body, 13px)/var(--lm-lh-body, 1.45) var(--lm-font-sans);
 color: var(--lm-text-primary, #1A1714);
 margin: 0;
}
.lm-meta-editor__guidance-body {
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-secondary, #3A3530);
 line-height: var(--lm-lh-body, 1.45);
 margin: 0;
}
.lm-meta-editor__guidance-path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 letter-spacing: 0.04em;
 word-break: break-all;
}

@media (prefers-reduced-motion: reduce) {
 .lm-meta-editor__saved { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── Schemas for the form controls ────────────────────────────────────────────

/**
 * Schema for `dimensions.width` / `dimensions.height` — positive integer
 * pixels. `min: 1` lets the FormControl flag negative/zero values inline
 * (calm invalid state ).
 */
const DIMENSION_SCHEMA = {
 type: 'number',
 min: 1,
};

/**
 * Schema for `meta.label` — a free-form short string. Empty is allowed (the
 * editor treats an empty label as "no label" and the parser falls back to
 * the file-name label).
 */
const LABEL_SCHEMA = {
 type: 'string',
 description: 'Human-readable label shown above the artboard',
};

/**
 * Schema for `meta.tags` — an array of strings. Each item is a TextControl.
 */
const TAGS_SCHEMA = {
 type: 'array',
 description: 'Tags for grouping / filtering (each is a short string)',
 itemSchema: { type: 'string' },
};

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Meta editor — modifies an asset's `meta` export in place.
 *
 * Opens inside an {@link EditorSheet}. Each commit reads the asset's current
 * source, runs {@link rewriteMetaExport}, and (on success) writes the
 * rewritten source via {@link writeProjectFile}. The chokidar watcher +
 * reload loop re-renders the artboard automatically.
 *
 * @param {object} props
 * @param {boolean} props.open
 * Whether the editor sheet is visible.
 * @param {() => void} props.onClose
 * Callback when the sheet dismisses.
 * @param {object} props.entry
 * The runtime `AssetEntry` for the asset. Carries `entry.asset.path`
 * (the `.jsx`/`.tsx` {@link LerretPath}), `entry.meta` (the parsed meta),
 * and `entry.label` for the sheet title.
 * @param {(path: string, content: string) => Promise<{ ok: boolean, error?: string }>} [props.writer]
 * Override the write function — used by tests. Defaults to {@link writeProjectFile}.
 * @param {(assetPath: string) => Promise<{ ok: boolean, source?: string, error?: string }>} [props.reader]
 * Override the source-text reader — used by tests. Defaults to the
 * dev-server `?raw` fetch.
 * @returns {React.ReactElement | null}
 */
export function MetaEditor({ open, onClose, entry, writer, reader }) {
 const write = writer || writeProjectFile;
 const read = reader || defaultReadAssetSource;

 // ── Derivations off the entry ────────────────────────────────────────────
 const asset = entry?.asset;
 const meta = entry?.meta || {};
 const assetPath = asset?.path || null;

 // Pre-fill values from the parsed meta. The parser normalizes these so we
 // can pass them straight to the form controls.
 const initialDimensions = React.useMemo(() => {
 const d = meta.dimensions || {};
 return {
 width: typeof d.width === 'number' ? d.width : undefined,
 height: typeof d.height === 'number' ? d.height : undefined,
 };
 // We only re-derive when the entry changes; the meta object identity is
 // stable per entry.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.id]);
 const initialLabel = typeof meta.label === 'string' ? meta.label : '';
 const initialTags = Array.isArray(meta.tags) ? meta.tags : [];

 // ── Form state ────────────────────────────────────────────────────────────
 /** @type {[number | undefined, React.Dispatch<React.SetStateAction<number | undefined>>]} */
 const [width, setWidth] = React.useState(initialDimensions.width);
 /** @type {[number | undefined, React.Dispatch<React.SetStateAction<number | undefined>>]} */
 const [height, setHeight] = React.useState(initialDimensions.height);
 const [label, setLabel] = React.useState(initialLabel);
 const [tags, setTags] = React.useState(initialTags);

 // Re-seed form state when the editor is opened against a different entry.
 React.useEffect(() => {
 setWidth(initialDimensions.width);
 setHeight(initialDimensions.height);
 setLabel(initialLabel);
 setTags(initialTags);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.id]);

 // ── Write status ─────────────────────────────────────────────────────────
 const [saved, setSaved] = React.useState(false);
 const [writeError, setWriteError] = React.useState(null);
 /** @type {[null | string, React.Dispatch<React.SetStateAction<null | string>>]} */
 const [rewriteFailReason, setRewriteFailReason] = React.useState(null);
 const savedNonceRef = React.useRef(0);

 /** Flash "Saved" for 1.5 s, extending if commits arrive in rapid succession. */
 const flashSaved = React.useCallback(() => {
 savedNonceRef.current += 1;
 const myNonce = savedNonceRef.current;
 setSaved(true);
 setTimeout(() => {
 if (savedNonceRef.current === myNonce) setSaved(false);
 }, 1500);
 }, []);

 // ── Commit handler ───────────────────────────────────────────────────────
 //
 // Per-field commits all share the same flow — they vary only in which field
 // they updated. We compute the next meta by reading the LATEST form state
 // (the just-set value, since setState in React 19 is batched, we pass the
 // override explicitly to avoid a stale closure).
 /**
 * @param {{ width?: number | undefined, height?: number | undefined, label?: string, tags?: string[] }} override
 */
 const commit = React.useCallback(
 async (override) => {
 if (!assetPath) {
 setWriteError('cannot determine asset path');
 return;
 }
 // Once the rewriter has reported an unsupported source, do not attempt
 // further writes — the form is purely informational until the user
 // edits the file by hand. The watcher will re-derive `meta` on the next
 // disk change and the editor can be re-opened with a fresh state.
 if (rewriteFailReason) return;

 const nextMeta = {
 dimensions: {
 width: 'width' in override ? override.width : width,
 height: 'height' in override ? override.height : height,
 },
 label: 'label' in override ? override.label : label,
 tags: 'tags' in override ? override.tags : tags,
 };

 // 1. Read the current source.
 const readResult = await read(assetPath);
 if (!readResult.ok || typeof readResult.source !== 'string') {
 setWriteError(readResult.error || 'failed to read asset source');
 return;
 }

 // 2. Rewrite the meta block.
 const rewrite = rewriteMetaExport(readResult.source, nextMeta);
 if (!rewrite.ok) {
 // Rewriter cannot edit this source safely — surface guidance.
 setRewriteFailReason(rewrite.reason);
 return;
 }

 // 3. Write the rewritten source.
 const writeResult = await write(assetPath, rewrite.source);
 if (!writeResult.ok) {
 setWriteError(writeResult.error || 'write failed');
 return;
 }
 setWriteError(null);
 flashSaved();
 },
 [assetPath, read, write, width, height, label, tags, rewriteFailReason, flashSaved],
 );

 // Per-field handlers — set state immediately so the input reflects the
 // user's edit; commit asynchronously with the override.
 const onCommitWidth = React.useCallback(
 (v) => {
 const w = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
 setWidth(w);
 commit({ width: w });
 },
 [commit],
 );
 const onCommitHeight = React.useCallback(
 (v) => {
 const h = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
 setHeight(h);
 commit({ height: h });
 },
 [commit],
 );
 const onCommitLabel = React.useCallback(
 (v) => {
 const text = typeof v === 'string' ? v : '';
 setLabel(text);
 commit({ label: text });
 },
 [commit],
 );
 const onCommitTags = React.useCallback(
 (v) => {
 const next = Array.isArray(v) ? v.map((t) => (typeof t === 'string' ? t : '')) : [];
 setTags(next);
 commit({ tags: next });
 },
 [commit],
 );

 // ── Pre-flight check on open: surface guidance proactively when the
 // source cannot be parsed. This lets the user know about the limitation
 // BEFORE they start filling in fields (AC: "opens or attempts to save").
 React.useEffect(() => {
 if (!open || !assetPath) return undefined;
 let cancelled = false;
 setRewriteFailReason(null);
 setWriteError(null);
 (async () => {
 const result = await read(assetPath);
 if (cancelled) return;
 if (!result.ok || typeof result.source !== 'string') {
 // A read failure is NOT the rewriter-failure case — leave the user
 // a write-error banner instead so the editor remains usable; the
 // next field commit will retry the fetch.
 setWriteError(result.error || 'failed to read asset source');
 return;
 }
 // Probe the rewriter against the current meta values — same values,
 // no semantic change — so we know up-front whether the source is one
 // we can edit. If it can't, surface the guidance immediately.
 const probe = rewriteMetaExport(result.source, {
 dimensions: { width: initialDimensions.width, height: initialDimensions.height },
 label: initialLabel,
 tags: initialTags,
 });
 if (!probe.ok) {
 setRewriteFailReason(probe.reason);
 }
 })();
 return () => { cancelled = true; };
 // We only need to re-probe on open / asset change.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open, assetPath]);

 // ── Sheet header decoration ───────────────────────────────────────────────
 const title = `Meta · ${entry?.label || asset?.name || 'asset'}`;

 // ── Footer ────────────────────────────────────────────────────────────────
 const footer = (
 <>
 {writeError && (
 <div className="lm-meta-editor__error-banner" role="alert" aria-live="polite">
 <span>Write failed: {writeError}</span>
 </div>
 )}
 <span
 className="lm-meta-editor__saved"
 data-visible={saved ? '' : undefined}
 aria-live="polite"
 >
 <span className="lm-meta-editor__saved-dot" aria-hidden="true" />
 Saved
 </span>
 </>
 );

 // ── Render ────────────────────────────────────────────────────────────────
 return (
 <EditorSheet open={open} onClose={onClose} title={title} dirty={false} footer={footer}>
 <div className="lm-meta-editor" data-testid="lm-meta-editor">
 {assetPath && (
 <p className="lm-meta-editor__path" data-testid="lm-meta-editor-path">
 {assetPath}
 </p>
 )}

 {rewriteFailReason && (
 <div
 className="lm-meta-editor__guidance"
 role="status"
 aria-live="polite"
 data-testid="lm-meta-editor-guidance"
 >
 <p className="lm-meta-editor__guidance-title">
 Cannot edit <code>meta</code> here — open the file in your editor
 </p>
 <p className="lm-meta-editor__guidance-body">
 The <code>meta</code> export in this file uses a shape the in-studio
 form can&apos;t safely modify ({rewriteFailReason}). Edit the file
 directly to change its <code>dimensions</code>, <code>label</code>,
 or <code>tags</code>; the canvas will pick up the change automatically.
 </p>
 {assetPath && (
 <code className="lm-meta-editor__guidance-path">{assetPath}</code>
 )}
 </div>
 )}

 {/* The form remains visible (and pre-filled) even in the guidance
 path so the user can see the current values — it just doesn't
 write while `rewriteFailReason` is set. */}
 <div className="lm-meta-editor__dim-row">
 <FormControl
 fieldKey="width"
 schema={DIMENSION_SCHEMA}
 value={width}
 onCommit={onCommitWidth}
 disabled={!!rewriteFailReason}
 />
 <FormControl
 fieldKey="height"
 schema={DIMENSION_SCHEMA}
 value={height}
 onCommit={onCommitHeight}
 disabled={!!rewriteFailReason}
 />
 </div>

 <FormControl
 fieldKey="label"
 schema={LABEL_SCHEMA}
 value={label}
 onCommit={onCommitLabel}
 disabled={!!rewriteFailReason}
 />

 <FormControl
 fieldKey="tags"
 schema={TAGS_SCHEMA}
 value={tags}
 onCommit={onCommitTags}
 disabled={!!rewriteFailReason}
 />
 </div>
 </EditorSheet>
 );
}

export default MetaEditor;
