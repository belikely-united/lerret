// counter.jsx — an auto-incrementing counter (1080 × 540).
//
// Same `liveRefresh` story as `clock.jsx`, demonstrating a second pattern:
// pure local state that bumps every tick. Useful as a debug tool — you
// can see at a glance whether the refresh cadence in `live/config.json` is
// actually firing.
//
// The displayed number resets every time you save the file (or when the
// studio reloads), because `useState(0)` initializes to zero on mount.

import React, { useEffect, useState } from 'react';

export const meta = {
  dimensions: { width: 1080, height: 540 },
  label: 'Live counter',
  tags: ['live', 'counter', 'demo'],
};

export default function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCount((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--neutralLight, #F7F4F0)',
        color: 'var(--neutralDark, #1A1814)',
        padding: '48px 64px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Hairline grid — gives the number a measurable backdrop. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M40 0H0V40' fill='none' stroke='%231A1814' stroke-width='1' stroke-opacity='0.08'/%3E%3C/svg%3E\")",
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }}
      />

      {/* Top — label. */}
      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 60%, transparent)',
          position: 'relative',
        }}
      >
        ◆ lerret &nbsp;//&nbsp; live / counter &nbsp;//&nbsp; 1 s
      </div>

      {/* Middle — the number. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
          position: 'relative',
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 50%, transparent)',
          }}
        >
          ticks since mount
        </div>
        <div
          style={{
            fontSize: 220,
            lineHeight: 1,
            letterSpacing: '-0.04em',
            color: 'var(--brandColor, #B85B33)',
            minWidth: 220,
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </div>
      </div>

      {/* Bottom — metadata. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 14,
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 50%, transparent)',
          position: 'relative',
        }}
      >
        <div>liveRefresh: 1000 ms</div>
        <div>edit live/config.json</div>
      </div>
    </div>
  );
}
