export const meta = {
  dimensions: { width: 1080, height: 1350 },
  label: 'Testimonial — magazine cover',
  tags: ['poster', 'testimonial', 'editorial'],
  propsSchema: {
    quote: { type: 'string', default: 'We built our entire design system in a weekend. Never opened Figma since.', required: true },
    author: { type: 'string', default: 'Maya Patel' },
    role: { type: 'string', default: 'Head of Design' },
    company: { type: 'string', default: 'Lumen Labs' },
    issueNumber: { type: 'string', default: '01' },
  },
};

export default function TestimonialPoster({
  quote = 'We built our entire design system in a weekend. Never opened Figma since.',
  author = 'Maya Patel',
  role = 'Head of Design',
  company = 'Lumen Labs',
  issueNumber = '01',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#EFD9D4',
      color: '#1E0F0C',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Top masthead */}
      <div style={{
        position: 'relative',
        borderBottom: '1.5px solid #1E0F0C',
        paddingBottom: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 52,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          lineHeight: 0.85,
          textTransform: 'uppercase',
        }}>
          The<br />Customer<br />Quarterly
        </div>
        <div style={{
          textAlign: 'right',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 12,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          lineHeight: 1.6,
        }}>
          ISSUE NO.{issueNumber}<br />
          26<br />
          $0
        </div>
      </div>

      {/* Giant 01 - decorative */}
      <div style={{
        position: 'absolute',
        right: -64,
        top: 400,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 540,
        fontWeight: 900,
        letterSpacing: '-0.07em',
        lineHeight: 0.8,
        color: 'transparent',
        WebkitTextStroke: '2px rgba(30,15,12,0.18)',
        pointerEvents: 'none',
        userSelect: 'none',
        transform: 'rotate(8deg)',
      }}>
        {issueNumber}
      </div>

      {/* The quote */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 200,
        top: 320,
        zIndex: 1,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12,
          letterSpacing: '0.4em',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: '#8B3A2E',
          marginBottom: 20,
        }}>
          On Records · Verbatim
        </div>
        <div style={{
          fontSize: 76,
          fontStyle: 'italic',
          fontWeight: 400,
          lineHeight: 1.08,
          letterSpacing: '-0.02em',
          color: '#1E0F0C',
        }}>
          “{quote}”
        </div>
      </div>

      {/* Byline at bottom */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 72,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 11,
          letterSpacing: '0.4em',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: '#8B3A2E',
          marginBottom: 10,
        }}>
          —— A note from
        </div>
        <div style={{
          fontSize: 44,
          fontWeight: 400,
          lineHeight: 1,
          fontStyle: 'italic',
        }}>
          {author}
        </div>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 17,
          marginTop: 8,
          letterSpacing: '0.02em',
          fontWeight: 500,
        }}>
          {role}, <span style={{ fontWeight: 800 }}>{company}</span>
        </div>
      </div>
    </div>
  );
}
