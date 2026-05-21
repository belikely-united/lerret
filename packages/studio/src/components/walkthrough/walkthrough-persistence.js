// walkthrough-persistence.js
//
// First-ever-visit detection and completion/skip state persistence for the
// studio walkthrough.
//
// ── Persistence choice ────────────────────────────────────────────────────────
// Uses `localStorage` rather than the IndexedDB layer (persistence.js / Story
// 5.5). Rationale: the walkthrough's state is a single boolean-ish flag (a
// timestamp string or absent), with no need for the FSA-handle identity or
// cross-transaction guarantees that IDB was chosen for . localStorage
// is synchronous, simpler to mock in tests, and sufficient for this use case.
//
// Key: "lerret:walkthrough:completedAt" — ISO-8601 string set on completion.
// Key: "lerret:walkthrough:skippedAt" — ISO-8601 string set on skip.
//
// Both keys live in localStorage under the origin, isolated per browser profile.
// Clearing localStorage resets the walkthrough (expected developer behaviour).
// ─────────────────────────────────────────────────────────────────────────────

const KEY_COMPLETED = 'lerret:walkthrough:completedAt';
const KEY_SKIPPED = 'lerret:walkthrough:skippedAt';

/**
 * Return true if this is the user's first ever visit — i.e. neither a
 * completion nor a skip has been recorded in localStorage.
 *
 * Safe in SSR / test environments where `localStorage` may be undefined.
 *
 * @returns {boolean}
 */
export function isFirstEverVisit() {
 try {
 const completed = localStorage.getItem(KEY_COMPLETED);
 const skipped = localStorage.getItem(KEY_SKIPPED);
 return completed === null && skipped === null;
 } catch {
 // localStorage blocked (private-browsing mode, storage quota, SSR) →
 // treat as first visit so the offer is shown once.
 return true;
 }
}

/**
 * Record that the walkthrough was completed (walked to the final "Done" step).
 * Idempotent — calling it again only updates the timestamp.
 *
 * @returns {void}
 */
export function recordWalkthroughCompleted() {
 try {
 localStorage.setItem(KEY_COMPLETED, new Date().toISOString());
 } catch {
 // No-op when storage is unavailable.
 }
}

/**
 * Record that the walkthrough was skipped (dismissed before the last step).
 * Idempotent.
 *
 * @returns {void}
 */
export function recordWalkthroughSkipped() {
 try {
 localStorage.setItem(KEY_SKIPPED, new Date().toISOString());
 } catch {
 // No-op when storage is unavailable.
 }
}

/**
 * Clear both state keys — used by tests to reset the store between cases.
 * Not part of the public production surface.
 *
 * @returns {void}
 */
export function clearWalkthroughState() {
 try {
 localStorage.removeItem(KEY_COMPLETED);
 localStorage.removeItem(KEY_SKIPPED);
 } catch {
 // No-op.
 }
}
