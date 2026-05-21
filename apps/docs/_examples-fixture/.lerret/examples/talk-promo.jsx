export const meta = {
  dimensions: { width: 1200, height: 1800 },
  label: 'Talk promo — tour poster',
  tags: ['poster', 'talk', 'conference'],
  propsSchema: {
    speaker: { type: 'string', default: 'Sooryagangaraj', required: true },
    conference: { type: 'string', default: 'React Conf 26' },
    venue: { type: 'string', default: 'Henderson, NV' },
    date: { type: 'string', default: 'Oct 17' },
    time: { type: 'string', default: '14:30 PST' },
    talkTitle: { type: 'string', default: 'How we shipped multiplayer in three weeks.' },
    topic1: { type: 'string', default: 'CRDT internals' },
    topic2: { type: 'string', default: 'Cursor presence' },
    topic3: { type: 'string', default: 'Conflict resolution' },
  },
};

export default function TalkPoster({
  speaker = 'Sooryagangaraj',
  conference = 'React Conf 26',
  venue = 'Henderson, NV',
  date = 'Oct 17',
  time = '14:30 PST',
  talkTitle = 'How we shipped multiplayer in three weeks.',
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
      background: '#1A0F2E',
      color: '#F2E6C9',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '72px 80px',
    }}>
      {/* Sunset color band */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: '40%',
        height: '8%',
        background: 'linear-gradient(180deg, #F2E6C9 0%, #E8A53F 100%)',
      }} />

      {/* Hairline frame */}
      <div style={{
        position: 'absolute',
        inset: '36px 44px',
        border: '1px solid rgba(242,230,201,0.25)',
        pointerEvents: 'none',
      }} />

      {/* Top: conference + venue */}
      <div style={{
        position: 'relative',
        textAlign: 'center',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 14,
        letterSpacing: '0.35em',
        textTransform: 'uppercase',
        color: 'rgba(242,230,201,0.7)',
      }}>
        — {conference} —
      </div>

      {/* Speaker name — massive headliner */}
      <div style={{
        position: 'relative',
        textAlign: 'center',
        marginTop: 60,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 22,
          letterSpacing: '0.5em',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: '#E8A53F',
          marginBottom: 24,
        }}>
          Live · One Night Only
        </div>
        <div style={{
          fontSize: 160,
          fontWeight: 400,
          fontStyle: 'italic',
          letterSpacing: '-0.05em',
          lineHeight: 0.9,
          color: '#F2E6C9',
        }}>
          {speaker}
        </div>
      </div>

      {/* Talk title — middle */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        top: '52%',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 13,
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.45em',
          textTransform: 'uppercase',
          color: 'rgba(242,230,201,0.55)',
          marginBottom: 24,
        }}>
          performing
        </div>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 56,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          color: '#F2E6C9',
          maxWidth: '90%',
          margin: '0 auto',
        }}>
          “{talkTitle}”
        </div>
      </div>

      {/* Topics: support acts */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 220,
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: 12,
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.45em',
          textTransform: 'uppercase',
          color: 'rgba(242,230,201,0.5)',
          marginBottom: 18,
        }}>
          with topics
        </div>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 18,
          letterSpacing: '0.2em',
          color: '#E8A53F',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}>
          {topics.join('   ✦   ')}
        </div>
      </div>

      {/* Bottom ticket strip */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 80,
        borderTop: '1px solid rgba(242,230,201,0.4)',
        paddingTop: 32,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}>
        <div>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 13,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.55)',
            marginBottom: 6,
          }}>
            Date
          </div>
          <div style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.015em', fontStyle: 'italic' }}>
            {date}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 13,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.55)',
            marginBottom: 6,
          }}>
            Time
          </div>
          <div style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.015em', fontStyle: 'italic' }}>
            {time}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: 13,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'rgba(242,230,201,0.55)',
            marginBottom: 6,
          }}>
            Venue
          </div>
          <div style={{ fontSize: 32, fontWeight: 400, letterSpacing: '-0.015em', fontStyle: 'italic' }}>
            {venue}
          </div>
        </div>
      </div>
    </div>
  );
}
