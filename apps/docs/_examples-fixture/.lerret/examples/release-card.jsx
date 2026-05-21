export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'Release graphic',
  tags: ['release', 'changelog'],
  propsSchema: {
    version: { type: 'string', default: 'v0.1.0', required: true },
    title: { type: 'string', default: 'Release title' },
    bullets: {
      type: 'string',
      default: 'First highlight\nSecond highlight\nThird highlight',
      description: 'One highlight per line. Up to five render cleanly.',
    },
  },
};

export default function ReleaseCard({
  version = 'v0.1.0',
  title = 'Release title',
  bullets = 'First highlight\nSecond highlight\nThird highlight',
}) {
  const lines = bullets.split('\n').filter(Boolean).slice(0, 5);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '64px 80px',
      background: 'linear-gradient(135deg, #1B2A3B 0%, #3D5A80 100%)',
      color: '#F4F7FA',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div>
        <div style={{
          fontSize: 22,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: '#8BAEC8',
        }}>
          Release · {version}
        </div>
        <div style={{
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.05,
          marginTop: 16,
          letterSpacing: '-0.025em',
          textWrap: 'balance',
        }}>
          {title}
        </div>
      </div>
      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}>
        {lines.map((line, i) => (
          <li key={i} style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 20,
            fontSize: 28,
          }}>
            <span style={{ color: '#8BAEC8', fontVariantNumeric: 'tabular-nums', minWidth: 28 }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span style={{ lineHeight: 1.35 }}>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
