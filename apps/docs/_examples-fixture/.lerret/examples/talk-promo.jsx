export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Talk promo — marquee poster',
  tags: ['poster', 'talk', 'conference'],
  propsSchema: {
    conference: { type: 'string', default: 'React Conf 26' },
    talkTitle: { type: 'string', default: 'How we shipped multiplayer in three weeks.', required: true },
    speaker: { type: 'string', default: 'Sooryagangaraj' },
    role: { type: 'string', default: 'Founder · Lerret' },
    date: { type: 'string', default: 'Oct 17' },
    time: { type: 'string', default: '14:30 PST' },
    venue: { type: 'string', default: 'Henderson, NV' },
    topic1: { type: 'string', default: 'CRDT internals' },
    topic2: { type: 'string', default: 'Cursor presence' },
    topic3: { type: 'string', default: 'Conflict resolution' },
  },
};

export default function TalkPoster({
  conference = 'React Conf 26',
  talkTitle = 'How we shipped multiplayer in three weeks.',
  speaker = 'Sooryagangaraj',
  role = 'Founder · Lerret',
  date = 'Oct 17',
  time = '14:30 PST',
  venue = 'Henderson, NV',
  topic1 = 'CRDT internals',
  topic2 = 'Cursor presence',
  topic3 = 'Conflict resolution',
}) {
  const topics = [topic1, topic2, topic3].filter(Boolean);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0F0A2A',
      color: '#F2E6C9',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Sunset radial glow anchored bottom-center */}
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: -260,
        transform: 'translateX(-50%)',
        width: 1500,
        height: 800,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(232,165,63,0.5), transparent 65%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Hairline frame */}
      <div style={{
        position: 'absolute',
        inset: '32px 40px',
        border: '1px solid rgba(242,230,201,0.22)',
        pointerEvents: 'none',
      }} />

      {/* MASTHEAD top center */}
      <div style={{
        position: 'relative',
        textAlign: 'center',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.4em',
        textTransform: 'uppercase',
        color: 'rgba(242,230,201,0.7)',
      }}>
        — {conference} —
      </div>

      {/* HERO — talk title as the visual centerpiece */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: 180,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          letterSpacing: '0.5em',
          fontWeight: 700,
          color: '#E8A53F',
          textTransform: 'uppercase',
          marginBottom: 28,
        }}>
          ✦ Live · One Night Only
        </div>
        <div style={{
          fontSize: 84,
          fontWeight: 400,
          fontStyle: 'italic',
          letterSpacing: '-0.028em',
          lineHeight: 1.02,
          color: '#F2E6C9',
          textWrap: 'balance',
        }}>
          “{talkTitle}”
        </div>
      </div>

      {/* MARQUEE divider — sunset band acting as the "stage" */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '58%',
        height: 5,
        background: 'linear-gradient(90deg, transparent 0%, #E8A53F 30%, #FFE5A8 50%, #E8A53F 70%, transparent 100%)',
      }} />

      {/* SPEAKER block — below the stage */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: '62%',
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12,
          letterSpacing: '0.5em',
          fontWeight: 700,
          color: 'rgba(242,230,201,0.55)',
          textTransform: 'uppercase',
          marginBottom: 18,
        }}>
          A talk by
        </div>
        <div style={{
          fontSize: 96,
          fontWeight: 400,
          fontStyle: 'italic',
          letterSpacing: '-0.04em',
          lineHeight: 1,
          color: '#F2E6C9',
        }}>
          {speaker}
        </div>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 14,
          letterSpacing: '0.3em',
          color: '#E8A53F',
          textTransform: 'uppercase',
          marginTop: 14,
          fontWeight: 700,
        }}>
          {role}
        </div>
      </div>

      {/* TOPICS row */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 230,
        textAlign: 'center',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        letterSpacing: '0.25em',
        color: 'rgba(242,230,201,0.65)',
        fontWeight: 600,
        textTransform: 'uppercase',
      }}>
        {topics.join('   ✦   ')}
      </div>

      {/* TICKET STRIP — date / time / venue */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 96,
        borderTop: '1px solid rgba(242,230,201,0.35)',
        paddingTop: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 11,
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.5)',
            marginBottom: 8,
          }}>Date</div>
          <div style={{ fontSize: 30, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.015em' }}>
            {date}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 11,
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.5)',
            marginBottom: 8,
          }}>Time</div>
          <div style={{ fontSize: 30, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.015em' }}>
            {time}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 11,
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.5)',
            marginBottom: 8,
          }}>Venue</div>
          <div style={{ fontSize: 30, fontWeight: 400, fontStyle: 'italic', letterSpacing: '-0.015em' }}>
            {venue}
          </div>
        </div>
      </div>
    </div>
  );
}
