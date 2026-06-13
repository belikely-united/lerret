// LangGraph.js StateGraph topology — the five-node orchestrator (Epic 9).
//
// Plan A per the Story 8.0 bundle-spike gate (LangGraph.js approved
// unconditionally — see docs/architecture/bundle-spike-2026-06-07.md). The
// graph is INTERNAL to @lerret/ai and never exposed via UI — per FR57, the
// user sees one AI behind one input.
//
// Topology (ADR-006 — Epic 9 collapsed Planner→Worker into one Agent
// Executor node; the graph went 6 → 5 nodes):
//
//   START → Orchestrator → Memory ─┬─(inspect)→ Inspector → END
//                                  └─(generate)→ DSCurator → AgentExecutor → END
//
// The Worker is no longer a graph NODE — it survives as the mutation MODULE
// (`agents/worker.js`): the Agent Executor runs every write/delete tool
// execution (and every deterministic W2/W3 plan, and the tool-incapable
// single-shot fallback) through `createWorkerNode` single-step plans, so the
// single-mutator guarantee, snapshot pre-capture, and NFR18 semantics are
// unchanged. Memory and DSCurator stay: they are zero-provider-call context
// nodes — removing them would save nothing and lose the brand pipeline.
//
// Memory runs on BOTH branches so the Inspector and the Agent Executor share
// the same project context. The Inspector branch never reaches a mutation
// surface — read-only structurally (FR58; the inspect lane's loop receives
// only the read tools).
//
// Nodes emit TurnEvents via the out-of-band `emit` queue (see run-turn.js);
// state carries the turn's working data (manifest, context, brand tokens,
// written files, answer). Events are NOT accumulated in state.

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

import * as events from './events.js';
import { createOrchestratorNode, routeFromOrchestrator } from './agents/orchestrator.js';
import { createMemoryNode } from './agents/memory.js';
import { createDsCuratorNode } from './agents/ds-curator.js';
import { createAgentExecutorNode } from './agents/agent-executor.js';
import { createInspectorNode } from './agents/inspector.js';

/**
 * The turn-state annotation. Input slots (prompt, scope, mode, attachments,
 * providerHandle, signal, manifest) are set once by run-turn.js; working
 * slots (context, brandTokens, plan, writtenFiles, answer) start from a
 * default and are filled by the nodes. `plan` remains for the deterministic
 * and fallback branches (loop turns leave it []).
 */
export const TurnState = Annotation.Root({
    prompt: Annotation(),
    scope: Annotation(),
    mode: Annotation(),
    currentPage: Annotation(),
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
 * Build + compile the five-node turn graph. The deps are bound into each node
 * factory; the compiled graph is driven by run-turn.js.
 *
 * @param {{
 *   providerHandle: object,
 *   sandbox: object,
 *   fs: object,
 *   projectRoot: string,
 *   emit: (ev: unknown) => void,
 *   snapshot: object,
 *   requestVisionDecision: () => Promise<object>,
 *   onContinueDecision?: (info: { turnsUsed: number, spentTokens: number }) => Promise<boolean>,
 *   onClarify?: (q: { question: string, options?: string[] }) => Promise<string | null>,
 * }} deps
 * @returns {object} The compiled LangGraph graph (has `.stream` / `.invoke`).
 */
export function createTurnGraph({
    providerHandle,
    sandbox,
    fs,
    projectRoot,
    emit,
    snapshot,
    requestVisionDecision,
    onContinueDecision,
    onClarify,
}) {
    // Phase seam (Epic 9 follow-up #3): announce each node's entry as a
    // user-facing PROGRESS phase so the dock's live activity feed can show the
    // orchestration in friendly terms ("Checking your brand"). The slug is a
    // stable progress vocabulary, NOT the node class name — the studio owns the
    // friendly translation, so raw topology never reaches the UI (FR57 spirit;
    // see events.js header). Args are forwarded verbatim so LangGraph's
    // (state, config) call shape is preserved.
    const withPhase =
        (name, node) =>
        (...args) => {
            emit(events.phase(name));
            return node(...args);
        };

    const graph = new StateGraph(TurnState)
        .addNode('Orchestrator', withPhase('understanding', createOrchestratorNode({ emit })))
        .addNode('Memory', withPhase('context', createMemoryNode({ sandbox, emit })))
        .addNode('DSCurator', withPhase('brand', createDsCuratorNode({ sandbox, emit })))
        .addNode(
            'AgentExecutor',
            withPhase(
                'working',
                createAgentExecutorNode({
                    providerHandle,
                    emit,
                    requestVisionDecision,
                    onContinueDecision,
                    onClarify,
                    sandbox,
                    fs,
                    projectRoot,
                    snapshot,
                }),
            ),
        )
        .addNode(
            'Inspector',
            withPhase('exploring', createInspectorNode({ sandbox, providerHandle, emit })),
        )
        .addEdge(START, 'Orchestrator')
        .addEdge('Orchestrator', 'Memory')
        .addConditionalEdges('Memory', routeFromOrchestrator, {
            inspect: 'Inspector',
            generate: 'DSCurator',
        })
        .addEdge('DSCurator', 'AgentExecutor')
        .addEdge('AgentExecutor', END)
        .addEdge('Inspector', END);

    return graph.compile();
}
