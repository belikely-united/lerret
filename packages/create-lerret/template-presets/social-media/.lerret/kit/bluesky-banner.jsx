// Bluesky banner (3000 × 1000).
//
// Extra-wide 3:1 ratio. Centered headline with two accent rules on either
// side — the wider canvas suits a more typographic composition.

export const meta = {
  dimensions: { width: 3000, height: 1000 },
  label: 'Bluesky banner',
  tags: ['social', 'bluesky', 'banner'],
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
      description: 'Short tagline below the name.',
    },
  },
};

export default function BlueskyBanner({
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
          'linear-gradient(110deg, var(--neutralDark, #1A1714) 0%, color-mix(in oklab, var(--brandColor, #B85B33) 60%, var(--neutralDark, #1A1714)) 100%)',
        color: 'var(--neutralLight, #F8F4EC)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 36,
        padding: '0 200px',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Atmospheric ring. */}
      <div
        style={{
          position: 'absolute',
          right: -300,
          top: -300,
          width: 1200,
          height: 1200,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 16%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontSize: 22,
          letterSpacing: '0.42em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.8,
          position: 'relative',
        }}
      >
        ◆ bluesky
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 48,
          position: 'relative',
        }}
      >
        <div style={{ width: 180, height: 4, background: 'var(--accentColor, #F1EDE5)', opacity: 0.5 }} />
        <div
          style={{
            fontSize: 168,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.025em',
          }}
        >
          {displayName}
        </div>
        <div style={{ width: 180, height: 4, background: 'var(--accentColor, #F1EDE5)', opacity: 0.5 }} />
      </div>

      <div
        style={{
          fontSize: 40,
          lineHeight: 1.3,
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 80%, transparent)',
          textAlign: 'center',
          maxWidth: 2400,
          position: 'relative',
        }}
      >
        {tagline}
      </div>
    </div>
  );
}
