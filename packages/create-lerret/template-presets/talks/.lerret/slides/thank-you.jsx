// Closing slide (1920 × 1080, 16:9).
//
// The "thank you / contact" slide — the last thing the audience sees.
// Speaker handle, a couple of link cards, and a big "thanks".

export const meta = {
  dimensions: { width: 1920, height: 1080 },
  label: 'Thank you closer',
  tags: ['talks', 'slide', 'closer', 'contact', '16:9'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'thanks.',
      description: 'Big closing word.',
    },
    speaker: {
      type: 'string',
      default: 'Your Name',
      description: 'Speaker name.',
    },
    handle: {
      type: 'string',
      default: '@you',
      description: 'Primary handle.',
    },
    link: {
      type: 'string',
      default: 'lerret.belikely.com',
      description: 'Project / personal link.',
    },
  },
};

export default function ThankYou({
  title = 'thanks.',
  speaker = 'Your Name',
  handle = '@you',
  link = 'lerret.belikely.com',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1A1714)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '120px 140px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Atmospheric ring. */}
      <div
        style={{
          position: 'absolute',
          left: -260,
          top: -260,
          width: 980,
          height: 980,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #B85B33) 35%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top — eyebrow. */}
      <div
        style={{
          fontSize: 22,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: 'var(--brandColor, #B85B33)',
          position: 'relative',
        }}
      >
        ◆ end of talk
      </div>

      {/* Middle — giant "thanks." */}
      <div
        style={{
          fontSize: 360,
          fontWeight: 700,
          lineHeight: 0.92,
          letterSpacing: '-0.04em',
          position: 'relative',
        }}
      >
        {title}
      </div>

      {/* Bottom — contact cards. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 40,
          position: 'relative',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 50%, transparent)',
              marginBottom: 10,
            }}
          >
            speaker
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.1 }}>{speaker}</div>
        </div>
        <div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 50%, transparent)',
              marginBottom: 10,
            }}
          >
            social
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.1, color: 'var(--brandColor, #B85B33)' }}>
            {handle}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 50%, transparent)',
              marginBottom: 10,
            }}
          >
            link
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, lineHeight: 1.1 }}>{link}</div>
        </div>
      </div>
    </div>
  );
}
