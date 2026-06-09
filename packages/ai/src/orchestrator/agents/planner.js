// Planner agent — decomposes a high-level prompt into a sequence of concrete
// file-target WorkerStep objects by calling the active provider.
//
// The Planner is the only agent (besides the Inspector) that calls the
// provider — and it does so ONLY through the provider-handle passed in, never
// by constructing its own fetch. It also owns the vision-fallback DECISION
// point: if the turn carries an image attachment and the active model lacks
// vision, it requests a fallback decision via the bridge supplied by
// run-turn.js (which enumerates eligible providers, emits the
// `needs-vision-fallback` event, and either returns a configured override
// handle or throws VisionUnavailable).
//
// Story 8.3 ships the generic decomposition path. Story 8.8 extends with
// preset-aware W2/W3 planning — extend, do not rewrite.

import { thinking } from '../events.js';

/**
 * Build the messages array for the planning call. Injects the Memory context
 * + brand tokens so the plan respects the user's brand.
 *
 * @param {object} state
 * @returns {Array<{ role: string, content: string }>}
 */
function buildPlanningMessages(state) {
    const brand = state.brandTokens && Object.keys(state.brandTokens).length
        ? `\n\nBrand tokens (authoritative): ${JSON.stringify(state.brandTokens)}`
        : '';
    const context = state.context ? `\n\nProject context:\n${state.context}` : '';
    return [
        {
            role: 'system',
            content:
                'You are Lerret\'s asset planner. Decompose the user\'s request into a JSON ' +
                'array of file operations. Respond with ONLY a JSON object of the form ' +
                '{"steps":[{"op":"write"|"delete"|"mkdir","path":"...","content":"..."}]}. ' +
                'All paths MUST be under .lerret/.' +
                brand +
                context,
        },
        { role: 'user', content: String(state.prompt ?? '') },
    ];
}

/**
 * Parse the provider's planning response into a WorkerStep array. Tolerant of
 * a fenced ```json block or a bare JSON object. Returns [] on unparseable
 * output (the turn then completes with no writes rather than crashing).
 *
 * @param {string} content
 * @returns {Array<import('./worker.js').WorkerStep>}
 */
export function parsePlan(content) {
    if (typeof content !== 'string') return [];
    let text = content.trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    if (fence) text = fence[1].trim();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps;
    if (!Array.isArray(steps)) return [];
    return steps.filter(
        (s) => s && typeof s.op === 'string' && typeof s.path === 'string',
    );
}

/**
 * Create the Planner node.
 *
 * @param {{
 *   providerHandle: import('./types.js').ProviderHandle,
 *   emit: (ev: unknown) => void,
 *   requestVisionDecision: () => Promise<import('./types.js').ProviderHandle>,
 * }} deps
 * @returns {(state: object) => Promise<{ plan: Array<object> }>}
 */
export function createPlannerNode({ providerHandle, emit, requestVisionDecision }) {
    return async function plannerNode(state) {
        if (state?.signal?.aborted) return { plan: [] };
        emit(thinking());

        // Vision-fallback decision (FR56). Heuristic for this story: any
        // attached image triggers vision-required (Story 8.7 supplies the
        // richer isVisionRequired()).
        const attachments = Array.isArray(state.attachments) ? state.attachments : [];
        const needsVision = attachments.some((a) => a && a.type === 'image');
        let handle = providerHandle;
        if (needsVision && !providerHandle.modelSupportsVision(providerHandle.model)) {
            // requestVisionDecision (from run-turn) returns a configured
            // override handle on accept, or throws VisionUnavailable on
            // decline / no-eligible-provider. The override routes JUST this
            // vision call; the turn continues with the active handle for
            // non-vision steps (there are none after planning in this story).
            handle = await requestVisionDecision();
        }

        const result = await handle.complete({
            messages: buildPlanningMessages(state),
            signal: state.signal,
        });
        const plan = parsePlan(result?.content ?? '');
        return { plan };
    };
}
