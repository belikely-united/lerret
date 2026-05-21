// Misc assets — OG image (link share preview), PH thumbnail (app icon),
// and Twitter/X horizontal hero. All Lerret-branded.
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading globals; now imports its primitives as ES modules and uses
// `export`s. JSX needs no `React` import under Vite's automatic runtime.

import { LerretLockup, LerretCanvasMock, LerretCommand } from './lerret-ui.jsx';

// ───────────────────────────────────────────
// Asset 8: OG image (1200×630) — what shows up when the link is shared.
// Big text, very few words, canvas mock on the right.
// ───────────────────────────────────────────
export function OGImage() {
 return (
 <div className="lm-art" style={{ width: 1200, height: 630, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 56, left: 72 }}>
 <LerretLockup size={56} />
 </div>

 <div style={{ position: "absolute", top: 200, left: 72, width: 600 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 80, lineHeight: 0.98 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 24, fontSize: 20, lineHeight: 1.4, maxWidth: 560 }}>
 An open-source canvas. Local-first. MIT. Plain JSON files in the folder you chose.
 </p>
 </div>

 <div style={{ position: "absolute", top: 100, right: 56, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={460} height={290} artboardW={130} artboardH={165} />
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 9: PH thumbnail / app icon (240×240)
// Just the Lerret mark on a soft canvas circle.
// ───────────────────────────────────────────
export function PHThumbnail() {
 return (
 <div className="lm-art" style={{
 width: 240, height: 240,
 background: "#1F1D1A",
 borderRadius: "50%",
 border: "1px solid rgba(26,23,20,0.10)",
 display: "flex", alignItems: "center", justifyContent: "center",
 overflow: "hidden",
 }}>
 <img src="/assets/lerret-logo.png" alt="Lerret" style={{ width: 144, height: 144, borderRadius: 28, objectFit: "cover" }} />
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 10: Twitter/X horizontal (1600×900) — clear headline, canvas on the right.
// ───────────────────────────────────────────
export function TwitterPost() {
 return (
 <div className="lm-art" style={{ width: 1600, height: 900, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 80, left: 100 }}>
 <LerretLockup size={68} />
 </div>

 <div style={{ position: "absolute", top: 220, left: 100, width: 880 }}>
 <h1 className="lm-display" style={{ margin: 0, fontSize: 104, lineHeight: 0.96 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 32, fontSize: 26, lineHeight: 1.4, maxWidth: 760 }}>
 An open-source canvas for the things you post. Local-first. MIT-licensed. Plain JSON.
 </p>
 <div style={{ marginTop: 36 }}>
 <LerretCommand cmd="git clone github.com/belikely-united/lerret" hint="clone, build, run" scale={1.15} />
 </div>
 </div>

 <div style={{ position: "absolute", bottom: 64, left: 100, display: "flex", gap: 12, fontSize: 14, color: "#3A3530" }}>
 {["Local-first", "MIT-licensed", "Plain JSON files", "Keyboard-first"].map((t) => (
 <span key={t} style={{ display: "inline-flex", alignItems: "center", padding: "10px 18px", background: "#FAF8F2", borderRadius: 999, color: "#1A1714", fontWeight: 500, fontSize: 16 }}>
 {t}
 </span>
 ))}
 </div>

 <div style={{ position: "absolute", top: 130, right: 110, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={620} height={400} artboardW={170} artboardH={210} />
 </div>
 </div>
 );
}

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
