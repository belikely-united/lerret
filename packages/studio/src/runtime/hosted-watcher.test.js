// Tests for — Hosted watcher: directory-handle polling with
// normalized change events.
//
// jsdom does not ship the File System Access API, so we replicate the minimal
// mock from fsa-backend.test.jsx inline. The mock supports:
// - Mutable in-memory trees (Map<string, Uint8Array | Map>) so tests can
// add/remove/modify files between poll cycles.
// - File handles whose getFile() returns configurable lastModified + size.
// - Controllable permission states for the permission-lapse test.
//
// The poll interval is overridden to 1 ms in every test via
// options: { pollInterval: 1 }
// so we never wait for the 300 ms default in automated runs.
//
// Concurrency discipline: we `await watcher.ready` before mutating the tree
// to ensure the initial snapshot has been built, then wait one poll cycle
// (via a small `settle()` helper) for detection.

import { describe, it, expect, afterEach } from 'vitest';
import {
 startHostedWatcher,
 DEFAULT_POLL_INTERVAL_MS,
 createFsaBackendWithWatcher,
} from './hosted-watcher.js';
import { PermissionDeniedError } from '../fs/fsa-backend.js';

// ---------------------------------------------------------------------------
// Minimal File System Access API mock
// ---------------------------------------------------------------------------
//
// Tree shape: Map<string, FileNode | Map>
// - FileNode: { bytes: Uint8Array, lastModified: number }
// - Map — a directory
//
// We track `lastModified` explicitly per-file so tests can bump it.

/**
 * @typedef {{ bytes: Uint8Array, lastModified: number }} FileNode
 * @typedef {Map<string, FileNode | Map>} TreeDir
 */

const enc = new TextEncoder();

/** Encode a string as a Uint8Array. */
function encode(str) {
 return new Uint8Array(enc.encode(str));
}

/**
 * Create an in-memory tree node representing a file.
 *
 * @param {string} [content]
 * @param {number} [lastModified]
 * @returns {FileNode}
 */
function makeFileNode(content = '', lastModified = 1_000_000) {
 return { bytes: encode(content), lastModified };
}

/**
 * Build a mutable in-memory tree. String values become FileNodes;
 * object values become sub-Maps.
 *
 * @param {Record<string, string | Record<string, unknown>>} spec
 * @returns {TreeDir}
 */
function makeTree(spec) {
 const dir = new Map();
 for (const [key, value] of Object.entries(spec)) {
 if (typeof value === 'string') {
 dir.set(key, makeFileNode(value));
 } else {
 dir.set(key, makeTree(/** @type {any} */ (value)));
 }
 }
 return dir;
}

// ---------------------------------------------------------------------------
// Mock FileSystemDirectoryHandle (thin, mutable)
// ---------------------------------------------------------------------------

/**
 * Wrap an in-memory tree as a `FileSystemDirectoryHandle`.
 *
 * @param {TreeDir} tree
 * @param {{ permError?: boolean }} [opts]
 * When `permError` is true, `entries()` throws a DOMException (simulating
 * a permission lapse).
 */
function makeMockDirHandle(tree, opts = {}) {
 const handle = {
 kind: 'directory',

 async *entries() {
 if (opts.permError) {
 throw new DOMException('Permission denied', 'NotAllowedError');
 }
 for (const [name, node] of tree.entries()) {
 if (node instanceof Map) {
 yield [name, makeMockDirHandle(node, opts)];
 } else {
 yield [name, makeMockFileHandle(tree, name)];
 }
 }
 },

 async getDirectoryHandle(name, { create = false } = {}) {
 if (!tree.has(name)) {
 if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
 tree.set(name, new Map());
 }
 const node = tree.get(name);
 if (!(node instanceof Map)) {
 throw new DOMException(`${name} is not a directory`, 'TypeMismatchError');
 }
 return makeMockDirHandle(node, opts);
 },

 async getFileHandle(name, { create = false } = {}) {
 if (!tree.has(name)) {
 if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
 tree.set(name, makeFileNode(''));
 }
 const node = tree.get(name);
 if (node instanceof Map) {
 throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
 }
 return makeMockFileHandle(tree, name);
 },

 async queryPermission() { return opts.permError ? 'denied' : 'granted'; },
 async requestPermission() { return opts.permError ? 'denied' : 'granted'; },
 };

 return handle;
}

/**
 * @param {TreeDir} parentTree
 * @param {string} name
 */
function makeMockFileHandle(parentTree, name) {
 return {
 kind: 'file',
 name,
 async getFile() {
 const node = parentTree.get(name);
 if (!node || node instanceof Map) {
 throw new DOMException(`File not found: ${name}`, 'NotFoundError');
 }
 return {
 lastModified: node.lastModified,
 size: node.bytes.byteLength,
 async text() { return new TextDecoder().decode(node.bytes); },
 };
 },
 };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Wait for at least `n` poll cycles at `pollInterval` ms.
 * We add a small grace buffer so timers fire reliably in Vitest.
 *
 * @param {number} n Number of cycles.
 * @param {number} pollInterval Poll interval used by the watcher.
 */
function settle(n = 2, pollInterval = 1) {
 return new Promise((resolve) =>
 setTimeout(resolve, pollInterval * n + 20),
 );
}

// Track all handles returned by startHostedWatcher so afterEach can close them.
const handles = [];

afterEach(async () => {
 // Close any handles left open by a test (cleanup on failure paths).
 for (const h of handles) {
 await h.close().catch(() => {});
 }
 handles.length = 0;
});

/** Convenience: startHostedWatcher + register for cleanup. */
function startWatcher(opts) {
 const h = startHostedWatcher(opts);
 handles.push(h);
 return h;
}

// ---------------------------------------------------------------------------
// Default poll interval constant
// ---------------------------------------------------------------------------

describe('DEFAULT_POLL_INTERVAL_MS', () => {
 it('is 300 ms, matching the spike recommendation', () => {
 expect(DEFAULT_POLL_INTERVAL_MS).toBe(300);
 });
});

// ---------------------------------------------------------------------------
// Startup — no events for the initial snapshot
// ---------------------------------------------------------------------------

describe('initial snapshot — no add events at startup', () => {
 it('emits no events for files that existed before the watcher started', async () => {
 const tree = makeTree({
 'config.json': '{ "v": 1 }',
 components: {
 'Button.jsx': 'export default () => null;',
 },
 });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 await settle(2);

 expect(events).toHaveLength(0);
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// File additions
// ---------------------------------------------------------------------------

describe('file added between polls → add event', () => {
 it('emits a normalized add event with the correct path', async () => {
 const tree = makeTree({ 'existing.jsx': 'x' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Add a new file after the baseline snapshot.
 tree.set('new-file.jsx', makeFileNode('export default () => null;'));

 await settle(2);

 const addEvents = events.filter((e) => e.type === 'add');
 expect(addEvents).toHaveLength(1);
 expect(addEvents[0].path).toBe('new-file.jsx');
 await watcher.close();
 });

 it('emits the add event with a forward-slash path (no backslashes)', async () => {
 const tree = makeTree({ home: {} });
 // Access the 'home' entry as a Map.
 const homeDir = tree.get('home');

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 homeDir.set('Hero.jsx', makeFileNode('export default () => <div/>;'));

 await settle(2);

 const addEvents = events.filter((e) => e.type === 'add');
 expect(addEvents.length).toBeGreaterThan(0);
 for (const e of addEvents) {
 expect(e.path).not.toContain('\\');
 }
 await watcher.close();
 });

 it('path is relative to the root handle (no leading slash)', async () => {
 const tree = makeTree({});

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 tree.set('Artboard.jsx', makeFileNode('1'));

 await settle(2);

 expect(events[0].path).toBe('Artboard.jsx');
 expect(events[0].path.startsWith('/')).toBe(false);
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// File modifications
// ---------------------------------------------------------------------------

describe('file modified (lastModified bumped) → change event', () => {
 it('emits a change event when lastModified increases', async () => {
 const tree = makeTree({ 'Button.jsx': 'v1' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Simulate a save: bump lastModified.
 const node = tree.get('Button.jsx');
 node.lastModified += 1000;
 node.bytes = encode('v2');

 await settle(2);

 const changeEvents = events.filter((e) => e.type === 'change');
 expect(changeEvents).toHaveLength(1);
 expect(changeEvents[0].path).toBe('Button.jsx');
 await watcher.close();
 });

 it('emits a change event when only size changes (lastModified unchanged)', async () => {
 const tree = makeTree({ 'data.json': '{}' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Some FSes do not update mtime on writes (or the resolution is 1 s).
 // Size change alone is enough.
 const node = tree.get('data.json');
 node.bytes = encode('{ "key": "value" }');
 // lastModified intentionally NOT changed.

 await settle(2);

 const changeEvents = events.filter((e) => e.type === 'change');
 expect(changeEvents).toHaveLength(1);
 expect(changeEvents[0].path).toBe('data.json');
 await watcher.close();
 });

 it('does NOT emit a change event when nothing changed', async () => {
 const tree = makeTree({ 'unchanged.jsx': 'same' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 await settle(3); // run several cycles without any mutation

 expect(events.filter((e) => e.type === 'change')).toHaveLength(0);
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// File removals
// ---------------------------------------------------------------------------

describe('file removed → remove event', () => {
 it('emits a remove event when a file is deleted', async () => {
 const tree = makeTree({ 'Hero.jsx': 'x', 'Other.jsx': 'y' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 tree.delete('Hero.jsx');

 await settle(2);

 const removeEvents = events.filter((e) => e.type === 'remove');
 expect(removeEvents).toHaveLength(1);
 expect(removeEvents[0].path).toBe('Hero.jsx');
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// Directory additions
// ---------------------------------------------------------------------------

describe('new subdirectory added → add event', () => {
 it('emits an add event for a new directory', async () => {
 const tree = makeTree({});

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Add an empty subdirectory.
 tree.set('landing', new Map());

 await settle(2);

 const addEvents = events.filter((e) => e.type === 'add');
 expect(addEvents).toHaveLength(1);
 expect(addEvents[0].path).toBe('landing');
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// Directory removals — cascading remove events
// ---------------------------------------------------------------------------

describe('subdirectory removed (with files inside) → remove events for files AND the directory', () => {
 it('emits remove events for the directory itself and all nested files', async () => {
 const tree = makeTree({
 home: {
 'Hero.jsx': 'x',
 'Cta.jsx': 'y',
 },
 about: {
 'About.jsx': 'z',
 },
 });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Remove the 'home' directory entirely.
 tree.delete('home');

 await settle(2);

 const removals = events.filter((e) => e.type === 'remove').map((e) => e.path);
 // We expect the directory AND both files to have remove events.
 expect(removals).toContain('home');
 expect(removals).toContain('home/Hero.jsx');
 expect(removals).toContain('home/Cta.jsx');
 await watcher.close();
 });

 it('remove events within a removed directory are sorted alphabetically', async () => {
 const tree = makeTree({
 page: {
 'Z-last.jsx': 'z',
 'A-first.jsx': 'a',
 'M-middle.jsx': 'm',
 },
 });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 tree.delete('page');

 await settle(2);

 const removals = events.filter((e) => e.type === 'remove').map((e) => e.path);
 // All removed paths should be in alphabetical order (as emitted by diffSnapshots).
 const sorted = [...removals].sort();
 expect(removals).toEqual(sorted);
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// close() — clean teardown
// ---------------------------------------------------------------------------

describe('close() cancels the poll cleanly', () => {
 it('no events are emitted after close()', async () => {
 const tree = makeTree({ 'file.jsx': 'v1' });

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 await watcher.close();

 const countAtClose = events.length;

 // Mutate the tree after close — no events should fire.
 tree.set('new.jsx', makeFileNode('added after close'));
 const node = tree.get('file.jsx');
 node.lastModified += 500;

 await settle(5);

 expect(events.length).toBe(countAtClose);
 });

 it('close() is idempotent — calling it multiple times does not throw', async () => {
 const tree = makeTree({});
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: () => {},
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 await expect(
 (async () => {
 await watcher.close();
 await watcher.close();
 await watcher.close();
 })(),
 ).resolves.not.toThrow();
 });
});

// ---------------------------------------------------------------------------
// Permission lapse
// ---------------------------------------------------------------------------

describe('permission lapse mid-poll → onError called once, loop stops', () => {
 it('calls onError once and stops polling on a DOMException from entries()', async () => {
 const tree = makeTree({ 'ok.jsx': 'x' });
 let permError = false;

 // We need a handle that starts healthy, then starts throwing.
 // Use a mutable flag that the mock reads.
 const handle = {
 kind: 'directory',
 async *entries() {
 if (permError) {
 throw new DOMException('Not allowed', 'NotAllowedError');
 }
 for (const [name, node] of tree.entries()) {
 if (node instanceof Map) {
 yield [name, makeMockDirHandle(node)];
 } else {
 yield [name, makeMockFileHandle(tree, name)];
 }
 }
 },
 async queryPermission() { return permError ? 'denied' : 'granted'; },
 async requestPermission() { return permError ? 'denied' : 'granted'; },
 };

 const errors = [];
 const events = [];

 const watcher = startWatcher({
 rootHandle: handle,
 onEvent: (e) => events.push(e),
 onError: (err) => errors.push(err),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 // Trigger permission lapse.
 permError = true;

 await settle(5); // Wait several cycles to confirm it doesn't keep firing.

 expect(errors).toHaveLength(1);
 expect(errors[0]).toBeInstanceOf(DOMException);

 // No events after the lapse.
 const countAtLapse = events.length;
 await settle(3);
 expect(events.length).toBe(countAtLapse);

 handles.splice(handles.indexOf(watcher), 1); // Already internally closed.
 });

 it('calls onError once on a PermissionDeniedError', async () => {
 const tree = makeTree({});
 let fail = false;

 const handle = {
 kind: 'directory',
 async *entries() {
 if (fail) throw new PermissionDeniedError('Lapsed');
 for (const [name, node] of tree.entries()) {
 if (node instanceof Map) {
 yield [name, makeMockDirHandle(node)];
 } else {
 yield [name, makeMockFileHandle(tree, name)];
 }
 }
 },
 async queryPermission() { return 'granted'; },
 async requestPermission() { return 'granted'; },
 };

 const errors = [];
 const watcher = startWatcher({
 rootHandle: handle,
 onEvent: () => {},
 onError: (err) => errors.push(err),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 fail = true;

 await settle(5);

 expect(errors).toHaveLength(1);
 expect(errors[0]).toBeInstanceOf(PermissionDeniedError);

 handles.splice(handles.indexOf(watcher), 1);
 });
});

// ---------------------------------------------------------------------------
// Performance — poll cycle over ~100 entries
// ---------------------------------------------------------------------------

describe('performance — poll cycle over ~100 mock entries', () => {
 it('completes a poll cycle over 100 files in well under 100 ms', async () => {
 // Build a tree with ~100 files spread across a few directories.
 const specPages = {};
 const filesPerPage = 20;
 const pageCount = 5;
 for (let p = 0; p < pageCount; p++) {
 const page = {};
 for (let f = 0; f < filesPerPage; f++) {
 page[`Component${f}.jsx`] = `export default () => null; // file ${f} in page ${p}`;
 }
 specPages[`page${p}`] = page;
 }
 const tree = makeTree(specPages);
 const rootHandle = makeMockDirHandle(tree);

 const events = [];
 const watcher = startWatcher({
 rootHandle,
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 // Measure: time from watcher start to ready (the initial walk).
 const t0 = performance.now();
 await watcher.ready;
 const elapsed = performance.now() - t0;

 // 100 entries should complete well under 100 ms even in jsdom.
 expect(elapsed).toBeLessThan(100);

 // Also verify no spurious events fired for the initial snapshot.
 expect(events).toHaveLength(0);

 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// startHostedWatcher — argument validation
// ---------------------------------------------------------------------------

describe('startHostedWatcher — argument validation', () => {
 it('throws TypeError when rootHandle is missing', () => {
 expect(() =>
 startHostedWatcher({ rootHandle: null, onEvent: () => {} }),
 ).toThrow(TypeError);
 });

 it('throws TypeError when onEvent is not a function', () => {
 const handle = makeMockDirHandle(makeTree({}));
 expect(() =>
 startHostedWatcher({ rootHandle: handle, onEvent: 'not-a-function' }),
 ).toThrow(TypeError);
 });
});

// ---------------------------------------------------------------------------
// createFsaBackendWithWatcher — capabilities.canWatch = true
// ---------------------------------------------------------------------------

describe('createFsaBackendWithWatcher — capabilities.canWatch is true', () => {
 it('returns a backend with canWatch: true', async () => {
 const tree = makeTree({});
 const rootHandle = makeMockDirHandle(tree);

 const { backend, watcher } = createFsaBackendWithWatcher(rootHandle, {
 onEvent: () => {},
 options: { pollInterval: 1 },
 });

 expect(backend.capabilities.canWatch).toBe(true);
 await watcher.ready;
 await watcher.close();
 });

 it('capabilities are frozen', async () => {
 const tree = makeTree({});
 const rootHandle = makeMockDirHandle(tree);

 const { backend, watcher } = createFsaBackendWithWatcher(rootHandle, {
 onEvent: () => {},
 options: { pollInterval: 1 },
 });

 expect(Object.isFrozen(backend.capabilities)).toBe(true);
 await watcher.ready;
 await watcher.close();
 });

 it('base backend capabilities (canWrite, canReveal) are preserved', async () => {
 const tree = makeTree({});
 const rootHandle = makeMockDirHandle(tree);

 const { backend, watcher } = createFsaBackendWithWatcher(rootHandle, {
 onEvent: () => {},
 options: { pollInterval: 1 },
 });

 expect(backend.capabilities.canWrite).toBe(true);
 expect(backend.capabilities.canReveal).toBe(false);
 await watcher.ready;
 await watcher.close();
 });

 it('watcher emits events for mutations', async () => {
 const tree = makeTree({ 'existing.jsx': 'v1' });
 const rootHandle = makeMockDirHandle(tree);

 const events = [];
 const { watcher } = createFsaBackendWithWatcher(rootHandle, {
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 tree.set('new.jsx', makeFileNode('export default () => null;'));

 await settle(2);

 expect(events.some((e) => e.type === 'add' && e.path === 'new.jsx')).toBe(true);
 await watcher.close();
 });
});

// ---------------------------------------------------------------------------
// Nested file paths are normalized (forward slash)
// ---------------------------------------------------------------------------

describe('nested paths use forward-slash LerretPath format', () => {
 it('add event for a nested file has a forward-slash path', async () => {
 const tree = makeTree({ home: {} });
 const homeDir = tree.get('home');

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;
 homeDir.set('Banner.jsx', makeFileNode('export default () => <div/>;'));

 await settle(2);

 const addEvent = events.find((e) => e.type === 'add' && e.path.includes('Banner'));
 expect(addEvent).toBeDefined();
 expect(addEvent.path).toBe('home/Banner.jsx');
 await watcher.close();
 });

 it('change event for a nested file has a forward-slash path', async () => {
 const tree = makeTree({ home: { 'Cta.jsx': 'v1' } });
 const homeDir = tree.get('home');

 const events = [];
 const watcher = startWatcher({
 rootHandle: makeMockDirHandle(tree),
 onEvent: (e) => events.push(e),
 options: { pollInterval: 1 },
 });

 await watcher.ready;

 const node = homeDir.get('Cta.jsx');
 node.lastModified += 1000;

 await settle(2);

 const changeEvent = events.find((e) => e.type === 'change' && e.path.includes('Cta'));
 expect(changeEvent).toBeDefined();
 expect(changeEvent.path).toBe('home/Cta.jsx');
 await watcher.close();
 });
});
