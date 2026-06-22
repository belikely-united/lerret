// open-folder.jsx — "Open a Lerret folder" entry screen (, UX-DR13).
//
// This is the first thing a user sees when visiting the hosted studio with no
// folder connected, and the fallback the CLI no-folder path reuses (FR45,
// ). It must be calm, instructive, and require exactly one action to
// proceed — no account, no signup, no email step (NFR6).
//
// ── Interaction model ────────────────────────────────────────────────────────
// 1. Renders the entry screen with a single primary "Open a Lerret folder"
// button.
// 2. User clicks (or keys Enter / Space) → calls the FSA directory picker.
// 3. If the user cancels the picker (AbortError) → stays on the entry screen
// silently (no error — cancelling is a valid no-op).
// 4. If the picker succeeds, we validate that the folder contains a `.lerret/`
// subdirectory. If it DOES NOT, we show a calm "not a Lerret project"
// message in-place with a "Pick another folder" action — never a blank or
// broken screen (the ACs3).
// 5. If valid → calls `onFolderPicked(handle)` so the parent orchestrator
// can proceed to trust evaluation and canvas mount (FR46).
// The prop approach keeps open-folder.jsx free from trust-dialog.jsx, which
// owns (collision-safe as per the shared-workspace constraint).
//
// ── CLI no-folder mode ───────────────────────────────────────────────────────
// When `cliMode` is true the component renders the same entry screen but its
// "Open a Lerret folder" button behaviour changes slightly: instead of
// running the full FSA-picker → onFolderPicked flow it shows a calm secondary
// message explaining that in CLI mode the folder is determined by the
// `@lerret/cli dev <path>` command. A "Pick a folder (browser preview)" action is
// still offered so the user can do a temporary hosted-style mount if they
// happen to be on a capable browser.
//
// ── Styling ──────────────────────────────────────────────────────────────────
// All --lm-* design tokens from colors_and_type.css. The warm-linen background
// (#F2EEE6 = --lm-bg-secondary), sienna primary button, and generous spacing
// are the studio's entry aesthetic (UX-DR13, UX-DR16).
//
// ── Accessibility ────────────────────────────────────────────────────────────
// - Single `main` landmark.
// - Clear heading hierarchy: h1 (product eyebrow + title), h2 (error state).
// - Primary button is a real <button> — focusable, Enter/Space-activatable.
// - :focus-visible uses --lm-focus-ring (NFR14, WCAG 2.1 §2.4.7).
// - All text colours meet WCAG AA ≥4.5:1 on --lm-bg-secondary.

import React from 'react';

import { switchProject, fetchRecentProjects } from '../../runtime/write-client.js';
import { listRecents, forgetRecent } from '../../runtime/hosted-recents.js';
import { createDemoProject } from '../../runtime/opfs-demo.js';

// ---------------------------------------------------------------------------
// Internal: validate that a directory handle contains a .lerret/ subdirectory
// ---------------------------------------------------------------------------

/**
 * @param {FileSystemDirectoryHandle} handle
 * @returns {Promise<boolean>}
 */
async function hasLerretDir(handle) {
 try {
 await handle.getDirectoryHandle('.lerret');
 return true;
 } catch {
 return false;
 }
}

// ---------------------------------------------------------------------------
// Internal: shared inline styles (derived from --lm-* tokens)
// ---------------------------------------------------------------------------

/** @type {React.CSSProperties} */
const wrapperStyle = {
 width: '100vw',
 height: '100vh',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: 'var(--lm-bg-secondary, #F2EEE6)',
 fontFamily: 'var(--lm-font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)',
 color: 'var(--lm-text-primary, #1A1714)',
 padding: 'var(--lm-space-8, 32px)',
 boxSizing: 'border-box',
};

/** @type {React.CSSProperties} */
const cardStyle = {
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 textAlign: 'center',
 maxWidth: '480px',
 width: '100%',
 gap: 'var(--lm-space-6, 24px)',
};

/** @type {React.CSSProperties} */
const eyebrowStyle = {
 fontSize: 'var(--lm-size-badge, 11px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 letterSpacing: '0.18em',
 textTransform: 'uppercase',
 color: 'var(--lm-text-tertiary, #6E6960)',
 margin: 0,
};

/** @type {React.CSSProperties} */
const headingStyle = {
 fontSize: 'var(--lm-size-h2, 20px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 lineHeight: 'var(--lm-lh-tight, 1.2)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
};

/** @type {React.CSSProperties} */
const bodyStyle = {
 fontSize: 'var(--lm-size-body-lg, 14px)',
 lineHeight: 'var(--lm-lh-relaxed, 1.6)',
 color: 'var(--lm-text-secondary, #3A3530)',
 maxWidth: '40ch',
 margin: 0,
};

/** @type {React.CSSProperties} */
const primaryButtonStyle = {
 display: 'inline-flex',
 alignItems: 'center',
 gap: 'var(--lm-space-2, 8px)',
 padding: 'var(--lm-space-3, 12px) var(--lm-space-6, 24px)',
 background: 'var(--lm-accent, #B85B33)',
 color: 'var(--lm-bg-primary, #FAF8F2)',
 border: 'none',
 borderRadius: 'var(--lm-radius-md, 8px)',
 fontSize: 'var(--lm-size-body-lg, 14px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 fontFamily: 'inherit',
 cursor: 'pointer',
 transition: 'background var(--lm-duration-fast, 120ms)',
 // Note: :hover is handled via onMouseEnter/onMouseLeave since we use inline styles
};

/** @type {React.CSSProperties} */
const secondaryButtonStyle = {
 display: 'inline-flex',
 alignItems: 'center',
 gap: 'var(--lm-space-2, 8px)',
 padding: 'var(--lm-space-3, 12px) var(--lm-space-6, 24px)',
 background: 'var(--lm-accent-light, rgba(184,91,51,0.10))',
 color: 'var(--lm-accent-text, #92421E)',
 border: 'none',
 borderRadius: 'var(--lm-radius-md, 8px)',
 fontSize: 'var(--lm-size-body-lg, 14px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 fontFamily: 'inherit',
 cursor: 'pointer',
 transition: 'background var(--lm-duration-fast, 120ms)',
};

/** @type {React.CSSProperties} */
const notLerretBoxStyle = {
 background: 'var(--lm-bg-primary, #FAF8F2)',
 borderRadius: 'var(--lm-radius-lg, 12px)',
 padding: 'var(--lm-space-6, 24px)',
 maxWidth: '40ch',
 display: 'flex',
 flexDirection: 'column',
 gap: 'var(--lm-space-4, 16px)',
 alignItems: 'center',
 boxShadow: 'var(--lm-shadow-sm, 0 2px 8px rgba(26,23,20,0.08))',
};

/** @type {React.CSSProperties} */
const errorHeadingStyle = {
 fontSize: 'var(--lm-size-h3, 16px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
};

/** @type {React.CSSProperties} */
const errorBodyStyle = {
 fontSize: 'var(--lm-size-body, 13px)',
 lineHeight: 'var(--lm-lh-body, 1.45)',
 color: 'var(--lm-text-secondary, #3A3530)',
 margin: 0,
};

// ---------------------------------------------------------------------------
// FolderIcon — simple SVG that reads as a directory
// ---------------------------------------------------------------------------

function FolderIcon() {
 return (
 <svg
 width="40"
 height="40"
 viewBox="0 0 40 40"
 fill="none"
 aria-hidden="true"
 style={{ flex: 'none' }}
 >
 <rect x="3" y="10" width="34" height="24" rx="3" fill="var(--lm-accent-light, rgba(184,91,51,0.10))" />
 <path
 d="M3 16h34M3 14c0-2.2 1.8-4 4-4h8l3 4"
 stroke="var(--lm-accent, #B85B33)"
 strokeWidth="1.8"
 strokeLinejoin="round"
 fill="none"
 />
 </svg>
 );
}

// ---------------------------------------------------------------------------
// CliConnectScreen — CLI-mode "connect a project folder" (runtime switch)
// ---------------------------------------------------------------------------
//
// In CLI mode the studio is a long-lived server you point at folders. With no
// project connected (fresh launch outside a project, or after "Close project"),
// this screen lets the user CONNECT one — by pasting a folder path or picking a
// recent — without ever touching the terminal. It POSTs to
// `/__lerret/switch-folder`; on success the server broadcasts the new model over
// `lerret:change` and `cli-project-source` swaps it in (unmounting this screen).
//
// Why a typed path and not the FSA picker: the browser FSA picker yields an
// opaque handle, NOT an absolute filesystem path, and the local CLI needs a real
// path to resolve. A path field + recents is the honest, reliable CLI affordance.

/** @type {React.CSSProperties} */
const connectInputStyle = {
 flex: 1,
 minWidth: 0,
 padding: 'var(--lm-space-3, 12px) var(--lm-space-4, 16px)',
 fontSize: 'var(--lm-size-body, 13px)',
 fontFamily: 'var(--lm-font-mono, ui-monospace, SFMono-Regular, monospace)',
 color: 'var(--lm-text-primary, #1A1714)',
 background: 'var(--lm-bg-tertiary, #E8E2D4)',
 border: 'none',
 borderRadius: 'var(--lm-radius-md, 8px)',
 outline: 'none',
 boxSizing: 'border-box',
 transition: 'box-shadow var(--lm-duration-fast, 120ms)',
};

/** @type {React.CSSProperties} */
const recentItemStyle = {
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'flex-start',
 gap: '2px',
 width: '100%',
 padding: 'var(--lm-space-2, 8px) var(--lm-space-3, 12px)',
 background: 'var(--lm-bg-tertiary, #E8E2D4)',
 border: 'none',
 borderRadius: 'var(--lm-radius-md, 8px)',
 cursor: 'pointer',
 textAlign: 'left',
 fontFamily: 'inherit',
 transition: 'background var(--lm-duration-fast, 120ms)',
};

/**
 * The CLI-mode connect-a-project screen.
 *
 * @returns {React.ReactElement}
 */
function CliConnectScreen() {
 const [folderInput, setFolderInput] = React.useState('');
 const [connecting, setConnecting] = React.useState(false);
 const [connectError, setConnectError] = React.useState(null);
 const [recents, setRecents] = React.useState([]);
 const [primaryHover, setPrimaryHover] = React.useState(false);

 // Load the recent-projects list once.
 React.useEffect(() => {
 let cancelled = false;
 fetchRecentProjects().then((list) => {
 if (!cancelled) setRecents(Array.isArray(list) ? list : []);
 });
 return () => {
 cancelled = true;
 };
 }, []);

 const connect = React.useCallback(async (folder) => {
 const target = (folder || '').trim();
 if (!target) {
 setConnectError('Enter a folder path to connect.');
 return;
 }
 setConnecting(true);
 setConnectError(null);
 const result = await switchProject(target);
 if (!result.ok) {
 setConnectError(result.error || 'Could not connect to that folder.');
 setConnecting(false);
 }
 // On success the `lerret:change` broadcast swaps in the project and this
 // screen unmounts — no success branch is needed here.
 }, []);

 const onSubmit = (e) => {
 e.preventDefault();
 connect(folderInput);
 };

 return (
 <main style={wrapperStyle} aria-label="Connect a Lerret project" data-testid="cli-connect-screen">
 <div style={cardStyle}>
 <FolderIcon />

 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-3, 12px)', alignItems: 'center' }}>
 <p style={eyebrowStyle} aria-hidden="true">Lerret</p>
 <h1 style={headingStyle}>Connect a project</h1>
 <p style={bodyStyle}>
 Point the studio at a folder that contains a <code>.lerret/</code> project.
 Your files stay on your machine.
 </p>
 </div>

 <form
 style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-3, 12px)' }}
 onSubmit={onSubmit}
 >
 <div style={{ display: 'flex', gap: 'var(--lm-space-2, 8px)', width: '100%' }}>
 <input
 type="text"
 style={connectInputStyle}
 placeholder="/path/to/your/project"
 value={folderInput}
 onChange={(e) => setFolderInput(e.target.value)}
 disabled={connecting}
 aria-label="Project folder path"
 data-testid="cli-connect-input"
 autoFocus
 />
 <button
 type="submit"
 style={{
 ...primaryButtonStyle,
 ...(primaryHover && !connecting ? { background: 'var(--lm-accent-hover, #92421E)' } : {}),
 ...(connecting ? { opacity: 0.7, cursor: 'wait' } : {}),
 }}
 disabled={connecting}
 onMouseEnter={() => setPrimaryHover(true)}
 onMouseLeave={() => setPrimaryHover(false)}
 data-testid="cli-connect-button"
 >
 {connecting ? 'Connecting…' : 'Connect'}
 </button>
 </div>

 {connectError && (
 <p
 role="alert"
 style={{ ...errorBodyStyle, color: 'var(--lm-error, #A8412B)', alignSelf: 'flex-start' }}
 data-testid="cli-connect-error"
 >
 {connectError}
 </p>
 )}
 </form>

 {recents.length > 0 && (
 <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-2, 8px)' }}>
 <p style={{ ...eyebrowStyle, alignSelf: 'flex-start' }}>Recent projects</p>
 <ul
 style={{ listStyle: 'none', margin: 0, padding: 0, width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-1, 4px)' }}
 data-testid="cli-recent-projects"
 >
 {recents.map((r) => (
 <li key={r.path}>
 <button
 type="button"
 style={recentItemStyle}
 onClick={() => connect(r.path)}
 disabled={connecting}
 data-testid="cli-recent-project"
 >
 <span style={{ fontWeight: 'var(--lm-weight-semibold, 600)', fontSize: 'var(--lm-size-body, 13px)', color: 'var(--lm-text-primary, #1A1714)' }}>
 {r.name}
 </span>
 <span style={{ fontSize: 'var(--lm-size-hint, 10px)', fontFamily: 'var(--lm-font-mono, monospace)', color: 'var(--lm-text-muted, #B8B3A8)' }}>
 {r.path}
 </span>
 </button>
 </li>
 ))}
 </ul>
 </div>
 )}

 <p style={{ ...errorBodyStyle, fontSize: 'var(--lm-size-body-sm, 12px)', color: 'var(--lm-text-tertiary, #6E6960)' }}>
 Tip: you can also launch directly with <code>@lerret/cli dev --folder ./my-project</code>.
 </p>
 </div>

 <style>{`
 [data-testid="cli-connect-input"]:focus-visible,
 [data-testid="cli-connect-button"]:focus-visible,
 [data-testid="cli-recent-project"]:focus-visible {
 outline: none;
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184,91,51,0.20));
 }
 [data-testid="cli-connect-input"]:focus {
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184,91,51,0.20));
 }
 [data-testid="cli-recent-project"]:hover {
 background: var(--lm-bg-secondary, #F2EEE6);
 }
 `}</style>
 </main>
 );
}

// ---------------------------------------------------------------------------
// OpenFolder — the exported component
// ---------------------------------------------------------------------------

/**
 * Props for OpenFolder.
 *
 * @typedef {object} OpenFolderProps
 * @property {(handle: FileSystemDirectoryHandle) => void | Promise<void>} [onFolderPicked]
 * Called with the validated directory handle when the user picks a valid
 * Lerret project folder. The parent orchestrator handles trust-check and
 * canvas mount — this component does not import trust-dialog.jsx.
 * Omit this prop when `cliMode` is true (the CLI no-folder path).
 * @property {boolean} [cliMode]
 * When true, the component is in CLI no-folder mode: the primary action
 * shows guidance toward `@lerret/cli dev <path>` rather than routing through
 * `onFolderPicked`. The browser FSA picker is still offered as a secondary
 * "Preview in browser" option for convenience on capable browsers. Defaults
 * to false.
 */

/**
 * The "Open a Lerret folder" entry screen (, UX-DR13, FR45).
 *
 * - In hosted mode: single primary button → FSA picker → validation →
 * `onFolderPicked(handle)`.
 * - In CLI no-folder mode (`cliMode`): calm guidance toward `@lerret/cli dev <path>`.
 *
 * Does NOT import trust-dialog.jsx or persistence.js (files).
 *
 * @param {OpenFolderProps} props
 * @returns {React.ReactElement}
 */
function HostedOpenFolderImpl({ onFolderPicked, cliMode = false, resumeEntry = null }) {
 // When a resume target is offered (the last project), the primary action
 // becomes "Resume <name>" and the folder picker demotes to secondary.
 const hasResume = !!resumeEntry;
 // 'idle' | 'picking' | 'not-lerret-project' | 'cli-guide'
 const [state, setState] = React.useState('idle');
 // The handle we tried but that lacked .lerret/ — kept so we can offer
 // "Pick another folder" from the same error UI.
 const [_failedHandle, setFailedHandle] = React.useState(null);

 // Hover states for inline-styled buttons
 const [primaryHover, setPrimaryHover] = React.useState(false);
 const [secondaryHover, setSecondaryHover] = React.useState(false);
 // Why a blank-canvas init failed — surfaced, not swallowed. Chrome blocks
 // File System Access writes to protected folders (Desktop/Documents/Downloads).
 const [initError, setInitError] = React.useState(null);

 // Recent hosted projects (H7) — persisted FSA handles, for one-click re-open.
 const [recents, setRecents] = React.useState([]);
 React.useEffect(() => {
 if (cliMode) return undefined;
 let live = true;
 listRecents().then((list) => { if (live) setRecents(list); });
 return () => { live = false; };
 }, [cliMode]);

 async function openRecent(entry) {
 try {
 if (entry.handle && typeof entry.handle.requestPermission === 'function') {
 await entry.handle.requestPermission({ mode: 'readwrite' });
 }
 } catch { /* the bring-up surfaces a lingering permission error */ }
 if (typeof onFolderPicked === 'function') await onFolderPicked(entry.handle);
 }
 async function handleForget(entry) {
 await forgetRecent(entry.id);
 setRecents((list) => list.filter((r) => r.id !== entry.id));
 }

 async function handleTryDemo() {
 try {
 const handle = await createDemoProject();
 if (typeof onFolderPicked === 'function') await onFolderPicked(handle);
 } catch (err) {
 // eslint-disable-next-line no-console
 console.warn('[lerret] demo project failed:', err);
 }
 }

 /**
 * Open the FSA directory picker, validate the selection, and call
 * `onFolderPicked` on success.
 */
 async function handlePick() {
 if (cliMode) {
 // In CLI mode just toggle the guidance panel — no FSA picker by default.
 setState('cli-guide');
 return;
 }

 setState('picking');
 let handle;
 try {
 handle = await window.showDirectoryPicker({ mode: 'readwrite' });
 } catch {
 // User cancelled (AbortError) or picker unavailable — return to idle quietly.
 setState('idle');
 return;
 }

 // Validate: the folder must have a .lerret/ subdirectory.
 const valid = await hasLerretDir(handle);
 if (!valid) {
 setFailedHandle(handle);
 setState('not-lerret-project');
 return;
 }

 setState('idle');
 setFailedHandle(null);
 if (typeof onFolderPicked === 'function') {
 await onFolderPicked(handle);
 }
 }

 /** "Pick another folder" — re-run the picker from the error state. */
 async function handlePickAnother() {
 await handlePick();
 }

 // ---------------------------------------------------------------------------
 // Render helpers
 // ---------------------------------------------------------------------------

 /**
 * Story 7.9 — initialize a `.lerret/` in the picked folder as a "Blank canvas"
 * project, then proceed as if it had one all along. Writes a minimal
 * `.lerret/config.json` via the FSA handle and falls through to `onFolderPicked`.
 *
 * Future work: full three-button picker (Blank / With samples / Pick a preset),
 * AI-rules step, .gitignore safety, confirmation step (FR58/FR58a/FR58b/FR59).
 * This v1 ships only the Blank-canvas path; the two preset paths route users
 * back to `npx create-lerret@latest --preset <name>`.
 */
 async function handleInitializeBlank() {
 if (!_failedHandle) return;
 setInitError(null);
 setState('initializing');
 try {
 const lerretDir = await _failedHandle.getDirectoryHandle('.lerret', { create: true });
 const cfgFile = await lerretDir.getFileHandle('config.json', { create: true });
 const writable = await cfgFile.createWritable();
 const body = JSON.stringify(
 {
 _meta: { initializedBy: 'studio-init-picker', initializedAt: new Date().toISOString() },
 vars: {},
 },
 null,
 2,
 );
 await writable.write(body + '\n');
 await writable.close();
 } catch (err) {
 // Honest degradation: surface WHY (Chrome blocks Desktop/Documents/
 // Downloads for FSA writes) and keep the "Pick another" CTA available.
 // eslint-disable-next-line no-console
 console.warn('[lerret/init] Blank canvas init failed:', err);
 setInitError(
 err && err.name === 'NotAllowedError'
 ? 'Your browser blocked creating files here — Desktop, Documents and Downloads are protected. Pick a regular project folder instead.'
 : `Could not initialize here: ${err && err.message ? err.message : 'unknown error'}.`,
 );
 setState('not-lerret-project');
 return;
 }
 setState('idle');
 const handle = _failedHandle;
 setFailedHandle(null);
 if (typeof onFolderPicked === 'function') {
 await onFolderPicked(handle);
 }
 }

 function renderNotLerretProject() {
 return (
 <div role="alert" style={notLerretBoxStyle} data-testid="not-lerret-project-message">
 <h2 style={errorHeadingStyle}>Not a Lerret project yet</h2>
 <p style={errorBodyStyle}>
 The folder you picked doesn&apos;t contain a <code>.lerret/</code>{' '}
 directory. Initialize a blank canvas here, pick a different folder, or
 create a richer project with{' '}
 <code>npx create-lerret@latest my-canvas</code> (or{' '}
 <code>--preset producthunt</code>, <code>--preset social-media</code>, …).
 </p>
 {initError && (
 <p style={{ ...errorBodyStyle, color: 'var(--lm-error, #A8412B)', fontWeight: 600 }} data-testid="init-error">
 {initError}
 </p>
 )}
 <div style={{ display: 'flex', gap: 'var(--lm-space-2, 8px)', flexWrap: 'wrap' }}>
 <button
 type="button"
 style={{
 ...primaryButtonStyle,
 ...(primaryHover ? { background: 'var(--lm-accent-strong, #9D4A28)' } : {}),
 }}
 onClick={handleInitializeBlank}
 onMouseEnter={() => setPrimaryHover(true)}
 onMouseLeave={() => setPrimaryHover(false)}
 data-testid="init-blank-canvas-button"
 >
 Initialize Lerret here (blank)
 </button>
 <button
 type="button"
 style={{
 ...secondaryButtonStyle,
 ...(secondaryHover ? { background: 'var(--lm-accent-light, rgba(184,91,51,0.10))' } : {}),
 }}
 onClick={handlePickAnother}
 onMouseEnter={() => setSecondaryHover(true)}
 onMouseLeave={() => setSecondaryHover(false)}
 onFocus={() => setSecondaryHover(false)}
 aria-label="Pick another folder"
 data-testid="pick-another-folder-button"
 >
 Pick another folder
 </button>
 </div>
 </div>
 );
 }

 function renderInitializing() {
 return (
 <div style={notLerretBoxStyle} data-testid="initializing-message">
 <h2 style={errorHeadingStyle}>Initializing…</h2>
 <p style={errorBodyStyle}>Creating <code>.lerret/config.json</code> in the picked folder.</p>
 </div>
 );
 }

 function renderCliGuide() {
 return (
 <div style={notLerretBoxStyle} data-testid="cli-mode-guide">
 <h2 style={errorHeadingStyle}>Open in your terminal</h2>
 <p style={errorBodyStyle}>
 In CLI mode the folder is set by the{' '}
 <code>@lerret/cli dev</code> command.{' '}
 Run the following from inside your project:
 </p>
 <pre
 style={{
 background: 'var(--lm-bg-tertiary, #E8E2D4)',
 borderRadius: 'var(--lm-radius-sm, 6px)',
 padding: 'var(--lm-space-3, 12px) var(--lm-space-4, 16px)',
 fontSize: 'var(--lm-size-body-sm, 12px)',
 fontFamily: 'var(--lm-font-mono, monospace)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
 whiteSpace: 'pre',
 overflowX: 'auto',
 width: '100%',
 boxSizing: 'border-box',
 }}
 >
 @lerret/cli dev
 </pre>
 <p style={{ ...errorBodyStyle, fontSize: 'var(--lm-size-body-sm, 12px)', color: 'var(--lm-text-tertiary, #6E6960)' }}>
 Or pass a path: <code>@lerret/cli dev --folder ./my-project</code>
 </p>
 <button
 type="button"
 style={{
 ...secondaryButtonStyle,
 ...(secondaryHover ? { background: 'var(--lm-accent-light, rgba(184,91,51,0.10))' } : {}),
 }}
 onClick={() => setState('idle')}
 onMouseEnter={() => setSecondaryHover(true)}
 onMouseLeave={() => setSecondaryHover(false)}
 data-testid="back-to-entry-button"
 >
 Back
 </button>
 </div>
 );
 }

 // ---------------------------------------------------------------------------
 // Main render
 // ---------------------------------------------------------------------------

 // Don't list the resume target twice — it's the prominent "Resume" button.
 const visibleRecents = hasResume ? recents.filter((r) => r.id !== resumeEntry.id) : recents;

 const isPicking = state === 'picking';

 return (
 <main
 style={wrapperStyle}
 aria-label="Open a Lerret folder"
 data-testid="open-folder-screen"
 >
 <div style={cardStyle}>
 <FolderIcon />

 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-3, 12px)', alignItems: 'center' }}>
 <p style={eyebrowStyle} aria-hidden="true">Lerret</p>
 <h1 style={headingStyle}>{hasResume ? 'Welcome back' : 'Open a Lerret folder'}</h1>
 <p style={bodyStyle}>
 {cliMode
 ? 'Run your project with the Lerret CLI — no account or signup needed.'
 : hasResume
 ? 'Pick up where you left off — or open a different folder. Your files stay on your machine.'
 : 'Pick a local folder that contains a .lerret/ project. No account or signup needed — your files stay on your machine.'}
 </p>
 </div>

 {state === 'not-lerret-project' && renderNotLerretProject()}
 {state === 'cli-guide' && renderCliGuide()}
 {state === 'initializing' && renderInitializing()}

 {hasResume && state === 'idle' && (
 <button
 type="button"
 style={{
 ...primaryButtonStyle,
 ...(primaryHover ? { background: 'var(--lm-accent-hover, #92421E)' } : {}),
 }}
 onClick={() => openRecent(resumeEntry)}
 onMouseEnter={() => setPrimaryHover(true)}
 onMouseLeave={() => setPrimaryHover(false)}
 aria-label={`Resume ${resumeEntry.name}`}
 data-testid="resume-project-button"
 >
 {`Resume ${resumeEntry.name} →`}
 </button>
 )}

 {(state === 'idle' || state === 'picking') && (
 <button
 type="button"
 style={{
 ...(hasResume ? secondaryButtonStyle : primaryButtonStyle),
 ...(!hasResume && primaryHover && !isPicking ? { background: 'var(--lm-accent-hover, #92421E)' } : {}),
 ...(hasResume && secondaryHover ? { background: 'var(--lm-accent-light, rgba(184,91,51,0.10))' } : {}),
 ...(isPicking ? { opacity: 0.7, cursor: 'wait' } : {}),
 }}
 onClick={handlePick}
 disabled={isPicking}
 onMouseEnter={() => (hasResume ? setSecondaryHover(true) : setPrimaryHover(true))}
 onMouseLeave={() => (hasResume ? setSecondaryHover(false) : setPrimaryHover(false))}
 aria-label={cliMode ? 'Open in terminal' : hasResume ? 'Open a different folder' : 'Open a Lerret folder'}
 data-testid="open-folder-button"
 >
 {isPicking ? 'Opening…' : cliMode ? 'How to open' : hasResume ? 'Open a different folder' : 'Open a Lerret folder'}
 </button>
 )}

 {!cliMode && state === 'idle' && (
 <button
 type="button"
 onClick={handleTryDemo}
 data-testid="try-demo-button"
 style={{ ...secondaryButtonStyle, marginTop: 'var(--lm-space-2, 8px)' }}
 >
 Try a demo — no folder needed
 </button>
 )}

 {!cliMode && state === 'idle' && visibleRecents.length > 0 && (
 <div style={{ width: '100%', marginTop: 'var(--lm-space-4, 16px)' }} data-testid="hosted-recents">
 <p style={{ ...eyebrowStyle, marginBottom: 'var(--lm-space-2, 8px)' }} aria-hidden="true">Recent</p>
 <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
 {visibleRecents.slice(0, 6).map((r) => (
 <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
 <button
 type="button"
 onClick={() => openRecent(r)}
 data-testid="hosted-recent"
 title={`Open ${r.name}`}
 style={{ flex: 1, textAlign: 'left', padding: '8px 12px', borderRadius: 'var(--lm-radius-sm, 8px)', border: 'none', background: 'var(--lm-bg-secondary, #F2EEE6)', color: 'var(--lm-text-primary, #1A1714)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
 >
 {r.name}
 </button>
 <button
 type="button"
 onClick={() => handleForget(r)}
 aria-label={`Forget ${r.name}`}
 title="Remove from recents"
 style={{ flex: 'none', width: 28, height: 28, borderRadius: 'var(--lm-radius-sm, 8px)', border: 'none', background: 'transparent', color: 'var(--lm-text-tertiary, #6E6960)', fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
 >
 ×
 </button>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>

 <style>{`
 [data-testid="open-folder-button"]:focus-visible,
 [data-testid="pick-another-folder-button"]:focus-visible,
 [data-testid="back-to-entry-button"]:focus-visible {
 outline: none;
 box-shadow: var(--lm-focus-ring, 0 0 0 2px rgba(184,91,51,0.20));
 }
 `}</style>
 </main>
 );
}

/**
 * The studio's no-project entry screen.
 *
 * - **CLI mode** (`cliMode`): the runtime "connect a project" screen — paste a
 *   folder path or pick a recent, and the studio switches to it without a CLI
 *   restart (POST `/__lerret/switch-folder`). Also the destination of the brand
 *   menu's "Close project".
 * - **Hosted mode**: the File-System-Access picker flow (pick a local folder
 *   with a `.lerret/`, validate, hand the handle to `onFolderPicked`).
 *
 * Split into a thin branch so each path keeps its hooks unconditional.
 *
 * @param {OpenFolderProps} props
 * @returns {React.ReactElement}
 */
export function OpenFolder({ onFolderPicked, cliMode = false, resumeEntry = null }) {
 if (cliMode) return <CliConnectScreen />;
 return <HostedOpenFolderImpl onFolderPicked={onFolderPicked} resumeEntry={resumeEntry} />;
}

export default OpenFolder;
