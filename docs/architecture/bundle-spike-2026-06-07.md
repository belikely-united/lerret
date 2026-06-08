# `@lerret/ai` Bundle-Spike Report — 2026-06-07

Pre-commit gate for [Epic 8 / Story 8.0](../../_bmad-output/implementation-artifacts/8-0-langgraph-bundle-spike-gate.md). Resolves [ADR-005](../../_bmad-output/planning-artifacts/adr-005-in-studio-ai-architecture.md) §Decision item 3 from `proposed` to `implemented`.

## Verdict

**Pass** — measured **233.3 KB gzipped** (gzip level 6, the nginx / Cloudflare default); the architecture's three-band rule selects **Plan A (LangGraph.js)** unconditionally. No follow-up code-splitting story required.

The on-demand `@lerret/ai` chunk fits comfortably inside the 500 KB gzipped Pass band — under half of the threshold; LangGraph adoption proceeds for Story 8.3 (the multi-agent orchestrator) without further architectural debate.

> **Why gzip level 6, not 9?** Earlier we measured at `zlib` level 9 (smallest possible) and reported 232.6 KB. Real HTTP gzip transfer through nginx / Cloudflare / Cloudfront uses levels 1–6 by default, so the user-facing payload is what level 6 produces. Level 9 would optimistically under-report a band-edge measurement. The 0.7 KB delta between the two readings is well below any band boundary, so the verdict is unchanged.

## Measurement

| Metric | Value |
|---|---|
| **Total gzipped (node:zlib whole-file — authoritative)** | **233.3 KB** (238 868 bytes) |
| Total rendered (visualizer sum, uncompressed) | 893.5 KB (914 928 bytes) |
| Uncompressed (built file) | 996 KB (1 019 881 bytes) |
| Reproducibility Δ (whole-file gzip, run 1 vs run 2) | 0.000% |
| Reproducibility Δ (rendered total, run 1 vs run 2) | 0.000% |
| Build commit | `a0c874bbf8d5fb9132b6eff099ec311d6ed5b854` (post-Story-8.0 public/ HEAD) |
| Node version | v22.18.0 |
| pnpm version | 9.15.0 |
| OS + arch | darwin arm64 |
| Gzip level | 6 (zlib `Z_DEFAULT_COMPRESSION` — nginx / Cloudflare default) |
| `@langchain/langgraph` | `^1.3.6` |
| `@langchain/core` | `^1.1.48` |
| `zod` | `^4.4.3` |
| `zod-to-json-schema` | `^3.25.2` |

**Reproducibility scope.** The 0.000% delta above measures *gzip determinism* (the same on-disk `dist/index.js` gzipped twice — mathematically guaranteed identical). To verify *build determinism* (catch e.g. embedded timestamps or non-deterministic hashes), run `pnpm --filter @lerret/ai build` twice and compare `sha256sum dist/index.js` between runs. The measurement script does not chain a fresh build between readings to keep `pnpm --filter @lerret/ai measure` fast; the build-determinism check is documented in the script header as a manual recipe.

**LangGraph entry point.** LangGraph 1.3.6 exports a `.` (default) entry whose `package.json` `exports` field carries a `browser` condition that maps to `./dist/web.js`. Because Vite builds with the browser condition active, the measurement above IS the web entry — the same chunk a user's browser would load when the studio dynamic-imports `@lerret/ai`. The architecture's Dev-Notes guidance ("if `./web` entry exists, measure both") is satisfied automatically by Vite's conditional resolution; no separate re-measurement is needed.

## Top-10 contributors (gzip estimated proportionally from rendered bytes)

| Package | Rendered (KB) | Est. gzipped (KB) |
|---|---:|---:|
| `@langchain/core` | 403.7 | 105.4 |
| `langsmith` | 159.6 | 41.7 |
| `@langchain/langgraph` | 154.6 | 40.4 |
| `zod` | 113.0 | 29.5 |
| `@cfworker/json-schema` | 23.8 | 6.2 |
| `@langchain/langgraph-checkpoint` | 7.9 | 2.0 |
| `mustache` | 7.7 | 2.0 |
| `uuid` | 6.2 | 1.6 |
| `js-tiktoken` | 5.8 | 1.5 |
| `p-queue` | 5.4 | 1.4 |
| _(other 5 packages)_ | 5.8 | 1.5 |

> **Note on the per-dep estimate.** gzip dictionaries don't split cleanly on module boundaries, so per-package gzipped sizes are estimates derived proportionally from the visualizer's rendered (uncompressed) per-module bytes scaled by the whole-file gzip ratio. The whole-file gzip in the Measurement table is authoritative for the verdict.
>
> Vite 8's Rolldown pipeline reports `gzipLength: 0` for every per-module entry in the visualizer's `raw-data` JSON — only the whole-chunk gzip is computed. The script accommodates this by using `renderedLength` for bucketing and scaling proportionally; a future Rolldown release that restores per-module gzip would let the script report actual per-package gzipped bytes instead of estimates.

**Observation.** `@langchain/core` dominates at ~105 KB gzipped (~45% of the chunk). LangGraph itself is only ~40 KB gzipped. If a future package upgrade pushes the chunk into the Warn band, the obvious code-splitting candidates are `langsmith` (tracing/telemetry — likely droppable since Lerret runs no LangChain backend) and `@cfworker/json-schema` (only invoked when an agent uses structured outputs — lazy-loadable per agent).

## Decision

Plan A (LangGraph.js) is approved unconditionally for Story 8.3. The six-node orchestrator (`Orchestrator`, `Memory`, `Planner`, `Worker`, `DSCurator`, `Inspector`) will be implemented as a LangGraph `StateGraph` per architecture-epic-8.md §Multi-Agent Orchestrator and ADR-005 §Decision item 3.

The spike skeleton in `packages/ai/src/index.js` demonstrates the topology is buildable and bundle-measurable; Story 8.3 replaces the no-op `passthrough` node bodies with real agent implementations, swaps the stub `runTurn` for the real async-iterable contract from `architecture-epic-8.md §New Subsystems §Multi-Agent Orchestrator §Public entry`, and wires the orchestrator to the sandbox (Story 8.4), the snapshot store (Story 8.5), and the provider abstraction (Story 8.1).

**Build hardening notes (applied during code review).** The spike's measurement integrity is now defended against three future bundler footguns:

1. `packages/ai/vite.config.js` sets `output.inlineDynamicImports: true` — without this, a future LangGraph upgrade that introduces an internal `await import(...)` would emit additional chunks and `measure-bundle.js` (which reads only `dist/index.js`) would silently undercount.
2. `packages/ai/package.json` sets `"sideEffects": true` — this forbids tree-shaking the package as a whole, so a more aggressive future minifier cannot drop the top-level `StateGraph().compile()` call that anchors the LangGraph payload in the bundle.
3. `packages/ai/src/no-static-imports.test.js` was fixed to scan the correct `packages/<pkg>/src` paths (the previous `<pkg>/src` paths ENOENT'd silently and produced a vacuous pass); the same fix applied to the Epic 7 `@lerret/animation` precedent. Both tests now additionally catch `export … from '@lerret/ai'` and `export … from '@lerret/animation'` re-export patterns, which were a silent gap in the original boundary-test pattern set.

## Follow-ups

- None blocking the Pass verdict. Story 8.3 implementation proceeds against the Plan A path without prerequisites beyond Stories 8.1, 8.4, 8.5.
- The measurement script (`packages/ai/scripts/measure-bundle.js`) is preserved for re-measurement on any future `@langchain/langgraph` or `@langchain/core` upgrade. Run `pnpm --filter @lerret/ai build && pnpm --filter @lerret/ai measure` and update this report if the chunk size shifts band.
- **Minor follow-up — `inlineDynamicImports` deprecation.** Vite 8 emits a warning that `inlineDynamicImports` is deprecated in favor of a `codeSplitting: false` option. The single-chunk guarantee is still honored (the build emits exactly one `dist/index.js`), but a future Vite version may drop the legacy option entirely. Migrate to the new option name when Vite's docs clarify the Rolldown equivalent.
- **Minor follow-up — cross-platform paths in `measure-bundle.js`.** The per-dep breakdown's regex assumes POSIX `/` separators. On Windows the per-dep table would degrade to `(project source)` everywhere; the headline verdict still works. Lerret's primary dev target is darwin/linux, so this is a future hardening item.
- **Minor follow-up — per-module gzip (AC-5).** The current per-dep table is estimated (Rolldown limitation, see note above). A faithful per-module gzip would require either switching the bundler's pipeline or computing gzip-of-source-range from the source map. Defer until band-edge measurements actually need it.
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
