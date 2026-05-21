// entry-root.jsx — the hosted-mode entry orchestrator.
//
// Runs at studio load in hosted mode (`__LERRET_HOSTED_MODE__`) to decide
// which entry screen to show:
//
// 1. `isFileSystemAccessSupported()` → false → <UnsupportedBrowser>
// 2. `isFileSystemAccessSupported()` → true → <OpenFolder>
//
// After the user picks a valid folder, `<OpenFolder>` calls the `onFolderPicked`
// prop, which is wired here to:
// - Store the handle in the `pendingHandle` state.
// - will extend this by adding the trust-dialog gate; for now the
// handle flows directly to the `onReady` callback so the parent can mount
// the canvas. (This component does NOT import trust-dialog.jsx or
// persistence.js — those are 's files.)
//
// Props:
// `onReady(handle)` — called when the user has picked and validated a folder.
// The parent (hosted-project-source.jsx) should create
// the FSA backend + watcher and mount <ProjectStudio>.
//
// wires trust-dialog.jsx by replacing or composing with this
// component in hosted-project-source.jsx — entry-root.jsx stays a
// collision-safe boundary.

import { isFileSystemAccessSupported } from './capability-detection.js';
import { OpenFolder } from './open-folder.jsx';
import { UnsupportedBrowser } from './unsupported-browser.jsx';

/**
 * Props for EntryRoot.
 *
 * @typedef {object} EntryRootProps
 * @property {(handle: FileSystemDirectoryHandle) => void | Promise<void>} [onReady]
 * Called when the user has picked a valid Lerret project folder. The parent
 * should mount the canvas at this point. intercepts here to add
 * the trust gate before forwarding to the canvas.
 */

/**
 * The hosted-mode entry orchestrator.
 *
 * - Shows `<UnsupportedBrowser>` when the File System Access API is absent.
 * - Shows `<OpenFolder>` when the API is present; forwards `onFolderPicked`
 * to the `onReady` prop.
 *
 * @param {EntryRootProps} props
 * @returns {React.ReactElement}
 */
export function EntryRoot({ onReady }) {
 const supported = isFileSystemAccessSupported();

 if (!supported) {
 return <UnsupportedBrowser />;
 }

 return (
 <OpenFolder
 onFolderPicked={onReady}
 />
 );
}

export default EntryRoot;
