// SPIKE — throwaway prototype. Excluded from vite build.
// Superseded by the real hosted runtime. Do not import from production code.
//
// A minimal fixture component used to exercise the Sucrase + service-worker path.
// This file lives outside `src/` intentionally — it is read via the File System
// Access API directory handle, transformed in-browser with Sucrase, and served by
// the spike's module-sw.js service worker.
//
// Edit the return value below (in the browser's dev console or directly in the
// file), save, and watch the save→re-render latency.

export default function SpikeCard() {
 return (
 <div
 style={{
 width: 320,
 height: 200,
 boxSizing: 'border-box',
 padding: 28,
 display: 'flex',
 flexDirection: 'column',
 justifyContent: 'space-between',
 background: 'linear-gradient(135deg, #6366f1, #ec4899)',
 borderRadius: 12,
 color: '#ffffff',
 fontFamily: 'system-ui, sans-serif',
 boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
 }}
 >
 <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.8 }}>
 Lerret Spike
 </div>
 <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' }}>
 Live Edit ✓
 </div>
 <div style={{ fontSize: 12, opacity: 0.75 }}>
 Edit this file → save → watch re-render
 </div>
 </div>
 );
}
