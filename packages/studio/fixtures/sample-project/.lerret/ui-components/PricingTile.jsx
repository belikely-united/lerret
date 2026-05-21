// Fixture asset — a component with a PARTIAL `meta` export: it
// declares `dimensions` only, with no `label`, `tags`, or `propsSchema`.
//
// This is *user content*. It proves NFR8: a `meta` with missing fields is
// never an error — the absent `label` falls back to the file-derived name
// ("PricingTile") while the declared `dimensions` still size the artboard.
// (The sibling fixtures `StatCard.jsx` / `LogoLockup.jsx` cover the
// no-`meta`-at-all case.)

// Partial meta — `dimensions` only. The other three well-known keys are
// deliberately absent; `parseMeta` fills them with defaults.
export const meta = {
 dimensions: { width: 280, height: 340 },
};

export default function PricingTile() {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: 28,
 display: 'flex',
 flexDirection: 'column',
 gap: 14,
 background: '#ffffff',
 border: '1px solid #e7e2d8',
 borderRadius: 14,
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 color: '#1f2937',
 }}
 >
 <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', color: '#9a948a' }}>
 STARTER
 </div>
 <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
 <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em' }}>$0</span>
 <span style={{ fontSize: 14, color: '#6e6960' }}>/mo</span>
 </div>
 <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: '#4b5563' }}>
 <li>Open-source, self-hosted</li>
 <li>Unlimited artboards</li>
 <li>Partial-meta sizing</li>
 </ul>
 </div>
 );
}
