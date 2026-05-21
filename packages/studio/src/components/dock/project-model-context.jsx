// project-model-context.jsx — bridges the loaded ProjectNode to the dock
//.
//
// The dock lives above the project canvas in the tree. This context carries
// the project model (ProjectNode) up so the dock's "Export project" action
// can call `runBulkExport({ project, scope: { kind: 'project' } })` without
// prop-drilling through StudioShell.
//
// The value is `null` when no project is loaded (brownfield `#storyboard`
// page) — the dock hides the export button in that case.

import React from 'react';

/**
 * Context holding the loaded ProjectNode, or `null` when no project is loaded.
 *
 * @type {React.Context<import('@lerret/core').ProjectNode | null>}
 */
export const ProjectModelContext = React.createContext(null);

/**
 * Read the loaded ProjectNode from context.
 *
 * @returns {import('@lerret/core').ProjectNode | null}
 */
export function useProjectModel() {
 return React.useContext(ProjectModelContext);
}
