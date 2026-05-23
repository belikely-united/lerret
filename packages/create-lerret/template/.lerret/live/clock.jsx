// clock.jsx — a digital clock (1080 × 540).
//
// Teaches **`liveRefresh`** (FR19). The component renders the current
// wall-clock time as HH:MM:SS. By itself it would render once and freeze.
// What makes the artboard tick is the `liveRefresh` block in
// `live/config.json`:
//
//   { "liveRefresh": { "clock": 1000, "counter": 1000 } }
//
// That line tells Lerret to re-render this asset every 1000 ms (1 s). The
// runtime drives the refresh — the component itself just reads `Date.now()`
// inside a `useEffect` and updates state.

import React, { useEffect, useState } from 'react';

export const meta = {
  dimensions: { width: 1080, height: 540 },
  label: 'Live clock',
  tags: ['live', 'clock', 'demo'],
};

function pad(n) {
  return String(n).padStart(2, '0');
}

export default function Clock() {
  const [now, setNow] = useState(() => new Date());

  // We belt-and-brace the liveRefresh-driven re-render with an internal
  // setInterval. liveRefresh re-mounts the artboard wrapper; the interval
  // here keeps the in-component state honest if you ever inspect the
  // component without liveRefresh enabled. Either path gives you a ticking
  // clock.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--neutralDark, #1A1814)',
        color: 'var(--neutralLight, #F7F4F0)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px 64px',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Soft accent halo behind the digits. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 900,
          height: 900,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #B85B33) 30%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top — label. */}
      <div
        style={{
          fontSize: 16,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 65%, transparent)',
          position: 'relative',
        }}
      >
        ◆ lerret &nbsp;//&nbsp; live / clock &nbsp;//&nbsp; 1 s
      </div>

      {/* Middle — the digits. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          gap: 12,
          fontSize: 220,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          position: 'relative',
          color: 'var(--neutralLight, #F7F4F0)',
        }}
      >
        <span>{hours}</span>
        <span style={{ color: 'var(--brandColor, #B85B33)' }}>:</span>
        <span>{minutes}</span>
        <span style={{ color: 'var(--brandColor, #B85B33)' }}>:</span>
        <span style={{ color: 'var(--accentColor, #F4D5C3)' }}>{seconds}</span>
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
          color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 50%, transparent)',
          position: 'relative',
        }}
      >
        <div>liveRefresh: 1000 ms</div>
        <div>edit live/config.json</div>
      </div>
    </div>
  );
}
