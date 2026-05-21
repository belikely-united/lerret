// Studio shell — top-level page routing + floating left sidebar.
//
// Pages are hash-driven (#storyboard, #design-system) so this works on
// plain static hosting with zero router config. Each page is a React node
// (or a `comingSoon: true` placeholder) supplied via the `pages` prop.
//
// Usage:
// <StudioShell
// defaultPage="storyboard"
// pages={{
// storyboard: { label: 'Storyboard', node: <DesignCanvas>…</DesignCanvas> },
// 'design-system': { label: 'Design system', comingSoon: true },
// }}
// />
//
// Module note (migration): formerly a script-tag `.jsx` with a
// global `React` / `ReactDOM` and `Object.assign(window, …)` exports. It now
// imports React + `react-dom` as ES modules and uses named `export`s. Brand
// images resolve from Vite's `public/` (served at `/assets/...`). The studio
// React logic is unchanged.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { PagePicker } from './components/dock/page-picker.jsx';
import { useProjectPages } from './components/dock/project-pages-context.jsx';
import { useProjectModel } from './components/dock/project-model-context.jsx';
import { runBulkExport, triggerBulkDownload } from './export/bulk.js';
// Import the extracted walkthrough overlay and offer.
// The overlay and its step sequence now live in components/walkthrough/.
import {
 StudioWalkthroughOverlay,
 WalkthroughOffer,
} from './components/walkthrough/walkthrough-overlay.jsx';
import {
 isFirstEverVisit,
 recordWalkthroughSkipped,
} from './components/walkthrough/walkthrough-persistence.js';

// Hash-driven routing — exported so the project canvas's `DevHarness` /
// page picker can reuse the exact same primitive for
// page navigation. Plain static hosting, zero router config.
export function useHashRoute(defaultRoute) {
 const get = () => {
 if (typeof location === 'undefined') return defaultRoute;
 return location.hash.replace(/^#/, '') || defaultRoute;
 };
 const [route, setRoute] = React.useState(get);
 React.useEffect(() => {
 const onHash = () => setRoute(get());
 window.addEventListener('hashchange', onHash);
 return () => window.removeEventListener('hashchange', onHash);
 }, []);
 const navigate = (id) => { location.hash = '#' + id; };
 return [route, navigate];
}

function StudioComingSoon({ label }) {
 return (
 <div style={{
 width: '100vw',
 height: '100vh',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 flexDirection: 'column',
 gap: 14,
 background: '#f0eee9',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 color: '#2a251f',
 }}>
 <div style={{
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.18em',
 textTransform: 'uppercase',
 color: '#9a958c',
 }}>Coming soon</div>
 <div style={{
 fontSize: 40,
 fontWeight: 600,
 letterSpacing: -0.8,
 }}>{label}</div>
 <div style={{
 fontSize: 14,
 color: '#6e6960',
 maxWidth: '44ch',
 textAlign: 'center',
 lineHeight: 1.5,
 }}>This page hasn&rsquo;t been built yet. Check back soon, or open an issue if you&rsquo;d like to help shape it.</div>
 </div>
 );
}

// ───────────────────────────────────────────
// StudioDock — floating bottom-center pill. Replaces the old top-left
// sidebar + the per-canvas top-right "All PNG/JPG" buttons. Single source
// of chrome.
//
// Layout (left → right): logo · page nav · global download · brand kit · ?
// ───────────────────────────────────────────
function StudioDockSeparator() {
 return <div style={{ width: 1, height: 24, background: 'rgba(60,50,40,0.14)', alignSelf: 'center' }} />;
}

function StudioDockButton({
 label, icon, onClick, active = false, disabled = false, badge, title,
}) {
 return (
 <button
 type="button"
 disabled={disabled}
 onClick={() => !disabled && onClick && onClick()}
 title={title || label}
 style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: 7,
 padding: '8px 12px',
 borderRadius: 8,
 border: 'none',
 background: active ? '#2a251f' : 'transparent',
 color: active ? '#fff' : (disabled ? '#9a958c' : '#3a3530'),
 fontFamily: 'inherit',
 fontSize: 13,
 fontWeight: active ? 600 : 500,
 cursor: disabled ? 'not-allowed' : 'pointer',
 transition: 'background .12s, color .12s',
 whiteSpace: 'nowrap',
 }}
 onMouseEnter={(e) => {
 if (!active && !disabled) e.currentTarget.style.background = 'rgba(0,0,0,0.05)';
 }}
 onMouseLeave={(e) => {
 if (!active && !disabled) e.currentTarget.style.background = 'transparent';
 }}
 >
 {icon && <span style={{ display: 'inline-flex', fontSize: 12 }}>{icon}</span>}
 <span>{label}</span>
 {badge && (
 <span style={{
 fontSize: 9, fontWeight: 600,
 letterSpacing: '0.06em', textTransform: 'uppercase',
 color: '#9a958c',
 background: 'rgba(60,50,40,0.08)',
 padding: '3px 7px', borderRadius: 999,
 marginLeft: 2,
 }}>{badge}</span>
 )}
 </button>
 );
}

function StudioBrandMenu({ onDownloadLogo }) {
 const item = (label, hint, onClick) => (
 <button
 type="button"
 onClick={onClick}
 style={{
 display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
 width: '100%', textAlign: 'left',
 padding: '10px 14px',
 border: 'none', borderRadius: 8,
 background: 'transparent',
 cursor: 'pointer',
 fontFamily: 'inherit',
 transition: 'background .12s',
 }}
 onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
 onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
 >
 <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1714' }}>{label}</span>
 {hint && <span style={{ fontSize: 11, color: '#6E6960', marginTop: 2 }}>{hint}</span>}
 </button>
 );
 return (
 <div style={{
 position: 'absolute',
 bottom: 'calc(100% + 8px)',
 left: 0,
 minWidth: 220,
 background: 'rgba(255,255,255,0.97)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 border: '1px solid rgba(26,23,20,0.10)',
 borderRadius: 12,
 padding: 6,
 boxShadow: '0 12px 32px rgba(15,23,42,0.18), 0 1px 3px rgba(15,23,42,0.06)',
 display: 'flex', flexDirection: 'column', gap: 2,
 zIndex: 70,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 }}>
 <div style={{
 fontSize: 9.5, fontWeight: 600,
 letterSpacing: '0.14em', textTransform: 'uppercase',
 color: '#9a958c',
 padding: '8px 14px 4px',
 }}>Brand kit</div>
 {item('Lerret logo', 'PNG · 256 × 256', onDownloadLogo)}
 </div>
 );
}

function StudioDock({ pages, current, onNavigate, onHelp }) {
 // The loaded Lerret project's page navigation, published by the
 // project canvas via context. When present, the dock's page nav is the
 // project-page picker (UX-DR1) instead of the studio-shell page-button row.
 // When `null` (e.g. the brownfield `#storyboard` page, not a Lerret
 // project), the dock falls back to the studio-shell page buttons.
 const projectPages = useProjectPages();
 // The loaded ProjectNode — used by the "Export project" button.
 const projectModel = useProjectModel();
 // Global "All PNG/JPG" download — drives every artboard via the
 // dcDownloadSlots window export (see design-canvas.jsx).
 const [busy, setBusy] = React.useState(null);
 const [progress, setProgress] = React.useState(null);
 // Project-level bulk export state.
 const [exportBusy, setExportBusy] = React.useState(false);
 const [exportProgress, setExportProgress] = React.useState(null); // e.g. "2/10…"
 const [exportNotice, setExportNotice] = React.useState(null);
 // Brand menu — popover above the lockup. Holds the Brand kit download
 // (and anything else brand-adjacent we add later).
 const [brandOpen, setBrandOpen] = React.useState(false);
 const brandRef = React.useRef(null);

 React.useEffect(() => {
 if (!brandOpen) return;
 const onPd = (e) => {
 if (brandRef.current && !brandRef.current.contains(e.target)) setBrandOpen(false);
 };
 const onKey = (e) => { if (e.key === 'Escape') setBrandOpen(false); };
 document.addEventListener('pointerdown', onPd);
 document.addEventListener('keydown', onKey);
 return () => {
 document.removeEventListener('pointerdown', onPd);
 document.removeEventListener('keydown', onKey);
 };
 }, [brandOpen]);

 const downloadAll = async (fmt) => {
 if (busy || typeof window.dcDownloadSlots !== 'function') return;
 const slots = Array.from(document.querySelectorAll('[data-dc-slot]'));
 if (!slots.length) return;
 setBusy(fmt);
 setProgress({ i: 0, total: slots.length });
 try {
 await window.dcDownloadSlots(slots, fmt, (p) => setProgress(p));
 } finally {
 setBusy(null);
 setProgress(null);
 }
 };

 // Project-level bulk ZIP export.
 const exportProject = React.useCallback(async (fmt = 'png', flat = false) => {
 if (!projectModel || exportBusy) return;
 setExportBusy(true);
 setExportNotice(null);
 setExportProgress('0/…');

 const result = await runBulkExport({
 project: projectModel,
 scope: { kind: 'project' },
 format: fmt,
 flat,
 onProgress: (i, total) => {
 setExportProgress(i === total ? null : `${i}/${total}…`);
 },
 });

 setExportBusy(false);
 setExportProgress(null);

 if (!result.blob) {
 setExportNotice('Nothing to export.');
 return;
 }

 triggerBulkDownload(result.blob, result.filename);

 // Calm notice for skipped / unembedded fonts.
 const notices = [];
 if (result.skipped.length > 0) {
 const names = result.skipped.map((s) => s.artboard?.asset?.name || '?').join(', ');
 notices.push(`Skipped: ${names}`);
 }
 if (result.unembeddedFonts.length > 0) {
 notices.push(`Fonts not embedded: ${result.unembeddedFonts.join(', ')}`);
 }
 setExportNotice(notices.length > 0 ? notices.join(' · ') : null);
 }, [projectModel, exportBusy]);

 const dlLabel = (fmt) => {
 if (busy === fmt && progress) return `${progress.i}/${progress.total}…`;
 return fmt.toUpperCase();
 };

 const triggerDownload = (href, filename) => {
 const a = document.createElement('a');
 a.href = href;
 a.download = filename;
 a.click();
 };

 return (
 <div data-tour="dock" style={{
 position: 'fixed',
 bottom: 18,
 left: '50%',
 transform: 'translateX(-50%)',
 zIndex: 60,
 background: 'rgba(255,255,255,0.88)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 borderRadius: 999,
 padding: '6px 10px',
 boxShadow: '0 4px 18px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.06)',
 display: 'flex',
 alignItems: 'center',
 gap: 4,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 maxWidth: 'calc(100vw - 32px)',
 overflow: 'auto',
 }}>
 {/* Brand lockup — toggles the brand-kit popover */}
 <span ref={brandRef} data-tour="dock-brand" style={{ position: 'relative', display: 'inline-flex' }}>
 <button
 type="button"
 onClick={() => setBrandOpen((o) => !o)}
 style={{
 display: 'inline-flex', alignItems: 'center', gap: 8,
 padding: '6px 10px', borderRadius: 999,
 border: 'none',
 background: brandOpen ? 'rgba(0,0,0,0.06)' : 'transparent',
 color: '#1A1714', cursor: 'pointer',
 fontFamily: 'inherit',
 transition: 'background .12s',
 }}
 onMouseEnter={(e) => { if (!brandOpen) e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; }}
 onMouseLeave={(e) => { if (!brandOpen) e.currentTarget.style.background = 'transparent'; }}
 title="Brand"
 aria-expanded={brandOpen}
 >
 <img
 src="/assets/lerret-logo.png"
 alt=""
 width="22"
 height="22"
 style={{ display: 'block', borderRadius: 4, objectFit: 'cover' }}
 />
 <span style={{
 fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif',
 fontSize: 19, lineHeight: 1, letterSpacing: '-0.015em',
 }}>Lerret</span>
 <svg width="9" height="9" viewBox="0 0 11 11" fill="none" stroke="currentColor"
 strokeWidth="1.6" strokeLinecap="round"
 style={{ opacity: 0.55, transform: brandOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
 <path d="M2 4l3.5 3.5L9 4" />
 </svg>
 </button>
 {brandOpen && (
 <StudioBrandMenu
 onDownloadLogo={() => { triggerDownload('/assets/lerret-logo.png', 'lerret-logo.png'); setBrandOpen(false); }}
 />
 )}
 </span>

 <StudioDockSeparator />

 {/* Page nav. With a loaded Lerret project, this is the project-page
 picker (UX-DR1): a compact dropdown for >1 page, a
 static label for exactly one page. Otherwise it falls back to the
 studio-shell page-button row — hidden pages are kept in the registry
 (URL still routes to them) but skipped in the dock. */}
 {projectPages ? (
 <PagePicker
 pages={projectPages.pages}
 current={projectPages.current}
 onNavigate={projectPages.onNavigate}
 />
 ) : (
 <span data-tour="dock-pages" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
 {Object.entries(pages).filter(([, p]) => !p.hidden).map(([id, p]) => (
 <StudioDockButton
 key={id}
 label={p.label}
 active={id === current}
 disabled={!!p.comingSoon}
 badge={p.comingSoon ? 'Soon' : null}
 onClick={() => onNavigate(id)}
 title={p.comingSoon ? 'Coming soon' : p.label}
 />
 ))}
 </span>
 )}

 <StudioDockSeparator />

 {/* Global download */}
 <span data-tour="dock-download" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
 <StudioDockButton
 label={dlLabel('png')}
 icon="↓"
 active={busy === 'png'}
 disabled={!!busy && busy !== 'png'}
 onClick={() => downloadAll('png')}
 title="Download every artboard as PNG"
 />
 <StudioDockButton
 label={dlLabel('jpg')}
 icon="↓"
 active={busy === 'jpg'}
 disabled={!!busy && busy !== 'jpg'}
 onClick={() => downloadAll('jpg')}
 title="Download every artboard as JPG"
 />
 </span>

 {/* Export project ZIP — only shown when a project is loaded. */}
 {projectModel && (
 <React.Fragment>
 <StudioDockSeparator />
 <span
 data-tour="dock-export"
 style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}
 >
 <StudioDockButton
 label={exportProgress !== null ? exportProgress : 'Export ZIP'}
 icon={
 <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
 <path d="M6 1v7M3 5.5l3 3 3-3M2 10h8" />
 </svg>
 }
 active={exportBusy}
 disabled={exportBusy}
 onClick={() => exportProject('png', false)}
 title={exportBusy ? 'Export in progress…' : 'Export project as ZIP (PNG, structured)'}
 />
 {/* Calm notice for skipped / fonts — floats above the button, non-blocking */}
 {exportNotice && (
 <div style={{
 position: 'absolute',
 bottom: 'calc(100% + 6px)',
 left: '50%',
 transform: 'translateX(-50%)',
 whiteSpace: 'nowrap',
 background: 'rgba(255,255,255,0.96)',
 backdropFilter: 'blur(10px)',
 border: '1px solid rgba(26,23,20,0.10)',
 borderRadius: 8,
 padding: '6px 10px',
 fontSize: 11,
 color: '#6E6960',
 boxShadow: '0 4px 12px rgba(15,23,42,0.10)',
 maxWidth: 320,
 lineHeight: 1.4,
 }}>
 {exportNotice}
 <button
 type="button"
 onClick={() => setExportNotice(null)}
 style={{
 marginLeft: 6, background: 'none', border: 'none',
 cursor: 'pointer', color: '#9a958c', fontSize: 11,
 padding: 0, fontFamily: 'inherit',
 }}
 title="Dismiss"
 >✕</button>
 </div>
 )}
 </span>
 </React.Fragment>
 )}

 <StudioDockSeparator />

 {/* Help */}
 <StudioDockButton
 label="?"
 onClick={() => onHelp && onHelp()}
 title="Take a tour"
 />
 </div>
 );
}

// StudioWalkthroughOverlay and its step sequence have been
// extracted into packages/studio/src/components/walkthrough/. The imports
// above (StudioWalkthroughOverlay, WalkthroughOffer, isFirstEverVisit,
// recordWalkthroughSkipped) bring them back in. Nothing is inlined here anymore.

export function StudioShell({ pages, defaultPage }) {
 const ids = Object.keys(pages);
 const fallback = defaultPage || ids[0];
 const [route, navigate] = useHashRoute(fallback);
 const [tourOpen, setTourOpen] = React.useState(false);
 // First-ever-visit offer state.
 // The offer is shown once after the first render, dismissed on Yes/No.
 const [offerVisible, setOfferVisible] = React.useState(false);
 // Unknown route → snap to the default. Don't render an empty page.
 const valid = pages[route] ? route : fallback;
 const page = pages[valid];

 // Detect first ever visit after the canvas mounts.
 // The offer is shown calmly (not the full overlay) and only once.
 React.useEffect(() => {
 if (isFirstEverVisit()) {
 setOfferVisible(true);
 }
 }, []); // eslint-disable-line react-hooks/exhaustive-deps

 const handleOfferAccept = () => {
 setOfferVisible(false);
 setTourOpen(true);
 };

 const handleOfferDecline = () => {
 setOfferVisible(false);
 recordWalkthroughSkipped();
 };

 return (
 <React.Fragment>
 <StudioDock pages={pages} current={valid} onNavigate={navigate} onHelp={() => setTourOpen(true)} />
 {page.comingSoon ? <StudioComingSoon label={page.label} /> : page.node}
 {/* First-ever-visit offer (calm notice above dock). */}
 {offerVisible && !tourOpen && (
 <WalkthroughOffer
 onAccept={handleOfferAccept}
 onDecline={handleOfferDecline}
 />
 )}
 {tourOpen && <StudioWalkthroughOverlay onClose={() => setTourOpen(false)} />}
 </React.Fragment>
 );
}

// StudioShell is now an ES-module `export` above;
// StudioDock stays internal to this file. The former `Object.assign(window,
// …)` is no longer needed.
export { StudioDock };
