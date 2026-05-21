export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Stars milestone — constellation poster',
  tags: ['poster', 'milestone', 'github'],
  propsSchema: {
    count: { type: 'string', default: '10,000' },
    label: { type: 'string', default: 'STARS' },
    handle: { type: 'string', default: '@belikely-united/lerret' },
    note: { type: 'string', default: 'with thanks, everyone' },
  },
};

const STARS = [
  [8, 12, 4], [22, 22, 2], [40, 8, 3], [60, 18, 5], [78, 12, 3], [92, 22, 4],
  [12, 35, 2], [88, 38, 2], [4, 52, 3], [96, 56, 2],
  [10, 75, 5], [25, 88, 3], [42, 92, 2], [58, 82, 4], [75, 90, 3], [90, 78, 5],
  [50, 60, 2], [30, 50, 3], [70, 48, 2],
];

export default function StarsPoster({
  count = '10,000',
  label = 'STARS',
  handle = '@belikely-united/lerret',
  note = 'with thanks, everyone',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0B1426',
      color: '#F5EBD8',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '72px',
    }}>
      {/* Star field */}
      {STARS.map(([x, y, size], i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: size,
          height: size,
          background: '#F5EBD8',
          borderRadius: '50%',
          boxShadow: `0 0 ${size * 3}px rgba(245,235,216,0.8)`,
          opacity: 0.5 + (i % 5) * 0.1,
        }} />
      ))}

      {/* Hairline frame */}
      <div style={{
        position: 'absolute',
        inset: '40px',
        border: '1px solid rgba(245,235,216,0.18)',
        pointerEvents: 'none',
      }} />

      {/* Top header */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.35em',
        textTransform: 'uppercase',
        color: 'rgba(245,235,216,0.65)',
      }}>
        <span>★ Milestone Unlocked</span>
        <span>MMXXVI</span>
      </div>

      {/* Outlined STARS vertical text */}
      <div style={{
        position: 'absolute',
        left: 56,
        top: '50%',
        transform: 'translateY(-50%) rotate(-90deg)',
        transformOrigin: 'left center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 22,
        fontWeight: 800,
        letterSpacing: '0.5em',
        color: 'transparent',
        WebkitTextStroke: '1px rgba(245,235,216,0.55)',
      }}>
        {label} · {label} · {label}
      </div>

      {/* Center: big number */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12,
          letterSpacing: '0.6em',
          color: 'rgba(245,235,216,0.5)',
          marginBottom: 18,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}>
          We just crossed
        </div>
        <div style={{
          fontSize: 280,
          fontWeight: 400,
          letterSpacing: '-0.05em',
          lineHeight: 0.85,
          fontStyle: 'italic',
          color: '#F5EBD8',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </div>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 18,
          letterSpacing: '0.5em',
          color: '#F5EBD8',
          marginTop: 24,
          textTransform: 'uppercase',
          fontWeight: 800,
        }}>
          {label} on GitHub
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 64,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.2em',
        color: 'rgba(245,235,216,0.6)',
      }}>
        <span>{handle}</span>
        <span style={{ fontStyle: 'italic', letterSpacing: '0.05em', fontFamily: 'Georgia, serif' }}>
          {note}
        </span>
      </div>
    </div>
  );
}
