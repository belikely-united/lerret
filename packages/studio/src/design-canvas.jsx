
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
 '.dc-editable{cursor:text;outline:none;white-space:nowrap;border-radius:3px;padding:0 2px;margin:0 -2px}',
 '.dc-editable:focus{background:#fff;box-shadow:0 0 0 1.5px #c96442}',
 '[data-dc-slot]{transition:transform .18s cubic-bezier(.2,.7,.3,1)}',
 '[data-dc-slot].dc-dragging{transition:none;z-index:10;pointer-events:none}',
 '[data-dc-slot].dc-dragging .dc-card{box-shadow:0 12px 40px rgba(0,0,0,.25),0 0 0 2px #c96442;transform:scale(1.02)}',
 '.dc-card{transition:box-shadow .15s,transform .15s}',
 '.dc-card *{scrollbar-width:none}',
 '.dc-card *::-webkit-scrollbar{display:none}',
 '.dc-labelrow{display:flex;align-items:center;gap:4px;height:24px}',
 '.dc-grip{cursor:grab;display:flex;align-items:center;padding:5px 4px;border-radius:4px;transition:background .12s}',
 '.dc-grip:hover{background:rgba(0,0,0,.08)}',
 '.dc-grip:active{cursor:grabbing}',
 '.dc-grip:focus-visible{outline:2px solid #c96442;outline-offset:1px}',
 '.dc-labeltext{cursor:pointer;border-radius:4px;padding:3px 6px;display:flex;align-items:center;transition:background .12s}',
 '.dc-labeltext:hover{background:rgba(0,0,0,.05)}',
 '.dc-expand{position:absolute;bottom:100%;right:0;margin-bottom:5px;z-index:2;opacity:0;transition:opacity .12s,background .12s;',
 ' width:22px;height:22px;border-radius:5px;border:none;cursor:pointer;padding:0;',
 ' background:transparent;color:rgba(60,50,40,.7);display:flex;align-items:center;justify-content:center}',
 '.dc-expand:hover{background:rgba(0,0,0,.06);color:#2a251f}',
 '[data-dc-slot]:hover .dc-expand{opacity:1}',
 '.dc-expand:focus-visible{opacity:1;outline:2px solid #c96442;outline-offset:1px}',
 '.dc-dl{position:absolute;bottom:100%;margin-bottom:5px;z-index:2;opacity:0;transition:opacity .12s,background .12s;',
 ' height:22px;padding:0 8px;border-radius:5px;border:none;cursor:pointer;',
 ' background:rgba(255,255,255,.85);color:#2a251f;font:600 10px/1 var(--lm-font-mono,monospace);',
 ' letter-spacing:.06em;text-transform:uppercase;display:inline-flex;align-items:center;gap:4px;',
 ' box-shadow:0 1px 2px rgba(0,0,0,.06)}',
 '.dc-dl:hover{background:#fff;color:#000}',
 '.dc-dl[disabled]{opacity:.6;cursor:wait}',
 '.dc-dl[data-dc-error-disabled]{cursor:not-allowed;opacity:.45;background:rgba(200,60,60,.08);color:#a83228}',
 '[data-dc-slot]:hover .dc-dl{opacity:1}',
 '.dc-dl-png{right:30px}',
 '.dc-dl-jpg{right:74px}',
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

export function DesignCanvas({ children, minScale, maxScale, style }) {
 const [state, setState] = React.useState({ sections: {}, focus: null });
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
 setState((s) => ({ ...s, sections: next.sections }));
 })
 .catch(() => {})
 .finally(() => { didRead.current = true; if (!off) setReady(true); });
 const t = setTimeout(() => { if (!off) setReady(true); }, 150);
 return () => { off = true; clearTimeout(t); };
 }, []);

 React.useEffect(() => {
 if (!didRead.current) return;
 if (skipNextWrite.current) { skipNextWrite.current = false; return; }
 const t = setTimeout(() => {
 const payload = JSON.stringify({ sections: state.sections });
 // Always mirror to localStorage so plain-browser users get persistence.
 try { localStorage.setItem(DC_LS_KEY, payload); } catch (_) {}
 // Best-effort write back to the sidecar via the host bridge if present.
 window.omelette?.writeFile(DC_STATE_FILE, payload).catch(() => {});
 }, 250);
 return () => clearTimeout(t);
 }, [state.sections]);

 // Build registries synchronously from children so FocusOverlay can read
 // them in the same render. Only direct DCSection > DCArtboard children are
 // walked — wrapping them in other elements opts out of focus/reorder.
 const registry = {}; // slotId -> { sectionId, artboard }
 const sectionMeta = {}; // sectionId -> { title, subtitle, slotIds[] }
 const sectionOrder = [];
 React.Children.forEach(children, (sec) => {
 if (!sec || sec.type !== DCSection) return;
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
 title: persisted.title ?? sec.props.title,
 subtitle: sec.props.subtitle,
 slotIds: [...kept, ...srcIds.filter((k) => !kept.includes(k))],
 };
 });

 const api = React.useMemo(() => ({
 state,
 section: (id) => state.sections[id] || {},
 patchSection: (id, p) => setState((s) => ({
 ...s,
 sections: { ...s.sections, [id]: { ...s.sections[id], ...(typeof p === 'function' ? p(s.sections[id] || {}) : p) } },
 })),
 setFocus: (slotId) => setState((s) => ({ ...s, focus: slotId })),
 }), [state]);

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
 <DCViewport minScale={minScale} maxScale={maxScale} style={style}>{ready && children}</DCViewport>
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

// Per-section "download all in this group" buttons. Lives inside the
// section header card; scopes to slots within data-dc-section={sid}.
function DCSectionDownload({ sectionId }) {
 const [busy, setBusy] = React.useState(null);
 const [progress, setProgress] = React.useState(null);

 const download = async (fmt) => {
 if (busy) return;
 const slots = Array.from(
 document.querySelectorAll(`[data-dc-section="${sectionId}"] [data-dc-slot]`)
 );
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
 return fmt.toUpperCase();
 };

 return (
 <div style={{ display: 'inline-flex', gap: 6, alignSelf: 'flex-start' }}>
 <button
 onClick={() => download('png')}
 disabled={!!busy}
 style={sectionBtnStyle(busy === 'png')}
 title="Download every artboard in this group as PNG"
 >↓ {label('png')}</button>
 <button
 onClick={() => download('jpg')}
 disabled={!!busy}
 style={sectionBtnStyle(busy === 'jpg')}
 title="Download every artboard in this group as JPG"
 >↓ {label('jpg')}</button>
 </div>
 );
}

function sectionBtnStyle(active) {
 return {
 height: 28,
 padding: '0 12px',
 borderRadius: 6,
 border: '1px solid rgba(60,50,40,0.16)',
 background: active ? '#2a251f' : 'rgba(255,255,255,0.6)',
 color: active ? '#fff' : '#3a3530',
 font: '600 11px/1 -apple-system, BlinkMacSystemFont, sans-serif',
 letterSpacing: '0.04em',
 textTransform: 'uppercase',
 cursor: active ? 'wait' : 'pointer',
 display: 'inline-flex',
 alignItems: 'center',
 gap: 4,
 transition: 'background .12s, border-color .12s',
 };
}

function btnStyle(active) {
 return {
 height: 32,
 padding: '0 14px',
 borderRadius: 8,
 border: '1px solid rgba(15,23,42,0.12)',
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
function DCViewport({ children, minScale = 0.1, maxScale = 8, style = {} }) {
 const vpRef = React.useRef(null);
 const worldRef = React.useRef(null);
 const tf = React.useRef({ x: 0, y: 0, scale: 1 });

 const apply = React.useCallback(() => {
 const { x, y, scale } = tf.current;
 const el = worldRef.current;
 if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
 }, []);

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
 apply();
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
 apply();
 } else {
 // Plain wheel scroll — pan in both axes (deltaX is non-zero on
 // trackpads and tilt-wheels; zero on a vertical-only mouse wheel).
 tf.current.x -= e.deltaX;
 tf.current.y -= e.deltaY;
 apply();
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
 if (e.target.closest('.lm-kebab-trigger, .lm-menu-popover')) return;
 const onBg = !e.target.closest('[data-dc-slot], .dc-editable');
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
 apply();
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
 }, [apply, minScale, maxScale]);

 const gridSvg = `url("data:image/svg+xml,%3Csvg width='120' height='120' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M120 0H0v120' fill='none' stroke='${encodeURIComponent(DC.grid)}' stroke-width='1'/%3E%3C/svg%3E")`;
 return (
 <div
 ref={vpRef}
 className="design-canvas"
 data-tour="canvas"
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
 padding: '60px 0 80px',
 }}
 >
 <div style={{ position: 'absolute', inset: -6000, backgroundImage: gridSvg, backgroundSize: '120px 120px', pointerEvents: 'none', zIndex: -1 }} />
 {children}
 </div>
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
export function DCSection({ id, title, subtitle, children, gap = 48, depth = 0, kicker, sectionStyle }) {
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

 // Nested-group visual treatment. Each folder of depth indents the section
 // and lightens its frame, so a group-inside-a-group reads as contained.
 const nested = depth > 0;
 const indent = Math.min(depth, 4) * 40;
 const frameAlpha = Math.max(0.05, 0.14 - depth * 0.03);
 const fillAlpha = Math.max(0.05, 0.18 - depth * 0.05);
 const titleSize = Math.max(19, 28 - depth * 4);

 return (
 <div
 data-dc-section={sid}
 data-dc-section-depth={depth}
 data-tour="section"
 style={{
 margin: `0 60px 80px ${60 + indent}px`,
 position: 'relative',
 width: 'max-content',
 // Presentation config background. Applied to the section's
 // outer wrapper so the tinted surface extends around the frame — the
 // frame's own semi-transparent background sits atop it. This gives a
 // subtle "canvas tinted for this section" effect without overriding
 // the frame's material. `sectionStyle` comes from the cascade context
 // via `project-canvas.jsx`; it is `undefined` when no bg is set.
 ...sectionStyle,
 }}
 >
 {/* Depth rail — a sienna accent bar on a nested section's left edge.
 Reinforces "this section sits inside the one above" beyond indent
 alone. Absent at depth 0 (a page's own top-level group). */}
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
 {/* Group frame — rounded rectangle around title + artboards. Subtle so
 it reads as scaffolding, not chrome. Padding-top fits the
 absolutely-positioned artboard labels (~36px) so they stay inside
 the border. Nested sections get a lighter frame + dashed border so
 the containment hierarchy is legible. */}
 <div style={{
 border: `1px ${nested ? 'dashed' : 'solid'} rgba(60,50,40,${frameAlpha})`,
 borderRadius: 16,
 padding: nested ? '20px 28px 28px' : '24px 32px 32px',
 background: `rgba(255,255,255,${fillAlpha})`,
 }}>
 <div style={{
 display: 'flex',
 alignItems: 'flex-start',
 justifyContent: 'space-between',
 gap: 24,
 marginBottom: 56,
 }}>
 <div>
 {/* Nesting eyebrow — names the parent group so a nested section
 says where it lives without leaving the canvas. */}
 {nested && kicker && (
 <div style={{
 fontSize: 10,
 fontWeight: 600,
 letterSpacing: '0.12em',
 textTransform: 'uppercase',
 color: 'var(--lm-accent, #B85B33)',
 marginBottom: 6,
 display: 'flex',
 alignItems: 'center',
 gap: 5,
 }}>
 <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
 <path d="M1 1v4.5a2 2 0 002 2H8M5.5 5L8 7.5 5.5 10" />
 </svg>
 in {kicker}
 </div>
 )}
 <DCEditable tag="div" value={sec.title ?? title}
 onChange={(v) => ctx && sid && ctx.patchSection(sid, { title: v })}
 style={{ fontSize: titleSize, fontWeight: 600, color: DC.title, letterSpacing: -0.4, marginBottom: 6, display: 'inline-block' }} />
 {subtitle && <div style={{ fontSize: 16, color: DC.subtitle }}>{subtitle}</div>}
 </div>
 <DCSectionDownload sectionId={sid} />
 </div>
 <div style={{ display: 'flex', gap, paddingTop: 36, alignItems: 'flex-start', width: 'max-content' }}>
 {order.map((k) => (
 <DCArtboardFrame key={k} sectionId={sid} sectionTitle={sec.title ?? title} artboard={byId[k]} order={order}
 label={(sec.labels || {})[k] ?? byId[k].props.label}
 onRename={(v) => ctx && ctx.patchSection(sid, (x) => ({ labels: { ...x.labels, [k]: v } }))}
 onReorder={(next) => ctx && ctx.patchSection(sid, { order: next })}
 onFocus={() => ctx && ctx.setFocus(`${sid}/${k}`)} />
 ))}
 </div>
 </div>
 {rest}
 </div>
 );
}

// DCArtboard — marker; rendered by DCArtboardFrame via DCSection.
export function DCArtboard() { return null; }

function DCArtboardFrame({ sectionId, sectionTitle, artboard, label, order, onRename, onReorder, onFocus }) {
 const { id: rawId, label: rawLabel, width = 260, height = 480, children, style = {},
 // Per-artboard export wiring props
 assetName, variantName, isError } = artboard.props;
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
 const result = await exportArtboard(cardRef.current, {
 format: fmt,
 assetName,
 variantName,
 });
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
 const peers = Array.from(document.querySelectorAll(`[data-dc-section="${sectionId}"] [data-dc-slot]`));
 const homes = peers.map((el) => ({ el, id: el.dataset.dcSlot, x: el.getBoundingClientRect().left }));
 const slotXs = homes.map((h) => h.x);
 const startIdx = order.indexOf(id);
 const startX = e.clientX;
 let liveOrder = order.slice();
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
 me.style.transform = `translateX(${dx / scale}px)`;
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
 <div ref={ref} data-dc-slot={id} data-dc-label={label || rawLabel || id} data-dc-section-title={sectionTitle || ''} data-dc-w={width} data-dc-h={height} style={{ position: 'relative', flexShrink: 0 }}>
 <div className="dc-labelrow" style={{ position: 'absolute', bottom: '100%', left: -4, marginBottom: 4, color: DC.label }}>
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
 style={{ fontSize: 15, fontWeight: 500, color: DC.label, lineHeight: 1 }} />
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
 <div ref={cardRef} className="dc-card"
 style={{ borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,.08),0 4px 16px rgba(0,0,0,.06)', overflow: 'hidden', width, height, background: '#fff', ...style }}>
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
 onBlur={(e) => onChange && onChange(e.currentTarget.textContent)}
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

 const { width = 260, height = 480, children } = artboard.props;
 const [vp, setVp] = React.useState({ w: window.innerWidth, h: window.innerHeight });
 React.useEffect(() => { const r = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
 const scale = Math.max(0.1, Math.min((vp.w - 200) / width, (vp.h - 260) / height, 2));

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
