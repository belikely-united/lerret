// FastCounter.jsx — auto-refresh artboard #2.
//
// Visibly racing counter. `FastCounter.config.json` (co-located) sets
// `{ "autoRefresh": 100 }`, making this re-render ten times per second —
// the eye can see the digits change.
//
// The counter value is derived from `Date.now()` so it monotonically
// increases without needing component state.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'Fast counter — 100ms rhythm',
  tags: ['live', 'counter', 'auto-refresh', 'fast'],
};

export default function FastCounter() {
  // 10ths of a second since the Unix epoch — visibly increments at 100ms.
  const ticks = Math.floor(Date.now() / 100);
  const display = String(ticks).slice(-9);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--brandColor, #B85B33)',
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
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.85,
        }}
      >
        ◆ counter / 100 ms
      </div>

      <div
        style={{
          alignSelf: 'center',
          justifySelf: 'center',
          fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
          fontSize: 124,
          lineHeight: 1,
          letterSpacing: '0.04em',
          fontWeight: 600,
          color: 'var(--neutralLight, #F8F4EC)',
        }}
      >
        {display}
      </div>

      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 75%, transparent)',
        }}
      >
        the eye sees this race — that's the demo
      </div>
    </div>
  );
}
