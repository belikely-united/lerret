// YouTube thumbnails — 1280 × 720 (16:9). Three variants — pick whichever lands.
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading globals; now imports its primitives as ES modules and uses
// `export`s. JSX needs no `React` import under Vite's automatic runtime.

import { LerretLockup, LerretCanvasMock } from './lerret-ui.jsx';

// ───────────────────────────────────────────
// Variant A — light, bold typographic. Reads from across the room.
// ───────────────────────────────────────────
export function YTThumbA() {
 return (
 <div className="lm-art" style={{ width: 1280, height: 720, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 56, left: 64, display: "flex", alignItems: "center", gap: 14 }}>
 <LerretLockup size={44} />
 <span style={{ marginLeft: 4, font: "600 12px/1 var(--lm-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "#6E6960" }}>Demo</span>
 </div>

 <div style={{ position: "absolute", top: 180, left: 64, width: 760 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 110, lineHeight: 0.94 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 28, fontSize: 22, lineHeight: 1.4, maxWidth: 660, fontWeight: 500 }}>
 A 60-second tour of the canvas, the folder, and the export button.
 </p>
 </div>

 <div style={{ position: "absolute", bottom: 56, left: 64, display: "flex", alignItems: "center", gap: 12 }}>
 {["Local-first", "MIT", "Plain JSON"].map((t) => (
 <span key={t} style={{ display: "inline-flex", alignItems: "center", padding: "8px 14px", background: "#FAF8F2", borderRadius: 999, color: "#1A1714", fontWeight: 500, border: "1px solid rgba(26,23,20,0.08)", fontSize: 14 }}>
 {t}
 </span>
 ))}
 </div>

 {/* canvas mock, slightly tilted */}
 <div style={{ position: "absolute", top: 90, right: 70, transform: "rotate(-3deg)" }}>
 <LerretCanvasMock width={420} height={280} artboardW={120} artboardH={150} />
 </div>

 <div style={{ position: "absolute", bottom: 56, right: 64, padding: "10px 18px", background: "#1A1714", color: "#FAF8F2", borderRadius: 999, font: "600 16px/1 var(--lm-font-mono)", letterSpacing: "0.04em", boxShadow: "0 12px 32px rgba(26,23,20,0.25)" }}>
 ▶ Watch the demo
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Variant B — dark, energetic, "watch this happen" framing.
// ───────────────────────────────────────────
export function YTThumbB() {
 return (
 <div className="lm-art lm-art--dark lm-art--blob" style={{ width: 1280, height: 720, background: "#1F1D1A" }}>
 <div style={{ position: "absolute", top: 48, left: 56 }}>
 <LerretLockup size={36} dark />
 </div>

 <div style={{ position: "absolute", top: 130, left: 56 }}>
 <span style={{
 display: "inline-flex", alignItems: "center", gap: 8,
 padding: "6px 12px",
 background: "rgba(184,91,51,0.18)", color: "#E8C9B8",
 borderRadius: 999,
 font: "600 12px/1 var(--lm-font-mono)",
 letterSpacing: "0.16em", textTransform: "uppercase",
 }}>
 Live demo
 </span>
 </div>

 <div style={{ position: "absolute", top: 178, left: 56, width: 760 }}>
 <h1 className="lm-display lm-display--dark" style={{ margin: 0, fontSize: 96, lineHeight: 0.96 }}>
 From <em>blank</em><br />
 to launch post<br />
 in 90 seconds.
 </h1>
 </div>

 {/* terminal snippet */}
 <div style={{ position: "absolute", bottom: 56, left: 56, display: "inline-flex", alignItems: "center", gap: 14, padding: "12px 18px", background: "#15130F", border: "1px solid #2A2723", borderRadius: 12, boxShadow: "0 18px 48px rgba(0,0,0,0.5)" }}>
 <span style={{ font: "600 18px/1 var(--lm-font-mono)", color: "#D08259" }}>$</span>
 <span style={{ font: "600 18px/1 var(--lm-font-mono)", color: "#ECE7DC" }}>git clone lerret</span>
 <span style={{ marginLeft: 6, font: "600 13px/1 var(--lm-font-sans)", color: "#B0C99A" }}>✓ ready</span>
 </div>

 {/* canvas mock, tilted */}
 <div style={{ position: "absolute", top: 70, right: 36, transform: "rotate(-4deg)" }}>
 <LerretCanvasMock width={460} height={310} artboardW={130} artboardH={165} />
 </div>

 <div style={{ position: "absolute", bottom: 56, right: 56, display: "inline-flex", alignItems: "center", gap: 12, padding: "12px 22px", background: "#FAF8F2", color: "#1A1714", borderRadius: 999, font: "600 16px/1 var(--lm-font-sans)", letterSpacing: "0.02em", boxShadow: "0 14px 36px rgba(0,0,0,0.40)" }}>
 <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: "11px solid #1A1714", borderTop: "7px solid transparent", borderBottom: "7px solid transparent" }} />
 Watch it ship
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Variant C — plain-JSON / "design as code" angle.
// ───────────────────────────────────────────
export function YTThumbC() {
 return (
 <div className="lm-art lm-art--dark lm-art--blob" style={{ width: 1280, height: 720, background: "#1F1D1A" }}>
 <div style={{ position: "absolute", top: 48, left: 56 }}>
 <LerretLockup size={36} dark />
 </div>

 <div style={{ position: "absolute", top: 124, left: 56, width: 620 }}>
 <span style={{
 display: "inline-flex", alignItems: "center", gap: 8,
 padding: "6px 12px",
 background: "rgba(184,91,51,0.18)", color: "#E8C9B8",
 borderRadius: 999,
 font: "600 12px/1 var(--lm-font-mono)",
 letterSpacing: "0.16em", textTransform: "uppercase",
 }}>
 The .lerret file
 </span>
 <h1 className="lm-display lm-display--dark" style={{ margin: "24px 0 0", fontSize: 100, lineHeight: 0.94 }}>
 Plain JSON.<br />
 <em>Diff it.</em><br />
 Merge it.
 </h1>
 </div>

 {/* code editor mock */}
 <div style={{ position: "absolute", top: 90, right: 40, width: 530, transform: "rotate(-3deg)" }}>
 <div style={{ background: "#15130F", border: "1px solid #2A2723", borderRadius: 14, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }}>
 <div style={{ padding: "10px 14px", borderBottom: "1px solid #2A2723", display: "flex", alignItems: "center", gap: 10 }}>
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ marginLeft: 8, font: "500 11px/1 var(--lm-font-mono)", color: "#A39E94" }}>launch-post.lerret</span>
 </div>
 <div style={{ padding: "20px 22px", font: "500 14px/1.7 var(--lm-font-mono)", color: "#ECE7DC" }}>
 <div>{'{'}</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"format"</span>: <span style={{ color: "#E8C9B8" }}>"lerret/v0.4"</span>,</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"frame"</span>: {'{ '}<span style={{ color: "#C8D1D3" }}>"w"</span>: <span style={{ color: "#D8C99B" }}>1080</span>, <span style={{ color: "#C8D1D3" }}>"h"</span>: <span style={{ color: "#D8C99B" }}>1350</span> {'},'}</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"layers"</span>: [</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;{'{ '}<span style={{ color: "#C8D1D3" }}>"text"</span>: <span style={{ color: "#E8C9B8" }}>"v0.4 is out."</span> {'},'}</div>
 <div>&nbsp;&nbsp;&nbsp;&nbsp;{'{ '}<span style={{ color: "#C8D1D3" }}>"image"</span>: <span style={{ color: "#E8C9B8" }}>"./photo.jpg"</span> {'}'}</div>
 <div>&nbsp;&nbsp;]</div>
 <div>{'}'}</div>
 </div>
 </div>
 </div>

 {/* badges */}
 <div style={{ position: "absolute", bottom: 50, left: 56, display: "flex", alignItems: "center", gap: 14 }}>
 {["readable", "diffable", "scriptable"].map((t) => (
 <span key={t} style={{
 display: "inline-flex", alignItems: "center",
 padding: "10px 18px",
 background: "rgba(236,231,220,0.06)",
 color: "#ECE7DC",
 borderRadius: 999,
 font: "500 16px/1 var(--lm-font-sans)",
 }}>{t}</span>
 ))}
 </div>

 <div style={{ position: "absolute", bottom: 60, right: 56, display: "inline-flex", alignItems: "center", gap: 12, padding: "12px 22px", background: "#FAF8F2", color: "#1A1714", borderRadius: 999, font: "600 16px/1 var(--lm-font-sans)", letterSpacing: "0.02em", boxShadow: "0 14px 36px rgba(0,0,0,0.40)" }}>
 <span style={{ display: "inline-block", width: 0, height: 0, borderLeft: "11px solid #1A1714", borderTop: "7px solid transparent", borderBottom: "7px solid transparent" }} />
 Watch the file
 </div>
 </div>
 );
}

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
