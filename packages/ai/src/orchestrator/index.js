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
    inspectorResponse,
    clarifyingNote,
    done,
    error,
    stopped,
    needsVisionFallback,
} from './events.js';

export { OrchestratorError, VisionUnavailable, TurnAborted } from './errors.js';

/**
 * The five agent node names — the single source of truth, re-exported by the
 * package barrel as `AGENT_NODES`. Epic 9 (ADR-006) collapsed the
 * Planner→Worker pair into one AgentExecutor node: the Planner survives as
 * the AgentExecutor's tool-incapable fallback module and the Worker as its
 * exclusive mutation module — neither is a GRAPH node anymore.
 *
 * @type {readonly string[]}
 */
export const AGENT_NODES = Object.freeze([
    'Orchestrator',
    'Memory',
    'DSCurator',
    'AgentExecutor',
    'Inspector',
]);
