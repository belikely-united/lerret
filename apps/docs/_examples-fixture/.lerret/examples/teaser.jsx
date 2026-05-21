export const meta = {
  dimensions: { width: 1080, height: 1350 },
  label: 'Pre-launch teaser',
  tags: ['poster', 'teaser', 'pre-launch'],
  propsSchema: {
    company: { type: 'string', default: 'BELIKELY' },
    word: { type: 'string', default: 'Soon', required: true },
    date: { type: 'string', default: '12.15.26' },
    footnote: { type: 'string', default: 'Something new for people who write design instead of clicking it.' },
  },
};

export default function Teaser({
  company = 'BELIKELY',
  word = 'Soon',
  date = '12.15.26',
  footnote = 'Something new for people who write design instead of clicking it.',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0A0608',
      color: '#F2E6C9',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '72px',
    }}>
      {/* Soft amber bloom — center */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '52%',
        transform: 'translate(-50%, -50%)',
        width: 900,
        height: 900,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(232,165,63,0.18), transparent 60%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Hairline frame */}
      <div style={{
        position: 'absolute',
        inset: '32px 40px',
        border: '1px solid rgba(242,230,201,0.18)',
        pointerEvents: 'none',
      }} />

      {/* Top: company mark + waitlist tag */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 12,
        letterSpacing: '0.45em',
        textTransform: 'uppercase',
        color: 'rgba(242,230,201,0.7)',
        fontWeight: 700,
      }}>
        <span>{company}</span>
        <span style={{ color: '#E8A53F' }}>◆ Coming</span>
      </div>

      {/* HUGE outlined word — the centerpiece */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          fontSize: 320,
          fontWeight: 400,
          fontStyle: 'italic',
          letterSpacing: '-0.05em',
          lineHeight: 0.85,
          color: 'transparent',
          WebkitTextStroke: '2px #F2E6C9',
          textShadow: '0 0 64px rgba(242,230,201,0.15)',
        }}>
          {word.toLowerCase()}.
        </div>
      </div>

      {/* Decorative date stamp — top right corner */}
      <div style={{
        position: 'absolute',
        top: '24%',
        right: 96,
        transform: 'rotate(8deg)',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 10,
          letterSpacing: '0.4em',
          color: '#E8A53F',
          fontWeight: 700,
          marginBottom: 4,
        }}>
          Save the date
        </div>
        <div style={{
          fontSize: 36,
          fontWeight: 400,
          fontStyle: 'italic',
          color: '#F2E6C9',
          letterSpacing: '-0.02em',
        }}>
          {date}
        </div>
      </div>

      {/* Footnote */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 96,
        textAlign: 'center',
        fontSize: 22,
        fontStyle: 'italic',
        lineHeight: 1.4,
        color: 'rgba(242,230,201,0.75)',
        maxWidth: '78%',
        margin: '0 auto',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }}>
        {footnote}
      </div>

      {/* Bottom rule */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 60,
        borderTop: '1px solid rgba(242,230,201,0.25)',
      }} />

      {/* Tag bottom */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 36,
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 11,
        letterSpacing: '0.35em',
        color: 'rgba(242,230,201,0.45)',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}>
        <span>Join the waitlist</span>
        <span>belikely.com/soon</span>
      </div>
    </div>
  );
}
