export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Feature launch — typography poster',
  tags: ['poster', 'announcement', 'feature'],
  propsSchema: {
    feature: { type: 'string', default: 'Multiplayer', required: true },
    version: { type: 'string', default: 'V2' },
    issueDate: { type: 'string', default: 'AUTUMN 26' },
    footnote: { type: 'string', default: 'A new way to design together. Available now.' },
  },
};

export default function FeatureLaunchPoster({
  feature = 'Multiplayer',
  version = 'V2',
  issueDate = 'AUTUMN 26',
  footnote = 'A new way to design together. Available now.',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F0EAD9',
      color: '#181614',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Cherry color block — bottom 38% */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '38%',
        background: '#C4392F',
      }} />

      {/* Top eyebrow */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        opacity: 0.8,
      }}>
        <span>Introducing · {issueDate}</span>
        <span>{version}</span>
      </div>

      {/* Massive feature name — stacked, overflowing */}
      <div style={{
        position: 'relative',
        marginTop: 80,
        zIndex: 1,
      }}>
        <div style={{
          fontSize: 360,
          fontWeight: 900,
          lineHeight: 0.82,
          letterSpacing: '-0.06em',
          color: '#181614',
          textTransform: 'lowercase',
          textIndent: '-12px',
        }}>
          {feature.toLowerCase()}.
        </div>
      </div>

      {/* Outlined echo of feature word, rotated */}
      <div style={{
        position: 'absolute',
        right: -90,
        top: 380,
        fontSize: 240,
        fontWeight: 900,
        letterSpacing: '-0.05em',
        lineHeight: 1,
        color: 'transparent',
        WebkitTextStroke: '2px rgba(24,22,20,0.18)',
        transform: 'rotate(-8deg)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        new
      </div>

      {/* Footnote on the cherry block */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 80,
        color: '#F0EAD9',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 32,
      }}>
        <div style={{
          fontSize: 36,
          fontWeight: 500,
          lineHeight: 1.15,
          letterSpacing: '-0.015em',
          maxWidth: '70%',
          fontStyle: 'italic',
        }}>
          {footnote}
        </div>
        <div style={{
          fontSize: 64,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          lineHeight: 0.9,
          textAlign: 'right',
          color: '#F0EAD9',
        }}>
          →
        </div>
      </div>

      {/* Tick marks bottom-left */}
      <div style={{
        position: 'absolute',
        left: 72,
        bottom: 36,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 12,
        letterSpacing: '0.3em',
        color: 'rgba(240,234,217,0.65)',
      }}>
        001 / 001
      </div>
    </div>
  );
}
