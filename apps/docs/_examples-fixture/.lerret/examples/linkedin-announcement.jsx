export const meta = {
  dimensions: { width: 1200, height: 627 },
  label: 'LinkedIn announcement post',
  tags: ['poster', 'linkedin', 'announcement'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'We are excited to share' },
    figure: { type: 'string', default: '$10M', required: true },
    label: { type: 'string', default: 'Series A' },
    body: { type: 'string', default: 'Led by Bedrock Capital, with participation from Boom and existing investors. Thank you to our team, our customers, and the open-source community.' },
    company: { type: 'string', default: 'BELIKELY UNITED' },
  },
};

export default function LinkedInAnnouncement({
  eyebrow = 'We are excited to share',
  figure = '$10M',
  label = 'Series A',
  body = 'Led by Bedrock Capital, with participation from Boom and existing investors. Thank you to our team, our customers, and the open-source community.',
  company = 'BELIKELY UNITED',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F4F1EA',
      color: '#0A1228',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '56px 72px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Hairline frame */}
      <div style={{
        position: 'absolute',
        inset: '28px 36px',
        border: '1px solid rgba(10,18,40,0.18)',
        pointerEvents: 'none',
      }} />

      {/* Top masthead */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}>
        <span style={{ color: '#0A1228' }}>{company}</span>
        <span style={{ color: '#1F4D7A' }}>Announcement · MMXXVI</span>
      </div>

      {/* Hero — eyebrow + figure */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 32 }}>
        <div style={{
          fontStyle: 'italic',
          fontSize: 26,
          color: '#1F4D7A',
          fontWeight: 400,
          maxWidth: 280,
          lineHeight: 1.2,
          flexShrink: 0,
        }}>
          {eyebrow}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 180,
            fontWeight: 900,
            letterSpacing: '-0.06em',
            lineHeight: 0.85,
            color: '#0A1228',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {figure}
          </div>
          <div style={{
            fontStyle: 'italic',
            fontSize: 40,
            color: '#1F4D7A',
            fontWeight: 400,
            letterSpacing: '-0.015em',
            marginTop: 4,
          }}>
            {label}.
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{
        position: 'relative',
        fontSize: 18,
        lineHeight: 1.55,
        color: '#0A1228',
        opacity: 0.8,
        maxWidth: '85%',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 500,
      }}>
        {body}
      </div>

      {/* Bottom rule + signoff */}
      <div style={{
        position: 'relative',
        borderTop: '1px solid #0A1228',
        paddingTop: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 12,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'rgba(10,18,40,0.55)',
      }}>
        <span>— With gratitude</span>
        <span>belikely.com</span>
      </div>
    </div>
  );
}
