// config-editor.jsx — in-studio editor for a folder's config.json.
//
// ── What it does ─────────────────────────────────────────────────────────────
// Renders inside an {@link EditorSheet}. For a page or group
// section, it opens that folder's OWN `config.json` (the raw file, not the
// merged cascade result) and lets the user edit its well-known keys using
// typed {@link FormControl} widgets. Unknown/free-form keys are
// still editable via a "Show raw JSON" toggle-able textarea so no key is
// silently dropped.
//
// ── Cascade fidelity ──────────────────────────────────────────────────────────
// The editor reads and writes only the TARGETED FOLDER'S OWN `config.json`.
// The effective (deep-merged) cascade config is a read-time concern on the
// canvas layer; changing a parent's key propagates automatically to children
// via the existing cascade context + chokidar watcher → HMR loop. This
// separation is made explicit in the UX copy ("Editing this folder's
// config.json").
//
// ── Well-known keys ──────────────────────────────────────────────────────────
// presentation — object; at minimum `presentation.background` (CSS color)
// vars — object (key → string | number); rendered as key/value list
// liveRefresh — object (asset-name → interval ms); same key/value list
// colors — object sub-control
// fonts — object sub-control
// Unknown keys are preserved in the raw-JSON textarea fallback.
//
// ── Per-field commit ─────────────────────────────────────────────────────────
// Committing any field writes the full `config.json` via `writeProjectFile`,
// serialised with `serializeJson` (camelCase keys, stable key order, trailing
// newline). The chokidar watcher fires → cascade context recomputes → affected
// sections re-render automatically.
//
// ── No config.json yet ───────────────────────────────────────────────────────
// When the targeted folder has no `config.json`, a "create" prompt is shown.
// On confirmation, a minimal `{}` is written. Write failures are surfaced as a
// calm guidance banner; no partial file is left (atomic safe-write at the
// endpoint).
//
// ── Unknown keys ─────────────────────────────────────────────────────────────
// A "Show raw JSON" toggle surfaces the raw textarea at the bottom of the form.
// Invalid JSON is flagged inline and NOT written until valid.

import React from 'react';

import { serializeJson } from '@lerret/core';

import { EditorSheet } from './editor-sheet.jsx';
import { FormControl } from '../forms/index.js';
import { writeProjectFile } from '../../runtime/write-client.js';

// ── Known config keys (ordered for display) ──────────────────────────────────

/**
 * The well-known config.json keys rendered with typed FormControl widgets.
 * Order here is the display order in the form.
 * @type {ReadonlyArray<string>}
 */
export const KNOWN_KEYS = ['presentation', 'vars', 'liveRefresh', 'colors', 'fonts'];

// ── CSS injection (scoped, no global pollution) ────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('config-editor-styles')) {
 const s = document.createElement('style');
 s.id = 'config-editor-styles';
 s.textContent = `
.lm-config-editor {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-4, 16px);
}
.lm-config-editor__cascade-note {
 font: var(--lm-weight-regular, 400) var(--lm-size-hint, 10px)/var(--lm-lh-body, 1.45) var(--lm-font-sans);
 color: var(--lm-text-muted, #B8B3A8);
 letter-spacing: 0.04em;
 margin: 0;
 padding: 0 0 var(--lm-space-1, 4px);
 border-bottom: 1px solid var(--lm-border-light, #E8E2D4);
}
.lm-config-editor__path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 margin: 0;
 letter-spacing: 0.04em;
}
/* No-config-yet create prompt */
.lm-config-editor__create {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-3, 12px);
 padding: var(--lm-space-4, 16px);
 background: var(--lm-bg-secondary, #F2EEE6);
 border: 1px dashed var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
}
.lm-config-editor__create-msg {
 font-size: var(--lm-size-body, 13px);
 color: var(--lm-text-secondary, #3A3530);
 margin: 0;
 line-height: var(--lm-lh-body, 1.45);
}
.lm-config-editor__create-path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 letter-spacing: 0.04em;
 word-break: break-all;
}
.lm-config-editor__create-btn {
 align-self: flex-start;
 padding: var(--lm-space-2, 8px) var(--lm-space-4, 16px);
 font-family: var(--lm-font-sans);
 font-size: var(--lm-size-body-sm, 12px);
 font-weight: var(--lm-weight-semibold, 600);
 letter-spacing: 0.04em;
 color: var(--lm-text-primary, #1A1714);
 background: var(--lm-bg-primary, #FAF8F2);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 cursor: pointer;
 transition: background var(--lm-duration-fast, 120ms);
}
.lm-config-editor__create-btn:hover {
 background: var(--lm-bg-tertiary, #E8E2D4);
}
.lm-config-editor__create-btn:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}
.lm-config-editor__create-btn:disabled {
 opacity: 0.6;
 cursor: wait;
}
/* Raw JSON toggle */
.lm-config-editor__raw-toggle {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 font-family: var(--lm-font-sans);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-tertiary, #6E6960);
 background: none;
 border: none;
 cursor: pointer;
 padding: 0;
 text-decoration: underline;
 text-underline-offset: 2px;
}
.lm-config-editor__raw-toggle:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
 border-radius: 2px;
}
.lm-config-editor__raw-toggle:hover {
 color: var(--lm-text-primary, #1A1714);
}
/* Raw JSON textarea */
.lm-config-editor__json {
 width: 100%;
 min-height: 200px;
 box-sizing: border-box;
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-body, 13px);
 line-height: var(--lm-lh-body, 1.45);
 color: var(--lm-text-primary, #1A1714);
 background: var(--lm-bg-primary, #FAF8F2);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 outline: none;
 resize: vertical;
 transition: border-color var(--lm-duration-fast, 120ms) var(--lm-ease);
}
.lm-config-editor__json:focus {
 border-color: var(--lm-accent, #B85B33);
 box-shadow: var(--lm-focus-ring);
}
.lm-config-editor__json--invalid {
 border-color: var(--lm-error, #A8412B);
}
.lm-config-editor__json-error {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-error, #A8412B);
 line-height: var(--lm-lh-body, 1.45);
 margin: 0;
}
/* Saved indicator */
.lm-config-editor__saved {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-tertiary, #6E6960);
 opacity: 0;
 transition: opacity var(--lm-duration-base, 220ms) var(--lm-ease);
}
.lm-config-editor__saved[data-visible] { opacity: 1; }
.lm-config-editor__saved-dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-success, #4A6B3F);
}
/* Error banner */
.lm-config-editor__error-banner {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 background: var(--lm-bg-tertiary, #E8E2D4);
 border: 1px solid var(--lm-border, #DDD7CA);
 border-radius: var(--lm-radius-sm, 6px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-primary, #1A1714);
 line-height: var(--lm-lh-body, 1.45);
 word-break: break-all;
}

@media (prefers-reduced-motion: reduce) {
 .lm-config-editor__saved { transition: none !important; }
 .lm-config-editor__json { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── Config file reader ────────────────────────────────────────────────────────

/**
 * Fetch the config.json for a folder via the Vite dev server.
 * Returns `{ ok, value, missing?, error? }`.
 *
 * @param {string} configPath The {@link LerretPath} of the config file.
 * @returns {Promise<{ ok: boolean, value: Record<string, unknown>, missing?: boolean, error?: string }>}
 */
async function defaultReadConfigFile(configPath) {
 if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') {
 return { ok: false, value: {}, error: 'no fetch implementation available' };
 }
 const idx = configPath.indexOf('/.lerret/');
 const rel =
 idx === -1
 ? configPath.replace(/^\/+/, '')
 : configPath.slice(idx + '/.lerret/'.length);
 const candidates = [
 `/@lerret-project/${rel}`,
 `/@fixture-lerret/${rel}`,
 ];
 for (const url of candidates) {
 try {
 const response = await globalThis.fetch(url, { method: 'GET', cache: 'no-store' });
 if (response.status === 404) {
 // 404 on the first candidate doesn't mean missing — try the next.
 continue;
 }
 if (!response.ok) continue;
 const ct = response.headers.get('content-type') || '';
 if (!ct.includes('json') && !ct.includes('text/plain')) continue;
 const text = await response.text();
 try {
 const parsed = JSON.parse(text);
 return { ok: true, value: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
 } catch (err) {
 return {
 ok: false,
 value: {},
 error: err instanceof Error ? err.message : String(err),
 };
 }
 } catch {
 // Try the next candidate.
 }
 }
 // Neither alias resolved — treat as missing (no config.json yet).
 return { ok: true, value: {}, missing: true };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the config.json path for a folder.
 *
 * @param {string} folderPath The folder's {@link LerretPath}.
 * @returns {string}
 */
export function configFilePathFor(folderPath) {
 const p = folderPath.replace(/\/+$/, '');
 return `${p}/config.json`;
}

/**
 * Given the full config.json value, extract the UNKNOWN keys — those not in
 * KNOWN_KEYS. These are passed through to the raw-JSON fallback textarea.
 *
 * @param {Record<string, unknown>} cfg
 * @returns {Record<string, unknown>}
 */
export function extractUnknownKeys(cfg) {
 if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return {};
 return Object.fromEntries(
 Object.entries(cfg).filter(([k]) => !KNOWN_KEYS.includes(k)),
 );
}

/**
 * Merge the edited form values back into the full config, preserving unknown
 * keys. The well-known key override wins; unknown keys from the raw-JSON
 * fallback are merged in last.
 *
 * @param {Record<string, unknown>} formValues The form's current well-known values.
 * @param {Record<string, unknown>} unknownKeys The pass-through unknown keys.
 * @returns {Record<string, unknown>}
 */
export function mergeConfigValue(formValues, unknownKeys) {
 // Build the merged config. Start with the form-driven well-known keys,
 // then overlay the unknown keys (they live only in the raw-JSON path).
 const merged = {};
 // Include well-known keys that have a non-null, non-undefined value.
 for (const k of KNOWN_KEYS) {
 if (Object.prototype.hasOwnProperty.call(formValues, k) && formValues[k] !== undefined) {
 merged[k] = formValues[k];
 }
 }
 // Overlay the unknown keys (JSON-textarea values take priority for their keys).
 for (const [k, v] of Object.entries(unknownKeys)) {
 merged[k] = v;
 }
 return merged;
}

// ── Schema for the well-known presentation.background field ──────────────────

/**
 * The presentation object schema. `background` is a CSS color string.
 * Extensible: future well-known presentation keys can be added to `properties`.
 */
const PRESENTATION_SCHEMA = {
 type: 'object',
 description: 'Canvas presentation for this folder',
 properties: {
 background: {
 type: 'string',
 description: 'CSS color string for this section\'s background (e.g. #f0e8d8, rgba(241,237,229,0.85))',
 },
 },
};

/**
 * Schema for the `vars` object: keys are asset-accessible vars; values are
 * strings or numbers. No fixed property schema — the existing ObjectControl
 * renders current keys as text fields when `properties` is empty.
 */
const VARS_SCHEMA = {
 type: 'object',
 description: 'Cascade-inherited template variables (key → string/number)',
};

/**
 * Schema for `liveRefresh`: maps asset-name → interval ms (number).
 */
const LIVE_REFRESH_SCHEMA = {
 type: 'object',
 description: 'Live-refresh intervals per asset (asset-name → ms)',
};

/**
 * Schema for `colors` — a free-form object of color tokens.
 */
const COLORS_SCHEMA = {
 type: 'object',
 description: 'Color tokens for this folder',
};

/**
 * Schema for `fonts` — a free-form object of font tokens.
 */
const FONTS_SCHEMA = {
 type: 'object',
 description: 'Font tokens for this folder',
};

/**
 * Map of well-known key → schema fragment passed to {@link FormControl}.
 * @type {Record<string, import('../forms/validate.js').FieldSchema>}
 */
const KNOWN_KEY_SCHEMAS = {
 presentation: PRESENTATION_SCHEMA,
 vars: VARS_SCHEMA,
 liveRefresh: LIVE_REFRESH_SCHEMA,
 colors: COLORS_SCHEMA,
 fonts: FONTS_SCHEMA,
};

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Config editor for a page or group folder.
 *
 * Opens inside an {@link EditorSheet}. Reads and writes the folder's OWN
 * `config.json` — NOT the cascade-merged result. Per-field commit writes via
 * {@link writeProjectFile}; the chokidar watcher fires and the cascade context
 * recomputes so the canvas updates automatically.
 *
 * @param {object} props
 * @param {boolean} props.open
 * Whether the editor sheet is visible.
 * @param {() => void} props.onClose
 * Callback when the sheet dismisses.
 * @param {string} props.folderPath
 * The {@link LerretPath} of the folder (page or group) whose config.json is
 * being edited. Used to derive the file path and shown in the header.
 * @param {string} [props.folderName]
 * Human-readable name of the folder (its real folder name, not path). Used
 * in the sheet title. Falls back to the last path segment.
 * @param {(path: string, content: string) => Promise<{ ok: boolean, error?: string }>} [props.writer]
 * Override the write function — used by tests. Defaults to {@link writeProjectFile}.
 * @param {(configPath: string) => Promise<{ ok: boolean, value: Record<string, unknown>, missing?: boolean, error?: string }>} [props.reader]
 * Override the read function — used by tests. Defaults to the dev-server GET path.
 * @returns {React.ReactElement | null}
 */
export function ConfigEditor({ open, onClose, folderPath, folderName, writer, reader }) {
 const write = writer || writeProjectFile;
 const read = reader || defaultReadConfigFile;

 // Derive a display name from the prop or the last path segment.
 const displayName =
 folderName ||
 (folderPath ? folderPath.replace(/\/+$/, '').split('/').pop() : 'folder') ||
 'folder';

 const configPath = folderPath ? configFilePathFor(folderPath) : null;

 // ── State ──────────────────────────────────────────────────────────────────

 // Whether the file exists on disk (null = loading, true/false after read).
 const [fileExists, setFileExists] = React.useState(null);

 // The full file value as last successfully read from disk.
 const [fileValue, setFileValue] = React.useState(() => ({}));

 // Form state for well-known keys.
 const [formValues, setFormValues] = React.useState(() => ({}));

 // Unknown keys preserved from the file (passed through via rawJson textarea).
 const [unknownKeys, setUnknownKeys] = React.useState(() => ({}));

 // Raw JSON textarea: shown when user toggles "Show raw JSON"
 const [showRaw, setShowRaw] = React.useState(false);
 const [rawText, setRawText] = React.useState('');
 const [parseError, setParseError] = React.useState(null);
 const parseTimerRef = React.useRef(null);

 // Write status.
 const [saved, setSaved] = React.useState(false);
 const [writeError, setWriteError] = React.useState(null);
 const savedNonceRef = React.useRef(0);

 // Creating state (user clicked "Create config.json")
 const [creating, setCreating] = React.useState(false);

 // ── Effects ────────────────────────────────────────────────────────────────

 // Load config when the editor opens or the folder changes.
 React.useEffect(() => {
 if (!open || !configPath) return undefined;
 let cancelled = false;

 (async () => {
 setFileExists(null); // loading
 setWriteError(null);
 const result = await read(configPath);
 if (cancelled) return;

 if (!result.ok) {
 setWriteError(result.error || 'failed to read config.json');
 setFileExists(false);
 return;
 }

 if (result.missing) {
 setFileExists(false);
 setFileValue({});
 setFormValues({});
 setUnknownKeys({});
 setRawText(serializeJson({}));
 return;
 }

 setFileExists(true);
 const cfg = result.value;
 setFileValue(cfg);
 // Seed the form with well-known keys only.
 const knownSlice = {};
 for (const k of KNOWN_KEYS) {
 if (Object.prototype.hasOwnProperty.call(cfg, k)) {
 knownSlice[k] = cfg[k];
 }
 }
 setFormValues(knownSlice);
 // Extract unknown keys for the raw-JSON fallback textarea.
 const unk = extractUnknownKeys(cfg);
 setUnknownKeys(unk);
 setRawText(serializeJson(unk));
 setParseError(null);
 })();

 return () => { cancelled = true; };
 // Re-run when opening or when the target folder changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open, configPath]);

 // Cleanup any debounce timer on unmount.
 React.useEffect(
 () => () => {
 if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
 },
 [],
 );

 // ── Write helpers ──────────────────────────────────────────────────────────

 /** Flash "Saved" for 1.5 s, extending if commits arrive in rapid succession. */
 const flashSaved = React.useCallback(() => {
 savedNonceRef.current += 1;
 const myNonce = savedNonceRef.current;
 setSaved(true);
 setTimeout(() => {
 if (savedNonceRef.current === myNonce) setSaved(false);
 }, 1500);
 }, []);

 /**
 * Write the given config value to disk. Returns true on success.
 *
 * @param {Record<string, unknown>} nextValue The full config object to write.
 * @returns {Promise<boolean>}
 */
 const writeConfig = React.useCallback(
 async (nextValue) => {
 if (!configPath) {
 setWriteError('cannot determine config.json path');
 return false;
 }
 const content = serializeJson(nextValue);
 const result = await write(configPath, content);
 if (!result.ok) {
 setWriteError(result.error || 'write failed');
 return false;
 }
 setWriteError(null);
 setFileValue(nextValue);
 setFileExists(true);
 flashSaved();
 return true;
 },
 [configPath, write, flashSaved],
 );

 // ── Per-field commit (well-known keys) ────────────────────────────────────

 const commitField = React.useCallback(
 async (fieldKey, fieldValue) => {
 // Optimistic update.
 const nextFormValues = { ...formValues, [fieldKey]: fieldValue };
 setFormValues(nextFormValues);

 // Rebuild the full config value and write it.
 const next = mergeConfigValue(nextFormValues, unknownKeys);
 await writeConfig(next);
 },
 [formValues, unknownKeys, writeConfig],
 );

 // ── Raw JSON textarea (unknown keys) ─────────────────────────────────────

 const onRawChange = React.useCallback(
 (e) => {
 const text = e.target.value;
 setRawText(text);
 if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
 parseTimerRef.current = setTimeout(async () => {
 // Parse the raw text. Must be a JSON object.
 let parsed;
 try {
 parsed = JSON.parse(text);
 } catch (err) {
 setParseError(err instanceof Error ? err.message : String(err));
 return;
 }
 if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
 setParseError('JSON must be an object');
 return;
 }
 setParseError(null);

 // Only unknown keys should live here. Strip any known keys the user
 // may have typed (silently, to avoid confusing double-source-of-truth).
 const sanitizedUnknown = Object.fromEntries(
 Object.entries(parsed).filter(([k]) => !KNOWN_KEYS.includes(k)),
 );
 setUnknownKeys(sanitizedUnknown);

 const next = mergeConfigValue(formValues, sanitizedUnknown);
 await writeConfig(next);
 }, 500);
 },
 [formValues, writeConfig],
 );

 // ── Create config.json flow ───────────────────────────────────────────────

 const handleCreate = React.useCallback(async () => {
 setCreating(true);
 const next = {};
 const ok = await writeConfig(next);
 if (ok) {
 setFileExists(true);
 setFormValues({});
 setUnknownKeys({});
 setRawText(serializeJson({}));
 }
 setCreating(false);
 }, [writeConfig]);

 // ── Derived ───────────────────────────────────────────────────────────────

 const sheetTitle = `Config · ${displayName}`;

 // ── Footer ────────────────────────────────────────────────────────────────

 const footer = (
 <>
 {writeError && (
 <div className="lm-config-editor__error-banner" role="alert" aria-live="polite">
 <span>
 {fileExists === false
 ? `Could not write ${configPath ?? 'config.json'}: ${writeError}`
 : `Write failed: ${writeError}`}
 </span>
 </div>
 )}
 <span
 className="lm-config-editor__saved"
 data-visible={saved ? '' : undefined}
 aria-live="polite"
 >
 <span className="lm-config-editor__saved-dot" aria-hidden="true" />
 Saved
 </span>
 </>
 );

 // ── Render ────────────────────────────────────────────────────────────────

 return (
 <EditorSheet open={open} onClose={onClose} title={sheetTitle} dirty={false} footer={footer}>
 <div className="lm-config-editor" data-testid="lm-config-editor">

 {/* Path + cascade note */}
 {configPath && (
 <p className="lm-config-editor__path" data-testid="lm-config-editor-path">
 {configPath}
 </p>
 )}
 <p className="lm-config-editor__cascade-note">
 Editing this folder&apos;s config.json — values may be inherited from a parent folder
 </p>

 {/* Loading state */}
 {fileExists === null && (
 <p style={{ fontSize: 'var(--lm-size-body, 13px)', color: 'var(--lm-text-muted, #B8B3A8)' }}>
 Loading…
 </p>
 )}

 {/* No config.json yet — offer to create */}
 {fileExists === false && (
 <div className="lm-config-editor__create" data-testid="lm-config-editor-create">
 <p className="lm-config-editor__create-msg">
 This folder does not have a <code>config.json</code> yet.
 </p>
 <code className="lm-config-editor__create-path">{configPath}</code>
 <button
 type="button"
 className="lm-config-editor__create-btn"
 onClick={handleCreate}
 disabled={creating}
 data-testid="lm-config-editor-create-btn"
 >
 {creating ? 'Creating…' : 'Create config.json'}
 </button>
 </div>
 )}

 {/* Well-known key form */}
 {fileExists === true && (
 <KnownKeyForm
 formValues={formValues}
 onCommitField={commitField}
 fileValue={fileValue}
 />
 )}

 {/* Unknown keys / raw JSON toggle */}
 {fileExists === true && (
 <div>
 <button
 type="button"
 className="lm-config-editor__raw-toggle"
 onClick={() => setShowRaw((v) => !v)}
 aria-expanded={showRaw}
 data-testid="lm-config-editor-raw-toggle"
 >
 {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
 {Object.keys(unknownKeys).length > 0 && ` (${Object.keys(unknownKeys).length} extra key${Object.keys(unknownKeys).length === 1 ? '' : 's'})`}
 </button>
 {showRaw && (
 <div style={{ marginTop: 'var(--lm-space-2, 8px)' }}>
 <p style={{ fontSize: 'var(--lm-size-hint, 10px)', color: 'var(--lm-text-muted, #B8B3A8)', margin: '0 0 6px', letterSpacing: '0.04em' }}>
 Unknown / free-form keys (will be preserved on save)
 </p>
 <textarea
 className={
 'lm-config-editor__json' +
 (parseError ? ' lm-config-editor__json--invalid' : '')
 }
 value={rawText}
 onChange={onRawChange}
 spellCheck={false}
 autoCorrect="off"
 autoCapitalize="off"
 aria-invalid={parseError ? 'true' : undefined}
 aria-label="Raw JSON for unknown config keys"
 data-testid="lm-config-editor-raw-json"
 />
 {parseError && (
 <p className="lm-config-editor__json-error" role="alert" aria-live="polite">
 <span>Invalid JSON: {parseError}</span>
 </p>
 )}
 </div>
 )}
 </div>
 )}
 </div>
 </EditorSheet>
 );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

/**
 * Renders a FormControl for each well-known config key. Only keys with a
 * non-null value in the file OR in the schema are shown. Skips null/undefined
 * form values (the file may omit a key — the field only renders when set or
 * when the key is present in the file).
 *
 * @param {object} props
 * @param {Record<string, unknown>} props.formValues Current form values.
 * @param {(key: string, value: unknown) => void} props.onCommitField
 * @param {Record<string, unknown>} props.fileValue Full file value (used to
 * decide which keys to show — only show keys present in file OR always
 * show `presentation` and `vars` as they are the most common).
 */
function KnownKeyForm({ formValues, onCommitField, fileValue }) {
 // Always render the most-common keys; show others only when the file has them.
 const ALWAYS_SHOW = new Set(['presentation', 'vars', 'liveRefresh']);

 return (
 <>
 {KNOWN_KEYS.map((key) => {
 const schema = KNOWN_KEY_SCHEMAS[key];
 const inFile = Object.prototype.hasOwnProperty.call(fileValue, key);
 if (!ALWAYS_SHOW.has(key) && !inFile) return null;

 const value = Object.prototype.hasOwnProperty.call(formValues, key)
 ? formValues[key]
 : (inFile ? fileValue[key] : undefined);

 return (
 <div key={key} data-testid={`lm-config-editor-field-${key}`}>
 <FormControl
 fieldKey={key}
 schema={schema}
 value={value}
 onCommit={(v) => onCommitField(key, v)}
 />
 </div>
 );
 })}
 </>
 );
}

export default ConfigEditor;
