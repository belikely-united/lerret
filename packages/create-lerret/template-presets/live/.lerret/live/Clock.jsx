// Clock.jsx — LiveRefresh artboard #1.
//
// Renders the local time in HH:MM:SS. Re-renders every 1000ms because
// `liveRefresh: { Clock: 1000 }` is set in `live/config.json`.
//
// To slow it down or speed it up: edit `live/config.json`.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'Clock — 1s rhythm',
  tags: ['live', 'clock', 'liveRefresh'],
};

export default function Clock() {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour12: false });
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1A1714)',
        color: 'var(--neutralLight, #F8F4EC)',
        padding: '36px 48px',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 16,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--brandColor, #B85B33)',
        }}
      >
        ◆ clock / 1000 ms
      </div>

      <div
        style={{
          alignSelf: 'center',
          justifySelf: 'center',
          fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
          fontSize: 156,
          lineHeight: 1,
          letterSpacing: '0.06em',
          fontWeight: 600,
          color: 'var(--accentColor, #F1EDE5)',
        }}
      >
        {time}
      </div>

      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 55%, transparent)',
        }}
      >
        edit live/config.json to change the interval
      </div>
    </div>
  );
}
