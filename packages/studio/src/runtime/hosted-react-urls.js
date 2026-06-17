// hosted-react-urls.js — the import-map URL set for the hosted runtime.
//
// The studio's React is bundled (in the hosted build). The Vite config emits
// small re-export modules (react-instance.js etc.) as STABLE-named entry chunks
// that re-export that SAME bundled React — Rolldown hoists React into a shared
// chunk both these entries and the studio import. Pointing the import map at
// these stable URLs makes SW-served, Sucrase-transformed user assets resolve
// `react` / `react/jsx-runtime` / `react-dom` to the studio's one React
// instance (two copies would break hooks/context). (Epic 10 / Story H1.2.)
//
// VERIFY IN A REAL BROWSER: the build emits these files at the URLs below
// (checked at build time); the one-React-instance guarantee is confirmed when
// a rendered user asset's hooks work in Chrome.

/** The deploy base ('./' keeps the bundle sub-path-friendly). */
const BASE = (import.meta && import.meta.env && import.meta.env.BASE_URL) || './';

/**
 * URL of a stable-named entry chunk (matches `entryFileNames` in vite.config.js).
 * @param {string} name
 * @returns {string}
 */
function assetUrl(name) {
  return `${BASE}assets/${name}.js`;
}

/**
 * The `{ react, jsxRuntime, reactDom, reactDomClient }` URL set consumed by
 * `setReactImportMap`.
 *
 * @returns {{ react: string, jsxRuntime: string, reactDom: string, reactDomClient: string }}
 */
export function resolveReactImportMapUrls() {
  return {
    react: assetUrl('react-instance'),
    jsxRuntime: assetUrl('react-jsx-runtime-instance'),
    reactDom: assetUrl('react-dom-instance'),
    reactDomClient: assetUrl('react-dom-client-instance'),
  };
}
