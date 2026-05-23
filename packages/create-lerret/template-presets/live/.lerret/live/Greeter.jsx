// Greeter.jsx — LiveRefresh artboard #3.
//
// Displays "Good morning / Good afternoon / Good evening" based on the
// current hour. Re-renders every 60s because `liveRefresh: { Greeter: 60000 }`
// is set — that's enough to catch transitions when they happen.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'Greeter — 60s rhythm',
  tags: ['live', 'greeter', 'liveRefresh', 'time-of-day'],
};

function greetingFor(hour) {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Greeter() {
  const hour = new Date().getHours();
  const greeting = greetingFor(hour);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralLight, #F8F4EC)',
        color: 'var(--neutralDark, #1A1714)',
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
        ◆ greeter / 60 s
      </div>

      <div
        style={{
          alignSelf: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            fontSize: 78,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: '-0.02em',
          }}
        >
          {greeting}.
        </div>
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)',
          }}
        >
          local hour · {String(hour).padStart(2, '0')}:00
        </div>
      </div>

      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 55%, transparent)',
        }}
      >
        switches at 05/12/18 local hours
      </div>
    </div>
  );
}
