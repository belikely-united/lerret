// Product Hunt gallery slide (1270 × 760).
//
// The hero card that appears in the Product Hunt gallery carousel. Title +
// tagline + a single sharp accent block. All copy is prop-driven so you can
// edit headlines without touching the JSX.

export const meta = {
  dimensions: { width: 1270, height: 760 },
  label: 'Product Hunt gallery slide',
  tags: ['producthunt', 'gallery', 'launch'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'Lerret',
      description: 'Product name (large headline).',
      required: true,
    },
    tagline: {
      type: 'string',
      default: 'Your folder is a canvas — ship design straight from code.',
      description: 'The supporting line.',
    },
    badge: {
      type: 'string',
      default: 'launching soon',
      description: 'Small label in the top-left.',
    },
  },
};

export default function GallerySlide({
  title = 'Lerret',
  tagline = 'Your folder is a canvas — ship design straight from code.',
  badge = 'launching soon',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralLight, #F8F4EC)',
        color: 'var(--neutralDark, #1A1714)',
        padding: '64px 80px',
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        gap: 48,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Left — content. */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          ◆ {badge}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 108,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
              color: 'var(--neutralDark, #1A1714)',
              maxWidth: 760,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.4,
              color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 65%, transparent)',
              maxWidth: 740,
            }}
          >
            {tagline}
          </div>
        </div>

        <div
          style={{
            fontSize: 16,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)',
          }}
        >
          producthunt.com / lerret
        </div>
      </div>

      {/* Right — single sharp accent block. */}
      <div
        style={{
          background: 'var(--brandColor, #B85B33)',
          color: 'var(--neutralLight, #F8F4EC)',
          borderRadius: 28,
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ fontSize: 18, letterSpacing: '0.28em', textTransform: 'uppercase', opacity: 0.85 }}>
          n°01
        </div>
        <div
          style={{
            fontSize: 220,
            lineHeight: 0.92,
            letterSpacing: '-0.04em',
            fontWeight: 700,
          }}
        >
          ◆
        </div>
        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            opacity: 0.85,
            textAlign: 'right',
          }}
        >
          gallery slide
        </div>
      </div>
    </div>
  );
}
