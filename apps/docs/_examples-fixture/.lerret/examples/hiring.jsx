export const meta = {
  dimensions: { width: 1200, height: 675 },
  label: "We're hiring",
  tags: ['hiring', 'careers', 'announcement'],
  propsSchema: {
    role: { type: 'string', default: 'Senior Software Engineer', required: true },
    team: { type: 'string', default: 'Platform team' },
    perk1: { type: 'string', default: 'Fully remote' },
    perk2: { type: 'string', default: 'Meaningful equity' },
    perk3: { type: 'string', default: 'Series A · 12-person team' },
    url: { type: 'string', default: 'yourcompany.com/careers' },
  },
};

export default function Hiring({
  role = 'Senior Software Engineer',
  team = 'Platform team',
  perk1 = 'Fully remote',
  perk2 = 'Meaningful equity',
  perk3 = 'Series A · 12-person team',
  url = 'yourcompany.com/careers',
}) {
  const perks = [perk1, perk2, perk3].filter(Boolean);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '76px 80px',
      background: 'linear-gradient(135deg, #FFE5B4 0%, #FFB088 50%, #E8896C 100%)',
      color: '#2A1810',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{
        position: 'absolute',
        bottom: -160,
        left: -160,
        width: 540,
        height: 540,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.55), transparent 60%)',
        pointerEvents: 'none',
        filter: 'blur(10px)',
      }} />
      <div style={{
        position: 'absolute',
        top: -80,
        right: -80,
        width: 360,
        height: 360,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(232,137,108,0.6), transparent 60%)',
        pointerEvents: 'none',
        filter: 'blur(6px)',
      }} />

      <div style={{ position: 'relative' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 18px',
          background: '#2A1810',
          color: '#FFE5B4',
          borderRadius: 100,
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: '0.25em',
        }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            background: '#FFE5B4',
            boxShadow: '0 0 8px #FFE5B4',
          }} />
          NOW HIRING
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 26,
          opacity: 0.68,
          letterSpacing: '-0.01em',
          fontWeight: 600,
        }}>
          We're looking for a
        </div>
        <div style={{
          fontSize: 84,
          fontWeight: 900,
          lineHeight: 0.98,
          letterSpacing: '-0.035em',
          marginTop: 14,
          textWrap: 'balance',
          maxWidth: '90%',
        }}>
          {role}
        </div>
        <div style={{
          fontSize: 22,
          marginTop: 18,
          opacity: 0.7,
          fontWeight: 500,
        }}>
          to join our {team}.
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        gap: 16,
      }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {perks.map((p, i) => (
            <div key={i} style={{
              padding: '10px 18px',
              background: 'rgba(42,24,16,0.1)',
              border: '1px solid rgba(42,24,16,0.25)',
              borderRadius: 100,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '-0.005em',
            }}>
              {p}
            </div>
          ))}
        </div>
        <div style={{
          fontSize: 16,
          fontWeight: 700,
          opacity: 0.75,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          {url} →
        </div>
      </div>
    </div>
  );
}
