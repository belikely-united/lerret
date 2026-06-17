// Vite config for the Lerret studio.
//
// @vitejs/plugin-react gives JSX transform + React Fast Refresh HMR — editing
// a studio component updates it in place without a full reload. That live-edit
// loop is the core reason for migrating the brownfield script-tag studio onto
// a real build, so the plugin is the one thing that must be here.

import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const studioDir = dirname(fileURLToPath(import.meta.url));
// The dev fixture project, OUTSIDE `src/`.
const fixtureLerretDir = resolve(studioDir, 'fixtures/sample-project/.lerret');

/**
 * A stand-in `virtual:lerret-project` for the standalone-studio Vite build
 * path (`vite build` for the studio package alone, no CLI).
 *
 * The CLI's `@lerret/cli dev` plugin owns this virtual module in CLI mode —
 * see `packages/cli/src/vite-plugin-lerret-project.js`. The studio's
 * `cli-project-source.jsx` imports it *statically*, so without a resolver
 * Rolldown can't build the standalone studio bundle.
 *
 * This shim resolves the specifier to a tiny no-op module: it exports
 * `null` for every field and `mode: 'fixture'`. At runtime the
 * standalone studio never loads `cli-project-source.jsx` (the
 * `__LERRET_CLI_MODE__` flag the CLI plugin would inject is absent, so
 * `main.jsx` takes the fixture branch), but the bundler still needs the
 * import to resolve to *something*.
 *
 * In `@lerret/cli dev` the CLI plugin's `resolveId` is registered first and
 * wins, so this shim is a fallback the CLI path never reaches.
 */
function virtualLerretProjectShim() {
 const id = 'virtual:lerret-project';
 const resolved = '\0' + id;
 return {
 name: 'lerret:virtual-project-shim',
 enforce: 'post', // CLI plugin (when present) wins
 resolveId(source) {
 if (source === id) return resolved;
 return null;
 },
 load(loadedId) {
 if (loadedId !== resolved) return null;
 return [
 '// Standalone-studio shim. CLI mode overrides this.',
 'export const project = null;',
 'export const assetBaseUrl = null;',
 'export const projectRoot = null;',
 'export const lerretDir = null;',
 // empty cascade entries — the fixture path computes its own
 // cascade in dev-harness.jsx; the standalone build (no CLI) never
 // reaches cli-project-source.jsx so this is only the type-safe shim.
 'export const cascadeEntries = [];',
 'export const assetConfigEntries = [];',
 'export const epoch = 0;',
 `export const mode = 'fixture';`,
 'export default { project, assetBaseUrl, projectRoot, lerretDir, cascadeEntries, assetConfigEntries, epoch, mode };',
 '',
 ].join('\n');
 },
 };
}

/**
 * Self-host packaging.
 *
 * Two concerns:
 *
 * 1. Service-worker stable name.
 * The service worker (`src/runtime/module-sw.js`) must live at a STABLE,
 * KNOWN URL at the root of the deployment so that:
 * - `navigator.serviceWorker.register('./module-sw.js')` works from any
 * sub-path (e.g. `https://host/lerret/`).
 * - The SW scope is `./` — the same directory — so it can intercept
 * `/__lerret/asset/…` fetches within that scope.
 * Vite's `new URL('./module-sw.js', import.meta.url)` idiom emits the SW
 * into `assets/` with a content hash. That is the wrong location AND a
 * non-deterministic name. This plugin instead:
 * - Resolves the source file from `src/runtime/module-sw.js`.
 * - After `writeBundle`, copies it to `dist/module-sw.js` (top-level).
 * The runtime (`sucrase-runtime.js`) computes the SW URL via
 * `import.meta.env.BASE_URL + 'module-sw.js'` — which is always `./module-sw.js`
 * relative to the page (or an absolute path when BASE_URL is explicit), so
 * it resolves to the top-level copy regardless of sub-path.
 *
 * 2. Hosted-mode flag injection.
 * The static SPA has no CLI plugin, so `__LERRET_HOSTED_MODE__` is never
 * injected at request-time. This plugin injects an inline `<script>` into
 * the production `index.html` so the studio boots into hosted mode without
 * any server involvement.
 *
 * @param {object} options
 * @param {string} options.studioDir Absolute path to the studio package root.
 * @returns {import('vite').Plugin}
 */
function lerretSelfHostPlugin({ studioDir }) {
 const swSrc = resolve(studioDir, 'src/runtime/module-sw.js');

 return {
 name: 'lerret:self-host',

 /**
 * Production only: inject `__LERRET_HOSTED_MODE__ = true` into the
 * built `index.html` so the static SPA boots in hosted mode.
 */
 transformIndexHtml: {
 order: 'post',
 handler(html, ctx) {
 // Only inject in the production build (ctx.server is absent).
 if (ctx.server) return html;
 const flag = '<script>globalThis.__LERRET_HOSTED_MODE__ = true;</script>';
 let out = html.replace('</head>', ` ${flag}\n </head>`);
 // Bake the React import map at BUILD time. Chrome commits a page's import
 // map when it first processes the element at load, so populating it at
 // runtime (setReactImportMap, after the folder pick) is too late — the live
 // map is already committed empty. The stable entry-chunk names
 // (rollupOptions.input + entryFileNames) make these URLs deterministic.
 // (Epic 10 / Story H1.2.)
 const importMap = JSON.stringify({
 imports: {
 react: './assets/react-instance.js',
 'react/jsx-runtime': './assets/react-jsx-runtime-instance.js',
 'react-dom': './assets/react-dom-instance.js',
 'react-dom/client': './assets/react-dom-client-instance.js',
 },
 });
 out = out.replace(
 /(<script type="importmap" id="lerret-import-map">)[\s\S]*?(<\/script>)/,
 `$1${importMap}$2`,
 );
 return out;
 },
 },

 /**
 * After Rolldown writes all chunks/assets, copy the service worker to the
 * top-level `dist/module-sw.js` with a stable (unhashed) name.
 *
 * Why top-level? The SW's scope covers the directory it is served from.
 * When the build is hosted at `https://host/lerret/`, a SW at
 * `./module-sw.js` relative to `index.html` is at `https://host/lerret/
 * module-sw.js` — its scope is `https://host/lerret/`, which is exactly
 * the directory the studio occupies. A SW inside `assets/` could only
 * cover `assets/`, not the page itself.
 */
 writeBundle(options) {
 const outDir = options.dir;
 if (!outDir) return;
 const dest = resolve(outDir, 'module-sw.js');
 try {
 copyFileSync(swSrc, dest);
 } catch (err) {
 // Surfaced as a Vite build error so the developer sees it immediately.
 this.error(`lerret:self-host: could not copy module-sw.js → ${dest}: ${err.message}`);
 }
 },
 };
}

// ── CLI-build mode ──────────────────────────────────────────────────────────
//
// When the studio is built for bundling inside the `@lerret/cli` npm package
// (`LERRET_CLI_BUILD=1`), `virtual:lerret-project` must NOT be resolved by the
// standalone shim — it must remain an external ESM reference in the compiled
// chunk so that Vite's dev server (which runs the `lerretProjectPlugin`) can
// intercept requests for it and inject the real project data at serve time.
//
// Without this, the shim's null values are inlined at build time and the
// compiled `cli-project-source` chunk always sees `project = null`, even when
// served through `@lerret/cli dev`'s programmatic Vite server.
//
// The `module-sw.js` copy and `__LERRET_HOSTED_MODE__` injection
// are SKIPPED in CLI-build mode — those are for the hosted static deployment
// path, not the CLI-served path. The CLI plugin injects `__LERRET_CLI_MODE__`
// instead (see `vite-plugin-lerret-project.js`).
const isCliBuild = process.env.LERRET_CLI_BUILD === '1';

export default defineConfig({
 plugins: isCliBuild
 ? [react()]
 : [react(), virtualLerretProjectShim(), lerretSelfHostPlugin({ studioDir })],
 build: {
 // Serve the static bundle from any path (root OR sub-path).
 // `base: './'` makes Vite emit relative asset URLs (e.g. `./assets/…`
 // instead of `/assets/…`) so the bundle works at `/lerret/` just as
 // well as at `/`. The service-worker URL is derived from
 // `import.meta.env.BASE_URL` at runtime (see sucrase-runtime.js), which
 // Vite replaces with the configured base at build time — also relative.
 //
 // The `base` is also set on the top-level defineConfig so Vite's HTML
 // transform applies it uniformly to every asset reference in index.html.

 // ── SPIKE EXCLUSION ────────────────────────────────────────────────────
 // The spike directory `spike/hosted-runtime/` is a throwaway prototype;
 // it is browser-loadable via the Vite dev server (for manual measurement)
 // but must NEVER be bundled into the production build. The `rollupOptions`
 // `external` rule below rejects any import of a spike file if one somehow
 // leaks into the build graph, and the directory is outside `src/` so
 // Rolldown never discovers it during tree-shaking.
 //
 // The real hosted runtime lives under `src/runtime/`; the spike
 // is kept only as a reference until it is explicitly cleaned up.
 rollupOptions: {
 external: isCliBuild
 ? [
 // In CLI-build mode: keep `virtual:lerret-project` as an external
 // ESM reference so the dev server's plugin can resolve it at
 // serve time. Also retain the spike guard.
 'virtual:lerret-project',
 /spike\/hosted-runtime\//,
 // React + ReactDOM externals. The CLI's Vite dev server aliases
 // `react`/`react-dom`/`react/jsx-runtime` etc. to its own bundled
 // copies, so user-authored .jsx assets share React with the studio.
 // Externalizing here means the studio bundle emits bare `import 'react'`
 // statements; the dev server resolves them via the same aliases as the
 // user assets, ensuring ONE React module instance at runtime — without
 // this, user components that call hooks throw "Invalid hook call".
 'react',
 'react-dom',
 'react-dom/client',
 'react/jsx-runtime',
 'react/jsx-dev-runtime',
 ]
 : [
 // Default (hosted) build: only the spike guard.
 /spike\/hosted-runtime\//,
 ],
 // Hosted build only: emit the React re-export modules (react-instance.js
 // etc.) as STABLE-named entry chunks. Rolldown hoists the shared React
 // into a common chunk that BOTH these entries and the studio import — one
 // instance — and `hosted-react-urls.js` points the import map at the
 // stable URLs so SW-served user assets resolve `react` to it. (Epic 10 / H1.2.)
 ...(isCliBuild
 ? {}
 : {
 // The re-export entries have no in-graph importer (the import map +
 // service worker consume them at RUNTIME), so without this Rolldown
 // tree-shakes their `export *` away, leaving empty chunks. Keep entry
 // signatures so `react-instance.js` et al. actually re-export React.
 preserveEntrySignatures: 'allow-extension',
 input: {
 index: resolve(studioDir, 'index.html'),
 'react-instance': resolve(studioDir, 'src/runtime/react-instance.js'),
 'react-jsx-runtime-instance': resolve(studioDir, 'src/runtime/react-jsx-runtime-instance.js'),
 'react-dom-instance': resolve(studioDir, 'src/runtime/react-dom-instance.js'),
 'react-dom-client-instance': resolve(studioDir, 'src/runtime/react-dom-client-instance.js'),
 },
 output: {
 entryFileNames: (chunk) =>
 [
 'react-instance',
 'react-jsx-runtime-instance',
 'react-dom-instance',
 'react-dom-client-instance',
 ].includes(chunk.name)
 ? 'assets/[name].js'
 : 'assets/[name]-[hash].js',
 },
 }),
 },
 outDir: isCliBuild ? 'dist-cli' : 'dist',
 },
 // Relative base for sub-path hosting support.
 base: './',
 resolve: {
 alias: {
 // ── DEV-HARNESS / FIXTURE WIRING ──────────────────────────────────────
 // The dev harness (`src/dev-harness.jsx`) exercises the
 // CLI-mode `vite-runtime` by dynamically importing the fixture project's
 // `.jsx`/`.tsx` asset files as real ES modules through THIS dev server.
 // Those files live at `fixtures/sample-project/.lerret/`, outside `src/`.
 // This alias lets the runtime's computed module URLs
 // (`/@fixture-lerret/<page>/<Asset>.jsx`) resolve to them, so Vite
 // transforms (incl. `.tsx`) and serves them with relative imports
 // (`./mark-glyph.png`) resolving normally.
 //
 // The `@lerret/cli dev` CLI REPLACES this: the real CLI points a Vite
 // dev server at the *user's* `.lerret/` folder and the runtime's base
 // URL becomes that server's URL. The `vite-runtime` itself does not
 // change — only this fixture alias goes away.
 '/@fixture-lerret': fixtureLerretDir,
 },
 },
 server: {
 // Open at a fixed-ish port for a predictable dev URL.
 port: 5173,
 fs: {
 // ── DEV-HARNESS / FIXTURE WIRING ──────────────────────────────────────
 // Allow the dev server to read the fixture project dir, which sits
 // outside the studio package root. Removed once the real
 // user-folder server supersedes the fixture.
 allow: [studioDir, fixtureLerretDir],
 },
 },
});
