// Public surface of the orchestrator subsystem. Reached from outside
// @lerret/ai as `ai.orchestrator.X` (and `runTurn` is ALSO a top-level export
// of @lerret/ai for the dock's convenience).
//
// The orchestrator topology (the six-node LangGraph graph) is INTERNAL — only
// the `runTurn` entry, the TurnEvent contract, and the typed errors are
// public. A graph node or LangGraph state object is never exposed (FR57).

export { runTurn } from './run-turn.js';

export {
    TURN_EVENT_TYPES,
    thinking,
    reading,
    writing,
    deleting,
    mkdir,
    toolCall,
    done,
    error,
    stopped,
    needsVisionFallback,
} from './events.js';

export { OrchestratorError, VisionUnavailable, TurnAborted } from './errors.js';

/**
 * The six agent node names — the single source of truth, re-exported by the
 * package barrel as `AGENT_NODES`. Verbatim from architecture-epic-8.md
 * §Multi-Agent Orchestrator.
 *
 * @type {readonly string[]}
 */
export const AGENT_NODES = Object.freeze([
    'Orchestrator',
    'Memory',
    'Planner',
    'Worker',
    'DSCurator',
    'Inspector',
]);
