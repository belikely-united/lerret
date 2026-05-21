/**
 * Tests for — persistence.js
 *
 * IndexedDB mock strategy: INLINE IN-MEMORY MOCK (no fake-indexeddb devDep).
 *
 * Rationale: the IDB surface used by persistence.js is narrow and well-defined
 * (open, put, get, getAll, delete, single-store transactions). A hand-rolled
 * mock keeps the devDep list minimal and makes test intent immediately visible.
 * The mock is installed via `vi.stubGlobal('indexedDB', ...)` and torn down in
 * afterEach so tests are isolated.
 *
 * Mock design:
 * - One or more named databases, each with named object stores.
 * - Each store is a Map<key, value> — reads/writes use the configured keyPath.
 * - Transactions are synchronous-but-returned-as-promises (IDBRequest pattern).
 * - `onupgradeneeded` is fired when the db is first created.
 *
 * FSA handle mock:
 * - `makeHandle(id, name)` produces a fake FileSystemDirectoryHandle.
 * - `isSameEntry` compares an internal `_id` field — two handles are "the
 * same entry" iff they share the same `_id`.
 * - `crypto.randomUUID` is stubbed so generated folder IDs are deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Inline IndexedDB mock ────────────────────────────────────────────────────
//
// Minimal IDB simulation. Only the surface consumed by persistence.js is needed:
// indexedDB.open(name, version) → IDBOpenDBRequest-like
// db.transaction(store, mode) → IDBTransaction-like
// tx.objectStore(name) → IDBObjectStore-like { put, get, getAll, delete }
// IDBRequest pattern → onsuccess / onerror callbacks

/** All in-memory databases: Map<dbName, Map<storeName, Map<key, value>>> */
let _databases = new Map();

/**
 * Create a fake IDBRequest that resolves asynchronously (next microtask) with
 * `result`, or rejects with `error`.
 */
function fakeReq(result, error) {
 const req = {
 result: undefined,
 error: undefined,
 onsuccess: null,
 onerror: null,
 };
 Promise.resolve().then(() => {
 if (error) {
 req.error = error;
 req.onerror?.({ target: req });
 } else {
 req.result = result;
 req.onsuccess?.({ target: req });
 }
 });
 return req;
}

/**
 * Create a fake IDBObjectStore backed by a Map.
 *
 * @param {Map<any, any>} store
 * @param {string} keyPath
 */
function fakeObjectStore(store, keyPath) {
 return {
 put(record) {
 const key = record[keyPath];
 store.set(key, record);
 return fakeReq(key);
 },
 get(key) {
 return fakeReq(store.get(key));
 },
 getAll() {
 return fakeReq([...store.values()]);
 },
 delete(key) {
 store.delete(key);
 return fakeReq(undefined);
 },
 };
}

/**
 * Build the fake `indexedDB` global. All state is kept in `_databases`.
 */
function buildFakeIdb() {
 return {
 open(name, version) {
 const req = {
 result: null,
 error: null,
 onsuccess: null,
 onerror: null,
 onupgradeneeded: null,
 };

 Promise.resolve().then(() => {
 const isNew = !_databases.has(name);
 if (isNew) {
 _databases.set(name, new Map());
 }

 const storeMap = _databases.get(name);

 /** Fake IDBDatabase */
 const db = {
 objectStoreNames: {
 contains: (n) => storeMap.has(n),
 },
 createObjectStore(storeName, { keyPath }) {
 if (!storeMap.has(storeName)) {
 storeMap.set(storeName, { records: new Map(), keyPath });
 }
 },
 transaction(storeName, _mode) {
 const storeEntry = storeMap.get(storeName);
 if (!storeEntry) throw new Error(`No object store "${storeName}"`);
 return {
 objectStore: (_n) => fakeObjectStore(storeEntry.records, storeEntry.keyPath),
 };
 },
 };

 req.result = db;

 // Fire onupgradeneeded when the db is first created (version bump).
 if (isNew && req.onupgradeneeded) {
 req.onupgradeneeded({ target: req });
 }

 req.onsuccess?.({ target: req });
 });

 return req;
 },
 };
}

// ─── FileSystemDirectoryHandle mock ──────────────────────────────────────────

let _handleSeq = 0;

/**
 * Create a fake FileSystemDirectoryHandle with a stable internal identity.
 *
 * @param {string} [name] Directory name (last segment).
 * @returns {object} Fake FSA directory handle.
 */
function makeHandle(name = 'my-project') {
 const id = ++_handleSeq;
 return {
 name,
 _id: id,
 async isSameEntry(other) {
 return this._id === other._id;
 },
 };
}

// ─── Test setup / teardown ────────────────────────────────────────────────────

// We import persistence.js dynamically after stubbing globals so the module
// picks up the fake indexedDB from the start of each test group.
// However, ES module caching means a single import is shared. The persistence
// module calls `indexedDB.open()` lazily (on each exported function call), so
// stubbing before any call is sufficient.
import {
 isTrusted,
 recordTrust,
 clearTrust,
 persistDirectoryHandle,
 listPersistedHandles,
 getPersistedHandleById,
 removePersistedHandle,
} from './persistence.js';

beforeEach(() => {
 _databases = new Map();
 _handleSeq = 0;

 vi.stubGlobal('indexedDB', buildFakeIdb());

 // Stub crypto.randomUUID for deterministic IDs.
 let uuidSeq = 0;
 vi.stubGlobal('crypto', {
 randomUUID: () => `00000000-test-${String(++uuidSeq).padStart(4, '0')}`,
 });
});

afterEach(() => {
 vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('persistence — trust records', () => {
 it('recordTrust + isTrusted round-trip: same handle returns true', async () => {
 const h = makeHandle('proj');
 await recordTrust(h);
 expect(await isTrusted(h)).toBe(true);
 });

 it('isTrusted returns false for a handle that has never been trusted', async () => {
 const h = makeHandle('proj');
 expect(await isTrusted(h)).toBe(false);
 });

 it('isTrusted returns false for a different folder (different isSameEntry)', async () => {
 const h1 = makeHandle('proj');
 const h2 = makeHandle('proj'); // same name, different internal id
 await recordTrust(h1);
 expect(await isTrusted(h2)).toBe(false);
 });

 it('clearTrust removes the trust record', async () => {
 const h = makeHandle('proj');
 await recordTrust(h);
 expect(await isTrusted(h)).toBe(true);

 await clearTrust(h);
 expect(await isTrusted(h)).toBe(false);
 });

 it('clearTrust is a no-op when the handle has no trust record', async () => {
 const h = makeHandle('proj');
 await expect(clearTrust(h)).resolves.toBeUndefined();
 });

 it('recordTrust writes a trustedAt ISO-8601 timestamp', async () => {
 const h = makeHandle('proj');
 await recordTrust(h);

 // Verify via listPersistedHandles to get the folderId.
 const [stored] = await listPersistedHandles();
 // Read the trust record directly from the fake db.
 const dbMap = _databases.get('lerret-studio-state');
 const trustStore = dbMap.get('trust');
 const record = trustStore.records.get(stored.id);
 expect(record).toBeDefined();
 expect(typeof record.trustedAt).toBe('string');
 expect(() => new Date(record.trustedAt)).not.toThrow();
 });
});

describe('persistence — directory handles', () => {
 it('persistDirectoryHandle returns an id and name', async () => {
 const h = makeHandle('my-project');
 const { id, name } = await persistDirectoryHandle(h);
 expect(id).toMatch(/^folder:my-project:/);
 expect(name).toBe('my-project');
 });

 it('persistDirectoryHandle with a custom label uses that label as name', async () => {
 const h = makeHandle('raw-dir-name');
 const { name } = await persistDirectoryHandle(h, 'My Design Folder');
 expect(name).toBe('My Design Folder');
 });

 it('persistDirectoryHandle called twice for the same handle returns the same id', async () => {
 const h = makeHandle('proj');
 const r1 = await persistDirectoryHandle(h);
 const r2 = await persistDirectoryHandle(h);
 expect(r1.id).toBe(r2.id);
 });

 it('listPersistedHandles returns the persisted handle', async () => {
 const h = makeHandle('proj');
 await persistDirectoryHandle(h);
 const list = await listPersistedHandles();
 expect(list).toHaveLength(1);
 expect(list[0].name).toBe('proj');
 expect(list[0].handle).toBe(h);
 expect(typeof list[0].id).toBe('string');
 });

 it('listPersistedHandles returns all persisted handles', async () => {
 const h1 = makeHandle('a');
 const h2 = makeHandle('b');
 await persistDirectoryHandle(h1);
 await persistDirectoryHandle(h2);
 const list = await listPersistedHandles();
 expect(list).toHaveLength(2);
 const names = list.map((r) => r.name).sort();
 expect(names).toEqual(['a', 'b']);
 });

 it('getPersistedHandleById returns the correct record', async () => {
 const h = makeHandle('proj');
 const { id } = await persistDirectoryHandle(h);
 const record = await getPersistedHandleById(id);
 expect(record).not.toBeNull();
 expect(record.name).toBe('proj');
 expect(record.handle).toBe(h);
 });

 it('getPersistedHandleById returns null for unknown id', async () => {
 const result = await getPersistedHandleById('unknown-id');
 expect(result).toBeNull();
 });

 it('removePersistedHandle removes only the targeted record', async () => {
 const h1 = makeHandle('a');
 const h2 = makeHandle('b');
 const { id: id1 } = await persistDirectoryHandle(h1);
 await persistDirectoryHandle(h2);

 await removePersistedHandle(id1);

 const list = await listPersistedHandles();
 expect(list).toHaveLength(1);
 expect(list[0].name).toBe('b');
 });

 it('removePersistedHandle is a no-op for unknown id', async () => {
 const h = makeHandle('proj');
 await persistDirectoryHandle(h);
 await expect(removePersistedHandle('non-existent')).resolves.toBeUndefined();
 const list = await listPersistedHandles();
 expect(list).toHaveLength(1);
 });

 it('removePersistedHandle does NOT remove the trust record', async () => {
 const h = makeHandle('proj');
 const { id } = await persistDirectoryHandle(h);
 await recordTrust(h);

 await removePersistedHandle(id);

 // Trust store should still have the record (handles store is cleared).
 const dbMap = _databases.get('lerret-studio-state');
 const trustStore = dbMap.get('trust');
 expect(trustStore.records.size).toBe(1);
 });
});

describe('persistence — cross-store consistency', () => {
 it('recordTrust auto-persists the handle if not already stored', async () => {
 const h = makeHandle('fresh');
 // No prior persistDirectoryHandle call.
 await recordTrust(h);

 const list = await listPersistedHandles();
 expect(list).toHaveLength(1);
 expect(list[0].name).toBe('fresh');
 });

 it('trust survives clear-and-re-trust cycle', async () => {
 const h = makeHandle('proj');
 await recordTrust(h);
 await clearTrust(h);
 await recordTrust(h);
 expect(await isTrusted(h)).toBe(true);
 });
});
