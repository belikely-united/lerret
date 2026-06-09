// Orchestrator-level typed errors.
//
// Mirrors the providers/errors.js ProviderError shape — a domain-prefixed
// `name`, a structured payload, and NEVER any key material. Turn-level
// failures the orchestrator raises (vision unavailable, turn aborted) are
// distinguishable from provider errors (which bubble up unchanged) so the
// dock can render the right message.

/**
 * Base class for orchestrator-raised turn errors.
 *
 * @property {string} name  Always a domain-prefixed subclass name.
 * @property {string} code  Stable identifier for programmatic branching.
 */
export class OrchestratorError extends Error {
    /**
     * @param {string} message
     * @param {string} code
     * @param {Record<string, unknown>} [details]
     */
    constructor(message, code, details) {
        super(message);
        this.name = 'OrchestratorError';
        this.code = code;
        if (details) this.details = details;
    }
}

/**
 * Raised when a turn requires vision but the active model lacks it AND no
 * cloud vision-capable provider is configured (or the user declined the
 * fallback). The snapshot (if a manifest was created) finalizes to `'error'`
 * — no auto-revert; the user decides whether to revert via the timeline.
 *
 * @property {string} activeProvider
 * @property {string} activeModel
 */
export class VisionUnavailable extends OrchestratorError {
    /**
     * @param {{ activeProvider: string, activeModel: string, reason?: string }} init
     */
    constructor({ activeProvider, activeModel, reason }) {
        super(
            `This turn needs vision, but the active model '${activeModel}' (${activeProvider}) can't see images` +
                (reason ? ` — ${reason}` : '') +
                '. Configure a cloud vision-capable provider to enable it.',
            'VISION_UNAVAILABLE',
            { activeProvider, activeModel },
        );
        this.name = 'VisionUnavailable';
        this.activeProvider = activeProvider;
        this.activeModel = activeModel;
    }
}

/**
 * Raised internally to unwind a turn when the AbortSignal fires. The
 * orchestrator catches this and finalizes the manifest to `'stopped-mid-turn'`,
 * then yields a terminal `stopped` event — it is NOT surfaced as an `error`
 * event (stop is a clean terminal state, not a failure).
 */
export class TurnAborted extends OrchestratorError {
    constructor() {
        super('the turn was stopped by the user', 'TURN_ABORTED');
        this.name = 'TurnAborted';
    }
}
