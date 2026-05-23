// @lerret/core — environment-agnostic shared logic.
//
// This package is consumed by `studio`, `cli`, and `create-lerret`, and
// depends on none of them. It MUST stay pure: no DOM APIs (no `window`,
// `document`, File System Access API) and no Node built-ins (no `node:fs`,
// `node:path`). The filesystem abstraction interface, project loader, and
// config/data resolution all live here.
//
// This barrel file simply establishes the package and its boundary.

/**
 * The Lerret release line this build targets.
 * @type {string}
 */
export const version = '0.1.0';

/**
 * Marker identifying the core package — useful for sanity-checking that a
 * consumer resolved `@lerret/core` correctly across the workspace.
 * @type {string}
 */
export const CORE_PACKAGE = '@lerret/core';

// ---------------------------------------------------------------------------
// Filesystem abstraction
// ---------------------------------------------------------------------------
//
// The `FilesystemAccess` interface contract — the single boundary every
// filesystem-touching subsystem (loader, watcher, editors, export,
// persistence) goes through. Backends (`@lerret/cli`'s Node `fs` backend, the
// studio's File System Access backend) implement it; this `core` export is the
// contract, the canonical shapes, and the conformance validator. The types
// (`FilesystemAccess`, `DirEntry`, `FilesystemCapabilities`, …) are JSDoc
// `@typedef`s and so re-export implicitly with this barrel file.

export {
  serializeJson,
  assertFilesystemContract,
  findFilesystemContractViolations,
  isFilesystemAccess,
} from './fs/filesystem.js';

// ---------------------------------------------------------------------------
// Project loader
// ---------------------------------------------------------------------------
//
// The loader walks a `.lerret/` folder tree — via an injected
// `FilesystemAccess` backend — into the canonical in-memory project model
// (project → pages → nestable groups → assets). `scan` is the entry point;
// `model.js` defines the node shapes plus their constructors and predicates.
// The shape `@typedef`s (`ProjectNode`, `PageNode`, `GroupNode`, `AssetNode`,
// …) are JSDoc types and re-export implicitly with this barrel file.

export { scan } from './loader/scan.js';

export {
  NODE_KIND,
  ASSET_KIND,
  ASSET_EXTENSIONS,
  FONT_EXTENSIONS,
  createProjectNode,
  createPageNode,
  createGroupNode,
  createAssetNode,
  createFontFile,
  isProjectNode,
  isPageNode,
  isGroupNode,
  isAssetNode,
} from './loader/model.js';

// Pure helpers for creating new pages / groups / assets from the studio —
// shared by the studio's CreateEntryDialog and the CLI's /__lerret/create
// endpoint so name rules and starter content never drift.
export {
  validateEntryName,
  assetFileName,
  componentIdentifier,
  starterAssetContent,
  MAX_ENTRY_NAME_LENGTH,
} from './loader/entry-name.js';

// ---------------------------------------------------------------------------
// Asset variants & meta
// ---------------------------------------------------------------------------
//
// Two PURE functions the studio's asset-runtime calls after it has loaded an
// asset module: `resolveVariants` turns the module's component-valued exports
// into the set of variant artboards it yields (one file → 1..N artboards,
// FR10), and `parseMeta` parses the module's `meta` export (`dimensions`,
// `label`, `tags`, `propsSchema`, FR11) into a canonical, defaults-filled
// shape. Both operate only on plain values handed in by the runtime — they
// load nothing — so `core` stays environment-agnostic. The shape `@typedef`s
// (`AssetVariant`, `AssetMeta`, `AssetDimensions`) re-export implicitly with
// this barrel file.

export { resolveVariants } from './assets/variants.js';

export { parseMeta } from './assets/meta.js';

// ---------------------------------------------------------------------------
// File watcher — normalized change events & incremental model patching
// ---------------------------------------------------------------------------
//
// The normalized `WatchEvent { type: 'add' | 'change' | 'remove', path }`
// shape both filesystem backends emit (AR5), and the PURE incremental patcher
// that turns one event into a new `ProjectNode` — adding a new asset/page/
// group node, removing a deleted one, etc. — so the canvas reflects an
// add/remove/rename without a full directory rescan (FR7). The CLI's
// chokidar-backed watcher and the future hosted polling watcher both feed
// these helpers; consumers (the studio) re-render off the returned model.

export {
  watchEventType,
  makeWatchEvent,
  applyWatchEvent,
  classifyPath,
} from './loader/watch.js';

// ---------------------------------------------------------------------------
// Config cascade
// ---------------------------------------------------------------------------
//
// PURE function that reads each folder's `config.json` through the injected
// `FilesystemAccess` backend and deep-merges from the project root down to
// every page/group folder. The project-root `config.json` is the outermost
// (project-level) tier; child leaves override parent leaves; arrays are
// replaced wholesale, never element-merged (FR18, FR21). Returns a Map keyed
// by folder `path` so consumers can look up a folder's effective config in
// O(1). Malformed JSON is skipped with a warn.

export { computeCascadedConfig } from './config/cascade.js';

// ---------------------------------------------------------------------------
// Co-located asset data discovery
// ---------------------------------------------------------------------------
//
// PURE function that, per asset, discovers a co-located `<Name>.data.json` or
// `<Name>.data.js` via the injected `FilesystemAccess` backend, parses the
// JSON form, and records the JS form's path for the studio runtime to import
// dynamically (FR22). When both are present, `.data.js` wins with a warn.
// Returns a Map keyed by asset `path` with `{ source: 'json'|'js'|'absent',
// value?, dataPath? }` entries — consumed by per-variant data keying and
// prop resolution. `collectAssets` flattens the project tree into a single
// AssetNode list for callers.

export { loadAssetData, collectAssets } from './data/loader.js';

// ---------------------------------------------------------------------------
// Per-variant data keying
// ---------------------------------------------------------------------------
//
// PURE function that takes an `AssetData` record (from `loadAssetData`) and
// the variant export names (from `resolveVariants`) and decides — per variant
// — whether the data object supplies a keyed sub-object (`'keyed'`), applies
// the entire value as shared data (`'shared'`), or has no data for this
// variant at this tier (`'absent'`). Stray keys in the data object (keys with
// no matching export name) are ignored with a `console.warn`. Consumed by
// four-tier prop resolution.

export { resolveVariantData } from './data/variant-data.js';

// ---------------------------------------------------------------------------
// Four-tier prop resolution
// ---------------------------------------------------------------------------
//
// PURE function that merges all four prop tiers in fixed precedence per prop
// (FR24): (1) variant data value, (2) cascaded config `vars`, (3) `propsSchema`
// defaults, (4) component default (enforced by omission). Every artboard's
// final props flow through this single function — neither the studio nor the
// CLI assembles props ad hoc (the canonical-shape rule). The `propsSchema`
// default-extraction convention (descriptor object with optional `default` key)
// is documented in the module header so the props validator can rely on the
// same shape.

export { resolveProps } from './config/resolve-props.js';

// ---------------------------------------------------------------------------
// Props validation against propsSchema
// ---------------------------------------------------------------------------
//
// PURE function that takes fully-resolved props (the output of `resolveProps`)
// and a `propsSchema` object and returns the list of fields that fail their
// declared constraints — required-but-absent, type mismatch, value not in
// options, or numeric out-of-bounds. The studio's validation badge calls
// this on every artboard render; an empty result means all props pass
// and no badge is shown. Consumed by studio only today; in `core` so future
// CLI tooling and the hosted runtime can reuse the same logic without coupling.

export { validateProps } from './assets/validate.js';

// ---------------------------------------------------------------------------
// Export traversal helper — collectArtboards (FR36)
// ---------------------------------------------------------------------------
//
// PURE function that, given a project model and a scope (whole project, a
// page, or a group identified by its LerretPath), returns a flat array of
// `Artboard` records — one per asset in the scope. Walks groups at arbitrary
// nesting depth (FR3). The caller enriches each `Artboard` with per-variant
// info by calling `resolveVariants(artboard.asset)` — variant expansion is
// environment-specific and NOT performed here. Both the studio bulk-export
// and the CLI bulk-export share this single implementation. The `Artboard`
// typedef re-exports implicitly with this barrel file.

export { collectArtboards } from './export/collect.js';

// ---------------------------------------------------------------------------
// excludeFromExport filter (FR52)
// ---------------------------------------------------------------------------
//
// PURE helpers that filter out artboards whose containing page or group has
// `excludeFromExport: true` in its effective cascaded config. Applied at
// export time only — the loader, runtime, and canvas do NOT check the flag
// (excluded pages still render in the studio). Both the studio bulk-export and
// the CLI bulk-export use these helpers to share one implementation.

export {
    isFolderExcludedFromExport,
    isArtboardExcludedFromExport,
    partitionByExclusion,
    excludedFolderPaths,
} from './export/filter-excluded.js';
