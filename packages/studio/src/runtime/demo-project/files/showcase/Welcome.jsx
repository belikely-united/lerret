import { useState } from 'react';

export const meta = { label: 'Welcome', dimensions: { width: 1200, height: 630 } };

export default function Welcome() {
  const [clicks, setClicks] = useState(0);
  return (
    <div
      onClick={() => setClicks((c) => c + 1)}
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: '#FAF8F2',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: 'pointer',
      }}
    >
      <img src="../_assets/lerret-mark.svg" width="84" height="84" alt="Lerret" style={{ display: 'block' }} />
      <div style={{ fontSize: 64, fontWeight: 700, color: '#1A1714' }}>Welcome to Lerret</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: '#B85B33' }}>
        Your folder is a canvas. Clicks: {clicks}
      </div>
      <div style={{ fontSize: 15, color: '#6E6960' }}>
        This whole demo is files in a folder. Click an asset, edit its code, watch it re-render.
      </div>
    </div>
  );
}
