// config/asset-config.js — per-asset `Name.config.json` sidecar discovery + load.
//
// An asset (`Name.jsx`) may carry a co-located `Name.config.json` holding
// tool-managed, non-code settings — currently just `autoRefresh` (a timer
// interval in ms; see ADR-003). This mirrors the co-located `Name.data.json`
// discovery in `data/loader.js`, but unlike the folder `config.json` cascade
// (`config/cascade.js`) per-asset config does NOT cascade: each asset owns its
// settings outright, keyed by the asset's own path.
//
// PURE module — no `node:fs`, no DOM APIs. All filesystem access goes through
// the injected `FilesystemAccess` backend. Runs identically in the Node CLI and
// the browser studio.

/* global console */

import { assertFilesystemContract } from '../fs/filesystem.js';

/**
 * @typedef {import('../fs/filesystem.js').FilesystemAccess} FilesystemAccess
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('../loader/model.js').AssetNode} AssetNode
 * @typedef {Record<string, unknown>} ConfigObject
 */

/**
 * Return the directory portion of a forward-slash LerretPath (up to and
 * including the last `/`). A path with no `/` returns `''`.
 * @param {LerretPath} path
 * @returns {string}
 */
function dirName(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash + 1);
}

/**
 * @param {unknown} v
 * @returns {v is ConfigObject}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The `Name.config.json` path co-located with an asset: `<dir>/Name.config.json`.
 * Exported so the studio's write path targets the exact same file core reads.
 *
 * @param {{ path: LerretPath, name: string }} asset
 * @returns {LerretPath}
 */
export function assetConfigPath(asset) {
  return `${dirName(asset.path)}${asset.name}.config.json`;
}

/**
 * Read and parse one asset's `Name.config.json` through the backend.
 *
 * Returns the parsed object on success; `null` when the file is absent (normal),
 * unreadable, malformed JSON, or not a plain object. Malformed/wrong-type files
 * warn once so the user can find them — failure is isolated to this asset.
 *
 * @param {{ path: LerretPath, name: string }} asset
 * @param {FilesystemAccess} backend
 * @returns {Promise<ConfigObject | null>}
 */
async function readAssetConfigFile(asset, backend) {
  const dir = dirName(asset.path);
  if (!dir) return null;

  const fileName = `${asset.name}.config.json`;

  /** @type {import('../fs/filesystem.js').DirEntry[]} */
  let entries;
  try {
    entries = await backend.readDir(dir.replace(/\/$/, ''));
  } catch {
    return null; // directory unreadable — treat as absent
  }
  const found = entries.find((e) => e.isFile && e.name === fileName);
  if (!found) return null; // no co-located config — normal

  let text;
  try {
    text = await backend.readFile(found.path, { encoding: 'utf-8' });
  } catch (err) {
    console.warn(
      `[lerret/config] Could not read "${found.path}": ${err instanceof Error ? err.message : String(err)}. Treating asset config as absent.`,
    );
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(/** @type {string} */ (text));
  } catch (err) {
    console.warn(
      `[lerret/config] Malformed JSON in "${found.path}": ${err instanceof Error ? err.message : String(err)}. Treating asset config as absent.`,
    );
    return null;
  }

  if (!isPlainObject(parsed)) {
    console.warn(
      `[lerret/config] Skipping "${found.path}": top-level value must be a plain object (got ${Array.isArray(parsed) ? 'array' : typeof parsed}).`,
    );
    return null;
  }

  return parsed;
}

/**
 * Discover and load the co-located `Name.config.json` for every asset in
 * `assets`. The returned `Map` contains an entry **only** for assets that have a
 * valid config file (so a missing entry means "no per-asset config" — consumers
 * treat that as defaults / off).
 *
 * @param {AssetNode[]} assets
 *   Flat asset list (e.g. from `collectAssets`).
 * @param {FilesystemAccess} backend
 *   The injected filesystem backend — the same one the loader uses.
 * @returns {Promise<Map<LerretPath, ConfigObject>>}
 *   `assetPath → parsed config object`. Never rejects — all errors are isolated
 *   and emitted as warnings.
 */
export async function loadAssetConfigs(assets, backend) {
  assertFilesystemContract(backend, 'loadAssetConfigs(backend)');

  if (!Array.isArray(assets)) {
    throw new TypeError('loadAssetConfigs(assets): assets must be an array');
  }

  /** @type {Map<LerretPath, ConfigObject>} */
  const result = new Map();

  await Promise.all(
    assets.map(async (asset) => {
      if (asset == null || typeof asset.path !== 'string' || typeof asset.name !== 'string') {
        return;
      }
      const config = await readAssetConfigFile(asset, backend);
      if (config !== null) {
        result.set(asset.path, config);
      }
    }),
  );

  return result;
}
