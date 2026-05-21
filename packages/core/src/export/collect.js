// export/collect.js — project-model export traversal helper (FR36).
//
// A single PURE function, `collectArtboards`, that walks the project model tree
// (project → pages → groups (nested) → assets) and returns a flat list of
// `Artboard` records for every asset that falls within a given scope.
//
// ## What this module IS
// A traversal helper. It knows about the model tree shape and how to derive
// the `locationPath` / `locationSegments` needed for structured ZIP placement.
//
// ## What this module is NOT
// - It does NOT resolve variant artboards (named-export variants from a
//   component asset — FR10). That is a runtime concern: the studio or CLI
//   calls `resolveVariants()` from `@lerret/core` and enriches the returned
//   `Artboard` objects with variant information AFTER calling this function.
// - It does NOT perform filesystem access, dynamic import, or any I/O.
//
// ## Scope input shape (Option A — LerretPath string or null)
//
//   | Caller intent      | Pass …                                      |
//   |--------------------|---------------------------------------------|
//   | Whole project      | `null`, `undefined`, or `model.path`        |
//   | One page           | the page's `PageNode.path` string           |
//   | One group          | the group's `GroupNode.path` string         |
//
// Passing `null` or `undefined` is the idiomatic "whole project" sentinel.
// Passing `model.path` (the `.lerret/` directory path) also means "whole
// project" — both are treated identically. This design keeps callers honest
// (they have the node at hand and just pass `.path`) without inventing a
// parallel object shape.
//
// ## Walk order
// Depth-first, pre-order: for any container (page or group), assets come before
// child groups, then each child group is walked in the order the model provides
// (already sorted alphabetically by the loader). This produces deterministic,
// human-intuitive output — assets that live at the top of a folder appear
// before the sub-folders — and maps naturally to a structured ZIP where the
// files within a folder precede its subdirectories.
//
// ## Environment
// PURE — no DOM APIs, no Node built-ins. Runs identically in the browser studio
// and in the Node CLI. The core-purity invariant test will catch any drift.

/**
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('../loader/model.js').ProjectNode} ProjectNode
 * @typedef {import('../loader/model.js').PageNode} PageNode
 * @typedef {import('../loader/model.js').GroupNode} GroupNode
 * @typedef {import('../loader/model.js').AssetNode} AssetNode
 */

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/**
 * One artboard entry in a bulk export scope.
 *
 * An `Artboard` represents a single asset's contribution to a bulk export.
 * Each asset yields ONE `Artboard` from this function. Callers (the studio
 * runtime, the CLI) are responsible for expanding a single `Artboard` into
 * multiple per-variant entries by calling `resolveVariants(asset)` and
 * enriching/cloning the record — that step is environment-specific and NOT
 * performed here.
 *
 * @typedef {object} Artboard
 * @property {AssetNode} asset
 *   The source asset node from the project model.
 * @property {LerretPath} assetPath
 *   The asset's full normalized path — equal to `asset.path`. Provided as a
 *   convenience so callers can key maps by path without digging into `asset`.
 * @property {LerretPath} pagePath
 *   The full normalized path of the page that directly or transitively contains
 *   this asset. Used for scoped queries and ZIP top-level folder naming.
 * @property {LerretPath | null} groupPath
 *   The full normalized path of the immediate group containing this asset, or
 *   `null` when the asset lives directly inside a page (not inside any group).
 * @property {string} locationPath
 *   A forward-slash relative path string representing the asset's position
 *   within the export scope, suitable for ZIP folder placement.
 *   Examples:
 *     - asset directly in a page → `""` (empty string — top level of the scope)
 *     - asset in `page/buttons` → `"buttons"`
 *     - asset in `page/ui/buttons` → `"ui/buttons"`
 *   Callers use this to build ZIP entry paths: `${locationPath}/${asset.name}.png`
 *   (for top-level assets `locationPath` is `""`, so the join reduces to the
 *   file name).
 * @property {string[]} locationSegments
 *   The `locationPath` split by `/`, with empty strings removed. Programmatic
 *   consumers prefer this over string splitting. Examples:
 *     - top-level asset → `[]`
 *     - `"buttons"` → `["buttons"]`
 *     - `"ui/buttons"` → `["ui", "buttons"]`
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an `Artboard` record for one asset.
 *
 * @param {AssetNode} asset
 * @param {LerretPath} pagePath
 * @param {LerretPath | null} groupPath
 * @param {string[]} groupSegments   Names of the chain of groups above this
 *                                   asset (from the page level down). Empty
 *                                   when the asset is directly in the page.
 * @returns {Artboard}
 */
function makeArtboard(asset, pagePath, groupPath, groupSegments) {
  const locationPath = groupSegments.join('/');
  const locationSegments = groupSegments.length > 0 ? [...groupSegments] : [];
  return {
    asset,
    assetPath: asset.path,
    pagePath,
    groupPath,
    locationPath,
    locationSegments,
  };
}

/**
 * Recursively collect artboards from a container (page or group and its
 * descendants). Depth-first, assets before child groups.
 *
 * @param {{ groups: GroupNode[], assets: AssetNode[] }} container
 * @param {LerretPath} pagePath
 * @param {LerretPath | null} immediateGroupPath  Path of `container` itself if
 *   it is a group, or `null` when `container` is a page.
 * @param {string[]} ancestorSegments  Name chain from page level down to
 *   (but not including) `container`. Empty when `container` is a page.
 * @param {Artboard[]} out  Accumulator (mutated in place for efficiency).
 */
function walkContainer(container, pagePath, immediateGroupPath, ancestorSegments, out) {
  // Assets first (depth-first pre-order: current level before children).
  for (const asset of container.assets) {
    out.push(makeArtboard(asset, pagePath, immediateGroupPath, ancestorSegments));
  }
  // Then recurse into child groups.
  for (const child of container.groups) {
    const childSegments = ancestorSegments.concat(child.name);
    walkContainer(child, pagePath, child.path, childSegments, out);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect every artboard in the given `scope` of `model` into a flat array.
 *
 * ### Scope input
 *
 * `scope` is a `LerretPath` string (or `null` / `undefined`):
 *
 * | Intent        | Pass …                                               |
 * |---------------|------------------------------------------------------|
 * | Whole project | `null`, `undefined`, or `model.path`                 |
 * | One page      | that `PageNode.path` string                          |
 * | One group     | that `GroupNode.path` string (anywhere in the tree)  |
 *
 * ### Walk order
 * Depth-first, pre-order per container: assets in the current folder come
 * before any child groups. Child groups are visited in the order present in
 * the model (sorted alphabetically by the loader). This order is deterministic
 * and produces human-intuitive ZIP layouts.
 *
 * ### Variants
 * Each `Artboard` returned represents ONE asset. Named-export variants (FR10)
 * are NOT expanded here — that is runtime-specific. Callers should call
 * `resolveVariants(artboard.asset)` and clone/enrich the `Artboard` record with
 * variant info for each export job.
 *
 * ### Error handling
 * - A `scope` that refers to a path not found in the model throws a
 *   `RangeError` with a descriptive message.
 * - A `scope` that resolves to zero assets returns `[]` — callers decide what
 *   to do when a scope is empty.
 * - Passing a `model` that is `null`/`undefined` throws a `TypeError`.
 *
 * @param {ProjectNode} model
 *   The root of the in-memory project model (from `scan()` or the watcher).
 * @param {LerretPath | null | undefined} [scope]
 *   The path identifying what to export. `null` / `undefined` / `model.path`
 *   all mean "export the whole project". Page and group paths must match a node
 *   in the model exactly.
 * @returns {Artboard[]}
 *   Flat array of artboard records in depth-first, pre-order walk sequence.
 *   May be empty when the scope resolves to an empty page/group/project.
 * @throws {TypeError} When `model` is `null` or `undefined`.
 * @throws {RangeError} When `scope` is a non-null path that is not found in
 *   the model (neither a page path, a group path, nor the project path).
 */
export function collectArtboards(model, scope) {
  if (model == null) {
    throw new TypeError('collectArtboards(model): model must be a ProjectNode, got null/undefined');
  }

  /** @type {Artboard[]} */
  const out = [];

  // Whole-project scope: null, undefined, or the project root path itself.
  const scopePath = scope == null ? null : scope;
  if (scopePath === null || scopePath === model.path) {
    // Walk all pages.
    for (const page of model.pages) {
      walkContainer(page, page.path, null, [], out);
    }
    return out;
  }

  // Check if scope matches a page.
  for (const page of model.pages) {
    if (page.path === scopePath) {
      walkContainer(page, page.path, null, [], out);
      return out;
    }
  }

  // Check if scope matches a group anywhere in the tree.
  // We walk the tree and, if we find a matching group, collect from it.
  // The locationSegments for assets in the matched group's subtree start from
  // the group's own name (they are relative to the group's parent context).
  // However, the spec says "scope for a group — returns artboards of that
  // group and all descendant groups". For group-scoped exports the
  // locationPath is relative to the group itself: assets directly in the group
  // get locationPath="" and assets in child groups get the child's name.

  /** @type {{ group: GroupNode, pagePath: LerretPath } | null} */
  const found = findGroup(model, scopePath);
  if (found !== null) {
    // Walk from the matched group; locationSegments start empty (group is the
    // root of this scope).
    walkGroupScope(found.group, found.pagePath, out);
    return out;
  }

  // Scope not found anywhere in the model.
  throw new RangeError(
    `collectArtboards: scope "${scopePath}" was not found in the model. ` +
      `It is neither the project path ("${model.path}"), a page path, nor a group path. ` +
      `Verify the scope against the current model before calling collectArtboards.`,
  );
}

// ---------------------------------------------------------------------------
// Group search helper
// ---------------------------------------------------------------------------

/**
 * Find a group node by path anywhere in the model tree.
 *
 * Returns `{ group, pagePath }` where `pagePath` is the containing page, or
 * `null` if no group with that path exists.
 *
 * @param {ProjectNode} model
 * @param {LerretPath} targetPath
 * @returns {{ group: GroupNode, pagePath: LerretPath } | null}
 */
function findGroup(model, targetPath) {
  for (const page of model.pages) {
    const result = findGroupInContainer(page.groups, page.path, targetPath);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

/**
 * Recursively search for a group by path within a list of groups.
 *
 * @param {GroupNode[]} groups
 * @param {LerretPath} pagePath
 * @param {LerretPath} targetPath
 * @returns {{ group: GroupNode, pagePath: LerretPath } | null}
 */
function findGroupInContainer(groups, pagePath, targetPath) {
  for (const group of groups) {
    if (group.path === targetPath) {
      return { group, pagePath };
    }
    const result = findGroupInContainer(group.groups, pagePath, targetPath);
    if (result !== null) {
      return result;
    }
  }
  return null;
}

/**
 * Walk a group as the root of a scope. Assets directly in the group get
 * `locationSegments = []`; child groups add their name to the segments.
 * `groupPath` for assets directly in the root group is the root group's path;
 * for deeper assets it is the immediate containing group's path.
 *
 * @param {GroupNode} rootGroup
 * @param {LerretPath} pagePath
 * @param {Artboard[]} out
 */
function walkGroupScope(rootGroup, pagePath, out) {
  // Assets directly in the root group: locationSegments is empty (root of scope).
  for (const asset of rootGroup.assets) {
    out.push(makeArtboard(asset, pagePath, rootGroup.path, []));
  }
  // Child groups: their name becomes the first locationSegment.
  for (const child of rootGroup.groups) {
    walkContainer(child, pagePath, child.path, [child.name], out);
  }
}
