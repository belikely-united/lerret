// project-canvas.jsx — renders one page of a Lerret project model on the
// brownfield `DesignCanvas` and runs the live-edit loop
//.
//
// This is the real studio canvas component the dev-harness used to inline.
// Given the project model + an `AssetRuntime`, it:
// 1. Picks the current page (by path) from `project.pages`.
// 2. Walks that page depth-first, building a flat, depth-ordered list of
// sections — one section per page/group that *directly* contains assets.
// 3. Loads every asset of those sections through the runtime (component
// AND markdown — the runtime yields the right entry kind for each).
// 4. Renders the loaded entries on `DesignCanvas` as `DCSection`s of
// artboards / Markdown cards.
// 5. Subscribes to the runtime's change signal. When a file save fires
// `subscribe`-d listeners with the changed `LerretPath`, the canvas
// finds every entry whose underlying asset matches, re-loads ONLY
// those entries through the runtime, and swaps them into place — the
// prior render is held until the new one is ready (no blank flash),
// the viewport zoom and scroll position are preserved, and the
// affected artboards each flash a quiet re-render cue (UX-DR17).
// Structural add/remove/rename of files/folders arrive as a new
// `project` prop (the loader's `applyWatchEvent` patches the model
// upstream); the canvas just re-runs its section computation.
//
// ── Page & group → canvas mapping (FR3, FR14) ──────────────────────────────
// The canvas mirrors the folder tree. The *current page*'s content is shown,
// organized by group: each group is a framed `DCSection` carrying its real
// folder name; each asset renders as a `DCArtboard` (component) or a Markdown
// card within its group's section. Assets directly in the page render in the
// page's own top-level section; assets in a group render inside that group's
// section.
//
// ── Nested groups (FR3 visual mapping) ─────────────────────────────────────
// The brownfield `DCSection` was single-level. The canvas now supports nested
// groups with *true containment*: a sub-group (a group inside a group) renders
// INSIDE its parent group's frame — exactly like an asset renders inside its
// group — so the folder hierarchy is spatial, not merely indented.
//
// `collectPageSections` still returns a flat, depth-first list (each section
// carries its `depth`, its `parentPath`, and a `kicker` = its parent's name).
// At render time `ProjectCanvas` rebuilds the parent→child tree from that flat
// list and renders it recursively: the page's own section (depth 0) and each
// top-level group (depth 1) are separate cards on the canvas; every deeper
// sub-group (depth >= 2) is rendered as a child *inside* its parent's frame —
// a dashed, progressively warmer, depth-railed card with an "in <parent>"
// eyebrow. `DesignCanvas`'s focus/reorder registry walks the tree recursively,
// so focus mode, drag-reorder, and per-section download work at every depth.

import React from 'react';

import { NODE_KIND } from '@lerret/core';

import { DesignCanvas, DCSection } from '../../design-canvas.jsx';
import { artboardForEntry } from './asset-artboard.jsx';
import { useCascadedConfig } from './cascade-context.jsx';
import { useLiveRefresh } from './live-refresh-manager.js';
// per-section kebab menu (Edit config / Rename / Delete / Export /
// Reveal …). Replaces the temporary `SectionWithConfigTrigger` .
import { SectionKebab } from './section-kebab.jsx';
// in-canvas creation — the empty-page CTAs and empty-group placeholders open
// the shared CreateEntryDialog; `create` performs the write.
import { CreateEntryDialog, create, inCliMode } from '../menu/index.js';

// ───────────────────────────────────────────────────────────────────────────
// Presentation config helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Validate that `value` is a usable CSS color string. Returns `true` if the
 * value is a non-empty string that the browser accepts as a color. Uses a
 * temporary DOM element to test against the browser's CSS parser — this is
 * the most reliable approach (covers named colors, hex, rgb/rgba, hsl, lch,
 * oklch, `currentColor`, CSS variables, etc.) without maintaining a regex.
 *
 * In environments without a DOM (tests, SSR) we fall back to a conservative
 * heuristic: any non-empty string that does not contain obvious structural
 * noise (`{`, `}`, `;`, `:`) is accepted. This keeps tests straightforward
 * without pulling in a CSS parser.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isUsableCssColor(value) {
 if (typeof value !== 'string' || value.trim() === '') return false;
 // DOM path (browser environment).
 if (typeof document !== 'undefined') {
 const el = document.createElement('div');
 el.style.color = value;
 return el.style.color !== '';
 }
 // Non-DOM fallback (test environments).
 return !/[{};]/.test(value);
}

/**
 * Resolve the effective background color for a section from the cascaded
 * config, validating the value.
 *
 * If the config has no `presentation.background`, returns `null` (no bg).
 * If the value is malformed (not a usable CSS color), returns `null` and
 * emits a `console.warn` with the folder path so the developer can fix it.
 *
 * @param {Record<string, unknown>} cfg The folder's effective config object.
 * @param {string} folderPath The folder's `LerretPath` — used in the warning.
 * @returns {string | null}
 */
function resolveSectionBg(cfg, folderPath) {
 return resolvePresentationColor(cfg, folderPath, 'background');
}

/**
 * Resolve the effective foreground/text color for a section from the cascaded
 * config's `presentation.color`. Mirrors {@link resolveSectionBg}: returns the
 * validated CSS color, or `null` (no override) — warning on a malformed value.
 *
 * @param {Record<string, unknown>} cfg The folder's effective config object.
 * @param {string} folderPath The folder's `LerretPath` — used in the warning.
 * @returns {string | null}
 */
function resolveSectionColor(cfg, folderPath) {
 return resolvePresentationColor(cfg, folderPath, 'color');
}

/**
 * Shared resolver for a `presentation.<key>` CSS color value. Returns the
 * validated color string, or `null` when absent. A present-but-malformed value
 * returns `null` and emits a `console.warn` naming the folder path + key.
 *
 * @param {Record<string, unknown>} cfg The folder's effective config object.
 * @param {string} folderPath The folder's `LerretPath` — used in the warning.
 * @param {'background' | 'color'} key
 * @returns {string | null}
 */
function resolvePresentationColor(cfg, folderPath, key) {
 const presentation = cfg && cfg.presentation;
 if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
 return null;
 }
 const value = /** @type {Record<string, unknown>} */ (presentation)[key];
 if (value === undefined || value === null) return null;
 if (isUsableCssColor(value)) return /** @type {string} */ (value);
 // Malformed — warn and fall back to default (no override).
 console.warn(
 `[lerret/canvas] Skipping malformed presentation.${key} at "${folderPath}": ` +
 `"${String(value)}" is not a usable CSS color string. Falling back to the default.`,
 );
 return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Model → section layout
// ───────────────────────────────────────────────────────────────────────────

/**
 * One canvas section, derived from a page or group.
 *
 * @typedef {object} CanvasSectionDef
 * @property {string} id Stable section id — the container's `LerretPath`.
 * @property {string} title The container's real folder name (page or group).
 * @property {number} depth Folder nesting depth: 0 for a page's own
 * top-level section, 1+ for a group nested that many folders deep.
 * @property {string | null} kicker The immediate parent's name for a nested
 * section (`depth >= 1`), or `null` for a page-level section. (It is rendered
 * as the "in <parent>" eyebrow only for a contained sub-group, `depth >= 2`.)
 * @property {string | null} parentPath The parent container's `LerretPath`
 * (`depth >= 1`), or `null` for a page-level section — used to rebuild the
 * parent→child tree so a sub-group nests inside its parent's frame.
 * @property {boolean} isEmpty Whether the container holds neither a recognized
 * asset nor a child group — a truly-empty group placeholder.
 * @property {import('@lerret/core').AssetNode[]} assets The container's
 * recognized assets, ordered components-first then markdown documents.
 */

/**
 * Walk one page depth-first and build the flat, depth-ordered list of sections.
 *
 * The page (depth 0) contributes a section only when it *directly* holds assets
 * — otherwise it is no card and its groups become the top-level cards (an
 * asset-less, group-less page is handled by the empty-page notice). EVERY group
 * (depth >= 1) contributes a section, always — including an intermediate group
 * that holds only sub-groups — so every sub-group has a parent card to nest
 * into when `ProjectCanvas` rebuilds the tree. Within a section, component
 * assets are ordered before markdown assets so the fixed-dimension artboards
 * lead and the auto-height document cards trail.
 *
 * @param {import('@lerret/core').PageNode} page The page to lay out.
 * @returns {CanvasSectionDef[]} Depth-first ordered sections.
 */
export function collectPageSections(page) {
 /** @type {CanvasSectionDef[]} */
 const sections = [];

 /**
 * @param {import('@lerret/core').PageNode | import('@lerret/core').GroupNode} container
 * @param {number} depth
 * @param {string | null} parentName
 * @param {string | null} parentPath
 */
 function walk(container, depth, parentName, parentPath) {
 const childGroups = container.groups || [];
 const assets = (container.assets || []).filter(
 (a) =>
 a.kind === NODE_KIND.ASSET &&
 (a.assetKind === 'component' || a.assetKind === 'markdown'),
 );
 const ordered = [
 ...assets.filter((a) => a.assetKind === 'component'),
 ...assets.filter((a) => a.assetKind === 'markdown'),
 ];
 // Emit for the page only when it directly holds assets; emit for EVERY
 // group regardless, so a deep sub-group always has a parent card to nest
 // into and an empty group still shows a fillable placeholder card.
 if (depth >= 1 || ordered.length > 0) {
 sections.push({
 id: container.path,
 title: container.name,
 depth,
 kicker: depth >= 1 ? parentName : null,
 parentPath: depth >= 1 ? parentPath : null,
 assets: ordered,
 isEmpty: ordered.length === 0 && childGroups.length === 0,
 });
 }
 // Recurse into child groups — depth-first, so a group's section is
 // emitted directly after its parent's. The model already sorts `groups`.
 for (const group of childGroups) {
 walk(group, depth + 1, container.name, container.path);
 }
 }

 walk(page, 0, null, null);
 return sections;
}

/**
 * Resolve which page of the project to render.
 *
 * The studio routes pages by a hash that holds the page's `LerretPath`; this
 * picks the matching page, falling back to the first page when the id is
 * absent or unknown (e.g. a stale hash). Returns `null` only for a project
 * with zero pages.
 *
 * @param {import('@lerret/core').ProjectNode} project The scanned project.
 * @param {string} [pageId] The desired page's `LerretPath`.
 * @returns {import('@lerret/core').PageNode | null}
 */
export function resolvePage(project, pageId) {
 const pages = (project && project.pages) || [];
 if (pages.length === 0) return null;
 if (pageId) {
 const match = pages.find((p) => p.path === pageId);
 if (match) return match;
 }
 return pages[0];
}

// ───────────────────────────────────────────────────────────────────────────
// ProjectCanvas — one page, rendered through the runtime
// ───────────────────────────────────────────────────────────────────────────

/**
 * Render one page of a Lerret project on the brownfield `DesignCanvas`.
 *
 * Asset loading is async (the runtime resolves each asset's React component),
 * so this holds a loading state until every `runtime.loadAsset` call for the
 * current page resolves, then renders the resulting entries as canvas
 * sections. Switching `pageId` re-runs the load for the new page — instant,
 * no full-page reload (a acceptance criterion).
 *
 * addition: reads each section's effective config from the cascade
 * context (`useCascadedConfig`) and applies the `presentation.background`
 * color to each section surface. Malformed bg values fall back to the default
 * with a `console.warn` naming the folder path (FR18).
 *
 * @param {object} props
 * @param {import('@lerret/core').ProjectNode} props.project
 * The scanned project model (all pages, groups, assets).
 * @param {import('../../runtime/asset-runtime.js').AssetRuntime} props.runtime
 * The asset runtime — turns each asset node into renderable entries.
 * @param {string} [props.pageId]
 * `LerretPath` of the page to show; falls back to the first page.
 * @returns {React.ReactElement}
 */
export function ProjectCanvas({ project, runtime, pageId }) {
 // the cascade context delivers the effective config for each
 // folder path. `getConfigFor` is a stable function reference (memoized in
 // CascadedConfigProvider) so it is safe to call in render without effects.
 const getConfigFor = useCascadedConfig();
 // The loaded result, tagged with the page path it is for: `{ pagePath,
 // sections }`. Tagging (rather than resetting to `null` on every page
 // switch) lets the render derive "still loading" by comparing the tag to
 // the current page — so the effect only ever calls `setState` once, when
 // its async load finishes.
 /** @type {[null | { pagePath: string, sections: ReadonlyArray<{ id: string, title: string, depth: number, kicker: string | null, parentPath: string | null, isEmpty: boolean, entries: import('../../runtime/asset-runtime.js').AssetEntry[] }>, cueKeys: Readonly<Record<string, number>> }, React.Dispatch<React.SetStateAction<any>>]} */
 const [loaded, setLoaded] = React.useState(null);

 // In-canvas creation. `createState` is `{ kind, parentPath, parentLabel,
 // existingNames }` while the shared CreateEntryDialog is open (opened by the
 // empty-page CTAs and the empty-group placeholders); null when closed.
 const [createState, setCreateState] = React.useState(null);

 const page = React.useMemo(() => resolvePage(project, pageId), [project, pageId]);

 // start (and reconcile) per-asset refresh timers for assets
 // whose folder config includes a `liveRefresh` block. Timers call
 // `runtime.notifyChange(assetPath)` on each tick, which re-renders only the
 // affected artboard via the existing live-edit loop.
 useLiveRefresh(page, getConfigFor, runtime);

 // The cue key for an entry: a fresh integer per live re-load, surfaced to
 // each artboard so the re-render cue flashes once per refresh and only
 // once. Initial mounts pass `undefined` (the very first paint never
 // flashes — that would be canvas chrome, not a confirmation).
 /** @type {React.MutableRefObject<Map<string, number>>} */
 const cueKeysRef = React.useRef(new Map());

 React.useEffect(() => {
 if (!page) return undefined;
 let cancelled = false;
 (async () => {
 const defs = collectPageSections(page);
 const sections = await Promise.all(
 defs.map(async (def) => ({
 id: def.id,
 title: def.title,
 depth: def.depth,
 kicker: def.kicker,
 parentPath: def.parentPath,
 isEmpty: !!def.isEmpty,
 entries: (
 await Promise.all((def.assets || []).map((a) => runtime.loadAsset(a)))
 ).flat(),
 })),
 );
 if (cancelled) return;
 // A fresh page load — drop any stale cue keys, then commit.
 cueKeysRef.current = new Map();
 setLoaded({ pagePath: page.path, sections, cueKeys: {} });
 })();
 return () => {
 cancelled = true;
 };
 // `page` identity changes when the resolved page changes (page switch);
 // `runtime` identity changes when the project switches. Re-loading on
 // either is correct. A *new* `project` reference whose pages still
 // contain the same `page.path` keeps `page` identity stable (memoized
 // off the same path) — so a loader-patched structural add/remove that
 // didn't touch this page does NOT trigger a full reload.
 }, [page, runtime]);

 // ───────────────────────────────────────────────────────────────────────
 // Live-edit loop — subscribe to the runtime and reload the
 // affected entries in place.
 // ───────────────────────────────────────────────────────────────────────
 React.useEffect(() => {
 if (!runtime || typeof runtime.subscribe !== 'function') return undefined;
 const unsubscribe = runtime.subscribe((changedPath) => {
 // Find every entry whose source asset path matches the changed path.
 // One file may yield multiple variant entries, so this is
 // a fan-out per signal, not a single-entry replace. We capture the
 // affected entries up front, then reload them in parallel.
 setLoaded((prev) => {
 if (!prev) return prev;
 const affected = [];
 for (const section of prev.sections) {
 for (const entry of section.entries) {
 // The runtime emits asset-level paths; an entry's `asset.path`
 // is the asset file. Match exactly.
 if (entry.asset && entry.asset.path === changedPath) {
 affected.push({ section, entry });
 }
 }
 }
 if (affected.length === 0) {
 // The change is for an asset not on the current page (or a
 // resource the runtime doesn't track). The model patcher
 // upstream may still re-render the canvas via a new `project`
 // prop; this signal alone is silent.
 return prev;
 }

 // Kick off the reload. We mutate `prev` only after the async load
 // resolves — until then the prior render is held in place (no
 // blank flash, NFR2 + UX spec "prior render holds until new is
 // ready"). The reload bypasses Vite's module cache because
 // `notifyChange` bumped the asset's reload token already.
 (async () => {
 // For each affected asset, ask the runtime for its current
 // entries (its 1..N variants) and replace EVERY entry whose
 // `asset.path` matches with the freshly-loaded ones — so a
 // variant that was added / removed since the last load also
 // reflects.
 const reloadedBySection = new Map();
 await Promise.all(
 affected.map(async ({ section, entry }) => {
 const fresh = await runtime.loadAsset(entry.asset);
 const byAsset = reloadedBySection.get(section.id) || new Map();
 byAsset.set(entry.asset.path, fresh);
 reloadedBySection.set(section.id, byAsset);
 }),
 );

 // Build the next sections, swapping every matching entry. A new
 // cue key per affected entry id triggers the re-render cue.
 setLoaded((current) => {
 if (!current) return current;
 const nextCueKeys = { ...current.cueKeys };
 const counter = nextCueKey(cueKeysRef.current);
 const nextSections = current.sections.map((section) => {
 const byAsset = reloadedBySection.get(section.id);
 if (!byAsset) return section;
 // Rebuild this section's entries: every entry whose asset
 // matches the changed path is replaced by the fresh load
 // for that asset, splicing the new variant array into the
 // entry's slot. Other entries pass through untouched, so
 // surrounding artboards keep their identity and React
 // state (per-artboard UI, the DCSection labels/order).
 const nextEntries = [];
 const inserted = new Set();
 for (const entry of section.entries) {
 if (entry.asset && byAsset.has(entry.asset.path)) {
 if (inserted.has(entry.asset.path)) continue;
 inserted.add(entry.asset.path);
 for (const fresh of byAsset.get(entry.asset.path)) {
 nextEntries.push(fresh);
 // Bump the cue key per fresh entry — every artboard
 // produced from the reload flashes.
 nextCueKeys[fresh.id] = counter;
 }
 } else {
 nextEntries.push(entry);
 }
 }
 return { ...section, entries: nextEntries };
 });
 return { ...current, sections: nextSections, cueKeys: nextCueKeys };
 });
 })();

 return prev; // synchronous return — hold the prior render
 });
 });
 return unsubscribe;
 }, [runtime]);

 // Create-dialog confirm + element, shared by the empty-state CTAs and the
 // empty-group placeholders. Defined after all hooks, before the first early
 // return, so every branch can include the dialog.
 const onConfirmCreate = async ({ name, assetKind }) => {
 if (!createState) return;
 const endpointKind = createState.kind === 'asset' ? 'asset' : 'folder';
 const result = await create(createState.parentPath, name, endpointKind, { assetKind });
 if (!result?.ok) throw new Error(result?.error || 'Create failed');
 };
 const createDialog = createState ? (
 <CreateEntryDialog
 kind={createState.kind}
 parentLabel={createState.parentLabel}
 existingNames={createState.existingNames}
 onConfirm={onConfirmCreate}
 onClose={() => setCreateState(null)}
 />
 ) : null;
 const cliMode = inCliMode();

 if (!page) {
 return (
 <>
 <ProjectCanvasNotice
 title="No pages"
 body="This project has no pages yet."
 actions={
 cliMode ? (
 <NoticeButton
 label="+ New page"
 primary
 onClick={() =>
 setCreateState({
 kind: 'page',
 parentPath: project.path,
 parentLabel: null,
 existingNames: (project.pages || []).map((p) => p.name),
 })
 }
 />
 ) : null
 }
 />
 {createDialog}
 </>
 );
 }
 // The loaded result is for the current page only when its tag matches —
 // otherwise a page switch is in flight and we are still loading.
 const sections = loaded && loaded.pagePath === page.path ? loaded.sections : null;
 if (sections === null) {
 return (
 <>
 <ProjectCanvasNotice title={null} body={`Loading ${page.name}…`} />
 {createDialog}
 </>
 );
 }
 if (sections.length === 0) {
 const pageChildNames = [
 ...(page.groups || []).map((g) => g.name),
 ...(page.assets || []).map((a) => a.fileName),
 ];
 return (
 <>
 <ProjectCanvasNotice
 title={page.name}
 body={
 cliMode
 ? 'This page is empty. Create a group to organize your assets — or drop in a loose asset.'
 : 'This page has no assets yet. Drop a .jsx, .tsx, or .md file into it.'
 }
 actions={
 cliMode ? (
 <>
 <NoticeButton
 label="+ New group"
 primary
 onClick={() =>
 setCreateState({
 kind: 'group',
 parentPath: page.path,
 parentLabel: page.name,
 existingNames: pageChildNames,
 })
 }
 />
 <NoticeButton
 label="+ Add asset"
 onClick={() =>
 setCreateState({
 kind: 'asset',
 parentPath: page.path,
 parentLabel: page.name,
 existingNames: pageChildNames,
 })
 }
 />
 </>
 ) : null
 }
 />
 {createDialog}
 </>
 );
 }
 const cueKeys = (loaded && loaded.cueKeys) || {};

 // Rebuild the parent→child tree from the flat, depth-first `sections` so a
 // sub-group (depth >= 2) renders nested INSIDE its parent group's frame —
 // true containment, like an asset inside a group. The page's own section
 // (depth 0) and each top-level group (depth 1) stay as separate cards on the
 // canvas; everything deeper attaches to its parent (matched by `parentPath`).
 const nodeById = new Map();
 for (const s of sections) nodeById.set(s.id, { section: s, children: [] });
 const roots = [];
 for (const s of sections) {
 const node = nodeById.get(s.id);
 const parent = s.depth >= 2 && s.parentPath ? nodeById.get(s.parentPath) : null;
 if (parent) parent.children.push(node);
 else roots.push(node);
 }

 // Render one section and, recursively, its nested sub-groups. A section's
 // artboards lead, then its sub-group cards, then the in-canvas add bar — so
 // "add into this group" always sits at the bottom of the group it targets.
 const renderSection = (node) => {
 const s = node.section;
 // look up the effective config for this section's folder and resolve the
 // presentation.background color. A malformed value falls back to null (no
 // bg override) with a console.warn.
 const effectiveCfg = getConfigFor(s.id);
 const bgColor = resolveSectionBg(effectiveCfg, s.id);
 const fgColor = resolveSectionColor(effectiveCfg, s.id);
 const sectionStyle =
 bgColor || fgColor
 ? {
 ...(bgColor ? { backgroundColor: bgColor } : null),
 ...(fgColor ? { color: fgColor } : null),
 }
 : undefined;

 // wrap each section in `SectionKebab` so the kebab trigger hangs above the
 // section header. The kebab owns Edit config / Rename / Delete / Export /
 // Reveal items and the ConfigEditor sheet. `project` (for collectArtboards)
 // and `sectionKind` (page vs group) scope its bulk-export action correctly.
 const sectionKind = page && page.path === s.id ? 'page' : 'group';

 // Subtitle reflects what the card actually shows: its own assets and the
 // sub-groups nested inside it. A card with neither reads as "empty group".
 const assetCount = s.entries.length;
 const groupCount = node.children.length;
 const parts = [];
 if (assetCount) parts.push(`${assetCount} asset${assetCount === 1 ? '' : 's'}`);
 if (groupCount) parts.push(`${groupCount} group${groupCount === 1 ? '' : 's'}`);
 const subtitle = parts.length > 0 ? parts.join(' · ') : 'empty group';
 const isEmpty = assetCount === 0 && groupCount === 0;
 const existingNames = sectionChildNames(project, s.id);

 return (
 <SectionKebab
 key={s.id}
 sectionId={s.id}
 sectionTitle={s.title}
 sectionKind={sectionKind}
 project={project}
 >
 <DCSection
 id={s.id}
 title={s.title}
 depth={s.depth}
 kicker={s.kicker}
 subtitle={subtitle}
 sectionStyle={sectionStyle}
 >
 {s.entries.map((entry) =>
 artboardForEntry(entry, { cueKey: cueKeys[entry.id], getConfigFor }),
 )}
 {/* Nested sub-groups render INSIDE this frame — true containment. */}
 {node.children.map((child) => renderSection(child))}
 {/* In-canvas "add into THIS group" control — the spatially-explicit
 way to create a group/asset inside a specific container. Also serves
 as the empty-group affordance. */}
 <SectionAddBar
 isEmpty={isEmpty}
 cliMode={cliMode}
 onAddAsset={() =>
 setCreateState({
 kind: 'asset',
 parentPath: s.id,
 parentLabel: s.title,
 existingNames,
 })
 }
 onAddGroup={() =>
 setCreateState({
 kind: 'group',
 parentPath: s.id,
 parentLabel: s.title,
 existingNames,
 })
 }
 />
 </DCSection>
 </SectionKebab>
 );
 };

 // `key={page.path}` remounts the canvas per page so the brownfield
 // `DesignCanvas`'s per-section state (order/labels) is scoped to a page and a
 // page switch starts each page from a clean canvas state.
 //
 // Important for live edits: entry replacements within a section do NOT change
 // the canvas key — only the affected entries' identities change. The
 // `DesignCanvas` instance, its per-section state, and the user's viewport zoom
 // + scroll position are preserved.
 // The page-level "+ New group" affordance is a non-section child, so the
 // canvas keeps it after the (reorderable) group cards. It creates a top-level
 // group on this page; new groups append, and can then be dragged into place.
 const pageChildNamesForAdd = sectionChildNames(project, page.path);
 return (
 <>
 <DesignCanvas key={page.path} orderKey={page.path}>
 {roots.map((node) => renderSection(node))}
 {cliMode && (
 <PageAddBar
 onAddGroup={() =>
 setCreateState({
 kind: 'group',
 parentPath: page.path,
 parentLabel: page.name,
 existingNames: pageChildNamesForAdd,
 })
 }
 onAddAsset={() =>
 setCreateState({
 kind: 'asset',
 parentPath: page.path,
 parentLabel: page.name,
 existingNames: pageChildNamesForAdd,
 })
 }
 />
 )}
 </DesignCanvas>
 {createDialog}
 </>
 );
}

/**
 * Page-level create affordance, rendered after the group cards on the canvas:
 * a prominent dashed "+ New group" (plus a quieter "+ Add asset" for a loose
 * page asset). This is how a top-level group is added to a non-empty page —
 * the spatial counterpart to the per-group add bar. Marked `.dc-section-cta`
 * so the canvas pan handler treats it as interactive content, not background.
 *
 * @param {object} props
 * @param {() => void} props.onAddGroup
 * @param {() => void} props.onAddAsset
 * @returns {React.ReactElement}
 */
function PageAddBar({ onAddGroup, onAddAsset }) {
 return (
 <div
 className="dc-section-cta"
 data-testid="page-add-bar"
 style={{ margin: '0 60px 90px 60px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
 >
 <button
 type="button"
 onClick={onAddGroup}
 data-testid="page-add-group"
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 7,
 padding: '12px 20px',
 borderRadius: 12,
 border: '1.5px dashed var(--lm-accent-border, rgba(184,91,51,0.35))',
 background: 'var(--lm-accent-light, rgba(184,91,51,0.06))',
 color: 'var(--lm-accent, #B85B33)',
 fontFamily: 'inherit',
 fontSize: 14,
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 <span style={{ fontSize: 17, lineHeight: 1 }}>+</span> New group
 </button>
 <button
 type="button"
 onClick={onAddAsset}
 data-testid="page-add-asset"
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 6,
 padding: '12px 16px',
 borderRadius: 12,
 border: '1px dashed var(--lm-border, rgba(26,23,20,0.22))',
 background: 'transparent',
 color: 'var(--lm-text-tertiary, #6e6960)',
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 + Add asset
 </button>
 </div>
 );
}

/**
 * Increment-and-return the shared cue counter held in a ref. The counter
 * lives outside React state (a `Map<entryId, number>` is mutated by
 * reference) because a cue-key bump must happen synchronously inside the
 * reload-completion `setLoaded` updater. The map's only consumer is the
 * value stored in `loaded.cueKeys`, which React diffs by identity.
 *
 * @param {Map<string, number>} bag
 * @returns {number}
 */
function nextCueKey(bag) {
 let max = 0;
 for (const v of bag.values()) {
 if (typeof v === 'number' && v > max) max = v;
 }
 const next = max + 1;
 // Store a placeholder so re-entrant calls within the same task still see
 // the counter advance.
 bag.set('__last__', next);
 return next;
}

/**
 * A calm full-canvas notice — loading / empty-page / no-pages states. Mirrors
 * the studio's warm-paper aesthetic (the brownfield `StudioComingSoon` look).
 *
 * @param {object} props
 * @param {string | null} props.title
 * @param {string} props.body
 * @param {React.ReactNode} [props.actions]
 *   Optional CTA buttons rendered below the body (e.g. "+ Add asset").
 * @returns {React.ReactElement}
 */
function ProjectCanvasNotice({ title, body, actions }) {
 return (
 <div
 style={{
 width: '100vw',
 height: '100vh',
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 justifyContent: 'center',
 gap: 12,
 background: 'var(--lm-bg-tertiary, #f0eee9)',
 fontFamily: 'var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)',
 color: 'var(--lm-text-secondary, #3a3530)',
 textAlign: 'center',
 padding: 24,
 boxSizing: 'border-box',
 }}
 >
 {title && (
 <div style={{ fontSize: 32, fontWeight: 600, letterSpacing: -0.6, color: 'var(--lm-text-primary, #1a1714)' }}>
 {title}
 </div>
 )}
 <div style={{ fontSize: 14, color: 'var(--lm-text-tertiary, #6e6960)', maxWidth: '44ch', lineHeight: 1.5 }}>
 {body}
 </div>
 {actions ? (
 <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
 {actions}
 </div>
 ) : null}
 </div>
 );
}

/**
 * A small CTA button used in the canvas empty-state notices. `primary` paints
 * it in the accent color; otherwise it's a quiet outline button.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {() => void} props.onClick
 * @param {boolean} [props.primary]
 * @returns {React.ReactElement}
 */
function NoticeButton({ label, onClick, primary }) {
 return (
 <button
 type="button"
 onClick={onClick}
 data-testid="lm-notice-button"
 style={{
 padding: '8px 16px',
 borderRadius: 8,
 border: primary ? 'none' : '1px solid var(--lm-border, rgba(26,23,20,0.18))',
 background: primary ? 'var(--lm-accent, #B85B33)' : 'transparent',
 color: primary ? '#fff' : 'var(--lm-text-primary, #1a1714)',
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 {label}
 </button>
 );
}

/**
 * Per-section in-canvas add control: "+ Asset" / "+ Group", which create INTO
 * this section (page or group). Rendered below each section's frame so the
 * creation target is wherever you click — the spatially-explicit way to add a
 * group inside a particular group, no kebab-hunting. Doubles as the empty-group
 * affordance.
 *
 * Marked `.dc-section-cta` so the canvas pan handler treats it as interactive
 * content (not background) — otherwise drag-pan capture would swallow the click.
 *
 * @param {object} props
 * @param {boolean} props.isEmpty   Whether the owning section has no assets.
 * @param {boolean} props.cliMode   Creation writes to disk → CLI-only.
 * @param {() => void} props.onAddAsset
 * @param {() => void} props.onAddGroup
 * @returns {React.ReactElement | null}
 */
function SectionAddBar({ isEmpty, cliMode, onAddAsset, onAddGroup }) {
 // Creation writes to disk → CLI-only. In standalone mode show a calm hint for
 // an empty group; otherwise render nothing.
 if (!cliMode) {
 return isEmpty ? (
 <div
 className="dc-section-cta"
 style={{ marginTop: 10, fontSize: 12, color: 'var(--lm-text-tertiary, #6e6960)' }}
 >
 Add a .jsx, .tsx, or .md file into this group.
 </div>
 ) : null;
 }
 const btnStyle = {
 display: 'inline-flex',
 alignItems: 'center',
 gap: 5,
 padding: '6px 12px',
 borderRadius: 8,
 border: '1px dashed var(--lm-border, rgba(26,23,20,0.28))',
 background: 'transparent',
 color: 'var(--lm-text-secondary, #6e6960)',
 fontFamily: 'inherit',
 fontSize: 12,
 fontWeight: 600,
 cursor: 'pointer',
 };
 return (
 <div
 className="dc-section-cta"
 data-testid="section-add-bar"
 style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
 >
 <button type="button" onClick={onAddAsset} data-testid="section-add-asset" style={btnStyle}>
 + Asset
 </button>
 <button type="button" onClick={onAddGroup} data-testid="section-add-group" style={btnStyle}>
 + Group
 </button>
 </div>
 );
}

/**
 * Child names (sub-folder names + asset file names) of the section at `path`,
 * for the create dialog's instant case-insensitive collision pre-check. The
 * server remains authoritative.
 *
 * @param {object | null | undefined} project
 * @param {string} path
 * @returns {string[]}
 */
function sectionChildNames(project, path) {
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

export default ProjectCanvas;
