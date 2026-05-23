// live-refresh-suspend.js — global suspension switch for liveRefresh ticks.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// `liveRefresh`-configured assets re-render on a timer via
// `runtime.notifyChange(path)` (see live-refresh-manager.js). That reload
// re-renders the artboard's whole subtree — including any modal dialog mounted
// inside the artboard's `ComponentArtboardKebab` (the animated-export dialog)
// or opened from its kebab (the move picker).
//
// A background re-render mid-interaction closes native `<select>` popups: the
// user opens the Format/FPS/Duration dropdown in the export dialog, a
// liveRefresh tick fires ~1s later, the dialog subtree reconciles, and the
// browser dismisses the open native popup. The user can never make a
// selection on a live page.
//
// The fix: while a modal dialog is open we SUSPEND the liveRefresh manager's
// `notifyChange` calls. The asset's own internal animation (e.g. a clock's
// `setInterval(() => setNow(new Date()))`) keeps ticking, and the animated
// capture pipeline drives its own frame timing — so suspending the studio's
// reload timer does NOT freeze the asset or break capture. It only stops the
// background reload churn that was eating the dropdown.
//
// ── Contract ────────────────────────────────────────────────────────────────
// `suspendLiveRefresh()` increments a counter and returns a one-shot
// `release()` you call when the dialog closes (idempotent). `isLiveRefreshSuspended()`
// is read by the live-refresh-manager's interval callback before each tick.
// A counter (not a boolean) so overlapping dialogs compose correctly.

let suspendCount = 0;

/**
 * Suspend liveRefresh `notifyChange` ticks. Returns a one-shot release
 * function — call it (e.g. from a `useEffect` cleanup) when the modal closes.
 * Idempotent: calling the returned function more than once is a no-op.
 *
 * @returns {() => void} release
 */
export function suspendLiveRefresh() {
  suspendCount += 1;
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    suspendCount = Math.max(0, suspendCount - 1);
  };
}

/**
 * Whether liveRefresh ticks are currently suspended (any modal open).
 *
 * @returns {boolean}
 */
export function isLiveRefreshSuspended() {
  return suspendCount > 0;
}

/**
 * Test-only: reset the suspension counter to zero. Not used in app code.
 *
 * @returns {void}
 */
export function __resetLiveRefreshSuspendForTests() {
  suspendCount = 0;
}
