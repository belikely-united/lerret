// Fixture asset — a plain `.jsx` component with a default export.
//
// This is *user content*: the kind of file a Lerret user would put in their
// `.lerret/` folder. The vite-runtime loads it as a real ES module through the
// Vite dev server and renders its default export as an artboard.
//
// It follows the data-driven convention: every visible text string is a
// typed field in meta.propsSchema, the default export reads those as props
// (current text as the defaults), and the real values live in the co-located
// StatCard.data.json — tier 1 of the four-tier prop resolver.

export const meta = {
 propsSchema: {
  label: {
   type: 'string',
   default: 'Monthly active',
   description: 'Small uppercase metric label above the figure.',
  },
  value: {
   type: 'string',
   default: '12,408',
   description: 'The headline metric figure.',
  },
  delta: {
   type: 'string',
   default: '+18.2% vs last month',
   description: 'Change line shown beneath the figure.',
  },
 },
};

export default function StatCard({
 label = 'Monthly active',
 value = '12,408',
 delta = '+18.2% vs last month',
}) {
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
 {label}
 </div>
 <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.03em' }}>
 {value}
 </div>
 <div style={{ fontSize: 13, color: '#34d399' }}>{delta}</div>
 </div>
 );
}
