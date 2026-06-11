// LangGraph.js StateGraph topology — the six-node orchestrator.
//
// Plan A per the Story 8.0 bundle-spike gate (LangGraph.js approved
// unconditionally; measured 233.3 KB gzipped, comfortably inside the 500 KB
// Pass band — see docs/architecture/bundle-spike-2026-06-07.md). The graph is
// INTERNAL to @lerret/ai and never exposed via UI — per FR57, the user sees
// one AI behind one input; the six-node choreography is implementation detail.
//
// Topology:
//
//   START → Orchestrator → Memory ─┬─(inspect)→ Inspector → END
//                                  └─(generate)→ DSCurator → Planner → Worker → END
//
// Memory runs on BOTH branches so the Inspector and the Planner share the same
// project context. The Inspector branch never reaches the Worker — the
// structural read-only guarantee (FR58 / Story 8.9).
//
// Nodes emit TurnEvents via the out-of-band `emit` queue (see run-turn.js);
// state carries the turn's working data (manifest, plan, context, brand
// tokens). Events are NOT accumulated in state — that keeps yield-timing tight
// (a node mid-execution emits `writing` before it returns).

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

import { createOrchestratorNode, routeFromOrchestrator } from './agents/orchestrator.js';
import { createMemoryNode } from './agents/memory.js';
import { createDsCuratorNode } from './agents/ds-curator.js';
import { createPlannerNode } from './agents/planner.js';
import { createWorkerNode } from './agents/worker.js';
import { createInspectorNode } from './agents/inspector.js';

/**
 * The turn-state annotation. Input slots (prompt, scope, mode, attachments,
 * providerHandle, signal, manifest) are set once by run-turn.js; working
 * slots (context, brandTokens, plan, writtenFiles, answer) start from a
 * default and are filled by the nodes.
 */
export const TurnState = Annotation.Root({
    prompt: Annotation(),
    scope: Annotation(),
    mode: Annotation(),
    attachments: Annotation(),
    providerHandle: Annotation(),
    signal: Annotation(),
    manifest: Annotation({ reducer: (_, u) => u }),
    context: Annotation({ reducer: (_, u) => u, default: () => '' }),
    brandTokens: Annotation({ reducer: (_, u) => u, default: () => ({}) }),
    plan: Annotation({ reducer: (_, u) => u, default: () => [] }),
    writtenFiles: Annotation({ reducer: (_, u) => u, default: () => [] }),
    answer: Annotation({ reducer: (_, u) => u, default: () => '' }),
});

/**
 * Build + compile the six-node turn graph. The deps are bound into each node
 * factory; the compiled graph is driven by run-turn.js via `.stream(...)`.
 *
 * @param {{
 *   providerHandle: object,
 *   sandbox: object,
 *   fs: object,
 *   projectRoot: string,
 *   emit: (ev: unknown) => void,
 *   snapshot: object,
 *   requestVisionDecision: () => Promise<object>,
 * }} deps
 * @returns {object} The compiled LangGraph graph (has `.stream` / `.invoke`).
 */
export function createTurnGraph({ providerHandle, sandbox, fs, projectRoot, emit, snapshot, requestVisionDecision }) {
    const graph = new StateGraph(TurnState)
        .addNode('Orchestrator', createOrchestratorNode({ emit }))
        .addNode('Memory', createMemoryNode({ sandbox, emit }))
        .addNode('DSCurator', createDsCuratorNode({ sandbox, emit }))
        .addNode('Planner', createPlannerNode({ providerHandle, emit, requestVisionDecision, sandbox }))
        .addNode('Worker', createWorkerNode({ sandbox, fs, projectRoot, emit, snapshot }))
        .addNode('Inspector', createInspectorNode({ sandbox, providerHandle, emit }))
        .addEdge(START, 'Orchestrator')
        .addEdge('Orchestrator', 'Memory')
        .addConditionalEdges('Memory', routeFromOrchestrator, {
            inspect: 'Inspector',
            generate: 'DSCurator',
        })
        .addEdge('DSCurator', 'Planner')
        .addEdge('Planner', 'Worker')
        .addEdge('Worker', END)
        .addEdge('Inspector', END);

    return graph.compile();
}
