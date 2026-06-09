// In-memory session-key lifecycle for the per-folder encrypted key vault.
//
// Implements the per-session unlock model mandated by ADR-005 §Decision 5 and
// AC-9 of story 8.1: the derived AES-GCM CryptoKey lives in a module-level
// variable, is memoized per `folderId` for the lifetime of the page, and is
// cleared on whichever fires first:
//
//   - `pagehide` event (browser tab close, navigation, bfcache eviction)
//   - `beforeunload` event (legacy fallback for older browsers / iframes)
//   - 5 minutes after `visibilitychange: hidden` (the tab is backgrounded)
//
// NOTE on the timing semantics: the 5-minute timer measures TIME SINCE THE TAB
// WAS BACKGROUNDED, not 5 minutes of no user activity. A tab left open and
// VISIBLE but unused (e.g. on a second monitor) holds the derived key in
// memory until `pagehide`/`beforeunload`. True activity-tracked idle (resetting
// on pointer/key events) is a deliberate non-goal for Epic 8 v1; do not
// describe this as "5 minutes of inactivity."
//
// On clear, the cached `CryptoKey` reference is set to `null`; any in-flight
// `getSessionKey(folderId)` promise that resolved BEFORE the clear remains
// valid for its current caller's execution, but subsequent calls re-derive
// fresh. This matches AC-9 verbatim: "any in-flight unwrap is invalidated"
// from the cache-lookup perspective, while the synchronous frame that already
// holds the key reference is undisturbed (otherwise a clear during the middle
// of `encrypt()` would corrupt the call frame — Web Crypto is async, the
// caller holds a stable promise reference).
//
// ─── Test-environment compatibility ──────────────────────────────────────────
//
// In Node / Vitest, `document` and `window` are undefined; the listener
// installation is a no-op. Tests can call `clearSessionKey()` explicitly to
// exercise the cache-eviction path.

import { deriveFolderKey } from './crypto.js';

/**
 * Auto-clear timeout: 5 minutes after the tab is backgrounded
 * (`visibilitychange: hidden`) before the cached key is cleared. Per ADR-005
 * §Decision 5. (This is backgrounded-time, not activity-idle-time — see the
 * file header.)
 *
 * @type {number}
 */
export const IDLE_MS = 5 * 60 * 1000;

/** @type {CryptoKey | null} */
let cachedKey = null;
/** @type {string | null} */
let cachedFolderId = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let idleTimer = null;
let listenersInstalled = false;
/** @type {Promise<CryptoKey> | null} */
let inFlightDerivation = null;

/**
 * Resolve a cached or freshly-derived AES-GCM key for `folderId`.
 *
 * Memoization is per-`folderId`: switching folders evicts the previous folder's
 * key from cache (a fresh derivation runs for the new folder). The eviction
 * boundary lines up with the IDB store boundary — there is no cross-folder
 * key reuse.
 *
 * Concurrent calls during a single derivation share the in-flight promise so
 * we never run PBKDF2 twice for the same folder simultaneously.
 *
 * @param {string} folderId
 * @returns {Promise<CryptoKey>}
 */
export async function getSessionKey(folderId) {
    if (typeof folderId !== 'string' || folderId.length === 0) {
        throw new TypeError('getSessionKey: folderId must be a non-empty string');
    }
    if (cachedKey && cachedFolderId === folderId) return cachedKey;
    if (inFlightDerivation && cachedFolderId === folderId) return inFlightDerivation;

    // Switching folders — drop the previous folder's cache entry.
    cachedKey = null;
    cachedFolderId = folderId;

    inFlightDerivation = (async () => {
        const derived = await deriveFolderKey(folderId);
        // Only commit the cache if no clear ran during derivation AND we are
        // still on the same folder.
        if (cachedFolderId === folderId) {
            cachedKey = derived;
        }
        return derived;
    })();
    try {
        const result = await inFlightDerivation;
        installListeners(); // idempotent
        return result;
    } finally {
        inFlightDerivation = null;
    }
}

/**
 * Forcibly clear the cached key + folder identity. Cancels any pending idle
 * timer. Safe to call multiple times. After clear, the next `getSessionKey()`
 * call re-derives fresh.
 *
 * Exported so the UI (e.g., a "Lock vault now" affordance) and tests can
 * invoke it directly.
 */
export function clearSessionKey() {
    cachedKey = null;
    cachedFolderId = null;
    if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

/**
 * Reset listener-installation state. Test-only — production code should
 * never need to remove the lifecycle hooks, since they fire at most once
 * per page session.
 *
 * Exported under a deliberately ugly name to discourage misuse outside tests.
 */
export function __resetForTests() {
    clearSessionKey();
    listenersInstalled = false;
    inFlightDerivation = null;
}

/**
 * Install the lifecycle listeners exactly once per module load. No-op in any
 * environment that lacks `window` / `document` (Node, Vitest's default
 * environment, web workers without the DOM globals).
 *
 * @returns {void}
 */
function installListeners() {
    if (listenersInstalled) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    window.addEventListener('pagehide', clearSessionKey);
    window.addEventListener('beforeunload', clearSessionKey);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Don't stack timers — replace any prior pending clear.
            if (idleTimer !== null) clearTimeout(idleTimer);
            idleTimer = setTimeout(clearSessionKey, IDLE_MS);
        } else if (idleTimer !== null) {
            // User came back; abort the pending clear.
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    });

    listenersInstalled = true;
}
