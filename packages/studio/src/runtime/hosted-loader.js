// hosted-loader.js — build the in-browser project model for hosted mode.
//
// CLI mode receives a ready-made model from the server (the `virtual:lerret-project`
// module that `@lerret/cli`'s Vite plugin computes). Hosted mode has no server:
// it loads the model in the browser straight from the user's folder via the
// File System Access backend, running the SAME pure `@lerret/core` pipeline the
// CLI runs server-side — scan → cascade → per-asset config. Only the backend
// differs, so `<ProjectStudio>` receives an identical shape in either mode.
//
// (Epic 10 / Story H1.)

import {
  scan,
  computeCascadedConfig,
  loadAssetConfigs,
  collectAssets,
} from '@lerret/core';

/**
 * The loader's scan root — the `.lerret/` marker directory, relative to the
 * project-root handle the user picks. (The picker hands us the project root
 * directly; `open-folder` verifies the `.lerret/` child exists, so no upward
 * walk is needed the way the CLI's `resolveProject` does.)
 *
 * @type {string}
 */
export const HOSTED_SCAN_ROOT = '.lerret';

/**
 * Load the project model plus the serialized cascade and per-asset config from
 * a `FilesystemAccess` backend rooted at the user's project folder.
 *
 * The cascade and asset-config Maps are serialized to `Array<[path, config]>`
 * — exactly what `CascadedConfigProvider` / `AssetConfigProvider` rehydrate and
 * what the CLI exposes via the virtual module — so the consuming components are
 * mode-agnostic.
 *
 * @param {import('@lerret/core').FilesystemAccess} backend
 *   A backend rooted at the project folder (typically an FSA backend).
 * @param {string} [scanRoot] LerretPath of `.lerret/` relative to the root.
 * @returns {Promise<{
 *   project: object,
 *   cascadeEntries: Array<[string, object]>,
 *   assetConfigEntries: Array<[string, object]>,
 * }>}
 */
export async function loadHostedProject(backend, scanRoot = HOSTED_SCAN_ROOT) {
  const project = await scan(backend, scanRoot);
  const cascade = await computeCascadedConfig(project, backend);
  const assetConfigs = await loadAssetConfigs(collectAssets(project), backend);
  return {
    project,
    cascadeEntries: Array.from(cascade.entries()),
    assetConfigEntries: Array.from(assetConfigs.entries()),
  };
}
