// Instagram story (1080 × 1920).
//
// Vertical 9:16. Headline + tap-cue at the bottom. Dark ground for legibility
// over screenshots.

export const meta = {
  dimensions: { width: 1080, height: 1920 },
  label: 'Instagram story (9:16)',
  tags: ['social', 'instagram', 'story', 'vertical'],
  propsSchema: {
    eyebrow: {
      type: 'string',
      default: 'open canvas',
      description: 'Small eyebrow label.',
    },
    headline: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'Main headline.',
      required: true,
    },
    cta: {
      type: 'string',
      default: 'tap to learn more',
      description: 'Call-to-action line at the bottom.',
    },
  },
};

export default function InstagramStory({
  eyebrow = 'open canvas',
  headline = 'Designs are just files.',
  cta = 'tap to learn more',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(180deg, var(--neutralDark, #1A1714) 0%, color-mix(in oklab, var(--brandColor, #B85B33) 45%, var(--neutralDark, #1A1714)) 100%)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '120px 72px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Top — eyebrow. */}
      <div
        style={{
          fontSize: 22,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.85,
        }}
      >
        ◆ {eyebrow}
      </div>

      {/* Middle — headline. */}
      <div
        style={{
          fontSize: 130,
          fontWeight: 700,
          lineHeight: 1.02,
          letterSpacing: '-0.025em',
          maxWidth: 920,
        }}
      >
        {headline}
      </div>

      {/* Bottom — CTA + animated dot. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'var(--accentColor, #F1EDE5)',
            opacity: 0.9,
          }}
        />
        <div
          style={{
            fontSize: 30,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 80%, transparent)',
          }}
        >
          {cta}
        </div>
      </div>
    </div>
  );
}
