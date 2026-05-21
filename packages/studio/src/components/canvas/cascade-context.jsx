// cascade-context.jsx — React context that delivers the cascaded per-folder
// config map to any canvas component that needs it.
//
// ── Why a context ─────────────────────────────────────────────────────────
// The cascaded config is computed once per project (either server-side in the
// CLI plugin or in `dev-harness.jsx` from the fixture FS), then threaded down
// to `ProjectCanvas` → each `DCSection`. Rather than prop-drilling a Map
// through every layer, a context makes the map available everywhere the canvas
// hierarchy needs it — the section renderer reads it with `useCascadedConfig`
// and looks up the effective config for its own folder path.
//
// ── Shape of the cascaded config data ─────────────────────────────────────
// The cascade Map (`Map<LerretPath, ConfigObject>`) is produced by
// `computeCascadedConfig` in `@lerret/core`. Because `Map` cannot be
// JSON-stringified across a Vite virtual module boundary, the CLI plugin
// serializes it as an `Array<[path, config]>` and the studio-side deserialization
// in `cli-project-source.jsx` rebuilds the `Map`. The dev-harness computes it
// in memory and hands the `Map` directly.
//
// ── Usage ─────────────────────────────────────────────────────────────────
// // Parent — wraps the canvas subtree with the cascade:
// <CascadedConfigProvider cascadeEntries={entries}>
// <ProjectCanvas … />
// </CascadedConfigProvider>
//
// // Consumer — looks up the effective config for a folder path:
// const getConfigFor = useCascadedConfig();
// const cfg = getConfigFor('/path/to/page-or-group');

import React from 'react';

/**
 * @typedef {Record<string, unknown>} ConfigObject
 * A plain config object (keyed strings → JSON-safe values).
 */

/**
 * @typedef {(path: string) => ConfigObject} GetConfigFor
 * A function that returns the effective cascaded config for a folder path.
 * Returns `{}` (empty object) for any path not in the cascade map — so
 * consumers can always safely read from the result without null-checking.
 */

/**
 * The React context carrying the `getConfigFor` lookup function.
 *
 * Default value is a `getConfigFor` that always returns `{}` — so components
 * that render outside a `CascadedConfigProvider` (e.g. in unit tests that do
 * not set up the context) still work correctly without errors.
 *
 * @type {React.Context<GetConfigFor>}
 */
const CascadeContext = React.createContext(
 /** @type {GetConfigFor} */
 () => ({}),
);

CascadeContext.displayName = 'CascadeContext';

/**
 * Provide the cascaded config map to descendant components.
 *
 * `cascadeEntries` is the serialized form of the `Map<LerretPath, ConfigObject>` —
 * an `Array<[string, ConfigObject]>` that can safely cross any JSON boundary.
 * Both the CLI plugin (virtual module) and the dev-harness serialize the map
 * to this form before passing it here; the context reconstructs the `Map`
 * internally.
 *
 * When `cascadeEntries` is `null` or `undefined` (no cascade computed yet,
 * or a project without config files), the context still provides a valid
 * `getConfigFor` that always returns `{}` — no downstream errors.
 *
 * @param {object} props
 * @param {Array<[string, ConfigObject]> | null | undefined} props.cascadeEntries
 * Serialized cascade map — `Array<[folderPath, effectiveConfig]>`.
 * @param {React.ReactNode} props.children
 * @returns {React.ReactElement}
 */
export function CascadedConfigProvider({ cascadeEntries, children }) {
 // Rebuild the Map from the serialized entries. Memoized so the map is only
 // reconstructed when `cascadeEntries` identity changes (i.e. when the CLI
 // plugin sends a new cascade after a config.json edit).
 const cascadeMap = React.useMemo(() => {
 if (!Array.isArray(cascadeEntries) || cascadeEntries.length === 0) {
 return null;
 }
 return new Map(/** @type {Array<[string, ConfigObject]>} */ (cascadeEntries));
 }, [cascadeEntries]);

 // A stable callback that consumers call with a folder path to get its
 // effective config. `useCallback` re-creates it only when `cascadeMap`
 // changes (same cadence as the map above). This is a separately-stable
 // reference so React's rules-of-hooks and the React Compiler are both happy.
 const getConfigFor = React.useCallback(
 /** @type {GetConfigFor} */
 (path) => {
 if (!cascadeMap) return {};
 const cfg = cascadeMap.get(path);
 return (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) ? cfg : {};
 },
 [cascadeMap],
 );

 return (
 <CascadeContext.Provider value={getConfigFor}>
 {children}
 </CascadeContext.Provider>
 );
}

/**
 * Hook: returns a function `getConfigFor(path) => ConfigObject` that looks up
 * the effective cascaded config for any folder path.
 *
 * The returned function is stable across renders as long as the cascade map
 * hasn't changed — consuming components can use it in render logic without
 * over-triggering effects.
 *
 * @returns {GetConfigFor}
 *
 * @example
 * // Inside a canvas section:
 * const getConfigFor = useCascadedConfig();
 * const cfg = getConfigFor(section.id); // section.id is the folder's LerretPath
 * const bg = cfg.presentation?.background; // may be undefined
 */
export function useCascadedConfig() {
 return React.useContext(CascadeContext);
}

export default CascadedConfigProvider;
