// embed-main.jsx — the studio as an MCP App inside Claude / ChatGPT
// (plan-mcp-app-studio.md). The fourth studio mode, built as ONE self-contained
// HTML file (`vite.embed.config.js`) that `@lerret/cli mcp` serves as its
// `ui://` resource.
//
// Project files come from the MCP server (`lerret_files`, paged under the
// host's result cap) into an in-memory backend; the hosted runtime renders
// them with an inline-script module loader (no service worker in the chat
// sandbox). Writes from the studio go back through `lerret_write`; edits
// Claude makes are picked up by polling `lerret_version`.

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@modelcontextprotocol/ext-apps/app-with-deps';

import '../styles/styles.css';

import { ProjectStudio } from '../project-studio.jsx';
import { CascadedConfigProvider } from '../components/canvas/cascade-context.jsx';
import { AssetConfigProvider } from '../components/canvas/asset-config-context.jsx';
import { createMemoryBackend } from '../fs/memory-backend.js';
import { createHostedWriter } from '../fs/hosted-writer.js';
import { setHostedWriter } from '../runtime/write-client.js';
import { createHostedDataReader, setHostedDataReader } from '../runtime/hosted-data-reader.js';
import { loadHostedProject } from '../runtime/hosted-loader.js';
import { createHostedRuntime } from '../runtime/sucrase-runtime.js';

import { createModuleStore, createInlineImporter } from './inline-loader.js';
import { createEmbedBridge, createSyncedBackend } from './embed-bridge.js';
import { startImageResolver, registerFonts } from './embed-media.js';
// The studio's own logo lives in public/ (not in this one-file build): map it to a small inlined copy.
import logoUrl from '../../public/lerret-logo-192.png';

const UI_IMAGES = { '/assets/lerret-logo.png': logoUrl };

/** Inline height in the chat (the Claude directory asks for ≤ 500px). */
const INLINE_HEIGHT = 500;
/** How often an open, visible app checks for Claude's edits: fast after a change, slower when idle. */
const POLL_MS = 1500;
const POLL_IDLE_MS = 6000;
let lastActivity = Date.now();
addEventListener('pointerdown', () => (lastActivity = Date.now()), true);

// Claude shows `fullscreen` in its side panel where it can, beside the chat.
const app = new App(
  { name: 'Lerret', version: '1' },
  { availableDisplayModes: ['inline', 'fullscreen'], tools: { listChanged: true } },
  { autoResize: false },
);
/** The project currently shown (for app tools). */
let currentProject = null;

// App tool: Claude can move the open studio to a page ("show me the social page").
app.onlisttools = async () => ({
  tools: [
    {
      name: 'show_page',
      title: 'Show a page in the studio',
      description: 'Switch the open Lerret studio to a page of the project, by folder name (e.g. "social").',
      inputSchema: { type: 'object', properties: { page: { type: 'string' } }, required: ['page'] },
    },
  ],
});
app.oncalltool = async ({ name, arguments: args = {} }) => {
  if (name !== 'show_page') return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}` }] };
  const pages = currentProject?.pages || [];
  const want = String(args.page || '').toLowerCase();
  const page = pages.find((p) => p.path.toLowerCase() === want || p.name?.toLowerCase() === want || p.path.toLowerCase().endsWith(`/${want}`));
  if (!page) return { isError: true, content: [{ type: 'text', text: `No page "${args.page}". Pages: ${pages.map((p) => p.name || p.path).join(', ')}` }] };
  location.hash = `#${page.path}`;
  return { content: [{ type: 'text', text: `Showing ${page.name || page.path}.` }] };
};
// The folder this studio's own lerret_open returned. Wait briefly for it; an
// older server (or a host that sends no result) falls back to its default.
let gotFolder;
const folderReady = new Promise((r) => (gotFolder = r));
app.addEventListener('toolresult', (res) => gotFolder(res?.structuredContent?.folder));
setTimeout(() => gotFolder(undefined), 3000);
const bridge = createEmbedBridge(app, () => folderReady);

/** Path → content of every project file the app holds (images, fonts, diffing). */
const files = new Map();
/** Binary path → size:mtime, for every binary the server sent without content. */
const sigs = new Map();
/** Binaries not fetched yet (an empty placeholder sits in `files` and memory). */
const unloaded = new Set();
const fetching = new Map();
let memoryRef = null;

/** A binary's bytes, fetched from the server the first time it's read. */
function ensureLoaded(path) {
  if (!unloaded.has(path)) return Promise.resolve(files.get(path));
  if (!fetching.has(path)) {
    const sig = sigs.get(path);
    const job = bridge.loadBlob(path).then(async (bytes) => {
      // Changed again while fetching: leave it for the next read.
      if (sigs.get(path) === sig && unloaded.has(path)) {
        unloaded.delete(path);
        files.set(path, bytes);
        await memoryRef.writeFile(path, bytes);
      }
      return bytes;
    });
    fetching.set(path, job);
    job.finally(() => fetching.delete(path)).catch(() => {});
  }
  return fetching.get(path);
}

/** Record binaries sent without content; true when `path` is new or changed. */
function markLazy(path, sig) {
  if (sigs.get(path) === sig) return false;
  sigs.set(path, sig);
  unloaded.add(path);
  files.set(path, EMPTY);
  return true;
}
const EMPTY = new Uint8Array(0);

// ── Host integration ────────────────────────────────────────────────────────

/** Fit the iframe: fixed inline height, the host's full size otherwise. */
function applyLayout(ctx) {
  const mode = ctx?.displayMode || 'inline';
  const dims = ctx?.containerDimensions || {};
  const height = mode === 'inline' ? INLINE_HEIGHT : dims.height || dims.maxHeight || window.innerHeight;
  document.documentElement.style.height = `${height}px`;
  document.documentElement.dataset.displayMode = mode;
  app.sendSizeChanged({ height }).catch(() => {});
  if (ctx?.theme) document.documentElement.dataset.hostTheme = ctx.theme;
  renderModeButtons(ctx);
}

/** Small fullscreen / picture-in-picture switches, when the host offers them. */
function renderModeButtons(ctx) {
  let bar = document.getElementById('lerret-embed-modes');
  const modes = ctx?.availableDisplayModes || [];
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'lerret-embed-modes';
    bar.style.cssText =
      'position:fixed;right:10px;bottom:10px;z-index:2147483000;display:flex;gap:6px;font:500 12px system-ui';
    document.body.appendChild(bar);
  }
  bar.replaceChildren();
  const current = ctx?.displayMode || 'inline';
  const add = (mode, label) => {
    if (!modes.includes(mode) || mode === current) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      'border:1px solid rgba(0,0,0,.12);background:#fff;color:#111;border-radius:999px;padding:6px 12px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.12)';
    b.onclick = () => app.requestDisplayMode({ mode }).catch(() => {});
    bar.appendChild(b);
  };
  add('fullscreen', 'Open studio');
  add('inline', 'Back to chat');
}

/** Tell the model which artboard the user is looking at ("make this bolder"). */
function reportSelection() {
  let last = '';
  let timer = null;
  document.addEventListener(
    'pointerdown',
    (e) => {
      const slot = e.target.closest?.('[data-dc-slot]');
      if (!slot) return;
      const id = slot.getAttribute('data-dc-slot');
      const asset = slot.querySelector('[data-asset-id]')?.getAttribute('data-asset-id');
      const text = `In the Lerret studio the user selected the artboard "${id}"${asset ? ` (asset ${asset})` : ''}. "This" or "it" most likely means this artboard.`;
      if (text === last) return;
      last = text;
      clearTimeout(timer);
      timer = setTimeout(() => app.updateModelContext({ content: [{ type: 'text', text }] }).catch(() => {}), 300);
    },
    true,
  );
}

/** Downloads and outbound links must go through the host (sandbox blocks both). */
function routeDownloadsAndLinks() {
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj) => {
    const url = create(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  const toBase64 = async (href) => {
    if (href.startsWith('data:')) return { mime: href.slice(5, href.indexOf(';')), b64: href.slice(href.indexOf(',') + 1) };
    const blob = blobs.get(href);
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { mime: blob.type || 'application/octet-stream', b64: btoa(bin) };
  };
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (!this.hasAttribute('download')) return nativeClick.call(this);
    const name = this.getAttribute('download') || 'lerret-export';
    toBase64(this.href).then((file) => {
      if (!file) return nativeClick.call(this);
      app
        .downloadFile({ contents: [{ type: 'resource', resource: { uri: `file:///${encodeURIComponent(name)}`, mimeType: file.mime, blob: file.b64 } }] })
        .catch(() => nativeClick.call(this)); // host without downloads: try the browser's own
    });
  };
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest?.('a[href^="http"]');
      if (!a) return;
      e.preventDefault();
      app.openLink({ url: a.href }).catch(() => {});
    },
    true,
  );
}

// ── Studio ──────────────────────────────────────────────────────────────────

function EmbedStudio() {
  const [state, setState] = React.useState({ phase: 'loading' });
  const ref = React.useRef({});

  React.useEffect(() => {
    let alive = true;
    let pollTimer = null;
    let stopImages = () => {};
    let faces = [];

    async function boot() {
      const { files: seed, lazy, version } = await bridge.loadFiles();
      for (const [p, c] of Object.entries(seed)) files.set(p, c);
      for (const [p, sig] of Object.entries(lazy)) markLazy(p, sig);
      const memory = createMemoryBackend(Object.fromEntries(files));
      memoryRef = memory;
      const fs = createSyncedBackend(
        memory,
        bridge,
        (path, data) => {
          unloaded.delete(path);
          if (data == null) files.delete(path);
          else files.set(path, data);
        },
        ensureLoaded,
      );
      const store = createModuleStore();
      let project = null;
      const importModule = createInlineImporter({
        store,
        fs,
        projectRoot: () => (project && project.path) || '.lerret',
        loadMermaid: () => import('../runtime/mermaid-instance.js'),
      });
      const loaded = await loadHostedProject(fs);
      project = loaded.project;
      const runtime = createHostedRuntime(project, { fs, sw: store, importModule });
      setHostedWriter(createHostedWriter(fs));
      setHostedDataReader(createHostedDataReader(fs, { loadDataModule: runtime.loadDataModule }));
      faces = await registerFonts(files);
      stopImages = startImageResolver(() => files, document.body, UI_IMAGES, ensureLoaded);
      Object.assign(ref.current, { memory, fs, runtime, version, setProject: (p) => (project = p) });
      currentProject = loaded.project;
      if (alive) setState({ phase: 'ready', runtime, ...loaded });
      schedulePoll();
    }

    /** Pick up edits made outside the app (Claude's lerret_write, the editor). */
    async function poll() {
      const r = ref.current;
      try {
        if (document.visibilityState !== 'visible') return;
        const version = await bridge.version();
        if (version === r.version) return;
        r.version = version;
        const { files: next, lazy } = await bridge.loadFiles();
        const changed = [];
        for (const [path, content] of Object.entries(next)) {
          if (!sameContent(files.get(path), content)) {
            changed.push(path);
            files.set(path, content);
            await r.memory.writeFile(path, content);
          }
        }
        for (const [path, sig] of Object.entries(lazy)) {
          if (markLazy(path, sig)) {
            changed.push(path);
            await r.memory.writeFile(path, EMPTY);
          }
        }
        for (const path of [...files.keys()]) {
          if (!(path in next) && !(path in lazy)) {
            changed.push(path);
            files.delete(path);
            sigs.delete(path);
            unloaded.delete(path);
            await r.memory.deleteFile(path).catch(() => {});
          }
        }
        if (changed.length === 0) return;
        lastActivity = Date.now();
        for (const path of changed) r.runtime.notifyChange(path);
        if (changed.some((p) => p.includes('/_fonts/'))) faces = await registerFonts(files, faces);
        stopImages();
        stopImages = startImageResolver(() => files, document.body, UI_IMAGES, ensureLoaded);
        const loaded = await loadHostedProject(r.fs);
        r.setProject(loaded.project);
        currentProject = loaded.project;
        if (alive) setState((s) => ({ ...s, ...loaded }));
      } catch (err) {
        console.warn('[lerret] refresh failed', err);
      } finally {
        schedulePoll();
      }
    }
    function schedulePoll() {
      // ponytail: fixed back-off; an MCP resource-subscription push would replace polling where hosts support it.
      if (alive) pollTimer = setTimeout(poll, Date.now() - lastActivity > 60_000 ? POLL_IDLE_MS : POLL_MS);
    }

    boot().catch((error) => alive && setState({ phase: 'error', error }));
    return () => {
      alive = false;
      clearTimeout(pollTimer);
      stopImages();
    };
  }, []);

  if (state.phase === 'loading') return <Notice text="Opening your Lerret project…" />;
  if (state.phase === 'error') return <Notice text={`Couldn't open the project: ${state.error?.message || state.error}`} />;
  return (
    <CascadedConfigProvider cascadeEntries={state.cascadeEntries}>
      <AssetConfigProvider assetConfigEntries={state.assetConfigEntries}>
        <ProjectStudio project={state.project} runtime={state.runtime} />
      </AssetConfigProvider>
    </CascadedConfigProvider>
  );
}

function sameContent(a, b) {
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return a === b;
}

function Notice({ text }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', font: '14px system-ui', color: '#6B6B6B', padding: 24, textAlign: 'center' }}>
      {text}
    </div>
  );
}

// ── Boot ────────────────────────────────────────────────────────────────────

routeDownloadsAndLinks();
reportSelection();
app.onhostcontextchanged = (ctx) => applyLayout({ ...app.getHostContext(), ...ctx });
app
  .connect()
  .then(() => {
    applyLayout(app.getHostContext());
    createRoot(document.getElementById('root')).render(<EmbedStudio />);
  })
  .catch((err) => {
    document.getElementById('root').textContent = `Lerret couldn't connect to the chat: ${err?.message || err}`;
  });
