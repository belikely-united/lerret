export const meta = {
  dimensions: { width: 1200, height: 1260 },
  label: 'Year in review (bento)',
  tags: ['recap', 'stats', 'year-review'],
  propsSchema: {
    year: { type: 'string', default: '2026' },
    company: { type: 'string', default: 'Belikely United' },
    stat1Value: { type: 'string', default: '127,000' },
    stat1Label: { type: 'string', default: 'users onboarded' },
    stat2Value: { type: 'string', default: '$2.4M' },
    stat2Label: { type: 'string', default: 'ARR' },
    stat3Value: { type: 'string', default: '12' },
    stat3Label: { type: 'string', default: 'releases shipped' },
    stat4Value: { type: 'string', default: '847' },
    stat4Label: { type: 'string', default: 'GitHub stars' },
  },
};

export default function YearReview({
  year = '2026',
  company = 'Belikely United',
  stat1Value = '127,000',
  stat1Label = 'users onboarded',
  stat2Value = '$2.4M',
  stat2Label = 'ARR',
  stat3Value = '12',
  stat3Label = 'releases shipped',
  stat4Value = '847',
  stat4Label = 'GitHub stars',
}) {
  const stats = [
    { v: stat1Value, l: stat1Label, bg: '#1B2A3B', accent: '#22D3EE' },
    { v: stat2Value, l: stat2Label, bg: '#2D1810', accent: '#FFC04A' },
    { v: stat3Value, l: stat3Label, bg: '#2A1B3A', accent: '#A78BFA' },
    { v: stat4Value, l: stat4Label, bg: '#0F2A1B', accent: '#34D399' },
  ];
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '80px',
      background: '#0A0A0A',
      color: '#FFF',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      gap: 56,
    }}>
      <div>
        <div style={{
          fontSize: 14,
          letterSpacing: '0.35em',
          opacity: 0.55,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          A YEAR AT {company.toUpperCase()}
        </div>
        <div style={{
          fontSize: 168,
          fontWeight: 900,
          lineHeight: 0.88,
          letterSpacing: '-0.05em',
          marginTop: 18,
          background: 'linear-gradient(135deg, #FFF 0%, #6E6E6E 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {year}
        </div>
        <div style={{
          fontSize: 24,
          opacity: 0.6,
          marginTop: 16,
          fontWeight: 500,
        }}>
          In numbers.
        </div>
      </div>

      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 20,
      }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            padding: 44,
            borderRadius: 28,
            background: s.bg,
            color: '#FFF',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              bottom: -100,
              right: -100,
              width: 280,
              height: 280,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${s.accent}40, transparent 60%)`,
              pointerEvents: 'none',
              filter: 'blur(8px)',
            }} />
            <div style={{
              fontSize: 13,
              letterSpacing: '0.32em',
              opacity: 0.55,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontWeight: 700,
              position: 'relative',
            }}>
              0{i + 1}
            </div>
            <div style={{ position: 'relative' }}>
              <div style={{
                fontSize: 92,
                fontWeight: 900,
                lineHeight: 0.95,
                letterSpacing: '-0.04em',
                fontVariantNumeric: 'tabular-nums',
                color: s.accent,
              }}>
                {s.v}
              </div>
              <div style={{
                fontSize: 19,
                marginTop: 10,
                opacity: 0.85,
                fontWeight: 500,
              }}>
                {s.l}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
