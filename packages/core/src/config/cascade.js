// Config cascade — per-folder `config.json` loading and deep-merge resolution.
//
// Reads the `config.json` at every folder node in the project model through
// the injected `FilesystemAccess` backend (NEVER `node:fs` or browser APIs —
// core-purity invariant, AR2/AR3) and computes an **effective config** for
// each page/group folder by deep-merging from the project root down to that
// folder.
//
// `console` is a universal global available in every JS environment (Node,
// browser, Deno, etc.) and is used here only for `console.warn` when a
// malformed `config.json` is encountered — so its use does not break the
// core-purity invariant.

/* global console */
//
// Deep-merge semantics:
//   - Scalar / object leaf: child wins over parent at every matching key path.
//   - Sibling keys not present in the child are inherited from the parent.
//   - **Arrays are replaced wholesale** — a child's array value replaces the
//     parent's entirely. Arrays are NOT element-merged. This is intentional: an
//     array-valued config key (e.g. a list of tag names, a list of permitted
//     fonts) is treated as an atomic value — partial overrides via index are not
//     meaningful. Document: if you set `vars.tags` in a child, the parent's
//     `vars.tags` is discarded entirely.
//   - A folder with no `config.json` transparently inherits the parent's
//     effective config (config files are optional, FR18). No error, no warning.
//   - A `config.json` whose content is not valid JSON, or whose top-level value
//     is not a plain object, is skipped: `console.warn` records the file path
//     plus the parse error, and the cascade falls back to the parent's effective
//     config for that folder. The load never throws.

/**
 * @typedef {import('../fs/filesystem.js').FilesystemAccess} FilesystemAccess
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('../loader/model.js').ProjectNode} ProjectNode
 * @typedef {import('../loader/model.js').PageNode} PageNode
 * @typedef {import('../loader/model.js').GroupNode} GroupNode
 */

/**
 * A plain config object loaded from a `config.json` (or produced by merging
 * several). Keys are strings; values are JSON-representable. Top-level must be
 * an object (never an array, number, string, or null).
 *
 * @typedef {Record<string, unknown>} ConfigObject
 */

// ---------------------------------------------------------------------------
// Deep-merge helper
// ---------------------------------------------------------------------------

/**
 * Deep-merge `child` on top of `parent`, returning a new plain object.
 *
 * Rules:
 * - If a key exists in both and both values are plain objects (not arrays),
 *   the result carries a recursively deep-merged value.
 * - **Arrays replace wholesale**: if either value is an array, the child's
 *   value wins without any element-merging.
 * - All other types (strings, numbers, booleans, null) the child wins.
 * - Keys absent in the child are inherited from the parent untouched.
 *
 * Neither `parent` nor `child` is mutated. Returns a fresh object.
 *
 * @param {ConfigObject} parent
 * @param {ConfigObject} child
 * @returns {ConfigObject}
 */
function deepMerge(parent, child) {
  const result = Object.assign({}, parent);

  for (const key of Object.keys(child)) {
    const parentVal = result[key];
    const childVal = child[key];

    if (
      isPlainObject(parentVal) &&
      isPlainObject(childVal)
    ) {
      // Both sides are plain objects (not arrays) — recurse.
      result[key] = deepMerge(
        /** @type {ConfigObject} */ (parentVal),
        /** @type {ConfigObject} */ (childVal),
      );
    } else {
      // Arrays, scalars, null, mixed types — child wins wholesale.
      result[key] = childVal;
    }
  }

  return result;
}

/**
 * Return `true` iff `v` is a plain object (not an array, not null, not a
 * primitive).
 *
 * @param {unknown} v
 * @returns {v is ConfigObject}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Config-file reader
// ---------------------------------------------------------------------------

/**
 * Try to read and parse the `config.json` at `folderPath/config.json`.
 *
 * Returns the parsed object on success. Returns `null` in any of these cases
 * (all non-fatal):
 *
 * - The file does not exist (the backend rejects with an `ENOENT`-like error).
 * - The file content is not valid JSON.
 * - The parsed JSON top-level value is not a plain object.
 *
 * For malformed files (invalid JSON or wrong top-level type), a
 * `console.warn` records the file path and the parse problem so the user can
 * find and fix it; for a missing file there is no warning (absence is normal,
 * FR18).
 *
 * @param {FilesystemAccess} backend
 * @param {LerretPath} folderPath  The folder whose `config.json` to read.
 * @returns {Promise<ConfigObject | null>}
 */
async function readFolderConfig(backend, folderPath) {
  const configPath = `${folderPath}/config.json`;

  let raw;
  try {
    raw = await backend.readFile(configPath, { encoding: 'utf-8' });
  } catch {
    // File absent (or not readable) — treat as "no config", no warning (FR18).
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(/** @type {string} */ (raw));
  } catch (err) {
    console.warn(
      `[lerret/config] Skipping malformed config.json at "${configPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (!isPlainObject(parsed)) {
    console.warn(
      `[lerret/config] Skipping config.json at "${configPath}": top-level value must be a plain object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
    );
    return null;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

/**
 * Recursively walk a page or group node and, for each folder (the node itself
 * and all descendant groups), compute the effective config by merging the
 * folder's own `config.json` (if any) on top of `parentConfig`. Entries are
 * added to `result`.
 *
 * @param {FilesystemAccess} backend
 * @param {PageNode | GroupNode} node
 * @param {ConfigObject} parentConfig  The effective config inherited from the parent.
 * @param {Map<LerretPath, ConfigObject>} result  Accumulator.
 * @returns {Promise<void>}
 */
async function walkNode(backend, node, parentConfig, result) {
  const ownConfig = await readFolderConfig(backend, node.path);
  const effective = ownConfig !== null ? deepMerge(parentConfig, ownConfig) : parentConfig;
  result.set(node.path, effective);

  // Recurse into child groups.
  for (const group of node.groups) {
    await walkNode(backend, group, effective, result);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the **cascaded effective config** for every page and group folder in
 * the project model.
 *
 * The cascade chain for a given folder is:
 *
 *   project-root config.json  →  page config.json  →  group config.json …
 *
 * Each level deep-merges its own `config.json` (if present) on top of the
 * cumulative parent result. Folders without a `config.json` transparently pass
 * through the parent's effective config.
 *
 * **Array replacement**: when a child folder's `config.json` sets an
 * array-valued key, the child's array replaces the parent's wholesale — arrays
 * are never element-merged. See the module header for rationale.
 *
 * @param {ProjectNode} model
 *   The in-memory project model produced by the loader (`scan`). The model's
 *   `path` is treated as the project root — the `config.json` there (if any)
 *   is the outermost tier of the cascade (FR21).
 *
 * @param {FilesystemAccess} backend
 *   The injected filesystem backend. Used only for `readFile`; never calls
 *   `node:fs` or browser APIs directly.
 *
 * @returns {Promise<Map<LerretPath, ConfigObject>>}
 *   A `Map` keyed by the `path` of each page or group folder node in the
 *   model, mapping to that folder's effective (fully merged) config object.
 *
 *   - The project root itself is NOT a key in the map (it is the base tier,
 *     not a page or group).
 *   - Every page and every group node reachable from the model has exactly one
 *     entry.
 *   - Effective config objects are plain, JSON-safe objects — safe to
 *     serialize or structurally compare.
 *   - A folder with no config chain at all (the project root has no
 *     `config.json` and neither does any ancestor or the folder itself) maps
 *     to an empty object `{}`.
 */
export async function computeCascadedConfig(model, backend) {
  /** @type {Map<LerretPath, ConfigObject>} */
  const result = new Map();

  // The project-root `config.json` is the outermost tier (FR21). The project
  // node's `path` is the `.lerret/` scan root.
  const rootConfig = await readFolderConfig(backend, model.path);
  const baseConfig = rootConfig !== null ? rootConfig : {};

  for (const page of model.pages) {
    await walkNode(backend, page, baseConfig, result);
  }

  return result;
}
