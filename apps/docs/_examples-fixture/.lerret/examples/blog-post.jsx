export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'OG blog card',
  tags: ['og', 'blog', 'social'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'Your post title',
      description: 'Main headline rendered at large size.',
      required: true,
    },
    author: {
      type: 'string',
      default: 'Author name',
      description: 'Byline shown above the title.',
    },
    accent: {
      type: 'string',
      default: '#B85B33',
      description: 'Accent bar color — pick from your brand palette.',
    },
  },
};

export default function BlogPostCard({
  title = 'Your post title',
  author = 'Author name',
  accent = '#B85B33',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '80px',
      background: '#0E1116',
      color: '#F4F4F0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 12,
        background: accent,
      }} />
      <div style={{
        fontSize: 22,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        opacity: 0.65,
      }}>
        {author}
      </div>
      <div style={{
        fontSize: 80,
        fontWeight: 800,
        lineHeight: 1.05,
        letterSpacing: '-0.025em',
        textWrap: 'balance',
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 22,
        opacity: 0.55,
      }}>
        belikely.com
      </div>
    </div>
  );
}
