// CryptoLive.data.js — DYNAMIC data, fetched live.
//
// This is the "not just static JSON" half. A `.data.js` is a real ES module:
// it can compute or *fetch* its data at load time and `export default` the
// result. The studio imports this module and feeds the default export to
// CryptoLive.jsx as props — the same Tier-1 data path a static `.data.json`
// uses, but live.
//
// Top-level `await` is the contract: the import resolves only after the fetch
// completes, so the canvas always renders with real prices. On an auto-refresh
// tick the module is re-imported (a fresh cache-bust), so this fetch runs again
// and the prices update. CoinGecko is free, keyless, and CORS-open.

const res = await fetch(
  'https://api.coingecko.com/api/v3/simple/price' +
    '?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true',
  { cache: 'no-store' },
);
const d = await res.json();

const pick = (id) => ({
  price: Math.round((d && d[id] && d[id].usd) || 0),
  change: Number((((d && d[id] && d[id].usd_24h_change) || 0)).toFixed(2)),
});

export default {
  btc: pick('bitcoin'),
  eth: pick('ethereum'),
  sol: pick('solana'),
  updatedAt: new Date().toLocaleTimeString('en-GB', { hour12: false }),
};
