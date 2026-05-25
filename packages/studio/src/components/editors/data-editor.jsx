// data-editor.jsx — schema-driven editor for an asset's data file
// (variant tab picker and create-data-file affordance included).
//
// ── What it does ─────────────────────────────────────────────────────────────
// Renders inside an {@link EditorSheet}. For an asset whose `meta`
// declares a `propsSchema`, it generates a form using {@link FormControl},
// pre-filled with the asset's currently-resolved variant data.
// Per-field commit writes the data file via the studio→CLI write client and
// flashes a brief "Saved" indicator. The existing chokidar watcher detects the
// disk change, fires `lerret:change`, and the reload loop
// re-renders the affected artboard automatically.
//
// ── Schema fallback ──────────────────────────────────────────────────────────
// If the asset's `meta` declares NO `propsSchema`, the editor falls back to a
// raw JSON textarea over the data file's contents. Invalid JSON is flagged
// with a calm inline message and is NOT written until valid (NFR9). The parse
// is debounced so a transient half-typed state doesn't flash a warning.
//
// ── Variant tab picker ───────────────────────────────────────────────────────
// When an asset has multiple named exports (variants), the editor
// shows a {@link VariantTabs} row at the top. Selecting a tab loads that
// variant's keyed data sub-object (via `resolveVariantData`). Arrow keys cycle
// tabs. Single-variant assets see no tab row.
//
// ── Flat→keyed migration ─────────────────────────────────────────────────────
// When a multi-variant asset's data file is currently flat (shared mode — the
// file is one flat JSON object, no per-variant keys), the first per-field commit
// on a specific variant tab migrates the file to keyed shape:
// Before: { "headline": "Hello" }
// After: { "default": { "headline": "Hello", "x": "newVal" }, "Dark": {} }
// The migration preserves the existing flat data under the variant whose tab was
// active at the time of the first keyed edit.
//
// ── Create-data-file affordance (FR28) ───────────────────────────────────────
// When the reader reports `missing: true` (no co-located data file), the editor
// renders a "create data file" call-to-action instead of the form. Activating
// it writes a new `<Name>.data.json` via `writeProjectFile`:
// - Single-variant asset: `{}` (or `{ key: default }` if propsSchema has
// defaults). Specifically: the schema defaults merged into `{}`.
// - Multi-variant asset: keyed shape `{ "exportName": {...defaults} }` per
// variant.
// - No schema at all: `{}`.
// On success the editor transitions into normal form mode over the new file.
// A failed write surfaces a calm guidance message with the file path; the CTA
// remains for retry.
//
// ── Where the data file lives ────────────────────────────────────────────────
// Co-located with the asset file: for an asset at `<dir>/<Name>.jsx`, the data
// file is `<dir>/<Name>.data.json`. We compute this purely from the asset's
// path — no filesystem call needed.
//
// ── Inline invalid state ─────────────────────────────────────────────────────
// `FormControl` already renders the calm inline invalid state
// when a field's value fails its schema. We do not block input or commit on
// invalid — the editor stays usable so the user can fix the file without the
// editor fighting them (FR32, NFR8). This is the surface the validation
// badge ties into.

import React from 'react';

import { resolveVariantData, serializeJson } from '@lerret/core';

import { EditorSheet } from './editor-sheet.jsx';
import { VariantTabs } from './variant-tabs.jsx';
import { FormControl } from '../forms/index.js';
import { writeProjectFile } from '../../runtime/write-client.js';

/**
 * Default reader for the asset's data file. Performs a same-origin GET via
 * the Vite dev server (which serves the `.lerret/` tree). A 404 is treated
 * as "file does not exist yet" — the editor pre-fills from schema defaults
 * only and the first commit creates the file.
 *
 * @param {string} dataPath The {@link LerretPath} of the data file.
 * @returns {Promise<{ ok: boolean, value: unknown, missing?: boolean, error?: string }>}
 */
async function defaultReadDataFile(dataPath) {
 if (typeof globalThis === 'undefined' || typeof globalThis.fetch !== 'function') {
 return { ok: false, value: {}, error: 'no fetch implementation available' };
 }
 // The studio's CliProjectSource passes the `assetBaseUrl` it received from
 // the CLI plugin (e.g. `/@lerret-project`). The asset's `LerretPath` is
 // already the fully-qualified path under the project root, so we strip the
 // root prefix and rebase. To stay decoupled from the runtime here, we use
 // a single convention: an absolute `LerretPath` whose tail after the last
 // `.lerret/` is the URL-relative form. This mirrors how the asset-runtime
 // composes module URLs and matches both the fixture alias (used by
 // standalone dev) and the CLI plugin's `/@lerret-project` alias.
 const idx = dataPath.indexOf('/.lerret/');
 const rel = idx === -1 ? dataPath.replace(/^\/+/, '') : dataPath.slice(idx + '/.lerret/'.length);
 const candidates = [
 `/@lerret-project/${rel}`,
 `/@fixture-lerret/${rel}`,
 ];
 for (const url of candidates) {
 try {
 const response = await globalThis.fetch(url, { method: 'GET', cache: 'no-store' });
 if (response.status === 404) continue;
 if (!response.ok) continue;
 // The Vite dev server returns the SPA `index.html` for unknown paths.
 // Treat any non-JSON-ish content-type as missing so we don't try to
 // parse HTML as the data file.
 const ct = response.headers.get('content-type') || '';
 if (!ct.includes('json') && !ct.includes('text/plain')) continue;
 const text = await response.text();
 try {
 return { ok: true, value: JSON.parse(text) };
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
 // None resolved — treat as missing (a fresh data file).
 return { ok: true, value: {}, missing: true };
}

// ── CSS injection (scoped, no global pollution) ─────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('data-editor-styles')) {
 const s = document.createElement('style');
 s.id = 'data-editor-styles';
 s.textContent = `
.lm-data-editor {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-4, 16px);
}
.lm-data-editor__empty {
 font: var(--lm-weight-regular, 400) var(--lm-size-body, 13px)/var(--lm-lh-body, 1.45) var(--lm-font-sans);
 color: var(--lm-text-tertiary, #6E6960);
 padding: var(--lm-space-3, 12px) 0;
}
.lm-data-editor__path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 margin: 0;
 letter-spacing: 0.04em;
}
.lm-data-editor__field {
 /* FormControl already renders its own .lm-field wrapper */
}
.lm-data-editor__json {
 width: 100%;
 min-height: 280px;
 box-sizing: border-box;
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-body, 13px);
 line-height: var(--lm-lh-body, 1.45);
 color: var(--lm-text-primary, #1A1714);
 background: var(--lm-bg-tertiary, #E8E2D4);
 border: none;
 border-radius: var(--lm-radius-sm, 6px);
 outline: none;
 resize: vertical;
 transition: box-shadow var(--lm-duration-fast, 120ms) var(--lm-ease);
}
.lm-data-editor__json:focus {
 box-shadow: var(--lm-focus-ring);
}
.lm-data-editor__json--invalid {
 background: var(--lm-error-light);
 box-shadow: inset 0 0 0 1.5px var(--lm-error-border);
}
.lm-data-editor__json-error {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-error, #A8412B);
 line-height: var(--lm-lh-body, 1.45);
 margin: 0;
}
.lm-data-editor__saved {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-tertiary, #6E6960);
 opacity: 0;
 transition: opacity var(--lm-duration-base, 220ms) var(--lm-ease);
}
.lm-data-editor__saved[data-visible] { opacity: 1; }
.lm-data-editor__saved-dot {
 width: 6px;
 height: 6px;
 border-radius: var(--lm-radius-pill, 999px);
 background: var(--lm-success, #4A6B3F);
}
.lm-data-editor__error-banner {
 display: flex;
 align-items: flex-start;
 gap: var(--lm-space-2, 8px);
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 background: var(--lm-error-light);
 border-radius: var(--lm-radius-sm, 6px);
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-text-primary, #1A1714);
}
.lm-data-editor__create {
 display: flex;
 flex-direction: column;
 gap: var(--lm-space-3, 12px);
 padding: var(--lm-space-4, 16px) 0;
}
.lm-data-editor__create-msg {
 font: var(--lm-weight-regular, 400) var(--lm-size-body, 13px)/var(--lm-lh-body, 1.45) var(--lm-font-sans, ui-sans-serif);
 color: var(--lm-text-secondary, #3A3530);
 margin: 0;
}
.lm-data-editor__create-path {
 font-family: var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace);
 font-size: var(--lm-size-hint, 10px);
 color: var(--lm-text-muted, #B8B3A8);
 letter-spacing: 0.04em;
}
.lm-data-editor__create-btn {
 display: inline-flex;
 align-items: center;
 gap: var(--lm-space-1, 4px);
 padding: var(--lm-space-2, 8px) var(--lm-space-3, 12px);
 font: var(--lm-weight-medium, 600) var(--lm-size-body, 13px)/var(--lm-lh-body, 1.45) var(--lm-font-sans, ui-sans-serif);
 color: var(--lm-bg-primary, #FAF8F2);
 background: var(--lm-accent, #B85B33);
 border: none;
 border-radius: var(--lm-radius-sm, 6px);
 cursor: pointer;
 align-self: flex-start;
 outline: none;
 transition: opacity var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
.lm-data-editor__create-btn:focus-visible {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184, 91, 51, 0.20));
}
.lm-data-editor__create-btn:disabled {
 opacity: 0.5;
 cursor: not-allowed;
}
.lm-data-editor__create-error {
 font-size: var(--lm-size-body-sm, 12px);
 color: var(--lm-error, #A8412B);
 margin: 0;
}

@media (prefers-reduced-motion: reduce) {
 .lm-data-editor__saved { transition: none !important; }
 .lm-data-editor__create-btn { transition: none !important; }
}
 `.trim();
 document.head.appendChild(s);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the data file path for an asset, co-located with the asset file.
 *
 * @param {{ path: string, name: string }} asset
 * @returns {string} The {@link LerretPath} the data file lives at.
 */
export function dataFilePathFor(asset) {
 const slash = asset.path.lastIndexOf('/');
 const dir = slash === -1 ? '' : asset.path.slice(0, slash + 1);
 return `${dir}${asset.name}.data.json`;
}

/**
 * The primary variant's resolved data value (already extracted from a keyed
 * data file when present). The variant tab picker lets the editor target
 * named-export variants; for the single-variant path we always edit the
 * primary variant.
 *
 * Behavior:
 * - When the asset has no data record (or `source === 'absent'`), returns
 * an empty object so the form pre-fills with defaults.
 * - When `resolveVariantData` says the primary variant is `'shared'`,
 * returns the whole data object (the file is the shared payload).
 * - When the primary variant is `'keyed'`, returns the sub-object under the
 * primary export name (the file's other keys belong to other variants).
 *
 * @param {object | null} assetData
 * The `AssetData` record for the asset (from core's `loadAssetData`).
 * @param {string[]} variantExportNames
 * Variant export names — typically `entry.variantName` is the primary one.
 * @returns {{ value: object, mode: 'shared' | 'keyed' | 'absent', primaryName: string }}
 */
export function primaryVariantData(assetData, variantExportNames) {
 const names = Array.isArray(variantExportNames) && variantExportNames.length > 0
 ? variantExportNames
 : ['default'];
 // The "primary" name is whichever name is the default — fall back to the
 // first export name when no explicit `default` is present.
 const primaryName = names.includes('default') ? 'default' : names[0];

 if (!assetData || assetData.source === 'absent') {
 return { value: {}, mode: 'absent', primaryName };
 }

 const map = resolveVariantData(assetData, names);
 const rec = map.get(primaryName);
 if (!rec || rec.source === 'absent') {
 return { value: {}, mode: 'absent', primaryName };
 }
 const value = rec.value && typeof rec.value === 'object' && !Array.isArray(rec.value)
 ? rec.value
 : {};
 return { value, mode: rec.source, primaryName };
}

/**
 * Merge a single per-field commit into the data file's full value, handling
 * the keyed/shared/absent shapes correctly. Pure function — the editor calls
 * this to compute the next-write payload.
 *
 * @param {unknown} currentFileValue
 * The current full file contents (parsed JSON). May be undefined when no
 * file exists yet.
 * @param {object} ctx
 * @param {'shared' | 'keyed' | 'absent'} ctx.mode
 * @param {string} ctx.primaryName
 * @param {string} ctx.fieldKey
 * @param {unknown} ctx.fieldValue
 * @returns {object}
 */
export function applyFieldCommit(currentFileValue, ctx) {
 const { mode, primaryName, fieldKey, fieldValue } = ctx;
 const base = currentFileValue && typeof currentFileValue === 'object' && !Array.isArray(currentFileValue)
 ? currentFileValue
 : {};
 if (mode === 'keyed') {
 const existingSlot = base[primaryName] && typeof base[primaryName] === 'object' && !Array.isArray(base[primaryName])
 ? base[primaryName]
 : {};
 return { ...base, [primaryName]: { ...existingSlot, [fieldKey]: fieldValue } };
 }
 // shared OR absent → the file is a flat object editor-side.
 return { ...base, [fieldKey]: fieldValue };
}

/**
 * Merge a per-field commit for a specific named variant into the data file's
 * full value. Handles the flat→keyed migration: when `currentMode` is
 * `'shared'` or `'absent'` (flat file) but we are writing to a named variant
 * in a multi-variant asset, the file must be promoted to keyed shape. The
 * existing flat data is placed under `migrateFrom` (the variant whose flat
 * data we wish to preserve).
 *
 * Migration contract:
 * Before (shared/absent): { "headline": "Hello" }
 * After (keyed, active tab "Dark"): { "default": { "headline": "Hello" }, "Dark": { "x": "val" } }
 * - The previous flat content goes under `migrateFrom`.
 * - The new field goes under `variantName`.
 * - Other variant names get `{}` in the output to keep the keyed shape stable.
 *
 * @param {unknown} currentFileValue
 * The current full file contents (parsed JSON).
 * @param {object} ctx
 * @param {'shared' | 'keyed' | 'absent'} ctx.currentMode
 * How the file is currently structured.
 * @param {string} ctx.variantName
 * The active tab's export name.
 * @param {string} ctx.migrateFrom
 * The "primary" variant name that receives the old flat data during migration.
 * @param {string[]} ctx.allVariants
 * All variant export names — so every variant gets a slot in the keyed output.
 * @param {string} ctx.fieldKey
 * @param {unknown} ctx.fieldValue
 * @returns {{ next: object, didMigrate: boolean }}
 * The next file value and whether a flat→keyed migration occurred.
 */
export function applyVariantFieldCommit(currentFileValue, ctx) {
 const { currentMode, variantName, migrateFrom, allVariants, fieldKey, fieldValue } = ctx;
 const base = currentFileValue && typeof currentFileValue === 'object' && !Array.isArray(currentFileValue)
 ? /** @type {Record<string, unknown>} */ (currentFileValue)
 : {};

 if (currentMode === 'keyed') {
 // Already keyed — merge into the variant's slot.
 const existingSlot = base[variantName] && typeof base[variantName] === 'object' && !Array.isArray(base[variantName])
 ? base[variantName]
 : {};
 const next = { ...base, [variantName]: { ...existingSlot, [fieldKey]: fieldValue } };
 return { next, didMigrate: false };
 }

 // flat→keyed migration: current file is shared/absent.
 // Build a keyed result where:
 // - migrateFrom gets the existing flat data (preserved).
 // - variantName gets the new field.
 // - all others get an empty slot.
 const migratedFlat = currentMode === 'shared' ? { ...base } : {};
 const newKeyed = {};
 for (const name of allVariants) {
 if (name === variantName) {
 newKeyed[name] = { [fieldKey]: fieldValue };
 } else if (name === migrateFrom) {
 newKeyed[name] = { ...migratedFlat };
 } else {
 newKeyed[name] = {};
 }
 }
 return { next: newKeyed, didMigrate: true };
}

/**
 * Extract a seed object for a single variant from the asset's `propsSchema`.
 * Only `default`-carrying descriptors contribute; props without a `default`
 * are omitted (they fall through to tier-4 component defaults).
 *
 * @param {Record<string, { default?: unknown }> | null | undefined} propsSchema
 * @returns {Record<string, unknown>}
 */
export function seedFromSchema(propsSchema) {
 if (!propsSchema || typeof propsSchema !== 'object') return {};
 const seed = {};
 for (const [key, descriptor] of Object.entries(propsSchema)) {
 if (descriptor && typeof descriptor === 'object' && Object.prototype.hasOwnProperty.call(descriptor, 'default')) {
 seed[key] = descriptor.default;
 }
 }
 return seed;
}

/**
 * Build the initial seed content for a brand-new data file (create-data-file
 * affordance, FR28). Uses `propsSchema` defaults:
 * - Single-variant (one export name): a flat `{ key: default }` object.
 * - Multi-variant: a keyed shape `{ exportName: { key: default }, ... }`.
 * - No schema: `{}`.
 *
 * @param {string[]} variantNames
 * @param {Record<string, unknown> | null | undefined} propsSchema
 * @returns {object}
 */
export function buildCreateSeed(variantNames, propsSchema) {
 const seed = seedFromSchema(propsSchema);
 const names = Array.isArray(variantNames) && variantNames.length > 0 ? variantNames : ['default'];
 if (names.length === 1) {
 // Single-variant: flat shape.
 return { ...seed };
 }
 // Multi-variant: keyed shape — each variant gets the same defaults to start.
 const out = {};
 for (const name of names) {
 out[name] = { ...seed };
 }
 return out;
}

/**
 * Extract one variant's current data from the full file value, respecting
 * keyed/shared/absent shapes (used when switching tabs).
 *
 * @param {unknown} fileValue The full JSON file value.
 * @param {string} variantName The target variant's export name.
 * @param {string[]} allVariants All export names.
 * @returns {{ formValues: Record<string, unknown>, mode: 'keyed' | 'shared' | 'absent' }}
 */
export function variantDataForTab(fileValue, variantName, allVariants) {
 const synthetic = fileValue && typeof fileValue === 'object' && !Array.isArray(fileValue)
 ? { source: 'json', value: fileValue }
 : { source: 'absent' };
 const map = resolveVariantData(synthetic, allVariants);
 const rec = map.get(variantName);
 if (!rec || rec.source === 'absent') {
 return { formValues: {}, mode: 'absent' };
 }
 const value = rec.value && typeof rec.value === 'object' && !Array.isArray(rec.value)
 ? rec.value
 : {};
 return { formValues: { ...value }, mode: rec.source };
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Data editor for a single asset.
 *
 * Opens inside an {@link EditorSheet}. Per-field commit writes the
 * co-located data file via {@link writeProjectFile}. The watcher → reload
 * loop updates the canvas automatically.
 *
 * Features:
 * - Variant tab picker ({@link VariantTabs}) when the asset has > 1 export.
 * - Create-data-file affordance when no co-located data file exists.
 * - Flat→keyed migration on first per-variant edit (see {@link applyVariantFieldCommit}).
 *
 * @param {object} props
 * @param {boolean} props.open
 * Whether the editor sheet is visible.
 * @param {() => void} props.onClose
 * Callback when the sheet dismisses.
 * @param {object} props.entry
 * The `AssetEntry` from the runtime — carries `.asset`, `.meta`,
 * `.variantName`, `.variantNames`, `.label`. We rely on
 * `entry.meta.propsSchema` (if any) and `entry.asset.path` to derive the
 * data file path.
 * `entry.variantNames` — an ordered array of all export names
 * for this asset. Falls back to `[entry.variantName || 'default']`.
 * @param {object} [props.assetData]
 * Optional seed `AssetData` record (e.g. from `loadAssetData`). When
 * omitted, the editor fetches the current file from the dev server when it
 * opens. The data is read but not written-through here — every commit
 * writes via {@link writeProjectFile} and the watcher fans the change out.
 * @param {(path: string, content: string) => Promise<{ ok: boolean, error?: string }>} [props.writer]
 * Override the writer — used by tests. Defaults to {@link writeProjectFile}.
 * @param {(dataPath: string) => Promise<{ ok: boolean, value: unknown, missing?: boolean, error?: string }>} [props.reader]
 * Override the reader — used by tests. Defaults to the dev-server GET path.
 * @param {string} [props.initialFocusField]
 * When set, the editor scrolls to and focuses the matching
 * FormControl input on open (the first offending field from click-to-fix).
 * Optional — has no effect when the field is not found or has no schema.
 * @param {string} [props.initialActiveVariant]
 * When set, the editor pre-selects this variant tab on open
 * instead of defaulting to the primary variant. Optional — ignored when
 * the variant name is not in the asset's variant list.
 * @returns {React.ReactElement | null}
 */
export function DataEditor({ open, onClose, entry, assetData, writer, reader, initialFocusField, initialActiveVariant }) {
 const write = writer || writeProjectFile;
 const read = reader || defaultReadDataFile;

 // ── Derivations off the entry ─────────────────────────────────────────────
 // Defensive against an entry without a usable asset (the editor is invoked
 // off a runtime entry, but tests may pass a minimal shape).
 const asset = entry?.asset;
 const meta = entry?.meta || {};
 const propsSchema = meta && typeof meta.propsSchema === 'object' ? meta.propsSchema : null;

 // Support multi-variant assets. `entry.variantNames` is the full
 // ordered list of all export names. Fall back to single-name array.
 // Computed eagerly — stable as long as `entry` is stable (the studio mounts
 // one DataEditor instance and rebinds it per-asset via prop changes).
 const entryVariantNames = entry?.variantNames;
 const entryVariantName = entry?.variantName;
 const variantNames = React.useMemo(() => {
 if (Array.isArray(entryVariantNames) && entryVariantNames.length > 0) {
 return entryVariantNames;
 }
 return entryVariantName ? [entryVariantName] : ['default'];
 }, [entryVariantNames, entryVariantName]);

 const isMultiVariant = variantNames.length > 1;

 // The "primary" name (for flat→keyed migration: the variant that receives
 // the old flat data when we promote the file to keyed shape).
 const primaryName = variantNames.includes('default') ? 'default' : variantNames[0];

 const dataPath = asset ? dataFilePathFor(asset) : null;

 // ── All state declarations ────────────────────────────────────────────────

 // Active variant tab — starts at the primary (default) variant, or the
 // initialActiveVariant when supplied by the caller (click-to-fix).
 const resolvedInitialVariant = React.useMemo(() => {
 if (initialActiveVariant && variantNames.includes(initialActiveVariant)) {
 return initialActiveVariant;
 }
 return primaryName;
 }, [initialActiveVariant, variantNames, primaryName]);

 const [activeVariant, setActiveVariant] = React.useState(resolvedInitialVariant);

 // Whether the data file is missing (create-data-file affordance visible).
 const [fileMissing, setFileMissing] = React.useState(false);
 // Create-data-file: busy flag + per-attempt error.
 const [creating, setCreating] = React.useState(false);
 const [createError, setCreateError] = React.useState(null);

 // The full raw file value — what we merge into on every write.
 const [fileValue, setFileValue] = React.useState(() =>
 assetData && assetData.source !== 'absent' ? assetData.value : {},
 );

 // The current file structure mode — 'keyed', 'shared', or 'absent'.
 // Starts from the prop; refined once we fetch the file on open.
 const [fileMode, setFileMode] = React.useState(() => {
 if (!assetData || assetData.source === 'absent') return 'absent';
 const primary = primaryVariantData(assetData, variantNames);
 return primary.mode;
 });

 // `formValues` — the data shown in the currently-active variant's form.
 const [formValues, setFormValues] = React.useState(() => {
 const primary = primaryVariantData(assetData, variantNames);
 return { ...primary.value };
 });

 // Saved indicator + write error.
 const [saved, setSaved] = React.useState(false);
 const [writeError, setWriteError] = React.useState(null);
 const savedNonceRef = React.useRef(0);

 // Raw-JSON fallback path (no propsSchema).
 const [rawText, setRawText] = React.useState(() =>
 serializeJson(assetData && assetData.source !== 'absent' ? assetData.value : {}),
 );
 const [parseError, setParseError] = React.useState(null);
 const parseTimerRef = React.useRef(null);

 // ── Shared "flash saved" helper ───────────────────────────────────────────
 const flashSaved = React.useCallback(() => {
 savedNonceRef.current += 1;
 const myNonce = savedNonceRef.current;
 setSaved(true);
 setTimeout(() => {
 if (savedNonceRef.current === myNonce) setSaved(false);
 }, 1500);
 }, []);

 // ── Effects ──────────────────────────────────────────────────────────────

 // Re-seed form state whenever a different entry is opened.
 React.useEffect(() => {
 // When the entry changes, re-apply the initialActiveVariant (if valid).
 const startVariant =
 initialActiveVariant && variantNames.includes(initialActiveVariant)
 ? initialActiveVariant
 : primaryName;
 setActiveVariant(startVariant);
 setFileMissing(false);
 setCreateError(null);
 setFileValue(assetData && assetData.source !== 'absent' ? assetData.value : {});
 const primary = primaryVariantData(assetData, variantNames);
 setFileMode(primary.mode);
 setFormValues({ ...primary.value });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.id, entry?.variantName]);

 // When the editor opens (open goes true), apply initialActiveVariant
 // (if provided and not already active) and schedule initialFocusField scroll.
 // This runs separately from the entry-change effect so a re-open of the same
 // entry also re-applies the overrides from the badge's click-to-fix.
 const prevOpenRef = React.useRef(false);
 React.useEffect(() => {
 const justOpened = open && !prevOpenRef.current;
 prevOpenRef.current = open;
 if (!justOpened) return;

 // Apply initialActiveVariant when different from the current tab.
 if (initialActiveVariant && variantNames.includes(initialActiveVariant)) {
 setActiveVariant(initialActiveVariant);
 // Reseed the form to the target variant's data from cached fileValue.
 // (fileValue may be stale at this point; the open-time reader effect
 // fires concurrently. The field focus is applied after a tick so that
 // both the form render and the file read have settled.)
 }
 }, [open, initialActiveVariant, variantNames]);

 // Scroll+focus the initialFocusField after the editor opens and
 // the schema form has had a chance to render. We use a one-shot ref so we
 // only focus on the *opening* of the editor (not on every re-render).
 const focusAppliedRef = React.useRef(false);
 React.useEffect(() => {
 if (!open) {
 // Reset on close so the next open can re-apply.
 focusAppliedRef.current = false;
 return;
 }
 if (!initialFocusField || focusAppliedRef.current) return;
 // Give React one frame to render the form fields, then locate the input.
 const timer = setTimeout(() => {
 // FormControl renders inputs with data-field-key or name matching the prop.
 // We target any input/select/textarea inside a [data-field-key] wrapper,
 // or fall back to a name/id attribute match.
 // `CSS.escape` may not be available in jsdom test environments.
 // Use a safe attribute-value escape for alphanumeric prop names (the
 // common case in propsSchema) and fall back gracefully when unmatched.
 const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
 ? CSS.escape(initialFocusField)
 : initialFocusField.replace(/[^\w-]/g, '\\$&');
 const selector = [
 `[data-field-key="${escaped}"] input`,
 `[data-field-key="${escaped}"] select`,
 `[data-field-key="${escaped}"] textarea`,
 `[data-field-key="${escaped}"]`,
 `[name="${escaped}"]`,
 `#field-${escaped}`,
 ].join(', ');
 const el = document.querySelector(selector);
 if (el) {
 el.scrollIntoView({ block: 'center', behavior: 'smooth' });
 if (typeof el.focus === 'function') el.focus();
 focusAppliedRef.current = true;
 }
 }, 80);
 return () => clearTimeout(timer);
 }, [open, initialFocusField]);

 // Refresh the data file from disk every time the sheet opens.
 React.useEffect(() => {
 if (!open || !dataPath) return undefined;
 let cancelled = false;
 (async () => {
 const result = await read(dataPath);
 if (cancelled) return;
 if (!result.ok) {
 setWriteError(result.error || 'failed to read data file');
 return;
 }
 if (result.missing) {
 // No co-located data file — show the create-data-file affordance.
 setFileMissing(true);
 setFileValue({});
 setFileMode('absent');
 setFormValues({});
 setRawText(serializeJson({}));
 return;
 }
 const value = result.value;
 setFileMissing(false);
 setFileValue(value);

 // Recompute the form seed for the currently-active tab.
 const { formValues: tabValues, mode } = variantDataForTab(value, activeVariant, variantNames);
 setFileMode(mode);
 setFormValues(tabValues);
 setRawText(serializeJson(value));
 })();
 return () => { cancelled = true; };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [open, dataPath]);

 // Re-seed rawText on entry switch (raw-JSON fallback path only).
 React.useEffect(() => {
 if (propsSchema) return;
 setRawText(
 serializeJson(assetData && assetData.source !== 'absent' ? assetData.value : {}),
 );
 setParseError(null);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [entry?.id]);

 // ── Tab switching ─────────────────────────────────────────────────────────
 const handleTabChange = React.useCallback(
 (variantName) => {
 setActiveVariant(variantName);
 // Recompute form values for the newly-selected tab from the cached file value.
 const { formValues: tabValues, mode } = variantDataForTab(fileValue, variantName, variantNames);
 setFileMode(mode);
 setFormValues(tabValues);
 },
 [fileValue, variantNames],
 );

 // ── Per-field commit handler (schema-driven form path, multi-variant aware) ─
 const commitField = React.useCallback(
 async (fieldKey, fieldValue) => {
 if (!dataPath) {
 setWriteError('cannot determine data file path');
 return;
 }
 // Update the form view immediately.
 setFormValues((prev) => ({ ...prev, [fieldKey]: fieldValue }));

 let next;
 let didMigrate = false;

 if (isMultiVariant) {
 // Multi-variant path: use applyVariantFieldCommit which handles migration.
 const result = applyVariantFieldCommit(fileValue, {
 currentMode: fileMode,
 variantName: activeVariant,
 migrateFrom: primaryName,
 allVariants: variantNames,
 fieldKey,
 fieldValue,
 });
 next = result.next;
 didMigrate = result.didMigrate;
 } else {
 // Single-variant path: the existing applyFieldCommit logic.
 const primary = primaryVariantData(
 { source: 'json', value: fileValue },
 variantNames,
 );
 next = applyFieldCommit(fileValue, {
 mode: primary.mode,
 primaryName: primary.primaryName,
 fieldKey,
 fieldValue,
 });
 }

 const content = serializeJson(next);
 const result = await write(dataPath, content);
 if (!result.ok) {
 setWriteError(result.error || 'write failed');
 return;
 }
 setWriteError(null);
 setFileValue(next);
 if (didMigrate) {
 setFileMode('keyed');
 }
 flashSaved();
 },
 [dataPath, fileValue, fileMode, activeVariant, primaryName, variantNames, isMultiVariant, write, flashSaved],
 );

 // ── Raw-JSON commit handler (schema-less fallback path) ───────────────────
 const onRawChange = React.useCallback(
 (e) => {
 const text = e.target.value;
 setRawText(text);
 if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
 parseTimerRef.current = setTimeout(async () => {
 if (!dataPath) {
 setParseError('cannot determine data file path');
 return;
 }
 let parsed;
 try {
 parsed = JSON.parse(text);
 } catch (err) {
 setParseError(err instanceof Error ? err.message : String(err));
 return;
 }
 setParseError(null);
 const content = serializeJson(parsed);
 const result = await write(dataPath, content);
 if (!result.ok) {
 setWriteError(result.error || 'write failed');
 return;
 }
 setWriteError(null);
 setFileValue(parsed);
 flashSaved();
 }, 500);
 },
 [dataPath, write, flashSaved],
 );

 // ── Create-data-file handler ──────────────────────────────────────────────
 const handleCreateFile = React.useCallback(async () => {
 if (!dataPath) return;
 setCreating(true);
 setCreateError(null);

 const seed = buildCreateSeed(variantNames, propsSchema);
 const content = serializeJson(seed);
 const result = await write(dataPath, content);
 setCreating(false);

 if (!result.ok) {
 setCreateError(result.error || 'create failed');
 return;
 }

 // Transition to normal form mode over the new file.
 setFileMissing(false);
 setFileValue(seed);
 const mode = isMultiVariant ? 'keyed' : 'shared';
 setFileMode(mode);
 const { formValues: tabValues } = variantDataForTab(seed, activeVariant, variantNames);
 setFormValues(tabValues);
 setRawText(serializeJson(seed));
 flashSaved();
 }, [dataPath, variantNames, propsSchema, write, isMultiVariant, activeVariant, flashSaved]);

 // Cleanup debounce timer on unmount.
 React.useEffect(
 () => () => {
 if (parseTimerRef.current) clearTimeout(parseTimerRef.current);
 },
 [],
 );

 // ── Sheet header decoration ───────────────────────────────────────────────
 const title = `Data · ${entry?.label || asset?.name || 'asset'}`;

 // ── Footer ────────────────────────────────────────────────────────────────
 const footer = (
 <>
 {writeError && (
 <div className="lm-data-editor__error-banner" role="alert" aria-live="polite">
 <span>Write failed: {writeError}</span>
 </div>
 )}
 <span
 className="lm-data-editor__saved"
 data-visible={saved ? '' : undefined}
 aria-live="polite"
 >
 <span className="lm-data-editor__saved-dot" aria-hidden="true" />
 Saved
 </span>
 </>
 );

 // ── Render ────────────────────────────────────────────────────────────────
 return (
 <EditorSheet open={open} onClose={onClose} title={title} dirty={false} footer={footer}>
 <div className="lm-data-editor" data-testid="lm-data-editor">
 {dataPath && (
 <p className="lm-data-editor__path" data-testid="lm-data-editor-path">
 {dataPath}
 </p>
 )}

 {/* Variant tab picker — only for multi-variant assets. */}
 {isMultiVariant && !fileMissing && (
 <VariantTabs
 variants={variantNames}
 activeVariant={activeVariant}
 onChange={handleTabChange}
 />
 )}

 {/* Create-data-file affordance. */}
 {fileMissing ? (
 <CreateDataFileAffordance
 dataPath={dataPath}
 creating={creating}
 createError={createError}
 onActivate={handleCreateFile}
 />
 ) : propsSchema ? (
 <SchemaForm
 propsSchema={propsSchema}
 values={formValues}
 onCommitField={commitField}
 />
 ) : (
 <RawJsonFallback
 value={rawText}
 onChange={onRawChange}
 parseError={parseError}
 />
 )}
 </div>
 </EditorSheet>
 );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

/**
 * Create-data-file affordance (FR28).
 * Shown when no co-located data file exists for the asset.
 *
 * @param {object} props
 * @param {string | null} props.dataPath
 * @param {boolean} props.creating
 * @param {string | null} props.createError
 * @param {() => void} props.onActivate
 * @returns {React.ReactElement}
 */
function CreateDataFileAffordance({ dataPath, creating, createError, onActivate }) {
 return (
 <div className="lm-data-editor__create" data-testid="lm-data-editor-create">
 <p className="lm-data-editor__create-msg">
 No data file exists for this asset yet.
 {dataPath && (
 <>
 {' '}The file will be created at{' '}
 <span className="lm-data-editor__create-path">{dataPath}</span>.
 </>
 )}
 </p>
 <button
 type="button"
 className="lm-data-editor__create-btn"
 disabled={creating}
 onClick={onActivate}
 data-testid="lm-data-editor-create-btn"
 >
 {creating ? 'Creating…' : 'Create data file'}
 </button>
 {createError && (
 <p className="lm-data-editor__create-error" role="alert" aria-live="polite" data-testid="lm-data-editor-create-error">
 Could not create{' '}
 {dataPath && <span className="lm-data-editor__create-path">{dataPath}</span>}
 {': '}{createError}
 </p>
 )}
 </div>
 );
}

/**
 * Render one FormControl per schema field, ordered by the schema's own key
 * order (object literal preserve in modern engines). Each control:
 * - shows its calm inline invalid state when the resolved
 * value fails the schema (FR32)
 * - commits per-field (verb-free model) via the supplied callback
 *
 * @param {object} props
 * @param {Record<string, unknown>} props.propsSchema
 * @param {Record<string, unknown>} props.values
 * @param {(key: string, value: unknown) => void} props.onCommitField
 * @returns {React.ReactElement}
 */
function SchemaForm({ propsSchema, values, onCommitField }) {
 const keys = Object.keys(propsSchema);
 return (
 <>
 {keys.map((key) => {
 const schema = propsSchema[key];
 // `propsSchema` is a Record<string, FieldSchema>. Defensive against a
 // malformed schema fragment — a non-object descriptor falls through
 // FormControl's default branch (treated as text).
 return (
 <div className="lm-data-editor__field" key={key}>
 <FormControl
 fieldKey={key}
 schema={schema && typeof schema === 'object' ? schema : { type: 'string' }}
 value={values[key]}
 onCommit={(v) => onCommitField(key, v)}
 />
 </div>
 );
 })}
 </>
 );
}

/**
 * The raw-JSON-textarea fallback for assets that declare no `propsSchema`.
 * Invalid JSON is flagged inline; the parent owns the debounce + write.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(e: React.ChangeEvent<HTMLTextAreaElement>) => void} props.onChange
 * @param {string | null} props.parseError
 * @returns {React.ReactElement}
 */
function RawJsonFallback({ value, onChange, parseError }) {
 const invalid = !!parseError;
 return (
 <>
 <textarea
 className={
 'lm-data-editor__json' + (invalid ? ' lm-data-editor__json--invalid' : '')
 }
 value={value}
 onChange={onChange}
 spellCheck={false}
 autoCorrect="off"
 autoCapitalize="off"
 aria-invalid={invalid ? 'true' : undefined}
 aria-label="Raw JSON editor"
 data-testid="lm-data-editor-raw-json"
 />
 {invalid && (
 <p className="lm-data-editor__json-error" role="alert" aria-live="polite">
 <span>Invalid JSON: {parseError}</span>
 </p>
 )}
 </>
 );
}

export default DataEditor;
