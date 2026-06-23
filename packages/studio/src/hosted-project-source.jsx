// hosted-project-source.jsx — the hosted-mode project provider (Epic 10 / H1).
//
// Mounted by main.jsx when `__LERRET_HOSTED_MODE__` is set. Mirrors
// `cli-project-source.jsx`, but the project SOURCE is the user's local folder
// reached through the File System Access API instead of the CLI's virtual
// module + HTTP endpoints:
//
//   pick folder (EntryRoot) → bringUpHostedStudio(handle):
//     FSA backend → service worker → React import map → load model → runtime
//   → mount <ProjectStudio> → poll the folder (hosted watcher) → reload on change.
//
// The cold-start orchestration is unit-tested in `runtime/hosted-bringup.js`
// with fakes; this file wires the real browser pieces and owns the React state
// machine + the live-reload subscription.

import React from 'react';

import { EntryRoot } from './components/entry/entry-root.jsx';
import { ProjectStudio } from './project-studio.jsx';
import { CascadedConfigProvider } from './components/canvas/cascade-context.jsx';
import { AssetConfigProvider } from './components/canvas/asset-config-context.jsx';

import { createFsaBackend, PermissionDeniedError } from './fs/fsa-backend.js';
import { createHostedWriter } from './fs/hosted-writer.js';
import { createHostedAiFs, setHostedAiFs } from './fs/hosted-ai-fs.js';
import { createHostedDataReader, setHostedDataReader } from './runtime/hosted-data-reader.js';
import {
  registerHostedServiceWorker,
  setReactImportMap,
  createHostedRuntime,
  ServiceWorkerRegistrationError,
} from './runtime/sucrase-runtime.js';
import { startHostedWatcher } from './runtime/hosted-watcher.js';
import { loadHostedProject } from './runtime/hosted-loader.js';
import { setHostedWriter } from './runtime/write-client.js';
import { setHostedController } from './runtime/hosted-controller.js';
import { rememberRecent } from './runtime/hosted-recents.js';
import { bringUpHostedStudio } from './runtime/hosted-bringup.js';
import { resolveReactImportMapUrls } from './runtime/hosted-react-urls.js';
import { registerProjectImages, imageMime } from './runtime/hosted-images.js';

/**
 * Production bring-up dependencies. The orchestration that consumes these is
 * tested separately with fakes (`runtime/hosted-bringup.test.js`); here we bind
 * the real browser-coupled implementations.
 *
 * @type {import('./runtime/hosted-bringup.js').HostedBringupDeps}
 */
const REAL_DEPS = {
  createBackend: (handle) => createFsaBackend(handle),
  registerServiceWorker: () => registerHostedServiceWorker(),
  applyReactImportMap: setReactImportMap,
  reactImportMapUrls: resolveReactImportMapUrls,
  loadProject: loadHostedProject,
  createRuntime: createHostedRuntime,
  registerImages: registerProjectImages,
};

/**
 * The hosted-mode project provider.
 *
 * @param {object} [props]
 * @param {import('./runtime/hosted-bringup.js').HostedBringupDeps} [props.deps]
 *   Injectable for tests/storybook; defaults to the real browser pieces.
 * @returns {React.ReactElement}
 */
export function HostedProjectSource({ deps = REAL_DEPS } = {}) {
  const [phase, setPhase] = React.useState('entry'); // 'entry' | 'loading' | 'ready' | 'error'
  const [studio, setStudio] = React.useState(null); // { runtime, project, cascadeEntries, assetConfigEntries }
  const [error, setError] = React.useState(null);

  const backendRef = React.useRef(null);
  const runtimeRef = React.useRef(null);
  const watcherRef = React.useRef(null);
  const swRef = React.useRef(null);
  // Auto-resume the last project only on the FIRST entry render (a real page
  // load / refresh). After the user deliberately leaves via goHome (Switch /
  // Close project), returning to the connect screen must NOT silently reopen the
  // project they just closed — that would make those buttons look broken.
  const returnedHomeRef = React.useRef(false);

  // Leave the current project for the home/connect screen (H7 switch + close).
  const goHome = React.useCallback(() => {
    watcherRef.current?.close?.();
    runtimeRef.current?.dispose?.();
    watcherRef.current = null;
    runtimeRef.current = null;
    backendRef.current = null;
    swRef.current = null;
    setHostedWriter(null);
    setHostedAiFs(null);
    setHostedDataReader(null);
    setStudio(null);
    setError(null);
    returnedHomeRef.current = true;
    setPhase('entry');
  }, []);

  // Re-load the model after a watcher event (add/remove/rename/change on disk).
  // v1 re-scans the whole project — correct and simple; an incremental
  // applyWatchEvent patch (as CLI mode does) is a later optimization.
  const reload = React.useCallback(
    async (changedPath) => {
      const backend = backendRef.current;
      if (!backend) return;
      try {
        if (changedPath && runtimeRef.current?.notifyChange) {
          runtimeRef.current.notifyChange(changedPath);
        }
        const next = await deps.loadProject(backend);
        // A new/changed image (e.g. a save_attachment write) needs (re-)registering
        // with the SW so its <img src> resolves; skip the walk for non-image edits.
        if (swRef.current && deps.registerImages && (!changedPath || imageMime(changedPath))) {
          await deps.registerImages(backend, swRef.current);
        }
        setStudio((prev) => (prev ? { ...prev, ...next } : prev));
      } catch (err) {
        setError(err);
        setPhase('error');
      }
    },
    [deps],
  );

  const onReady = React.useCallback(
    async (handle) => {
      setPhase('loading');
      setError(null);
      try {
        const up = await bringUpHostedStudio(handle, deps);
        backendRef.current = up.backend;
        runtimeRef.current = up.runtime;
        swRef.current = up.sw;
        // Wire writes (data/config/meta + lifecycle) to local disk via FSA.
        setHostedWriter(createHostedWriter(up.backend));
        // Wire the AI agent's file loop to the same FSA backend (hosted AI).
        setHostedAiFs(createHostedAiFs(up.backend));
        // Wire the canvas's data-file reads to the FSA backend so AI-authored
        // .data.json text is loaded + editable in hosted mode (no dev server) —
        // and route .data.js / .data.ts through the runtime's loadDataModule so
        // dynamic / fetching data files run in hosted mode too.
        setHostedDataReader(
          createHostedDataReader(up.backend, { loadDataModule: up.runtime.loadDataModule }),
        );
        // Remember this project for recents + expose switching to the dock (H7).
        rememberRecent(handle && handle.name ? handle.name : 'project', handle);
        setHostedController({ openAnother: goHome, close: goHome });
        setStudio({
          runtime: up.runtime,
          project: up.project,
          cascadeEntries: up.cascadeEntries,
          assetConfigEntries: up.assetConfigEntries,
        });
        setPhase('ready');
        watcherRef.current = startHostedWatcher({
          rootHandle: handle,
          onEvent: (event) => reload(event && event.path),
          onError: (err) => console.error('[lerret:hosted] watcher', err),
        });
      } catch (err) {
        setError(err);
        setPhase('error');
      }
    },
    [deps, reload, goHome],
  );

  // Tear down the watcher + runtime when the provider unmounts.
  React.useEffect(
    () => () => {
      watcherRef.current?.close?.();
      runtimeRef.current?.dispose?.();
      setHostedWriter(null);
      setHostedAiFs(null);
      setHostedDataReader(null);
      setHostedController(null);
    },
    [],
  );

  if (phase === 'entry') return <EntryRoot onReady={onReady} autoResume={!returnedHomeRef.current} />;
  if (phase === 'loading') return <HostedSplash />;
  if (phase === 'error') return <HostedError error={error} onRetry={() => setPhase('entry')} />;

  return (
    <CascadedConfigProvider cascadeEntries={studio.cascadeEntries}>
      <AssetConfigProvider assetConfigEntries={studio.assetConfigEntries}>
        <ProjectStudio project={studio.project} runtime={studio.runtime} />
      </AssetConfigProvider>
    </CascadedConfigProvider>
  );
}

/** Calm full-screen "opening your project" splash. */
function HostedSplash() {
  return (
    <div style={splashStyle} data-testid="hosted-splash">
      <div style={{ fontSize: 14, color: 'var(--lm-text-secondary, #6E6960)' }}>
        Opening your project…
      </div>
    </div>
  );
}

/**
 * Typed, actionable error screen. Permission lapses and unsupported browsers
 * get specific guidance; anything else shows the underlying message.
 *
 * @param {{ error: unknown, onRetry: () => void }} props
 */
function HostedError({ error, onRetry }) {
  let title = 'Could not open your project';
  let detail = error && error.message ? error.message : String(error);
  let retryLabel = 'Try again';

  if (error instanceof PermissionDeniedError) {
    title = 'Permission needed';
    detail = 'Lerret needs read & write access to this folder. Re-open it to continue editing.';
    retryLabel = 'Re-open folder';
  } else if (error instanceof ServiceWorkerRegistrationError) {
    title = 'This browser can’t run the hosted studio';
    detail =
      'The hosted studio needs service workers, which this browser/context blocks. Try Chrome, or run `npx @lerret/cli@latest dev` locally.';
  }

  return (
    <div style={splashStyle} data-testid="hosted-error">
      <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--lm-text-primary, #1A1714)' }}>{title}</h2>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--lm-text-secondary, #6E6960)' }}>{detail}</p>
        <div>
          <button type="button" onClick={onRetry} style={retryBtnStyle} data-testid="hosted-error-retry">
            {retryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const splashStyle = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--lm-bg-primary, #FAF8F2)',
  fontFamily: 'var(--lm-font-sans, -apple-system, system-ui, sans-serif)',
  padding: 24,
};

const retryBtnStyle = {
  border: 'none',
  borderRadius: 8,
  padding: '8px 16px',
  background: 'var(--lm-accent, #B85B33)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

export default HostedProjectSource;
