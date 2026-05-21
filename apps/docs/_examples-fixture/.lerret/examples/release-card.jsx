export const meta = {
  dimensions: { width: 1200, height: 800 },
  label: 'Release / version announcement',
  tags: ['release', 'changelog', 'announcement'],
  propsSchema: {
    version: { type: 'string', default: 'v2.0', required: true },
    codename: { type: 'string', default: 'Hydra' },
    title: { type: 'string', default: 'Multiplayer, scopes, and a new API.' },
    feature1: { type: 'string', default: 'Live multiplayer cursors with conflict-free sync' },
    feature2: { type: 'string', default: 'OAuth 2.0 scopes for granular token permissions' },
    feature3: { type: 'string', default: 'Streaming export API for large project bundles' },
    feature4: { type: 'string', default: '3× faster cold-start, full Node 22 support' },
  },
};

export default function ReleaseCard({
  version = 'v2.0',
  codename = 'Hydra',
  title = 'Multiplayer, scopes, and a new API.',
  feature1 = 'Live multiplayer cursors with conflict-free sync',
  feature2 = 'OAuth 2.0 scopes for granular token permissions',
  feature3 = 'Streaming export API for large project bundles',
  feature4 = '3× faster cold-start, full Node 22 support',
}) {
  const features = [feature1, feature2, feature3, feature4].filter(Boolean);
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '80px',
      background: 'linear-gradient(150deg, #08111A 0%, #0F1F2E 50%, #1B2E45 100%)',
      color: '#F4F7FA',
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
        backgroundImage: 'linear-gradient(rgba(139,174,200,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(139,174,200,0.05) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
        pointerEvents: 'none',
        maskImage: 'radial-gradient(circle at 30% 50%, black, transparent 80%)',
      }} />
      <div style={{
        position: 'absolute',
        top: -150,
        right: -150,
        width: 500,
        height: 500,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(232,200,182,0.18), transparent 60%)',
        pointerEvents: 'none',
        filter: 'blur(20px)',
      }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '8px 16px',
          background: 'rgba(232,200,182,0.1)',
          border: '1px solid rgba(232,200,182,0.3)',
          borderRadius: 8,
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: '0.05em',
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: '#E8C8B6',
        }}>
          {version}
        </div>
        <div style={{
          fontSize: 13,
          opacity: 0.55,
          letterSpacing: '0.25em',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          CODENAME · {codename.toUpperCase()}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 14,
          letterSpacing: '0.3em',
          opacity: 0.5,
          marginBottom: 24,
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          RELEASE NOTES
        </div>
        <div style={{
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.03em',
          maxWidth: '90%',
          textWrap: 'balance',
        }}>
          {title}
        </div>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <span style={{
              fontSize: 16,
              fontFamily: 'ui-monospace, Menlo, monospace',
              color: '#E8C8B6',
              fontVariantNumeric: 'tabular-nums',
              minWidth: 32,
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              0{i + 1}
            </span>
            <span style={{
              fontSize: 26,
              lineHeight: 1.3,
              fontWeight: 500,
              flex: 1,
            }}>
              {f}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
