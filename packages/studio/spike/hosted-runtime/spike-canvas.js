// SPIKE — throwaway prototype. Excluded from vite build.
// Superseded by the real hosted runtime. Do not import from production code.
//
// spike-canvas.js — main thread orchestrator for the hosted-mode live-edit spike.
//
// This module runs in the browser page (spike-canvas.html). It:
// 1. Prompts the user to pick the spike fixture directory via showDirectoryPicker().
// 2. Reads the target .jsx file from the FSA directory handle.
// 3. Transforms it with Sucrase (in-browser, pure JS).
// 4. Rewrites bare `react` / `react/jsx-runtime` imports to point at the
// host page's own React (already available as ESM globals or via import map).
// 5. Registers the transformed source with the service worker.
// 6. Dynamically imports the module via the SW-served URL.
// 7. Renders the default-exported component into the artboard div.
// 8. Polls the directory handle every POLL_INTERVAL_MS for file changes
// (using the file's `lastModified` timestamp).
// 9. On change: transforms, re-registers (new URL with cache-bust), re-imports,
// re-renders. Records the save→visible-render latency.
//
// LATENCY MEASUREMENT:
// The poll loop records the file's last-known `lastModified`. When it detects
// a change, it captures `performance.now()` as `t_detect`. After the new
// component renders into the DOM, a requestAnimationFrame fires and records
// `performance.now()` as `t_render`. Latency = t_render - t_detect.
// Note: `t_detect` is AFTER the poll interval elapses, so the true save→detect
// latency includes up to POLL_INTERVAL_MS of poll lag. Both the poll-lag
// component and the transform+import component are reported separately.
//
// IMPORT MAP for bare specifiers:
// The spike-canvas.html includes an import map pointing `react` and
// `react/jsx-runtime` at CDN URLs (or Lerret's own bundled copies). The
// Sucrase transform rewrites JSX to use `react/jsx-runtime`, which the import
// map resolves. Because the SW-served module inherits the page's import map
// (Chrome 89+), bare imports work end-to-end without manual rewriting.

import { transform } from 'sucrase';
import React from 'react';
import ReactDOM from 'react-dom/client';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Poll interval in ms. Lower = more responsive but more FSA API calls. */
const POLL_INTERVAL_MS = 300;

/** Asset file path relative to the picked directory. */
const ASSET_FILE = 'SpikeCard.jsx';

/** URL prefix used for SW-served spike assets. Must match module-sw.js. */
const ASSET_PREFIX = '/spike-asset/';

// ---------------------------------------------------------------------------
// Sucrase transform options (documented for FINDINGS.md comparison)
// ---------------------------------------------------------------------------
const TRANSFORM_OPTIONS = {
 transforms: ['jsx', 'typescript'],
 jsxRuntime: 'automatic',
 production: false,
 disableESTransforms: true, // keep import/export; SW serves real ES modules
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let directoryHandle = null;
let fileHandle = null;
let lastModified = null;
let renderRoot = null;
let _swRegistration = null;
let moduleVersion = 0;
let _pollTimer = null;

// Latency trial log
const latencyTrials = [];

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
function log(msg) {
 console.log('[spike-canvas]', msg);
 const el = document.getElementById('spike-log');
 if (el) {
 el.textContent += `\n${new Date().toISOString()} ${msg}`;
 el.scrollTop = el.scrollHeight;
 }
}

function logLatency(trial) {
 latencyTrials.push(trial);
 const { total, transformMs, importMs, renderMs, pollLagMs } = trial;
 log(
 `Re-render latency: total=${total.toFixed(1)}ms ` +
 `(pollLag=${pollLagMs.toFixed(1)}, transform=${transformMs.toFixed(1)}, ` +
 `import=${importMs.toFixed(1)}, render=${renderMs.toFixed(1)})`,
 );
 updateLatencyTable();
}

function updateLatencyTable() {
 const el = document.getElementById('latency-table');
 if (!el) return;
 const rows = latencyTrials.map((t, i) =>
 `<tr>
 <td>${i + 1}</td>
 <td>${t.total.toFixed(1)}</td>
 <td>${t.pollLagMs.toFixed(1)}</td>
 <td>${t.transformMs.toFixed(1)}</td>
 <td>${t.importMs.toFixed(1)}</td>
 <td>${t.renderMs.toFixed(1)}</td>
 </tr>`,
 ).join('');
 el.innerHTML = `
 <table border="1" style="border-collapse:collapse;font-size:12px;">
 <thead><tr>
 <th>#</th><th>Total (ms)</th><th>Poll lag</th>
 <th>Transform</th><th>SW import</th><th>Render</th>
 </tr></thead>
 <tbody>${rows}</tbody>
 </table>
 ${latencyTrials.length > 0 ? summaryHtml() : ''}
 `;
}

function summaryHtml() {
 const totals = latencyTrials.map((t) => t.total).sort((a, b) => a - b);
 const median = totals[Math.floor(totals.length / 2)];
 const worst = totals[totals.length - 1];
 const budget = worst <= 1000 ? '✅ BUDGET MET (<1s)' : '❌ BUDGET NOT MET (>1s)';
 return `<p><strong>Median: ${median.toFixed(1)}ms | Worst: ${worst.toFixed(1)}ms | ${budget}</strong></p>`;
}

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------
async function registerSW() {
 if (!('serviceWorker' in navigator)) {
 throw new Error('Service workers not supported');
 }
 _swRegistration = await navigator.serviceWorker.register('./module-sw.js', {
 scope: '/spike/',
 type: 'module',
 });
 // Wait for the SW to be active
 await navigator.serviceWorker.ready;
 log('Service worker registered and active');
}

// ---------------------------------------------------------------------------
// Send module source to service worker
// ---------------------------------------------------------------------------
function postToSW(url, code) {
 const sw = navigator.serviceWorker.controller;
 if (!sw) {
 log('WARNING: no active SW controller — module not registered');
 return;
 }
 sw.postMessage({ type: 'REGISTER_MODULE', url, code });
}

// ---------------------------------------------------------------------------
// Transform JSX source with Sucrase
// ---------------------------------------------------------------------------
function transformSource(source, filePath) {
 const t0 = performance.now();
 const result = transform(source, TRANSFORM_OPTIONS);
 const transformMs = performance.now() - t0;
 return { code: result.code, transformMs };
}

// ---------------------------------------------------------------------------
// Build the SW-served URL for a given module version
// ---------------------------------------------------------------------------
function moduleUrl(version) {
 return `${ASSET_PREFIX}${ASSET_FILE}?v=${version}`;
}

// ---------------------------------------------------------------------------
// Load and render one version of the component
// ---------------------------------------------------------------------------
async function loadAndRender(source, tDetect) {
 moduleVersion += 1;
 const version = moduleVersion;
 const url = moduleUrl(version);

 // 1. Transform
 const { code, transformMs } = transformSource(source, ASSET_FILE);

 // 2. Register with SW
 postToSW(url, code);
 // Give the SW one microtask to process the message before we import
 await Promise.resolve();

 // 3. Dynamic import via SW-served URL
 const tImport0 = performance.now();
 let mod;
 try {
 mod = await import(/* @vite-ignore */ url);
 } catch (err) {
 log(`Import failed: ${err.message}`);
 return;
 }
 const importMs = performance.now() - tImport0;

 // 4. Render
 const Component = mod.default;
 if (!Component) {
 log('No default export found');
 return;
 }

 const tRender0 = performance.now();
 if (!renderRoot) {
 const container = document.getElementById('artboard');
 renderRoot = ReactDOM.createRoot(container);
 }
 renderRoot.render(React.createElement(Component));

 // 5. Measure after next frame (when render is visible)
 requestAnimationFrame(() => {
 const renderMs = performance.now() - tRender0;
 if (tDetect !== null) {
 // Poll lag is at most POLL_INTERVAL_MS — we approximate at half the interval.
 const total = performance.now() - tDetect + POLL_INTERVAL_MS / 2;
 logLatency({ total, transformMs, importMs, renderMs, pollLagMs: POLL_INTERVAL_MS / 2 });
 } else {
 log(`Initial render: transform=${transformMs.toFixed(1)}ms, import=${importMs.toFixed(1)}ms, render=${renderMs.toFixed(1)}ms`);
 }
 });
}

// ---------------------------------------------------------------------------
// Read the fixture file from the FSA handle
// ---------------------------------------------------------------------------
async function readAssetFile() {
 const file = await fileHandle.getFile();
 lastModified = file.lastModified;
 return file.text();
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------
async function pollForChanges() {
 try {
 const file = await fileHandle.getFile();
 if (file.lastModified !== lastModified) {
 const tDetect = performance.now();
 lastModified = file.lastModified;
 log(`Change detected (lastModified=${file.lastModified}) — re-rendering...`);
 const source = await file.text();
 await loadAndRender(source, tDetect);
 }
 } catch (err) {
 log(`Poll error: ${err.message}`);
 }
 _pollTimer = setTimeout(pollForChanges, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Initialise the spike
// ---------------------------------------------------------------------------
async function init() {
 log('Spike initialising...');

 // Register service worker
 try {
 await registerSW();
 } catch (err) {
 log(`SW registration failed: ${err.message} — falling back to inline blob modules`);
 // The spike will still work via inline blob (import map resolves react),
 // but relative imports within the asset won't be SW-resolved.
 }

 // Prompt for directory (requires user gesture — button click)
 document.getElementById('pick-btn').addEventListener('click', async () => {
 try {
 directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
 log(`Directory picked: ${directoryHandle.name}`);

 fileHandle = await directoryHandle.getFileHandle(ASSET_FILE);
 log(`Asset file found: ${ASSET_FILE}`);

 // Initial load
 const source = await readAssetFile();
 await loadAndRender(source, null);

 // Start polling
 _pollTimer = setTimeout(pollForChanges, POLL_INTERVAL_MS);
 log(`Polling for changes every ${POLL_INTERVAL_MS}ms...`);
 document.getElementById('status').textContent = `Watching: ${ASSET_FILE} (poll=${POLL_INTERVAL_MS}ms)`;
 } catch (err) {
 log(`Error: ${err.message}`);
 }
 });

 log('Click "Open Fixture Folder" to start the spike.');
}

// ---------------------------------------------------------------------------
// Expose latency log for console inspection
// ---------------------------------------------------------------------------
window.__spikeLatencyTrials = latencyTrials;
window.__spikeGetSummary = function () {
 if (latencyTrials.length === 0) return 'No trials yet';
 const totals = latencyTrials.map((t) => t.total).sort((a, b) => a - b);
 return {
 trials: latencyTrials.length,
 median: totals[Math.floor(totals.length / 2)].toFixed(1) + 'ms',
 worst: totals[totals.length - 1].toFixed(1) + 'ms',
 budgetMet: totals[totals.length - 1] <= 1000,
 raw: latencyTrials,
 };
};

init().catch((err) => console.error('[spike-canvas] init failed:', err));
