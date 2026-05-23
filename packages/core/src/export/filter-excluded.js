// export/filter-excluded.js — page/group-level `excludeFromExport` filter (FR52).
//
// A page (or group) can opt out of bulk and CLI export by setting
// `excludeFromExport: true` in its `config.json`. The flag participates in the
// v1 deep-merge cascade (FR21) with no special-casing: a parent's `true`
// propagates to every descendant; a child can override with `false`.
//
// ## Scope
// This filter is applied at export time only. The loader, runtime, and canvas
// do NOT check `excludeFromExport` — excluded pages still render in the studio.
// The flag only affects bulk export (`runBulkExport` in studio, `@lerret/cli
// export` for page/group/project scopes).
//
// Single-artboard export from the kebab menu is intentionally NOT filtered:
// if the user clicked "Export" on a specific artboard, that's explicit intent.
//
// ## Environment
// PURE — operates on plain values handed in by the caller. No DOM, no Node.

/**
 * @typedef {import('./collect.js').Artboard} Artboard
 * @typedef {import('../config/cascade.js').ConfigObject} ConfigObject
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 */

/**
 * @callback GetConfigForPath
 * @param {LerretPath} path  A page or group `LerretPath`.
 * @returns {ConfigObject | undefined}
 *   The effective (cascaded) config for that folder, or `undefined` if the
 *   path is not in the cascade map. The caller is welcome to return `{}` in
 *   place of `undefined` — both are treated as "no exclusion".
 */

/**
 * Check whether a single page or group is excluded from export.
 *
 * Looks up the folder's effective cascaded config and returns `true` iff
 * `excludeFromExport === true`. Any other value (including `undefined`,
 * `false`, missing key, non-boolean truthy values) returns `false` — only the
 * literal boolean `true` excludes.
 *
 * @param {LerretPath} folderPath
 * @param {GetConfigForPath} getConfigForPath
 * @returns {boolean}
 */
export function isFolderExcludedFromExport(folderPath, getConfigForPath) {
  const config = getConfigForPath(folderPath);
  return config != null && config.excludeFromExport === true;
}

/**
 * Check whether an artboard is excluded from export by virtue of its containing
 * folder.
 *
 * Because the cascade is fully resolved by the time `getConfigForPath` is
 * called, checking the most specific containing folder is sufficient — a
 * parent-set exclusion will already be present in the child's effective config
 * via the deep-merge. The most specific folder is the artboard's immediate
 * group (when present), falling back to its page.
 *
 * @param {Artboard} artboard
 * @param {GetConfigForPath} getConfigForPath
 * @returns {boolean}
 */
export function isArtboardExcludedFromExport(artboard, getConfigForPath) {
  const containerPath = artboard.groupPath ?? artboard.pagePath;
  return isFolderExcludedFromExport(containerPath, getConfigForPath);
}

/**
 * Split an artboards list into `kept` and `excluded` based on the
 * `excludeFromExport` flag of each artboard's containing folder.
 *
 * The order of artboards within each result array matches their order in the
 * input. The excluded list is useful for the CLI's "Skipped: …" summary and
 * for studio UIs that show a count of skipped pages.
 *
 * @param {Artboard[]} artboards
 * @param {GetConfigForPath} getConfigForPath
 * @returns {{ kept: Artboard[], excluded: Artboard[] }}
 */
export function partitionByExclusion(artboards, getConfigForPath) {
  /** @type {Artboard[]} */
  const kept = [];
  /** @type {Artboard[]} */
  const excluded = [];
  for (const artboard of artboards) {
    if (isArtboardExcludedFromExport(artboard, getConfigForPath)) {
      excluded.push(artboard);
    } else {
      kept.push(artboard);
    }
  }
  return { kept, excluded };
}

/**
 * Convenience: collect the unique page/group paths that contributed at least
 * one excluded artboard, in stable order (first-seen).
 *
 * Useful for the CLI summary line ("Skipped: intro/, drafts/ (excludeFromExport)")
 * and any studio UI that displays the source of skips.
 *
 * @param {Artboard[]} excludedArtboards
 * @returns {LerretPath[]}
 */
export function excludedFolderPaths(excludedArtboards) {
  /** @type {LerretPath[]} */
  const out = [];
  const seen = new Set();
  for (const artboard of excludedArtboards) {
    const path = artboard.groupPath ?? artboard.pagePath;
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}
