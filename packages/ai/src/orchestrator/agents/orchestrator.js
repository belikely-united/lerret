// Orchestrator agent — routes the user's prompt to a plan, sequences the
// other nodes, and gates write actions. It is the graph's entry node.
//
// Routing decision (this story): `state.mode === 'inspect'` short-circuits to
// the read-only Inspector (Story 8.9 fleshes out inspect-mode); otherwise the
// turn flows through the generation path (Memory → DS Curator → Planner →
// Worker). The Orchestrator NEVER writes files and NEVER calls a provider —
// it only sequences.

import { thinking } from '../events.js';

/**
 * Create the Orchestrator entry node. Emits the opening `thinking` event and
 * passes through — the routing itself is the conditional edge in graph.js,
 * which calls {@link routeFromOrchestrator}.
 *
 * @param {{ emit: (ev: unknown) => void }} deps
 * @returns {(state: object) => Promise<object>}
 */
export function createOrchestratorNode({ emit }) {
    return async function orchestratorNode(state) {
        if (state?.signal?.aborted) return {};
        emit(thinking());
        // Normalize the routing mode onto state so the conditional edge is a
        // pure function of state.
        const mode = state?.mode === 'inspect' ? 'inspect' : 'generate';
        return { mode };
    };
}

/**
 * Conditional-edge router: read the normalized `mode` and pick the branch.
 * `inspect` → Inspector (read-only, Worker never reached); `generate` →
 * Memory (the generation pipeline).
 *
 * @param {object} state
 * @returns {'inspect' | 'generate'}
 */
export function routeFromOrchestrator(state) {
    return state?.mode === 'inspect' ? 'inspect' : 'generate';
}
