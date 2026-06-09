/**
 * @lerret/ai — in-studio AI subsystem for Lerret.
 *
 * Reached only via `await import('@lerret/ai')` from @lerret/studio and @lerret/cli.
 * A static import of this package from anywhere outside packages/ai/ is an enforced
 * lint/test violation (see no-static-imports.test.js).
 *
 * Public surface:
 *   - `runTurn({ prompt, scope, signal, providerOverride? }) → AsyncIterable<TurnEvent>`
 *     (top-level — the dock cluster calls `ai.runTurn(...)`)
 *   - `ai.orchestrator.*` — TurnEvent factories + TURN_EVENT_TYPES + typed errors
 *   - `ai.providers.*`    — the four AI providers + capability matrix + errors (Story 8.1)
 *   - `ai.vault.*`        — encrypted key vault (Story 8.1)
 *   - `ai.snapshot.*`     — per-turn snapshot/revert store (Story 8.5)
 *   - `AGENT_NODES`, `VERSION`
 *
 * The orchestrator is a six-node LangGraph.js StateGraph — Plan A per the Story
 * 8.0 bundle-spike gate (233.3 KB gzipped, inside the 500 KB Pass band; see
 * docs/architecture/bundle-spike-2026-06-07.md). The topology is internal and
 * never exposed via UI (FR57): the user sees one AI behind one input.
 */

// The orchestrator's `runTurn` — the single public turn entry. Replaces the
// Story 8.0 measurement stub. LangGraph now lives in orchestrator/graph.js
// (where it is genuinely used), so it stays in the production bundle.
export { runTurn } from './orchestrator/run-turn.js';

// Orchestrator namespace — TurnEvent factories, TURN_EVENT_TYPES, typed errors.
export * as orchestrator from './orchestrator/index.js';

/**
 * The six agent node names. Re-exported from the orchestrator's single source
 * of truth. Public surface — consumers reach it as `ai.AGENT_NODES`.
 *
 * @type {readonly string[]}
 */
export { AGENT_NODES } from './orchestrator/index.js';

/**
 * Package version, for debugging output. Kept in lockstep with package.json by
 * the release script. Mirrors the convention from @lerret/animation. (Do NOT
 * bump until the Epic 8 closure — Story 8.10.)
 *
 * @type {string}
 */
export const VERSION = '0.1.0';

// Snapshot subsystem (Story 8.5): per-turn manifests + content-addressed
// blob store + revert/redo API + retention. Reached as `ai.snapshot.X`.
export * as snapshot from './snapshot/index.js';

// Provider abstraction (Story 8.1): four AI providers (OpenAI / Anthropic /
// OpenRouter — BYOK; Ollama — local) behind a single interface + capability
// matrix + normalized error set. Reached as `ai.providers.X`.
export * as providers from './providers/index.js';

// Encrypted key vault (Story 8.1): Web Crypto AES-256-GCM wrappers, per-
// session key lifecycle, IndexedDB CRUD for the three AI object stores.
// Reached as `ai.vault.X`.
export * as vault from './vault/index.js';
