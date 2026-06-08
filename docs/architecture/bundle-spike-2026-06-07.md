# `@lerret/ai` Bundle-Spike Report — 2026-06-07

Pre-commit gate for [Epic 8 / Story 8.0](../../_bmad-output/implementation-artifacts/8-0-langgraph-bundle-spike-gate.md). Resolves [ADR-005](../../_bmad-output/planning-artifacts/adr-005-in-studio-ai-architecture.md) §Decision item 3 from `proposed` to `implemented`.

## Verdict

**Pass** — measured **232.6 KB gzipped**; the architecture's three-band rule selects **Plan A (LangGraph.js)** unconditionally. No follow-up code-splitting story required.

The on-demand `@lerret/ai` chunk fits comfortably inside the 500 KB gzipped Pass band; LangGraph adoption proceeds for Story 8.3 (the multi-agent orchestrator) without further architectural debate.

## Measurement

| Metric | Value |
|---|---|
| **Total gzipped (node:zlib whole-file — authoritative)** | **232.6 KB** (238 141 bytes) |
| Total rendered (visualizer sum, uncompressed) | 893.5 KB (914 928 bytes) |
| Uncompressed (built file) | 996 KB (1 019 881 bytes) |
| Reproducibility Δ (whole-file gzip, run 1 vs run 2) | 0.000% |
| Reproducibility Δ (rendered total, run 1 vs run 2) | 0.000% |
| Build commit | `cba12158615653163351d09152cd655958b2c374` |
| Node version | v22.18.0 |
| pnpm version | 9.15.0 |
| OS + arch | darwin arm64 |
| `@langchain/langgraph` | `^1.3.6` |
| `@langchain/core` | `^1.1.48` |
| `zod` | `^4.4.3` |
| `zod-to-json-schema` | `^3.25.2` |

Reproducibility is exact (binary-identical bytes across two consecutive runs of the same Vite build + `node:zlib` cross-check), well inside the ±1% acceptance criterion.

## Top-10 contributors (gzip estimated proportionally from rendered bytes)

| Package | Rendered (KB) | Est. gzipped (KB) |
|---|---:|---:|
| `@langchain/core` | 403.7 | 105.1 |
| `langsmith` | 159.6 | 41.6 |
| `@langchain/langgraph` | 154.6 | 40.2 |
| `zod` | 113.0 | 29.4 |
| `@cfworker/json-schema` | 23.8 | 6.2 |
| `@langchain/langgraph-checkpoint` | 7.9 | 2.0 |
| `mustache` | 7.7 | 2.0 |
| `uuid` | 6.2 | 1.6 |
| `js-tiktoken` | 5.8 | 1.5 |
| `p-queue` | 5.4 | 1.4 |
| _(other 5 packages)_ | 5.8 | 1.5 |

> Note: gzip dictionaries don't split cleanly on module boundaries, so per-package gzipped sizes are estimates derived proportionally from the visualizer's rendered (uncompressed) per-module bytes scaled by the whole-file gzip ratio. The whole-file gzip in the Measurement table is authoritative for the verdict.

**Observation.** `@langchain/core` dominates at ~105 KB gzipped (~45% of the chunk). LangGraph itself is only ~40 KB gzipped. If a future package upgrade pushes the chunk into the Warn band, the obvious code-splitting candidates are `langsmith` (tracing/telemetry — likely droppable since Lerret runs no LangChain backend) and `@cfworker/json-schema` (only invoked when an agent uses structured outputs — lazy-loadable per agent).

## Decision

Plan A (LangGraph.js) is approved unconditionally for Story 8.3. The six-node orchestrator (`Orchestrator`, `Memory`, `Planner`, `Worker`, `DSCurator`, `Inspector`) will be implemented as a LangGraph `StateGraph` per architecture-epic-8.md §Multi-Agent Orchestrator and ADR-005 §Decision item 3.

The spike skeleton in `packages/ai/src/index.js` (this commit) demonstrates the topology is buildable and bundle-measurable; Story 8.3 replaces the no-op `passthrough` node bodies with real agent implementations, swaps the stub `runTurn` for the real async-iterable contract from `architecture-epic-8.md §New Subsystems §Multi-Agent Orchestrator §Public entry`, and wires the orchestrator to the sandbox (Story 8.4), the snapshot store (Story 8.5), and the provider abstraction (Story 8.1).

## Follow-ups

- None for the Pass verdict. Story 8.3 implementation proceeds against the Plan A path without prerequisites beyond Stories 8.1, 8.4, 8.5.
- The measurement script (`packages/ai/scripts/measure-bundle.js`) is preserved for re-measurement on any future `@langchain/langgraph` or `@langchain/core` upgrade. Run `pnpm --filter @lerret/ai build && pnpm --filter @lerret/ai measure` and update this report if the chunk size shifts band.
- The verdict aligns with the Epic 7 `@lerret/animation` precedent — both on-demand chunks fit comfortably under 500 KB gzipped; the dynamic-import boundary strategy continues to deliver the bundle-weight discipline it was extracted for.

## Plan-B deliverable (not applicable)

Not invoked. If a future re-measurement pushes the verdict to Fail (> 1 MB gzipped), the Story 8.0 spec carries the deliverable forward verbatim: *"a hand-written ~5 KB state-machine + async-iterable event emitter providing the same `runTurn` public signature LangGraph would have backed."*

## References

- [Story 8.0 — LangGraph.js Bundle-Spike Gate](../../_bmad-output/implementation-artifacts/8-0-langgraph-bundle-spike-gate.md)
- [ADR-005 — In-Studio AI Architecture](../../_bmad-output/planning-artifacts/adr-005-in-studio-ai-architecture.md)
- [architecture-epic-8.md §LangGraph.js Bundle-Spike Gate](../../_bmad-output/planning-artifacts/architecture-epic-8.md#langgraphjs-bundle-spike-gate)
- [architecture-epic-8.md §Multi-Agent Orchestrator](../../_bmad-output/planning-artifacts/architecture-epic-8.md#multi-agent-orchestrator-langgraphjs)
- Measurement script: [`packages/ai/scripts/measure-bundle.js`](../../packages/ai/scripts/measure-bundle.js)
- Vite build config: [`packages/ai/vite.config.js`](../../packages/ai/vite.config.js)
- Spike scaffold: [`packages/ai/src/index.js`](../../packages/ai/src/index.js)
