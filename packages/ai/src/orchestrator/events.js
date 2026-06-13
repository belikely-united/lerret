// TurnEvent discriminated union + factory helpers.
//
// The TurnEvent union is the ENTIRE contract between the orchestrator and the
// dock AI input cluster (Story 8.2). Per FR57 + UX-delta Anti-goal #3, the
// user sees ONE AI behind ONE input — the six-agent topology is never exposed.
// A graph node, a LangGraph state object, or an agent's intermediate reasoning
// is NEVER yielded as a TurnEvent; only the turn-level outcomes below.
//
// Epic 9 follow-up (#3 — "show the orchestration"): the `phase` event is the
// one deliberate nuance to that rule. It carries a small, STABLE, user-facing
// PROGRESS vocabulary (understanding | context | brand | working | exploring)
// — NOT the internal graph node CLASS names. The studio maps each slug to a
// friendly present-tense line ("Checking your brand"); "Orchestrator" /
// "DSCurator" / "AgentExecutor" still never reach the UI. So FR57 ("one AI,
// topology not exposed") holds in spirit while an agent that ACTS over many
// steps shows its work instead of being a black box (the addendum-2 retro
// lesson: an agent that acts needs a way to show its work).
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
    'phase',
    'reading',
    'writing',
    'deleting',
    'mkdir',
    'tool-call',
    'clarifying-note',
    'inspector-response',
    'done',
    'error',
    'stopped',
    'needs-vision-fallback',
    'turn-progress',
    'needs-continue',
]);

/**
 * @typedef {Object} TurnFileEntry
 * @property {string} path
 * @property {'create'|'edit'|'delete'} op
 */

/**
 * @typedef {{ type: 'thinking' }
 *   | { type: 'phase', phase: 'understanding'|'context'|'brand'|'working'|'exploring' }
 *   | { type: 'reading', file: string }
 *   | { type: 'writing', file: string }
 *   | { type: 'deleting', file: string }
 *   | { type: 'mkdir', dir: string }
 *   | { type: 'tool-call', name: string, target?: string, why?: string }
 *   | { type: 'clarifying-note', note: string, token?: string, designSystemValue?: string, configValue?: string }
 *   | { type: 'inspector-response', answer: string }
 *   | { type: 'done', files: Array<TurnFileEntry>, turnId?: string, summary?: string }
 *   | { type: 'error', error: { class: string, message: string } }
 *   | { type: 'stopped', turnId?: string }
 *   | { type: 'needs-vision-fallback', requiredCapability: 'vision', eligibleProviders: Array<{ name: string, model: string }> }
 *   | { type: 'turn-progress', turn: number, maxTurns: number, spentTokens: number }
 *   | { type: 'needs-continue', turnsUsed: number, spentTokens: number }
 * } TurnEvent
 */

/** @returns {TurnEvent} */
export function thinking() {
    return Object.freeze({ type: 'thinking' });
}

/**
 * A coarse PROGRESS phase for the live activity feed (Epic 9 follow-up #3 —
 * the user asked to "see which agent is thinking, what's going on"). `name` is
 * a small, STABLE, user-facing progress vocabulary
 * (`understanding | context | brand | working | exploring`), DECOUPLED from the
 * internal graph node class names — the studio maps each slug to a friendly
 * present-tense line, so raw node identity is never rendered (see header note;
 * FR57 holds in spirit). Feed-only: never a pill state, never blocks, the turn
 * always proceeds. Emitted once at each node's entry by the graph seam.
 *
 * @param {'understanding'|'context'|'brand'|'working'|'exploring'} name
 * @returns {TurnEvent}
 */
export function phase(name) {
    return Object.freeze({ type: 'phase', phase: String(name ?? '') });
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

/**
 * A loop tool call about to execute. Epic 9 follow-up #4 (§6.5 — the
 * self-managing verbose timeline): the event now also carries, when known, the
 * `target` (the path the tool acts on — straight from the tool-call args, so
 * it's available the instant the call is parsed) and `why` (the model's
 * natural-language preamble for this step — its `response.text`, available the
 * instant generation returns). The dock's now-line reads "Editing
 * kit/banner.jsx — updating the headline colour" instead of a bare "Writing
 * files…". Both are OPTIONAL and only included when non-empty — legacy callers
 * passing only `name` produce the historical shape unchanged. Still never a raw
 * node/agent name (FR57 spirit): the dock owns the friendly verb.
 *
 * @param {string} name
 * @param {{ target?: string, why?: string }} [meta]
 * @returns {TurnEvent}
 */
export function toolCall(name, meta = {}) {
    const ev = { type: 'tool-call', name };
    if (typeof meta.target === 'string' && meta.target.trim()) ev.target = meta.target.trim();
    if (typeof meta.why === 'string' && meta.why.trim()) ev.why = meta.why.trim();
    return Object.freeze(ev);
}

/**
 * A calm, factual note that two brand-authority sources disagree (the DS
 * Curator's conflict surface — architecture §Multi-Agent Orchestrator: the
 * note shows in the turn-outcome card; the turn PROCEEDS with the
 * `_design-system.md` value, never blocks). `note` is the finished user-facing
 * sentence; the structured fields ride along for richer future UI.
 *
 * @param {string} note
 * @param {{ token?: string, designSystemValue?: string, configValue?: string }} [details]
 * @returns {TurnEvent}
 */
export function clarifyingNote(note, details = {}) {
    return Object.freeze({
        type: 'clarifying-note',
        note: typeof note === 'string' ? note : String(note ?? ''),
        ...(typeof details.token === 'string' && details.token ? { token: details.token } : {}),
        ...(typeof details.designSystemValue === 'string'
            ? { designSystemValue: details.designSystemValue }
            : {}),
        ...(typeof details.configValue === 'string' ? { configValue: details.configValue } : {}),
    });
}

/**
 * The Inspector's single-turn answer (Story 8.9, FR58). Per UX Anti-goal #3
 * the thread renders THIS answer text — never raw agent internals — so the
 * payload is the finished, user-facing answer string. Exactly one
 * `inspector-response` precedes the terminal `done` of a successful
 * inspect-mode turn; ask-mode turns never emit it.
 *
 * @param {string} answer  The Inspector's user-facing answer text.
 * @returns {TurnEvent}
 */
export function inspectorResponse(answer) {
    return Object.freeze({
        type: 'inspector-response',
        answer: typeof answer === 'string' ? answer : String(answer ?? ''),
    });
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
 * @param {string} [summary]  The agent's closing summary text (Epic 9 loop
 *   turns end with a short "what I did" — the thread shows it as the
 *   outcome line). Omitted for inspect turns and legacy single-shot plans.
 * @returns {TurnEvent}
 */
export function done(files, turnId, summary) {
    const ev = { type: 'done', files: Object.freeze([...(files ?? [])]) };
    if (typeof turnId === 'string') ev.turnId = turnId;
    if (typeof summary === 'string' && summary.trim().length > 0) {
        ev.summary = summary.trim();
    }
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

/**
 * Coerce a numeric-ish input to a plain number for event payloads —
 * `Number()` semantics with NaN normalized to 0, so a malformed provider
 * `usage` field can never put NaN in front of the dock.
 *
 * @param {unknown} value
 * @returns {number}
 */
function asEventNumber(value) {
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
}

/**
 * Loop heartbeat (Story 9.1, architecture-epic-9 §6): the agent loop emits
 * one per completed loop turn. Drives the dock's quiet turn counter
 * ("Turn 3/10") and the running spend line — `spentTokens` is the CUMULATIVE
 * input+output token count for the whole user-perceived turn, never this
 * iteration's delta (BYOK users pay directly, so spend is shown live and
 * honestly; ADR-006 Consequences).
 *
 * @param {number} turn
 * @param {number} maxTurns
 * @param {number} spentTokens
 * @returns {TurnEvent}
 */
export function turnProgress(turn, maxTurns, spentTokens) {
    return Object.freeze({
        type: 'turn-progress',
        turn: asEventNumber(turn),
        maxTurns: asEventNumber(maxTurns),
        spentTokens: asEventNumber(spentTokens),
    });
}

/**
 * The agent loop hit its turn cap with the model still requesting tools
 * (Story 9.1, ADR-006 §3: never a silent stop). Mirrors
 * `needs-vision-fallback`'s resolver-callback pattern (see header comment):
 * the loop emits this AND blocks on the caller-supplied `onContinueDecision`
 * resolver; the dock renders the inline "Paused after N steps — Continue /
 * Stop here" affordance inside the resolver and resolves it when the user
 * chooses. Never emitted headless — with no resolver the loop cap-stops
 * immediately instead of asking nobody.
 *
 * @param {number} turnsUsed
 * @param {number} spentTokens
 * @returns {TurnEvent}
 */
export function needsContinue(turnsUsed, spentTokens) {
    return Object.freeze({
        type: 'needs-continue',
        turnsUsed: asEventNumber(turnsUsed),
        spentTokens: asEventNumber(spentTokens),
    });
}
