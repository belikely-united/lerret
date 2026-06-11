# @lerret/ai

In-studio AI subsystem for [Lerret](https://lerret.belikely.com) — a multi-agent orchestrator, a four-provider abstraction (OpenAI / Anthropic / OpenRouter — bring-your-own-key; Ollama — fully local), an encrypted client-side key vault, brand-memory curation, deterministic generation workflows, and a per-turn snapshot/revert store.

This package is the home for every byte of Lerret's AI code. The other Lerret packages (`@lerret/studio`, `@lerret/cli`) reach this code **only** via dynamic import (`await import('@lerret/ai')`) — never statically. That boundary keeps the studio's main chunk free of LangGraph + provider code, lets you remove the dependency cleanly in one PR if you ever need to slim down the install, and gives AI its own test/version/release lane.

## Architecture

One LangGraph state graph, six role-disciplined agent nodes, one public entry point. The topology is internal — the user sees one AI behind one dock input.

```
runTurn({ prompt, scope, mode, attachments, signal, onVisionDecision,
          providerOverride, folderId, projectRoot, fs })
  → AsyncIterable<TurnEvent>

START → Orchestrator → Memory ─┬→ (inspect)  Inspector → END
                               └→ (generate) DS Curator → Planner → Worker → END
```

| Node | Role |
|---|---|
| **Orchestrator** | Routes the turn (`ask` → generate, `inspect` → read-only); sequences the graph |
| **Memory** | Reads the user-owned brand files (`.lerret/_design-system.md`, `_context.md`, `_memory.md`, `_brand/`) with scope-anchored context (closer scope wins) |
| **DS Curator** | Brand-token authority — `_design-system.md` is primary, `config.json` `vars` secondary; conflicts surface as a calm `clarifying-note` in the thread (the turn proceeds, never blocks) |
| **Planner** | Decomposes the prompt into file operations. Recognized workflows (launch kit, social variants) plan **deterministically with zero provider calls**; everything else is a real model call that must return `{steps:[{op,path,content}]}` against a strict op whitelist. Vision turns deliver image bytes as provider-native multipart content |
| **Worker** | The **only** mutator — executes steps through `core/fs/sandbox.js` (writes confined to `.lerret/`, no shell, no network), capturing a pre-mutation snapshot of every touched file |
| **Inspector** | Read-only project Q&A — targeted file reads, a single `inspector-response` answer, **no snapshot manifest** (nothing to revert) |

Every event the dock renders comes from one discriminated union (`orchestrator/events.js`): `thinking · reading · writing · deleting · mkdir · tool-call · clarifying-note · inspector-response · done{files, turnId} · error{class, message} · stopped{turnId} · needs-vision-fallback`.

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
- Four CI guards keep these promises honest: `no-static-imports` (the package boundary), `worker-no-direct-fs` (sandbox-all-writes across agents/workflows/memory), `no-key-leak` (no key material in logs), and `inspect-no-worker` (read-only inspect turns, structurally + at runtime).

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
