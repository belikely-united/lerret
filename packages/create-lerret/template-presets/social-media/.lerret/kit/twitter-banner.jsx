// Twitter / X banner (1500 × 500).
//
// Wide horizontal cover image. Brand-ground with the display name set large
// on the left and a tagline on the right.

export const meta = {
  dimensions: { width: 1500, height: 500 },
  label: 'Twitter / X banner',
  tags: ['social', 'twitter', 'x', 'banner'],
  propsSchema: {
    displayName: {
      type: 'string',
      default: 'Your Name',
      description: 'Your display name.',
      required: true,
    },
    tagline: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'Short tagline.',
    },
  },
};

export default function TwitterBanner({
  displayName = 'Your Name',
  tagline = 'Designs are just files.',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(120deg, var(--brandColor, #B85B33) 0%, var(--neutralDark, #1A1714) 100%)',
        color: 'var(--neutralLight, #F8F4EC)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        alignItems: 'center',
        padding: '0 96px',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Atmospheric ring. */}
      <div
        style={{
          position: 'absolute',
          right: -240,
          top: -160,
          width: 720,
          height: 720,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 24%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Left — display name. */}
      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 0.98,
          letterSpacing: '-0.025em',
          position: 'relative',
        }}
      >
        {displayName}
      </div>

      {/* Right — tagline. */}
      <div
        style={{
          textAlign: 'right',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.85,
          }}
        >
          ◆ tagline
        </div>
        <div
          style={{
            fontSize: 36,
            lineHeight: 1.3,
            color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 88%, transparent)',
            maxWidth: 560,
          }}
        >
          {tagline}
        </div>
      </div>
    </div>
  );
}
