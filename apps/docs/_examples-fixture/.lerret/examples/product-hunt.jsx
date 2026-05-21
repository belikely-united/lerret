export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Product Hunt — launch poster',
  tags: ['poster', 'product-hunt', 'launch'],
  propsSchema: {
    productName: { type: 'string', default: 'Lerret', required: true },
    tagline: { type: 'string', default: 'A folder of React components, rendered as a visual canvas.' },
    launchDate: { type: 'string', default: '11.22.26' },
    issue: { type: 'string', default: 'NO. 001' },
  },
};

export default function ProductHuntPoster({
  productName = 'Lerret',
  tagline = 'A folder of React components, rendered as a visual canvas.',
  launchDate = '11.22.26',
  issue = 'NO. 001',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F5EBD8',
      color: '#1A1410',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '72px 80px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Hairline border just inside the bleed */}
      <div style={{
        position: 'absolute',
        inset: '32px 40px',
        border: '1px solid rgba(26,20,16,0.25)',
        pointerEvents: 'none',
      }} />

      {/* TOP: issue mark + launch ledger */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 14,
        letterSpacing: '0.25em',
        textTransform: 'uppercase',
      }}>
        <span>The Belikely Press · {issue}</span>
        <span>Launch Day Edition</span>
      </div>

      {/* The headline stack */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 88,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          lineHeight: 0.86,
          textTransform: 'uppercase',
          color: '#DA552F',
        }}>
          We're<br />Live<br />on
        </div>
        <div style={{
          fontSize: 220,
          fontWeight: 400,
          letterSpacing: '-0.05em',
          lineHeight: 0.9,
          fontStyle: 'italic',
          marginTop: 8,
          color: '#1A1410',
        }}>
          {productName}.
        </div>
      </div>

      {/* Tagline */}
      <div style={{ position: 'relative', maxWidth: '78%' }}>
        <div style={{
          fontSize: 30,
          lineHeight: 1.3,
          fontWeight: 400,
          fontStyle: 'italic',
          color: '#1A1410',
        }}>
          {tagline}
        </div>
      </div>

      {/* Tour-date strip */}
      <div style={{
        position: 'relative',
        borderTop: '2px solid #1A1410',
        paddingTop: 28,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 18,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
        }}>
          {launchDate} — Upvote Today
        </div>
        <div style={{
          fontSize: 32,
          fontStyle: 'italic',
          fontWeight: 400,
          letterSpacing: '-0.01em',
          color: '#DA552F',
        }}>
          producthunt.com
        </div>
      </div>
    </div>
  );
}
