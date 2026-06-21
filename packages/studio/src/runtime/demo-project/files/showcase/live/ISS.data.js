// ISS.data.js — DYNAMIC data, fetched live every refresh.
//
// wheretheiss.at returns the ISS's current position; because the station is
// moving at ~27,600 km/h the latitude/longitude are DIFFERENT on every call —
// so with ISS.config.json's { "autoRefresh": 3000 } the numbers visibly tick
// every 3 seconds. Free, keyless, CORS-open. Top-level await + export default
// is the contract: the import resolves only after the fetch completes.

const res = await fetch('https://api.wheretheiss.at/v1/satellites/25544', { cache: 'no-store' });
if (!res.ok) throw new Error(`ISS API ${res.status}`);
const d = await res.json();

const num = (v, dp = 0) => Number((typeof v === 'number' ? v : 0).toFixed(dp));

export default {
  lat: num(d.latitude, 4),
  lng: num(d.longitude, 4),
  altitude: num(d.altitude),
  velocity: num(d.velocity),
  visibility: d.visibility || '—',
  updatedAt: new Date().toLocaleTimeString('en-GB', { hour12: false }),
};
