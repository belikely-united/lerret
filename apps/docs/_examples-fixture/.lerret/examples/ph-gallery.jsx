export const meta = {
  dimensions: { width: 1270, height: 760 },
  label: 'Product Hunt gallery image',
  tags: ['poster', 'product-hunt', 'feature-card'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'Feature 02 of 06' },
    metric: { type: 'string', default: '100×' },
    headline: { type: 'string', default: 'Faster than reaching for Figma.', required: true },
    description: { type: 'string', default: 'Author every social card, OG image, and release graphic in plain React. No vendor file. No round-trip.' },
    detail: { type: 'string', default: 'lerret.belikely.com' },
  },
};

export default function PhGallery({
  eyebrow = 'Feature 02 of 06',
  metric = '100×',
  headline = 'Faster than reaching for Figma.',
  description = 'Author every social card, OG image, and release graphic in plain React. No vendor file. No round-trip.',
  detail = 'lerret.belikely.com',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F2EEE5',
      color: '#1A1410',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
    }}>
      {/* LEFT: text column */}
      <div style={{
        flex: 1.2,
        padding: '64px 56px 64px 72px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
      }}>
        {/* Eyebrow */}
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: '#B85B33',
          fontWeight: 700,
        }}>
          ◆ {eyebrow}
        </div>

        {/* Headline + supporting */}
        <div>
          <div style={{
            fontSize: 50,
            fontWeight: 900,
            lineHeight: 1.02,
            letterSpacing: '-0.03em',
            textWrap: 'balance',
            maxWidth: '94%',
          }}>
            {headline}
          </div>
          <div style={{
            fontSize: 20,
            marginTop: 22,
            lineHeight: 1.5,
            color: '#3A2820',
            maxWidth: '90%',
            fontWeight: 500,
          }}>
            {description}
          </div>
        </div>

        {/* Footer line */}
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 14,
          letterSpacing: '0.2em',
          color: 'rgba(26,20,16,0.55)',
          fontWeight: 600,
        }}>
          → {detail}
        </div>
      </div>

      {/* RIGHT: metric / hero number */}
      <div style={{
        flex: 1,
        background: '#1A1410',
        color: '#F2EEE5',
        padding: '64px 72px 64px 64px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: -160,
          right: -160,
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(184,91,51,0.5), transparent 60%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }} />

        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12,
          letterSpacing: '0.4em',
          textTransform: 'uppercase',
          opacity: 0.55,
          fontWeight: 700,
          position: 'relative',
        }}>
          The Number
        </div>

        <div style={{
          position: 'relative',
          fontSize: 280,
          fontWeight: 900,
          letterSpacing: '-0.06em',
          lineHeight: 0.85,
          fontVariantNumeric: 'tabular-nums',
          background: 'linear-gradient(135deg, #FFE5A8 0%, #E8896C 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {metric}
        </div>

        <div style={{
          position: 'relative',
          fontSize: 18,
          opacity: 0.7,
          lineHeight: 1.4,
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}>
          From open-folder to first artboard.
        </div>
      </div>
    </div>
  );
}
