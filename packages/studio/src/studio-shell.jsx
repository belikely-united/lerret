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
// Epic 8 / Story 8.2 — the dock-mounted AI input cluster. It reaches @lerret/ai
// only via the getAi() lazy boundary (it imports nothing from @lerret/ai
// directly), so mounting it here keeps the whole dock resilient when the AI
// package is absent (it renders an idle-only fallback).
import { AiInputCluster } from './ai/ai-input-cluster.jsx';
import { SettingsPanel } from './ai/settings-panel.jsx';
import { RevertTimelinePanel } from './ai/revert-timeline.jsx';
import { useCascadedConfig } from './components/canvas/cascade-context.jsx';
import { runBulkExport, triggerBulkDownload } from './export/bulk.js';
import { inCliMode, switchProject } from './runtime/write-client.js';
import { getHostedController } from './runtime/hosted-controller.js';
import { ConnectProjectDialog } from './components/entry/connect-project-dialog.jsx';
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
 return <div style={{ width: 1, height: 24, background: 'var(--lm-bg-tertiary, #E8E2D4)', alignSelf: 'center' }} />;
}

function StudioDockButton({
 label, icon, onClick, active = false, disabled = false, badge, title,
}) {
 return (
 <button
 type="button"
 className="lm-focusable-inset"
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

function StudioBrandMenu({
 anchorRef,
 menuRef,
 onDownloadLogo,
 onTakeTour,
 onSwitchProject,
 onCloseProject,
 onAiSettings,
 onAiRevertHistory,
 canExport = false,
 exportFormat = 'png',
 onExportFormatChange,
 exportScope = 'project',
 onExportScopeChange,
 onExportProject,
 exportBusy = false,
 exportProgress = null,
 exportNotice = null,
 onDismissNotice,
}) {
 // The dock clips overflow (and its backdrop-filter is a containing block), so
 // the menu is portaled to <body> and anchored to the brand lockup in viewport
 // space — the same trick the PagePicker uses.
 const [coords, setCoords] = React.useState(null);
 React.useEffect(() => {
 const measure = () => {
 const el = anchorRef && anchorRef.current;
 if (!el) return;
 const r = el.getBoundingClientRect();
 setCoords({ left: r.left, bottom: window.innerHeight - r.top });
 };
 measure();
 window.addEventListener('resize', measure);
 window.addEventListener('scroll', measure, true);
 return () => {
 window.removeEventListener('resize', measure);
 window.removeEventListener('scroll', measure, true);
 };
 }, [anchorRef]);

 // A compact single-line action row: 16px icon + label. The old menu stacked
 // a label over a gray hint that mostly restated it ("Switch project" /
 // "Connect a different folder"), doubling every row's height. The hint now
 // lives on hover (title=) and an icon carries recognition instead.
 const ic = (children) => (
 <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
 strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
 );
 const icons = {
 switch: ic(<><path d="M3 5.5h8" /><path d="M8.5 3 11 5.5 8.5 8" /><path d="M13 10.5H5" /><path d="M7.5 8 5 10.5 7.5 13" /></>),
 close: ic(<><path d="M9 2.5H3.5v11H9" /><path d="M11 5.5 13.5 8 11 10.5" /><path d="M13.5 8H6.5" /></>),
 ai: ic(<><path d="M2.5 5h6" /><path d="M11 5h2.5" /><circle cx="9.5" cy="5" r="1.4" /><path d="M2.5 11h2" /><path d="M6.5 11h7" /><circle cx="5" cy="11" r="1.4" /></>),
 revert: ic(<><path d="M2.5 8a5.5 5.5 0 1 0 1.9-4.15" /><path d="M2.2 2.5v3.2h3.2" /><path d="M8 5.2V8l2 1.4" /></>),
 logo: ic(<><rect x="2.5" y="3.5" width="11" height="9" rx="1.6" /><circle cx="5.8" cy="6.8" r="1" /><path d="M3 11l3-2.6 2.2 1.8L11 8l2 2" /></>),
 tour: ic(<><circle cx="8" cy="8" r="5.7" /><path d="M10.4 5.6 9 9 5.6 10.4 7 7z" /></>),
 };
 const row = (icon, label, onClick, opts = {}) => (
 <button
 type="button"
 className="lm-focusable-inset"
 onClick={onClick}
 title={opts.title}
 style={{
 display: 'flex', alignItems: 'center', gap: 10,
 width: '100%', textAlign: 'left',
 padding: '8px 12px',
 border: 'none', borderRadius: 8,
 background: 'transparent',
 cursor: 'pointer', fontFamily: 'inherit',
 color: opts.quiet ? '#6E6960' : '#1A1714',
 transition: 'background .12s',
 }}
 onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
 onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
 >
 <span style={{ display: 'inline-flex', flex: '0 0 16px', opacity: opts.quiet ? 0.55 : 0.7 }}>{icon}</span>
 <span style={{ fontSize: 13, fontWeight: opts.quiet ? 500 : 600 }}>{label}</span>
 </button>
 );
 const divider = <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '5px 8px' }} />;
 const segStyle = (on) => ({
 flex: 1,
 padding: '6px 0',
 borderRadius: 7,
 border: 'none',
 background: on ? '#B85B33' : 'var(--lm-bg-tertiary, #E8E2D4)',
 color: on ? '#FAF8F2' : '#3A3530',
 fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
 cursor: 'pointer', transition: 'background .12s',
 });
 if (!coords) return null;
 // Three zones, dividers (not shouty uppercase headers) between them, ordered
 // by how often you reach for them: project lifecycle → AI → export, with the
 // niche logo download and one-time tour demoted to a quiet footer.
 const hasProject = !!(onSwitchProject || onCloseProject);
 const hasAi = !!(onAiSettings || onAiRevertHistory);
 const hasActionsAbove = hasProject || hasAi || canExport;
 return ReactDOM.createPortal(
 <div ref={menuRef} style={{
 position: 'fixed',
 bottom: coords.bottom + 8,
 left: coords.left,
 width: 264,
 background: 'rgba(255,255,255,0.97)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 borderRadius: 12,
 padding: 6,
 boxShadow: 'var(--lm-shadow-popup, 0 18px 48px rgba(26,23,20,0.22))',
 display: 'flex', flexDirection: 'column', gap: 1,
 zIndex: 90,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
 }}>
 {/* Project — connect a different folder, or close the current one, without
 restarting the CLI. CLI mode only (the server re-points the dev binding). */}
 {onSwitchProject && row(icons.switch, 'Switch project', onSwitchProject, { title: 'Connect a different folder' })}
 {onCloseProject && row(icons.close, 'Close project', onCloseProject, { title: 'Return to the connect screen' })}

 {/* AI — provider + API-key management (UX-delta §4.3) and the revert
 timeline (UX-delta §4.5, FR52). Both panels handle every state themselves,
 including no-provider-configured and @lerret/ai absent. */}
 {hasProject && hasAi && divider}
 {onAiSettings && row(icons.ai, 'AI settings', onAiSettings, { title: 'Providers and API keys' })}
 {onAiRevertHistory && row(icons.revert, 'Revert AI history', onAiRevertHistory, { title: 'Browse and revert AI turns' })}

 {/* Export project — the one action here with controls, so it earns its own
 framed block. Deliberately low-frequency (per-page / per-group / per-artboard
 export live in their ⋯ kebabs); the segmented scope control now carries the
 explanation the prose line used to, so the prose is gone. */}
 {(hasProject || hasAi) && canExport && divider}
 {canExport && (
 <div style={{
 margin: '2px 2px 1px',
 padding: 8,
 borderRadius: 10,
 background: 'rgba(60,50,40,0.04)',
 display: 'flex', flexDirection: 'column', gap: 7,
 }}>
 <div role="radiogroup" aria-label="Export scope" style={{ display: 'flex', gap: 6 }}>
 {[['project', 'Whole project'], ['page', 'This page']].map(([val, label]) => {
 const on = exportScope === val;
 return (
 <button
 key={val}
 type="button"
 role="radio"
 aria-checked={on}
 data-testid={`dock-export-scope-${val}`}
 onClick={() => onExportScopeChange && onExportScopeChange(val)}
 className="lm-seg"
 style={segStyle(on)}
 >
 {label}
 </button>
 );
 })}
 </div>
 <div style={{ display: 'flex', gap: 6 }}>
 <div role="radiogroup" aria-label="Export format" style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
 {['png', 'jpg'].map((f) => {
 const on = exportFormat === f;
 return (
 <button
 key={f}
 type="button"
 role="radio"
 aria-checked={on}
 onClick={() => onExportFormatChange && onExportFormatChange(f)}
 className="lm-seg"
 style={{ ...segStyle(on), flex: '0 0 auto', padding: '6px 11px' }}
 >
 {f.toUpperCase()}
 </button>
 );
 })}
 </div>
 <button
 type="button"
 className="lm-focusable-inset"
 data-testid="dock-export-project"
 disabled={exportBusy}
 onClick={() => onExportProject && onExportProject(exportFormat, exportScope)}
 style={{
 flex: 1,
 padding: '6px 12px',
 borderRadius: 7,
 border: 'none',
 background: exportBusy ? 'rgba(42,37,31,0.5)' : '#2A251F',
 color: '#fff',
 fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
 cursor: exportBusy ? 'wait' : 'pointer',
 display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
 }}
 >
 <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 <path d="M6 1v7M3 5.5l3 3 3-3M2 10h8" />
 </svg>
 {exportProgress !== null ? exportProgress : 'Export ZIP'}
 </button>
 </div>
 {exportNotice && (
 <div style={{
 fontSize: 11, color: '#6E6960', lineHeight: 1.4,
 background: 'rgba(60,50,40,0.05)', borderRadius: 8, padding: '6px 8px',
 }}>
 {exportNotice}
 <button
 type="button"
 className="lm-focusable-inset"
 onClick={onDismissNotice}
 style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#9a958c', fontSize: 11, padding: 0, fontFamily: 'inherit' }}
 title="Dismiss"
 >✕</button>
 </div>
 )}
 </div>
 )}

 {/* Quiet footer — niche / one-time aids. The Lerret-logo download (a
 brand-kit nicety, not an everyday action; its PNG · 256 × 256 spec lives on
 hover) and the one-time walkthrough sit here, demoted so everyday actions lead. */}
 {hasActionsAbove && divider}
 {onDownloadLogo && row(icons.logo, 'Download logo', onDownloadLogo, { quiet: true, title: 'PNG · 256 × 256' })}
 {onTakeTour && row(icons.tour, 'Take a tour', onTakeTour, { quiet: true, title: 'A quick walkthrough of the studio' })}
 </div>,
 document.body,
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
 // Cascaded per-folder config — used to honor `excludeFromExport: true` (FR52).
 const getConfigFor = useCascadedConfig();
 // Project-level bulk export state. Export is a low-frequency action, so its
 // controls live in the Lerret brand menu rather than the dock's prime row.
 // (Per-page / per-group / per-artboard export already live in their kebabs.)
 const [exportBusy, setExportBusy] = React.useState(false);
 const [exportProgress, setExportProgress] = React.useState(null); // e.g. "2/10…"
 const [exportNotice, setExportNotice] = React.useState(null);
 const [exportFormat, setExportFormat] = React.useState('png');
 const [exportScope, setExportScope] = React.useState('project'); // 'project' | 'page'
 // Whether the floating prompt-context card (selection chip / staged images) is
 // attached above the dock. While it is, the dock flattens its TOP corners so the
 // card's flat bottom meets it as one seamless rounded panel (see PromptContextTray).
 const [hasContext, setHasContext] = React.useState(false);
 React.useEffect(() => {
  const onCtx = (e) => setHasContext(!!(e && e.detail && e.detail.present));
  window.addEventListener('lerret:dock-context', onCtx);
  return () => window.removeEventListener('lerret:dock-context', onCtx);
 }, []);
 // Brand menu — popover above the lockup. Holds the Brand kit download
 // (and anything else brand-adjacent we add later).
 const [brandOpen, setBrandOpen] = React.useState(false);
 // The AI provider/key settings panel (UX-delta §4.3) — opened from the brand
 // kebab's "AI settings…" item. This is the post-setup management surface:
 // change the API key, switch the active provider, clear a provider, test the
 // connection.
 const [aiSettingsOpen, setAiSettingsOpen] = React.useState(false);
 // The revert timeline panel (UX-delta §4.5, FR52) — opened from the brand
 // kebab's "Revert AI history…" item (no focus turn) or from the AI cluster's
 // quick-revert / thread actions (which pass the turnId to preselect).
 const [revertTimelineOpen, setRevertTimelineOpen] = React.useState(false);
 const [revertTimelineFocusTurn, setRevertTimelineFocusTurn] = React.useState(null);
 // The "Switch project" connect dialog (CLI mode). Opened from the brand menu.
 const [connectOpen, setConnectOpen] = React.useState(false);
 // Folder switching is a CLI-only capability (the server re-points its dev
 // binding); the global flag is the same one write-client reads.
 const cliMode = inCliMode();
 const brandRef = React.useRef(null);
 // The brand menu is portaled to <body>, so an "outside" click must also spare
 // the menu itself — otherwise clicking the format toggle / Export closes it.
 const brandMenuRef = React.useRef(null);

 React.useEffect(() => {
 if (!brandOpen) return;
 const onPd = (e) => {
 const inTrigger = brandRef.current && brandRef.current.contains(e.target);
 const inMenu = brandMenuRef.current && brandMenuRef.current.contains(e.target);
 if (!inTrigger && !inMenu) setBrandOpen(false);
 };
 const onKey = (e) => { if (e.key === 'Escape') setBrandOpen(false); };
 document.addEventListener('pointerdown', onPd);
 document.addEventListener('keydown', onKey);
 return () => {
 document.removeEventListener('pointerdown', onPd);
 document.removeEventListener('keydown', onKey);
 };
 }, [brandOpen]);

 // Bulk ZIP export — whole project, or just the current page. `currentPagePath`
 // is read in render (a primitive) so the memoized callback's dep is exact.
 const currentPagePath = projectPages?.current;
 const exportProject = React.useCallback(async (fmt = 'png', scope = 'project') => {
 if (!projectModel || exportBusy) return;
 const scopeArg =
 scope === 'page' && currentPagePath
 ? { kind: 'page', path: currentPagePath }
 : { kind: 'project' };
 setExportBusy(true);
 setExportNotice(null);
 setExportProgress('0/…');

 const result = await runBulkExport({
 project: projectModel,
 scope: scopeArg,
 format: fmt,
 flat: false,
 getConfigFor,
 onProgress: (i, total) => {
 setExportProgress(i === total ? null : `${i}/${total}…`);
 },
 });

 setExportBusy(false);
 setExportProgress(null);

 if (!result.blob) {
 setExportNotice(
 result.excludedFolders?.length
 ? 'Nothing to export — every page in scope is excludeFromExport.'
 : 'Nothing to export.',
 );
 return;
 }

 triggerBulkDownload(result.blob, result.filename);

 // Calm notice for skipped / unembedded fonts / excluded pages.
 const notices = [];
 if (result.skipped.length > 0) {
 const names = result.skipped.map((s) => s.artboard?.asset?.name || '?').join(', ');
 notices.push(`Skipped: ${names}`);
 }
 if (result.excludedFolders?.length > 0) {
 notices.push(
 `Excluded (excludeFromExport): ${result.excludedFolders
 .map((p) => p.split('/').filter(Boolean).pop() || p)
 .join(', ')}`,
 );
 }
 if (result.unembeddedFonts.length > 0) {
 notices.push(`Fonts not embedded: ${result.unembeddedFonts.join(', ')}`);
 }
 setExportNotice(notices.length > 0 ? notices.join(' · ') : null);
 }, [projectModel, exportBusy, getConfigFor, currentPagePath]);

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
 borderRadius: 24, // capped from 999 so a tall dock becomes a rounded rect, never a giant white CIRCLE over the canvas (the activity feed also floats above the dock now)
 // Flatten the TOP corners while the prompt-context card is attached above so
 // card (rounded top) + dock (rounded bottom) read as one seamless panel.
 borderTopLeftRadius: hasContext ? 0 : 24,
 borderTopRightRadius: hasContext ? 0 : 24,
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
 className="lm-focusable-inset"
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
 anchorRef={brandRef}
 menuRef={brandMenuRef}
 onDownloadLogo={() => { triggerDownload('/assets/lerret-logo.png', 'lerret-logo.png'); setBrandOpen(false); }}
 onTakeTour={() => { setBrandOpen(false); onHelp && onHelp(); }}
 onSwitchProject={cliMode ? () => { setBrandOpen(false); setConnectOpen(true); } : getHostedController() ? () => { setBrandOpen(false); getHostedController().openAnother(); } : undefined}
 onCloseProject={cliMode && projectModel ? () => { setBrandOpen(false); switchProject(null); } : getHostedController() && projectModel ? () => { setBrandOpen(false); getHostedController().close(); } : undefined}
 onAiSettings={() => { setBrandOpen(false); setAiSettingsOpen(true); }}
 onAiRevertHistory={() => { setBrandOpen(false); setRevertTimelineFocusTurn(null); setRevertTimelineOpen(true); }}
 canExport={!!projectModel}
 exportFormat={exportFormat}
 onExportFormatChange={setExportFormat}
 exportScope={exportScope}
 onExportScopeChange={setExportScope}
 onExportProject={(fmt, scope) => exportProject(fmt, scope)}
 exportBusy={exportBusy}
 exportProgress={exportProgress}
 exportNotice={exportNotice}
 onDismissNotice={() => setExportNotice(null)}
 />
 )}
 {connectOpen && <ConnectProjectDialog onClose={() => setConnectOpen(false)} />}
 {aiSettingsOpen && <SettingsPanel open onClose={() => setAiSettingsOpen(false)} />}
 {revertTimelineOpen && (
 <RevertTimelinePanel
 open
 onClose={() => setRevertTimelineOpen(false)}
 focusTurnId={revertTimelineFocusTurn}
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
 projectModel={projectModel}
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

 {/* Epic 8 / Story 8.2 — the AI input cluster. Per UX-delta IA tree it sits
  "between the page picker and the global export"; in the v1 dock the global
  export lives inside StudioBrandMenu (dock-left), so this resolves to "after
  the page picker". The cluster joins the dock's existing horizontal-scroll
  wrapper. It is AI-agnostic chrome: when @lerret/ai is absent it renders an
  idle-only fallback and the surrounding brand / page-picker children keep
  working. */}
 <StudioDockSeparator />
 <AiInputCluster
 onOpenRevertTimeline={(turnId) => {
 setRevertTimelineOpen(true);
 setRevertTimelineFocusTurn(turnId ?? null);
 }}
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
