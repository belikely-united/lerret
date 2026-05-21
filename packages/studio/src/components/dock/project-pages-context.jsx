// project-pages-context.jsx — bridges the loaded project's page navigation to
// the dock's page picker.
//
// The dock lives in `StudioShell`, *above* the page node that loads and
// renders the Lerret project. The project's page list (and which one is
// current) is therefore discovered below the dock. This tiny context carries
// that navigation up: the project canvas publishes `{ pages, current,
// onNavigate }`; the dock reads it and renders the `PagePicker`.
//
// The value is `null` whenever no project is loaded (e.g. the brownfield
// `#storyboard` page) — the dock then falls back to its studio-shell page
// buttons. Keeping this in a context (rather than threading props through
// `StudioShell`) keeps `StudioShell` generic and the scan where it belongs.

import React from 'react';

/**
 * @typedef {object} ProjectPagesNav
 * @property {{ id: string, label: string }[]} pages
 * The loaded project's pages, in order — `id` is the page's `LerretPath`.
 * @property {string} current The active page's `id`.
 * @property {(id: string) => void} onNavigate Switch to a page by `id`.
 */

/**
 * Context holding the loaded project's page navigation, or `null` when no
 * project is loaded.
 *
 * @type {React.Context<ProjectPagesNav | null>}
 */
export const ProjectPagesContext = React.createContext(null);

/**
 * Read the loaded project's page navigation from context.
 *
 * @returns {ProjectPagesNav | null}
 */
export function useProjectPages() {
 return React.useContext(ProjectPagesContext);
}
