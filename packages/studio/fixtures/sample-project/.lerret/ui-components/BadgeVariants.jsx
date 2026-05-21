// Fixture asset — a single file that yields MULTIPLE artboards via named
// exports (FR10).
//
// This is *user content*. The default export is the primary variant; each
// component-valued named export (`Solid`, `Outline`, `Ghost`) becomes its own
// variant artboard. So the vite-runtime resolves this one file into FOUR
// entries — one per export — proving the 1..N variants behaviour.

/** Shared chrome — a centered pill so each variant reads as a clear artboard. */
function Pill({ children, style }) {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: '#faf8f4',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 <span
 style={{
 padding: '8px 18px',
 borderRadius: 999,
 fontSize: 14,
 fontWeight: 600,
 letterSpacing: '0.01em',
 ...style,
 }}
 >
 {children}
 </span>
 </div>
 );
}

// Primary variant — the default export.
export default function Badge() {
 return <Pill style={{ background: '#1f2937', color: '#f8fafc' }}>Default</Pill>;
}

// Named-export variant #1.
export function Solid() {
 return <Pill style={{ background: '#2563eb', color: '#ffffff' }}>Solid</Pill>;
}

// Named-export variant #2.
export function Outline() {
 return (
 <Pill style={{ background: 'transparent', color: '#2563eb', border: '2px solid #2563eb' }}>
 Outline
 </Pill>
 );
}

// Named-export variant #3.
export function Ghost() {
 return <Pill style={{ background: '#eef2ff', color: '#4338ca' }}>Ghost</Pill>;
}
