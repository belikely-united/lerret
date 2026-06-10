// TurnEvent discriminated union + factory helpers.
//
// The TurnEvent union is the ENTIRE contract between the orchestrator and the
// dock AI input cluster (Story 8.2). Per FR57 + UX-delta Anti-goal #3, the
// user sees ONE AI behind ONE input — the six-agent topology is never exposed.
// A graph node, a LangGraph state object, or an agent's intermediate reasoning
// is NEVER yielded as a TurnEvent; only the turn-level outcomes below.
//
// ─── Vision-fallback response mechanism (the documented choice) ──────────────
//
// When the orchestrator needs vision but the active model lacks it, it yields a
// `needs-vision-fallback` event AND blocks on a caller-supplied resolver:
//
//   runTurn({ ..., onVisionDecision: async (event) => ({ accept, providerOverride }) })
//
// We use the RESOLVER-CALLBACK form (NOT `.next(decision)` on the iterator)
// because:
//   1. It composes cleanly with `for await (const ev of runTurn(...))` — the
//      consumer's loop does not have to thread a value back through `.next()`,
//      which is awkward and easy to get wrong (the first `.next()` value is
//      always discarded by a for-await loop).
//   2. It is trivially testable — the integration suite passes a plain async
//      function and asserts the override path.
//   3. The dock (Story 8.2) renders the inline prompt (Story 8.7) inside the
//      resolver and resolves it when the user chooses.
//
// The resolver returns `{ accept: true, providerOverride: 'anthropic' }` to run
// the single vision call through the override, or `{ accept: false }` (or
// throws / returns undefined) to decline — the orchestrator then errors with
// `VisionUnavailable` and halts the turn.

/**
 * The canonical set of TurnEvent `type` strings. A typo in a node's event
 * construction fails `events.test.js` rather than silently mis-routing.
 *
 * @type {readonly string[]}
 */
export const TURN_EVENT_TYPES = Object.freeze([
    'thinking',
    'reading',
    'writing',
    'deleting',
    'mkdir',
    'tool-call',
    'done',
    'error',
    'stopped',
    'needs-vision-fallback',
]);

/**
 * @typedef {Object} TurnFileEntry
 * @property {string} path
 * @property {'create'|'edit'|'delete'} op
 */

/**
 * @typedef {{ type: 'thinking' }
 *   | { type: 'reading', file: string }
 *   | { type: 'writing', file: string }
 *   | { type: 'deleting', file: string }
 *   | { type: 'mkdir', dir: string }
 *   | { type: 'tool-call', name: string }
 *   | { type: 'done', files: Array<TurnFileEntry>, turnId?: string }
 *   | { type: 'error', error: { class: string, message: string } }
 *   | { type: 'stopped', turnId?: string }
 *   | { type: 'needs-vision-fallback', requiredCapability: 'vision', eligibleProviders: Array<{ name: string, model: string }> }
 * } TurnEvent
 */

/** @returns {TurnEvent} */
export function thinking() {
    return Object.freeze({ type: 'thinking' });
}

/** @param {string} file @returns {TurnEvent} */
export function reading(file) {
    return Object.freeze({ type: 'reading', file });
}

/** @param {string} file @returns {TurnEvent} */
export function writing(file) {
    return Object.freeze({ type: 'writing', file });
}

/** @param {string} file @returns {TurnEvent} */
export function deleting(file) {
    return Object.freeze({ type: 'deleting', file });
}

/** @param {string} dir @returns {TurnEvent} */
export function mkdir(dir) {
    return Object.freeze({ type: 'mkdir', dir });
}

/** @param {string} name @returns {TurnEvent} */
export function toolCall(name) {
    return Object.freeze({ type: 'tool-call', name });
}

/**
 * Terminal success event. When the turn's manifest id is supplied, it rides
 * along as `turnId` so the dock can target the revert action at THIS turn's
 * manifest without correlating out-of-band. `turnId` is included ONLY when
 * provided (a string) — older callers that omit it produce the historical
 * shape unchanged.
 *
 * @param {Array<TurnFileEntry>} files
 * @param {string} [turnId]  The turn-manifest id (revert target).
 * @returns {TurnEvent}
 */
export function done(files, turnId) {
    const ev = { type: 'done', files: Object.freeze([...(files ?? [])]) };
    if (typeof turnId === 'string') ev.turnId = turnId;
    return Object.freeze(ev);
}

/**
 * Normalize any thrown value into the `{ type: 'error', error: {class, message} }`
 * shape. NEVER embeds key material — only the error class name + message.
 *
 * @param {unknown} err
 * @returns {TurnEvent}
 */
export function error(err) {
    const cls =
        err && typeof err === 'object' && typeof err.name === 'string'
            ? err.name
            : 'Error';
    const message =
        err && typeof err === 'object' && typeof err.message === 'string'
            ? err.message
            : String(err);
    return Object.freeze({ type: 'error', error: Object.freeze({ class: cls, message }) });
}

/**
 * Terminal stop event. Like {@link done}, carries the turn-manifest id as
 * `turnId` ONLY when provided (a string) so the dock can revert a
 * stopped-mid-turn manifest.
 *
 * @param {string} [turnId]  The turn-manifest id (revert target).
 * @returns {TurnEvent}
 */
export function stopped(turnId) {
    const ev = { type: 'stopped' };
    if (typeof turnId === 'string') ev.turnId = turnId;
    return Object.freeze(ev);
}

/**
 * @param {Array<{ name: string, model: string }>} eligibleProviders
 * @returns {TurnEvent}
 */
export function needsVisionFallback(eligibleProviders) {
    return Object.freeze({
        type: 'needs-vision-fallback',
        requiredCapability: 'vision',
        eligibleProviders: Object.freeze([...(eligibleProviders ?? [])]),
    });
}
