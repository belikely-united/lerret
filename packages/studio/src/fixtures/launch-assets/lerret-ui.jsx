// Lerret-themed marketing primitives.
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading a global `React` and exporting via `Object.assign(window,
// …)`; now uses ES-module `export`s. JSX needs no `React` import under Vite's
// automatic runtime. Brand images resolve from Vite `public/` (`/assets/...`).
//
// Exports:
// LerretLockup — glyph + Instrument-Serif wordmark
// LerretCanvasMock — full app mock (top bar, tool rail, layers, canvas, inspector)
// LerretFolderView — finder-like view of a local Assets folder
// LerretCommand — terminal-style command line ($ git clone …)
// LMLogo — alias of LerretLockup (kept so older asset components
// that referenced the LeafMarker lockup render the Lerret
// one instead).

// ───────────────────────────────────────────
// Brand lockup
// ───────────────────────────────────────────
export function LerretLockup({ size = 28, withWordmark = true, dark = false }) {
 const text = dark ? '#ECE7DC' : '#1A1714';
 return (
 <span style={{
 display: 'inline-flex',
 alignItems: 'center',
 gap: Math.round(size * 0.32),
 color: text,
 fontFamily: 'var(--lm-font-display, "Instrument Serif", Georgia, serif)',
 }}>
 <img
 src="/assets/lerret-logo.png"
 alt=""
 width={size}
 height={size}
 style={{
 display: 'block',
 width: size,
 height: size,
 borderRadius: Math.max(3, Math.round(size * 0.14)),
 objectFit: 'cover',
 }}
 />
 {withWordmark && (
 <span style={{
 fontSize: Math.round(size * 1.0),
 lineHeight: 1,
 letterSpacing: '-0.015em',
 color: 'inherit',
 }}>Lerret</span>
 )}
 </span>
 );
}

// ───────────────────────────────────────────
// Canvas mock — a fitted snapshot of the Lerret app:
// top bar, tool rail, layers panel, canvas with one artboard,
// inspector. Sizes scale via the `width` prop (height auto via
// aspect ratio). Defaults give a clean ~720×440 device shot.
// ───────────────────────────────────────────
export function LerretCanvasMock({
 width = 720,
 height = 440,
 fileName = 'launch-post.lerret',
 folder = '~/Assets/social',
 artboardLabel = 'instagram · 1080 × 1350 · 4:5',
 artboardW = 200,
 artboardH = 250,
}) {
 const TOOL_W = 40;
 const PANEL_W = Math.round(width * 0.25);
 const RIGHT_W = Math.round(width * 0.26);
 const TOPBAR_H = 32;

 const tool = (active = false, glyph) => (
 <div style={{
 width: 26, height: 26,
 display: 'grid', placeItems: 'center',
 borderRadius: 4,
 background: active ? '#E8E2D4' : 'transparent',
 color: active ? '#1A1714' : '#6E6960',
 fontSize: 13, fontWeight: 600,
 fontFamily: 'var(--lm-font-mono)',
 }}>{glyph}</div>
 );

 const layer = (label, indent = 0, selected = false, glyph = '▢') => (
 <div style={{
 display: 'flex', alignItems: 'center', gap: 6,
 padding: '4px 8px',
 paddingLeft: 8 + indent * 12,
 borderRadius: 4,
 background: selected ? '#E8C9B8' : 'transparent',
 color: selected ? '#92421E' : '#3A3530',
 fontSize: 10.5,
 fontFamily: 'var(--lm-font-sans)',
 }}>
 <span style={{ color: selected ? '#92421E' : '#6E6960', fontSize: 9 }}>{glyph}</span>
 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
 </div>
 );

 const propRow = (k, v, mono = true) => (
 <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 9.5 }}>
 <span style={{ color: '#6E6960', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--lm-font-sans)' }}>{k}</span>
 <span style={{ color: '#1A1714', fontFamily: mono ? 'var(--lm-font-mono)' : 'var(--lm-font-sans)' }}>{v}</span>
 </div>
 );

 return (
 <div style={{
 width, height,
 background: '#FAF8F2',
 border: '1px solid #C7C0AF',
 borderRadius: 6,
 overflow: 'hidden',
 boxShadow: '0 18px 40px -28px rgba(26,23,20,0.30), 0 1px 0 rgba(26,23,20,0.04)',
 display: 'grid',
 gridTemplateRows: `${TOPBAR_H}px 1fr`,
 fontFamily: 'var(--lm-font-sans)',
 }}>
 {/* TOP BAR */}
 <div style={{
 display: 'flex', alignItems: 'center', gap: 10,
 padding: '0 10px',
 borderBottom: '1px solid #DDD7CA',
 background: '#FAF8F2',
 }}>
 <img src="/assets/lerret-logo.png" alt="" style={{ width: 16, height: 16, borderRadius: 3, display: 'block' }} />
 <span style={{ fontSize: 11, color: '#1A1714', fontWeight: 500 }}>{fileName.replace(/\.lerret$/, '')}</span>
 <span style={{ fontSize: 10, color: '#6E6960', fontFamily: 'var(--lm-font-mono)' }}>.lerret</span>
 <span style={{ fontSize: 10, color: '#B8B3A8', fontFamily: 'var(--lm-font-mono)', marginLeft: 4 }}>· saved · {folder}</span>
 <div style={{ flex: 1 }} />
 <span style={{ fontSize: 10, color: '#3A3530', fontFamily: 'var(--lm-font-mono)' }}>100%</span>
 <span style={{
 fontSize: 9, fontWeight: 600,
 padding: '4px 8px', borderRadius: 3,
 background: '#E8E2D4', color: '#1A1714',
 textTransform: 'uppercase', letterSpacing: '0.06em',
 }}>↓ Export</span>
 </div>

 {/* MAIN */}
 <div style={{
 display: 'grid',
 gridTemplateColumns: `${TOOL_W}px ${PANEL_W}px 1fr ${RIGHT_W}px`,
 minHeight: 0,
 }}>
 {/* Tool rail */}
 <div style={{
 borderRight: '1px solid #DDD7CA',
 background: '#FAF8F2',
 padding: '8px 0',
 display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
 }}>
 {tool(true, '↗')}
 {tool(false, '▢')}
 {tool(false, '○')}
 {tool(false, '✎')}
 {tool(false, 'T')}
 {tool(false, '◢')}
 </div>

 {/* Layers panel */}
 <div style={{
 borderRight: '1px solid #DDD7CA',
 background: '#FAF8F2',
 display: 'flex', flexDirection: 'column', minHeight: 0,
 }}>
 <div style={{
 padding: '8px 10px 4px',
 display: 'flex', justifyContent: 'space-between', alignItems: 'center',
 fontSize: 9, color: '#6E6960',
 textTransform: 'uppercase', letterSpacing: '0.10em',
 }}>
 <span>Layers</span>
 <span style={{ fontFamily: 'var(--lm-font-mono)' }}>+</span>
 </div>
 <div style={{ padding: '2px 6px', overflow: 'hidden', flex: 1 }}>
 {layer('launch-post', 0, true, '▢')}
 {layer('Background', 1, false, '○')}
 {layer('Photo', 1, false, '▣')}
 {layer('Title', 1, false, 'T')}
 {layer('Date', 1, false, 'T')}
 {layer('@handle', 1, false, 'T')}
 </div>
 </div>

 {/* Canvas */}
 <div style={{
 background: '#E8E2D4',
 position: 'relative',
 display: 'grid', placeItems: 'center',
 overflow: 'hidden',
 }}>
 <div style={{
 position: 'absolute', inset: 0,
 backgroundImage: 'radial-gradient(rgba(26,23,20,0.06) 1px, transparent 1px)',
 backgroundSize: '10px 10px',
 opacity: 0.55,
 }} />
 <div style={{
 position: 'absolute', top: 8, left: 12,
 fontFamily: 'var(--lm-font-mono)', fontSize: 9,
 color: '#92421E',
 }}>{artboardLabel}</div>
 {/* Artboard */}
 <div style={{
 width: artboardW, height: artboardH,
 background: '#FAF8F2',
 border: '1.5px solid #B85B33',
 position: 'relative',
 boxShadow: '0 18px 36px -18px rgba(26,23,20,0.35)',
 display: 'flex', flexDirection: 'column',
 padding: 16,
 }}>
 {[
 { top: -3, left: -3 }, { top: -3, right: -3 },
 { bottom: -3, left: -3 }, { bottom: -3, right: -3 },
 ].map((p, i) => (
 <div key={i} style={{
 position: 'absolute', width: 5, height: 5,
 background: '#FAF8F2', border: '1.5px solid #B85B33',
 ...p,
 }} />
 ))}
 <div style={{
 fontFamily: 'var(--lm-font-sans)', fontSize: 6,
 letterSpacing: '0.18em', textTransform: 'uppercase',
 color: '#6E6960', marginBottom: 8,
 }}>Lerret · Release Note</div>
 <div style={{
 fontFamily: 'var(--lm-font-display)', fontSize: 22,
 lineHeight: 0.98, letterSpacing: '-0.02em',
 color: '#1A1714',
 }}>v0.4 is out.</div>
 <div style={{
 fontFamily: 'var(--lm-font-display)', fontSize: 22,
 lineHeight: 0.98, letterSpacing: '-0.02em',
 color: '#3A3530', fontStyle: 'italic',
 }}>Now on macOS.</div>
 <div style={{ flex: 1 }} />
 <div style={{
 fontFamily: 'var(--lm-font-mono)', fontSize: 6.5,
 color: '#6E6960', lineHeight: 1.4,
 }}>@lerret.dev · oslo · mit</div>
 </div>
 </div>

 {/* Inspector */}
 <div style={{
 borderLeft: '1px solid #DDD7CA',
 background: '#FAF8F2',
 padding: '10px 12px',
 display: 'flex', flexDirection: 'column', gap: 2,
 minHeight: 0, overflow: 'hidden',
 }}>
 <div style={{
 fontSize: 9, color: '#6E6960',
 textTransform: 'uppercase', letterSpacing: '0.10em',
 marginBottom: 4,
 }}>Frame</div>
 {propRow('W', '1080')}
 {propRow('H', '1350')}
 <div style={{ height: 1, background: '#DDD7CA', margin: '8px 0' }} />
 <div style={{
 fontSize: 9, color: '#6E6960',
 textTransform: 'uppercase', letterSpacing: '0.10em',
 marginBottom: 4,
 }}>Export</div>
 {propRow('Format', 'PNG')}
 {propRow('Scale', '2×')}
 {propRow('Output', '2160 × 2700')}
 <div style={{
 marginTop: 8,
 padding: '6px 8px',
 background: '#B85B33', color: '#FAF8F2',
 borderRadius: 3, textAlign: 'center',
 fontSize: 10, fontWeight: 600,
 fontFamily: 'var(--lm-font-sans)',
 }}>↓ Export PNG</div>
 </div>
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Folder view — finder-like list of files in the user's local
// Assets folder. Reinforces the local-first message: no cloud,
// just files on disk.
// ───────────────────────────────────────────
export function LerretFolderView({
 width = 380,
 folder = '~/Assets',
 rows,
 height,
}) {
 const defaults = [
 { kind: 'folder', name: 'social/', meta: '12 files' },
 { kind: 'lerret', name: 'launch-post.lerret', meta: '2.4 KB', indent: 1, accent: true },
 { kind: 'image', name: 'launch-post@2x.png', meta: '412 KB', indent: 1 },
 { kind: 'image', name: 'launch-post.jpg', meta: '186 KB', indent: 1 },
 { kind: 'folder', name: 'thumbnails/', meta: '8 files' },
 { kind: 'folder', name: 'banners/', meta: '3 files' },
 { kind: 'folder', name: 'og/', meta: '2 files' },
 ];
 const items = rows || defaults;
 const glyph = { folder: '📁', lerret: '◆', image: '◫' };

 return (
 <div style={{
 width, height,
 background: '#FAF8F2',
 border: '1px solid #C7C0AF',
 borderRadius: 8,
 overflow: 'hidden',
 boxShadow: '0 18px 40px -28px rgba(26,23,20,0.30), 0 1px 0 rgba(26,23,20,0.04)',
 fontFamily: 'var(--lm-font-mono)',
 }}>
 {/* Header */}
 <div style={{
 display: 'flex', alignItems: 'center', gap: 8,
 padding: '10px 14px',
 borderBottom: '1px solid #DDD7CA',
 fontSize: 12, color: '#1A1714',
 background: '#F2EEE6',
 }}>
 <span style={{ fontSize: 13 }}>📁</span>
 <span style={{ fontWeight: 500 }}>{folder}</span>
 <div style={{ flex: 1 }} />
 <span style={{ fontSize: 10, color: '#6E6960' }}>{items.length} items</span>
 </div>
 {/* Rows */}
 <div style={{ padding: '6px 4px' }}>
 {items.map((r, i) => (
 <div key={i} style={{
 display: 'flex', alignItems: 'center', gap: 8,
 padding: '5px 10px',
 paddingLeft: 10 + (r.indent || 0) * 14,
 color: r.accent ? '#92421E' : (r.kind === 'folder' ? '#1A1714' : '#3A3530'),
 fontSize: 12,
 }}>
 <span style={{ fontSize: 12, color: r.accent ? '#92421E' : '#6E6960' }}>
 {glyph[r.kind] || '·'}
 </span>
 <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
 {r.name}
 </span>
 <span style={{ fontSize: 10.5, color: '#6E6960' }}>{r.meta}</span>
 </div>
 ))}
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Inline command line — `$ git clone …`. Compact, sienna prompt.
// ───────────────────────────────────────────
export function LerretCommand({ cmd, hint, dark = false, scale = 1 }) {
 const fg = dark ? '#ECE7DC' : '#1A1714';
 const muted = dark ? '#A39E94' : '#6E6960';
 const bg = dark ? '#2A2723' : '#FAF8F2';
 const border = dark ? '#3A3530' : '#DDD7CA';
 return (
 <span style={{
 display: 'inline-flex', alignItems: 'center', gap: 8,
 padding: '6px 10px',
 background: bg,
 border: `1px solid ${border}`,
 borderRadius: 6,
 fontFamily: 'var(--lm-font-mono)',
 fontSize: Math.round(13 * scale),
 transform: `scale(${scale === 1 ? 1 : 1})`,
 }}>
 <span style={{ color: '#B85B33', fontWeight: 600 }}>$</span>
 <code style={{ color: fg, fontFamily: 'inherit' }}>{cmd}</code>
 {hint && <>
 <span style={{ color: muted }}>·</span>
 <span style={{ color: muted, fontFamily: 'var(--lm-font-sans)', fontSize: Math.round(12 * scale) }}>{hint}</span>
 </>}
 </span>
 );
}

// ───────────────────────────────────────────
// Backwards-compatibility: any existing component that imports
// <LMLogo /> picks up the Lerret lockup automatically. Lets us
// rebrand instantly without rewriting every file in lockstep.
// ───────────────────────────────────────────
export const LMLogo = LerretLockup;

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
