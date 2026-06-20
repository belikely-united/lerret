// hosted-bringup.js — the hosted-mode "cold start" composition (Epic 10 / H1.2).
//
// Turns a freshly-picked project-folder handle into everything `<ProjectStudio>`
// needs: a writable FSA backend, the registered service-worker bridge, the
// Sucrase runtime, and the loaded project model (+ cascade + per-asset config).
//
// This module is DELIBERATELY dependency-injected and import-free: every browser
// or build-coupled piece (FSA backend, service-worker registration, the React
// import-map, the runtime factory) is passed in by the caller
// (`hosted-project-source.jsx` supplies the real ones; tests supply fakes +
// the in-memory backend). That keeps the orchestration — the ORDER and the
// fs/sw wiring, which is the part worth pinning — fully unit-testable without a
// real browser, FSA picker, or service worker.

/**
 * @typedef {object} HostedBringupDeps
 * @property {(handle: any) => import('@lerret/core').FilesystemAccess} createBackend
 *   Build a full FilesystemAccess from the picked directory handle.
 * @property {() => Promise<{ postMessage: Function }>} registerServiceWorker
 *   Register the hosted service worker; resolves to the SW bridge.
 * @property {(urls: object) => unknown} applyReactImportMap
 *   Install the React import map (so SW-served modules resolve `react` to the
 *   studio's own instance). MUST run before the first asset import.
 * @property {() => object} reactImportMapUrls
 *   Produce the `{ react, jsxRuntime, ... }` URL set for the import map.
 * @property {(backend: import('@lerret/core').FilesystemAccess) => Promise<{ project: object, cascadeEntries: Array, assetConfigEntries: Array }>} loadProject
 *   Load the project model from the backend (`loadHostedProject`).
 * @property {(project: object, options: { fs: object, sw: object }) => object} createRuntime
 *   Build the asset runtime (`createHostedRuntime`).
 */

/**
 * @typedef {object} HostedStudioBringup
 * @property {import('@lerret/core').FilesystemAccess} backend
 * @property {{ postMessage: Function }} sw
 * @property {object} runtime
 * @property {object} project
 * @property {Array<[string, object]>} cascadeEntries
 * @property {Array<[string, object]>} assetConfigEntries
 */

/**
 * Cold-start the hosted studio from a picked folder handle.
 *
 * Order matters and is asserted by the tests:
 *   1. backend (full read/write FSA)
 *   2. service worker registered (the runtime needs its bridge)
 *   3. React import map installed BEFORE any asset module is imported
 *   4. project model loaded
 *   5. runtime built, bound to the backend (`fs`) + SW bridge (`sw`)
 *
 * Any step that throws rejects the whole bring-up — the caller renders the
 * matching error screen (permission denied, SW unsupported, etc.).
 *
 * @param {any} handle The picked `FileSystemDirectoryHandle`.
 * @param {HostedBringupDeps} deps
 * @returns {Promise<HostedStudioBringup>}
 */
export async function bringUpHostedStudio(handle, deps) {
  const {
    createBackend,
    registerServiceWorker,
    applyReactImportMap,
    reactImportMapUrls,
    loadProject,
    createRuntime,
    registerImages,
  } = deps;

  const backend = createBackend(handle);
  const sw = await registerServiceWorker();

  // Install the import map before the runtime (and thus any asset import) so
  // SW-served `import "react"` lines resolve to the studio's own React copy.
  applyReactImportMap(reactImportMapUrls());

  const { project, cascadeEntries, assetConfigEntries } = await loadProject(backend);
  const runtime = createRuntime(project, { fs: backend, sw });

  // Register the project's image files with the SW so `<img src>` references in
  // assets resolve in hosted mode (no dev server serves project statics).
  if (typeof registerImages === 'function') await registerImages(backend, sw);

  return { backend, sw, runtime, project, cascadeEntries, assetConfigEntries };
}
