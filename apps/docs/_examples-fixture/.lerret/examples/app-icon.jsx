export const meta = {
  dimensions: { width: 1024, height: 1024 },
  label: 'App icon — letterform mark',
  tags: ['poster', 'app-icon', 'logo'],
  propsSchema: {
    letter: { type: 'string', default: 'L', required: true },
    accent: { type: 'string', default: '#FFE5A8' },
  },
};

export default function AppIcon({
  letter = 'L',
  accent = '#FFE5A8',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: 'linear-gradient(150deg, #2A1410 0%, #6B2616 38%, #B85B33 70%, #E8896C 100%)',
      color: '#F5EBD8',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Top-left specular glow */}
      <div style={{
        position: 'absolute',
        top: -120,
        left: -120,
        width: 720,
        height: 720,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,229,168,0.5), transparent 60%)',
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      {/* Bottom-right shadow pool */}
      <div style={{
        position: 'absolute',
        bottom: -240,
        right: -240,
        width: 720,
        height: 720,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(20,8,4,0.6), transparent 60%)',
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      {/* Letter mark */}
      <div style={{
        position: 'relative',
        fontSize: 760,
        fontWeight: 900,
        letterSpacing: '-0.08em',
        lineHeight: 0.85,
        color: accent,
        textShadow: '0 16px 64px rgba(20,8,4,0.5)',
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontStyle: 'italic',
      }}>
        {letter}
      </div>

      {/* Small canvas indicator — bottom-right square */}
      <div style={{
        position: 'absolute',
        right: 96,
        bottom: 96,
        width: 80,
        height: 80,
        background: accent,
        opacity: 0.95,
        boxShadow: '0 8px 32px rgba(20,8,4,0.5)',
      }} />

      {/* Tiny tick mark — top-right corner */}
      <div style={{
        position: 'absolute',
        top: 64,
        right: 64,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: 'rgba(255,229,168,0.4)',
        boxShadow: '0 0 24px rgba(255,229,168,0.6)',
      }} />
    </div>
  );
}
