// Blog post header template (1600 × 840).
//
// Hero image at the top of an individual blog post. Series tag, post title,
// and date. Re-skinned per-post by editing the props.

export const meta = {
  dimensions: { width: 1600, height: 840 },
  label: 'Blog post header',
  tags: ['personal', 'blog', 'post', 'header'],
  propsSchema: {
    series: {
      type: 'string',
      default: 'essays',
      description: 'Series or category tag.',
    },
    title: {
      type: 'string',
      default: 'On the merits of plain files',
      description: 'Post title.',
      required: true,
    },
    date: {
      type: 'string',
      default: 'May 23, 2026',
      description: 'Post date.',
    },
    readTime: {
      type: 'string',
      default: '6-min read',
      description: 'Read-time label.',
    },
  },
};

export default function BlogHeader({
  series = 'essays',
  title = 'On the merits of plain files',
  date = 'May 23, 2026',
  readTime = '6-min read',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1A1714)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '96px 120px',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 28,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Atmospheric gradient — single off-axis disc. */}
      <div
        style={{
          position: 'absolute',
          right: -200,
          top: -200,
          width: 900,
          height: 900,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #B85B33) 45%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top — series tag. */}
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: 'var(--brandColor, #B85B33)',
          position: 'relative',
        }}
      >
        ◆ {series}
      </div>

      {/* Middle — title. */}
      <div
        style={{
          fontSize: 116,
          fontWeight: 700,
          lineHeight: 1.04,
          letterSpacing: '-0.025em',
          alignSelf: 'center',
          position: 'relative',
          maxWidth: 1280,
        }}
      >
        {title}
      </div>

      {/* Bottom — date + read time. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          position: 'relative',
        }}
      >
        <div style={{ width: 64, height: 4, background: 'var(--brandColor, #B85B33)' }} />
        <div
          style={{
            fontSize: 20,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 65%, transparent)',
          }}
        >
          {date} · {readTime}
        </div>
      </div>
    </div>
  );
}
