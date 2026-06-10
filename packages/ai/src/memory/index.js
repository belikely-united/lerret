// Public re-exports for the memory subsystem (Story 8.6). Consumed by Story
// 8.3's orchestrator via `await import('@lerret/ai')` then `ai.memory.X`.
//
// The two AGENTS live under `orchestrator/agents/` (next to `worker.js`,
// matching the architecture's directory layout); the PURE helpers they delegate
// to live here. This index re-exports both so the orchestrator reaches the
// whole memory subsystem under one namespace, mirroring the `snapshot/`
// precedent (`export * as snapshot` in src/index.js).

// Reserved-path constants — the single source of truth.
export {
  DESIGN_SYSTEM_PATH,
  CONTEXT_PATH,
  MEMORY_PATH,
  BRAND_DIR,
  RESERVED_MEMORY_PATHS,
} from './paths.js';

// Scope-anchoring parser (PURE).
export {
  parseScopedSections,
  resolveScopedContext,
  longestPrefixMatch,
  normalizeScopeKey,
  normalizeTargetScope,
} from './scope.js';

// Design-token parser (PURE).
export { parseDesignTokens, flattenTokens, lookupToken } from './design-tokens.js';

// Preset discovery (FR54).
export { discoverPresets, KNOWN_PRESETS } from './presets.js';

// Generation substrate — variant-expansion + brand-asset-copy planning.
export {
  planVariantExpansion,
  planBrandAssetCopy,
  componentBasename,
} from './generation.js';

// The two brand-aware agents (live under orchestrator/agents/).
export {
  createMemoryAgent,
  createMemoryNode,
  brandAssetType,
  RESERVED_CONTEXT_PATHS,
} from '../orchestrator/agents/memory.js';
export {
  createDSCurator,
  createDsCuratorNode,
  toClarifyingNotes,
  matchTokenReferences,
} from '../orchestrator/agents/ds-curator.js';
