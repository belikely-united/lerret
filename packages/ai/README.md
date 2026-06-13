# @lerret/ai

In-studio AI subsystem for [Lerret](https://lerret.belikely.com) — a multi-agent orchestrator, a four-provider abstraction (OpenAI / Anthropic / OpenRouter — bring-your-own-key; Ollama — fully local), an encrypted client-side key vault, brand-memory curation, deterministic generation workflows, and a per-turn snapshot/revert store.

This package is the home for every byte of Lerret's AI code. The other Lerret packages (`@lerret/studio`, `@lerret/cli`) reach this code **only** via dynamic import (`await import('@lerret/ai')`) — never statically. That boundary keeps the studio's main chunk free of LangGraph + provider code, lets you remove the dependency cleanly in one PR if you ever need to slim down the install, and gives AI its own test/version/release lane.

## Architecture

One LangGraph state graph, five role-disciplined agent nodes, one public entry point. The topology is internal — the user sees one AI behind one dock input. Since Epic 9 (ADR-006) an Ask turn is a **bounded agentic tool loop**: the model iteratively lists, reads, writes, and deletes inside `.lerret/` until the request is satisfied — so discovery ("find the twitter banner and retheme it") and multi-step requests complete without the user supplying exact paths.

```
runTurn({ prompt, scope, mode, attachments, signal, onVisionDecision,
          onContinueDecision, providerOverride, folderId, projectRoot, fs })
  → AsyncIterable<TurnEvent>

START → Orchestrator → Memory ─┬→ (inspect)  Inspector ──[loop: list_dir, read_file]──→ END
                               └→ (generate) DS Curator → AgentExecutor ─[loop: 4 tools]─→ END
```

| Node | Role |
|---|---|
| **Orchestrator** | Routes the turn (`ask` → generate, `inspect` → read-only); sequences the graph |
| **Memory** | Reads the user-owned brand files (`.lerret/_design-system.md`, `_context.md`, `_memory.md`, `_brand/`) with scope-anchored context (closer scope wins) — zero provider calls |
| **DS Curator** | Brand-token authority — `_design-system.md` is primary, `config.json` `vars` secondary; conflicts surface as a calm `clarifying-note` in the thread (the turn proceeds, never blocks) |
| **Agent Executor** | The Ask lane. Recognized workflows (launch kit, social variants) plan **deterministically with zero provider calls**; tool-capable models run the **agentic loop** (`orchestrator/tools/loop.js`) over four tools — `list_dir`, `read_file`, `write_file`, `delete_file`; a tool-incapable model falls back to a single-shot planner. Reads hit the sandbox; **every write/delete is a Worker step**, so the single-mutator guarantee and per-turn snapshot hold across the whole loop. Vision turns deliver image bytes as provider-native multipart content |
| **Worker** | The **only** mutator — a module (no longer a graph node since Epic 9): executes write/delete/mkdir steps through `core/fs/sandbox.js` (writes confined to `.lerret/`, no shell, no network), capturing a pre-mutation snapshot of every touched file |
| **Inspector** | Read-only project Q&A — runs the loop with **only** `list_dir` + `read_file` (the read-only guarantee is structural at the tool layer), a single `inspector-response` answer, **no snapshot manifest** (nothing to revert) |

The loop is bounded (ADR-006): it ends on a zero-tool-call response (the closing text becomes the turn summary), is capped at `maxTurns` (default 10) with a user-facing **Continue / Stop** choice at the cap, guards against repeated identical actions, feeds tool failures back as `isError` results so the model self-corrects, and re-checks the abort signal before every provider call and every tool execution. One internal tool shape (`ToolDef`/`ToolCall`/`ToolResult`) is translated to each provider's wire format by three translators (Anthropic `tool_use`; OpenAI + OpenRouter `function`; Ollama native `/api/chat`) — mirroring how the package already translates vision blocks.

Every event the dock renders comes from one discriminated union (`orchestrator/events.js`): `thinking · reading · writing · deleting · mkdir · tool-call · turn-progress · needs-continue · clarifying-note · inspector-response · done{files, turnId, summary} · error{class, message} · stopped{turnId} · needs-vision-fallback`.

## Public surface

```js
const ai = await import('@lerret/ai');

ai.runTurn(...)      // the one orchestrator entry — see above
ai.providers         // OpenAI / Anthropic / OpenRouter / Ollama + capability matrix + normalized errors
ai.vault             // AES-256-GCM key vault over IndexedDB (per-folder keys, session unlock)
ai.snapshot          // per-turn manifests + content-addressed blobs; revertFile / revertTurn / revertToTurn / redoTurn
ai.memory            // brand-memory helpers: scope parser, design-token parser, preset discovery, generation planning
ai.vision            // capability router: isVisionRequired / supportsVision / eligibleVisionProviders
ai.workflows         // deterministic W2 launch-kit + W3 social-variants recognizers and planners
ai.orchestrator      // TurnEvent factories + types, AGENT_NODES
```

## Privacy & safety model

- **No backend, ever.** AI traffic goes directly from the user's browser to the provider they configured (or to `localhost:11434` for Ollama). Lerret operates no AI proxy, no telemetry endpoint, no key-storage service.
- **Keys are encrypted at rest** (AES-256-GCM via Web Crypto, per-folder derived keys, non-extractable). The decrypted key exists only at the moment a provider builds its auth header. The honest threat-model limits are documented in `src/vault/crypto.js`.
- **Cloud egress is pinned** — each cloud provider only ever talks to its own vendor origin; Ollama is restricted to loopback/private hosts. A configured `baseUrl` cannot exfiltrate your key.
- **AI writes are sandboxed to `.lerret/`** — enforced by `core/fs/sandbox.js` (path normalization, traversal rejection) and the Worker being the single mutator.
- Four CI guards keep these promises honest: `no-static-imports` (the package boundary), `worker-no-direct-fs` (sandbox-all-writes across agents/workflows/memory **and the loop's `orchestrator/tools/`**), `no-key-leak` (no key material in logs, including the loop's provider-response handling), and `inspect-no-worker` (read-only inspect turns — now also asserts the Inspector's loop registers **only** the two read tools, structurally + at runtime).

## Why a separate package

- **Easy to debug.** AI code can be exercised, tested, and versioned independently of the studio.
- **Easy to remove.** Drop the `optionalDependency` from `@lerret/cli` and `@lerret/studio`, delete the `await import` call-sites, delete `packages/ai/`. One PR.
- **Stays out of the hot path.** The studio loads this package as an on-demand code-split chunk only when the user invokes AI; users who never configure a provider pay zero bundle cost.

## Bundle budget

The package ships as a single ESM chunk gated at **< 500 KB gzipped** (currently ~260 KB, LangGraph included — see `docs/architecture/` for the original gate report). Re-measure locally:

```sh
pnpm --filter @lerret/ai build
pnpm --filter @lerret/ai measure
```

## License

MIT © Belikely United LLP.
