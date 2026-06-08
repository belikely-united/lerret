/**
 * @lerret/ai — in-studio AI subsystem for Lerret.
 *
 * Reached only via `await import('@lerret/ai')` from @lerret/studio and @lerret/cli.
 * A static import of this package from anywhere outside packages/ai/ is an enforced
 * lint/test violation (see no-static-imports.test.js).
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * BUNDLE-SPIKE SKELETON (Story 8.0)
 * ─────────────────────────────────────────────────────────────────────────────────
 * This v0.1.0 release is intentionally minimal — its only purpose is to measure
 * the production-bundle weight of LangGraph.js inside @lerret/ai. The full
 * orchestrator implementation lands in Story 8.3; the six-node topology and node
 * names below are from architecture-epic-8.md §Multi-Agent Orchestrator and will
 * carry forward to the real implementation regardless of whether Plan A
 * (LangGraph.js) or Plan B (custom orchestrator) wins.
 *
 * The graph MUST be constructed at module-import time (not inside a lazy factory),
 * otherwise Rollup/Vite tree-shaking would drop LangGraph from the bundle and
 * the measurement would not reflect what a user's browser actually loads.
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

/**
 * Spike state schema — a single `messages` slot so the graph compiles. The real
 * orchestrator's state shape (turn id, scope, provider handle, snapshot manifest)
 * lives in Story 8.3.
 */
const SpikeState = Annotation.Root({
    messages: Annotation({
        reducer: (current, update) => current.concat(update),
        default: () => [],
    }),
});

/**
 * No-op passthrough used for every spike node. Each node returns an empty update
 * so LangGraph's state-merge path is exercised faithfully.
 */
const passthrough = () => ({ messages: [] });

/**
 * The six agent nodes named in architecture-epic-8.md §Multi-Agent Orchestrator.
 * The names are public surface — Story 8.3's implementation keeps them verbatim.
 */
export const AGENT_NODES = Object.freeze([
    'Orchestrator',
    'Memory',
    'Planner',
    'Worker',
    'DSCurator',
    'Inspector',
]);

/**
 * The spike graph itself — constructed at module-import time so the bundle
 * faithfully includes every LangGraph dependency that the real orchestrator
 * will pull in. A simple linear chain is sufficient; topology is irrelevant
 * for the bundle measurement.
 */
const spikeGraph = new StateGraph(SpikeState)
    .addNode('Orchestrator', passthrough)
    .addNode('Memory', passthrough)
    .addNode('Planner', passthrough)
    .addNode('Worker', passthrough)
    .addNode('DSCurator', passthrough)
    .addNode('Inspector', passthrough)
    .addEdge(START, 'Orchestrator')
    .addEdge('Orchestrator', 'Memory')
    .addEdge('Memory', 'Planner')
    .addEdge('Planner', 'Worker')
    .addEdge('Worker', 'DSCurator')
    .addEdge('DSCurator', 'Inspector')
    .addEdge('Inspector', END)
    .compile();

/**
 * Stub turn runner. Shape parity with the eventual public surface
 * (`runTurn({prompt, scope, signal, providerOverride?}) → AsyncIterable<TurnEvent>`),
 * minus all real behavior. Yields two sentinel events (`thinking`, then
 * `done`) so callers can verify the iterable contract.
 *
 * @param {Object} [params]
 * @param {string} [params.prompt]
 * @param {Object} [params.scope]
 * @param {AbortSignal} [params.signal]
 * @param {Object} [params.providerOverride]
 * @returns {AsyncGenerator<{type: string, files?: Array<unknown>}>}
 */
export async function* runTurn(params = {}) {
    void params;
    void spikeGraph;
    yield { type: 'thinking' };
    yield { type: 'done', files: [] };
}

/**
 * Package version, for debugging output. Kept in lockstep with package.json by
 * the release script. Mirrors the convention from @lerret/animation.
 */
export const VERSION = '0.1.0';

// Snapshot subsystem (Story 8.5): per-turn manifests + content-addressed
// blob store + revert/redo API + retention. Reached as `ai.snapshot.X`.
export * as snapshot from './snapshot/index.js';
