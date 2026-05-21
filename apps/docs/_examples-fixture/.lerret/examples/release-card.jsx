export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Release — Swiss modernist poster',
  tags: ['poster', 'release', 'announcement'],
  propsSchema: {
    version: { type: 'string', default: '2.0', required: true },
    codename: { type: 'string', default: 'Hydra' },
    headline: { type: 'string', default: 'A new way to ship.' },
    note1: { type: 'string', default: 'Live multiplayer cursors' },
    note2: { type: 'string', default: 'OAuth scopes for tokens' },
    note3: { type: 'string', default: 'Streaming export API' },
    note4: { type: 'string', default: 'Node 22, 3× faster cold-start' },
    date: { type: 'string', default: '11.22.26' },
  },
};

export default function ReleasePoster({
  version = '2.0',
  codename = 'Hydra',
  headline = 'A new way to ship.',
  note1 = 'Live multiplayer cursors',
  note2 = 'OAuth scopes for tokens',
  note3 = 'Streaming export API',
  note4 = 'Node 22, 3× faster cold-start',
  date = '11.22.26',
}) {
  const notes = [note1, note2, note3, note4].filter(Boolean);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F1EEE7',
      color: '#0C0C0C',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Olive accent block — left vertical column */}
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 16,
        background: '#5C6B33',
      }} />

      {/* Top metadata strip */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.25em',
        textTransform: 'uppercase',
        borderBottom: '1px solid #0C0C0C',
        paddingBottom: 14,
      }}>
        <span>The Belikely Bulletin</span>
        <span>{date}</span>
      </div>

      {/* Version section — huge stacked */}
      <div style={{
        position: 'relative',
        marginTop: 56,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 40,
      }}>
        <div style={{
          fontSize: 360,
          fontWeight: 900,
          lineHeight: 0.78,
          letterSpacing: '-0.07em',
          color: '#0C0C0C',
          fontVariantNumeric: 'tabular-nums',
        }}>
          v{version}
        </div>
        <div style={{
          paddingTop: 24,
          flex: 1,
        }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 13,
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: '#5C6B33',
            marginBottom: 8,
            fontWeight: 700,
          }}>
            Codename
          </div>
          <div style={{
            fontSize: 44,
            fontWeight: 400,
            letterSpacing: '-0.02em',
            fontStyle: 'italic',
            fontFamily: 'Georgia, "Times New Roman", serif',
          }}>
            {codename}
          </div>
        </div>
      </div>

      {/* Big headline */}
      <div style={{
        marginTop: 72,
        fontSize: 88,
        fontWeight: 800,
        letterSpacing: '-0.035em',
        lineHeight: 0.95,
        maxWidth: '92%',
      }}>
        {headline}
      </div>

      {/* Bottom: ledger lines */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 80,
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12,
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          marginBottom: 28,
          color: '#5C6B33',
          fontWeight: 700,
        }}>
          ── what's new
        </div>
        {notes.map((n, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(12,12,12,0.25)',
            padding: '14px 0',
            gap: 24,
          }}>
            <span style={{
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              flex: 1,
            }}>
              {n}
            </span>
            <span style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 14,
              letterSpacing: '0.15em',
              color: '#5C6B33',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
            }}>
              0{i + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
