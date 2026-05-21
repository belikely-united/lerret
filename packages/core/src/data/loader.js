// data/loader.js — co-located asset data file discovery and JSON loading.
//
// Given a flat list of AssetNode objects and a FilesystemAccess backend this
// module discovers co-located data files (`<AssetName>.data.json` and
// `<AssetName>.data.js`) that live in the same folder as each asset and returns
// a `Map<assetPath, AssetData>` describing the result for every asset.
//
// Precedence rule (FR22):
//   When BOTH `.data.json` AND `.data.js` co-locate with the same asset,
//   `.data.js` WINS — it is the more expressive, dynamic form. A `console.warn`
//   is emitted to note that two data files were found so the user is never
//   silently surprised about which data source is active.
//   Rationale: `.data.js` can express computed / conditional data that plain
//   JSON cannot. Making `.data.js` the winner means the dynamic form always
//   takes precedence over the static form, which aligns with the general
//   principle that "more powerful overrides simpler".
//
// PURE module — no `node:fs`, no DOM APIs. All filesystem access goes through
// the injected `FilesystemAccess` backend. The studio-side dynamic `import()`
// of `.data.js` modules is NOT performed here; `core` only records the presence
// of a `.data.js` file. The actual module load happens in
// `@lerret/studio/src/runtime/data-loader.js`.
//
// This file is intentionally environment-agnostic: it runs identically in the
// browser studio and in the Node CLI.

/* global console */
//
// `console` is a universal global available in every JS environment (Node,
// browser, Deno, etc.) and is used here only for `console.warn` when a data
// file is malformed or in conflict — so its use does not break the core-purity
// invariant. The ESLint config sets `globals: {}` for core to prevent DOM /
// Node built-in leaks; this directive re-permits only `console`.

import { assertFilesystemContract } from '../fs/filesystem.js';

/**
 * @typedef {import('../fs/filesystem.js').FilesystemAccess} FilesystemAccess
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('../loader/model.js').AssetNode} AssetNode
 */

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/**
 * The resolved data source for one asset after the co-location discovery.
 *
 * Downstream consumers (per-variant keying and four-tier prop resolution)
 * read `source` to decide how to obtain the actual value:
 *
 *   - `'json'`   — `value` is the parsed JSON object. `dataPath` is the
 *                  `.data.json` path that was read.
 *   - `'js'`     — `value` is `undefined`; `dataPath` is the `.data.js` path
 *                  the studio-side loader must `import()` to obtain the module.
 *                  (Core only records presence; `studio/runtime/data-loader.js`
 *                  performs the actual dynamic import.)
 *   - `'absent'` — no co-located data file was found, or the JSON file was
 *                  malformed. `value` is `undefined`. `dataPath` is `undefined`.
 *
 * @typedef {object} AssetData
 * @property {'json' | 'js' | 'absent'} source
 *   How the data should be obtained. `'json'` = already loaded, `'js'` = needs
 *   a studio-side dynamic import, `'absent'` = no data available at this tier.
 * @property {unknown} [value]
 *   The parsed data value. Populated only when `source === 'json'`.
 *   `undefined` for `'js'` (value is in the module, not yet loaded) and
 *   `'absent'` (no data).
 * @property {LerretPath} [dataPath]
 *   The path of the data file this record refers to. Set for `'json'` and
 *   `'js'`; `undefined` for `'absent'`.
 */

// ---------------------------------------------------------------------------
// Pure path helpers
// ---------------------------------------------------------------------------

/**
 * Return the directory portion of a forward-slash LerretPath (everything up to
 * and including the last `/`). A path with no `/` returns `''`.
 *
 * @param {LerretPath} path
 * @returns {string}
 */
function dirName(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover co-located data files for a single asset by reading the asset's
 * parent folder through the filesystem backend.
 *
 * Returns the paths of any found `.data.json` and/or `.data.js` files for
 * the asset. Uses the strict co-location rule: only `<AssetName>.data.json`
 * and `<AssetName>.data.js` in the SAME directory as the asset qualify.
 *
 * @param {AssetNode} asset          The asset to check.
 * @param {FilesystemAccess} backend The filesystem backend.
 * @returns {Promise<{ jsonPath: LerretPath | null, jsPath: LerretPath | null }>}
 */
async function discoverDataFiles(asset, backend) {
  const dir = dirName(asset.path);
  if (!dir) {
    return { jsonPath: null, jsPath: null };
  }

  const jsonFileName = `${asset.name}.data.json`;
  const jsFileName = `${asset.name}.data.js`;

  /** @type {import('../fs/filesystem.js').DirEntry[]} */
  let entries;
  try {
    entries = await backend.readDir(dir.replace(/\/$/, ''));
  } catch {
    // If the directory cannot be read, treat as absent — do not propagate
    // a filesystem error for a supplementary data discovery.
    return { jsonPath: null, jsPath: null };
  }

  let jsonPath = null;
  let jsPath = null;

  for (const entry of entries) {
    if (!entry.isFile) continue;
    if (entry.name === jsonFileName) {
      jsonPath = entry.path;
    } else if (entry.name === jsFileName) {
      jsPath = entry.path;
    }
  }

  return { jsonPath, jsPath };
}

// ---------------------------------------------------------------------------
// JSON reading
// ---------------------------------------------------------------------------

/**
 * Read and parse a `.data.json` file through the filesystem backend.
 *
 * Returns the parsed object on success. If the file cannot be read or contains
 * malformed JSON, emits a `console.warn` and returns `null` (failure is
 * isolated to this asset; the rest of the canvas keeps running).
 *
 * @param {LerretPath} jsonPath      Path to the `.data.json` file.
 * @param {FilesystemAccess} backend The filesystem backend.
 * @returns {Promise<unknown | null>}
 */
async function readJsonDataFile(jsonPath, backend) {
  let text;
  try {
    text = await backend.readFile(jsonPath, { encoding: 'utf-8' });
  } catch (err) {
    console.warn(
      `[lerret/data] Could not read data file "${jsonPath}": ${err instanceof Error ? err.message : String(err)}. Asset data will be treated as absent.`,
    );
    return null;
  }

  try {
    return JSON.parse(/** @type {string} */ (text));
  } catch (err) {
    console.warn(
      `[lerret/data] Malformed JSON in data file "${jsonPath}": ${err instanceof Error ? err.message : String(err)}. Asset data will be treated as absent.`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover and load co-located data files for every asset in `assets`.
 *
 * For each asset this function:
 *   1. Reads the asset's parent directory to check for `<name>.data.json` and
 *      `<name>.data.js` co-located files.
 *   2. If BOTH are present, `.data.js` wins (precedence rule, documented above)
 *      and a `console.warn` records the conflict.
 *   3. If only `.data.json` is present, reads and parses it.
 *   4. If only `.data.js` is present, records its path so the studio-side
 *      loader can perform the dynamic `import()`.
 *   5. If neither is present, or the JSON is malformed, records `'absent'`.
 *
 * Each asset's result is stored in the returned `Map` keyed by the asset's
 * `path` property (`LerretPath`). Every asset in `assets` has an entry —
 * there are no silent omissions.
 *
 * @param {AssetNode[]} assets
 *   The flat list of asset nodes to discover data for. Typically obtained by
 *   walking the `ProjectNode` tree.
 * @param {FilesystemAccess} backend
 *   The injected filesystem backend — validated against the `FilesystemAccess`
 *   contract. Must be the same backend used by the project loader.
 * @returns {Promise<Map<LerretPath, AssetData>>}
 *   A `Map` from asset `path` → `AssetData`. Every path in `assets` has an
 *   entry. Never rejects — all errors are isolated and emitted as warnings.
 */
export async function loadAssetData(assets, backend) {
  assertFilesystemContract(backend, 'loadAssetData(backend)');

  if (!Array.isArray(assets)) {
    throw new TypeError('loadAssetData(assets): assets must be an array');
  }

  /** @type {Map<LerretPath, AssetData>} */
  const result = new Map();

  await Promise.all(
    assets.map(async (asset) => {
      if (asset == null || typeof asset.path !== 'string' || typeof asset.name !== 'string') {
        // Guard against malformed entries in the assets array.
        return;
      }

      const { jsonPath, jsPath } = await discoverDataFiles(asset, backend);

      if (jsPath !== null) {
        // `.data.js` is present — it wins regardless of whether `.data.json` is
        // also present. If both were found, warn the user.
        if (jsonPath !== null) {
          console.warn(
            `[lerret/data] Asset "${asset.fileName}" has both "${asset.name}.data.json" ` +
              `and "${asset.name}.data.js". ".data.js" takes precedence — rename or remove ` +
              `"${asset.name}.data.json" to silence this warning.`,
          );
        }
        result.set(asset.path, {
          source: 'js',
          value: undefined,
          dataPath: jsPath,
        });
        return;
      }

      if (jsonPath !== null) {
        // Only `.data.json` is present — read and parse it.
        const parsed = await readJsonDataFile(jsonPath, backend);
        if (parsed === null) {
          // JSON read or parse failed — already warned inside readJsonDataFile.
          result.set(asset.path, { source: 'absent' });
          return;
        }
        result.set(asset.path, {
          source: 'json',
          value: parsed,
          dataPath: jsonPath,
        });
        return;
      }

      // No co-located data file — record as absent, no error.
      result.set(asset.path, { source: 'absent' });
    }),
  );

  return result;
}

/**
 * Convenience helper: collect every `AssetNode` from a project tree into a
 * flat array, suitable for passing to `loadAssetData`.
 *
 * Walks pages → groups (nested) → assets recursively. Pure — no filesystem
 * access.
 *
 * @param {import('../loader/model.js').ProjectNode} project
 * @returns {AssetNode[]}
 */
export function collectAssets(project) {
  /** @type {AssetNode[]} */
  const result = [];

  /**
   * @param {{ groups: import('../loader/model.js').GroupNode[], assets: AssetNode[] }} container
   */
  function walk(container) {
    for (const asset of container.assets) {
      result.push(asset);
    }
    for (const group of container.groups) {
      walk(group);
    }
  }

  if (project && Array.isArray(project.pages)) {
    for (const page of project.pages) {
      walk(page);
    }
  }

  return result;
}
