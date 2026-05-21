export const meta = {
  dimensions: { width: 1280, height: 720 },
  label: 'YouTube thumbnail',
  tags: ['youtube', 'video', 'thumbnail'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'Episode title',
      required: true,
    },
    episodeNumber: {
      type: 'string',
      default: 'EP 01',
      description: 'Short label rendered in the corner (e.g. EP 01, Ep 12, S2E04).',
    },
    showAccent: {
      type: 'boolean',
      default: true,
      description: 'Show the diagonal accent stripe behind the title.',
    },
  },
};

export default function YouTubeThumbnail({
  title = 'Episode title',
  episodeNumber = 'EP 01',
  showAccent = true,
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#101218',
      color: '#FAFAF6',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px',
    }}>
      {showAccent && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, transparent 35%, rgba(184,91,51,0.85) 35%, rgba(184,91,51,0.85) 38%, transparent 38%)',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        height: '100%',
      }}>
        <div style={{
          fontSize: 28,
          letterSpacing: '0.22em',
          fontWeight: 700,
          color: '#E8C8B6',
        }}>
          {episodeNumber}
        </div>
        <div style={{
          fontSize: 96,
          fontWeight: 900,
          lineHeight: 0.98,
          letterSpacing: '-0.03em',
          textWrap: 'balance',
          maxWidth: '85%',
        }}>
          {title}
        </div>
      </div>
    </div>
  );
}
