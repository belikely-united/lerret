// Personal site OG image (1200 × 630).
//
// The card that shows when someone shares your homepage on social. Site name
// large, tagline below, with a tiny brand mark.

export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'OG image (homepage)',
  tags: ['personal', 'og-image', 'social-card'],
  propsSchema: {
    siteName: {
      type: 'string',
      default: 'yoursite.com',
      description: 'Site name (URL or display name).',
      required: true,
    },
    tagline: {
      type: 'string',
      default: 'Notes from the workshop.',
      description: 'Tagline below the site name.',
    },
  },
};

export default function OGImage({
  siteName = 'yoursite.com',
  tagline = 'Notes from the workshop.',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(135deg, var(--neutralLight, #F8F4EC) 0%, color-mix(in oklab, var(--accentColor, #F1EDE5) 70%, var(--neutralLight, #F8F4EC)) 100%)',
        color: 'var(--neutralDark, #1A1714)',
        padding: '72px 80px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Tiny brand mark. */}
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--brandColor, #B85B33)',
        }}
      >
        ◆ {siteName}
      </div>

      {/* Middle — tagline + site name. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          a personal site
        </div>
        <div
          style={{
            fontSize: 88,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: '-0.025em',
            maxWidth: 1000,
          }}
        >
          {tagline}
        </div>
      </div>

      {/* Bottom — accent rule. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 80, height: 5, background: 'var(--brandColor, #B85B33)' }} />
        <div
          style={{
            fontSize: 18,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)',
          }}
        >
          read more →
        </div>
      </div>
    </div>
  );
}
