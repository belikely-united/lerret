// Clock.jsx — a dynamic fixture asset for the auto-refresh demo.
//
// This component renders the current local time. Because it always reads
// `new Date()` on render, it appears frozen in a static artboard — but
// combined with a co-located `Clock.config.json` of `{ "autoRefresh": 1000 }`,
// the studio re-renders this artboard every second and the time updates live.

export default function Clock() {
 const time = new Date().toLocaleTimeString();
 return (
 <div
 style={{
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 width: 320,
 height: 120,
 background: '#1a1714',
 borderRadius: 12,
 fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
 fontSize: 40,
 fontWeight: 700,
 letterSpacing: 4,
 color: '#f0e8d0',
 userSelect: 'none',
 }}
 >
 {time}
 </div>
 );
}
