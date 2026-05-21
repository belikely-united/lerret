export const meta = {
  dimensions: { width: 1200, height: 675 },
  label: 'Conference talk promo',
  tags: ['event', 'talk', 'conference'],
  propsSchema: {
    conference: { type: 'string', default: 'React Conf 2026', required: true },
    talkTitle: { type: 'string', default: 'How we shipped multiplayer in three weeks', required: true },
    speaker: { type: 'string', default: 'Sooryagangaraj' },
    role: { type: 'string', default: 'Founder, Lerret' },
    date: { type: 'string', default: 'Thu, Oct 17' },
    time: { type: 'string', default: '2:30 PM PST' },
  },
};

export default function TalkPromo({
  conference = 'React Conf 2026',
  talkTitle = 'How we shipped multiplayer in three weeks',
  speaker = 'Sooryagangaraj',
  role = 'Founder, Lerret',
  date = 'Thu, Oct 17',
  time = '2:30 PM PST',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '72px 80px',
      background: '#070A1A',
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
        top: '38%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 1100,
        height: 700,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(34,211,238,0.2), transparent 60%)',
        pointerEvents: 'none',
        filter: 'blur(40px)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(34,211,238,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px)',
        backgroundSize: '80px 80px',
        pointerEvents: 'none',
        maskImage: 'linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)',
      }} />

      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <div style={{
          width: 10,
          height: 10,
          background: '#22D3EE',
          transform: 'rotate(45deg)',
          boxShadow: '0 0 16px #22D3EE',
        }} />
        <div style={{
          fontSize: 13,
          letterSpacing: '0.32em',
          color: '#22D3EE',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          {conference.toUpperCase()}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 13,
          letterSpacing: '0.35em',
          color: 'rgba(34,211,238,0.85)',
          marginBottom: 24,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          UPCOMING TALK
        </div>
        <div style={{
          fontSize: 60,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
          maxWidth: '92%',
          textWrap: 'balance',
          background: 'linear-gradient(135deg, #FFF 0%, #B8D8E0 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {talkTitle}
        </div>
      </div>

      <div style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 32,
      }}>
        <div>
          <div style={{
            fontSize: 30,
            fontWeight: 800,
            letterSpacing: '-0.015em',
          }}>
            {speaker}
          </div>
          <div style={{
            fontSize: 18,
            opacity: 0.55,
            marginTop: 4,
            fontWeight: 500,
          }}>
            {role}
          </div>
        </div>
        <div style={{
          textAlign: 'right',
          padding: '20px 28px',
          background: 'rgba(34,211,238,0.08)',
          border: '1px solid rgba(34,211,238,0.3)',
          borderRadius: 14,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            fontSize: 22,
            fontWeight: 800,
            color: '#22D3EE',
            fontFamily: 'ui-monospace, Menlo, monospace',
            letterSpacing: '0.02em',
          }}>
            {date}
          </div>
          <div style={{
            fontSize: 14,
            opacity: 0.7,
            marginTop: 4,
            fontWeight: 500,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}>
            {time}
          </div>
        </div>
      </div>
    </div>
  );
}
