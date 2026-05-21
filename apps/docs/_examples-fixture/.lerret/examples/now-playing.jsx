export const meta = {
  dimensions: { width: 1200, height: 400 },
  label: 'Now playing',
  tags: ['status', 'banner'],
  propsSchema: {
    track: { type: 'string', default: 'Track title', required: true },
    artist: { type: 'string', default: 'Artist name' },
    elapsed: { type: 'string', default: '00:00' },
    duration: { type: 'string', default: '03:00' },
  },
};

export default function NowPlaying({
  track = 'Track title',
  artist = 'Artist name',
  elapsed = '00:00',
  duration = '03:00',
}) {
  const elapsedSec = toSeconds(elapsed);
  const durationSec = toSeconds(duration);
  const progress = durationSec === 0 ? 0 : Math.min(elapsedSec / durationSec, 1);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '48px 64px',
      background: 'linear-gradient(135deg, #0A0E14 0%, #1B2A3B 100%)',
      color: '#F4F7FA',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <div style={{ fontSize: 14, letterSpacing: '0.25em', textTransform: 'uppercase', color: '#8BAEC8' }}>
          Now playing
        </div>
        <div style={{ flex: 1, height: 1, background: 'rgba(139,174,200,0.25)' }} />
      </div>

      <div>
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
          {track}
        </div>
        <div style={{ fontSize: 26, opacity: 0.7, marginTop: 8 }}>
          {artist}
        </div>
      </div>

      <div>
        <div style={{ height: 4, background: 'rgba(139,174,200,0.2)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${progress * 100}%`,
            height: '100%',
            background: '#E8C8B6',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 16, color: '#8BAEC8', fontVariantNumeric: 'tabular-nums' }}>
          <span>{elapsed}</span>
          <span>{duration}</span>
        </div>
      </div>
    </div>
  );
}

function toSeconds(stamp) {
  const parts = String(stamp).split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
