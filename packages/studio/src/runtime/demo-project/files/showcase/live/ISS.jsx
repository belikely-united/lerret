// ISS.jsx — the International Space Station's LIVE position, refreshing every 3s.
//
// The ISS orbits at ~27,600 km/h, so its latitude/longitude change on EVERY
// request — making it the perfect 3-second live demo (crypto and weather barely
// move that fast). The numbers below are PROPS, fed by the co-located
// ISS.data.js (which fetches wheretheiss.at) and re-fetched every 3s by
// ISS.config.json's { "autoRefresh": 3000 }.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'ISS — live position (3s refresh)',
  tags: ['live', 'data', 'space', 'api'],
  propsSchema: {
    lat: { type: 'number', default: 0 },
    lng: { type: 'number', default: 0 },
    altitude: { type: 'number', default: 0 },
    velocity: { type: 'number', default: 0 },
    visibility: { type: 'string', default: '—' },
    updatedAt: { type: 'string', default: '—' },
  },
};

const ACCENT = '#7BC47F';

function coord(n, pos, neg) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  const dir = n >= 0 ? pos : neg;
  return `${Math.abs(n).toFixed(4)}° ${dir}`;
}

export default function ISS({
  lat = 0,
  lng = 0,
  altitude = 0,
  velocity = 0,
  visibility = '—',
  updatedAt = '—',
}) {
  const haveData = velocity > 0;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1A1714)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '32px 44px',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 14,
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            fontSize: 16,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          ◆ ISS / live position
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 55%, transparent)',
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: haveData ? ACCENT : 'var(--brandColor, #B85B33)' }} />
          {haveData ? `${updatedAt} · every 3s` : 'acquiring signal…'}
        </div>
      </div>

      <div style={{ display: 'flex', alignSelf: 'center', width: '100%', gap: 0 }}>
        {[
          ['Latitude', coord(lat, 'N', 'S')],
          ['Longitude', coord(lng, 'E', 'W')],
        ].map(([label, value], i) => (
          <div
            key={label}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingLeft: i === 0 ? 0 : 32,
              marginLeft: i === 0 ? 0 : 32,
              borderLeft:
                i === 0
                  ? 'none'
                  : '1px solid color-mix(in oklab, var(--neutralLight, #F8F4EC) 14%, transparent)',
            }}
          >
            <div
              style={{
                fontSize: 13,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 50%, transparent)',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                fontSize: 44,
                fontWeight: 600,
                lineHeight: 1.05,
                color: 'var(--accentColor, #F1EDE5)',
                opacity: haveData ? 1 : 0.4,
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          fontSize: 13,
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 55%, transparent)',
        }}
      >
        <span>
          {haveData
            ? `alt ${altitude.toLocaleString('en-US')} km · ${velocity.toLocaleString('en-US')} km/h · ${visibility}`
            : 'Powered by ISS.data.js — a real module that fetches wheretheiss.at, live.'}
        </span>
        <span style={{ whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>via wheretheiss.at</span>
      </div>
    </div>
  );
}
