export const meta = {
  dimensions: { width: 1200, height: 675 },
  label: 'Product Hunt launch',
  tags: ['product-hunt', 'launch', 'announcement'],
  propsSchema: {
    productName: { type: 'string', default: 'Your product', required: true },
    tagline: { type: 'string', default: 'A short, punchy description of what you do.' },
    upvotes: { type: 'string', default: '847' },
    rank: { type: 'string', default: '#1 Product of the Day' },
  },
};

export default function ProductHuntLaunch({
  productName = 'Your product',
  tagline = 'A short, punchy description of what you do.',
  upvotes = '847',
  rank = '#1 Product of the Day',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '72px 80px',
      background: 'linear-gradient(135deg, #1A0F0A 0%, #2D1810 50%, #3A1F12 100%)',
      color: '#FFF',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{
        position: 'absolute',
        top: -240,
        right: -240,
        width: 720,
        height: 720,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(218,85,47,0.45), transparent 65%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: -140,
        left: -140,
        width: 480,
        height: 480,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(218,85,47,0.15), transparent 65%)',
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 18px',
          background: '#DA552F',
          borderRadius: 100,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.18em',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#FFF' }} />
          LIVE ON PRODUCT HUNT
        </div>
        <div style={{
          fontSize: 14,
          opacity: 0.6,
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.05em',
        }}>
          {rank}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 112,
          fontWeight: 900,
          lineHeight: 0.92,
          letterSpacing: '-0.045em',
          textWrap: 'balance',
        }}>
          {productName}
        </div>
        <div style={{
          fontSize: 26,
          marginTop: 22,
          opacity: 0.72,
          lineHeight: 1.4,
          maxWidth: '72%',
          fontWeight: 500,
        }}>
          {tagline}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #DA552F 0%, #B83A18 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
            fontWeight: 800,
            boxShadow: '0 8px 24px rgba(218,85,47,0.4)',
          }}>▲</div>
          <div>
            <div style={{
              fontSize: 40,
              fontWeight: 900,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}>
              {upvotes}
            </div>
            <div style={{
              fontSize: 13,
              opacity: 0.55,
              letterSpacing: '0.2em',
              marginTop: 4,
              fontWeight: 600,
            }}>UPVOTES</div>
          </div>
        </div>
        <div style={{
          fontSize: 18,
          fontWeight: 700,
          color: '#DA552F',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          producthunt.com →
        </div>
      </div>
    </div>
  );
}
