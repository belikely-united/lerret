/**
 * selection-scope-context.jsx — the canvas-selection scope source for the dock
 * AI input cluster's selection chip (Story 8.2, Task 2).
 *
 * The v1 canvas has no multi-select / selected-artboard state, so this story
 * introduces a minimal, serializable selection scope that the canvas writes
 * into on artboard / marquee selection and the dock cluster's chip reads. It is
 * the architecture's resolution of the selection-chip → JSX-node open question
 * (UX-delta §9 / change-proposal §6).
 *
 * Scope shape (kept intentionally small):
 *   { kind: 'file' | 'artboards' | 'page' | null, label, filePath?, count? }
 *     - kind 'file'      → one artboard / one file is selected; `filePath` is its
 *                          LerretPath, `label` is the file basename (or a
 *                          @babel/parser-resolved component name when available).
 *     - kind 'artboards' → multiple artboards selected via marquee; `count` is N,
 *                          `label` is "N artboards".
 *     - kind 'page'      → a whole page is the scope; `label` is "<page-name> page".
 *     - kind null        → no selection; the input is project-wide (no chip).
 *
 * Selection scope PERSISTS across turns. Only the chip's × / Delete / Backspace
 * clears it (Story 8.2 AC-4). Running a turn reads the scope but never clears it.
 *
 * This context lives under packages/studio/src/ai/ but does NOT reach @lerret/ai
 * — it is pure chrome state. (The chip's best-effort @babel/parser source
 * mapping is a separate, lazy @lerret/studio-local import, not an @lerret/ai
 * reach, so it is allowed under the dynamic-import boundary.)
 */

import React from 'react';

/**
 * @typedef {Object} SelectionScope
 * @property {'file' | 'artboards' | 'page' | null} kind
 * @property {string} label - The chip's visible label.
 * @property {string} [filePath] - The selected file's LerretPath (kind 'file').
 * @property {number} [count] - The number of selected artboards (kind 'artboards').
 */

/**
 * @typedef {Object} SelectionScopeValue
 * @property {SelectionScope | null} scope - The current selection scope, or null.
 * @property {(next: SelectionScope | null) => void} setScope - Replace the scope.
 * @property {() => void} clearScope - Clear the scope (chip × / Delete / Backspace).
 */

/** The null-scope sentinel — render-stable so consumers can default-compare. */
const EMPTY_SCOPE = null;

/** @type {React.Context<SelectionScopeValue>} */
const SelectionScopeContext = React.createContext(
    /** @type {SelectionScopeValue} */ ({
        scope: EMPTY_SCOPE,
        setScope: () => {},
        clearScope: () => {},
    }),
);

/**
 * Read the current selection scope value. Returns the default (null scope,
 * no-op setters) when no provider wraps the consumer — so the dock cluster and
 * the canvas both render safely in isolation / in tests.
 *
 * @returns {SelectionScopeValue}
 */
export function useSelectionScope() {
    return React.useContext(SelectionScopeContext);
}

/**
 * Provider for the canvas selection scope. Mount once around both the dock
 * (which reads the scope into the chip) and the canvas (which writes the scope
 * on selection). The scope is in-memory only — there is no persistence (cleared
 * on reload), consistent with the session-scoped thread.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function SelectionScopeProvider({ children }) {
    const [scope, setScopeState] = React.useState(/** @type {SelectionScope | null} */ (EMPTY_SCOPE));

    const setScope = React.useCallback((next) => {
        // Normalize an explicit `{ kind: null }` (or null) to the null sentinel
        // so "no scope" is a single representation the chip can branch on.
        if (!next || next.kind == null) {
            setScopeState(EMPTY_SCOPE);
            return;
        }
        setScopeState(next);
    }, []);

    const clearScope = React.useCallback(() => {
        setScopeState(EMPTY_SCOPE);
    }, []);

    const value = React.useMemo(
        () => ({ scope, setScope, clearScope }),
        [scope, setScope, clearScope],
    );

    return (
        <SelectionScopeContext.Provider value={value}>
            {children}
        </SelectionScopeContext.Provider>
    );
}

/**
 * Build a `kind: 'file'` selection scope from a file path. The label is the
 * file basename by default; callers that resolve a richer component name (via
 * the best-effort @babel/parser mapping) can pass it as `label`.
 *
 * @param {string} filePath - The selected file's LerretPath.
 * @param {string} [label] - Optional richer label (component name).
 * @returns {SelectionScope}
 */
export function fileScope(filePath, label) {
    const basename = String(filePath).split('/').filter(Boolean).pop() || String(filePath);
    return { kind: 'file', filePath, label: label || basename };
}

/**
 * Build a `kind: 'artboards'` selection scope for a marquee multi-select.
 *
 * @param {number} count - The number of selected artboards (>= 1).
 * @returns {SelectionScope}
 */
export function artboardsScope(count) {
    const n = Math.max(1, Number(count) || 1);
    return { kind: 'artboards', count: n, label: `${n} artboards` };
}

/**
 * Build a `kind: 'page'` selection scope for a whole-page scope.
 *
 * @param {string} pageName - The page's display name.
 * @returns {SelectionScope}
 */
export function pageScope(pageName) {
    return { kind: 'page', label: `${pageName} page` };
}
