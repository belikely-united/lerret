// LinkedIn cover image (1584 × 396).
//
// Long-and-low ratio. More restrained palette than the Twitter banner — neutral
// cream ground with a tight typographic frame on the left.

export const meta = {
  dimensions: { width: 1584, height: 396 },
  label: 'LinkedIn cover',
  tags: ['social', 'linkedin', 'cover'],
  propsSchema: {
    displayName: {
      type: 'string',
      default: 'Your Name',
      description: 'Your display name.',
      required: true,
    },
    role: {
      type: 'string',
      default: 'Designing in code · open source',
      description: 'Role or short bio.',
    },
  },
};

export default function LinkedInCover({
  displayName = 'Your Name',
  role = 'Designing in code · open source',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralLight, #F8F4EC)',
        color: 'var(--neutralDark, #1A1714)',
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        alignItems: 'stretch',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Left — content. */}
      <div
        style={{
          padding: '48px 64px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.36em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          ◆ lerret · social kit
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.02,
              letterSpacing: '-0.025em',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 22,
              lineHeight: 1.35,
              color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 65%, transparent)',
              maxWidth: 800,
            }}
          >
            {role}
          </div>
        </div>

        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)',
          }}
        >
          linkedin / cover
        </div>
      </div>

      {/* Right — accent block. */}
      <div
        style={{
          background: 'var(--brandColor, #B85B33)',
          color: 'var(--neutralLight, #F8F4EC)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 180,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '-0.04em',
        }}
      >
        ◆
      </div>
    </div>
  );
}
