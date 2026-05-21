// Product Hunt gallery (1270×760) — six artboards walking through the
// Lerret narrative: pick a folder, design on the canvas, export to disk,
// share. Local-first, MIT, plain files.
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
// Asset 1 — Hero
// ───────────────────────────────────────────
export function PHHero() {
 return (
 <div className="lm-art" style={{ width: 1270, height: 760, padding: 0, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 {/* left side: type */}
 <div style={{ position: "absolute", top: 80, left: 80, width: 560, zIndex: 2 }}>
 <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
 <LerretLockup size={32} />
 <span className="lm-mark-eyebrow" style={{ display: "inline-flex", alignItems: "center", lineHeight: 1 }}>
 Open source · MIT · v0.4
 </span>
 </div>
 <h1 className="lm-display" style={{ marginTop: 28 }}>
 Make image assets.<br/>
 <em>Keep the files.</em>
 </h1>
 <p className="lm-sub" style={{ marginTop: 22 }}>
 An open-source canvas for the things you post — social graphics, thumbnails, banners, headers. Designed locally, exported to the folder you chose.
 </p>
 <div style={{ marginTop: 28 }}>
 <LerretCommand cmd="git clone github.com/belikely-united/lerret" hint="clone, build, run — that's the install" />
 </div>
 </div>

 {/* right side: canvas mock */}
 <div style={{ position: "absolute", top: 110, right: -60, transform: "rotate(-2deg)" }}>
 <LerretCanvasMock width={680} height={420} />
 </div>

 {/* bottom corner: ethos pills */}
 <div style={{ position: "absolute", bottom: 36, left: 80, display: "flex", alignItems: "center", gap: 10, color: "#6E6960", fontSize: 12, fontWeight: 500 }}>
 {["Local-first", "MIT-licensed", "Plain JSON files", "Keyboard-first"].map((t) => (
 <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#FAF8F2", borderRadius: 999, color: "#1A1714", fontWeight: 500, fontSize: 12 }}>
 {t}
 </span>
 ))}
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 2 — Step 1: Pick a folder
// ───────────────────────────────────────────
export function PHAnnotated() {
 return (
 <div className="lm-art" style={{ width: 1270, height: 760, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 60, left: 80, right: 80 }}>
 <span className="lm-mark-eyebrow">Step 1 — Pick a folder</span>
 <h2 className="lm-display" style={{ fontSize: 56, marginTop: 18 }}>
 Your work lives <em>where you can see it.</em>
 </h2>
 <p className="lm-sub" style={{ marginTop: 14, fontSize: 17, maxWidth: 720 }}>
 Pick a folder on your machine. Lerret remembers it. Every project, every revision, every export — saved as plain files in that folder. No cloud, no account, no proprietary format.
 </p>
 </div>

 {/* folder + canvas paired */}
 <div style={{ position: "absolute", top: 290, left: 80, right: 80, display: "flex", gap: 28, alignItems: "flex-start" }}>
 <div style={{ flex: "0 0 380px" }}>
 <LerretFolderView width={380} />
 <div style={{ marginTop: 12, fontSize: 12, color: "#6E6960", fontFamily: "var(--lm-font-mono)" }}>
 ~/Assets — yours, on disk
 </div>
 </div>
 <div style={{ flex: 1, paddingTop: 20, transform: "rotate(-1.5deg)" }}>
 <LerretCanvasMock width={620} height={380} />
 </div>
 </div>

 {/* arrow connecting them */}
 <svg style={{ position: "absolute", top: 410, left: 460, width: 80, height: 30 }} viewBox="0 0 80 30" fill="none">
 <path d="M0 15 L70 15" stroke="#B85B33" strokeWidth="1.5" strokeDasharray="4 4" />
 <path d="M64 8 L74 15 L64 22" stroke="#B85B33" strokeWidth="1.5" fill="none" strokeLinecap="round" />
 </svg>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 3 — Step 2: Design on the canvas (dark hero)
// ───────────────────────────────────────────
export function PHWorkflow() {
 return (
 <div className="lm-art lm-art--dark lm-art--blob" style={{ width: 1270, height: 760, background: "#1F1D1A" }}>
 <div className="lm-dotgrid--dark" style={{ position: "absolute", inset: 0, opacity: 0.4 }} />
 <div style={{ position: "absolute", top: 70, left: 80, right: 80, zIndex: 2 }}>
 <span className="lm-mark-eyebrow lm-mark-eyebrow--ondark">Step 2 — Design on the canvas</span>
 <h2 className="lm-display lm-display--dark" style={{ fontSize: 56, marginTop: 18 }}>
 A small kit. <em>The right defaults.</em>
 </h2>
 <p className="lm-sub lm-sub--dark" style={{ marginTop: 14, maxWidth: 600, fontSize: 17 }}>
 Preset frames sized for the places you post. Type, image, shape, and a few honest blend modes. Every tool a single keystroke. Make the thing, then make it again next week.
 </p>
 </div>

 {/* canvas mock — large */}
 <div style={{ position: "absolute", top: 260, left: 130, zIndex: 2 }}>
 <LerretCanvasMock width={780} height={460} />
 </div>

 {/* keystroke chips on the right */}
 <div style={{ position: "absolute", top: 290, right: 80, width: 240, display: "flex", flexDirection: "column", gap: 14, zIndex: 2 }}>
 {[
 { k: "T", l: "Text" },
 { k: "I", l: "Image" },
 { k: "S", l: "Shape" },
 { k: "F", l: "Frame" },
 { k: "⌘E", l: "Export" },
 { k: "⌘N", l: "New asset" },
 ].map((s) => (
 <div key={s.k} style={{
 display: "flex", alignItems: "center", gap: 12,
 padding: "10px 14px",
 background: "rgba(236,231,220,0.04)",
 border: "1px solid rgba(236,231,220,0.10)",
 borderRadius: 8,
 }}>
 <span className="lm-bigkbd lm-bigkbd--dark">{s.k}</span>
 <span style={{ color: "#C4BFB4", fontSize: 14, fontWeight: 500 }}>{s.l}</span>
 </div>
 ))}
 </div>

 {/* logo lockup */}
 <div style={{ position: "absolute", bottom: 36, left: 80, zIndex: 2 }}>
 <LerretLockup size={26} dark />
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 4 — Plain JSON file format
// ───────────────────────────────────────────
export function PHSnip() {
 return (
 <div className="lm-art" style={{ width: 1270, height: 760, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 60, left: 80, right: 80 }}>
 <span className="lm-mark-eyebrow">The .lerret file</span>
 <h2 className="lm-display" style={{ fontSize: 52, marginTop: 18 }}>
 Plain JSON. <em>Diff it. Merge it.</em>
 </h2>
 <p className="lm-sub" style={{ marginTop: 14, maxWidth: 700, fontSize: 16 }}>
 A canvas is a list of layers, each with coordinates and properties. Read it in any editor. Version it in git. Generate it from a script. There is no proprietary format to outlive the company that made it.
 </p>
 </div>

 {/* JSON code block */}
 <div style={{ position: "absolute", top: 270, left: 80, width: 700 }}>
 <div className="lm-codeblock">
 <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid #2A2723" }}>
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3A3530" }} />
 <span style={{ marginLeft: 8, fontSize: 11.5, color: "#A39E94", fontWeight: 500 }}>launch-post.lerret</span>
 <span style={{ marginLeft: "auto", fontSize: 11, color: "#6E6960" }}>JSON · 2.4 KB</span>
 </div>
 <div style={{ fontSize: 13, lineHeight: 1.7 }}>
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
 <div>&nbsp;&nbsp;],</div>
 <div>&nbsp;&nbsp;<span style={{ color: "#C8D1D3" }}>"export"</span>: {'{ '}<span style={{ color: "#C8D1D3" }}>"format"</span>: <span style={{ color: "#E8C9B8" }}>"png"</span>, <span style={{ color: "#C8D1D3" }}>"scale"</span>: <span style={{ color: "#D8C99B" }}>2</span> {'}'}</div>
 <div>{'}'}</div>
 </div>
 </div>
 </div>

 {/* benefits column on the right */}
 <div style={{ position: "absolute", top: 290, right: 80, width: 360 }}>
 {[
 { h: "Readable", b: "By humans, by grep, by any text editor." },
 { h: "Diffable", b: "Open a PR on a design change. Review it line-by-line." },
 { h: "Scriptable", b: "Generate variants from a list. The format is just JSON." },
 ].map((it, i) => (
 <div key={i} style={{ marginBottom: 26 }}>
 <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
 <span style={{ fontFamily: "var(--lm-font-mono)", fontSize: 11, color: "#6E6960" }}>0{i + 1}</span>
 <span style={{ fontFamily: "var(--lm-font-display)", fontSize: 24, color: "#1A1714", letterSpacing: "-0.02em" }}>{it.h}</span>
 </div>
 <p style={{ margin: "8px 0 0 26px", fontSize: 14, lineHeight: 1.5, color: "#3A3530" }}>{it.b}</p>
 </div>
 ))}
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 5 — The loop (three-up)
// ───────────────────────────────────────────
export function PHThreeUp() {
 return (
 <div className="lm-art" style={{ width: 1270, height: 760, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 60, left: 80, right: 80 }}>
 <span className="lm-mark-eyebrow">The loop</span>
 <h2 className="lm-display" style={{ fontSize: 56, marginTop: 18 }}>
 Design, export, post. <em>Then do it again.</em>
 </h2>
 </div>

 {/* three columns */}
 <div style={{ position: "absolute", top: 240, left: 80, right: 80, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24, alignItems: "stretch" }}>
 {[
 {
 label: "Design", note: "on the canvas",
 mock: <LerretCanvasMock width={340} height={220} artboardW={120} artboardH={150} />,
 },
 {
 label: "Export", note: "into your folder",
 mock: <LerretFolderView width={340} height={220} rows={[
 { kind: "folder", name: "social/", meta: "12 files" },
 { kind: "lerret", name: "launch-post.lerret", meta: "2.4 KB", indent: 1, accent: true },
 { kind: "image", name: "launch-post@2x.png", meta: "412 KB", indent: 1 },
 { kind: "image", name: "launch-post.jpg", meta: "186 KB", indent: 1 },
 ]} />,
 },
 {
 label: "Post", note: "wherever you post",
 mock: (
 <div style={{ width: 340, height: 220, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 8 }}>
 {["IG", "X", "LinkedIn", "Substack"].map((p, i) => (
 <div key={p} style={{
 background: "#FAF8F2",
 border: "1px solid #DDD7CA",
 borderRadius: 6,
 display: "flex", alignItems: "center", justifyContent: "center",
 fontFamily: "var(--lm-font-display)",
 fontSize: 28, color: i === 0 ? "#92421E" : "#1A1714",
 fontStyle: i === 0 ? "italic" : "normal",
 boxShadow: i === 0 ? "0 8px 20px -10px rgba(184,91,51,0.4)" : "none",
 }}>{p}</div>
 ))}
 </div>
 ),
 },
 ].map((step, i) => (
 <div key={step.label}>
 <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
 <span style={{ fontFamily: "var(--lm-font-mono)", fontSize: 12, color: "#6E6960" }}>0{i + 1}</span>
 <span style={{ fontFamily: "var(--lm-font-display)", fontSize: 32, color: "#1A1714", letterSpacing: "-0.02em" }}>{step.label}</span>
 </div>
 {step.mock}
 <div style={{ marginTop: 10, fontSize: 14, color: "#3A3530" }}>{step.note}</div>
 </div>
 ))}
 </div>

 {/* footer note */}
 <div style={{ position: "absolute", bottom: 36, left: 80, fontSize: 13, color: "#6E6960", display: "flex", alignItems: "center", gap: 12 }}>
 <LerretLockup size={20} />
 <span style={{ marginLeft: 8 }}>The shortcuts assume you will do this again tomorrow, and the day after.</span>
 </div>
 </div>
 );
}

// ───────────────────────────────────────────
// Asset 6 — Templates that fork
// ───────────────────────────────────────────
export function PHBrownfield() {
 return (
 <div className="lm-art" style={{ width: 1270, height: 760, background: "linear-gradient(135deg, #FAF8F2 0%, #F2EEE6 50%, #E8E2D4 100%)" }}>
 <div style={{ position: "absolute", top: 80, left: 80, right: 80 }}>
 <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
 <LerretLockup size={28} />
 <span className="lm-mark-eyebrow">Templates that fork</span>
 </div>
 <h2 className="lm-display" style={{ fontSize: 56, marginTop: 28, maxWidth: 880 }}>
 Save one as another. <em>Build a series from a single master.</em>
 </h2>
 <p className="lm-sub" style={{ marginTop: 18, maxWidth: 720, fontSize: 17 }}>
 Every artboard is forkable. Duplicate a launch post, swap the headline, ship the next one. No global library to babysit — your templates are folders on disk.
 </p>
 </div>

 {/* template grid */}
 <div style={{ position: "absolute", top: 380, left: 80, right: 80, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
 {[
 { title: "Launch post", dim: "1080 × 1350", accent: true },
 { title: "Story", dim: "1080 × 1920" },
 { title: "OG card", dim: "1200 × 630" },
 { title: "Banner", dim: "1500 × 500" },
 { title: "Thumbnail", dim: "1280 × 720" },
 { title: "Profile", dim: "400 × 400" },
 { title: "Poster", dim: "2400 × 3000" },
 { title: "Blank", dim: "any size" },
 ].map((t) => (
 <div key={t.title} style={{
 padding: "16px 18px",
 background: t.accent ? "#E8C9B8" : "#FAF8F2",
 border: t.accent ? "1.5px solid #B85B33" : "1px solid #DDD7CA",
 borderRadius: 8,
 display: "flex", flexDirection: "column", gap: 6,
 minHeight: 100,
 }}>
 <div style={{
 fontFamily: "var(--lm-font-display)", fontSize: 22,
 color: t.accent ? "#92421E" : "#1A1714",
 letterSpacing: "-0.015em",
 }}>{t.title}</div>
 <div style={{ flex: 1 }} />
 <div style={{ fontFamily: "var(--lm-font-mono)", fontSize: 11, color: "#6E6960" }}>{t.dim}</div>
 </div>
 ))}
 </div>
 </div>
 );
}

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
