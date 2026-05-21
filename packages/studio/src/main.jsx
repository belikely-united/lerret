// Vite app entry for the Lerret studio.
//
// (migration) Replaces the inline `<App>` script + `ReactDOM.createRoot`
// call from the old `LeafMarker Launch Assets.html`. It imports the studio
// styles (formerly `<link rel="stylesheet">` tags), then mounts the studio.
//
// `styles.css` itself `@import`s `colors_and_type.css`, so importing it here
// pulls in the `--lm-*` design tokens unchanged.
//
// The entry is the place we decide which **project source** to
// mount. Two sources today:
//
// • CLI mode (`lerret dev`):
// The CLI's Vite plugin (`lerret`'s `vite-plugin-lerret-project`)
// injects an inline `<script>window.__LERRET_CLI_MODE__ = true</script>`
// into the served `index.html` AND provides a virtual module
// `virtual:lerret-project` carrying the server-scanned project + the
// asset base URL. When the flag is set we mount `<CliProjectSource>`,
// which imports the virtual module and runs against the real user
// folder.
//
// • Fixture mode (the studio's standalone `vite dev`):
// No CLI plugin is present, the flag is absent, and the studio falls
// back to `<DevHarness>` — the bundled fixture project
// (`packages/studio/fixtures/sample-project/.lerret/`) the studio
// package uses for its own component work.
//
// • Hosted mode:
// When the static build is deployed standalone (no CLI plugin) and the
// entry-layer flag (`__LERRET_HOSTED_MODE__`) is set, we mount
// `<HostedProjectSource>` — which runs the FSA picker, trust gate,
// and the Sucrase / service-worker runtime. The hosted runtime + SW are
// emitted into the build and the entry UX is fleshed out in this layer.
//
// The flag — a plain global the CLI sets in `transformIndexHtml` — is the
// signal because the dynamic-import alternative trips the browser's CORS
// rules (bare specifiers like `virtual:lerret-project` aren't valid URLs in
// a browser fetch). The plugin is the only producer of that flag, so its
// presence is unambiguous. All paths mount through the same `<ProjectStudio>`
// underneath; only the project SOURCE differs.
//
// The CLI-bundled mode embeds the pre-built studio into the `lerret` npm
// package. THIS file does not change for that — the CLI's plugin contract
// is the same in either packaging.

import { createRoot } from 'react-dom/client';

import './styles/styles.css';

/**
 * The global flag the CLI plugin injects to signal CLI mode. Read from
 * `globalThis` so this is friendly to non-browser tests too (where there is
 * no `window`).
 *
 * @returns {boolean}
 */
function isCliMode() {
 return typeof globalThis !== 'undefined' && globalThis.__LERRET_CLI_MODE__ === true;
}

/**
 * The hosted-mode flag (seam; wires the full entry flow).
 * The static-bundle deployment sets it via an inline script in `index.html`
 * (NOT injected by the CLI plugin). Distinct from `__LERRET_CLI_MODE__` so
 * the two modes never overlap.
 *
 * @returns {boolean}
 */
function isHostedMode() {
 return typeof globalThis !== 'undefined' && globalThis.__LERRET_HOSTED_MODE__ === true;
}

/**
 * Boot the studio: detect mode, mount the right project source.
 *
 * @returns {Promise<void>}
 */
async function boot() {
 // Each branch dynamically imports the project-source module so the bundler
 // emits each as a separate chunk. Only the chunk for the active mode loads
 // — and the hosted chunk pulls in `sucrase-runtime.js`. The
 // `lerretSelfHostPlugin` (vite.config.js) copies `module-sw.js` to the root
 // of the dist/ output as a stable top-level asset. The other two modes
 // never touch hosted-mode code.
 let element;
 if (isCliMode()) {
 const { CliProjectSource } = await import('./cli-project-source.jsx');
 element = <CliProjectSource />;
 } else if (isHostedMode()) {
 const { HostedProjectSource } = await import('./hosted-project-source.jsx');
 element = <HostedProjectSource />;
 } else {
 const { DevHarness } = await import('./dev-harness.jsx');
 element = <DevHarness />;
 }

 createRoot(document.getElementById('root')).render(element);
}

boot();
