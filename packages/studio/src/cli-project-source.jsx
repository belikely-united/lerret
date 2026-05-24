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
 epoch as INITIAL_EPOCH,
} from 'virtual:lerret-project';

import { createViteRuntime } from './runtime/vite-runtime.js';
import { onLerretChange } from './runtime/cli-hmr.js';
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
 * The CLI-mode project source. Mounted by `main.jsx` when CLI mode is
 * detected (the `__LERRET_CLI_MODE__` flag the plugin injects into the
 * served HTML).
 *
 * @returns {React.ReactElement}
 */
export function CliProjectSource() {
 // Initial state from the virtual module (a frozen snapshot at module-load).
 // Everything after boot arrives over the `lerret:change` HMR event — including
 // a wholesale folder SWITCH (POST /__lerret/switch-folder), which carries a
 // new project, a bumped `epoch`, and a possibly-changed `assetBaseUrl`.
 const [project, setProject] = React.useState(INITIAL_PROJECT);
 const [assetBaseUrl, setAssetBaseUrl] = React.useState(INITIAL_ASSET_BASE_URL);

 // The serialized cascade entries — updated on every `lerret:change` event
 // that carries a new cascade (config.json edit, or a switch). The
 // `CascadedConfigProvider` rehydrates these into a Map so descendant
 // components can look up any folder's effective config instantly.
 const [cascadeEntries, setCascadeEntries] = React.useState(
 INITIAL_CASCADE_ENTRIES || [],
 );

 // `epoch` bumps on every folder switch. It (a) cache-busts asset imports via
 // `?v=<epoch>` and (b) keys the runtime memo so a fresh runtime is built per
 // switch (binding it to the new folder's project).
 const [epoch, setEpoch] = React.useState(INITIAL_EPOCH || 0);

 // Latest project mirrored to a ref so the epoch-keyed runtime memo can read
 // the post-switch project WITHOUT listing `project` as a dep — which would
 // rebuild the runtime (resetting its per-asset cache tokens) on every routine
 // live-edit model swap, the opposite of what we want.
 const projectRef = React.useRef(project);
 projectRef.current = project;

 // The CLI-mode runtime. Rebuilt ONLY when a switch changes the epoch (or the
 // asset base URL flips, e.g. connecting from the no-project state) — never on
 // a routine live-edit project swap. Bound to the just-switched project (read
 // from the ref) and the new epoch, so its asset URLs carry `?v=<epoch>` and
 // re-fetch the new folder's modules.
 const runtime = React.useMemo(() => {
 const p = projectRef.current;
 if (!p || !assetBaseUrl) return null;
 return createViteRuntime(p, { assetBaseUrl, epoch });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [epoch, assetBaseUrl]);

 // Mirror the live runtime to a ref so the once-installed HMR subscriber can
 // call notifyChange on the CURRENT runtime without re-subscribing each rebuild.
 const runtimeRef = React.useRef(runtime);
 runtimeRef.current = runtime;

 // Dispose the runtime on unmount. The studio is a long-lived SPA but this
 // matters for tests + hot-module replacement on this very file.
 React.useEffect(() => {
 if (!runtime) return undefined;
 return () => runtime.dispose();
 }, [runtime]);

 // The HMR bridge — installed ONCE. Handles both incremental live edits and
 // wholesale folder switches. Subscribes via `onLerretChange` (not
 // `import.meta.hot`) so the listener SURVIVES `vite build`: the published CLI
 // serves the pre-built `dist-studio` bundle, where an `import.meta.hot`-gated
 // block would be tree-shaken away (taking live edit with it). See
 // `runtime/cli-hmr.js`.
 React.useEffect(() => {
 /**
 * Handler for the `lerret:change` HMR custom event.
 *
 * Payload (from `vite-plugin-lerret-project.js`):
 *   { event: { type: 'add'|'change'|'remove'|'switch', path },
 *     project, cascadeEntries, epoch, assetBaseUrl }
 *
 * @param {{ event?: { type: string, path: string }, project?: object|null,
 *   cascadeEntries?: Array, epoch?: number, assetBaseUrl?: string|null }} payload
 */
 const onChange = (payload) => {
 if (!payload || typeof payload !== 'object') return;

 const isSwitch = payload.event && payload.event.type === 'switch';

 // 1. Content-edit cache-bust — NOT for a switch (the epoch handles that,
 // and a switch has no single changed path). Read the CURRENT runtime
 // from the ref so this once-installed handler always targets the live one.
 const rt = runtimeRef.current;
 if (rt && !isSwitch && payload.event && typeof payload.event.path === 'string') {
 rt.notifyChange(payload.event.path);
 }

 // 2. Switch metadata applied BEFORE the project so the epoch-keyed runtime
 // memo recomputes against the new epoch on the next render. A bumped epoch
 // rebuilds the runtime; a changed assetBaseUrl flips connected/no-project.
 if (typeof payload.epoch === 'number') setEpoch(payload.epoch);
 if ('assetBaseUrl' in payload) setAssetBaseUrl(payload.assetBaseUrl);

 // 3. The new model snapshot (or null on "close project"). `applyWatchEvent`
 // ran on the server, so this is the model AFTER the change; the canvas
 // re-walks off the new prop with no full reload. A no-op edit returns the
 // same model and React renders nothing new.
 if ('project' in payload) setProject(payload.project);

 // 4. The recomputed cascade (section bg/fg colors), live per FR18.
 if ('cascadeEntries' in payload && Array.isArray(payload.cascadeEntries)) {
 setCascadeEntries(payload.cascadeEntries);
 }
 };

 return onLerretChange(onChange);
 // Installed once for the studio's lifetime — it reads live state via refs +
 // setState, so it never needs to re-subscribe.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 // No-folder path: the CLI was launched outside a project, OR the user chose
 // "Close project". Render the connect screen so a folder can be opened without
 // restarting the CLI — it POSTs /__lerret/switch-folder (UX-DR13).
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
