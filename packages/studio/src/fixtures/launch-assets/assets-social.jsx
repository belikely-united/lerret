// Social posts — LinkedIn portrait, two square posts, Reddit hero.
// Lerret-themed throughout. Note: PHThreeUp now lives in assets-ph.jsx.
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading globals; now imports its primitives as ES modules and uses
// `export`s. JSX needs no `React` import under Vite's automatic runtime.

import { LerretLockup, LerretCanvasMock } from './lerret-ui.jsx';

// ───────────────────────────────────────────
// Asset 5: LinkedIn launch image (1080×1350 portrait)
// ───────────────────────────────────────────
export function LinkedInLaunch() {
 return (
 <div className="lm-art" style={{ width: 1080, height: 1350, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 72, left: 72 }}>
 <LerretLockup size={36} />
 </div>

 <span className="lm-mark-eyebrow" style={{ position: "absolute", top: 152, left: 72 }}>
 Launching today on Product Hunt
 </span>

 <h1 className="lm-display" style={{ position: "absolute", top: 200, left: 72, right: 72, fontSize: 88, lineHeight: 0.96, margin: 0 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>

 {/* canvas mock, centered horizontally below headline */}
 <div style={{ position: "absolute", top: 480, left: "50%", transform: "translateX(-50%) rotate(-2deg)" }}>
 <LerretCanvasMock width={760} height={460} artboardW={210} artboardH={260} />
 </div>

 <p className="lm-sub" style={{ position: "absolute", bottom: 200, left: 72, right: 72, fontSize: 22, lineHeight: 1.45, maxWidth: 880, margin: 0 }}>
 An open-source canvas tool for the things you post. Pick a folder. Design on the canvas. Export as plain image files. No cloud, no proprietary format, no account.
 </p>

 <div style={{ position: "absolute", bottom: 80, left: 72, right: 72, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
 <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
 {["Local-first", "MIT", "Plain JSON", "Keyboard-first"].map((t) => (
 <span key={t} style={{ display: "inline-flex", alignItems: "center", padding: "8px 14px", background: "#FAF8F2", borderRadius: 999, color: "#1A1714", fontWeight: 500, fontSize: 14 }}>
 {t}
 </span>
 ))}
 </div>
 <span style={{ color: "#3A3530", fontWeight: 600, fontFamily: "var(--lm-font-mono)", fontSize: 14 }}>github.com/belikely-united/lerret</span>
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 6: Square — dark tagline (1080×1080)
// ───────────────────────────────────────────
export function SquareTagline() {
 return (
 <div className="lm-art lm-art--dark lm-art--blob" style={{ width: 1080, height: 1080, background: "#1F1D1A" }}>
 <div className="lm-dotgrid--dark" style={{ position: "absolute", inset: 0, opacity: 0.5 }} />

 <div style={{ position: "absolute", top: 80, left: 80 }}>
 <LerretLockup size={36} dark />
 </div>

 <span className="lm-mark-eyebrow lm-mark-eyebrow--ondark" style={{ position: "absolute", top: 220, left: 80 }}>
 Open source · v0.4
 </span>

 <h1 className="lm-display lm-display--dark" style={{ position: "absolute", top: 280, left: 80, right: 80, fontSize: 104, lineHeight: 0.95 }}>
 Make image assets.<br />
 <em>Keep the files.</em>
 </h1>

 <p className="lm-sub lm-sub--dark" style={{ position: "absolute", top: 700, left: 80, right: 80, fontSize: 24, maxWidth: 800 }}>
 A canvas in the folder you chose. Plain JSON. Forkable. Built for the post loop.
 </p>

 <div style={{ position: "absolute", bottom: 80, left: 80, right: 80, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
 <div style={{ display: "flex", gap: 12 }}>
 {["Local-first", "MIT", "Plain JSON"].map((t) => (
 <span key={t} style={{
 display: "inline-flex", alignItems: "center",
 padding: "8px 16px",
 background: "rgba(236,231,220,0.06)",
 borderRadius: 999, color: "#ECE7DC",
 fontWeight: 500, fontSize: 15,
 }}>{t}</span>
 ))}
 </div>
 <span style={{ color: "#A39E94", fontFamily: "var(--lm-font-mono)", fontSize: 14 }}>github.com/belikely-united/lerret</span>
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 7: Square — keyboard hero (1080×1080)
// One key. One export. Show ⌘E (the workhorse shortcut).
// ───────────────────────────────────────────
export function SquareKeyboard() {
 return (
 <div className="lm-art" style={{ width: 1080, height: 1080, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 80, left: 80 }}>
 <LerretLockup size={32} />
 </div>

 <div style={{ position: "absolute", top: 220, left: 80, right: 80 }}>
 <span className="lm-mark-eyebrow">Keyboard-first</span>
 <h1 className="lm-display" style={{ fontSize: 88, lineHeight: 0.96, marginTop: 22 }}>
 One key.<br />
 One export.<br />
 <em>Done.</em>
 </h1>
 </div>

 {/* giant ⌘E key */}
 <div style={{ position: "absolute", bottom: 100, left: 80, display: "flex", alignItems: "flex-end", gap: 36 }}>
 <div style={{
 width: 300, height: 300,
 background: "#FAF8F2",
 border: "1.5px solid #DDD7CA",
 borderBottom: "10px solid #C7C0AF",
 borderRadius: 28,
 display: "flex", alignItems: "center", justifyContent: "center",
 fontFamily: "var(--lm-font-mono)",
 fontSize: 130, fontWeight: 600,
 color: "#1A1714",
 boxShadow: "0 24px 60px rgba(26,23,20,0.10)",
 letterSpacing: "-0.05em",
 }}>⌘E</div>

 <div style={{ paddingBottom: 36, maxWidth: 480 }}>
 <div style={{
 font: "600 14px/1 var(--lm-font-sans)",
 color: "#6E6960",
 textTransform: "uppercase",
 letterSpacing: "0.14em",
 }}>Press</div>
 <div style={{
 font: "400 36px/1.1 var(--lm-font-display)",
 color: "#1A1714",
 marginTop: 16,
 letterSpacing: "-0.02em",
 }}>
 and the file lands<br />
 in the folder you chose.
 </div>
 <div style={{
 marginTop: 26,
 font: "500 14px/1 var(--lm-font-mono)",
 color: "#92421E",
 }}>PNG · JPG · SVG · WebP · PDF</div>
 </div>
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 11: Reddit hero (1200×675) — casual, slightly self-deprecating.
// ───────────────────────────────────────────
export function RedditPost() {
 return (
 <div className="lm-art" style={{ width: 1200, height: 675, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 40, left: 56 }}>
 <LerretLockup size={28} />
 </div>

 <h1 className="lm-display" style={{ position: "absolute", top: 116, left: 56, fontSize: 60, lineHeight: 1.04, margin: 0, maxWidth: 660 }}>
 I just wanted my <em>files back.</em>
 </h1>

 <p className="lm-sub" style={{ position: "absolute", top: 340, left: 56, right: 460, fontSize: 18, lineHeight: 1.55, margin: 0 }}>
 Built an open-source canvas for making image assets that saves to a folder you choose. Plain JSON, MIT licensed, no account, no cloud. The export button writes a file. That&rsquo;s it.
 </p>

 {/* canvas mock right side, slightly tilted */}
 <div style={{ position: "absolute", top: 50, right: 60, transform: "rotate(-3deg)" }}>
 <LerretCanvasMock width={420} height={280} artboardW={120} artboardH={150} />
 </div>

 <div style={{ position: "absolute", bottom: 40, left: 56, right: 56, display: "flex", justifyContent: "space-between", alignItems: "center", color: "#6E6960", font: "500 13px/1 var(--lm-font-sans)" }}>
 <span>Local-first · MIT · `.lerret` is plain JSON</span>
 <span style={{ color: "#1A1714", fontWeight: 600 }}>github.com/belikely-united/lerret</span>
 </div>
 </div>
 );
}

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
