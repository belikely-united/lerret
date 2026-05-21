export const meta = {
  dimensions: { width: 1080, height: 1350 },
  label: 'Manifesto / quote poster',
  tags: ['poster', 'manifesto', 'social'],
  propsSchema: {
    statement: { type: 'string', default: 'Design tools should not require permission.', required: true },
    byline: { type: 'string', default: 'Belikely United' },
    date: { type: 'string', default: 'MMXXVI' },
  },
};

export default function ManifestoPoster({
  statement = 'Design tools should not require permission.',
  byline = 'Belikely United',
  date = 'MMXXVI',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0C0C0C',
      color: '#F2EEE5',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '72px',
    }}>
      {/* Pink slash block */}
      <div style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '38%',
        width: 8,
        background: '#FF4A8C',
      }} />

      {/* Top: tag mark */}
      <div style={{
        position: 'relative',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.35em',
        textTransform: 'uppercase',
        color: '#FF4A8C',
        fontWeight: 700,
      }}>
        ✦ Manifesto · {date}
      </div>

      {/* Giant statement */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: '20%',
        bottom: '20%',
        display: 'flex',
        alignItems: 'center',
      }}>
        <div style={{
          fontSize: 84,
          fontWeight: 900,
          lineHeight: 0.94,
          letterSpacing: '-0.035em',
          color: '#F2EEE5',
        }}>
          {statement.split(' ').map((word, i, arr) => {
            const isLast = i === arr.length - 1;
            const period = isLast && /[.!?]$/.test(word);
            const baseWord = period ? word.slice(0, -1) : word;
            return (
              <span key={i}>
                {baseWord}
                {period && (
                  <span style={{ color: '#FF4A8C' }}>{word.slice(-1)}</span>
                )}
                {!isLast && ' '}
              </span>
            );
          })}
        </div>
      </div>

      {/* Bottom strip */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 72,
        borderTop: '1px solid rgba(242,238,229,0.3)',
        paddingTop: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 22,
          fontStyle: 'italic',
        }}>
          — {byline}
        </div>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          color: 'rgba(242,238,229,0.55)',
        }}>
          File under: belief
        </div>
      </div>
    </div>
  );
}
