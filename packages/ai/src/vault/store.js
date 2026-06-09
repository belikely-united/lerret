// IndexedDB CRUD for the three vault stores in the existing
// `lerret-studio-state` database.
//
// Implements AC-10 / AC-11 of story 8.1: opens the DB at version 2 and
// performs an additive `onupgradeneeded` migration that creates exactly
// three new compound-keyed stores without touching the v1 `trust` and
// `handles` stores. Either this module OR `packages/studio/src/state/
// persistence.js` may open the DB first; whichever wins triggers the
// migration. Both files run the SAME `applyMigrationsV1ToV2` body so the
// result is identical regardless of opener.
//
// ─── Store schema ────────────────────────────────────────────────────────────
//
// Database name : "lerret-studio-state" version: 2
//
// Object store : "ai_provider_config" (NEW v2)
// keyPath : ["folderId", "providerName"] (compound)
// Record shape : { folderId, providerName, active: boolean,
//                  model?: string, baseUrl?: string,
//                  configuredAt: ISO-8601 string }
//
// Object store : "ai_keys" (NEW v2)
// keyPath : ["folderId", "providerName"] (compound)
// Record shape : { folderId, providerName, iv: base64, ciphertext: base64 }
//
// Object store : "ai_disclosure_ack" (NEW v2)
// keyPath : ["folderId", "providerName"] (compound)
// Record shape : { folderId, providerName, acknowledgedAt: ISO-8601 string }
//
// ─── Boundary discipline ─────────────────────────────────────────────────────
//
// This module does NOT import from `@lerret/studio` — the AI subsystem is
// boundary-isolated per architecture-epic-8.md §Studio Chrome. The duplication
// of the migration logic is the architecturally-correct trade-off (Story 8.0
// per-package boundary precedent): cheap duplication, zero cross-package
// coupling.
//
// ─── Plaintext rules ─────────────────────────────────────────────────────────
//
// This module returns the ENCRYPTED `{iv, ciphertext}` blob; it NEVER
// decrypts. Decryption happens at the call site inside the provider's
// request-construction code, immediately consumed for the Authorization
// header and discarded. The CI grep guard at `no-key-leak.test.js` enforces
// that no `console.*` invocation here references key-material variable
// names.

const DB_NAME = 'lerret-studio-state';
const DB_VERSION = 2;

export const STORE_PROVIDER_CONFIG = 'ai_provider_config';
export const STORE_KEYS = 'ai_keys';
export const STORE_DISCLOSURE_ACK = 'ai_disclosure_ack';
const STORE_TRUST = 'trust';
const STORE_HANDLES = 'handles';

/**
 * Migration body shared with `packages/studio/src/state/persistence.js`. Both
 * files MUST keep this function byte-equivalent so the migration produces the
 * same schema regardless of which package opens the DB first.
 *
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 * @returns {void}
 */
export function applyMigrationsV1ToV2(db, oldVersion) {
    // v0 → v1 — the v1 stores created by `persistence.js`. Re-applied here
    // so an AI-first cold start creates the SAME baseline.
    if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_TRUST)) {
            db.createObjectStore(STORE_TRUST, { keyPath: 'folderId' });
        }
        if (!db.objectStoreNames.contains(STORE_HANDLES)) {
            db.createObjectStore(STORE_HANDLES, { keyPath: 'folderId' });
        }
    }
    // v1 → v2 — Epic 8 AI stores.
    if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_PROVIDER_CONFIG)) {
            db.createObjectStore(STORE_PROVIDER_CONFIG, {
                keyPath: ['folderId', 'providerName'],
            });
        }
        if (!db.objectStoreNames.contains(STORE_KEYS)) {
            db.createObjectStore(STORE_KEYS, {
                keyPath: ['folderId', 'providerName'],
            });
        }
        if (!db.objectStoreNames.contains(STORE_DISCLOSURE_ACK)) {
            db.createObjectStore(STORE_DISCLOSURE_ACK, {
                keyPath: ['folderId', 'providerName'],
            });
        }
    }
}

/**
 * Pluggable indexedDB-factory hook for tests. Production calls always use
 * `globalThis.indexedDB`; tests can call `__setIndexedDBForTests()` with an
 * in-memory shim. Reset to `null` to restore default.
 *
 * @type {IDBFactory | null}
 */
let testFactory = null;

/**
 * Replace the `indexedDB` factory used by all open calls. Tests pass the
 * in-memory shim from `__test-helpers__/in-memory-idb.js`. Pass `null` to
 * restore the default `globalThis.indexedDB`. Exported under a deliberately
 * ugly name to discourage misuse in production code.
 *
 * @param {IDBFactory | null} factory
 */
export function __setIndexedDBForTests(factory) {
    testFactory = factory;
}

function getFactory() {
    if (testFactory) return testFactory;
    if (typeof indexedDB === 'undefined') {
        throw new Error(
            'IndexedDB is not available in this environment. ' +
                'In tests, call __setIndexedDBForTests() with the in-memory shim.',
        );
    }
    return indexedDB;
}

/**
 * Open (or upgrade) the database. The `onupgradeneeded` handler runs
 * `applyMigrationsV1ToV2` so an AI-first cold start produces the same schema
 * as a studio-first cold start.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
    return new Promise((resolve, reject) => {
        const factory = getFactory();
        const req = factory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            /** @type {IDBDatabase} */
            const db = e.target.result;
            applyMigrationsV1ToV2(db, e.oldVersion);
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
        req.onblocked = () =>
            reject(
                new Error(
                    'IndexedDB open blocked: another tab holds the database at an older version. ' +
                        'Close other Lerret tabs and retry.',
                ),
            );
    });
}

/**
 * Run a single transaction against one store. Wrapped in a promise so the
 * caller can `await`. Errors propagate via `txn.onerror` (not `req.onerror`),
 * because compound-key request errors surface there in some browsers.
 *
 * @template T
 * @param {string} storeName
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T> | void} op
 * @returns {Promise<T | void>}
 */
async function withStore(storeName, mode, op) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const txn = db.transaction(storeName, mode);
        const store = txn.objectStore(storeName);
        /** @type {T | undefined} */
        let result;
        const req = op(store);
        if (req && 'onsuccess' in req) {
            req.onsuccess = () => {
                result = req.result;
            };
            req.onerror = (e) => reject(e.target.error);
        }
        txn.oncomplete = () => resolve(result);
        txn.onerror = (e) => reject(e.target.error);
        txn.onabort = (e) => reject(e.target.error ?? new Error('IDB transaction aborted'));
    });
}

// ─── ai_provider_config CRUD ─────────────────────────────────────────────────

/**
 * Upsert a provider config for `(folderId, providerName)`. Adds the compound
 * key fields to the record automatically.
 *
 * @param {{folderId: string, providerName: string, config: {active: boolean, model?: string, baseUrl?: string, configuredAt?: string}}} params
 * @returns {Promise<void>}
 */
export async function putProviderConfig({ folderId, providerName, config }) {
    requireFolderProvider(folderId, providerName);
    const record = {
        folderId,
        providerName,
        active: !!config.active,
        ...('model' in config ? { model: config.model } : {}),
        ...('baseUrl' in config ? { baseUrl: config.baseUrl } : {}),
        configuredAt: config.configuredAt ?? new Date().toISOString(),
    };
    await withStore(STORE_PROVIDER_CONFIG, 'readwrite', (s) => s.put(record));
}

/**
 * Aliased name matching the architecture/spec wording — same behavior as
 * `putProviderConfig`. Both names are exported because the story spec lists
 * both `set` and `put` shapes; provider-state code reads more naturally as
 * `setProviderConfig`, while the rest of the vault uses `put*` everywhere.
 *
 * @param {{folderId: string, providerName: string, config: {active: boolean, model?: string, baseUrl?: string, configuredAt?: string}}} params
 * @returns {Promise<void>}
 */
export const setProviderConfig = putProviderConfig;

/**
 * Get a single provider config. Returns `null` if not present.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<{folderId: string, providerName: string, active: boolean, model?: string, baseUrl?: string, configuredAt: string} | null>}
 */
export async function getProviderConfig({ folderId, providerName }) {
    requireFolderProvider(folderId, providerName);
    const v = await withStore(STORE_PROVIDER_CONFIG, 'readonly', (s) =>
        s.get([folderId, providerName]),
    );
    return v ?? null;
}

/**
 * List every provider config for a given folder. Cursor-walks the store and
 * filters in JS — small N (≤4 providers) so the linear scan is fine.
 *
 * @param {{folderId: string}} params
 * @returns {Promise<Array<{folderId: string, providerName: string, active: boolean, model?: string, baseUrl?: string, configuredAt: string}>>}
 */
export async function listProviderConfigs({ folderId }) {
    if (typeof folderId !== 'string' || folderId.length === 0) {
        throw new TypeError('listProviderConfigs: folderId must be a non-empty string');
    }
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const txn = db.transaction(STORE_PROVIDER_CONFIG, 'readonly');
        const store = txn.objectStore(STORE_PROVIDER_CONFIG);
        const req = store.openCursor();
        /** @type {Array<{folderId: string, providerName: string, active: boolean, model?: string, baseUrl?: string, configuredAt: string}>} */
        const out = [];
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (!cursor) return;
            if (cursor.value && cursor.value.folderId === folderId) {
                out.push(cursor.value);
            }
            cursor.continue();
        };
        req.onerror = (e) => reject(e.target.error);
        txn.oncomplete = () => resolve(out);
        txn.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Delete a provider config (e.g., on `Clear key`).
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<void>}
 */
export async function clearProviderConfig({ folderId, providerName }) {
    requireFolderProvider(folderId, providerName);
    await withStore(STORE_PROVIDER_CONFIG, 'readwrite', (s) =>
        s.delete([folderId, providerName]),
    );
}

// ─── ai_keys CRUD ────────────────────────────────────────────────────────────

/**
 * Store an encrypted key payload for `(folderId, providerName)`. The payload
 * is the `{iv, ciphertext}` from `crypto.encrypt()` — both base64-encoded.
 * This module NEVER touches plaintext key material.
 *
 * @param {{folderId: string, providerName: string, payload: {iv: string, ciphertext: string}}} params
 * @returns {Promise<void>}
 */
export async function putKey({ folderId, providerName, payload }) {
    requireFolderProvider(folderId, providerName);
    if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
        throw new TypeError('putKey: payload must be {iv, ciphertext} (both base64 strings)');
    }
    await withStore(STORE_KEYS, 'readwrite', (s) =>
        s.put({
            folderId,
            providerName,
            iv: payload.iv,
            ciphertext: payload.ciphertext,
        }),
    );
}

/**
 * Story-spec alias matching the architecture wording — same behavior.
 *
 * @param {{folderId: string, providerName: string, payload: {iv: string, ciphertext: string}}} params
 * @returns {Promise<void>}
 */
export const setEncryptedKey = putKey;

/**
 * Get the encrypted payload for `(folderId, providerName)`. Returns `null`
 * if not present. The returned `{iv, ciphertext}` is the ENCRYPTED blob —
 * the caller must invoke `crypto.decrypt` separately, and only inside the
 * provider's request-construction frame.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<{iv: string, ciphertext: string} | null>}
 */
export async function getKey({ folderId, providerName }) {
    requireFolderProvider(folderId, providerName);
    const v = await withStore(STORE_KEYS, 'readonly', (s) =>
        s.get([folderId, providerName]),
    );
    if (!v) return null;
    return { iv: v.iv, ciphertext: v.ciphertext };
}

/**
 * Story-spec alias matching the architecture wording — same behavior.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<{iv: string, ciphertext: string} | null>}
 */
export const getEncryptedKey = getKey;

/**
 * Delete the encrypted payload for `(folderId, providerName)`. Per AC-22:
 * `Clear key` clears the entry in `ai_keys` AND removes the row in
 * `ai_provider_config` — callers (settings-panel) do BOTH deletions.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<void>}
 */
export async function clearKey({ folderId, providerName }) {
    requireFolderProvider(folderId, providerName);
    await withStore(STORE_KEYS, 'readwrite', (s) =>
        s.delete([folderId, providerName]),
    );
}

/**
 * Story-spec alias matching the architecture wording — same behavior.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<void>}
 */
export const clearEncryptedKey = clearKey;

// ─── ai_disclosure_ack CRUD ──────────────────────────────────────────────────

/**
 * Record a privacy-disclosure acknowledgment for `(folderId, providerName)`.
 *
 * @param {{folderId: string, providerName: string, acknowledgedAt?: string}} params
 * @returns {Promise<void>}
 */
export async function putDisclosureAck({ folderId, providerName, acknowledgedAt }) {
    requireFolderProvider(folderId, providerName);
    await withStore(STORE_DISCLOSURE_ACK, 'readwrite', (s) =>
        s.put({
            folderId,
            providerName,
            acknowledgedAt: acknowledgedAt ?? new Date().toISOString(),
        }),
    );
}

/**
 * Story-spec alias matching the architecture wording — same behavior.
 *
 * @param {{folderId: string, providerName: string, acknowledgedAt?: string}} params
 * @returns {Promise<void>}
 */
export const recordDisclosureAck = putDisclosureAck;

/**
 * Get the disclosure-ack record for `(folderId, providerName)`, or `null` if
 * the user has never acknowledged.
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<{folderId: string, providerName: string, acknowledgedAt: string} | null>}
 */
export async function getDisclosureAck({ folderId, providerName }) {
    requireFolderProvider(folderId, providerName);
    const v = await withStore(STORE_DISCLOSURE_ACK, 'readonly', (s) =>
        s.get([folderId, providerName]),
    );
    return v ?? null;
}

/**
 * Convenience: boolean check used by the dock submit handler in Story 8.2
 * (before running a turn against a cloud provider) and by the disclosure
 * dialog (to decide whether to re-show).
 *
 * @param {{folderId: string, providerName: string}} params
 * @returns {Promise<boolean>}
 */
export async function isDisclosureAcked({ folderId, providerName }) {
    const ack = await getDisclosureAck({ folderId, providerName });
    return ack !== null;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Validate the `(folderId, providerName)` compound-key inputs. Both must be
 * non-empty strings. Centralized for consistency across CRUD methods.
 *
 * @param {unknown} folderId
 * @param {unknown} providerName
 */
function requireFolderProvider(folderId, providerName) {
    if (typeof folderId !== 'string' || folderId.length === 0) {
        throw new TypeError('vault/store: folderId must be a non-empty string');
    }
    if (typeof providerName !== 'string' || providerName.length === 0) {
        throw new TypeError('vault/store: providerName must be a non-empty string');
    }
}
