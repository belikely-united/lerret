// Product Hunt "Maker comment" social card (1200 × 630).
//
// The social card the maker shares on Twitter/Bluesky when announcing
// "we're live on Product Hunt". OG-image dimensions. Headline + quote-style
// comment + maker handle.

export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'Maker comment social card',
  tags: ['producthunt', 'social', 'og-image', 'maker'],
  propsSchema: {
    headline: {
      type: 'string',
      default: "We're live on Product Hunt.",
      description: 'Top-of-card headline.',
      required: true,
    },
    comment: {
      type: 'string',
      default: 'Three years of late-night hacking, finally shipped. If you find any rough edges, please tell us.',
      description: 'Maker comment body.',
    },
    handle: {
      type: 'string',
      default: '@you · maker',
      description: 'Maker handle + role.',
    },
  },
};

export default function MakerComment({
  headline = "We're live on Product Hunt.",
  comment = 'Three years of late-night hacking, finally shipped. If you find any rough edges, please tell us.',
  handle = '@you · maker',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(140deg, var(--neutralLight, #F8F4EC) 0%, color-mix(in oklab, var(--accentColor, #F1EDE5) 50%, var(--neutralLight, #F8F4EC)) 100%)',
        color: 'var(--neutralDark, #1A1714)',
        padding: '64px 72px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 36,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Giant decorative quote behind. */}
      <div
        style={{
          position: 'absolute',
          left: 36,
          top: -100,
          fontSize: 420,
          lineHeight: 1,
          color: 'var(--brandColor, #B85B33)',
          opacity: 0.12,
          pointerEvents: 'none',
          userSelect: 'none',
          fontWeight: 700,
        }}
      >
        "
      </div>

      {/* Top — eyebrow. */}
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--brandColor, #B85B33)',
          position: 'relative',
        }}
      >
        ◆ maker comment
      </div>

      {/* Middle — headline + comment. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, position: 'relative' }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: '-0.02em',
            maxWidth: 1000,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 26,
            lineHeight: 1.4,
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 75%, transparent)',
            maxWidth: 960,
          }}
        >
          {comment}
        </div>
      </div>

      {/* Bottom — handle + accent rule. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          position: 'relative',
        }}
      >
        <div style={{ width: 56, height: 4, background: 'var(--brandColor, #B85B33)' }} />
        <div
          style={{
            fontSize: 20,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 65%, transparent)',
          }}
        >
          {handle}
        </div>
      </div>
    </div>
  );
}
