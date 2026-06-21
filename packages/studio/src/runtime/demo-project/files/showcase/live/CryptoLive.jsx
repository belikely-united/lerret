// CryptoLive.jsx — a DATA-DRIVEN artboard powered by a dynamic data file.
//
// This component is pure presentation: it receives `btc` / `eth` / `sol` /
// `updatedAt` as PROPS and just draws them. The values come from the co-located
// `CryptoLive.data.js`, which fetches them live from a public API (CoinGecko).
//
// So the same Tier-1 data path that feeds a static `.data.json` here feeds a
// LIVE feed — and with `CryptoLive.config.json` ({ "autoRefresh": 45000 }) the
// data file re-runs every 45s, so the prices tick on their own.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'Live crypto — powered by .data.js',
  tags: ['live', 'data', 'dynamic', 'api'],
  propsSchema: {
    btc: { type: 'object' },
    eth: { type: 'object' },
    sol: { type: 'object' },
    updatedAt: { type: 'string', default: '—' },
  },
};

const COINS = [
  ['BTC', 'Bitcoin', 'btc'],
  ['ETH', 'Ethereum', 'eth'],
  ['SOL', 'Solana', 'sol'],
];

const UP = '#7BC47F';
const DOWN = '#E5806B';

function fmtPrice(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '—';
  return n >= 1000 ? `$${n.toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

export default function CryptoLive({ btc, eth, sol, updatedAt = '—' }) {
  const byKey = { btc, eth, sol };
  const haveData = Boolean(btc && typeof btc.price === 'number' && btc.price > 0);

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
          ◆ live crypto / .data.js
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
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: haveData ? UP : 'var(--brandColor, #B85B33)',
            }}
          />
          {haveData ? `fetched ${updatedAt}` : 'awaiting data'}
        </div>
      </div>

      <div style={{ display: 'flex', alignSelf: 'center', width: '100%' }}>
        {COINS.map(([sym, name, key], i) => {
          const c = byKey[key];
          const price = c && typeof c.price === 'number' ? c.price : null;
          const change = c && typeof c.change === 'number' ? c.change : null;
          const up = (change ?? 0) >= 0;
          return (
            <div
              key={key}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingLeft: i === 0 ? 0 : 28,
                marginLeft: i === 0 ? 0 : 28,
                borderLeft:
                  i === 0
                    ? 'none'
                    : '1px solid color-mix(in oklab, var(--neutralLight, #F8F4EC) 14%, transparent)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--accentColor, #F1EDE5)' }}>
                  {sym}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 50%, transparent)',
                  }}
                >
                  {name}
                </span>
              </div>
              <div
                style={{
                  fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                  fontSize: 40,
                  fontWeight: 600,
                  lineHeight: 1.05,
                  color: 'var(--neutralLight, #F8F4EC)',
                  opacity: price == null ? 0.4 : 1,
                }}
              >
                {fmtPrice(price)}
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: change == null ? 'transparent' : up ? UP : DOWN }}>
                {change == null ? '·' : `${up ? '▲' : '▼'} ${Math.abs(change).toFixed(2)}%`}
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    fontWeight: 400,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 40%, transparent)',
                  }}
                >
                  24h
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 13,
          letterSpacing: '0.04em',
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 55%, transparent)',
        }}
      >
        Prices come from CryptoLive.data.js — a real module that fetches CoinGecko, live.
      </div>
    </div>
  );
}
