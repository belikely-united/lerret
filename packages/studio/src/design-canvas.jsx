
// DesignCanvas.jsx — Figma-ish design canvas wrapper
// Warm gray grid bg + Sections + Artboards + PostIt notes.
// Artboards are reorderable (grip-drag), labels/titles are inline-editable,
// and any artboard can be opened in a fullscreen focus overlay (←/→/Esc).
// State persists to a .design-canvas.state.json sidecar via the host
// bridge. No assets, no deps.
//
// Usage:
// <DesignCanvas>
// <DCSection id="onboarding" title="Onboarding" subtitle="First-run variants">
// <DCArtboard id="a" label="A · Dusk" width={260} height={480}>…</DCArtboard>
// <DCArtboard id="b" label="B · Minimal" width={260} height={480}>…</DCArtboard>
// </DCSection>
// </DesignCanvas>
//
// Module note (migration): this was a script-tag `.jsx` relying on a
// global `React` / `htmlToImage` and `Object.assign(window, …)` exports. It
// now imports React, `react-dom` (for createPortal) and html-to-image as ES
// modules and uses named `export`s. The studio React logic is unchanged — the
// font-embed path still reads `window.htmlToImage`, so the import is also
// mirrored onto `window` to keep that helper working verbatim.

import React from 'react';
import * as ReactDOM from 'react-dom';
import * as htmlToImage from 'html-to-image';
import { exportArtboard } from './export/single.js';
import { exportArtboardPdf } from './export/pdf.js';
import { ContextMenu, useContextMenu } from './components/menu/context-menu.jsx';
import { move as moveEntry } from './components/menu/entity-kebab.jsx';
import { KIND_ICONS } from './components/menu/kind-icons.jsx';
import { renameProjectFile } from './runtime/write-client.js';
import { renamedFolderPath } from './components/canvas/use-inline-rename.js';

// Keep the brownfield font-embed helper (which reads `window.htmlToImage`)
// working unchanged after the move off the UMD script tag.
if (typeof window !== 'undefined' && !window.htmlToImage) {
 window.htmlToImage = htmlToImage;
}

const DC = {
 bg: '#f0eee9',
 grid: 'rgba(0,0,0,0.06)',
 label: 'rgba(60,50,40,0.7)',
 title: 'rgba(40,30,20,0.85)',
 subtitle: 'rgba(60,50,40,0.6)',
 postitBg: '#fef4a8',
 postitText: '#5a4a2a',
 font: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
};

// One-time CSS injection (classes are dc-prefixed so they don't collide with
// the hosted design's own styles).
if (typeof document !== 'undefined' && !document.getElementById('dc-styles')) {
 const s = document.createElement('style');
 s.id = 'dc-styles';
 s.textContent = [
 // Figma-style label truncation: clip a name to its own box + ellipsis so it
// never bleeds into the neighbour; the clamp lifts on focus so inline-rename
// shows the full text while typing.
'.dc-editable{cursor:text;outline:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block;border-radius:3px;padding:0 2px;margin:0 -2px}',
 '.dc-editable:focus{background:#fff;box-shadow:0 0 0 1.5px #c96442;overflow:visible;text-overflow:clip;max-width:none}',
 '[data-dc-slot]{transition:transform .18s cubic-bezier(.2,.7,.3,1)}',
 '[data-dc-slot].dc-dragging{transition:none;z-index:10;pointer-events:none}',
 // Group an artboard is being dragged INTO (cross-group move on drop).
 '[data-dc-section].dc-drop-target{outline:2px dashed #c96442;outline-offset:4px;border-radius:16px}',
 '.dc-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:80;padding:8px 14px;border-radius:10px;background:#1A1714;color:#FAF8F2;font:500 12.5px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(26,23,20,.2);pointer-events:none;transition:opacity 220ms var(--lm-ease),translate 220ms var(--lm-ease)}',
 // Enter from just below (translate composes with the centering transform); exit the same way.
 '@starting-style{.dc-toast{opacity:0;translate:0 8px}}',
 '.dc-toast--out{opacity:0;translate:0 8px;transition-duration:160ms}',
 '@media (prefers-reduced-motion:reduce){.dc-toast{transition-property:opacity}}',
 '[data-dc-slot].dc-dragging .dc-card{box-shadow:0 12px 40px rgba(0,0,0,.25),0 0 0 2px #c96442;transform:scale(1.02)}',
 '.dc-card{transition:box-shadow .15s,transform .15s}',
 '.dc-card *{scrollbar-width:none}',
 '.dc-card *::-webkit-scrollbar{display:none}',
 '.dc-labelrow{display:flex;align-items:center;gap:4px;height:24px}',
 // Page / group NAME TAG — sits on the container's top-left edge (like a Figma
 // section title) and counter-scales by --dc-inv so it reads at any zoom. A
 // filled tag with an icon = container; plain grey text above a card = artboard.
 '.dc-section-tag{position:absolute;left:0;bottom:100%;margin-bottom:calc(8px * var(--dc-inv, 1));transform:scale(var(--dc-inv, 1));transform-origin:left bottom;z-index:3;display:flex;align-items:center;gap:6px;height:30px;padding:0 4px 0 6px;border-radius:9px;background:var(--lm-bg-primary,#FAF8F2);box-shadow:0 1px 3px rgba(26,23,20,.10),0 0 0 1px rgba(26,23,20,.05);color:var(--lm-text-primary,#1A1714);font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;white-space:nowrap}',
 // A GROUP's tag is a folder tab joined to its frame: same fill, square
 // bottom corners, shared outline, overlapping the frame's top stroke by 1
 // screen px so the line doesn't run under the tab. A PAGE keeps the floating
 // pill (a page is the canvas itself, not a box).
 '.dc-section-tag[data-dc-kind=group]{margin-bottom:calc(-1px * var(--dc-inv, 1));border-radius:9px 9px 0 0;box-shadow:0 0 0 1px var(--dc-group-stroke);clip-path:inset(-3px -3px -6px -3px)}',
 // Paint the tab's fill a few px down over the frame's top outline so no seam
 // shows under the tab at any zoom / sub-pixel offset (hover stroke is 1.5px).
 '.dc-section-tag[data-dc-kind=group]::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:6px;background:inherit;pointer-events:none}',
 // Group frame outline — box-shadow (no layout), 1 screen px at any zoom.
 '.dc-group-frame{box-shadow:0 0 0 calc(1px * var(--dc-inv, 1)) var(--dc-group-stroke);transition:box-shadow .12s}',
 '[data-dc-section]{--dc-group-stroke:rgba(26,23,20,.14)}',
 // Hover shows exactly where a group starts and ends — innermost group only.
 '[data-dc-section]:hover:not(:has([data-dc-section]:hover)){--dc-group-stroke:var(--lm-accent,#B85B33)}',
 '[data-dc-section]:hover:not(:has([data-dc-section]:hover))>.dc-group-frame{box-shadow:0 0 0 calc(1.5px * var(--dc-inv, 1)) var(--dc-group-stroke)}',
 '.dc-section-tag .dc-section-grip{margin:0 -2px 0 0}',
 // The PAGE's tag is a heading, not a pill: larger, set higher above its
 // content — the title of the whole canvas. Groups keep the folder tab.
 '.dc-section-tag[data-dc-kind=page]{height:40px;padding:0 4px 0 0;gap:8px;background:transparent;box-shadow:none;font-size:22px;font-weight:700;letter-spacing:-0.3px;margin-bottom:calc(22px * var(--dc-inv, 1))}',
 '.dc-section-tag[data-dc-kind=page] .dc-section-tag-icon svg{width:18px;height:18px}',
 '.dc-section-tag[data-dc-kind=page] .dc-section-tag-meta{font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 6px;border-radius:5px;background:var(--lm-bg-tertiary,#E8E2D4)}',
 '.dc-section-tag-icon{display:inline-flex;color:var(--lm-accent,#B85B33)}',
 '.dc-section-tag .dc-editable{outline:none;border-radius:4px;padding:2px 3px;max-width:320px;overflow:hidden;text-overflow:ellipsis}',
 '.dc-section-tag .dc-editable:focus{background:var(--lm-bg-tertiary,#E8E2D4)}',
 '.dc-section-tag-meta{font-size:11.5px;font-weight:500;color:var(--lm-text-tertiary,#6E6960)}',
 '.dc-section-tag-slot{display:inline-flex;position:relative}',
 // Artboard label row: name + ⋮ (+ status badges) at rest; size chip and Data
 // appear on hover/focus. Opacity (not display) keeps the row's width stable.
 // Touch has no hover — keep them visible there.
 '@media (hover:hover){[data-dc-slot] .lm-artboard-kebab .lm-size-badge,[data-dc-slot] .lm-artboard-kebab .lm-data-badge{opacity:0;transition:opacity .12s}[data-dc-slot]:hover .lm-artboard-kebab .lm-size-badge,[data-dc-slot]:hover .lm-artboard-kebab .lm-data-badge,[data-dc-slot]:focus-within .lm-artboard-kebab .lm-size-badge,[data-dc-slot]:focus-within .lm-artboard-kebab .lm-data-badge{opacity:1}}',
 // A group's "+ New asset / + New group" bar shows on hover (innermost group)
 // or keyboard focus; an empty group always shows it (data-empty).
 '@media (hover:hover){.dc-group-frame>[data-testid=section-add-bar]:not([data-empty]){opacity:0;transition:opacity .12s}[data-dc-section]:hover:not(:has([data-dc-section]:hover))>.dc-group-frame>[data-testid=section-add-bar],.dc-group-frame>[data-testid=section-add-bar]:focus-within{opacity:1}}',
 // Page-level add buttons sit after everything, so they can counter-scale
 // like the tags (readable at any zoom) without colliding with anything.
 '[data-testid=page-add-bar]{transform:scale(var(--dc-inv, 1));transform-origin:left top}',
 // Semantic zoom: far out, keep names only — details can't be read and collide.
 '[data-dc-far] .dc-section-tag-meta,[data-dc-far] .dc-section-tag .dc-section-grip,[data-dc-far] .lm-artboard-kebab,[data-dc-far] .dc-grip,[data-dc-far] .dc-dl,[data-dc-far] .dc-expand{display:none}',
   '.dc-labelrow:focus-within{overflow:visible}',
 // Chrome stays a constant SCREEN size at any zoom: each group counter-scales by
 // --dc-inv (= 1/canvas-scale, set per-slot in DCArtboardFrame) from its own
 // corner, and offsets are ×--dc-inv so position holds too. Name anchors left,
 // the export buttons + chip cluster anchor right.
 '.dc-label-left{display:flex;align-items:center;gap:4px;transform:scale(var(--dc-inv, 1));transform-origin:left bottom}',
 '.dc-grip{cursor:grab;display:flex;align-items:center;padding:5px 4px;border-radius:4px;transition:background .12s}',
 '.dc-grip:hover{background:rgba(0,0,0,.08)}',
 '.dc-grip:active{cursor:grabbing}',
 '.dc-grip:focus-visible{outline:2px solid #c96442;outline-offset:1px}',
 // Label truncation: an ABSOLUTE max-width on the editable (scoped rules below) —
// reserves the always-visible right cluster + grip, and MORE when the hover/error
// export badges show, so it ellipsizes ONLY when the text truly exceeds the artboard's
// on-screen width (--dc-w / --dc-inv − grip). An absolute value, not max-width:100%,
// which would form a cyclic constraint and collapse the label below its content.
'.dc-labeltext{cursor:pointer;border-radius:4px;padding:3px 6px;display:flex;align-items:center;transition:background .12s}',
 '.dc-labeltext:hover{background:rgba(0,0,0,.05)}',
'.dc-labeltext .dc-editable{max-width:max(40px, calc(var(--dc-w, 260px) / var(--dc-inv, 1) - var(--dc-cluster-w, 71px) - 16px))}',
'[data-dc-slot]:hover .dc-labeltext .dc-editable,[data-dc-slot]:has(.dc-dl[data-dc-error-disabled]) .dc-labeltext .dc-editable{max-width:max(40px, calc(var(--dc-w, 260px) / var(--dc-inv, 1) - var(--dc-cluster-w, 71px) - 230px))}',
 '.dc-expand{position:absolute;bottom:100%;right:calc((var(--dc-cluster-w, 26px) + 6px) * var(--dc-inv, 1));margin-bottom:calc(5px * var(--dc-inv, 1));transform:scale(var(--dc-inv, 1));transform-origin:right bottom;z-index:2;opacity:0;transition:opacity .12s,background .12s;',
 ' width:22px;height:22px;border-radius:5px;border:none;cursor:pointer;padding:0;',
 ' background:transparent;color:rgba(60,50,40,.7);display:flex;align-items:center;justify-content:center}',
 '.dc-expand:hover{background:rgba(0,0,0,.06);color:#2a251f}',
 '[data-dc-slot]:hover .dc-expand{opacity:1}',
 '.dc-expand:focus-visible{opacity:1;outline:2px solid #c96442;outline-offset:1px}',
 '.dc-dl{position:absolute;bottom:100%;margin-bottom:calc(5px * var(--dc-inv, 1));transform:scale(var(--dc-inv, 1));transform-origin:right bottom;z-index:2;opacity:0;transition:opacity .12s,background .12s;',
 ' height:22px;padding:0 8px;border-radius:5px;border:none;cursor:pointer;',
 ' background:rgba(255,255,255,.85);color:#2a251f;font:600 10px/1 var(--lm-font-mono,monospace);',
 ' letter-spacing:.06em;text-transform:uppercase;display:inline-flex;align-items:center;gap:4px;',
 ' box-shadow:0 1px 2px rgba(0,0,0,.06)}',
 '.dc-dl:hover{background:#fff;color:#000}',
 '.dc-dl[disabled]{opacity:.6;cursor:wait}',
 '.dc-dl[data-dc-error-disabled]{cursor:not-allowed;opacity:.45;background:rgba(200,60,60,.08);color:#a83228}',
 '[data-dc-slot]:hover .dc-dl{opacity:1}',
 // Right-edge cluster, ordered L→R: [ANIM*][JPG][PNG][expand][badge][kebab].
 // Kebab is always visible at right:0 (portaled in from artboard-kebab.jsx);
 // the other buttons sit left of it. ANIM is conditional on liveRefresh.
 // `--dc-cluster-w` is the measured width of the always-visible right cluster
 // (kebab, plus the auto-refresh badge when present), set per-slot by
 // artboard-kebab.jsx. The hover buttons offset from it so they never overlap
 // the badge; unset (no badge) the fallback reproduces the original offsets
 // (26 + 6/34/78/122 = 32/60/104/148). Measured local px → zoom-safe.
 '.dc-dl-png{right:calc((var(--dc-cluster-w, 26px) + 34px) * var(--dc-inv, 1))}',
 '.dc-dl-jpg{right:calc((var(--dc-cluster-w, 26px) + 78px) * var(--dc-inv, 1))}',
 '.dc-dl-animated{right:calc((var(--dc-cluster-w, 26px) + 122px) * var(--dc-inv, 1))}',
 // markdown export: PDF sits in the third slot (markdown has no ANIM).
 '.dc-dl-pdf{right:calc((var(--dc-cluster-w, 26px) + 122px) * var(--dc-inv, 1))}',
 // markdown edit: EDIT sits in the fourth slot, left of PDF.
 '.dc-dl-edit{right:calc((var(--dc-cluster-w, 26px) + 166px) * var(--dc-inv, 1))}',
 '.dc-dl:focus-visible{opacity:1;outline:2px solid #c96442;outline-offset:1px}',
 '.dc-focus-overlay button:focus-visible{outline:2px solid rgba(255,255,255,.8);outline-offset:2px}',
 ].join('\n');
 document.head.appendChild(s);
}

const DCCtx = React.createContext(null);

// ─────────────────────────────────────────────────────────────
// Capture helpers — html-to-image with embedded fonts so the
// downloaded image matches what's on screen.
//
// html-to-image's getFontEmbedCSS walks document.styleSheets and is blocked
// by SecurityError on cross-origin sheets — including @import'd Google Fonts.
// When that fails the SVG <foreignObject> falls back to a system sans, and
// glyph metrics shift just enough to wrap our headlines mid-sentence. So we
// build the embed CSS ourselves: fetch the Google Fonts stylesheet directly
// (CORS-enabled), then fetch each referenced woff2, base64-encode it, and
// inline data: URLs in place of the gstatic URLs.
// ─────────────────────────────────────────────────────────────
const DC_GOOGLE_FONTS_URL =
 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=JetBrains+Mono:wght@400;500;600&display=swap';

function _bufferToBase64(buf) {
 const bytes = new Uint8Array(buf);
 let bin = '';
 // chunk to avoid stack overflow in fromCharCode for large buffers
 const chunk = 0x8000;
 for (let i = 0; i < bytes.length; i += chunk) {
 bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
 }
 return btoa(bin);
}

async function _fetchGoogleFontEmbedCSS() {
 // Google Fonts gates served format on User-Agent. Browser fetch sends a
 // browser UA so we get woff2 — exactly what we want.
 const cssRes = await fetch(DC_GOOGLE_FONTS_URL, { mode: 'cors' });
 if (!cssRes.ok) throw new Error('font css fetch failed: ' + cssRes.status);
 let css = await cssRes.text();
 const urls = Array.from(
 new Set(
 Array.from(css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)).map((m) => m[1])
 )
 );
 const replacements = await Promise.all(
 urls.map(async (u) => {
 try {
 const r = await fetch(u, { mode: 'cors' });
 if (!r.ok) return [u, null];
 const buf = await r.arrayBuffer();
 const b64 = _bufferToBase64(buf);
 return [u, `data:font/woff2;base64,${b64}`];
 } catch (_) {
 return [u, null];
 }
 })
 );
 for (const [u, d] of replacements) {
 if (d) css = css.split(u).join(d);
 }
 return css;
}

let _dcFontCSS = null;
let _dcFontCSSPromise = null;
async function ensureFontEmbedCSS() {
 if (_dcFontCSS !== null) return _dcFontCSS;
 if (_dcFontCSSPromise) return _dcFontCSSPromise;
 _dcFontCSSPromise = (async () => {
 let css = '';
 try {
 css = await _fetchGoogleFontEmbedCSS();
 } catch (e) {
 console.warn('Google Fonts embed failed, falling back to htmlToImage scan', e);
 }
 // Also include whatever same-origin @font-face rules htmlToImage can pick
 // up (covers any future locally-hosted fonts without re-touching this).
 if (window.htmlToImage?.getFontEmbedCSS) {
 try {
 const extra = await window.htmlToImage.getFontEmbedCSS(document.body);
 if (extra) css += '\n' + extra;
 } catch (_) {}
 }
 _dcFontCSS = css;
 return css;
 })();
 return _dcFontCSSPromise;
}

function dcSafeFilename(text) {
 return (text || 'artboard')
 .toString()
 .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '')
 .replace(/\s+/g, ' ')
 .trim()
 .slice(0, 120) || 'artboard';
}

async function dcCapture(node, { width, height, fmt }) {
 if (!node || !window.htmlToImage) return null;
 if (document.fonts && document.fonts.ready) {
 try { await document.fonts.ready; } catch (_) {}
 }
 const fontEmbedCSS = await ensureFontEmbedCSS();
 const opts = {
 width, height, canvasWidth: width, canvasHeight: height,
 pixelRatio: 2, cacheBust: true, skipAutoScale: true,
 fontEmbedCSS,
 backgroundColor: fmt === 'jpg' ? '#ffffff' : undefined,
 style: {
 transform: 'none',
 transformOrigin: 'top left',
 margin: '0',
 width: width + 'px',
 height: height + 'px',
 },
 };
 return fmt === 'png'
 ? window.htmlToImage.toPng(node, opts)
 : window.htmlToImage.toJpeg(node, { ...opts, quality: 0.95 });
}

function dcTriggerDownload(dataUrl, filename) {
 const a = document.createElement('a');
 a.href = dataUrl;
 a.download = filename;
 a.click();
}

// ─────────────────────────────────────────────────────────────
// DesignCanvas — stateful wrapper around the pan/zoom viewport.
// Owns runtime state (per-section order, renamed titles/labels, focused
// artboard).
//
// Persistence — three layers, read in order, written to whichever is
// available:
// 1. .design-canvas.state.json sidecar fetched over HTTP (read-only in
// plain hosting; writes go through the optional window.omelette
// bridge if present).
// 2. window.omelette?.writeFile bridge (omelette/host runtime).
// 3. localStorage fallback — what plain `python -m http.server` users
// get. Keyed per-page so two studios served from the same origin
// don't collide.
//
// Focus is ephemeral.
// ─────────────────────────────────────────────────────────────
const DC_STATE_FILE = '.design-canvas.state.json';
const DC_LS_KEY = 'lerret-studio:state:' + (typeof location !== 'undefined' ? location.pathname : '/');

export function DesignCanvas({ children, orderKey, minScale, maxScale, style, canvasMenuItems, onReorderSlots, onReorderSections }) {
 // When the host saves order (Lerret: the folder's config.json), the source
 // children arrive already sorted and ARE the order. Local order state is then
 // only an optimistic override between a drop and the saved order coming back
 // — never read from or written to browser storage.
 const hostOrder = typeof onReorderSlots === 'function';
 // `sections` holds per-section artboard order/titles/labels; `order` holds the
 // user's custom TOP-LEVEL group order, keyed by page (`orderKey`), so groups
 // can be arranged beyond their default alphabetical order. `focus` is ephemeral.
 const [state, setState] = React.useState({ sections: {}, focus: null, order: {} });
 // Hold rendering until the sidecar read settles so the saved order/titles
 // appear on first paint (no source-order flash). didRead gates writes until
 // the read settles so the empty initial state can't clobber a slow read;
 // skipNextWrite suppresses the one echo-write that would otherwise follow
 // hydration.
 const [ready, setReady] = React.useState(false);
 const didRead = React.useRef(false);
 const skipNextWrite = React.useRef(false);

 React.useEffect(() => {
 let off = false;
 // Try the HTTP sidecar first (lets a host ship a pre-baked arrangement);
 // fall back to localStorage so plain-browser edits survive refresh.
 fetch('./' + DC_STATE_FILE)
 .then((r) => (r.ok ? r.json() : null))
 .then((saved) => {
 if (off) return;
 let next = saved && saved.sections ? saved : null;
 if (!next) {
 try {
 const raw = localStorage.getItem(DC_LS_KEY);
 if (raw) {
 const parsed = JSON.parse(raw);
 if (parsed && parsed.sections) next = parsed;
 }
 } catch (_) {}
 }
 if (!next) return;
 skipNextWrite.current = true;
 const sections = hostOrder
 ? Object.fromEntries(Object.entries(next.sections).map(([k, v]) => [k, { ...v, order: undefined }]))
 : next.sections;
 setState((s) => ({ ...s, sections, order: hostOrder ? {} : next.order || {} }));
 })
 .catch(() => {})
 .finally(() => { didRead.current = true; if (!off) setReady(true); });
 const t = setTimeout(() => { if (!off) setReady(true); }, 150);
 return () => { off = true; clearTimeout(t); };
 }, [hostOrder]);

 React.useEffect(() => {
 if (!didRead.current) return;
 if (skipNextWrite.current) { skipNextWrite.current = false; return; }
 const t = setTimeout(() => {
 const sections = hostOrder
 ? Object.fromEntries(Object.entries(state.sections).map(([k, v]) => [k, { ...v, order: undefined }]))
 : state.sections;
 const payload = JSON.stringify({ sections, order: hostOrder ? {} : state.order });
 // Always mirror to localStorage so plain-browser users get persistence.
 try { localStorage.setItem(DC_LS_KEY, payload); } catch (_) {}
 // Best-effort write back to the sidecar via the host bridge if present.
 window.omelette?.writeFile(DC_STATE_FILE, payload).catch(() => {});
 }, 250);
 return () => clearTimeout(t);
 }, [state.sections, state.order, hostOrder]);

 // Build registries synchronously from children so FocusOverlay can read them
 // in the same render. Sections nest: a sub-group's DCSection is rendered
 // INSIDE its parent's DCSection (each wrapped one level in <SectionKebab> for
 // per-section chrome). So the walk is recursive AND resolves a DCSection
 // whether it is a direct child or sits inside a single wrapper — every
 // section, at any depth, is registered for focus / reorder / download.
 const registry = {}; // slotId -> { sectionId, artboard }
 const sectionMeta = {}; // sectionId -> { title, subtitle, slotIds[] }
 const sectionOrder = [];
 const resolveSection = (node) => {
 if (!node) return null;
 if (node.type === DCSection) return node;
 // Resolve through a single wrapper (e.g. <SectionKebab>).
 let found = null;
 React.Children.forEach(node.props && node.props.children, (c) => {
 if (!found && c && c.type === DCSection) found = c;
 });
 return found;
 };
 const visitSections = (nodes) => {
 React.Children.forEach(nodes, (node) => {
 const sec = resolveSection(node);
 if (!sec) return;
 const sid = sec.props.id ?? sec.props.title;
 if (!sid) return;
 sectionOrder.push(sid);
 const persisted = state.sections[sid] || {};
 const srcIds = [];
 React.Children.forEach(sec.props.children, (ab) => {
 if (!ab || ab.type !== DCArtboard) return;
 const aid = ab.props.id ?? ab.props.label;
 if (!aid) return;
 registry[`${sid}/${aid}`] = { sectionId: sid, artboard: ab };
 srcIds.push(aid);
 });
 const kept = (persisted.order || []).filter((k) => srcIds.includes(k));
 sectionMeta[sid] = {
 srcIds,
 title: persisted.title ?? sec.props.title,
 subtitle: sec.props.subtitle,
 slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))],
 };
 // Recurse into this section's children to register nested sub-groups.
 visitSections(sec.props.children);
 });
 };
 // Apply the user's custom top-level group order (persisted per page). Groups
 // not in the saved order (newly created) append in source (alphabetical)
 // order. Non-section children (e.g. the in-canvas "+ New group" affordance)
 // are kept after the groups.
 const savedTopOrder = (orderKey && state.order[orderKey]) || [];
 const topSections = [];
 const otherChildren = [];
 React.Children.forEach(children, (child) => {
 const sec = resolveSection(child);
 const sid = sec && (sec.props.id ?? sec.props.title);
 if (sid) topSections.push({ id: sid, child });
 else if (child) otherChildren.push(child);
 });
 const keptTop = savedTopOrder.filter((id) => topSections.some((s) => s.id === id));
 let topOrder = [...keptTop, ...topSections.map((s) => s.id).filter((id) => !keptTop.includes(id))];
 // The page's own section always leads (its groups are what reorder).
 if (hostOrder && topOrder.includes(orderKey)) topOrder = [orderKey, ...topOrder.filter((id) => id !== orderKey)];
 const topById = Object.fromEntries(topSections.map((s) => [s.id, s.child]));
 const orderedChildren = [...topOrder.map((id) => topById[id]), ...otherChildren];

 visitSections(orderedChildren);

 // Host-saved order: once the source order changes (the save landed, or the
 // project changed), drop the optimistic overrides — the source is the truth.
 const srcKey = hostOrder
 ? topSections.map((t) => t.id).join('|') + '§' + Object.entries(sectionMeta).map(([k, m]) => k + ':' + (m.srcIds || []).join(',')).join('|')
 : '';
 React.useEffect(() => {
 if (!hostOrder) return;
 setState((s) => ({
 ...s,
 order: {},
 sections: Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, { ...v, order: undefined }])),
 }));
 }, [srcKey, hostOrder]);

 const api = React.useMemo(() => ({
 state,
 section: (id) => state.sections[id] || {},
 patchSection: (id, p) => setState((s) => ({
 ...s,
 sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
 })),
 setFocus: (slotId) => setState((s) => ({ ...s, focus: slotId })),
 // Reorder the top-level groups for this page. `ids` is the full new order.
 reorderSections: (ids) => {
 if (!orderKey) return;
 setState((s) => ({ ...s, order: { ...s.order, [orderKey]: ids } }));
 if (onReorderSections) saveOrder(onReorderSections(ids));
 },
 // Artboard order within one section (optimistic + saved by the host).
 reorderSlots: (sid, ids) => {
 setState((s) => ({ ...s, sections: { ...s.sections, [sid]: { ...s.sections[sid], order: ids } } }));
 if (onReorderSlots) saveOrder(onReorderSlots(sid, ids));
 },
 // Whether top-level group reordering is available (a page is loaded).
 canReorderSections: !!orderKey,
 }), [state, orderKey, onReorderSections, onReorderSlots]);

 // Esc exits focus; any outside pointerdown commits an in-progress rename.
 React.useEffect(() => {
 const onKey = (e) => { if (e.key === 'Escape') api.setFocus(null); };
 const onPd = (e) => {
 const ae = document.activeElement;
 if (ae && ae.isContentEditable && !ae.contains(e.target)) ae.blur();
 };
 document.addEventListener('keydown', onKey);
 document.addEventListener('pointerdown', onPd, true);
 return () => {
 document.removeEventListener('keydown', onKey);
 document.removeEventListener('pointerdown', onPd, true);
 };
 }, [api]);

 return (
 <DCCtx.Provider value={api}>
 <DCViewport minScale={minScale} maxScale={maxScale} style={style} canvasMenuItems={canvasMenuItems}>{ready && orderedChildren}</DCViewport>
 {state.focus && registry[state.focus] && (
 <DCFocusOverlay entry={registry[state.focus]} sectionMeta={sectionMeta} sectionOrder={sectionOrder} />
 )}
 {/* Top-right "All PNG/JPG" buttons removed — replaced by the bottom
 StudioDock. dcDownloadSlots is exposed on window so the dock can
 trigger the same logic. */}
 </DCCtx.Provider>
 );
}

// Expose so studio-shell.jsx (and any other host) can drive captures.
if (typeof window !== 'undefined') window.dcDownloadSlots = dcDownloadSlots;

// Shared: walk a list of slot elements and trigger a download per artboard.
// Used by both the global "All PNG/JPG" and the per-section "↓ PNG/JPG"
// buttons so behavior (filename format, font embedding, pacing) stays
// identical.
async function dcDownloadSlots(slots, fmt, onProgress) {
 if (!slots.length) return;
 await ensureFontEmbedCSS();
 for (let i = 0; i < slots.length; i++) {
 onProgress?.({ i: i + 1, total: slots.length });
 const slot = slots[i];
 const card = slot.querySelector('.dc-card');
 if (!card) continue;
 const w = parseInt(slot.dataset.dcW, 10) || card.offsetWidth;
 const h = parseInt(slot.dataset.dcH, 10) || card.offsetHeight;
 const label = slot.dataset.dcLabel || slot.dataset.dcSlot || `artboard-${i + 1}`;
 const sectionTitle = slot.dataset.dcSectionTitle || '';
 const labelPart = dcSafeFilename(label);
 const sectionPart = sectionTitle ? dcSafeFilename(sectionTitle) : '';
 const filename = sectionPart ? `${sectionPart}--${labelPart}` : labelPart;
 try {
 const data = await dcCapture(card, { width: w, height: h, fmt });
 if (data) dcTriggerDownload(data, `${filename}.${fmt === 'jpg' ? 'jpg' : 'png'}`);
 } catch (err) {
 console.error('capture failed for', label, err);
 }
 // Small breath so the browser can flush each download dialog.
 await new Promise((r) => setTimeout(r, 250));
 }
}

// Floating toolbar: capture every artboard in DOM order and download as PNG/JPG.
function DCDownloadAll() {
 const [busy, setBusy] = React.useState(null);
 const [progress, setProgress] = React.useState(null); // { i, total }

 const downloadAll = async (fmt) => {
 if (busy) return;
 const slots = Array.from(document.querySelectorAll('[data-dc-slot]'));
 if (!slots.length) return;
 setBusy(fmt);
 setProgress({ i: 0, total: slots.length });
 try {
 await dcDownloadSlots(slots, fmt, (p) => setProgress(p));
 } finally {
 setBusy(null);
 setProgress(null);
 }
 };

 const label = (fmt) => {
 if (busy === fmt && progress) return `${progress.i}/${progress.total}…`;
 return `All ${fmt.toUpperCase()}`;
 };

 return (
 <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 50, display: 'flex', gap: 8 }}>
 <button
 onClick={() => downloadAll('png')}
 disabled={!!busy}
 style={btnStyle(busy === 'png')}
 title="Download every artboard as PNG"
 >{label('png')}</button>
 <button
 onClick={() => downloadAll('jpg')}
 disabled={!!busy}
 style={btnStyle(busy === 'jpg')}
 title="Download every artboard as JPG"
 >{label('jpg')}</button>
 </div>
 );
}

// Await a host order save; say so if it failed (the drop still shows locally).
function saveOrder(result) {
 Promise.resolve(result).then((res) => {
 if (res && res.ok === false) dcToast(`Couldn’t save the order: ${res.error || 'unknown error'}`);
 });
}

// Rename a page/group folder from its name tag. Blank or unchanged text is a
// no-op; on failure (name taken, invalid) the tag shows the real name again.
async function renameSectionFolder(folderPath, text, el, currentName) {
 const target = folderPath ? renamedFolderPath(folderPath, text) : null;
 if (!target) {
 if (el) el.textContent = currentName;
 return;
 }
 const res = await renameProjectFile(folderPath, target);
 if (!res.ok) {
 if (el) el.textContent = currentName;
 dcToast(`Couldn’t rename: ${res.error || 'unknown error'}`);
 }
}

// A short, self-removing status line above the dock (the studio has no toast
// surface; this is the minimum so a drag-move says what happened).
function dcToast(text) {
 if (typeof document === 'undefined') return;
 const el = document.createElement('div');
 el.className = 'dc-toast';
 el.setAttribute('role', 'status');
 el.textContent = text;
 document.body.appendChild(el);
 // Leave the way it came (down + fade), then remove once the transition ends.
 setTimeout(() => {
 el.classList.add('dc-toast--out');
 setTimeout(() => el.remove(), 200);
 }, 2400);
}

// Artboard slots that belong DIRECTLY to a section — excluding slots inside
// nested sub-group sections (DOM descendants now that a sub-group renders
// contained inside its parent's frame). Per-section download and drag-reorder
// use this so they scope to the section's own artboards, never its sub-groups'.
function dcDirectSlots(sectionId) {
 if (typeof document === 'undefined') return [];
 const sid = String(sectionId);
 return Array.from(
 document.querySelectorAll(`[data-dc-section="${sid}"] [data-dc-slot]`)
 ).filter((el) => {
 const owner = el.closest('[data-dc-section]');
 return !!owner && owner.getAttribute('data-dc-section') === sid;
 });
}

function btnStyle(active) {
 return {
 height: 32,
 padding: '0 14px',
 borderRadius: 8,
 border: 'none',
 background: active ? '#0f172a' : '#fff',
 color: active ? '#fff' : '#0f172a',
 font: '600 12px/1 -apple-system, BlinkMacSystemFont, sans-serif',
 letterSpacing: '0.04em',
 textTransform: 'uppercase',
 cursor: active ? 'wait' : 'pointer',
 boxShadow: '0 2px 6px rgba(15,23,42,0.10)',
 };
}

// ─────────────────────────────────────────────────────────────
// DCViewport — transform-based pan/zoom (internal)
//
// Input mapping (Figma-style):
// • trackpad pinch → zoom (ctrlKey wheel; Safari gesture* events)
// • trackpad scroll → pan (two-finger)
// • mouse wheel → zoom (notched; distinguished from trackpad scroll)
// • middle-drag / primary-drag-on-bg → pan
//
// Transform state lives in a ref and is written straight to the DOM
// (translate3d + will-change) so wheel ticks don't go through React —
// keeps pans at 60fps on dense canvases.
// ─────────────────────────────────────────────────────────────
// Canvas chrome (name tags, artboard labels) stays a constant SCREEN size by
// counter-scaling with --dc-inv — but only down to 50% zoom. Past that, the
// room reserved for it in the layout (fixed canvas px) is smaller than the
// chrome, and labels collide; so below 50% the chrome shrinks with the canvas.
// Zoomed far out (< 35%) only names remain (data-dc-far hides the rest).
const CHROME_MAX_INV = 2;
// Space above each top-level page/group block (canvas px) — fits its name tag.
const DC_BLOCK_GAP = 88;
// The page heading is taller and sits higher, so the page block gets more room.
const DC_PAGE_GAP = 120;
const FAR_ZOOM = 0.35;
function publishChromeScale(el, scale) {
 el.style.setProperty('--dc-inv', String(Math.min(1 / (scale || 1), CHROME_MAX_INV)));
 if (scale < FAR_ZOOM) el.setAttribute('data-dc-far', '');
 else el.removeAttribute('data-dc-far');
}

function DCViewport({ children, minScale = 0.1, maxScale = 8, style = {}, canvasMenuItems = [] }) {
 const vpRef = React.useRef(null);
 const worldRef = React.useRef(null);
 const tf = React.useRef({ x: 0, y: 0, scale: 1 });
 // Transform-change subscribers (the zoom readout + mini-map). Notified on a
 // throttled rAF so the pan/zoom hot path never re-renders the canvas world.
 const listenersRef = React.useRef(new Set());
 const publishRafRef = React.useRef(0);

 // Right-click on the empty canvas (the void) opens a small context menu.
 const ctx = useContextMenu();

 // Settle timer for crisp-at-rest rendering. While panning/zooming we keep the
 // world on the GPU fast path (translate3d + will-change), which promotes it to
 // a fixed raster-scale layer — so zooming IN magnifies a cached texture and
 // text goes blurry. When motion stops we drop to a 2D transform and release
 // will-change, so the browser re-rasterizes the content sharp at the current
 // zoom. Re-promoted the instant the next pan/zoom frame calls apply().
 const settleRef = React.useRef(0);
 const applySettled = React.useCallback(() => {
 const { x, y, scale } = tf.current;
 const el = worldRef.current;
 if (!el) return;
 el.style.willChange = 'auto';
 el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
 // Publish 1/scale so the per-artboard chrome counter-scales to a constant
 // screen size. Inherited by every slot/chrome element inside the world.
 publishChromeScale(el, scale);
 }, []);
 const apply = React.useCallback(() => {
 const { x, y, scale } = tf.current;
 const el = worldRef.current;
 if (el) {
 el.style.willChange = 'transform';
 el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
 publishChromeScale(el, scale);
 }
 if (settleRef.current) clearTimeout(settleRef.current);
 settleRef.current = setTimeout(applySettled, 180);
 }, [applySettled]);

 // Notify subscribers of the current transform (rAF-throttled).
 const publish = React.useCallback(() => {
 if (publishRafRef.current) return;
 publishRafRef.current = requestAnimationFrame(() => {
 publishRafRef.current = 0;
 const t = tf.current;
 listenersRef.current.forEach((fn) => { try { fn({ ...t }); } catch (_) {} });
 });
 }, []);

 // Measure each top-level card (a page's own section or a top-level group) in
 // world-LOCAL coordinates (transform-independent). Sub-groups are nested
 // inside these, so the top-level cards bound all content.
 const measureCards = React.useCallback(() => {
 const world = worldRef.current;
 if (!world) return [];
 const cards = world.querySelectorAll(
 '[data-dc-section-depth="0"], [data-dc-section-depth="1"]',
 );
 if (!cards.length) return [];
 const s = tf.current.scale || 1;
 const wr = world.getBoundingClientRect(); // reflects the applied transform
 const out = [];
 for (const c of cards) {
 const b = c.getBoundingClientRect();
 out.push({
 x: (b.left - wr.left) / s,
 y: (b.top - wr.top) / s,
 w: b.width / s,
 h: b.height / s,
 });
 }
 return out;
 }, []);

 // Union bbox of the cards, in world-local coords. `null` when there's nothing.
 const getContentBounds = React.useCallback(() => {
 const cards = measureCards();
 if (!cards.length) return null;
 let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
 for (const c of cards) {
 minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
 maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
 }
 return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
 }, [measureCards]);

 const getViewportSize = React.useCallback(() => {
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 return r ? { width: r.width, height: r.height } : { width: 0, height: 0 };
 }, []);

 // Bounded pan — content can never be flung into the void (the bug). When the
 // content is larger than the viewport on an axis you can pan across it, but
 // its far edge can't recede more than a small breathing margin past the
 // viewport edge; when it's smaller than the viewport, it centers on that axis.
 const clampPan = React.useCallback(() => {
 const b = getContentBounds();
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 if (!b || !r) return;
 const t = tf.current;
 const s = t.scale;
 // How much empty canvas may show past an edge — the pannable "slack". Kept
 // generous so the user can always tuck content up / to the side, clear of the
 // fixed bottom-left overview map and the bottom toolbar, when content overflows.
 const BM = 320;
 const clampAxis = (pos, originLocal, sizeLocal, viewport) => {
 const origin = originLocal * s;
 const size = sizeLocal * s;
 const lo = viewport - BM - (origin + size); // far edge ≥ viewport − BM
 const hi = BM - origin; // near edge ≤ BM
 // Content smaller than the viewport (lo > hi) → center it on this axis.
 if (lo > hi) return (viewport - size) / 2 - origin;
 return Math.max(lo, Math.min(hi, pos));
 };
 t.x = clampAxis(t.x, b.minX, b.width, r.width);
 t.y = clampAxis(t.y, b.minY, b.height, r.height);
 }, [getContentBounds]);

 // Frame ALL content (the Fit button / Shift+1). Capped at 100% so a small
 // project isn't blown up past its true size.
 const fit = React.useCallback((padding = 90) => {
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 const b = getContentBounds();
 if (!r || !b || b.width <= 0 || b.height <= 0) return;
 let scale = Math.min((r.width - padding * 2) / b.width, (r.height - padding * 2) / b.height, 1);
 scale = Math.max(minScale, Math.min(maxScale, scale));
 tf.current = {
 scale,
 x: (r.width - b.width * scale) / 2 - b.minX * scale,
 y: (r.height - b.height * scale) / 2 - b.minY * scale,
 };
 apply(); publish();
 }, [apply, getContentBounds, minScale, maxScale, publish]);

 // Frame to WIDTH, aligned to the top — the calm default when a page opens, so
 // a tall stack of cards starts readable at the top rather than tiny.
 const fitWidth = React.useCallback((padding = 60) => {
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 const b = getContentBounds();
 if (!r || !b || b.width <= 0) return;
 let scale = Math.min((r.width - padding * 2) / b.width, 1);
 scale = Math.max(minScale, Math.min(maxScale, scale));
 tf.current = {
 scale,
 x: (r.width - b.width * scale) / 2 - b.minX * scale,
 y: padding - b.minY * scale,
 };
 apply(); publish();
 }, [apply, getContentBounds, minScale, maxScale, publish]);

 // Zoom to a target scale, keeping the viewport center fixed.
 const setZoom = React.useCallback((nextScale) => {
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 if (!r) return;
 const t = tf.current;
 const ns = Math.max(minScale, Math.min(maxScale, nextScale));
 const cx = r.width / 2, cy = r.height / 2;
 const k = ns / t.scale;
 t.x = cx - (cx - t.x) * k;
 t.y = cy - (cy - t.y) * k;
 t.scale = ns;
 clampPan(); apply(); publish();
 }, [apply, clampPan, minScale, maxScale, publish]);

 const zoomBy = React.useCallback((factor) => setZoom(tf.current.scale * factor), [setZoom]);
 const reset100 = React.useCallback(() => setZoom(1), [setZoom]);

 // Center a world-LOCAL point in the viewport (used by mini-map click/drag).
 const panToLocal = React.useCallback((lx, ly) => {
 const r = vpRef.current && vpRef.current.getBoundingClientRect();
 if (!r) return;
 const t = tf.current;
 t.x = r.width / 2 - lx * t.scale;
 t.y = r.height / 2 - ly * t.scale;
 clampPan(); apply(); publish();
 }, [apply, clampPan, publish]);

 React.useEffect(() => {
 const vp = vpRef.current;
 if (!vp) return;

 const zoomAt = (cx, cy, factor) => {
 const r = vp.getBoundingClientRect();
 const px = cx - r.left, py = cy - r.top;
 const t = tf.current;
 const next = Math.min(maxScale, Math.max(minScale, t.scale * factor));
 const k = next / t.scale;
 // keep the world point under the cursor fixed
 t.x = px - (px - t.x) * k;
 t.y = py - (py - t.y) * k;
 t.scale = next;
 clampPan(); apply(); publish();
 };

 // Wheel routing — convention matches most apps:
 // • ⌘/Ctrl + wheel → zoom (browsers also set ctrlKey during a
 // trackpad pinch, so this single branch
 // covers both real ⌘/Ctrl+wheel and pinch)
 // • Shift + wheel → horizontal pan
 // • plain wheel/scroll → pan (vertical or both axes)
 const onWheel = (e) => {
 e.preventDefault();
 if (isGesturing) return; // Safari: gesture* owns the pinch — discard concurrent wheels
 if (e.ctrlKey || e.metaKey) {
 // Trackpad pinch sends fractional deltas; mouse ctrl+wheel sends
 // larger integer deltas. Both feel right with this exponent.
 zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
 } else if (e.shiftKey && e.deltaX === 0) {
 // Shift+wheel → horizontal pan (browsers don't auto-flip axis here)
 tf.current.x -= e.deltaY;
 clampPan(); apply(); publish();
 } else {
 // Plain wheel scroll — pan in both axes (deltaX is non-zero on
 // trackpads and tilt-wheels; zero on a vertical-only mouse wheel).
 tf.current.x -= e.deltaX;
 tf.current.y -= e.deltaY;
 clampPan(); apply(); publish();
 }
 };

 // Safari sends native gesture* events for trackpad pinch with a smooth
 // e.scale; preferring these over the ctrl+wheel fallback gives a much
 // better feel there. No-ops on other browsers. Safari also fires
 // ctrlKey wheel events during the same pinch — isGesturing makes
 // onWheel drop those entirely so they neither zoom nor pan.
 let gsBase = 1;
 let isGesturing = false;
 const onGestureStart = (e) => { e.preventDefault(); isGesturing = true; gsBase = tf.current.scale; };
 const onGestureChange = (e) => {
 e.preventDefault();
 zoomAt(e.clientX, e.clientY, (gsBase * e.scale) / tf.current.scale);
 };
 const onGestureEnd = (e) => { e.preventDefault(); isGesturing = false; };

 // Drag-pan: middle button anywhere, or primary button on canvas
 // background (anything that isn't an artboard or an inline editor).
 let drag = null;
 const onPointerDown = (e) => {
 // Never initiate drag-pan (or any setPointerCapture) when the pointerdown
 // targets a kebab trigger or an open menu popover — including middle-click,
 // which bypasses the onBg check below. Without this early-return, the
 // pointer is captured by `vp` and subsequent pointerup/click never reach
 // the button (Bug B). Kept narrow to the kebab/popover surface to match
 // the spec's "minimum surgical fix" boundary; broader `button` exclusion
 // was considered but is over-broad for the actual root cause.
 if (e.target.closest('.lm-kebab-trigger, .lm-menu-popover, .lm-live-pop, .lm-live-badge')) return;
 // `.dc-section-cta` marks in-canvas interactive content that isn't an
 // artboard slot (e.g. the empty-group "+ Add asset" placeholder). Without
 // this, a pointerdown there counts as "background", the viewport captures
 // the pointer, and the button's click never fires (dead click).
 const onBg = !e.target.closest('[data-dc-slot], .dc-editable, .dc-section-cta, .dc-section-grip');
 if (!(e.button === 1 || (e.button === 0 && onBg))) return;
 e.preventDefault();
 vp.setPointerCapture(e.pointerId);
 drag = { id: e.pointerId, lx: e.clientX, ly: e.clientY };
 vp.style.cursor = 'grabbing';
 };
 const onPointerMove = (e) => {
 if (!drag || e.pointerId !== drag.id) return;
 tf.current.x += e.clientX - drag.lx;
 tf.current.y += e.clientY - drag.ly;
 drag.lx = e.clientX; drag.ly = e.clientY;
 clampPan(); apply(); publish();
 };
 const onPointerUp = (e) => {
 if (!drag || e.pointerId !== drag.id) return;
 vp.releasePointerCapture(e.pointerId);
 drag = null;
 vp.style.cursor = '';
 };

 vp.addEventListener('wheel', onWheel, { passive: false });
 vp.addEventListener('gesturestart', onGestureStart, { passive: false });
 vp.addEventListener('gesturechange', onGestureChange, { passive: false });
 vp.addEventListener('gestureend', onGestureEnd, { passive: false });
 vp.addEventListener('pointerdown', onPointerDown);
 vp.addEventListener('pointermove', onPointerMove);
 vp.addEventListener('pointerup', onPointerUp);
 vp.addEventListener('pointercancel', onPointerUp);
 return () => {
 vp.removeEventListener('wheel', onWheel);
 vp.removeEventListener('gesturestart', onGestureStart);
 vp.removeEventListener('gesturechange', onGestureChange);
 vp.removeEventListener('gestureend', onGestureEnd);
 vp.removeEventListener('pointerdown', onPointerDown);
 vp.removeEventListener('pointermove', onPointerMove);
 vp.removeEventListener('pointerup', onPointerUp);
 vp.removeEventListener('pointercancel', onPointerUp);
 };
 }, [apply, minScale, maxScale, clampPan, publish]);

 // Public viewport API for the zoom controls + mini-map (rendered as fixed
 // chrome outside the panned world, so they don't trip the pan handler).
 // `lerret:pan-by` {dx, dy} (screen px) — lets overlays (e.g. the markdown
 // preview panel) nudge the canvas so what's being edited stays in view.
 React.useEffect(() => {
 const onPan = (e) => {
 const { dx = 0, dy = 0 } = (e && e.detail) || {};
 tf.current = { ...tf.current, x: tf.current.x + dx, y: tf.current.y + dy };
 apply(); publish();
 };
 window.addEventListener('lerret:pan-by', onPan);
 return () => window.removeEventListener('lerret:pan-by', onPan);
 }, [apply, publish]);

 const api = React.useMemo(() => ({
 subscribe: (fn) => { listenersRef.current.add(fn); return () => listenersRef.current.delete(fn); },
 getTransform: () => ({ ...tf.current }),
 getContentBounds,
 measureCards,
 getViewportSize,
 fit,
 reset100,
 zoomBy,
 setZoom,
 panToLocal,
 }), [getContentBounds, measureCards, getViewportSize, fit, reset100, zoomBy, setZoom, panToLocal]);

 // Canvas-void context-menu items: any injected project actions (New page /
 // New group, supplied by project-canvas) plus the navigation the canvas owns.
 const voidItems = React.useMemo(() => {
 const nav = [
 { kind: 'item', id: 'ctx-fit', label: 'Fit to screen', onSelect: () => api.fit() },
 { kind: 'item', id: 'ctx-reset', label: 'Reset zoom to 100%', onSelect: () => api.reset100() },
 ];
 return (canvasMenuItems && canvasMenuItems.length)
 ? [...canvasMenuItems, { kind: 'separator', id: 'ctx-void-sep' }, ...nav]
 : nav;
 }, [canvasMenuItems, api]);

 // Auto-frame on mount (and on page switch — the canvas remounts per page):
 // fit to width, top-aligned, once the cards have laid out. The canvas gates
 // its children behind a short async "ready" read, so poll until content
 // appears (up to ~2s), fit once, then stop.
 React.useEffect(() => {
 let cancelled = false;
 let done = false;
 let timer = 0;
 const deadline = Date.now() + 2000;
 const tryFit = () => {
 if (cancelled || done) return;
 const b = getContentBounds();
 if (b && b.width > 0) { done = true; fitWidth(); publish(); return; }
 if (Date.now() < deadline) timer = setTimeout(tryFit, 60);
 };
 const raf = requestAnimationFrame(tryFit);
 return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(timer); };
 }, [getContentBounds, fitWidth, publish]);

 // Keyboard shortcuts: Shift+1 = fit all, Shift+0 = 100% (ignored while typing).
 React.useEffect(() => {
 const onKey = (e) => {
 const ae = document.activeElement;
 if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName))) return;
 if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
 if (e.key === '1' || e.key === '!') { e.preventDefault(); fit(); }
 else if (e.key === '0' || e.key === ')') { e.preventDefault(); reset100(); }
 };
 window.addEventListener('keydown', onKey);
 return () => window.removeEventListener('keydown', onKey);
 }, [fit, reset100]);

 const gridSvg = `url("data:image/svg+xml,%3Csvg width='120' height='120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M120 0H0v120' fill='none' stroke='${encodeURIComponent(DC.grid)}' stroke-width='1'/%3E%3C/svg%3E")`;
 return (
 <React.Fragment>
 <div
 ref={vpRef}
 className="design-canvas"
 data-tour="canvas"
 onContextMenu={(e) => {
 // Section / artboard right-clicks open their own menus (they
 // stopPropagation), so this only fires on the empty canvas. Guard
 // defensively against any unwrapped section/slot.
 if (e.target && e.target.closest && e.target.closest('[data-dc-section], [data-dc-slot]')) return;
 ctx.openAt(e);
 }}
 style={{
 height: '100vh', width: '100vw',
 background: DC.bg,
 overflow: 'hidden',
 overscrollBehavior: 'none',
 touchAction: 'none',
 position: 'relative',
 fontFamily: DC.font,
 boxSizing: 'border-box',
 ...style,
 }}
 >
 <div
 ref={worldRef}
 style={{
 position: 'absolute', top: 0, left: 0,
 transformOrigin: '0 0',
 willChange: 'transform',
 width: 'max-content', minWidth: '100%',
 minHeight: '100%',
 padding: '8px 0 140px', // top: blocks carry their own tag room (DC_BLOCK_GAP); bottom: clear of the dock
 }}
 >
 <div style={{ position: 'absolute', inset: -6000, backgroundImage: gridSvg, backgroundSize: '120px 120px', pointerEvents: 'none', zIndex: -1 }} />
 {children}
 </div>
 </div>
 {/* Wayfinding chrome — fixed, outside the panned world so they never trip
 the pan handler. Mini-map (bottom-left) for overview + jump; zoom/Fit
 cluster (bottom-right) for explicit control + a "you're never lost" exit. */}
 <DCMiniMap api={api} />
 <DCZoomControls api={api} />
 {ctx.open && <ContextMenu point={ctx.point} items={voidItems} onClose={ctx.close} />}
 </React.Fragment>
 );
}

// ─────────────────────────────────────────────────────────────
// DCZoomControls — bottom-right zoom readout + controls. Reads the live
// transform via the viewport's subscription so it never re-renders the world.
// ─────────────────────────────────────────────────────────────
function DCZoomControls({ api }) {
 const [scale, setScale] = React.useState(() => api.getTransform().scale);
 React.useEffect(() => api.subscribe((t) => setScale(t.scale)), [api]);
 const pct = Math.round(scale * 100);

 // Compact VERTICAL stack (2026-06-14, UX): zoom in / readout / zoom out,
 // then Fit. Narrow ~34px-wide capsule pinned bottom-right so it stops
 // competing with the dock; buttons trimmed 28→26.
 const wrap = {
 position: 'fixed', right: 18, bottom: 18, zIndex: 55,
 display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
 background: 'rgba(255,255,255,0.88)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 borderRadius: 14, padding: 4,
 boxShadow: '0 4px 18px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.06)',
 fontFamily: DC.font,
 };
 const iconBtn = {
 width: 26, height: 26, borderRadius: 8, border: 'none',
 background: 'transparent', color: '#3a3530', cursor: 'pointer',
 fontSize: 17, lineHeight: 1, display: 'inline-flex',
 alignItems: 'center', justifyContent: 'center',
 transition: 'background .12s',
 };
 const pctBtn = {
 width: 26, height: 20, borderRadius: 6, border: 'none', padding: 0,
 background: 'transparent', color: '#3a3530', cursor: 'pointer',
 font: '600 10px/1 ' + DC.font, fontVariantNumeric: 'tabular-nums',
 transition: 'background .12s',
 };
 const fitBtn = {
 width: 26, height: 26, borderRadius: 8, border: 'none',
 background: 'transparent', color: '#3a3530', cursor: 'pointer',
 display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
 transition: 'background .12s',
 };
 const hov = (on) => (e) => { e.currentTarget.style.background = on ? 'rgba(0,0,0,0.05)' : 'transparent'; };

 return (
 <div data-tour="zoom-controls" style={wrap}>
 <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => api.zoomBy(1.2)}
 style={iconBtn} onMouseEnter={hov(true)} onMouseLeave={hov(false)}>+</button>
 <button type="button" title="Reset to 100% (Shift+0)" aria-label="Reset zoom to 100%" onClick={() => api.reset100()}
 style={pctBtn} onMouseEnter={hov(true)} onMouseLeave={hov(false)}>{pct}%</button>
 <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => api.zoomBy(1 / 1.2)}
 style={iconBtn} onMouseEnter={hov(true)} onMouseLeave={hov(false)}>−</button>
 <div style={{ height: 1, width: 18, background: 'rgba(60,50,40,0.14)', margin: '2px 0' }} />
 <button type="button" title="Fit everything to screen (Shift+1)" aria-label="Fit to screen" onClick={() => api.fit()}
 style={fitBtn} onMouseEnter={hov(true)} onMouseLeave={hov(false)}>
 <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 <path d="M1.5 4.5v-3h3M11.5 4.5v-3h-3M1.5 8.5v3h3M11.5 8.5v3h-3" />
 </svg>
 </button>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────
// DCMiniMap — bottom-left overview. Draws each top-level card as a small
// rectangle plus a "viewport" rectangle showing what's currently on screen.
// Click or drag anywhere on the map to recenter the canvas there.
// ─────────────────────────────────────────────────────────────
const DC_MINIMAP_W = 184;
const DC_MINIMAP_H = 132;

function DCMiniMap({ api }) {
 const [t, setT] = React.useState(() => api.getTransform());
 // A tick that advances on transform changes AND on window resize so the
 // card layout + viewport rectangle re-measure.
 const [, setTick] = React.useState(0);
 const mapRef = React.useRef(null);
 const dragRef = React.useRef(false);

 React.useEffect(() => api.subscribe((next) => setT(next)), [api]);
 React.useEffect(() => {
 const onResize = () => setTick((n) => n + 1);
 window.addEventListener('resize', onResize);
 return () => window.removeEventListener('resize', onResize);
 }, []);

 const bounds = api.getContentBounds();
 const cards = api.measureCards();
 const vpSize = api.getViewportSize();
 // Nothing to map (no content) — hide entirely.
 if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !cards.length) return null;
 // Hide when the whole project already fits the viewport at the current zoom —
 // there is nothing to navigate to, so the overview is pure chrome AND it would
 // otherwise sit on top of the page's "+ New group / + Add asset" buttons in a
 // small project. It reappears the moment content overflows (zoom in / grow).
 const scaleNow = t.scale || 1;
 const FIT_SLACK = 4; // px tolerance so we don't flicker right at the boundary
 if (
  bounds.width * scaleNow <= vpSize.width + FIT_SLACK &&
  bounds.height * scaleNow <= vpSize.height + FIT_SLACK
 ) {
  return null;
 }

 const PAD = 10;
 const innerW = DC_MINIMAP_W - PAD * 2;
 const innerH = DC_MINIMAP_H - PAD * 2;
 const s = Math.min(innerW / bounds.width, innerH / bounds.height);
 const offX = PAD + (innerW - bounds.width * s) / 2;
 const offY = PAD + (innerH - bounds.height * s) / 2;
 const toMapX = (lx) => offX + (lx - bounds.minX) * s;
 const toMapY = (ly) => offY + (ly - bounds.minY) * s;

 // Current visible region in world-LOCAL coords → map coords.
 const scale = t.scale || 1;
 const visLeft = -t.x / scale;
 const visTop = -t.y / scale;
 const visW = vpSize.width / scale;
 const visH = vpSize.height / scale;
 const vmX = toMapX(visLeft);
 const vmY = toMapY(visTop);
 const vmW = visW * s;
 const vmH = visH * s;

 const recenterFromEvent = (clientX, clientY) => {
 const el = mapRef.current;
 if (!el) return;
 const r = el.getBoundingClientRect();
 const mx = clientX - r.left;
 const my = clientY - r.top;
 const lx = bounds.minX + (mx - offX) / s;
 const ly = bounds.minY + (my - offY) / s;
 api.panToLocal(lx, ly);
 };

 const onDown = (e) => {
 e.preventDefault();
 e.stopPropagation();
 dragRef.current = true;
 try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
 recenterFromEvent(e.clientX, e.clientY);
 };
 const onMove = (e) => {
 if (!dragRef.current) return;
 recenterFromEvent(e.clientX, e.clientY);
 };
 const onUp = (e) => {
 dragRef.current = false;
 try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
 };

 return (
 <div
 ref={mapRef}
 data-tour="minimap"
 data-testid="dc-minimap"
 onPointerDown={onDown}
 onPointerMove={onMove}
 onPointerUp={onUp}
 onPointerCancel={onUp}
 title="Overview — click or drag to navigate"
 style={{
 position: 'fixed', left: 18, bottom: 18, zIndex: 55,
 width: DC_MINIMAP_W, height: DC_MINIMAP_H,
 background: 'rgba(255,255,255,0.82)',
 backdropFilter: 'blur(16px) saturate(120%)',
 WebkitBackdropFilter: 'blur(16px) saturate(120%)',
 // border removed (rule 2)
 borderRadius: 12,
 boxShadow: '0 4px 18px rgba(15,23,42,0.10), 0 1px 3px rgba(15,23,42,0.06)',
 cursor: 'pointer',
 touchAction: 'none',
 overflow: 'hidden',
 }}
 >
 <svg width={DC_MINIMAP_W} height={DC_MINIMAP_H} style={{ display: 'block' }} aria-hidden="true">
 {cards.map((c, i) => (
 <rect
 key={i}
 x={toMapX(c.x)}
 y={toMapY(c.y)}
 width={Math.max(2, c.w * s)}
 height={Math.max(2, c.h * s)}
 rx={2}
 fill="rgba(60,50,40,0.14)"
 stroke="rgba(60,50,40,0.22)"
 strokeWidth="0.75"
 />
 ))}
 {/* Viewport rectangle — what's currently on screen. */}
 <rect
 x={vmX}
 y={vmY}
 width={Math.max(4, vmW)}
 height={Math.max(4, vmH)}
 rx={2}
 fill="rgba(184,91,51,0.12)"
 stroke="#B85B33"
 strokeWidth="1.25"
 />
 </svg>
 </div>
 );
}

// ─────────────────────────────────────────────────────────────
// DCSection — editable title + h-row of artboards in persisted order
//
// Nested groups: a section may carry a `depth` (0 = a page's
// top-level group, 1+ = a group nested that many folders deep). Depth is
// purely a visual treatment — the section is still a direct `DCSection` child
// of `DesignCanvas`, so focus mode, drag-reorder, and the per-section
// download keep working unchanged. A depth>0 section is rendered as a
// *contained* nested section: indented from the canvas edge, drawn with a
// progressively lighter/tighter frame and an accent depth rail, and titled
// with a small "in <parent>" eyebrow so the folder nesting is legible. The
// optional `kicker` is that eyebrow text (the parent group's name).
// ─────────────────────────────────────────────────────────────
/**
 * Distinct, light card backgrounds per nesting depth, so a sub-group reads as a
 * clearly different level from its parent at a glance: depth 0 (a page's own
 * section / a top-level group) is a warm white that lifts off the linen canvas,
 * and each deeper level steps to a progressively warmer sand. Clamped at the
 * deepest tier. A folder's cascade `presentation.background` overrides this.
 *
 * @param {number} depth
 * @returns {string} A CSS color.
 */
export function sectionDepthBg(depth) {
 const steps = ['#fdfcfa', '#f6f1e9', '#efe7da', '#e8decc'];
 return steps[Math.min(Math.max(depth | 0, 0), steps.length - 1)];
}

export function DCSection({ id, title, subtitle, children, gap = 48, depth = 0, sectionStyle, bare = false, onSelectScope }) {
 const ctx = React.useContext(DCCtx);
 const sid = id ?? title;
 const all = React.Children.toArray(children);
 const artboards = all.filter((c) => c && c.type === DCArtboard);
 const rest = all.filter((c) => !(c && c.type === DCArtboard));
 const srcOrder = artboards.map((a) => a.props.id ?? a.props.label);
 const sec = (ctx && sid && ctx.section(sid)) || {};

 const order = React.useMemo(() => {
 const kept = (sec.order || []).filter((k) => srcOrder.includes(k));
 return [...kept, ...srcOrder.filter((k) => !kept.includes(k))];
 }, [sec.order, srcOrder.join('|')]);

 const byId = Object.fromEntries(artboards.map((a) => [a.props.id ?? a.props.label, a]));

 // Visual nesting. A *sub-group* (a group inside a group, depth >= 2) renders
 // CONTAINED inside its parent group's frame: a dashed, progressively warmer
 // card (`sectionDepthBg`) with an accent depth rail and an "in <parent>"
 // eyebrow, hugging inside the parent's padding. Top-level cards — the page's
 // own section (depth 0) and a top-level group (depth 1) — render as separate
 // cards on the canvas with generous margins and a solid frame. A cascade
 // `presentation.background` (via `sectionStyle`) overrides the depth default.
 const nested = depth >= 2;
 const cascadeBg = sectionStyle && sectionStyle.backgroundColor;
 const cascadeColor = sectionStyle && sectionStyle.color;
 const frameBg = cascadeBg || sectionDepthBg(depth);
 const hasArtboards = order.length > 0;

 // Top-level groups (depth <= 1) can be dragged to reorder. The grip lives in
 // the section header; the drag reads the current top-level order from the DOM,
 // tracks the pointer, and commits a new order on drop (persisted per page).
 const canReorder = !!(ctx && ctx.canReorderSections && depth <= 1 && !bare);
 const onSectionGripDown = (e) => {
 if (!ctx || typeof ctx.reorderSections !== 'function') return;
 e.preventDefault();
 e.stopPropagation();
 const myEl = e.currentTarget.closest('[data-dc-section]');
 if (!myEl) return;
 const topEls = Array.from(
 document.querySelectorAll('[data-dc-section-depth="0"],[data-dc-section-depth="1"]'),
 );
 const order2 = topEls.map((el) => el.getAttribute('data-dc-section'));
 if (order2.length < 2) return;
 const scale = myEl.getBoundingClientRect().height / myEl.offsetHeight || 1;
 const startY = e.clientY;
 const startIndex = order2.indexOf(sid);
 let targetIndex = startIndex;
 myEl.style.opacity = '0.65';
 myEl.style.zIndex = '20';
 const grip = e.currentTarget;
 try { grip.setPointerCapture(e.pointerId); } catch (_) {}
 const move = (ev) => {
 myEl.style.transform = `translateY(${(ev.clientY - startY) / scale}px)`;
 const others = order2.filter((id) => id !== sid);
 let idx = 0;
 for (const id of others) {
 const el = document.querySelector(`[data-dc-section="${id}"]`);
 if (!el) continue;
 const r = el.getBoundingClientRect();
 if (ev.clientY > r.top + r.height / 2) idx++;
 else break;
 }
 targetIndex = idx;
 };
 const up = (ev) => {
 document.removeEventListener('pointermove', move);
 document.removeEventListener('pointerup', up);
 try { grip.releasePointerCapture(ev.pointerId); } catch (_) {}
 myEl.style.opacity = '';
 myEl.style.transform = '';
 myEl.style.zIndex = '';
 if (targetIndex !== startIndex) {
 const next = order2.filter((id) => id !== sid);
 next.splice(targetIndex, 0, sid);
 ctx.reorderSections(next);
 }
 };
 document.addEventListener('pointermove', move);
 document.addEventListener('pointerup', up);
 };

 // Epic 8 / Story 8.2 — emit the AI selection scope for the dock cluster's
 // chip when this section is clicked. `onClickCapture` runs before the inner
 // artboard / kebab / focus handlers but never calls preventDefault, so it is
 // purely additive: existing pan / drag / focus / export behavior is untouched.
 // Clicks that originate from an interactive control (button / input / link /
 // editable label / reorder grip) are ignored so a download / rename / focus
 // gesture does not also re-scope the AI input.
 //
 // ELEMENT PINPOINT: when the click lands on a small, text-bearing node
 // INSIDE the rendered artboard (not the frame label row), the clicked
 // element's text + tag ride along as a hint — the chip shows it and the AI
 // planner targets the request at that element ("change THIS price"). A
 // click on the card background / a large container carries no hint (the
 // scope is then the whole asset), so the behavior degrades cleanly.
 //
 // ARTBOARD PINPOINT: the click also resolves WHICH artboard it landed in
 // (the enclosing frame's data-dc-asset-path, stamped by DCArtboardFrame).
 // Without it, multi-asset sections could only ever page-scope — the user's
 // "I selected THIS asset" click silently degraded to "kit page" and the AI
 // lost the target (live user-testing finding, 2026-06-12).
 const onSectionClickCapture = (e) => {
 if (typeof onSelectScope !== 'function') return;
 const t = e.target;
 if (t && typeof t.closest === 'function') {
 if (
 t.closest('button, a, input, textarea, select, [contenteditable="true"], [data-dc-grip]')
 ) {
 return;
 }
 }
 let element = null;
 let assetPath = null;
 if (t && typeof t.closest === 'function') {
 assetPath = t.closest('[data-dc-asset-path]')?.getAttribute('data-dc-asset-path') || null;
 if (!t.closest('.dc-labelrow')) {
 const text = String(t.textContent ?? '').replace(/\s+/g, ' ').trim();
 // Leaf-ish, human-pointable nodes only: short text, no element children
 // with their own text walls. 120 chars separates "a headline / a price"
 // from "the whole card".
 if (text && text.length <= 120) {
 element = {
 text: text.slice(0, 80),
 tag: String(t.tagName ?? '').toLowerCase() || undefined,
 };
 }
 }
 }
 onSelectScope(element, assetPath);
 };

 // The container's name tag (page or group) — see .dc-section-tag CSS.
 const kind = bare ? 'page' : 'group';
 const tag = (
 <div className="dc-section-tag" data-dc-kind={kind} style={bare ? undefined : { background: frameBg }}>
 {canReorder && (
 <button
 type="button"
 className="dc-section-grip"
 onPointerDown={onSectionGripDown}
 title="Drag to reorder"
 aria-label={`Reorder ${kind} ${title}`}
 style={{ border: 'none', background: 'transparent', padding: '4px 2px', borderRadius: 4, cursor: 'grab', color: 'rgba(60,50,40,0.4)', lineHeight: 0, touchAction: 'none' }}
 >
 <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor" aria-hidden="true">
 <circle cx="2" cy="2" r="1.1" /><circle cx="7" cy="2" r="1.1" />
 <circle cx="2" cy="6.5" r="1.1" /><circle cx="7" cy="6.5" r="1.1" />
 <circle cx="2" cy="11" r="1.1" /><circle cx="7" cy="11" r="1.1" />
 </svg>
 </button>
 )}
 <span className="dc-section-tag-icon" title={bare ? 'Page' : 'Group'}>{KIND_ICONS[kind]}</span>
 {/* The name IS the folder name: editing it renames the folder on disk
 (the watcher then re-renders everything — tag, dock, page picker). No
 display-only override, so what you see always matches the project. */}
 <DCEditable tag="span" value={title} onChange={(v, el) => renameSectionFolder(sid, v, el, title)} />
 <span className="dc-section-tag-meta">{bare ? 'Page' : `Group${subtitle ? ` · ${subtitle}` : ''}`}</span>
 {/* SectionKebab portals the ⋮ here — next to the name it acts on. */}
 <span className="dc-section-tag-slot" />
 </div>
 );

 // Bare variant — a page's own loose assets sit directly on the canvas with no
 // card chrome (no frame, no header, no in-card add bar), so they read as "on
 // the page", not "in a group". Kept measurable (data-dc-section + depth) so
 // bounds / minimap / reorder still see it; the per-artboard frames render
 // exactly as inside a card.
 if (bare) {
 return (
 <div
 data-dc-section={sid}
 data-dc-section-depth={depth}
 data-dc-section-bare="true"
 data-tour="section"
 onClickCapture={onSectionClickCapture}
 style={{
 // Vertical rhythm: every top-level block gets the same top margin (room
 // for its name tag + air) and no bottom margin, so gaps never collapse.
 margin: `${DC_PAGE_GAP}px 60px 0 60px`,
 position: 'relative',
 width: 'max-content',
 // No panel: a page's own assets sit directly on the canvas (only groups
 // get a box). The page's presentation.background paints the whole canvas
 // instead — see ProjectCanvas → DesignCanvas `style`.
 ...(cascadeColor ? { color: cascadeColor } : null),
 }}
 >
 {tag}
 {hasArtboards && (
 <div style={{ display: 'flex', gap, paddingTop: 44, alignItems: 'flex-start', width: 'max-content' }}>
 {order.map((k) => (
 <DCArtboardFrame key={k} sectionId={sid} sectionTitle={title} artboard={byId[k]} order={order}
 label={(sec.labels || {})[k] ?? byId[k].props.label}
 onRename={(v) => ctx && ctx.patchSection(sid, (x) => ({ labels: { ...x.labels, [k]: v } }))}
 onReorder={(next) => ctx && ctx.reorderSlots(sid, next)}
 onFocus={() => ctx && ctx.setFocus(`${sid}/${k}`)} />
 ))}
 </div>
 )}
 {rest}
 </div>
 );
 }

 return (
 <div
 data-dc-section={sid}
 data-dc-section-depth={depth}
 data-tour="section"
 onClickCapture={onSectionClickCapture}
 style={{
 // Top-level cards breathe on the canvas; a nested sub-group hugs inside
 // its parent's frame (the small left inset leaves room for the depth
 // rail at left:-16).
 // Top margin leaves room for the name tag above the frame.
 margin: nested ? '64px 0 8px 12px' : `${DC_BLOCK_GAP}px 60px 0 60px`,
 position: 'relative',
 width: 'max-content',
 }}
 >
 {tag}
 {/* Depth rail — a sienna accent bar on a nested sub-group's left edge.
 Reinforces "this card sits inside the card above" beyond the frame
 alone. Absent on top-level cards (depth <= 1). */}
 {nested && (
 <div
 aria-hidden="true"
 style={{
 position: 'absolute',
 left: -16,
 top: 6,
 bottom: 6,
 width: 3,
 borderRadius: 999,
 background: 'var(--lm-accent-border, rgba(184,91,51,0.20))',
 }}
 />
 )}
 {/* Group frame — rounded rectangle around title + artboards + any nested
 sub-groups. Subtle so it reads as scaffolding, not chrome. Padding-top
 on the artboard row fits the absolutely-positioned artboard labels
 (~36px) so they stay inside the border. A nested sub-group gets a
 lighter dashed frame so the containment hierarchy is legible. */}
 <div className="dc-group-frame" style={{
 // Outline comes from .dc-group-frame (constant 1px on screen at any zoom).
 // Square top-left corner: the folder tab's straight left edge continues
 // straight down the frame (a rounded corner leaves a notch at the join).
 borderRadius: '0 16px 16px 16px',
 padding: nested ? '18px 22px 22px' : '24px 32px 32px',
 background: frameBg,
 color: cascadeColor || undefined,
 }}>

 {hasArtboards && (
 <div style={{ display: 'flex', gap, paddingTop: 36, alignItems: 'flex-start', width: 'max-content' }}>
 {order.map((k) => (
 <DCArtboardFrame key={k} sectionId={sid} sectionTitle={title} artboard={byId[k]} order={order}
 label={(sec.labels || {})[k] ?? byId[k].props.label}
 onRename={(v) => ctx && ctx.patchSection(sid, (x) => ({ labels: { ...x.labels, [k]: v } }))}
 onReorder={(next) => ctx && ctx.reorderSlots(sid, next)}
 onFocus={() => ctx && ctx.setFocus(`${sid}/${k}`)} />
 ))}
 </div>
 )}
 {/* Non-artboard children — nested sub-group cards and the in-canvas add
 bar — render INSIDE the frame, after the artboard row, so a sub-group
 is visually contained by its parent (true nesting). */}
 {rest}
 </div>
 </div>
 );
}

// DCArtboard — marker; rendered by DCArtboardFrame via DCSection.
export function DCArtboard() { return null; }

function DCArtboardFrame({ sectionId, sectionTitle, artboard, label, order, onRename, onReorder, onFocus }) {
 const { id: rawId, label: rawLabel, width = 260, height = 480, children, style = {},
 // Per-artboard export wiring props
 assetName, variantName, isError, hasLiveRefresh, isMarkdown, assetPath } = artboard.props;
 const id = rawId ?? rawLabel;
 const ref = React.useRef(null);
 const cardRef = React.useRef(null);
 const [busy, setBusy] = React.useState(null); // 'png' | 'jpg' | null
 // Inline capture-failure message ('png' | 'jpg' | null)
 const [captureError, setCaptureError] = React.useState(null);
 // Unembedded-fonts notice — list of family names, shown briefly
 const [fontNotice, setFontNotice] = React.useState(null); // string[] | null
 // Clear error after a few seconds
 React.useEffect(() => {
 if (!captureError) return;
 const t = setTimeout(() => setCaptureError(null), 4000);
 return () => clearTimeout(t);
 }, [captureError]);
 React.useEffect(() => {
 if (!fontNotice) return;
 const t = setTimeout(() => setFontNotice(null), 6000);
 return () => clearTimeout(t);
 }, [fontNotice]);

 const download = async (fmt) => {
 if (!cardRef.current || busy) return;
 // Error-state disabling: no capture attempted when the artboard is in error.
 if (isError) return;
 setBusy(fmt);
 setCaptureError(null);
 try {
 const result = fmt === 'pdf'
 ? await exportArtboardPdf({ assetPath, assetName, variantName })
 : await exportArtboard(cardRef.current, { format: fmt, assetName, variantName });
 if (!result.ok) {
 // Capture failed — surface calm inline message, no file download.
 setCaptureError(fmt);
 } else if (result.unembeddedFonts && result.unembeddedFonts.length > 0) {
 setFontNotice(result.unembeddedFonts);
 }
 } catch (err) {
 // Defensive: exportArtboard is designed not to throw, but guard anyway.
 console.error('Download failed', err);
 setCaptureError(fmt);
 } finally {
 setBusy(null);
 }
 };

 // Live drag-reorder: dragged card sticks to cursor; siblings slide into
 // their would-be slots in real time via transforms. DOM order only
 // changes on drop.
 const onGripDown = (e) => {
 e.preventDefault(); e.stopPropagation();
 const me = ref.current;
 // translateX is applied in local (pre-scale) space but pointer deltas and
 // getBoundingClientRect().left are screen-space — divide by the viewport's
 // current scale so the dragged card tracks the cursor at any zoom level.
 const scale = me.getBoundingClientRect().width / me.offsetWidth || 1;
 // Direct slots only — a nested sub-group's artboards are NOT reorder peers
 // of this section (they live in their own section frame).
 const peers = dcDirectSlots(sectionId);
 const homes = peers.map((el) => ({ el, id: el.dataset.dcSlot, x: el.getBoundingClientRect().left }));
 const slotXs = homes.map((h) => h.x);
 const startIdx = order.indexOf(id);
 const startX = e.clientX;
 const startY = e.clientY;
 let liveOrder = order.slice();
 // Cross-group move: while the cursor is over ANOTHER group's frame, that
 // group is the drop target and dropping moves the file there (same
 // companion-aware move as the kebab's "Move to…").
 let dropTarget = null;
 const setDropTarget = (el) => {
 if (el === dropTarget) return;
 dropTarget?.classList.remove('dc-drop-target');
 dropTarget = el;
 dropTarget?.classList.add('dc-drop-target');
 };
 me.classList.add('dc-dragging');

 const layout = () => {
 for (const h of homes) {
 if (h.id === id) continue;
 const slot = liveOrder.indexOf(h.id);
 h.el.style.transform = `translateX(${(slotXs[slot] - h.x) / scale}px)`;
 }
 };

 const move = (ev) => {
 const dx = ev.clientX - startX;
 const dy = ev.clientY - startY;
 me.style.transform = `translate(${dx / scale}px, ${dy / scale}px)`;
 if (assetPath) {
 const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-dc-section]');
 const foreign = over && over.getAttribute('data-dc-section') !== String(sectionId) && !me.contains(over);
 setDropTarget(foreign ? over : null);
 if (foreign) {
 // Park the home group's peers in their original slots while away.
 if (liveOrder.join('|') !== order.join('|')) { liveOrder = order.slice(); layout(); }
 return;
 }
 }
 const cur = homes[startIdx].x + dx;
 let nearest = 0, best = Infinity;
 for (let i = 0; i < slotXs.length; i++) {
 const d = Math.abs(slotXs[i] - cur);
 if (d < best) { best = d; nearest = i; }
 }
 if (liveOrder.indexOf(id) !== nearest) {
 liveOrder = order.filter((k) => k !== id);
 liveOrder.splice(nearest, 0, id);
 layout();
 }
 };

 const up = () => {
 document.removeEventListener('pointermove', move);
 document.removeEventListener('pointerup', up);
 if (dropTarget) {
 const toFolder = dropTarget.getAttribute('data-dc-section');
 const toName = toFolder.split('/').pop();
 setDropTarget(null);
 me.classList.remove('dc-dragging');
 for (const h of homes) h.el.style.transform = '';
 me.style.transform = '';
 // The watcher re-renders the canvas with the file in its new group.
 moveEntry(assetPath, toFolder).then((res) => {
 dcToast(res.ok ? `Moved to ${toName}` : `Couldn’t move: ${res.error || 'unknown error'}`);
 });
 return;
 }
 const finalSlot = liveOrder.indexOf(id);
 me.classList.remove('dc-dragging');
 me.style.transform = `translateX(${(slotXs[finalSlot] - homes[startIdx].x) / scale}px)`;
 // After the settle transition, kill transitions + clear transforms +
 // commit the reorder in the same frame so there's no visual snap-back.
 setTimeout(() => {
 for (const h of homes) { h.el.style.transition = 'none'; h.el.style.transform = ''; }
 if (liveOrder.join('|') !== order.join('|')) onReorder(liveOrder);
 requestAnimationFrame(() => requestAnimationFrame(() => {
 for (const h of homes) h.el.style.transition = '';
 }));
 }, 180);
 };
 document.addEventListener('pointermove', move);
 document.addEventListener('pointerup', up);
 };

 return (
 <div ref={ref} data-dc-slot={id} data-dc-label={label || rawLabel || id} data-dc-section-title={sectionTitle || ''} data-dc-w={width} data-dc-h={height} {...(assetPath ? { 'data-dc-asset-path': assetPath } : {})} style={{ position: 'relative', flexShrink: 0, '--dc-w': `${width}px` }}>
 {/* Labelrow stretches the full card width so the portaled kebab
 (artboard-kebab.jsx) can right-align inside it via margin-left:auto.
 The right-edge button cluster (ANIM/JPG/PNG/expand/kebab) is rendered
 as absolutely-positioned siblings below — they overlay the labelrow's
 right side but with explicit `right:N` offsets that step left from 0. */}
 <div className="dc-labelrow" style={{ position: 'absolute', bottom: '100%', left: -4, right: -4, marginBottom: 'calc(4px * var(--dc-inv, 1))', color: DC.label }}>
 <div className="dc-label-left">
 <button
 className="dc-grip"
 onPointerDown={onGripDown}
 onKeyDown={(e) => {
 // Keyboard rearrange: ← moves left (−1), → moves right (+1)
 if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
 e.preventDefault();
 const cur = order.indexOf(id);
 const next = order.slice();
 const dir = e.key === 'ArrowLeft' ? -1 : 1;
 const to = Math.max(0, Math.min(next.length - 1, cur + dir));
 if (to !== cur) {
 next.splice(cur, 1);
 next.splice(to, 0, id);
 onReorder(next);
 }
 }
 }}
 title="Drag to reorder; ←/→ to move"
 aria-label={`Reorder ${label || id}; use arrow keys to move left or right`}
 style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 0 }}
 >
 <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="7" cy="2" r="1.1"/><circle cx="2" cy="6.5" r="1.1"/><circle cx="7" cy="6.5" r="1.1"/><circle cx="2" cy="11" r="1.1"/><circle cx="7" cy="11" r="1.1"/></svg>
 </button>
 <div className="dc-labeltext" onClick={onFocus} title="Click to focus">
 <DCEditable value={label} onChange={onRename} onClick={(e) => e.stopPropagation()}
 style={{ fontSize: 13, fontWeight: 500, color: DC.label, lineHeight: 1.3 }} />
 </div>
 </div>
 </div>
 <button className="dc-expand" onClick={onFocus} onPointerDown={(e) => e.stopPropagation()} title="Open in focus view" aria-label={`Open ${label || id} in focus view`}>
 <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 1h4v4M5 11H1V7M11 1L7.5 4.5M1 11l3.5-3.5"/></svg>
 </button>
 {/* Per-artboard export buttons.
 When the artboard is in an error state (isError), the buttons are
 shown disabled-with-reason so the user understands why (AC: "shown
 disabled-with-reason, and no capture is attempted"). */}
 <button
 className="dc-dl dc-dl-png"
 onClick={() => download('png')}
 onPointerDown={(e) => e.stopPropagation()}
 disabled={!!busy || isError}
 data-dc-error-disabled={isError ? 'true' : undefined}
 title={isError ? "Can't export — this artboard has an error" : captureError === 'png' ? 'Capture failed — try again' : 'Download as PNG'}
 aria-label={isError ? "Can't export — this artboard has an error" : 'Download as PNG'}
 >{busy === 'png' ? '…' : 'PNG'}</button>
 <button
 className="dc-dl dc-dl-jpg"
 onClick={() => download('jpg')}
 onPointerDown={(e) => e.stopPropagation()}
 disabled={!!busy || isError}
 data-dc-error-disabled={isError ? 'true' : undefined}
 title={isError ? "Can't export — this artboard has an error" : captureError === 'jpg' ? 'Capture failed — try again' : 'Download as JPG'}
 aria-label={isError ? "Can't export — this artboard has an error" : 'Download as JPG'}
 >{busy === 'jpg' ? '…' : 'JPG'}</button>
 {/* Animated export button — only shown when this artboard's container
 has a `liveRefresh` entry for it. Click dispatches a per-slot event;
 the kebab (ComponentArtboardKebab) listens and opens the
 AnimatedExportDialog it already mounts. Same visual treatment as PNG/JPG. */}
 {hasLiveRefresh ? (
 <button
 className="dc-dl dc-dl-animated"
 onClick={() => {
 if (typeof window !== 'undefined') {
 window.dispatchEvent(new CustomEvent('lerret:openAnimatedDialog', { detail: { slotId: id } }));
 }
 }}
 onPointerDown={(e) => e.stopPropagation()}
 disabled={!!busy || isError}
 data-dc-error-disabled={isError ? 'true' : undefined}
 title={isError ? "Can't export — this artboard has an error" : 'Export as animated (WebP / GIF / APNG / MP4)'}
 aria-label={isError ? "Can't export — this artboard has an error" : 'Export as animated'}
 >ANIM</button>
 ) : null}
 {/* PDF export — markdown only. A document wants a PDF; component artboards
 keep PNG/JPG. One-click raster: the bitmap on a page sized to the card. */}
 {isMarkdown ? (
 <button
 className="dc-dl dc-dl-pdf"
 onClick={() => download('pdf')}
 onPointerDown={(e) => e.stopPropagation()}
 disabled={!!busy || isError}
 data-dc-error-disabled={isError ? 'true' : undefined}
 title={isError ? "Can't export — this artboard has an error" : captureError === 'pdf' ? 'Export failed — try again' : 'Download as PDF'}
 aria-label={isError ? "Can't export — this artboard has an error" : 'Download as PDF'}
 >{busy === 'pdf' ? '…' : 'PDF'}</button>
 ) : null}
 {/* Edit — markdown only. The primary action for a document, promoted out of
 the kebab into the always-on-hover cluster. Dispatches a per-slot event the
 markdown kebab listens for to open its editor sheet. */}
 {isMarkdown ? (
 <button
 className="dc-dl dc-dl-edit"
 onClick={() => {
 if (typeof window !== 'undefined') {
 window.dispatchEvent(new CustomEvent('lerret:openMarkdownEditor', { detail: { slotId: id } }));
 }
 }}
 onPointerDown={(e) => e.stopPropagation()}
 title="Edit Markdown"
 aria-label={`Edit ${label || id}`}
 >Edit</button>
 ) : null}
 <div ref={cardRef} className="dc-card"
 style={{ borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06)', overflow: 'hidden', width, height, background: 'var(--lm-bg-primary, #FDFCFA)', ...style }}>
 {children || <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13, fontFamily: DC.font }}>{id}</div>}
 </div>
 {/* Calm inline capture-failure message — overlaid on the slot
 (outside the overflow:hidden card) so the canvas is otherwise undisturbed
 (AC: "calm inline message on the artboard rather than an uncaught crash"). */}
 {captureError && (
 <div role="alert" aria-live="polite" style={{
 position: 'absolute', bottom: 8, left: 8, right: 8,
 background: 'rgba(168,50,40,.88)', color: '#fff',
 borderRadius: 5, padding: '6px 10px',
 font: '500 11px/1.4 ' + DC.font,
 pointerEvents: 'none', zIndex: 5,
 }}>
 Export failed. Check the console for details.
 </div>
 )}
 {/* Unembedded-fonts notice — non-blocking, calm, auto-dismisses
 after 6 s. Consistent with the studio's honest-degradation pattern. */}
 {fontNotice && fontNotice.length > 0 && (
 <div role="status" aria-live="polite" style={{
 position: 'absolute', bottom: captureError ? 48 : 8, left: 8, right: 8,
 background: 'rgba(40,35,25,.82)', color: 'rgba(255,235,180,.95)',
 borderRadius: 5, padding: '6px 10px',
 font: '500 11px/1.4 ' + DC.font,
 pointerEvents: 'none', zIndex: 5,
 }}>
 Fonts not embedded: {fontNotice.join(', ')}
 </div>
 )}
 </div>
 );
}

// Inline rename — commits on blur or Enter.
function DCEditable({ value, onChange, style, tag = 'span', onClick }) {
 const T = tag;
 return (
 <T className="dc-editable" contentEditable suppressContentEditableWarning
 onClick={onClick}
 onPointerDown={(e) => e.stopPropagation()}
 onBlur={(e) => onChange && onChange(e.currentTarget.textContent, e.currentTarget)}
 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
 style={style}>{value}</T>
 );
}

// ─────────────────────────────────────────────────────────────
// Focus mode — overlay one artboard; ←/→ within section, ↑/↓ across
// sections, Esc or backdrop click to exit.
//
// Hardenings (NFR14):
// • Focus trap — Tab/Shift+Tab cycle is confined to the overlay.
// • Auto-focus — on mount, the close button receives focus so keyboard
// users are immediately inside the dialog.
// • Focus restore — on unmount, focus returns to whatever held it before
// the overlay opened (the expand button that triggered it, typically).
// • role="dialog" + aria-label for screen-reader context.
// ─────────────────────────────────────────────────────────────
const FOCUSABLE_SELECTORS =
 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function DCFocusOverlay({ entry, sectionMeta, sectionOrder }) {
 const ctx = React.useContext(DCCtx);
 const { sectionId, artboard } = entry;
 const sec = ctx.section(sectionId);
 const meta = sectionMeta[sectionId];
 const peers = meta.slotIds;
 const aid = artboard.props.id ?? artboard.props.label;
 const idx = peers.indexOf(aid);
 const secIdx = sectionOrder.indexOf(sectionId);

 const overlayRef = React.useRef(null);
 const closeRef = React.useRef(null);

 const go = (d) => { const n = peers[(idx + d + peers.length) % peers.length]; if (n) ctx.setFocus(`${sectionId}/${n}`); };
 const goSection = (d) => {
 const ns = sectionOrder[(secIdx + d + sectionOrder.length) % sectionOrder.length];
 const first = sectionMeta[ns] && sectionMeta[ns].slotIds[0];
 if (first) ctx.setFocus(`${ns}/${first}`);
 };

 // Auto-focus the close button on mount; restore the previously-focused
 // element on unmount so keyboard users land back where they started.
 React.useEffect(() => {
 const prev = document.activeElement;
 // Defer by one frame so the portal has painted and closeRef is mounted.
 const t = requestAnimationFrame(() => {
 if (closeRef.current) closeRef.current.focus();
 });
 return () => {
 cancelAnimationFrame(t);
 // Return focus to the element that was focused before the overlay opened
 // (the expand button that triggered it, typically).
 if (prev && typeof prev.focus === 'function') prev.focus();
 };
 }, []);

 // Keyboard handler: arrow navigation + focus trap (Tab/Shift+Tab).
 React.useEffect(() => {
 const k = (e) => {
 if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
 if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
 if (e.key === 'ArrowUp') { e.preventDefault(); goSection(-1); }
 if (e.key === 'ArrowDown') { e.preventDefault(); goSection(1); }
 if (e.key === 'Tab') {
 // Focus trap: collect all focusable nodes inside the overlay and
 // manually advance/retreat the cycle, wrapping at both ends.
 const el = overlayRef.current;
 if (!el) return;
 const focusable = Array.from(el.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
 (n) => !n.closest('[inert]') && n.offsetParent !== null
 );
 if (focusable.length === 0) { e.preventDefault(); return; }
 const cur = document.activeElement;
 const ci = focusable.indexOf(cur);
 if (e.shiftKey) {
 e.preventDefault();
 const prev = ci <= 0 ? focusable[focusable.length - 1] : focusable[ci - 1];
 prev.focus();
 } else {
 e.preventDefault();
 const next = ci >= focusable.length - 1 ? focusable[0] : focusable[ci + 1];
 next.focus();
 }
 }
 };
 document.addEventListener('keydown', k);
 return () => document.removeEventListener('keydown', k);
 });

 const { width = 260, height = 480, children, isMarkdown } = artboard.props;
 const [vp, setVp] = React.useState({ w: window.innerWidth, h: window.innerHeight });
 React.useEffect(() => { const r = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
 // A Markdown asset is a document (auto-height), not a fixed-dimension
 // artboard: it reads top-to-bottom, so focus view presents it as a
 // scrollable page (below) rather than scaling a fixed box to fit. `scale`
 // is only meaningful for a component artboard — for a `height: 'auto'`
 // markdown card the fit math would be NaN.
 const scale = isMarkdown
 ? 1
 : Math.max(0.1, Math.min((vp.w - 200) / width, (vp.h - 260) / height, 2));

 const [ddOpen, setDd] = React.useState(false);
 const Arrow = ({ dir, onClick, label: ariaLabel }) => (
 <button
 onClick={(e) => { e.stopPropagation(); onClick(); }}
 aria-label={ariaLabel}
 style={{ position: 'absolute', top: '50%', [dir]: 28, transform: 'translateY(-50%)',
 border: 'none', background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.9)',
 width: 44, height: 44, borderRadius: 22, fontSize: 18, cursor: 'pointer',
 display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background .15s' }}
 onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.18)')}
 onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.08)')}>
 <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
 <path d={dir === 'left' ? 'M11 3L5 9l6 6' : 'M7 3l6 6-6 6'} /></svg>
 </button>
 );

 // Portal to body so position:fixed is the real viewport regardless of any
 // transform on DesignCanvas's ancestors (including the canvas zoom itself).
 return ReactDOM.createPortal(
 <div
 ref={overlayRef}
 role="dialog"
 aria-modal="true"
 aria-label={`Focus view: ${(sec.labels || {})[aid] ?? artboard.props.label}`}
 className="dc-focus-overlay"
 onClick={() => ctx.setFocus(null)}
 onWheel={(e) => e.preventDefault()}
 style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(24,20,16,.6)', backdropFilter: 'blur(14px)',
 fontFamily: DC.font, color: '#fff' }}>

 {/* top bar: section dropdown (left) · close (right) */}
 <div onClick={(e) => e.stopPropagation()}
 style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, display: 'flex', alignItems: 'flex-start', padding: '16px 20px 0', gap: 16 }}>
 <div style={{ position: 'relative' }}>
 <button onClick={() => setDd((o) => !o)}
 aria-haspopup="listbox"
 aria-expanded={ddOpen}
 style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', padding: '6px 8px',
 borderRadius: 6, textAlign: 'left', fontFamily: 'inherit' }}>
 <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
 <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>{meta.title}</span>
 <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ opacity: .7 }}><path d="M2 4l3.5 3.5L9 4"/></svg>
 </span>
 {meta.subtitle && <span style={{ display: 'block', fontSize: 13, opacity: .6, fontWeight: 400, marginTop: 2 }}>{meta.subtitle}</span>}
 </button>
 {ddOpen && (
 <div role="listbox" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#2a251f', borderRadius: 8,
 boxShadow: '0 8px 32px rgba(0,0,0,.4)', padding: 4, minWidth: 200, zIndex: 10 }}>
 {sectionOrder.map((sid) => (
 <button key={sid} role="option" aria-selected={sid === sectionId}
 onClick={() => { setDd(false); const f = sectionMeta[sid].slotIds[0]; if (f) ctx.setFocus(`${sid}/${f}`); }}
 style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
 background: sid === sectionId ? 'rgba(255,255,255,.1)' : 'transparent', color: '#fff',
 padding: '8px 12px', borderRadius: 5, fontSize: 14, fontWeight: sid === sectionId ? 600 : 400, fontFamily: 'inherit' }}>
 {sectionMeta[sid].title}
 </button>
 ))}
 </div>
 )}
 </div>
 <div style={{ flex: 1 }} />
 <button
 ref={closeRef}
 onClick={() => ctx.setFocus(null)}
 aria-label="Close focus view"
 onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.12)')}
 onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
 style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,.7)', width: 32, height: 32,
 borderRadius: 16, fontSize: 20, cursor: 'pointer', lineHeight: 1, transition: 'background .12s' }}>×</button>
 </div>

 {/* card centered, label + index below — only the card itself stops
 propagation so any backdrop click (including the margins around
 the card) exits focus */}
 {isMarkdown ? (
 // Document focus view — a readable page that fills the available height
 // and scrolls when the content runs longer than the viewport (which also
 // makes focus view usable on short screens).
 <div
 style={{ position: 'absolute', top: 64, bottom: 56, left: 100, right: 100, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
 <div
 onClick={(e) => e.stopPropagation()}
 onWheel={(e) => e.stopPropagation()}
 style={{ flex: '1 1 auto', minHeight: 0, width: '100%', maxWidth: 720, overflowY: 'auto' }}>
 <div style={{ borderRadius: 'var(--lm-radius-lg, 12px)', boxShadow: '0 20px 80px rgba(0,0,0,.4)' }}>
 {children}
 </div>
 </div>
 <div onClick={(e) => e.stopPropagation()} style={{ flex: 'none', marginTop: 16, fontSize: 14, fontWeight: 500, opacity: .85, textAlign: 'center' }}>
 {(sec.labels || {})[aid] ?? artboard.props.label}
 <span style={{ opacity: .5, marginLeft: 10, fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {peers.length}</span>
 </div>
 </div>
 ) : (
 <div
 style={{ position: 'absolute', top: 64, bottom: 56, left: 100, right: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
 <div onClick={(e) => e.stopPropagation()} style={{ width: width * scale, height: height * scale, position: 'relative' }}>
 <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', background: '#fff', borderRadius: 2, overflow: 'hidden',
 boxShadow: '0 20px 80px rgba(0,0,0,.4)' }}>
 {children || <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>{aid}</div>}
 </div>
 </div>
 <div onClick={(e) => e.stopPropagation()} style={{ fontSize: 14, fontWeight: 500, opacity: .85, textAlign: 'center' }}>
 {(sec.labels || {})[aid] ?? artboard.props.label}
 <span style={{ opacity: .5, marginLeft: 10, fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {peers.length}</span>
 </div>
 </div>
 )}

 <Arrow dir="left" onClick={() => go(-1)} label="Previous artboard" />
 <Arrow dir="right" onClick={() => go(1)} label="Next artboard" />

 {/* dots */}
 <div onClick={(e) => e.stopPropagation()}
 style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
 {peers.map((p, i) => (
 <button key={p} onClick={() => ctx.setFocus(`${sectionId}/${p}`)}
 aria-label={`Go to artboard ${i + 1} of ${peers.length}`}
 aria-current={i === idx ? 'true' : undefined}
 style={{ border: 'none', padding: 0, cursor: 'pointer', width: 6, height: 6, borderRadius: 3,
 background: i === idx ? '#fff' : 'rgba(255,255,255,.3)' }} />
 ))}
 </div>
 </div>,
 document.body,
 );
}

// ─────────────────────────────────────────────────────────────
// Post-it — absolute-positioned sticky note
// ─────────────────────────────────────────────────────────────
export function DCPostIt({ children, top, left, right, bottom, rotate = -2, width = 180 }) {
 return (
 <div style={{
 position: 'absolute', top, left, right, bottom, width,
 background: DC.postitBg, padding: '14px 16px',
 fontFamily: '"Comic Sans MS", "Marker Felt", "Segoe Print", cursive',
 fontSize: 14, lineHeight: 1.4, color: DC.postitText,
 boxShadow: '0 2px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
 transform: `rotate(${rotate}deg)`,
 zIndex: 5,
 }}>{children}</div>
 );
}

// DesignCanvas / DCSection / DCArtboard / DCPostIt are
// now ES-module `export`s above — the former `Object.assign(window, …)` is no
// longer needed.
