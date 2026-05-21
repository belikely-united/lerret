// App showcase / promo tiles — sized to Chrome Web Store dimensions but
// fully reusable as marketplace listing, doc banners, or website promos.
// • Small promo tile 440 × 280
// • Large promo tile 920 × 680
// • Marquee promo tile 1400 × 560
// • Showcase screenshot 1280 × 800
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading globals; now imports its primitives as ES modules and uses
// `export`s. JSX needs no `React` import under Vite's automatic runtime.

import {
 LerretLockup,
 LerretCanvasMock,
 LerretFolderView,
 LerretCommand,
} from './lerret-ui.jsx';

// ───────────────────────────────────────────
// Promo tiles
// ───────────────────────────────────────────
export function CWSPromoSmall() {
 return (
 <div className="lm-art" style={{ width: 440, height: 280, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 28, left: 32 }}>
 <LerretLockup size={26} />
 </div>

 <div style={{ position: "absolute", top: 84, left: 32, width: 240 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 32, lineHeight: 0.98 }}>
 Make image<br />assets.<br /><em>Keep the files.</em>
 </h1>
 </div>

 <div style={{ position: "absolute", top: 26, right: -10, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={188} height={140} artboardW={56} artboardH={70} />
 </div>
 </div>
 );
}

export function CWSPromoLarge() {
 return (
 <div className="lm-art" style={{ width: 920, height: 680, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 56, left: 56 }}>
 <LerretLockup size={42} />
 </div>

 <div style={{ position: "absolute", top: 200, left: 56, width: 480 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 60, lineHeight: 0.98 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 22, fontSize: 17, lineHeight: 1.45, maxWidth: 440 }}>
 An open-source canvas. Pick a folder. Design. Export as plain image files. No cloud, no proprietary format.
 </p>
 </div>

 <div style={{ position: "absolute", bottom: 48, left: 56, display: "flex", gap: 8, flexWrap: "wrap" }}>
 {["Local-first", "MIT", "Plain JSON", "Keyboard-first"].map((t) => (
 <span key={t} style={{ display: "inline-flex", alignItems: "center", padding: "8px 14px", background: "#FAF8F2", borderRadius: 999, color: "#1A1714", fontWeight: 500, fontSize: 13 }}>
 {t}
 </span>
 ))}
 </div>

 <div style={{ position: "absolute", top: 80, right: 50, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={350} height={240} artboardW={100} artboardH={125} />
 </div>
 </div>
 );
}

export function CWSPromoMarquee() {
 return (
 <div className="lm-art" style={{ width: 1400, height: 560, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 56, left: 80 }}>
 <LerretLockup size={50} />
 </div>

 <div style={{ position: "absolute", top: 180, left: 80, width: 720 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 80, lineHeight: 0.98 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 24, fontSize: 22, lineHeight: 1.4, maxWidth: 660 }}>
 An open-source canvas for the things you post. Plain files in the folder you chose.
 </p>
 </div>

 <div style={{ position: "absolute", bottom: 60, left: 80 }}>
 <LerretCommand cmd="git clone github.com/belikely-united/lerret" hint="clone, build, run" scale={1.1} />
 </div>

 <div style={{ position: "absolute", top: 80, right: 60, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={460} height={310} artboardW={130} artboardH={165} />
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Screenshot frame — common chrome for the 1280×800 showcase tiles.
// ───────────────────────────────────────────
function CWSFrame({ caption, captionStrong, kbd, code, children }) {
 return (
 <div className="lm-art" style={{ width: 1280, height: 800, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 36, left: 48, display: "flex", alignItems: "center", gap: 10, color: "#3A3530", font: "600 13px/1 var(--lm-font-sans)" }}>
 <LerretLockup size={22} />
 <span style={{ marginLeft: 4, color: "#6E6960" }}>· open-source canvas</span>
 </div>
 <div style={{ position: "absolute", top: 84, left: 48, right: 48, bottom: 48 }}>
 {children}
 <div style={{ position: "absolute", left: 28, bottom: 28, display: "inline-flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "rgba(250,248,242,0.95)", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 12, boxShadow: "0 8px 24px rgba(26,23,20,0.10)", maxWidth: "calc(100% - 56px)" }}>
 {kbd ? <span style={{ font: "600 12px/1 var(--lm-font-mono)", color: "#92421E", flexShrink: 0 }}>{kbd}</span> : null}
 <span style={{ font: "500 13px/1.45 var(--lm-font-sans)", color: "#1A1714" }}>
 {captionStrong ? <b style={{ fontWeight: 600 }}>{captionStrong} </b> : null}
 {caption}
 {code ? <> <code style={{ font: "600 12px/1 var(--lm-font-mono)", color: "#1A1714", background: "#E8E2D4", padding: "2px 6px", borderRadius: 4 }}>{code}</code></> : null}
 </span>
 </div>
 </div>
 </div>
 );
}

// 1 · Pick a folder — local-first hook.
export function CWSScreenshot1() {
 return (
 <CWSFrame
 kbd="Step 1"
 captionStrong="Pick a folder."
 caption="Lerret remembers it. Every project, every revision saves there."
 >
 <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 56 }}>
 <LerretFolderView width={420} />
 <div style={{ font: "300 36px/1 var(--lm-font-sans)", color: "#92421E" }}>→</div>
 <LerretCanvasMock width={520} height={340} artboardW={150} artboardH={185} />
 </div>
 </CWSFrame>
 );
}

// 2 · Design on the canvas — toolbar + layers + inspector.
export function CWSScreenshot2() {
 return (
 <CWSFrame
 kbd="Step 2"
 captionStrong="Design on the canvas."
 caption="Preset frames sized for the places you post. Type, image, shape — every tool a single keystroke."
 >
 <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
 <LerretCanvasMock width={920} height={560} artboardW={260} artboardH={325} />
 </div>
 </CWSFrame>
 );
}

// 3 · Export to your folder — files land where you put them.
export function CWSScreenshot3() {
 return (
 <CWSFrame
 kbd="Step 3"
 captionStrong="Export."
 caption="PNG, JPG, SVG, WebP, PDF. The file lands in the folder you chose. No cloud round-trip."
 >
 <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 60 }}>
 <LerretCanvasMock width={500} height={340} artboardW={150} artboardH={185} />
 <div style={{ font: "300 36px/1 var(--lm-font-sans)", color: "#92421E" }}>→</div>
 <LerretFolderView width={400} rows={[
 { kind: "folder", name: "social/", meta: "12 files" },
 { kind: "lerret", name: "launch-post.lerret", meta: "2.4 KB", indent: 1, accent: true },
 { kind: "image", name: "launch-post@2x.png", meta: "412 KB", indent: 1, accent: true },
 { kind: "image", name: "launch-post.jpg", meta: "186 KB", indent: 1 },
 { kind: "image", name: "launch-post.svg", meta: "84 KB", indent: 1 },
 ]} />
 </div>
 </CWSFrame>
 );
}

// 4 · Plain JSON file — diff it, version it, generate it.
export function CWSScreenshot4() {
 return (
 <CWSFrame
 caption="The"
 code=".lerret"
 captionStrong=""
 >
 <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
 <div style={{ width: 760, background: "#15130F", borderRadius: 14, overflow: "hidden", boxShadow: "0 28px 72px rgba(26,23,20,0.32)" }}>
 <div style={{ padding: "12px 16px", borderBottom: "1px solid #2A2723", display: "flex", alignItems: "center", gap: 10 }}>
 <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ marginLeft: 10, font: "500 12px/1 var(--lm-font-mono)", color: "#A39E94" }}>launch-post.lerret</span>
 <span style={{ marginLeft: "auto", font: "500 11px/1 var(--lm-font-mono)", color: "#6E6960" }}>JSON · 2.4 KB</span>
 </div>
 <div style={{ padding: "26px 30px", font: "500 15px/1.75 var(--lm-font-mono)", color: "#ECE7DC" }}>
 <div>{'{'}</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"format"</span>: <span style={{ color: "#E8C9B8" }}>"lerret/v0.4"</span>,</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"frame"</span>: {'{'}</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"name"</span>: <span style={{ color: "#E8C9B8" }}>"launch-post"</span>,</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"w"</span>: <span style={{ color: "#D8C99B" }}>1080</span>, <span style={{ color: "#C8D1D3" }}>"h"</span>: <span style={{ color: "#D8C99B" }}>1350</span>,</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"preset"</span>: <span style={{ color: "#E8C9B8" }}>"instagram-4x5"</span></div>
 <div>&nbsp;&nbsp;{'}'},</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"layers"</span>: [</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;{'{ '}<span style={{ color: "#C8D1D3" }}>"type"</span>: <span style={{ color: "#E8C9B8" }}>"text"</span>, <span style={{ color: "#C8D1D3" }}>"text"</span>: <span style={{ color: "#E8C9B8" }}>"v0.4 is out."</span> {'},'}</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;{'{ '}<span style={{ color: "#C8D1D3" }}>"type"</span>: <span style={{ color: "#E8C9B8" }}>"image"</span>, <span style={{ color: "#C8D1D3" }}>"src"</span>: <span style={{ color: "#E8C9B8" }}>"./photo.jpg"</span> {'}'}</div>
 <div>&nbsp;&nbsp;]</div>
 <div>{'}'}</div>
 </div>
 </div>
 </div>
 </CWSFrame>
 );
}

// 5 · Sized for the places you post — preset frame gallery.
export function CWSScreenshot5() {
 const presets = [
 { l: "Square", dim: "1080 × 1080", accent: true },
 { l: "Portrait", dim: "1080 × 1350" },
 { l: "Story", dim: "1080 × 1920" },
 { l: "OG card", dim: "1200 × 630" },
 { l: "Thumbnail", dim: "1280 × 720" },
 { l: "Banner", dim: "1500 × 500" },
 { l: "Blog", dim: "2400 × 1260" },
 { l: "Profile", dim: "400 × 400" },
 ];
 return (
 <CWSFrame
 caption="Preset frames sized for the places you post — Instagram, X, LinkedIn, blogs, OG cards, YouTube thumbnails."
 >
 <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, padding: "20px 0 80px", alignContent: "center" }}>
 {presets.map((p) => (
 <div key={p.l} style={{
 padding: "20px 22px",
 background: p.accent ? "#E8C9B8" : "#FAF8F2",
 border: p.accent ? "1.5px solid #B85B33" : "1px solid #DDD7CA",
 borderRadius: 8,
 display: "flex", flexDirection: "column", justifyContent: "space-between",
 minHeight: 110,
 }}>
 <div style={{
 fontFamily: "var(--lm-font-display)", fontSize: 24,
 color: p.accent ? "#92421E" : "#1A1714",
 letterSpacing: "-0.015em",
 }}>{p.l}</div>
 <div style={{ fontFamily: "var(--lm-font-mono)", fontSize: 12, color: "#6E6960" }}>{p.dim}</div>
 </div>
 ))}
 </div>
 </CWSFrame>
 );
}

// 6 · Templates that fork — gallery of starter assets.
export function CWSScreenshotSnip() {
 return (
 <CWSFrame
 caption="Save one as another. Build a series from a single master. Fork the templates — yours after that."
 >
 <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 24 }}>
 {["Launch v0.3", "Launch v0.4", "Hiring post", "Blog header"].map((t, i) => (
 <div key={t} style={{
 width: 200, height: 250,
 background: i === 1 ? "#E8C9B8" : "#FAF8F2",
 border: i === 1 ? "1.5px solid #B85B33" : "1px solid #DDD7CA",
 borderRadius: 6,
 position: "relative",
 transform: `rotate(${i === 1 ? 0 : (i - 1.5) * 2}deg)`,
 boxShadow: i === 1 ? "0 18px 40px -20px rgba(184,91,51,0.4)" : "0 12px 30px -18px rgba(26,23,20,0.30)",
 display: "flex", flexDirection: "column",
 padding: 18,
 }}>
 <div style={{
 fontFamily: "var(--lm-font-sans)", fontSize: 7,
 letterSpacing: "0.18em", textTransform: "uppercase",
 color: "#6E6960",
 }}>Lerret · Template</div>
 <div style={{
 fontFamily: "var(--lm-font-display)", fontSize: 22,
 color: i === 1 ? "#92421E" : "#1A1714",
 marginTop: 14, lineHeight: 1.05,
 }}>{t}</div>
 <div style={{ flex: 1 }} />
 <div style={{
 fontFamily: "var(--lm-font-mono)", fontSize: 10,
 color: "#6E6960",
 }}>1080 × 1350 · 4:5</div>
 </div>
 ))}
 </div>
 </CWSFrame>
 );
}

// Backwards-compat alias for the original CWSScreenshot name.
export const CWSScreenshot = CWSScreenshot1;

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
