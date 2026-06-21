// "/now" page hero (1200 × 400). The wide banner atop a /now page.

export const meta = {
  dimensions: { width: 1200, height: 400 },
  label: '/now page hero',
  tags: ['site', 'now', 'hero', 'banner'],
  propsSchema: {
    month: { type: 'string', default: 'June 2026', description: 'Big month label.' },
    headline: { type: 'string', default: 'Building Lerret. Walking lots. Reading Borges.', description: 'Status line.', required: true },
    location: { type: 'string', default: 'Bangalore, India', description: 'Current location.' },
  },
};

export default function NowHero({
  month = 'June 2026',
  headline = 'Building Lerret. Walking lots. Reading Borges.',
  location = 'Bangalore, India',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralLight, #F8F4EC)',
        color: 'var(--neutralDark, #1A1714)',
        padding: '48px 64px',
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        alignItems: 'center',
        gap: 56,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ position: 'absolute', inset: 24, border: '1px solid color-mix(in oklab, var(--neutralDark, #1A1714) 12%, transparent)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
        <div style={{ fontSize: 16, letterSpacing: '0.32em', textTransform: 'uppercase', color: 'var(--brandColor, #B85B33)' }}>◆ /now</div>
        <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.025em', color: 'var(--brandColor, #B85B33)' }}>{month}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
        <div style={{ fontSize: 38, fontWeight: 500, lineHeight: 1.15, letterSpacing: '-0.015em', maxWidth: 760 }}>{headline}</div>
        <div style={{ fontSize: 18, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)' }}>location · {location}</div>
      </div>
    </div>
  );
}
