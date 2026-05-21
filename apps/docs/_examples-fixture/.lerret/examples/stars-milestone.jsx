export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'GitHub stars milestone',
  tags: ['github', 'milestone', 'celebration'],
  propsSchema: {
    count: { type: 'string', default: '10,000' },
    label: { type: 'string', default: 'stars on GitHub' },
    repo: { type: 'string', default: 'belikely-united/lerret' },
    thanks: { type: 'string', default: 'Thank you, everyone.' },
  },
};

const STAR_POSITIONS = [
  [12, 15, 3], [88, 8, 2], [20, 82, 4], [95, 72, 3], [45, 28, 2],
  [72, 88, 3], [55, 62, 2], [34, 78, 4], [8, 52, 3], [80, 42, 2],
  [60, 12, 3], [18, 68, 2], [92, 90, 4], [3, 88, 2], [68, 22, 3],
  [40, 90, 2], [85, 30, 3], [10, 30, 2],
];

export default function StarsMilestone({
  count = '10,000',
  label = 'stars on GitHub',
  repo = 'belikely-united/lerret',
  thanks = 'Thank you, everyone.',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '72px 80px',
      background: 'linear-gradient(160deg, #050818 0%, #0F1438 40%, #2A1147 100%)',
      color: '#FFF',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {STAR_POSITIONS.map(([x, y, size], i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: size,
          height: size,
          background: '#FFF',
          borderRadius: '50%',
          opacity: 0.45 + (i % 5) * 0.08,
          boxShadow: '0 0 8px rgba(255,255,255,0.6)',
          pointerEvents: 'none',
        }} />
      ))}

      <div style={{
        position: 'absolute',
        left: '50%',
        top: '52%',
        transform: 'translate(-50%, -50%)',
        width: 900,
        height: 900,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,215,100,0.18), transparent 55%)',
        pointerEvents: 'none',
        filter: 'blur(20px)',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative' }}>
        <span style={{ fontSize: 26, color: '#FFD56B' }}>★</span>
        <div style={{
          fontSize: 13,
          letterSpacing: '0.3em',
          opacity: 0.65,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          MILESTONE
        </div>
      </div>

      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{
          fontSize: 200,
          fontWeight: 900,
          lineHeight: 0.88,
          letterSpacing: '-0.05em',
          fontVariantNumeric: 'tabular-nums',
          background: 'linear-gradient(180deg, #FFF3D0 0%, #FFD56B 70%, #FFA02C 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {count}
        </div>
        <div style={{
          fontSize: 32,
          marginTop: 18,
          opacity: 0.85,
          fontWeight: 500,
          letterSpacing: '-0.01em',
        }}>
          {label}
        </div>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'relative',
      }}>
        <div style={{
          fontSize: 15,
          opacity: 0.5,
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.05em',
        }}>
          github.com/{repo}
        </div>
        <div style={{
          fontSize: 18,
          opacity: 0.7,
          fontStyle: 'italic',
          fontWeight: 500,
        }}>
          {thanks}
        </div>
      </div>
    </div>
  );
}
