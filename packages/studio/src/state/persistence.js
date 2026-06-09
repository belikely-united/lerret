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
// Bumped 1 → 2 for Epic 8 (Story 8.1): the AI key vault adds three stores to
// this same database. `@lerret/ai`'s `vault/store.js` opens the SAME
// 'lerret-studio-state' DB at version 2; both callers MUST agree on the
// version or whichever opens second throws a VersionError. The migration body
// below is FUNCTIONALLY equivalent to `applyMigrationsV1ToV2` in vault/store.js
// — both converge to the same final schema (the per-store `contains()` guards
// make each idempotent), though the structure differs (this file creates
// trust/handles unconditionally and gates only the AI stores under
// `oldVersion < 2`, while vault/store.js gates the v1 stores under
// `oldVersion < 1`). It is duplicated rather than imported because
// `@lerret/studio` must NOT statically import `@lerret/ai` (the dynamic-import
// boundary, enforced by no-static-imports.test.js). Whichever module opens the
// DB first triggers onupgradeneeded; the other connects normally.
const DB_VERSION = 2;
const STORE_TRUST = 'trust';
const STORE_HANDLES = 'handles';
// AI vault stores (Epic 8 / Story 8.1) — compound-keyed by (folderId,
// providerName). Names + keyPaths MUST stay identical to vault/store.js.
const STORE_AI_PROVIDER_CONFIG = 'ai_provider_config';
const STORE_AI_KEYS = 'ai_keys';
const STORE_AI_DISCLOSURE_ACK = 'ai_disclosure_ack';

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
 // v1 stores — created on a fresh DB and preserved across the v1→v2
 // upgrade (the `contains` guard means an existing v1 DB keeps its
 // trust/handles records; only the new AI stores are added).
 if (!db.objectStoreNames.contains(STORE_TRUST)) {
 db.createObjectStore(STORE_TRUST, { keyPath: 'folderId' });
 }
 if (!db.objectStoreNames.contains(STORE_HANDLES)) {
 db.createObjectStore(STORE_HANDLES, { keyPath: 'folderId' });
 }
 // v2 AI vault stores — added on the v1→v2 upgrade path. The
 // `oldVersion < 2` guard mirrors vault/store.js; the `contains`
 // guards make the whole block idempotent regardless of entry version.
 if (e.oldVersion < 2) {
 if (!db.objectStoreNames.contains(STORE_AI_PROVIDER_CONFIG)) {
 db.createObjectStore(STORE_AI_PROVIDER_CONFIG, {
 keyPath: ['folderId', 'providerName'],
 });
 }
 if (!db.objectStoreNames.contains(STORE_AI_KEYS)) {
 db.createObjectStore(STORE_AI_KEYS, {
 keyPath: ['folderId', 'providerName'],
 });
 }
 if (!db.objectStoreNames.contains(STORE_AI_DISCLOSURE_ACK)) {
 db.createObjectStore(STORE_AI_DISCLOSURE_ACK, {
 keyPath: ['folderId', 'providerName'],
 });
 }
 }
 };

 req.onsuccess = (e) => resolve(e.target.result);
 req.onerror = (e) => reject(e.target.error);
 // If another tab holds this DB open at the OLD version, the v1→v2
 // upgrade fires `blocked` (not `error`) and would otherwise hang forever
 // with no diagnostic. Reject with a clear, actionable message. Mirrors
 // the symmetric handler in @lerret/ai's vault/store.js.
 req.onblocked = () =>
 reject(
 new Error(
 'lerret-studio-state is open in another tab at an older version; ' +
 'close other Lerret tabs and reload to apply the database upgrade.',
 ),
 );
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
 // SECURITY: the folderId is the SOLE entropy source for the AI key-vault's
 // per-folder encryption key (see @lerret/ai vault/crypto.js). A low-entropy
 // or predictable id would collapse the vault's per-folder uniqueness, so the
 // id MUST come from a CSPRNG — never a non-cryptographic PRNG.
 let uid;
 if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
 uid = crypto.randomUUID();
 } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
 // CSPRNG fallback for environments lacking randomUUID (older runtimes,
 // some test contexts): 16 random bytes as hex.
 const bytes = crypto.getRandomValues(new Uint8Array(16));
 uid = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
 } else {
 // No CSPRNG available — refuse to mint a real persisted folder id rather
 // than silently degrading to a predictable Math.random value that would
 // weaken the vault. (Chromium, the only supported hosted browser, always
 // has Web Crypto; this path is effectively unreachable in production.)
 throw new Error(
 'generateFolderId: no Web Crypto available; cannot mint a secure folder id',
 );
 }
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
