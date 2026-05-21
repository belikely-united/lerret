// Reusable LeafMarker UI primitives for marketing assets.
//
// (migration) Brownfield launch-asset demo content. Was a script-tag
// `.jsx` reading a global `React` and exporting via `Object.assign(window,
// …)`; now uses ES-module `export`s. JSX needs no `React` import under Vite's
// automatic runtime. Brand images resolve from Vite `public/` (`/assets/...`).

export function LMLogo({ size = 28, withWordmark = true, dark = false }) {
 return (
 <span className="lm-lockup" style={{ color: dark ? "#f9fafb" : "#0f172a" }}>
 <img src="/assets/leafmarker-logo-transparent.png" alt="LeafMarker" style={{ width: size, height: size }} />
 {withWordmark ? (
 <span className="name" style={{ fontSize: Math.round(size * 0.62) }}>LeafMarker</span>
 ) : null}
 </span>
 );
}

// Compact LeafMarker popup, used as a hero device-shot.
export function LMPopup({ tab = "to do", showSettings = false, plan = "free", scale = 1, tasks }) {
 const seed = tasks || [
 { id: "t1", status: "to do", time: "just now", comment: "Move this to the bottom, 16px above the viewport. Make the border darker on hover.", label: "Link: Profile", selector: "a[href='/profile']" },
 { id: "t2", status: "to do", time: "14m ago", comment: "Tighten the line-height on the body copy. It feels loose.", label: "Paragraph", selector: "main > p:nth-child(2)" },
 { id: "t3", status: "to do", time: "42m ago", comment: "Icon is 1px off from baseline — nudge it up.", label: "Icon: bell", selector: ".nav-bell svg" },
 { id: "t4", status: "doing", time: "1h ago", comment: "Card needs a hover state and a subtle lift — 0 1px 3px feels right.", label: "Card: user", selector: ".user-card" },
 { id: "t5", status: "done", time: "3h ago", comment: "Button should say 'Connect Project' not 'Add Project'.", label: "Button: Connect", selector: "button.primary" },
 ];
 const visible = seed.filter((t) => t.status === tab);
 const counts = {
 "to do": seed.filter((t) => t.status === "to do").length,
 doing: seed.filter((t) => t.status === "doing").length,
 done: seed.filter((t) => t.status === "done").length,
 };

 return (
 <div className="lm-popup" style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
 <div className="lm-popup__handle"><span /></div>
 <div className="lm-popup__head">
 <div className="lm-popup__title">
 <img src="/assets/leafmarker-logo-transparent.png" alt="" />
 LeafMarker
 </div>
 <div className="lm-popup__head-actions">
 {plan === "free" ? (
 <span className="lm-popup__gopro">
 <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>
 Go Pro
 </span>
 ) : null}
 <span className="lm-popup__icon-btn">
 <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
 </span>
 <span className="lm-popup__icon-btn">
 <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
 </span>
 <span className="lm-popup__icon-btn">
 <svg viewBox="0 0 24 24" width="12" height="12"><path d="M5 12h14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
 </span>
 </div>
 </div>

 <div className="lm-tabs">
 {[
 { key: "to do", label: "To Do" },
 { key: "doing", label: "Doing" },
 { key: "done", label: "Done" },
 ].map((t) => (
 <span key={t.key} className={`lm-tab ${tab === t.key ? "lm-tab--active" : ""}`}>
 {t.label}
 {counts[t.key] > 0 ? (
 <span className={`lm-tab__badge ${t.key === "done" && tab !== "done" ? "lm-tab__badge--green" : ""}`}>
 {counts[t.key]}
 </span>
 ) : null}
 </span>
 ))}
 </div>

 <div className="lm-queue">
 {visible.map((t) => (
 <LMTaskCard key={t.id} task={t} />
 ))}
 </div>

 <div className="lm-popup__footer">
 <span className="lm-popup__cta">
 <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><polygon points="23 11 23 13 22 13 22 14 14 14 14 22 13 22 13 23 11 23 11 22 10 22 10 14 2 14 2 13 1 13 1 11 2 11 2 10 10 10 10 2 11 2 11 1 13 1 13 2 14 2 14 10 22 10 22 11 23 11" /></svg>
 Comment
 <kbd>C</kbd>
 </span>
 <span className="lm-popup__connected">
 <span className="dot" />
 acme-web
 <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style={{ color: "#9ca3af" }}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
 </span>
 </div>
 </div>
 );
}

export function LMTaskCard({ task }) {
 const cls = `lm-card ${task.status === "done" ? "lm-card--done" : ""}`;
 const pill = `lm-card__pill lm-card__pill--${task.status === "to do" ? "todo" : task.status}`;
 return (
 <div className={cls}>
 <div className="lm-card__top">
 <div className="lm-card__top-left">
 <span className={pill}>{task.status}</span>
 <span className="lm-card__time">{task.time}</span>
 </div>
 <div className="lm-card__actions">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
 </div>
 </div>
 <div className="lm-card__body">{task.comment}</div>
 <div className="lm-card__meta">
 <span className="lm-card__label">{task.label}</span>
 <span className="lm-card__sel">{task.selector}</span>
 </div>
 </div>
 );
}

// Faux host-app screenshot
export function FakeApp({ accent = "indigo", highlightedCard = null }) {
 const accentColors = {
 indigo: "linear-gradient(135deg, #6366f1, #8b5cf6)",
 teal: "linear-gradient(135deg, #14b8a6, #0ea5e9)",
 rose: "linear-gradient(135deg, #f43f5e, #ec4899)",
 };
 return (
 <div className="fakeapp">
 <div className="fakeapp__sidebar">
 <div className="fakeapp__brand">
 <span className="fakeapp__brand-mark" style={{ background: accentColors[accent] }} />
 Acme.io
 </div>
 {[
 { label: "Dashboard", active: true },
 { label: "Customers", active: false },
 { label: "Invoices", active: false },
 { label: "Reports", active: false },
 { label: "Settings", active: false },
 ].map((item) => (
 <div key={item.label} className={`fakeapp__nav-item ${item.active ? "fakeapp__nav-item--active" : ""}`}>
 <span className="dot" />
 {item.label}
 </div>
 ))}
 </div>
 <div className="fakeapp__main">
 <h1 className="fakeapp__h1">Dashboard</h1>
 <p className="fakeapp__sub">Here's what's happening with your team today.</p>

 <div className="fakeapp__cards">
 {[
 { label: "Open", value: "128", delta: "+12 this week" },
 { label: "In Progress", value: "42", delta: "+4 today" },
 { label: "Resolved", value: "1,204", delta: "+38 this week" },
 ].map((c, i) => {
 const isHi = highlightedCard === i + 1;
 return (
 <div key={c.label} className="fakeapp__card" style={isHi ? { position: "relative", border: "2px solid #3b82f6", boxShadow: "0 0 0 4px rgba(59,130,246,0.18)" } : null}>
 {isHi ? <span className="lm-highlight__tag" style={{ top: -22, left: -2 }}>&lt;StatCard label="{c.label}" /&gt;</span> : null}
 <div className="label">{c.label}</div>
 <div className="value">{c.value}</div>
 <div className="delta">{c.delta}</div>
 </div>
 );
 })}
 </div>

 <div className="fakeapp__panel">
 <div className="fakeapp__panel-title">Recent activity</div>
 {[
 { name: "Sarah Chen", action: "shipped onboarding flow", status: "live" },
 { name: "Marcus Wong", action: "updated billing copy", status: "live" },
 { name: "Priya Patel", action: "fixed mobile nav", status: "review" },
 { name: "Diego López", action: "designed empty states", status: "live" },
 ].map((row) => (
 <div key={row.name} className="fakeapp__row">
 <span className="name">
 <span className="avatar" />
 {row.name}
 <span style={{ color: "#6b7280", fontWeight: 400 }}>· {row.action}</span>
 </span>
 <span className={`pill ${row.status === "review" ? "warn" : ""}`}>{row.status}</span>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
}

export function BrowserShell({ url = "https://localhost:3000/dashboard", children, height }) {
 return (
 <div className="lm-browser" style={{ height }}>
 <div className="lm-browser__bar">
 <div className="lm-browser__dots"><span /><span /><span /></div>
 <div className="lm-browser__url">
 <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
 {url}
 </div>
 <div style={{ width: 60 }} />
 </div>
 <div className="lm-browser__body" style={{ height: "calc(100% - 53px)" }}>
 {children}
 </div>
 </div>
 );
}

// (migration) Components above are ES-module `export`s — the former
// `Object.assign(window, …)` is no longer needed.
