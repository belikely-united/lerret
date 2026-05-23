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
// The brownfield `DCSection` was single-level. The canvas now supports
// nested groups: every group — however deep — is still emitted as a *direct*
// `DCSection` child of `DesignCanvas` (so focus mode, drag-reorder, and the
// per-section download keep working unchanged), but each section carries a
// `depth` (folder nesting level) and a `kicker` (its parent group's name).
// `DCSection` renders a depth>0 section as a *contained* nested section:
// indented from the canvas edge, drawn with a lighter dashed frame + an accent
// depth rail, and titled with an "in <parent>" eyebrow. A group-inside-a-group
// thus reads as visually contained, with the nesting depth legible.
//
// The sections are emitted in depth-first order, so a group's section appears
// directly below its parent's — the on-canvas order mirrors a folder tree.

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
 const presentation = cfg && cfg.presentation;
 if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
 return null;
 }
 const bg = /** @type {Record<string, unknown>} */ (presentation).background;
 if (bg === undefined || bg === null) return null;
 if (isUsableCssColor(bg)) return /** @type {string} */ (bg);
 // Malformed — warn and fall back to default (no bg override).
 console.warn(
 `[lerret/canvas] Skipping malformed presentation.background at "${folderPath}": ` +
 `"${String(bg)}" is not a usable CSS color string. Falling back to the default surface.`,
 );
 return null;
}

// ───────────────────────────────────────────────────────────────────────────
// Model → section layout
// ───────────────────────────────────────────────────────────────────────────

/**
 * One canvas section, derived from a page or group that directly holds assets.
 *
 * @typedef {object} CanvasSectionDef
 * @property {string} id Stable section id — the container's `LerretPath`.
 * @property {string} title The container's real folder name (page or group).
 * @property {number} depth Folder nesting depth: 0 for a page's own
 * top-level section, 1+ for a group nested that many folders deep.
 * @property {string | null} kicker The immediate parent group's name for a
 * nested section (`depth >= 1`), or `null` for a page-level section.
 * @property {import('@lerret/core').AssetNode[]} assets The container's
 * recognized assets, ordered components-first then markdown documents.
 */

/**
 * Walk one page depth-first and build the flat, depth-ordered list of sections
 * to render — one per page/group that *directly* contains at least one
 * recognized asset.
 *
 * A container with no direct assets contributes no section (an empty frame
 * would be noise), but the walk still recurses into its child groups, so an
 * assets-bearing descendant still appears — indented by its true folder depth.
 * Within a section, component assets are ordered before markdown assets so the
 * fixed-dimension artboards lead and the auto-height document cards trail.
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
 */
 function walk(container, depth, parentName) {
 const assets = (container.assets || []).filter(
 (a) =>
 a.kind === NODE_KIND.ASSET &&
 (a.assetKind === 'component' || a.assetKind === 'markdown'),
 );
 if (assets.length > 0) {
 const ordered = [
 ...assets.filter((a) => a.assetKind === 'component'),
 ...assets.filter((a) => a.assetKind === 'markdown'),
 ];
 sections.push({
 id: container.path,
 title: container.name,
 depth,
 kicker: depth >= 1 ? parentName : null,
 assets: ordered,
 isEmpty: false,
 });
 } else if (depth >= 1 && (container.groups || []).length === 0) {
 // An empty leaf GROUP — surfaced as a soft placeholder section so a
 // just-created group is visible and fillable. (A page with no assets is
 // handled by the page-level empty notice instead.)
 sections.push({
 id: container.path,
 title: container.name,
 depth,
 kicker: depth >= 1 ? parentName : null,
 assets: [],
 isEmpty: true,
 });
 }
 // Recurse into child groups — depth-first, so a group's section is
 // emitted directly after its parent's. The model already sorts `groups`.
 for (const group of container.groups || []) {
 walk(group, depth + 1, container.name);
 }
 }

 walk(page, 0, null);
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
 /** @type {[null | { pagePath: string, sections: ReadonlyArray<{ id: string, title: string, depth: number, kicker: string | null, entries: import('../../runtime/asset-runtime.js').AssetEntry[] }>, cueKeys: Readonly<Record<string, number>> }, React.Dispatch<React.SetStateAction<any>>]} */
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
 isEmpty: !!def.isEmpty,
 entries: def.isEmpty
 ? []
 : (await Promise.all(def.assets.map((a) => runtime.loadAsset(a)))).flat(),
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
 ? 'This page has no assets yet.'
 : 'This page has no assets yet. Drop a .jsx, .tsx, or .md file into it.'
 }
 actions={
 cliMode ? (
 <>
 <NoticeButton
 label="+ Add asset"
 primary
 onClick={() =>
 setCreateState({
 kind: 'asset',
 parentPath: page.path,
 parentLabel: page.name,
 existingNames: pageChildNames,
 })
 }
 />
 <NoticeButton
 label="+ Add group"
 onClick={() =>
 setCreateState({
 kind: 'group',
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

 // `key={page.path}` remounts the canvas per page so the brownfield
 // `DesignCanvas`'s per-section state (order/labels) is scoped to a page
 // and a page switch starts each page from a clean canvas state.
 //
 // Important for : live re-renders (entry replacements within
 // a section) do NOT change the canvas key — only the affected entries'
 // identities change. The `DesignCanvas` instance, its per-section
 // state, and the user's viewport zoom + scroll position are preserved.
 return (
 <>
 <DesignCanvas key={page.path}>
 {sections.map((s) => {
 // look up the effective config for this section's folder
 // and resolve the presentation.background color. A malformed value
 // falls back to null (no bg override) with a console.warn.
 const effectiveCfg = getConfigFor(s.id);
 const bgColor = resolveSectionBg(effectiveCfg, s.id);
 const sectionStyle = bgColor
 ? { backgroundColor: bgColor }
 : undefined;

 // wrap each section in `SectionKebab` so the kebab trigger
 // hangs above the section header. The kebab owns Edit config / Rename /
 // Delete / Export / Reveal items and the ConfigEditor sheet that
 // "Edit config" toggles.
 //
 // pass `project` (for collectArtboards) and `sectionKind`
 // (page vs group) so the kebab's bulk-export action scopes correctly.
 const sectionKind = page && page.path === s.id ? 'page' : 'group';
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
 subtitle={
 s.isEmpty
 ? 'empty group'
 : `${s.entries.length} asset${s.entries.length === 1 ? '' : 's'}`
 }
 sectionStyle={sectionStyle}
 >
 {s.isEmpty ? (
 <EmptyGroupPlaceholder
 cliMode={cliMode}
 onAddAsset={() =>
 setCreateState({
 kind: 'asset',
 parentPath: s.id,
 parentLabel: s.title,
 existingNames: [],
 })
 }
 />
 ) : (
 s.entries.map((entry) => artboardForEntry(entry, { cueKey: cueKeys[entry.id], getConfigFor }))
 )}
 </DCSection>
 </SectionKebab>
 );
 })}
 </DesignCanvas>
 {createDialog}
 </>
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
 * The body rendered inside an empty leaf-group section — a soft dashed frame
 * with an inline "Add asset" CTA (CLI mode) so a just-created group is an
 * inviting next step rather than a dead end. In standalone mode the CTA is
 * replaced by a calm hint (writes are CLI-only).
 *
 * @param {object} props
 * @param {() => void} props.onAddAsset
 * @param {boolean} props.cliMode
 * @returns {React.ReactElement}
 */
function EmptyGroupPlaceholder({ onAddAsset, cliMode }) {
 return (
 <div
 className="dc-section-cta"
 data-testid="lm-empty-group-placeholder"
 style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 justifyContent: 'center',
 gap: 10,
 minWidth: 320,
 minHeight: 150,
 padding: 32,
 border: '1.5px dashed var(--lm-border, rgba(26,23,20,0.22))',
 borderRadius: 12,
 background: 'rgba(0,0,0,0.015)',
 color: 'var(--lm-text-tertiary, #6e6960)',
 textAlign: 'center',
 }}
 >
 <div style={{ fontSize: 13 }}>This group is empty.</div>
 {cliMode ? (
 <button
 type="button"
 onClick={onAddAsset}
 data-testid="lm-empty-group-add"
 style={{
 padding: '8px 14px',
 borderRadius: 8,
 border: 'none',
 background: 'var(--lm-accent, #B85B33)',
 color: '#fff',
 fontFamily: 'inherit',
 fontSize: 12,
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 + Add asset
 </button>
 ) : (
 <div style={{ fontSize: 11 }}>Add a .jsx, .tsx, or .md file into it.</div>
 )}
 </div>
 );
}

export default ProjectCanvas;
