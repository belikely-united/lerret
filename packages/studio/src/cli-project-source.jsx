// cli-project-source.jsx — the CLI-mode project provider.
//
// When the studio is loaded by `@lerret/cli dev`, the project model is computed
// server-side by `@lerret/cli`'s Vite plugin and handed to us as a virtual
// module (`virtual:lerret-project`). This file owns the studio-side of that
// contract:
//
// 1. Read the initial project + asset base URL from the virtual module.
// 2. Build the CLI-mode `vite-runtime` for the project (the same runtime
// the dev-harness uses — only the *source* of the project is new).
// 3. Listen on the `lerret:change` HMR custom event for incremental
// updates from the watcher:
// a. Call `runtime.notifyChange(path)` so the runtime's cache-bust
// token bumps for that path and the next `loadAsset` re-evaluates
// the changed module.
// b. When the server sends a new full project snapshot (`payload.
// project`), re-mount `<ProjectStudio>` with it — so add / remove /
// rename of files and folders show up on the canvas without a full
// browser reload (FR7; the server-side `applyWatchEvent` patches
// the model upstream).
// 4. If `project` is `null` (the CLI couldn't resolve a `.lerret/`),
// render a minimal "no folder" placeholder. The full open-folder
// empty-state UI lives in the hosted-mode entry layer; this is just the
// wiring seat so the studio reaches that path cleanly under `@lerret/cli dev`
// invoked from outside a project (FR43).
//
// ── What is REAL (and shared with the dev-harness path) ───────────────────
// - `runtime/vite-runtime.js` — the CLI-mode runtime, used unchanged.
// - `ProjectStudio` — the studio composition root.
// - The asset-runtime cache-bust / change-signal contract.
//
// Only the *source* of the project differs:
// - dev-harness → `import.meta.glob` over the bundled fixture.
// - this file → `virtual:lerret-project` injected by `@lerret/cli`.

import React from 'react';

// Pulled in for its side-effect: this is the contract module the CLI's
// `vite-plugin-lerret-project` provides. The import succeeds only under
// `@lerret/cli dev` (the plugin owns the resolution); in any other mode this
// file is never loaded — `main.jsx`'s flag-gated dynamic-import branch
// keeps the standalone build path away from it.
import {
 project as INITIAL_PROJECT,
 assetBaseUrl as INITIAL_ASSET_BASE_URL,
 cascadeEntries as INITIAL_CASCADE_ENTRIES,
} from 'virtual:lerret-project';

import { createViteRuntime } from './runtime/vite-runtime.js';
import { ProjectStudio } from './project-studio.jsx';
import { CascadedConfigProvider } from './components/canvas/cascade-context.jsx';

// the real open-folder empty state replaces the old placeholder.
import { OpenFolder } from './components/entry/open-folder.jsx';

// `@lerret/cli export` drives a headless Chromium and invokes captureArtboard via
// `page.evaluate`. The CLI cannot dynamic-`import('/src/export/capture.js')`
// from the page because that source path does not exist in the production
// `dist-studio/` bundle (Vite emits hashed chunk names). Exposing the
// statically-imported `captureArtboard` on `window` gives the CLI a stable
// hook that survives bundling — the function is already in the main chunk
// because `single.js` / `zip.js` import it for the per-artboard PNG button.
import { captureArtboard } from './export/capture.js';

if (typeof window !== 'undefined') {
 window.__lerret_capture = captureArtboard;

 /**
  * Headless-browser entry point for `@lerret/cli export --format <gif|webp|apng|mp4>`.
  *
  * Reaches `@lerret/animation` via dynamic import — the second of the two
  * boundary call-sites (the first is the in-studio dialog at
  * `components/export/animated-export-dialog.jsx`). Static imports of
  * `@lerret/animation` from any studio source remain forbidden; the
  * no-static-imports test in `packages/animation/src/no-static-imports.test.js`
  * enforces this.
  *
  * Returns a `{ blob, bytesB64 }` shape so the Playwright bridge can transfer
  * the bytes back to Node without serializing a Blob (which it can't).
  */
 window.__lerret_capture_animated = async (element, settings) => {
  const animation = await import('@lerret/animation');
  const { createEncoder, captureToEncoder } = animation;
  const width = Math.round(settings.width * (settings.scale || 1));
  const height = Math.round(settings.height * (settings.scale || 1));
  const encoder = await createEncoder(settings.format, {
   width,
   height,
   fps: settings.fps,
   loop: settings.loop,
  });
  const blob = await captureToEncoder(element, encoder, {
   mode: settings.captureMode || 'now',
   durationMs: settings.durationMs,
   fps: settings.fps,
   scale: settings.scale,
   liveRefreshIntervalMs: settings.liveRefreshIntervalMs || settings.durationMs,
  });
  // Encode Blob bytes to base64 for the bridge.
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
   bin += String.fromCharCode.apply(null, buf.subarray(i, i + chunk));
  }
  return { bytesB64: btoa(bin), mimeType: blob.type };
 };
}

/**
 * The custom HMR event name the CLI plugin sends. Kept in lock-step with the
 * `HMR_CHANGE_EVENT` constant in `packages/cli/src/vite-plugin-lerret-
 * project.js`. If you change one, change the other.
 *
 * @type {string}
 */
const HMR_CHANGE_EVENT = 'lerret:change';

/**
 * The CLI-mode project source. Mounted by `main.jsx` when CLI mode is
 * detected (the `__LERRET_CLI_MODE__` flag the plugin injects into the
 * served HTML).
 *
 * @returns {React.ReactElement}
 */
export function CliProjectSource() {
 // Pull the initial state out of the virtual module. The plugin freezes
 // this into a JSON snapshot at module-load time; subsequent updates come
 // through the HMR event below.
 const initialProject = INITIAL_PROJECT;
 const assetBaseUrl = INITIAL_ASSET_BASE_URL;

 // The currently-mounted project. Replaced (with the new snapshot from the
 // server) on every `lerret:change` event so add/remove/rename are
 // reflected on the canvas without a full reload.
 const [project, setProject] = React.useState(initialProject);

 // The serialized cascade entries — updated on every `lerret:change` event
 // that carries a new cascade (i.e. after a config.json edit). The
 // `CascadedConfigProvider` rehydrates these into a Map so descendant
 // components can look up any folder's effective config instantly.
 const [cascadeEntries, setCascadeEntries] = React.useState(
 INITIAL_CASCADE_ENTRIES || [],
 );

 // The CLI-mode runtime. Bound to the *initial* project — the runtime's
 // change-signal API handles content edits without needing a
 // new runtime. For structural model updates we just hand a new `project`
 // prop down to `<ProjectStudio>`; the runtime is reused because its
 // contract is shaped around per-asset paths, not the whole tree.
 //
 // (Re-creating the runtime on every project update would also reset its
 // listener set + per-asset cache-bust tokens, which is the opposite of
 // what we want.)
 const runtime = React.useMemo(() => {
 if (!initialProject) return null;
 return createViteRuntime(initialProject, { assetBaseUrl });
 }, [initialProject, assetBaseUrl]);

 // Dispose the runtime on unmount. The studio is a long-lived SPA but this
 // matters for tests + hot-module replacement on this very file.
 React.useEffect(() => {
 if (!runtime) return undefined;
 return () => runtime.dispose();
 }, [runtime]);

 // The HMR bridge — the CLI watcher → runtime + project-model live update.
 React.useEffect(() => {
 if (!runtime) return undefined;
 if (typeof import.meta === 'undefined' || !import.meta.hot) return undefined;

 const hot = import.meta.hot;
 /**
 * Handler for the `lerret:change` HMR custom event.
 *
 * Payload shape (from `vite-plugin-lerret-project.js`):
 * { event: { type: 'add' | 'change' | 'remove', path }, project }
 *
 * @param {{ event: { type: string, path: string }, project: object | null }} payload
 */
 const onChange = (payload) => {
 if (!payload || typeof payload !== 'object') return;

 // 1. Cache-bust the runtime for this path. This is the content-edit
 // live-edit loop's `notifyChange` API.
 if (payload.event && typeof payload.event.path === 'string') {
 runtime.notifyChange(payload.event.path);
 }

 // 2. Swap in the new project snapshot. `applyWatchEvent` ran on the
 // server, so this snapshot is the model AFTER the change. The
 // canvas's section-walk re-runs off the new prop and add/remove/
 // rename appears without a full reload. A no-op change (e.g. an
 // edit to a non-asset file like a `config.json`) just returns the
 // same model; React diffs and renders nothing new.
 if ('project' in payload) {
 setProject(payload.project);
 }

 // 3. Update the cascade when the server sends a fresh one (happens on
 // every watcher event — see `vite-plugin-lerret-project.js`). A
 // config.json edit causes the cascade to recompute server-side and
 // the new entries arrive here, making `CascadedConfigProvider`
 // update the context so sections re-render with the new bg color
 // without a full reload (FR18 live update).
 if ('cascadeEntries' in payload && Array.isArray(payload.cascadeEntries)) {
 setCascadeEntries(payload.cascadeEntries);
 }
 };

 hot.on(HMR_CHANGE_EVENT, onChange);
 // No `hot.off` is exposed for custom events in Vite 8 — the listener is
 // bound to this module's HMR boundary and is cleared when the module
 // reloads. That's fine for our single long-lived mount.
 return undefined;
 }, [runtime]);

 // No-folder path: the CLI was invoked outside any `.lerret/` project.
 // render the real open-folder empty state in cliMode so the
 // entry surface is consistent across hosted and CLI modes (UX-DR13).
 // In CLI mode the picker action shows guidance toward `@lerret/cli dev <path>`
 // rather than routing through the FSA picker flow — the simplest path per
 // the story's "pick the simpler one" guidance.
 if (!project) {
 return <OpenFolder cliMode />;
 }

 return (
 <CascadedConfigProvider cascadeEntries={cascadeEntries}>
 <ProjectStudio project={project} runtime={runtime} assetBaseUrl={assetBaseUrl} />
 </CascadedConfigProvider>
 );
}

export default CliProjectSource;
