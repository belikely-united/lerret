export const meta = {
  dimensions: { width: 1200, height: 675 },
  label: 'Feature launch announcement',
  tags: ['announcement', 'feature', 'twitter'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'NEW IN v2.0' },
    headline: { type: 'string', default: 'Real-time multiplayer.', required: true },
    description: { type: 'string', default: 'See your teammates’ cursors as they edit. Live presence, conflict-free sync, zero setup.' },
    cta: { type: 'string', default: 'Try it free' },
    url: { type: 'string', default: 'yourproduct.com' },
  },
};

export default function FeatureLaunch({
  eyebrow = 'NEW IN v2.0',
  headline = 'Real-time multiplayer.',
  description = 'See your teammates’ cursors as they edit. Live presence, conflict-free sync, zero setup.',
  cta = 'Try it free',
  url = 'yourproduct.com',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '76px 80px',
      background: '#0A0A0A',
      color: '#FAFAFA',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, transparent 35%, rgba(99,102,241,0.18) 65%, rgba(236,72,153,0.12) 100%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        top: -200,
        right: -160,
        width: 540,
        height: 540,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.32), transparent 60%)',
        pointerEvents: 'none',
        filter: 'blur(8px)',
      }} />

      <div style={{ position: 'relative', display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 16px',
          background: 'linear-gradient(135deg, #6366F1 0%, #EC4899 100%)',
          borderRadius: 100,
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.2em',
        }}>
          NEW
        </div>
        <div style={{
          padding: '7px 16px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 100,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.75)',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          {eyebrow}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 108,
          fontWeight: 800,
          lineHeight: 0.92,
          letterSpacing: '-0.045em',
          textWrap: 'balance',
          background: 'linear-gradient(135deg, #FFFFFF 0%, #B8B8C8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          maxWidth: '90%',
        }}>
          {headline}
        </div>
        <div style={{
          fontSize: 24,
          marginTop: 26,
          opacity: 0.65,
          lineHeight: 1.45,
          maxWidth: '70%',
          fontWeight: 500,
        }}>
          {description}
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          padding: '16px 28px',
          background: '#FAFAFA',
          color: '#0A0A0A',
          borderRadius: 12,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}>
          {cta}
          <span style={{ fontSize: 16 }}>→</span>
        </div>
        <div style={{
          fontSize: 16,
          opacity: 0.45,
          fontFamily: 'ui-monospace, Menlo, monospace',
          letterSpacing: '0.05em',
        }}>
          {url}
        </div>
      </div>
    </div>
  );
}
