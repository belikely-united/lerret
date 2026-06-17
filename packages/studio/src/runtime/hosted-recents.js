// hosted-recents.js — recent hosted projects, persisted across reloads.
//
// A `FileSystemDirectoryHandle` is structured-cloneable, so we stash it in
// IndexedDB and re-open the same folder later with a single permission re-grant
// (no full folder picker). The persistence store is INJECTABLE so the
// list/remember/forget logic is unit-testable without IndexedDB. (Epic 10 / H7.)

const DB_NAME = 'lerret';
const STORE_NAME = 'recent-projects';

/** @typedef {{ id: string, name: string, handle: any, lastOpened: number }} RecentEntry */

/** @type {{ getAll: () => Promise<RecentEntry[]>, put: (e: RecentEntry) => Promise<void>, remove: (id: string) => Promise<void> } | null} */
let injectedStore = null;

/**
 * Inject a persistence store (tests / alternate hosts). Pass `null` to revert to
 * the lazy IndexedDB-backed default.
 *
 * @param {object | null} store
 */
export function setRecentsStore(store) {
  injectedStore = store;
}

function getStore() {
  if (!injectedStore) injectedStore = createIdbStore();
  return injectedStore;
}

/**
 * The default IndexedDB-backed store. Keyed by `id`.
 *
 * @returns {{ getAll: () => Promise<RecentEntry[]>, put: (e: RecentEntry) => Promise<void>, remove: (id: string) => Promise<void> }}
 */
export function createIdbStore() {
  const openDb = () =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const run = (mode, action) =>
    openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(STORE_NAME, mode);
          const req = action(t.objectStore(STORE_NAME));
          t.oncomplete = () => resolve(req ? req.result : undefined);
          t.onabort = () => reject(t.error);
          t.onerror = () => reject(t.error);
        }),
    );

  return {
    getAll: () => run('readonly', (s) => s.getAll()),
    put: (entry) => run('readwrite', (s) => s.put(entry)),
    remove: (id) => run('readwrite', (s) => s.delete(id)),
  };
}

/**
 * Recent projects, most-recently-opened first. Never throws — a storage failure
 * just yields an empty list (the connect screen still works).
 *
 * @returns {Promise<RecentEntry[]>}
 */
export async function listRecents() {
  try {
    const all = await getStore().getAll();
    return (all || []).slice().sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  } catch {
    return [];
  }
}

/**
 * Remember (or refresh) a project. Keyed by folder name; re-opening the same
 * name updates its `lastOpened` + handle. Never throws.
 *
 * @param {string} name
 * @param {any} handle  A `FileSystemDirectoryHandle`.
 */
export async function rememberRecent(name, handle) {
  try {
    await getStore().put({ id: name, name, handle, lastOpened: Date.now() });
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

/**
 * Drop a project from recents ("Forget this folder"). Never throws.
 *
 * @param {string} id
 */
export async function forgetRecent(id) {
  try {
    await getStore().remove(id);
  } catch {
    /* ignore */
  }
}
