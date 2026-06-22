// entry-root.jsx — the hosted-mode entry orchestrator.
//
// Runs at studio load in hosted mode (`__LERRET_HOSTED_MODE__`) to decide
// which entry screen to show:
//
// 1. `isFileSystemAccessSupported()` → false → <UnsupportedBrowser>
// 2. `isFileSystemAccessSupported()` → true → resume probe → <OpenFolder>
//
// ── Resume-on-load (Option 2) ────────────────────────────────────────────────
// A refresh tears down the in-memory connection, but the most-recent project's
// directory handle is persisted in IndexedDB (hosted-recents). On boot we probe
// it WITHOUT a user gesture via `queryPermission`:
//   - 'granted'  → the browser kept access (installed PWA / persistent perms):
//                  re-open immediately — a ZERO-CLICK restore, no picker.
//   - otherwise  → the File System Access API drops folder permission across
//                  reloads and re-granting legally needs a user gesture, so we
//                  fall through to <OpenFolder> with a prominent one-click
//                  "Resume <project>" affordance (the click IS the gesture).
// A calm splash covers the probe so the picker never flashes before a restore.
//
// After the user picks (or resumes) a valid folder, `<OpenFolder>` calls
// `onFolderPicked`, wired here to the `onReady` prop so the parent
// (hosted-project-source.jsx) can create the FSA backend + watcher and mount
// <ProjectStudio>.

import React from 'react';

import { isFileSystemAccessSupported } from './capability-detection.js';
import { OpenFolder } from './open-folder.jsx';
import { UnsupportedBrowser } from './unsupported-browser.jsx';
import { listRecents } from '../../runtime/hosted-recents.js';

/** @type {React.CSSProperties} */
const splashStyle = {
 width: '100vw',
 height: '100vh',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: 'var(--lm-bg-secondary, #F2EEE6)',
 fontFamily: 'var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)',
 color: 'var(--lm-text-tertiary, #6E6960)',
 fontSize: 'var(--lm-size-body-lg, 14px)',
 padding: 'var(--lm-space-8, 32px)',
 boxSizing: 'border-box',
};

/**
 * A calm "resuming…" splash shown while we probe the last project's permission
 * (and during a zero-click restore), so the picker never flashes first.
 *
 * @param {{ name?: string | null }} props
 * @returns {React.ReactElement}
 */
function ResumeSplash({ name }) {
 return (
 <main style={splashStyle} aria-label="Loading your project" data-testid="resume-splash">
 <span>{name ? `Resuming ${name}…` : ''}</span>
 </main>
 );
}

/**
 * Props for EntryRoot.
 *
 * @typedef {object} EntryRootProps
 * @property {(handle: FileSystemDirectoryHandle) => void | Promise<void>} [onReady]
 * Called when the user has picked (or resumed) a valid Lerret project folder.
 * The parent should mount the canvas at this point.
 */

/**
 * The hosted-mode entry orchestrator.
 *
 * - Shows `<UnsupportedBrowser>` when the File System Access API is absent.
 * - Otherwise probes the most-recent project for a zero-click resume, then
 *   shows `<OpenFolder>` (with a one-click Resume affordance) if a gesture is
 *   needed.
 *
 * @param {EntryRootProps} props
 * @returns {React.ReactElement}
 */
export function EntryRoot({ onReady }) {
 const supported = isFileSystemAccessSupported();
 // 'probing' (brief, initial) | 'restoring' (zero-click open underway) | 'manual'
 const [resume, setResume] = React.useState(
 /** @type {{ phase: 'probing' | 'restoring' | 'manual', entry: any }} */ ({ phase: 'probing', entry: null }),
 );
 // Latest onReady, read without re-running the mount-only probe (so a parent
 // re-render with a new callback identity can't abort an in-flight probe).
 const onReadyRef = React.useRef(onReady);
 onReadyRef.current = onReady;

 React.useEffect(() => {
 let live = true;
 (async () => {
 if (!isFileSystemAccessSupported()) {
 if (live) setResume({ phase: 'manual', entry: null });
 return;
 }
 // The most-recent project is the resume target (recents are newest-first).
 // A storage miss just yields the normal picker.
 let entry = null;
 try {
 const list = await listRecents();
 entry = Array.isArray(list) && list.length ? list[0] : null;
 } catch {
 entry = null;
 }
 if (!live) return;
 if (!entry || !entry.handle) {
 setResume({ phase: 'manual', entry: null });
 return;
 }
 // Silent probe — queryPermission needs no user gesture.
 let state = 'prompt';
 try {
 if (typeof entry.handle.queryPermission === 'function') {
 state = await entry.handle.queryPermission({ mode: 'readwrite' });
 }
 } catch {
 state = 'prompt';
 }
 if (!live) return;
 if (state === 'granted') {
 // Zero-click restore — the browser kept access across the reload.
 setResume({ phase: 'restoring', entry });
 try {
 const cb = onReadyRef.current;
 if (typeof cb === 'function') await cb(entry.handle);
 } catch {
 // The backend surfaced a permission / bring-up error — fall back to
 // the picker so the user can re-grant via a click.
 if (live) setResume({ phase: 'manual', entry });
 }
 } else {
 // Permission lapsed — offer a one-click Resume in the picker.
 setResume({ phase: 'manual', entry });
 }
 })();
 return () => {
 live = false;
 };
 // Mount-only: FSA support is re-checked inside; onReady read via ref.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 if (!supported) {
 return <UnsupportedBrowser />;
 }

 if (resume.phase === 'probing' || resume.phase === 'restoring') {
 return <ResumeSplash name={resume.phase === 'restoring' && resume.entry ? resume.entry.name : null} />;
 }

 return <OpenFolder onFolderPicked={onReady} resumeEntry={resume.entry} />;
}

export default EntryRoot;
