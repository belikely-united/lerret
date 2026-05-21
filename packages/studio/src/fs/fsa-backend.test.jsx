// Tests for — File System Access API filesystem backend.
//
// Because jsdom does not ship the File System Access API, we build a minimal
// in-memory mock that supports the exact surface our backend uses:
//
// FileSystemDirectoryHandle — entries(), getDirectoryHandle(), getFileHandle(),
// queryPermission(), requestPermission()
// FileSystemFileHandle — getFile(), createWritable()
// FileSystemWritableFileStream — write(), close(), abort()
// File (Web API) — text(), arrayBuffer()
//
// The mock is self-contained in this file so can import and extend
// it when it builds the full directory-handle polling implementation.
//
// ARCHITECTURE NOTE: all File System Access API calls live exclusively in
// fsa-backend.js — this test file constructs mock handles but never calls
// window.showDirectoryPicker or touches any real FSA API.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFilesystemAccess, assertFilesystemContract } from '@lerret/core';
import { createFsaBackend, PermissionDeniedError } from './fsa-backend.js';

// ---------------------------------------------------------------------------
// In-memory File System Access API mock
// ---------------------------------------------------------------------------
//
// Each node in the in-memory tree is either:
// - a Map<string, TreeNode> — a directory
// - a Uint8Array — a file's raw bytes
//
// Helper factories below wrap tree nodes in the FSA handle objects the backend
// expects. The mock is intentionally minimal — just enough surface for the
// backend to operate.

/**
 * @typedef {{ [name: string]: Uint8Array | TreeDir }} TreeDir
 */

// Encode a string to a Uint8Array (UTF-8).
// IMPORTANT: jsdom's TextEncoder.encode() returns a Uint8Array from the jsdom
// realm, which fails `instanceof Uint8Array` checks in the Node/Vitest realm.
// We wrap with `new Uint8Array(...)` to copy the bytes into the test realm's
// Uint8Array constructor — safe cross-realm construction.
const enc = new TextEncoder();

/** Encode a string as a test-realm Uint8Array. */
function encode(str) {
 return new Uint8Array(enc.encode(str));
}

/**
 * Build an in-memory tree from a plain-object description.
 *
 * ```js
 * makeTree({
 * 'config.json': '{ "v": 1 }',
 * components: { 'Button.jsx': 'export default 1;' },
 * })
 * ```
 *
 * String leaves are UTF-8-encoded into a Uint8Array.
 *
 * @param {Record<string, string | Record<string, unknown>>} spec
 * @returns {Map<string, Uint8Array | Map<string, unknown>>}
 */
function makeTree(spec) {
 const dir = new Map();
 for (const [key, value] of Object.entries(spec)) {
 if (typeof value === 'string') {
 dir.set(key, encode(value));
 } else {
 dir.set(key, makeTree(value));
 }
 }
 return dir;
}

// ---------------------------------------------------------------------------
// Mock FileSystemWritableFileStream
// ---------------------------------------------------------------------------

/**
 * A minimal writable stream that accumulates data and commits on close().
 * An optional `rejectOnWrite` promise causes `write()` to reject (NFR9 test).
 *
 * @param {Map<string, Uint8Array | Map>} parentDir The parent directory map.
 * @param {string} fileName
 * @param {{ rejectOnWrite?: Error }} [opts]
 */
function makeMockWritable(parentDir, fileName, opts = {}) {
 const chunks = [];
 let aborted = false;

 return {
 async write(data) {
 if (opts.rejectOnWrite) throw opts.rejectOnWrite;
 if (typeof data === 'string') {
 // Use encode() to produce a test-realm Uint8Array (jsdom's
 // TextEncoder.encode() returns a cross-realm Uint8Array that
 // can fail instanceof checks — see the encode() helper above).
 chunks.push(encode(data));
 } else if (ArrayBuffer.isView(data)) {
 // Accept any typed array view (Uint8Array from either realm).
 chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
 } else {
 throw new TypeError('MockWritable: unsupported data type');
 }
 },
 async close() {
 if (aborted) return;
 // Merge chunks into a single Uint8Array and commit to the parent map.
 const total = chunks.reduce((s, c) => s + c.byteLength, 0);
 const out = new Uint8Array(total);
 let offset = 0;
 for (const chunk of chunks) {
 out.set(chunk, offset);
 offset += chunk.byteLength;
 }
 parentDir.set(fileName, out);
 },
 async abort() {
 aborted = true;
 // Do NOT write anything — the original file in parentDir is untouched.
 },
 };
}

// ---------------------------------------------------------------------------
// Mock FileSystemFileHandle
// ---------------------------------------------------------------------------

/**
 * @param {Map<string, Uint8Array | Map>} parentDir
 * @param {string} name
 * @param {{ rejectOnWrite?: Error }} [writableOpts]
 */
function makeMockFileHandle(parentDir, name, writableOpts = {}) {
 return {
 kind: 'file',
 name,
 async getFile() {
 const bytes = parentDir.get(name);
 // Use ArrayBuffer.isView() instead of `instanceof Uint8Array` to avoid
 // cross-realm false-negatives in the jsdom test environment (TextEncoder
 // from the module realm produces a Uint8Array that is not `instanceof`
 // the test realm's Uint8Array constructor, even though they are the same
 // type logically).
 if (!ArrayBuffer.isView(bytes)) {
 throw new DOMException(`File not found: ${name}`, 'NotFoundError');
 }
 // Minimal File-API mock: text() and arrayBuffer().
 return {
 async text() { return new TextDecoder().decode(bytes); },
 async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
 };
 },
 async createWritable() {
 return makeMockWritable(parentDir, name, writableOpts);
 },
 };
}

// ---------------------------------------------------------------------------
// Mock FileSystemDirectoryHandle
// ---------------------------------------------------------------------------

/**
 * Wrap a `Map`-based in-memory tree as a `FileSystemDirectoryHandle`.
 *
 * Permission state is modelled by the `permState` object so individual tests
 * can control `queryPermission` / `requestPermission` behaviour.
 *
 * @param {Map<string, Uint8Array | Map>} tree
 * @param {{ query?: string, request?: string }} [permState]
 * `query` — the string returned by `queryPermission()` ('granted'|'prompt'|'denied').
 * `request` — the string returned by `requestPermission()` ('granted'|'denied').
 * @param {{ rejectOnWrite?: Error }} [writableOpts] Forwarded to file writables.
 */
function makeMockDirHandle(tree, permState = {}, writableOpts = {}) {
 const state = { query: 'granted', request: 'granted', ...permState };

 return {
 kind: 'directory',

 // Entries async iterator — yields [name, handle] pairs.
 async *entries() {
 for (const [name, node] of tree.entries()) {
 if (node instanceof Map) {
 yield [name, makeMockDirHandle(node, state, writableOpts)];
 } else {
 yield [name, makeMockFileHandle(tree, name, writableOpts)];
 }
 }
 },

 async getDirectoryHandle(name, { create = false } = {}) {
 if (!tree.has(name)) {
 if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
 tree.set(name, new Map());
 }
 const node = tree.get(name);
 if (!(node instanceof Map)) throw new DOMException(`${name} is not a directory`, 'TypeMismatchError');
 return makeMockDirHandle(node, state, writableOpts);
 },

 async getFileHandle(name, { create = false } = {}) {
 if (!tree.has(name)) {
 if (!create) throw new DOMException(`${name} not found`, 'NotFoundError');
 tree.set(name, new Uint8Array(0));
 }
 const node = tree.get(name);
 // Use instanceof Map — Map is always from the same realm, so this is safe.
 if (node instanceof Map) throw new DOMException(`${name} is a directory`, 'TypeMismatchError');
 return makeMockFileHandle(tree, name, writableOpts);
 },

 async queryPermission(_opts) { return state.query; },
 async requestPermission(_opts) { return state.request; },
 };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal project tree for most tests. */
const FIXTURE_SPEC = {
 'config.json': '{ "version": 1 }',
 'README.md': '# Hello',
 components: {
 'Button.jsx': 'export default function Button() {}',
 icons: {
 'arrow.svg': '<svg/>',
 },
 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createFsaBackend — contract conformance', () => {
 it('produces an object that satisfies the FilesystemAccess contract', () => {
 const rootHandle = makeMockDirHandle(makeTree({}));
 const backend = createFsaBackend(rootHandle);
 expect(isFilesystemAccess(backend)).toBe(true);
 });

 it('assertFilesystemContract does not throw for the FSA backend', () => {
 const rootHandle = makeMockDirHandle(makeTree({}));
 expect(() => assertFilesystemContract(createFsaBackend(rootHandle), 'fsa-backend')).not.toThrow();
 });

 it('declares FSA capabilities: canWrite=true, canWatch=false, canReveal=false', () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree({})));
 expect(backend.capabilities).toEqual({ canWrite: true, canWatch: false, canReveal: false });
 });

 it('capabilities object is frozen (read-only)', () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree({})));
 expect(Object.isFrozen(backend.capabilities)).toBe(true);
 });
});

// ---------------------------------------------------------------------------

describe('readDir', () => {
 let rootHandle;
 let backend;

 beforeEach(() => {
 rootHandle = makeMockDirHandle(makeTree(FIXTURE_SPEC));
 backend = createFsaBackend(rootHandle);
 });

 it('distinguishes files from subdirectories', async () => {
 const entries = await backend.readDir('');
 const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

 // 'config.json' is a file
 expect(byName['config.json'].isFile).toBe(true);
 expect(byName['config.json'].isDirectory).toBe(false);
 expect(byName['config.json'].kind).toBe('file');

 // 'components' is a directory
 expect(byName.components.isDirectory).toBe(true);
 expect(byName.components.isFile).toBe(false);
 expect(byName.components.kind).toBe('directory');
 });

 it('returns entries with forward-slash paths — no backslashes', async () => {
 const entries = await backend.readDir('');
 for (const entry of entries) {
 expect(entry.path).not.toContain('\\');
 }
 });

 it('builds paths by joining dirPath and name correctly', async () => {
 const entries = await backend.readDir('');
 const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

 // root-level: path = name
 expect(byName['config.json'].path).toBe('config.json');
 expect(byName.components.path).toBe('components');
 });

 it('builds nested paths for a subdirectory listing', async () => {
 const entries = await backend.readDir('components');
 const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

 expect(byName['Button.jsx'].path).toBe('components/Button.jsx');
 expect(byName.icons.path).toBe('components/icons');
 });

 it('DirEntry shape parity with the Node backend — name/path/kind/isFile/isDirectory all present', async () => {
 const [entry] = await backend.readDir('');
 expect(entry).toHaveProperty('name');
 expect(entry).toHaveProperty('path');
 expect(entry).toHaveProperty('kind');
 expect(entry).toHaveProperty('isFile');
 expect(entry).toHaveProperty('isDirectory');
 // kind and booleans must be consistent
 expect(entry.kind === 'file' ? entry.isFile : entry.isDirectory).toBe(true);
 });

 it('isFile and isDirectory are mutually exclusive', async () => {
 const entries = await backend.readDir('');
 for (const entry of entries) {
 expect(entry.isFile).not.toBe(entry.isDirectory);
 }
 });

 it('rejects when the directory does not exist', async () => {
 await expect(backend.readDir('nonexistent')).rejects.toThrow();
 });
});

// ---------------------------------------------------------------------------

describe('readFile', () => {
 let backend;

 beforeEach(() => {
 backend = createFsaBackend(makeMockDirHandle(makeTree(FIXTURE_SPEC)));
 });

 it('reads UTF-8 text by default (no encoding option)', async () => {
 const text = await backend.readFile('config.json');
 expect(typeof text).toBe('string');
 expect(text).toBe('{ "version": 1 }');
 });

 it('reads UTF-8 text with explicit encoding: "utf-8"', async () => {
 const text = await backend.readFile('README.md', { encoding: 'utf-8' });
 expect(typeof text).toBe('string');
 expect(text).toBe('# Hello');
 });

 it('reads a nested file', async () => {
 const text = await backend.readFile('components/Button.jsx');
 expect(text).toBe('export default function Button() {}');
 });

 it('reads binary content as a Uint8Array with encoding: "binary"', async () => {
 const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
 const tree = makeTree({});
 tree.set('logo.png', bytes);
 const b = createFsaBackend(makeMockDirHandle(tree));

 const result = await b.readFile('logo.png', { encoding: 'binary' });

 expect(result).toBeInstanceOf(Uint8Array);
 expect(Array.from(result)).toEqual(Array.from(bytes));
 });

 it('rejects when the file does not exist', async () => {
 await expect(backend.readFile('missing.txt')).rejects.toThrow();
 });
});

// ---------------------------------------------------------------------------

describe('writeFile — safe write (NFR9)', () => {
 let tree;
 let backend;

 beforeEach(() => {
 tree = makeTree(FIXTURE_SPEC);
 backend = createFsaBackend(makeMockDirHandle(tree));
 });

 it('writes new UTF-8 content and the file is readable afterwards', async () => {
 await backend.writeFile('newfile.txt', 'hello');
 const text = await backend.readFile('newfile.txt');
 expect(text).toBe('hello');
 });

 it('replaces existing content', async () => {
 await backend.writeFile('config.json', '{ "version": 2 }');
 const text = await backend.readFile('config.json');
 expect(text).toBe('{ "version": 2 }');
 });

 it('writes binary content from a Uint8Array', async () => {
 const bytes = new Uint8Array([1, 2, 3, 250, 0]);
 await backend.writeFile('out.bin', bytes, { encoding: 'binary' });
 const result = await backend.readFile('out.bin', { encoding: 'binary' });
 expect(Array.from(result)).toEqual(Array.from(bytes));
 });

 it('round-trips binary through writeFile + readFile', async () => {
 const bytes = new Uint8Array([0, 127, 128, 255, 64]);
 await backend.writeFile('roundtrip.bin', bytes, { encoding: 'binary' });
 const result = await backend.readFile('roundtrip.bin', { encoding: 'binary' });
 expect(Array.from(result)).toEqual(Array.from(bytes));
 });

 it('creates parent directories that do not exist yet', async () => {
 await backend.writeFile('deep/nested/dir/new.txt', 'created');
 const text = await backend.readFile('deep/nested/dir/new.txt');
 expect(text).toBe('created');
 });

 it('leaves the original file fully intact when write() rejects mid-stream (NFR9)', async () => {
 // Pre-existing file with known content.
 const original = '{ "important": "do not lose me" }';
 const treeWithOrig = makeTree({ 'precious.json': original });

 // Inject a writable that rejects on write().
 const writeError = new Error('simulated mid-stream failure');
 const rootHandle = makeMockDirHandle(treeWithOrig, {}, { rejectOnWrite: writeError });
 const b = createFsaBackend(rootHandle);

 // The write must reject…
 await expect(b.writeFile('precious.json', 'CORRUPTED PARTIAL DATA')).rejects.toThrow(
 'simulated mid-stream failure',
 );

 // …and the original content must be untouched.
 // Bypass the backend and read directly from the tree map to confirm.
 const storedBytes = treeWithOrig.get('precious.json');
 const stored = new TextDecoder().decode(storedBytes);
 expect(stored).toBe(original);
 });

 it('a failed write on a brand-new path rejects without committing content', async () => {
 // Note on FSA semantics vs. Node backend:
 // The real FSA API calls getFileHandle({ create: true }) which materialises
 // the file immediately (empty), THEN opens a createWritable swap buffer.
 // If write() throws, abort() discards the swap buffer — the new file exists
 // but stays empty (no partial data). This differs from the Node backend's
 // temp-file-then-rename: Node never touches the destination until rename
 // succeeds. The FSA behaviour is still safe (NFR9): the content the caller
 // tried to write is never partially applied.
 const emptyTree = makeTree({});
 const writeError = new Error('interrupt');
 const rootHandle = makeMockDirHandle(emptyTree, {}, { rejectOnWrite: writeError });
 const b = createFsaBackend(rootHandle);

 await expect(b.writeFile('never-created.txt', 'data')).rejects.toThrow('interrupt');

 // The file may exist in the map (FSA creates it before writing), but its
 // content must NOT be the new data — it was never committed.
 if (emptyTree.has('never-created.txt')) {
 const stored = emptyTree.get('never-created.txt');
 // An aborted write may leave an empty file, but never partial content.
 const storedText = new TextDecoder().decode(stored);
 expect(storedText).not.toBe('data');
 }
 // The key invariant is that the write call rejected.
 // (Already asserted above via rejects.toThrow.)
 });
});

// ---------------------------------------------------------------------------

describe('watch — no-op stub (replaces this)', () => {
 it('returns an object with a close() function', () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree({})));
 const watcher = backend.watch('', () => {});
 expect(typeof watcher.close).toBe('function');
 });

 it('close() is idempotent — calling it multiple times does not throw', () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree({})));
 const watcher = backend.watch('components', () => {});
 expect(() => {
 watcher.close();
 watcher.close();
 watcher.close();
 }).not.toThrow();
 });

 it('watch() is synchronous — returns immediately (not a Promise)', () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree({})));
 const result = backend.watch('', () => {});
 // Must NOT be a Promise — the contract requires a synchronous Watcher.
 expect(result).not.toBeInstanceOf(Promise);
 // Tidy up.
 result.close();
 });

 it('no events are emitted by the stub (canWatch=false)', async () => {
 const backend = createFsaBackend(makeMockDirHandle(makeTree(FIXTURE_SPEC)));
 const events = [];
 const watcher = backend.watch('', (e) => events.push(e));

 // Perform writes — the stub must remain silent.
 await backend.writeFile('config.json', '{}');
 await backend.writeFile('config.json', '{"v":2}');

 // Give any async emission a tick to surface.
 await new Promise((r) => setTimeout(r, 20));

 expect(events).toHaveLength(0);
 watcher.close();
 });
});

// ---------------------------------------------------------------------------

describe('permission handling', () => {
 it('proceeds normally when queryPermission returns "granted"', async () => {
 const rootHandle = makeMockDirHandle(makeTree({ 'a.txt': 'hi' }), {
 query: 'granted',
 });
 const backend = createFsaBackend(rootHandle);
 const text = await backend.readFile('a.txt');
 expect(text).toBe('hi');
 });

 it('re-requests permission when queryPermission returns "prompt" and grants succeed', async () => {
 const rootHandle = makeMockDirHandle(makeTree({ 'a.txt': 'hi' }), {
 query: 'prompt',
 request: 'granted',
 });
 const backend = createFsaBackend(rootHandle);
 // Should NOT throw — requestPermission returns 'granted'.
 const text = await backend.readFile('a.txt');
 expect(text).toBe('hi');
 });

 it('throws PermissionDeniedError when queryPermission is "prompt" and requestPermission is "denied"', async () => {
 const rootHandle = makeMockDirHandle(makeTree({ 'a.txt': 'hi' }), {
 query: 'prompt',
 request: 'denied',
 });
 const backend = createFsaBackend(rootHandle);

 await expect(backend.readFile('a.txt')).rejects.toThrow(PermissionDeniedError);
 });

 it('throws PermissionDeniedError (not a raw Error) so callers can branch on type', async () => {
 const rootHandle = makeMockDirHandle(makeTree({}), {
 query: 'denied',
 request: 'denied',
 });
 const backend = createFsaBackend(rootHandle);

 let caught = null;
 try {
 await backend.readDir('');
 } catch (err) {
 caught = err;
 }

 expect(caught).not.toBeNull();
 expect(caught).toBeInstanceOf(PermissionDeniedError);
 // Also an Error, so standard catch chains work.
 expect(caught).toBeInstanceOf(Error);
 // Has a meaningful name.
 expect(caught.name).toBe('PermissionDeniedError');
 });

 it('PermissionDeniedError is re-thrown on writeFile too', async () => {
 const rootHandle = makeMockDirHandle(makeTree({}), {
 query: 'prompt',
 request: 'denied',
 });
 const backend = createFsaBackend(rootHandle);
 await expect(backend.writeFile('a.txt', 'data')).rejects.toThrow(PermissionDeniedError);
 });

 it('requestPermission is NOT called when queryPermission returns "granted"', async () => {
 const tree = makeTree({ 'a.txt': 'x' });
 const mockHandle = makeMockDirHandle(tree, { query: 'granted', request: 'granted' });
 const requestSpy = vi.spyOn(mockHandle, 'requestPermission');

 const backend = createFsaBackend(mockHandle);
 await backend.readFile('a.txt');

 expect(requestSpy).not.toHaveBeenCalled();
 });
});
