# @lerret/ai

In-studio AI subsystem for [Lerret](https://lerret.belikely.com) — multi-agent orchestrator, four-provider abstraction (OpenAI / Anthropic / OpenRouter — BYOK; Ollama — local), encrypted client-side key vault, and per-turn snapshot/revert store.

This package is the home for every byte of Lerret's AI code. The other Lerret packages (`@lerret/studio`, `@lerret/cli`) reach this code **only** via dynamic import (`await import('@lerret/ai')`) — never statically. That boundary keeps the studio's main chunk free of LangGraph + provider SDKs, lets you remove the dependency cleanly in one PR if you ever need to slim down the install, and gives AI its own test/version/release lane.

## Status: spike skeleton (Story 8.0)

This v0.1.0 release is the **bundle-spike skeleton** that gates Epic 8. The published surface is intentionally minimal:

- A six-node LangGraph state graph (`Orchestrator`, `Memory`, `Planner`, `Worker`, `DSCurator`, `Inspector`) constructed at module-import time so the production build measures the full LangGraph payload faithfully
- An empty `runTurn(...)` async-iterable stub for shape verification
- A `VERSION` constant

The full multi-agent orchestrator, the provider implementations, the encrypted key vault, and the snapshot store all land in later Epic 8 stories (8.1–8.10). See [`architecture-epic-8.md`](https://github.com/belikely-united/lerret/blob/main/_bmad-output/planning-artifacts/architecture-epic-8.md) and [ADR-005](https://github.com/belikely-united/lerret/blob/main/_bmad-output/planning-artifacts/adr-005-in-studio-ai-architecture.md) for the architecture, and [`docs/architecture/`](../../docs/architecture/) for the bundle-spike report that informs the orchestrator's Plan A vs Plan B choice.

## Why a separate package

- **Easy to debug.** AI code can be exercised, tested, and versioned independently of the studio.
- **Easy to remove.** Drop the `optionalDependency` from `@lerret/cli` and `@lerret/studio`, delete the `await import` call-sites, delete `packages/ai/`. One PR.
- **Stays out of the hot path.** The on-demand chunk loads only when the user invokes AI; users who never configure a provider pay zero bundle cost.
- **No backend, ever.** AI traffic goes directly from the user's browser to the provider they configured (or to `localhost:11434` for Ollama). Lerret operates no AI proxy, no telemetry endpoint, no key-storage service.

## Bundle measurement

Run the spike measurement locally:

```sh
pnpm --filter @lerret/ai build
pnpm --filter @lerret/ai measure
```

The build emits a single ESM chunk to `dist/index.js`; `measure` reports the gzipped size with per-dependency breakdown, runs the measurement twice for reproducibility, and prints a Markdown-ready table for the spike report.

## License

MIT © Belikely United LLP.
