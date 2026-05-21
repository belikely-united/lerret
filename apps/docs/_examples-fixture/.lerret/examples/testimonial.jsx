export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Testimonial / quote card',
  tags: ['testimonial', 'quote', 'social'],
  propsSchema: {
    quote: { type: 'string', default: 'The team built our entire design system in a weekend. We have not opened Figma since.', required: true },
    author: { type: 'string', default: 'Maya Patel' },
    role: { type: 'string', default: 'Head of Design' },
    company: { type: 'string', default: 'Lumen Labs' },
  },
};

export default function Testimonial({
  quote = 'The team built our entire design system in a weekend. We have not opened Figma since.',
  author = 'Maya Patel',
  role = 'Head of Design',
  company = 'Lumen Labs',
}) {
  const initials = author.split(' ').map((w) => w[0]).slice(0, 2).join('');
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '96px 88px',
      background: 'linear-gradient(170deg, #F8F4ED 0%, #EFE7D6 100%)',
      color: '#1A1714',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{
        position: 'absolute',
        top: 8,
        left: 60,
        fontSize: 360,
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#B85B33',
        opacity: 0.16,
        lineHeight: 0.7,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        “
      </div>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: '#B85B33',
        }} />
        <div style={{
          fontSize: 14,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: '#6E6960',
          fontWeight: 700,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          From our customers
        </div>
      </div>

      <div style={{
        fontSize: 54,
        fontWeight: 500,
        lineHeight: 1.2,
        letterSpacing: '-0.018em',
        position: 'relative',
        fontFamily: 'Georgia, "Times New Roman", serif',
        color: '#1A1714',
      }}>
        “{quote}”
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 26,
        position: 'relative',
      }}>
        <div style={{
          width: 84,
          height: 84,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #B85B33 0%, #E8896C 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 32,
          fontWeight: 800,
          color: '#FFF',
          flexShrink: 0,
          boxShadow: '0 8px 24px rgba(184,91,51,0.3)',
          letterSpacing: '-0.02em',
        }}>
          {initials}
        </div>
        <div>
          <div style={{
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: '-0.015em',
          }}>
            {author}
          </div>
          <div style={{
            fontSize: 20,
            opacity: 0.7,
            marginTop: 4,
            fontWeight: 500,
          }}>
            {role} · <span style={{ fontWeight: 700, color: '#B85B33' }}>{company}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
