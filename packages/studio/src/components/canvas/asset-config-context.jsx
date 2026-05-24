// asset-config-context.jsx — React context delivering per-asset config to the
// canvas (ADR-003).
//
// Mirrors `cascade-context.jsx`, but keyed by ASSET path instead of folder path.
// An asset's `Name.config.json` (read by `@lerret/core`'s `loadAssetConfigs` at
// build time and serialized as `assetConfigEntries`) holds tool-managed,
// non-code settings — currently `autoRefresh` (a timer interval in ms). Unlike
// the folder config cascade, per-asset config does NOT inherit: each asset owns
// its settings, looked up by its own path.
//
// Usage:
//   <AssetConfigProvider assetConfigEntries={entries}>…</AssetConfigProvider>
//   const getAssetConfig = useAssetConfig();
//   const cfg = getAssetConfig('/abs/.lerret/live/Clock.jsx'); // {} if none
//   const ms = typeof cfg.autoRefresh === 'number' ? cfg.autoRefresh : undefined;

import React from 'react';

/**
 * @typedef {Record<string, unknown>} ConfigObject
 * @typedef {(assetPath: string) => ConfigObject} GetAssetConfig
 *   Returns the per-asset config for an asset path, or `{}` when the asset has
 *   no `Name.config.json` — so consumers can read without null-checking.
 */

/** Default: always `{}` so components outside a provider (e.g. unit tests) work. */
const defaultGetAssetConfig = /** @type {GetAssetConfig} */ (() => ({}));

const AssetConfigContext = React.createContext(defaultGetAssetConfig);
AssetConfigContext.displayName = 'AssetConfigContext';

/**
 * Build the `getAssetConfig` lookup for a per-asset config map. Defined at module
 * scope (not in render) so the function identity is stable for the same map.
 *
 * @param {Map<string, ConfigObject> | null} configMap
 * @returns {GetAssetConfig}
 */
function makeGetAssetConfig(configMap) {
  return (assetPath) => {
    if (!configMap) return {};
    const cfg = configMap.get(assetPath);
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  };
}

/**
 * Provide the per-asset config map to descendant canvas components.
 *
 * `assetConfigEntries` is the serialized form — `Array<[assetPath, config]>` —
 * produced by the CLI plugin / dev-harness from `loadAssetConfigs`. Rebuilt into
 * a `Map` here. `null`/empty yields a provider that always returns `{}`.
 *
 * @param {object} props
 * @param {Array<[string, ConfigObject]> | null | undefined} props.assetConfigEntries
 * @param {React.ReactNode} props.children
 * @returns {React.ReactElement}
 */
export function AssetConfigProvider({ assetConfigEntries, children }) {
  const configMap = React.useMemo(() => {
    if (!Array.isArray(assetConfigEntries) || assetConfigEntries.length === 0) {
      return null;
    }
    return new Map(/** @type {Array<[string, ConfigObject]>} */ (assetConfigEntries));
  }, [assetConfigEntries]);

  const getAssetConfig = React.useMemo(() => makeGetAssetConfig(configMap), [configMap]);

  return (
    <AssetConfigContext.Provider value={getAssetConfig}>
      {children}
    </AssetConfigContext.Provider>
  );
}

/**
 * Hook: returns `getAssetConfig(assetPath) => ConfigObject` (or `{}`), stable
 * across renders while the underlying map is unchanged.
 *
 * @returns {GetAssetConfig}
 */
export function useAssetConfig() {
  return React.useContext(AssetConfigContext);
}

export default AssetConfigProvider;
