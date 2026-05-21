// use-inline-rename.js — utilities for wiring the kebab's "Rename" item to
// the brownfield's inline-rename affordance + the lifecycle rename endpoint
//.
//
// ── Why this helper exists ───────────────────────────────────────────────────
// The brownfield `DCArtboardFrame` / `DCSection` already render an inline
// `DCEditable` for the artboard label or section title. When the user commits
// a label/title change (blur / Enter), the brownfield wires it to its OWN
// `patchSection({ labels: … })` — which only updates in-studio chrome state,
// NOT the file/folder on disk.
//
// adds a second commit path: when the user invokes "Rename" from
// the kebab, we want the on-blur commit to ALSO rename the file/folder on
// disk via `renameProjectFile`. This hook attaches a one-shot listener for
// that.
//
// The user keeps typing in the same DCEditable they already know — there's
// no second input — and the studio simply listens for the next commit to
// also fire a server-side rename.
//
// ── Path derivation rule ────────────────────────────────────────────────────
// The new name is the user's text. We preserve the file extension (for asset
// files) and the parent directory: the new path is `<dir>/<text><ext>`.
// For a folder, the new path is `<parentDir>/<text>`.
//
// Empty / whitespace-only text is rejected (no rename). The user can cancel
// by Escape (the DCEditable doesn't commit on Escape — blur does).
//
// ── Failure handling ────────────────────────────────────────────────────────
// The endpoint returns `{ ok, error }`. On a failed rename (collision,
// permission, etc.) the file stays put and a `console.warn` surfaces the
// reason. The label/title text the user typed STAYS visible in-studio
// because the brownfield's patchSection has already updated it — that's a
// known acceptable transient: the watcher will not see a path change, so the
// next render reverts the label.

import { renameProjectFile } from '../../runtime/write-client.js';

/**
 * Strip leading/trailing whitespace and collapse internal whitespace. Used
 * before validating a new name from the inline editable.
 *
 * @param {string} value
 * @returns {string}
 */
function cleanName(value) {
 if (typeof value !== 'string') return '';
 return value.trim().replace(/\s+/g, ' ');
}

/**
 * For a file `LerretPath`, return its `{ dir, stem, ext }` components.
 * `dir` includes the trailing `/`; `ext` includes the leading `.` (or is `''`).
 *
 * @param {string} path
 * @returns {{ dir: string, stem: string, ext: string }}
 */
export function splitFilePath(path) {
 const slash = path.lastIndexOf('/');
 const dir = slash === -1 ? '' : path.slice(0, slash + 1);
 const base = slash === -1 ? path : path.slice(slash + 1);
 const dot = base.lastIndexOf('.');
 // A leading-dot file (e.g. `.gitignore`) is all-stem, no extension.
 const hasExt = dot > 0;
 const stem = hasExt ? base.slice(0, dot) : base;
 const ext = hasExt ? base.slice(dot) : '';
 return { dir, stem, ext };
}

/**
 * For a folder `LerretPath`, return its `{ parentDir, name }`.
 *
 * @param {string} path
 * @returns {{ parentDir: string, name: string }}
 */
export function splitFolderPath(path) {
 const stripped = path.replace(/\/+$/, '');
 const slash = stripped.lastIndexOf('/');
 if (slash === -1) return { parentDir: '', name: stripped };
 return { parentDir: stripped.slice(0, slash + 1), name: stripped.slice(slash + 1) };
}

/**
 * Compute the renamed path for a file. Returns `null` when the supplied name
 * is empty or unchanged.
 *
 * @param {string} fromPath
 * @param {string} newStem
 * @returns {string | null}
 */
export function renamedFilePath(fromPath, newStem) {
 const clean = cleanName(newStem);
 if (!clean) return null;
 const { dir, stem, ext } = splitFilePath(fromPath);
 if (clean === stem) return null;
 return `${dir}${clean}${ext}`;
}

/**
 * Compute the renamed path for a folder.
 *
 * @param {string} fromPath
 * @param {string} newName
 * @returns {string | null}
 */
export function renamedFolderPath(fromPath, newName) {
 const clean = cleanName(newName);
 if (!clean) return null;
 const { parentDir, name } = splitFolderPath(fromPath);
 if (clean === name) return null;
 return `${parentDir}${clean}`;
}

/**
 * Attach a one-shot listener to the supplied DCEditable element that captures
 * the next "commit" (blur OR Enter keydown) and calls `renameProjectFile`
 * with the resulting new path.
 *
 * Returns a teardown that removes both listeners (in case the user dismisses
 * before committing). The teardown is idempotent.
 *
 * @param {HTMLElement} editable The DCEditable DOM node.
 * @param {object} ctx
 * @param {string} ctx.fromPath The current LerretPath of the asset/folder.
 * @param {'file'|'folder'} ctx.kind Whether `fromPath` points to a file or a folder.
 * @returns {() => void}
 */
export function bindOneShotRename(editable, { fromPath, kind }) {
 if (!editable || !fromPath) return () => {};
 let armed = true;
 let committedText = null;

 const commit = async (text) => {
 if (!armed) return;
 armed = false;
 const targetPath =
 kind === 'folder'
 ? renamedFolderPath(fromPath, text)
 : renamedFilePath(fromPath, text);
 if (!targetPath) return;
 const result = await renameProjectFile(fromPath, targetPath);
 if (!result.ok) {
 console.warn('[lerret] rename failed:', result.error);
 }
 };

 const onBlur = () => {
 if (!armed) return;
 const text = committedText !== null
 ? committedText
 : (editable.textContent || '');
 commit(text);
 teardown();
 };
 const onKeyDown = (e) => {
 if (e.key === 'Enter') {
 committedText = editable.textContent || '';
 // Blur will fire shortly; the commit happens in onBlur.
 } else if (e.key === 'Escape') {
 // Abandon rename — DCEditable doesn't commit on Escape.
 armed = false;
 teardown();
 }
 };

 function teardown() {
 editable.removeEventListener('blur', onBlur);
 editable.removeEventListener('keydown', onKeyDown);
 }

 editable.addEventListener('blur', onBlur);
 editable.addEventListener('keydown', onKeyDown);
 return teardown;
}
