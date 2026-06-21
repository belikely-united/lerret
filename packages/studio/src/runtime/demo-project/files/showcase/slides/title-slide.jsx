// Title slide (1920 × 1080, 16:9). Opens a talk — big title, speaker, venue.

export const meta = {
  dimensions: { width: 1920, height: 1080 },
  label: 'Title slide',
  tags: ['talks', 'slide', 'title', '16:9'],
  propsSchema: {
    title: { type: 'string', default: 'Designs Are Just Files', description: 'Talk title.', required: true },
    subtitle: { type: 'string', default: 'An open-source design canvas in your repo', description: 'Subtitle.' },
    speaker: { type: 'string', default: 'belikely united', description: 'Speaker name.' },
    venue: { type: 'string', default: 'open source · 2026', description: 'Venue + year.' },
  },
};

export default function TitleSlide({
  title = 'Designs Are Just Files',
  subtitle = 'An open-source design canvas in your repo',
  speaker = 'belikely united',
  venue = 'open source · 2026',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(140deg, var(--brandColor, #B85B33) 0%, color-mix(in oklab, var(--brandColor, #B85B33) 65%, var(--neutralDark, #1A1714)) 100%)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '96px 120px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -280,
          bottom: -280,
          width: 1100,
          height: 1100,
          borderRadius: '50%',
          background: 'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 20%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ fontSize: 22, letterSpacing: '0.36em', textTransform: 'uppercase', color: 'var(--accentColor, #F1EDE5)', opacity: 0.85, position: 'relative' }}>
        ◆ {venue}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32, position: 'relative' }}>
        <div style={{ fontSize: 152, fontWeight: 700, lineHeight: 1.02, letterSpacing: '-0.025em', maxWidth: 1480 }}>
          {title}
        </div>
        <div style={{ fontSize: 38, lineHeight: 1.35, color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 85%, transparent)', maxWidth: 1400 }}>
          {subtitle}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, position: 'relative' }}>
        <div style={{ width: 80, height: 4, background: 'var(--accentColor, #F1EDE5)', opacity: 0.85 }} />
        <div style={{ fontSize: 28, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--accentColor, #F1EDE5)', opacity: 0.9 }}>
          {speaker}
        </div>
      </div>
    </div>
  );
}
