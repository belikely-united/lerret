// Fixture asset — a plain `.jsx` component with a default export.
//
// This is *user content*: the kind of file a Lerret user would put in their
// `.lerret/` folder. The vite-runtime loads it as a real ES module through the
// Vite dev server and renders its default export as an artboard.

export default function StatCard() {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: 28,
 display: 'flex',
 flexDirection: 'column',
 justifyContent: 'space-between',
 background: 'linear-gradient(160deg, #1f2937, #0f172a)',
 color: '#f8fafc',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 <div
 style={{
 fontSize: 11,
 fontWeight: 600,
 letterSpacing: '0.14em',
 textTransform: 'uppercase',
 color: '#94a3b8',
 }}
 >
 Monthly active
 </div>
 <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em' }}>
 12,408
 </div>
 <div style={{ fontSize: 13, color: '#34d399' }}>+18.2% vs last month</div>
 </div>
 );
}
