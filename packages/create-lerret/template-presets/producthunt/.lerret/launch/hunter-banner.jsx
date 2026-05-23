// Product Hunt hunter banner (1500 × 500).
//
// A wide horizontal card the hunter can attach to the comments thread or
// share on social. Headline-led, with a vertical accent rail on the left.

export const meta = {
  dimensions: { width: 1500, height: 500 },
  label: 'Product Hunt hunter banner',
  tags: ['producthunt', 'banner', 'launch'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'Hunting Your Product today.',
      description: 'Banner headline.',
      required: true,
    },
    subtitle: {
      type: 'string',
      default: 'A new entry in the open-source design canvas conversation.',
      description: 'Banner subtitle.',
    },
    hunter: {
      type: 'string',
      default: 'hunted by @hunter',
      description: 'Hunter attribution line.',
    },
  },
};

export default function HunterBanner({
  title = 'Hunting Your Product today.',
  subtitle = 'A new entry in the open-source design canvas conversation.',
  hunter = 'hunted by @hunter',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1A1714)',
        color: 'var(--neutralLight, #F8F4EC)',
        display: 'grid',
        gridTemplateColumns: '20px 1fr',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Left accent rail. */}
      <div style={{ background: 'var(--brandColor, #B85B33)' }} />

      {/* Right — content. */}
      <div
        style={{
          padding: '60px 72px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        {/* Faint orb. */}
        <div
          style={{
            position: 'absolute',
            right: -120,
            top: -120,
            width: 460,
            height: 460,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #B85B33) 30%, transparent) 0%, transparent 65%)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
            position: 'relative',
          }}
        >
          ◆ launch day
        </div>

        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            position: 'relative',
            maxWidth: 1200,
          }}
        >
          {title}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 24,
            position: 'relative',
          }}
        >
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.4,
              color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 70%, transparent)',
              maxWidth: 800,
            }}
          >
            {subtitle}
          </div>
          <div
            style={{
              fontSize: 18,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'var(--accentColor, #F1EDE5)',
              opacity: 0.7,
            }}
          >
            {hunter}
          </div>
        </div>
      </div>
    </div>
  );
}
