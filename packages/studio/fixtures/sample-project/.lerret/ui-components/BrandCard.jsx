// BrandCard.jsx — vars-injection fixture asset.
//
// Demonstrates CSS custom properties injected via the `vars` block in the
// parent folder's `config.json`:
//
// {
// "vars": {
// "brandColor": "#B85B33",
// "maxWidth": "1200px"
// }
// }
//
// The component references `var(--brandColor)` directly in its inline style,
// which resolves to the injected value at render time. No import of a shared
// module is needed — the artboard wrapper supplies the property via its own
// CSS scope.

export const meta = {
 dimensions: { width: 320, height: 160 },
 label: 'Brand Card (vars demo)',
 tags: ['brand', 'vars'],
 propsSchema: {
  kicker: {
   type: 'string',
   default: 'vars demo',
   description: 'Small uppercase eyebrow label.',
  },
  title: {
   type: 'string',
   default: 'Brand Card',
   description: 'Card title line.',
  },
 },
};

export default function BrandCard({ kicker = 'vars demo', title = 'Brand Card' }) {
 return (
 <div
 data-brand-card
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: 24,
 display: 'flex',
 flexDirection: 'column',
 justifyContent: 'center',
 gap: 10,
 background: 'var(--brandColor, #888)',
 color: '#fff',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 borderRadius: 4,
 }}
 >
 <div
 style={{
 fontSize: 11,
 fontWeight: 700,
 letterSpacing: '0.14em',
 textTransform: 'uppercase',
 opacity: 0.85,
 }}
 >
 {kicker}
 </div>
 <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
 {title}
 </div>
 <div style={{ fontSize: 12, opacity: 0.75 }}>
 Background uses <code style={{ fontFamily: 'monospace' }}>var(--brandColor)</code>
 {' '}from the folder config.
 </div>
 </div>
 );
}
