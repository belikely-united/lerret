// Test-only in-memory IndexedDB shim for the vault store tests.
//
// Excluded from publish via the `!src/**/__test-helpers__/**` glob in
// packages/ai/package.json. Mirrors the surface of `IDBFactory` /
// `IDBDatabase` / `IDBTransaction` / `IDBObjectStore` / `IDBRequest` to the
// minimum extent the vault store tests actually exercise:
//
//   - `factory.open(name, version)` with `onupgradeneeded` (passes a
//      synthetic `event` with `target.result` = the db + `oldVersion`),
//      `onsuccess`, `onerror`.
//   - `db.objectStoreNames.contains(name)`.
//   - `db.createObjectStore(name, { keyPath })`.
//   - `db.transaction(name, mode).objectStore(name).{put, get, delete,
//      openCursor}` — including compound-key (`keyPath: [a, b]`) extraction
//      and array-key equality matching for get/delete.
//   - Transaction lifecycle: `txn.oncomplete` / `txn.onerror`.
//
// All request callbacks fire synchronously inside a microtask using
// `queueMicrotask` — matches the real-IDB ordering "request callback first,
// then transaction.oncomplete" closely enough for the tests' purposes.
//
// NOT supported: cursor `.continue()` calls past the synthetic in-memory
// cursor, index lookups, key-range queries, autoincrement, version-change
// events while open. Sufficient for the vault store tests; extend as needed.

/**
 * @returns {IDBFactory & {__db: InMemoryDatabase | null}}
 */
export function createInMemoryIDB() {
    /** @type {InMemoryDatabase | null} */
    let live = null;
    /** @type {{[name: string]: {keyPath: string | string[], records: Map<string, unknown>}}} */
    const stores = {};
    let storedVersion = 0;

    const factory = {
        open(name, version) {
            void name;
            const req = makeRequest();
            queueMicrotask(() => {
                const upgradeNeeded = version > storedVersion;
                if (upgradeNeeded) {
                    const oldVersion = storedVersion;
                    const db = makeDatabase(stores);
                    if (typeof req.onupgradeneeded === 'function') {
                        req.onupgradeneeded({ target: { result: db }, oldVersion });
                    }
                    storedVersion = version;
                    live = db;
                }
                if (!live) live = makeDatabase(stores);
                req.result = live;
                if (typeof req.onsuccess === 'function') {
                    req.onsuccess({ target: { result: live } });
                }
            });
            return req;
        },
        // Expose internals for test assertions.
        get __db() {
            return live;
        },
        get __stores() {
            return stores;
        },
    };
    return /** @type {any} */ (factory);
}

function makeRequest() {
    return {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
        result: undefined,
    };
}

function makeDatabase(stores) {
    return {
        objectStoreNames: {
            contains: (n) => Object.prototype.hasOwnProperty.call(stores, n),
        },
        createObjectStore(name, { keyPath }) {
            stores[name] = { keyPath, records: new Map() };
            return makeStoreHandle(stores[name]);
        },
        transaction(storeName, mode) {
            void mode;
            const names = Array.isArray(storeName) ? storeName : [storeName];
            const txn = {
                oncomplete: null,
                onerror: null,
                onabort: null,
                objectStore(n) {
                    if (!stores[n]) {
                        throw new Error(`no such store: ${n}`);
                    }
                    return makeStoreHandle(stores[n], txn);
                },
            };
            // Schedule txn completion AFTER request microtasks fire.
            queueMicrotask(() => {
                queueMicrotask(() => {
                    if (typeof txn.oncomplete === 'function') {
                        txn.oncomplete({ target: txn });
                    }
                });
            });
            void names;
            return txn;
        },
        close() {},
    };
}

/**
 * Build a synthetic IDBObjectStore handle that supports get / put / delete /
 * openCursor against the in-memory record map.
 *
 * Compound keys (`keyPath: ['a', 'b']`) are stringified as JSON for map
 * lookups; this matches IDB's own equality semantics for array keys
 * (component-by-component) closely enough for the tests' purposes.
 */
function makeStoreHandle(store, _txn) {
    return {
        put(value) {
            const key = computeKey(store.keyPath, value);
            store.records.set(key, structuredCloneSafe(value));
            return makeAutoRequest(undefined);
        },
        get(keyOrArray) {
            const key = encodeKey(keyOrArray);
            const v = store.records.get(key);
            return makeAutoRequest(v === undefined ? undefined : structuredCloneSafe(v));
        },
        delete(keyOrArray) {
            const key = encodeKey(keyOrArray);
            store.records.delete(key);
            return makeAutoRequest(undefined);
        },
        openCursor() {
            const entries = [...store.records.values()];
            const req = makeRequest();
            let index = 0;
            const advance = () => {
                if (index >= entries.length) {
                    if (typeof req.onsuccess === 'function') {
                        req.onsuccess({ target: { result: null } });
                    }
                    return;
                }
                const value = structuredCloneSafe(entries[index]);
                const cursor = {
                    value,
                    continue: () => {
                        index += 1;
                        queueMicrotask(advance);
                    },
                };
                if (typeof req.onsuccess === 'function') {
                    req.onsuccess({ target: { result: cursor } });
                }
            };
            queueMicrotask(advance);
            return req;
        },
    };
}

function makeAutoRequest(result) {
    const req = makeRequest();
    req.result = result;
    queueMicrotask(() => {
        if (typeof req.onsuccess === 'function') {
            req.onsuccess({ target: { result } });
        }
    });
    return req;
}

function computeKey(keyPath, value) {
    if (Array.isArray(keyPath)) {
        const parts = keyPath.map((p) => value[p]);
        return encodeKey(parts);
    }
    return encodeKey(value[keyPath]);
}

function encodeKey(keyOrArray) {
    if (Array.isArray(keyOrArray)) return JSON.stringify(keyOrArray);
    return JSON.stringify([keyOrArray]);
}

/**
 * Structured-clone the value defensively so test writers can't accidentally
 * mutate a stored record by holding the original reference. The shim is
 * tiny — handles plain objects, arrays, strings, numbers, booleans, null,
 * Uint8Array. (No Map/Set/Date here; the vault store doesn't write those.)
 */
function structuredCloneSafe(v) {
    if (typeof structuredClone === 'function') return structuredClone(v);
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Uint8Array) return new Uint8Array(v);
    if (Array.isArray(v)) return v.map(structuredCloneSafe);
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = structuredCloneSafe(x);
    return out;
}
