// Instagram feed post — square (1080 × 1080).
//
// Centered headline card with a tiny brand mark in the top-left. Brand-color
// ground driven by the project's `vars` (config.json) — change `brandColor`
// there and every social asset re-tints at once.

export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Instagram square (1:1)',
  tags: ['social', 'instagram', 'feed', 'square'],
  propsSchema: {
    headline: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'Headline text.',
      required: true,
    },
    footer: {
      type: 'string',
      default: '@lerret',
      description: 'Footer attribution.',
    },
  },
};

export default function InstagramSquare({
  headline = 'Designs are just files.',
  footer = '@lerret',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--brandColor, #B85B33)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '64px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Atmospheric orb. */}
      <div
        style={{
          position: 'absolute',
          right: -180,
          bottom: -180,
          width: 700,
          height: 700,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 22%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top — brand mark. */}
      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.85,
        }}
      >
        ◆ lerret
      </div>

      {/* Middle — headline. */}
      <div
        style={{
          fontSize: 96,
          fontWeight: 700,
          lineHeight: 1.04,
          letterSpacing: '-0.025em',
          position: 'relative',
          maxWidth: 880,
        }}
      >
        {headline}
      </div>

      {/* Bottom — handle + accent. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          position: 'relative',
        }}
      >
        <div style={{ width: 60, height: 4, background: 'var(--accentColor, #F1EDE5)', opacity: 0.85 }} />
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.85,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}
