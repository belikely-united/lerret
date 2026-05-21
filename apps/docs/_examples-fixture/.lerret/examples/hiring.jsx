export const meta = {
  dimensions: { width: 1080, height: 1350 },
  label: 'Hiring — brutalist poster',
  tags: ['poster', 'hiring', 'careers'],
  propsSchema: {
    role: { type: 'string', default: 'Senior Engineer', required: true },
    company: { type: 'string', default: 'Belikely' },
    perk1: { type: 'string', default: 'Remote-first' },
    perk2: { type: 'string', default: 'Real equity' },
    perk3: { type: 'string', default: 'Series A' },
    url: { type: 'string', default: 'belikely.com/jobs' },
  },
};

export default function HiringPoster({
  role = 'Senior Engineer',
  company = 'Belikely',
  perk1 = 'Remote-first',
  perk2 = 'Real equity',
  perk3 = 'Series A',
  url = 'belikely.com/jobs',
}) {
  const perks = [perk1, perk2, perk3].filter(Boolean);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#F4E22B',
      color: '#0B0B0B',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Top scribble line */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: 72,
        borderTop: '4px solid #0B0B0B',
      }} />

      {/* WANTED — huge outlined headline */}
      <div style={{
        position: 'relative',
        marginTop: 88,
        fontSize: 260,
        fontWeight: 900,
        letterSpacing: '-0.06em',
        lineHeight: 0.82,
        textTransform: 'uppercase',
        color: 'transparent',
        WebkitTextStroke: '4px #0B0B0B',
      }}>
        Wanted.
      </div>

      {/* Diagonal red stamp */}
      <div style={{
        position: 'absolute',
        right: 72,
        top: 200,
        background: '#D03020',
        color: '#F4E22B',
        fontSize: 22,
        fontWeight: 900,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '14px 22px',
        transform: 'rotate(8deg)',
        border: '3px solid #0B0B0B',
        boxShadow: '6px 6px 0 #0B0B0B',
      }}>
        Apply now
      </div>

      {/* Role center */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        top: '52%',
      }}>
        <div style={{
          fontSize: 22,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          fontWeight: 800,
          marginBottom: 16,
        }}>
          {company} is hiring a
        </div>
        <div style={{
          fontSize: 120,
          fontWeight: 900,
          letterSpacing: '-0.04em',
          lineHeight: 0.9,
          textTransform: 'uppercase',
        }}>
          {role}.
        </div>
      </div>

      {/* Perks list - raw text */}
      <div style={{
        position: 'absolute',
        left: 72,
        right: 72,
        bottom: 140,
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 1.4,
      }}>
        {perks.map((p, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 18,
            borderTop: i === 0 ? '4px solid #0B0B0B' : 'none',
            borderBottom: '4px solid #0B0B0B',
            padding: '14px 0',
          }}>
            <span style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 22,
              fontWeight: 900,
              minWidth: 32,
            }}>
              /{i + 1}
            </span>
            <span style={{
              fontSize: 36,
              fontWeight: 800,
              letterSpacing: '-0.015em',
            }}>
              {p}.
            </span>
          </div>
        ))}
      </div>

      {/* URL stamp */}
      <div style={{
        position: 'absolute',
        left: 72,
        bottom: 56,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 18,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        fontWeight: 800,
      }}>
        →→ {url}
      </div>
    </div>
  );
}
