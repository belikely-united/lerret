// unsupported-browser.jsx — guidance shown when File System Access API is
// absent (, UX-DR15, FR48, NFR11).
//
// Safari and Firefox don't support `window.showDirectoryPicker`. Rather than
// rendering a blank or broken studio, the capability detection in entry-root.jsx
// gates on `isFileSystemAccessSupported()` and mounts this notice instead.
//
// Design intent (UX spec §"Honest degradation"):
// - Calm, informative — never alarmed or scolded.
// - Concrete "What to try" list: switch browser OR use the CLI.
// - Not a paywall, not a nag, not a wall of text.
// - Same warm aesthetic as <OpenFolder> — same tokens, same visual language.
//
// ── Accessibility ────────────────────────────────────────────────────────────
// - Single `main` landmark.
// - h1 heading + plain prose; list of browser names is a real <ul>.
// - Links + code blocks are read correctly by screen readers.
// - All text colours meet WCAG AA ≥4.5:1 on --lm-bg-secondary.


// ---------------------------------------------------------------------------
// Internal: inline styles (all --lm-* tokens)
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
 alignItems: 'flex-start',
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
 margin: 0,
};

/** @type {React.CSSProperties} */
const listSectionStyle = {
 background: 'var(--lm-bg-primary, #FAF8F2)',
 border: '1px solid var(--lm-border, #DDD7CA)',
 borderRadius: 'var(--lm-radius-lg, 12px)',
 padding: 'var(--lm-space-6, 24px)',
 width: '100%',
 boxSizing: 'border-box',
 display: 'flex',
 flexDirection: 'column',
 gap: 'var(--lm-space-4, 16px)',
};

/** @type {React.CSSProperties} */
const sectionLabelStyle = {
 fontSize: 'var(--lm-size-badge, 11px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 letterSpacing: '0.12em',
 textTransform: 'uppercase',
 color: 'var(--lm-text-tertiary, #6E6960)',
 margin: 0,
};

/** @type {React.CSSProperties} */
const listStyle = {
 margin: 0,
 padding: 0,
 listStyle: 'none',
 display: 'flex',
 flexDirection: 'column',
 gap: 'var(--lm-space-2, 8px)',
};

/** @type {React.CSSProperties} */
const listItemStyle = {
 display: 'flex',
 alignItems: 'center',
 gap: 'var(--lm-space-3, 12px)',
 fontSize: 'var(--lm-size-body-lg, 14px)',
 color: 'var(--lm-text-secondary, #3A3530)',
};

/** @type {React.CSSProperties} */
const codeBlockStyle = {
 background: 'var(--lm-bg-tertiary, #E8E2D4)',
 borderRadius: 'var(--lm-radius-sm, 6px)',
 padding: 'var(--lm-space-3, 12px) var(--lm-space-4, 16px)',
 fontSize: 'var(--lm-size-body-sm, 12px)',
 fontFamily: 'var(--lm-font-mono, monospace)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
 whiteSpace: 'pre',
 overflowX: 'auto',
};

// ---------------------------------------------------------------------------
// BrowserIcon — a minimal generic globe-like SVG, used for browser bullets
// ---------------------------------------------------------------------------

function BrowserDot() {
 return (
 <svg
 width="8"
 height="8"
 viewBox="0 0 8 8"
 fill="var(--lm-accent, #B85B33)"
 aria-hidden="true"
 style={{ flex: 'none' }}
 >
 <circle cx="4" cy="4" r="4" />
 </svg>
 );
}

// ---------------------------------------------------------------------------
// InfoIcon — used in the intro section
// ---------------------------------------------------------------------------

function InfoIcon() {
 return (
 <svg
 width="36"
 height="36"
 viewBox="0 0 36 36"
 fill="none"
 aria-hidden="true"
 style={{ flex: 'none' }}
 >
 <circle cx="18" cy="18" r="16" fill="var(--lm-accent-light, rgba(184,91,51,0.10))" />
 <circle cx="18" cy="11" r="1.5" fill="var(--lm-accent, #B85B33)" />
 <rect x="16.5" y="15" width="3" height="10" rx="1.5" fill="var(--lm-accent, #B85B33)" />
 </svg>
 );
}

// ---------------------------------------------------------------------------
// UnsupportedBrowser — the exported component
// ---------------------------------------------------------------------------

/**
 * Props for UnsupportedBrowser.
 *
 * @typedef {object} UnsupportedBrowserProps
 * @property {string} [className] Optional additional CSS class for the root element.
 */

/**
 * The unsupported-browser notice (, UX-DR15, FR48).
 *
 * Shown when `isFileSystemAccessSupported()` returns false — Safari, Firefox,
 * or any browser lacking `showDirectoryPicker`. Guides the user toward:
 * A) Switching to Chrome, Edge, or Opera.
 * B) Using `npx lerret dev` locally instead.
 *
 * Never nags, never gates behind a paywall. Calm and informative.
 *
 * @param {UnsupportedBrowserProps} props
 * @returns {React.ReactElement}
 */
export function UnsupportedBrowser({ className } = {}) {
 return (
 <main
 style={wrapperStyle}
 className={className}
 aria-label="Browser not supported"
 data-testid="unsupported-browser-screen"
 >
 <div style={cardStyle}>
 {/* Eyebrow + icon */}
 <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--lm-space-4, 16px)' }}>
 <InfoIcon />
 <p style={eyebrowStyle} aria-hidden="true">Lerret · Hosted Studio</p>
 </div>

 {/* Heading + intro */}
 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-3, 12px)' }}>
 <h1 style={headingStyle}>
 Your browser can&apos;t open local folders
 </h1>
 <p style={bodyStyle}>
 The hosted Lerret studio uses the File System Access API to read
 and write your project files directly in the browser — without
 uploading anything. This API is available in Chrome, Edge, and
 Opera but not yet in Safari or Firefox.
 </p>
 </div>

 {/* What to try */}
 <div style={listSectionStyle}>
 <p style={sectionLabelStyle}>What to try</p>

 {/* Option A — supported browsers */}
 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-2, 8px)' }}>
 <p
 style={{
 fontSize: 'var(--lm-size-body, 13px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
 }}
 >
 A — Open in a supported browser
 </p>
 <ul style={listStyle} aria-label="Supported browsers">
 {['Google Chrome', 'Microsoft Edge', 'Opera'].map((browser) => (
 <li key={browser} style={listItemStyle}>
 <BrowserDot />
 <span>{browser}</span>
 </li>
 ))}
 </ul>
 </div>

 {/* Divider */}
 <hr
 style={{
 border: 'none',
 borderTop: '1px solid var(--lm-border, #DDD7CA)',
 margin: 0,
 }}
 />

 {/* Option B — CLI */}
 <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--lm-space-3, 12px)' }}>
 <p
 style={{
 fontSize: 'var(--lm-size-body, 13px)',
 fontWeight: 'var(--lm-weight-semibold, 600)',
 color: 'var(--lm-text-primary, #1A1714)',
 margin: 0,
 }}
 >
 B — Run locally with the CLI
 </p>
 <p
 style={{
 fontSize: 'var(--lm-size-body, 13px)',
 lineHeight: 'var(--lm-lh-body, 1.45)',
 color: 'var(--lm-text-secondary, #3A3530)',
 margin: 0,
 }}
 >
 The CLI serves the studio via a local dev server — works in any
 browser, no File System Access API needed.
 </p>
 <pre style={codeBlockStyle} aria-label="CLI command">
 <code data-testid="npx-command">npx lerret dev</code>
 </pre>
 <p
 style={{
 fontSize: 'var(--lm-size-body-sm, 12px)',
 color: 'var(--lm-text-tertiary, #6E6960)',
 margin: 0,
 }}
 >
 Then open <code>http://localhost:5173</code> in any browser.
 </p>
 </div>
 </div>

 {/* Footer note */}
 <p
 style={{
 fontSize: 'var(--lm-size-body-sm, 12px)',
 color: 'var(--lm-text-tertiary, #6E6960)',
 margin: 0,
 }}
 >
 Lerret is open-source — no account or signup required.{' '}
 <a
 href="https://github.com/belikely-united/lerret"
 target="_blank"
 rel="noopener noreferrer"
 style={{ color: 'var(--lm-accent-text, #92421E)', textDecoration: 'underline' }}
 data-testid="github-link"
 >
 View on GitHub
 </a>
 </p>
 </div>
 </main>
 );
}

export default UnsupportedBrowser;
