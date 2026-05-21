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
 background: 'transparent',
 color: 'var(--lm-accent-text, #92421E)',
 border: '1px solid var(--lm-accent-border, rgba(184,91,51,0.20))',
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
 border: '1px solid var(--lm-border, #DDD7CA)',
 borderRadius: 'var(--lm-radius-lg, 12px)',
 padding: 'var(--lm-space-6, 24px)',
 maxWidth: '40ch',
 display: 'flex',
 flexDirection: 'column',
 gap: 'var(--lm-space-4, 16px)',
 alignItems: 'center',
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
export function OpenFolder({ onFolderPicked, cliMode = false }) {
 // 'idle' | 'picking' | 'not-lerret-project' | 'cli-guide'
 const [state, setState] = React.useState('idle');
 // The handle we tried but that lacked .lerret/ — kept so we can offer
 // "Pick another folder" from the same error UI.
 const [_failedHandle, setFailedHandle] = React.useState(null);

 // Hover states for inline-styled buttons
 const [primaryHover, setPrimaryHover] = React.useState(false);
 const [secondaryHover, setSecondaryHover] = React.useState(false);

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

 function renderNotLerretProject() {
 return (
 <div role="alert" style={notLerretBoxStyle} data-testid="not-lerret-project-message">
 <h2 style={errorHeadingStyle}>Not a Lerret project</h2>
 <p style={errorBodyStyle}>
 The folder you picked doesn&apos;t contain a <code>.lerret/</code>{' '}
 directory. Open a folder that has one, or create a new project with{' '}
 <code>npx create-lerret my-canvas</code>.
 </p>
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
 <h1 style={headingStyle}>Open a Lerret folder</h1>
 <p style={bodyStyle}>
 {cliMode
 ? 'Run your project with the Lerret CLI — no account or signup needed.'
 : 'Pick a local folder that contains a .lerret/ project. No account or signup needed — your files stay on your machine.'}
 </p>
 </div>

 {state === 'not-lerret-project' && renderNotLerretProject()}
 {state === 'cli-guide' && renderCliGuide()}

 {(state === 'idle' || state === 'picking') && (
 <button
 type="button"
 style={{
 ...primaryButtonStyle,
 ...(primaryHover && !isPicking ? { background: 'var(--lm-accent-hover, #92421E)' } : {}),
 ...(isPicking ? { opacity: 0.7, cursor: 'wait' } : {}),
 }}
 onClick={handlePick}
 disabled={isPicking}
 onMouseEnter={() => setPrimaryHover(true)}
 onMouseLeave={() => setPrimaryHover(false)}
 aria-label={cliMode ? 'Open in terminal' : 'Open a Lerret folder'}
 data-testid="open-folder-button"
 >
 {isPicking ? 'Opening…' : cliMode ? 'How to open' : 'Open a Lerret folder'}
 </button>
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

export default OpenFolder;
