// project-studio.jsx — the studio composition root for a loaded Lerret
// project.
//
// Given a scanned `ProjectNode` + an `AssetRuntime`, this wires the project
// onto the studio:
// • it owns *project-page* routing — which of the project's pages the
// canvas shows — driven by the hash (`useHashRoute`), so the route
// survives reload and is shareable, with zero router config;
// • it renders the brownfield `StudioShell` (the floating dock, the
// walkthrough, the kept `#storyboard` dev page);
// • it publishes the project's page list to the dock — via
// `ProjectPagesContext` — so the dock shows the page picker (UX-DR1);
// • the `StudioShell` page that holds the project renders `ProjectCanvas`
// for the current project page.
//
// ── Where the project comes from ───────────────────────────────────────────
// `ProjectStudio` does NOT scan a folder — it is handed an already-scanned
// model. Today the `DevHarness` scans the bundled fixture and hands the model
// here; (`lerret dev`) swaps that one scan for the real user folder.
// Everything in THIS file is real studio code and is NOT replaced by 1.13.
//
// ── Routing: one shared hash ───────────────────────────────────────────────
// The studio uses a single hash route. On the project page the hash holds the
// *current project page's* `LerretPath`; `StudioShell` treats any hash it does
// not recognize as its own as a fall-through to its default page (the project
// page), so the two routing layers coexist on one hash with no collision. The
// brownfield `#storyboard` dev page is the one studio-shell route, and the
// project canvas is not mounted while it is shown.
//
// ── Custom fonts ───────────────────────────────────────────────
// The `core` loader records font files from the reserved `_fonts/` folder onto
// `project.fonts`. As the studio composition root, this is where those fonts
// are auto-registered: an effect injects an `@font-face` stylesheet (via
// `registerProjectFonts`) so every asset and artboard preview can use a custom
// font by its family name (FR12). The stylesheet is removed on unmount /
// project switch. A project with no `_fonts/` fonts registers nothing.

import React from 'react';

import { StudioShell, useHashRoute } from './studio-shell.jsx';
import { storyboard } from './fixtures/storyboard.jsx';
import { ProjectCanvas, resolvePage } from './components/canvas/project-canvas.jsx';
import { ProjectPagesContext } from './components/dock/project-pages-context.jsx';
import { ProjectModelContext } from './components/dock/project-model-context.jsx';
import { registerProjectFonts } from './runtime/font-registry.js';

// The studio-shell route that shows the loaded project's canvas. Any hash that
// is not a studio-shell route (i.e. a project-page path) falls through to this
// default — see `StudioShell`'s unknown-route handling.
const PROJECT_ROUTE = 'project';

/**
 * Render a loaded Lerret project as the studio.
 *
 * @param {object} props
 * @param {import('@lerret/core').ProjectNode} props.project
 * The scanned project model.
 * @param {import('./runtime/asset-runtime.js').AssetRuntime} props.runtime
 * The asset runtime for this project.
 * @param {string} [props.assetBaseUrl]
 * Base URL the project's files are served under by the Vite dev server — the
 * same base URL the asset runtime is given. Used to resolve the `src` of each
 * custom font's `@font-face` rule. The dev harness passes the
 * fixture alias; 's `lerret dev` passes the real server URL.
 * @returns {React.ReactElement}
 */
export function ProjectStudio({ project, runtime, assetBaseUrl }) {
 // The project's pages — memoized so a stable identity flows into the
 // navigation `useMemo` below (and the dock) rather than a fresh `[]`/array
 // each render.
 const pages = React.useMemo(() => (project && project.pages) || [], [project]);

 // Auto-register the project's custom fonts. The `core` loader
 // collected `_fonts/` font files onto `project.fonts`; this injects an
 // `@font-face` stylesheet so assets + artboard previews resolve each font by
 // its family name. The disposer removes the stylesheet on unmount / project
 // switch. A project with no `_fonts/` fonts injects nothing — no error.
 React.useEffect(() => {
 const registration = registerProjectFonts(project, { assetBaseUrl });
 return () => registration.dispose();
 }, [project, assetBaseUrl]);

 // One hash route, shared with `StudioShell`. The default is the project
 // route; when the hash holds a project-page path instead, that is the
 // current project page (and `StudioShell` falls through to the project
 // page since the path is not one of its routes).
 const [route, navigate] = useHashRoute(PROJECT_ROUTE);

 // Resolve the current project page from the hash. `resolvePage` falls back
 // to the first page when the hash is the bare project route or a stale
 // path — so the canvas always has a page to show (given >0 pages).
 const currentPage = resolvePage(project, route);
 const currentPageId = currentPage ? currentPage.path : null;

 // True when a non-project studio-shell page is showing (the brownfield
 // `#storyboard` dev page). The project canvas is not mounted then.
 const onShellPage = route === 'storyboard';

 // The page navigation object the dock's picker consumes. `id` is each
 // page's `LerretPath`; navigating sets the hash to it. Memoized so the dock
 // does not see a new object every render. `null` while a studio-shell page
 // is showing — the dock then falls back to its page buttons (which give a
 // route back to the project).
 const projectPagesNav = React.useMemo(() => {
 if (pages.length === 0 || onShellPage) return null;
 return {
 pages: pages.map((p) => ({ id: p.path, label: p.name })),
 current: currentPageId,
 onNavigate: (id) => navigate(id),
 };
 }, [pages, currentPageId, navigate, onShellPage]);

 // The studio-shell page registry. The project canvas is the default page;
 // the brownfield launch-assets storyboard is kept reachable at #storyboard.
 const shellPages = {
 [PROJECT_ROUTE]: {
 label: project ? project.name : 'Project',
 node: <ProjectCanvas project={project} runtime={runtime} pageId={currentPageId} />,
 },
 storyboard: { label: 'Storyboard', node: storyboard },
 };

 return (
 <ProjectModelContext.Provider value={project}>
 <ProjectPagesContext.Provider value={projectPagesNav}>
 <StudioShell pages={shellPages} defaultPage={PROJECT_ROUTE} />
 </ProjectPagesContext.Provider>
 </ProjectModelContext.Provider>
 );
}

export default ProjectStudio;
