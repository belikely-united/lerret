// hosted-project-source.jsx — the hosted-mode project provider seam.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ THIS FILE IS A SEAM. It mirrors the pattern of: ║
// ║ - dev-harness.jsx (standalone-studio / fixture mode) ║
// ║ - cli-project-source.jsx (`lerret dev` CLI mode) ║
// ║ fleshes out the full FSA → trust gate → loader → runtime ║
// ║ → studio mount flow here. THIS story (5.3) establishes the seam and ║
// ║ ensures the hosted runtime (and its service worker) ship in the bundle. ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// What this file does:
// - Imports the hosted runtime + SW URL so Vite's bundler emits both as
// static assets in `vite build`. Without this, the SW file would be a
// dead file with no inbound edge in the build graph.
// - Mounts the entry orchestrator which routes between the open-folder,
// unsupported-browser, and canvas-mount screens.

import {
 hostedRuntimeFactory,
 registerHostedServiceWorker,
 ServiceWorkerRegistrationError,
 setReactImportMap,
 HOSTED_SERVICE_WORKER_URL,
} from './runtime/sucrase-runtime.js';

// Force-touch the runtime + SW URL so the bundler keeps both in the build
// graph. `hostedRuntimeFactory` is the factory the future entry layer hands
// to `<ProjectStudio>` (mirroring `viteRuntimeFactory`); `HOSTED_SERVICE_WORKER_URL`
// is the build-emitted URL the entry layer passes to
// `registerHostedServiceWorker`. Setting these on `window.__LERRET_HOSTED__`
// at module load is the simplest way to make the import side-effect-visible
// to the bundler without coupling production logic to a debug surface.
if (typeof window !== 'undefined') {
 /** @type {any} */
 const w = window;
 w.__LERRET_HOSTED__ = {
 hostedRuntimeFactory,
 registerHostedServiceWorker,
 ServiceWorkerRegistrationError,
 setReactImportMap,
 serviceWorkerUrl: HOSTED_SERVICE_WORKER_URL,
 };
}

// Entry orchestrator — capability check → open-folder or unsupported-browser.
import { EntryRoot } from './components/entry/entry-root.jsx';

/**
 * The hosted-mode project provider.
 *
 * Mounts the entry orchestrator which detects File System Access API support
 * and shows the correct entry screen. When the user picks a valid Lerret folder
 * the `onReady` callback receives the handle. The trust-dialog will
 * compose its gate between this callback and the canvas mount; for now the
 * handle is logged so the integration seam is clear.
 *
 * @returns {import('react').ReactElement}
 */
export function HostedProjectSource() {
 function handleReady(handle) {
 // The full flow replaces this body with: trust-check → canvas mount.
 // For now, the seam is wired: the folder handle is available here.
 // We log it so the entry flow is visible in DevTools without a stub canvas.
 if (typeof window !== 'undefined') {
 console.info('[lerret:hosted] folder selected — handing off to trust gate / canvas mount', handle?.name);
 }
 }

 return <EntryRoot onReady={handleReady} />;
}

export default HostedProjectSource;
