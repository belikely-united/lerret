// Reserved memory-path constants — the single source of truth for the four
// user-content paths under `.lerret/` that the AI subsystem reads on every
// turn (FR53). Plain Markdown + a `_brand/` asset folder the user owns, edits
// in their editor, and git-tracks (UX Design Goal #4: "brand context is a
// folder, not a vault").
//
// These live in `.lerret/` PROPER (git-tracked, travel with the project), NOT
// under `.state/` (Lerret-managed, gitignored — that is the snapshot store's
// home). All four use the v1 FR5 underscore-reserved convention, so the v1
// loader already ignores them for page-mapping with NO loader change — verified
// at `packages/core/src/loader/scan.js` `isReservedFolderName` (a leading
// underscore is the rule).
//
// Memory (`orchestrator/agents/memory.js`) and DS Curator
// (`orchestrator/agents/ds-curator.js`) import the path constants FROM HERE so
// the agents, the helpers, and the dogfood fixture all agree on one spelling.
// The string values are identical to the constants Story 8.3 originally inlined
// in `memory.js` (`RESERVED_CONTEXT_PATHS`, `BRAND_DIR`) — `memory.js` now
// re-derives those from these constants to eliminate the duplication without
// changing any value.

/** @type {'.lerret/_design-system.md'} The primary brand authority file. */
export const DESIGN_SYSTEM_PATH = '.lerret/_design-system.md';

/** @type {'.lerret/_context.md'} Product / audience / tone context. */
export const CONTEXT_PATH = '.lerret/_context.md';

/** @type {'.lerret/_memory.md'} Freeform past-decisions + style memory. */
export const MEMORY_PATH = '.lerret/_memory.md';

/** @type {'.lerret/_brand'} Brand reference assets (logos, swatches, photos). */
export const BRAND_DIR = '.lerret/_brand';

/**
 * The three Markdown reserved paths, in injection order (design-system →
 * context → memory). Frozen so a downstream mutation cannot reorder injection.
 *
 * @type {readonly string[]}
 */
export const RESERVED_MEMORY_PATHS = Object.freeze([
  DESIGN_SYSTEM_PATH,
  CONTEXT_PATH,
  MEMORY_PATH,
]);
