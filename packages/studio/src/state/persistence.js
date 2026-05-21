/**
 * persistence.js
 * IndexedDB layer for browser-side trust records and directory-handle storage.
 *
 * ─── IndexedDB schema ────────────────────────────────────────────────────────
 *
 * Database name : "lerret-studio-state" version: 1
 *
 * Object store : "trust"
 * keyPath : "folderId" (string — derived folder identity, see below)
 * Record shape: { folderId: string, trustedAt: ISO-8601 string }
 *
 * Object store : "handles"
 * keyPath : "folderId" (string — same derivation as "trust")
 * Record shape: { folderId: string, name: string, handle: FileSystemDirectoryHandle }
 * Note: FileSystemDirectoryHandle is structured-cloneable in Chromium —
 * IndexedDB persists it across page reloads.
 *
 * ─── Folder identity scheme ──────────────────────────────────────────────────
 *
 * A stable, browser-local folder ID is derived as follows:
 *
 * 1. The handle's `.name` property gives the directory's last segment.
 * 2. When persisting a new handle we assign it a deterministic id:
 * `"folder:<name>:<uuid>"` where `<name>` is the handle's `.name` and
 * `<uuid>` is a locally-generated UUID. The UUID makes every new folder
 * unique even if the user picks two differently-located folders with the
 * same directory name.
 * 3. For isTrusted / recordTrust, the supplied handle is compared against
 * every stored handle record using `FileSystemDirectoryHandle.isSameEntry()`.
 * This is the only reliable cross-session equivalence primitive — name
 * alone is ambiguous.
 * 4. If no stored handle matches `isSameEntry`, the handle has never been
 * seen before (→ not trusted, no id).
 *
 * ─── Architecture constraints (NFR13, AR7) ───────────────────────────────────
 *
 * Trust records and directory handles are stored ONLY in browser IndexedDB.
 * They are NEVER written into the user's `.lerret/` project folder or any
 * file on disk. This file is the canonical isolation point for all IDB access.
 *
 * ─── Dependency note ─────────────────────────────────────────────────────────
 *
 * Tests use an inline in-memory IDB mock (see persistence.test.js). No
 * fake-indexeddb npm devDep is added — the mock is small and self-contained.
 */

// ─── DB bootstrap ────────────────────────────────────────────────────────────

const DB_NAME = 'lerret-studio-state';
const DB_VERSION = 1;
const STORE_TRUST = 'trust';
const STORE_HANDLES = 'handles';

/**
 * Open (or upgrade) the IndexedDB database. Returns the IDBDatabase instance.
 * The promise resolves once the db is fully open and any needed upgrades are
 * applied. Rejects on any IDB error.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
 return new Promise((resolve, reject) => {
 const req = indexedDB.open(DB_NAME, DB_VERSION);

 req.onupgradeneeded = (e) => {
 /** @type {IDBDatabase} */
 const db = e.target.result;
 if (!db.objectStoreNames.contains(STORE_TRUST)) {
 db.createObjectStore(STORE_TRUST, { keyPath: 'folderId' });
 }
 if (!db.objectStoreNames.contains(STORE_HANDLES)) {
 db.createObjectStore(STORE_HANDLES, { keyPath: 'folderId' });
 }
 };

 req.onsuccess = (e) => resolve(e.target.result);
 req.onerror = (e) => reject(e.target.error);
 });
}

// ─── Low-level IDB helpers ────────────────────────────────────────────────────

/**
 * Execute a single IDB request and return a Promise for its result.
 *
 * @param {IDBRequest} req
 * @returns {Promise<any>}
 */
function idbReq(req) {
 return new Promise((resolve, reject) => {
 req.onsuccess = (e) => resolve(e.target.result);
 req.onerror = (e) => reject(e.target.error);
 });
}

/**
 * Collect all records from an IDB object store.
 *
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @returns {Promise<any[]>}
 */
function getAllRecords(db, storeName) {
 const tx = db.transaction(storeName, 'readonly');
 return idbReq(tx.objectStore(storeName).getAll());
}

// ─── Folder identity helpers ──────────────────────────────────────────────────

/**
 * Generate a UUID-based folder ID for a new persisted handle.
 * Shape: "folder:<name>:<randomhex>"
 *
 * @param {string} name The handle's `.name` property.
 * @returns {string}
 */
function generateFolderId(name) {
 // crypto.randomUUID is available in Chromium (the only supported browser for
 // hosted mode). Fallback to a hex timestamp + random for test environments.
 const uid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
 ? crypto.randomUUID()
 : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
 return `folder:${name}:${uid}`;
}

/**
 * Find the stored `handles` record whose `handle` is the same filesystem entry
 * as `queryHandle`, using `FileSystemDirectoryHandle.isSameEntry()`.
 *
 * Returns `null` when no match is found.
 *
 * @param {IDBDatabase} db
 * @param {FileSystemDirectoryHandle} queryHandle
 * @returns {Promise<{ folderId: string, name: string, handle: FileSystemDirectoryHandle } | null>}
 */
async function findStoredHandleRecord(db, queryHandle) {
 const all = await getAllRecords(db, STORE_HANDLES);
 for (const record of all) {
 // isSameEntry() is the only cross-session identity primitive for FSA handles.
 const same = await queryHandle.isSameEntry(record.handle);
 if (same) return record;
 }
 return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return true when the given folder has a stored trust record in IndexedDB.
 *
 * This is determined by:
 * 1. Loading all persisted `handles` records.
 * 2. Calling `isSameEntry` on each stored handle against `handle`.
 * 3. If a matching handle is found, checking whether a trust record exists
 * for that folder's ID.
 *
 * A folder never seen before → false (no stored handle, no trust record).
 *
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
export async function isTrusted(handle) {
 const db = await openDb();
 const record = await findStoredHandleRecord(db, handle);
 if (!record) return false;

 const trustRecord = await idbReq(
 db.transaction(STORE_TRUST, 'readonly')
 .objectStore(STORE_TRUST)
 .get(record.folderId),
 );
 return Boolean(trustRecord);
}

/**
 * Write a trust record for the given folder handle.
 *
 * If the handle has already been persisted (a `handles` record exists with
 * `isSameEntry` === true), that record's `folderId` is reused. If the handle
 * is new, it is automatically persisted first (same as `persistDirectoryHandle`).
 *
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<void>}
 */
export async function recordTrust(handle) {
 const db = await openDb();
 let record = await findStoredHandleRecord(db, handle);

 // Auto-persist the handle if not yet stored — trust implies we know the folder.
 if (!record) {
 const { id, name } = await persistDirectoryHandle(handle);
 record = { folderId: id, name };
 }

 const trustEntry = {
 folderId: record.folderId,
 trustedAt: new Date().toISOString(),
 };

 const tx = db.transaction(STORE_TRUST, 'readwrite');
 await idbReq(tx.objectStore(STORE_TRUST).put(trustEntry));
}

/**
 * Remove the trust record for the given folder handle (admin helper).
 *
 * No-op when the handle has no stored trust record.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<void>}
 */
export async function clearTrust(handle) {
 const db = await openDb();
 const record = await findStoredHandleRecord(db, handle);
 if (!record) return;

 const tx = db.transaction(STORE_TRUST, 'readwrite');
 await idbReq(tx.objectStore(STORE_TRUST).delete(record.folderId));
}

/**
 * Persist a `FileSystemDirectoryHandle` to IndexedDB so the studio can
 * reconnect the folder across page reloads without asking for a fresh picker.
 *
 * If the handle is already stored (same entry), returns the existing `{ id, name }`.
 * Otherwise creates a new record with a freshly generated folder ID.
 *
 * @param {FileSystemDirectoryHandle} handle
 * @param {string} [label] Optional human-readable label (defaults to handle.name).
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function persistDirectoryHandle(handle, label) {
 const db = await openDb();
 const existing = await findStoredHandleRecord(db, handle);
 if (existing) {
 return { id: existing.folderId, name: existing.name };
 }

 const name = label ?? handle.name;
 const folderId = generateFolderId(handle.name);

 const entry = { folderId, name, handle };
 const tx = db.transaction(STORE_HANDLES, 'readwrite');
 await idbReq(tx.objectStore(STORE_HANDLES).put(entry));

 return { id: folderId, name };
}

/**
 * Return all persisted directory-handle records so the open-folder empty
 * state can offer "Reconnect last folder" options.
 *
 * @returns {Promise<Array<{ id: string, name: string, handle: FileSystemDirectoryHandle }>>}
 */
export async function listPersistedHandles() {
 const db = await openDb();
 const all = await getAllRecords(db, STORE_HANDLES);
 return all.map(({ folderId, name, handle }) => ({ id: folderId, name, handle }));
}

/**
 * Retrieve a single persisted handle by its folder ID.
 *
 * Returns `null` when the id is not found. The caller is
 * responsible for calling `handle.requestPermission()` before use — if the
 * browser denies it, catches `PermissionDeniedError` and falls back
 * to the open-folder empty state.
 *
 * @param {string} id A folderId returned by `persistDirectoryHandle`.
 * @returns {Promise<{ name: string, handle: FileSystemDirectoryHandle } | null>}
 */
export async function getPersistedHandleById(id) {
 const db = await openDb();
 const record = await idbReq(
 db.transaction(STORE_HANDLES, 'readonly')
 .objectStore(STORE_HANDLES)
 .get(id),
 );
 if (!record) return null;
 return { name: record.name, handle: record.handle };
}

/**
 * Remove a persisted directory-handle record by its folder ID.
 *
 * No-op when the id is not found. Does NOT remove an associated trust record —
 * call `clearTrust` separately if that is also desired.
 *
 * @param {string} id A folderId returned by `persistDirectoryHandle`.
 * @returns {Promise<void>}
 */
export async function removePersistedHandle(id) {
 const db = await openDb();
 const tx = db.transaction(STORE_HANDLES, 'readwrite');
 await idbReq(tx.objectStore(STORE_HANDLES).delete(id));
}
