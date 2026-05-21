// Re-evaluated at load — keeps the rendered preview fresh per export run.
const start = new Date('2026-01-15T10:00:00Z');
const now = new Date();
const elapsedSec = Math.max(0, Math.floor((now - start) / 1000));

function fmt(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default {
  track: 'Ship Lerret 1.0',
  artist: 'Belikely United',
  elapsed: fmt(Math.min(elapsedSec, 30 * 60)),
  duration: '30:00',
};
