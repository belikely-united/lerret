// Favicon source (256 × 256). Export to PNG at 32×32 / 180×180 for your
// /favicon and apple-touch-icon.

export const meta = {
  dimensions: { width: 256, height: 256 },
  label: 'Favicon source',
  tags: ['site', 'favicon', 'icon'],
  propsSchema: {
    monogram: { type: 'string', default: '◆', description: 'Single character — the favicon mark.' },
  },
};

export default function Favicon({ monogram = '◆' }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--brandColor, #B85B33)',
        color: 'var(--neutralLight, #F8F4EC)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        borderRadius: 36,
      }}
    >
      <div style={{ position: 'absolute', inset: 14, borderRadius: 26, border: '2px solid color-mix(in oklab, var(--accentColor, #F1EDE5) 35%, transparent)', pointerEvents: 'none' }} />
      <div style={{ fontSize: 156, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.04em' }}>{monogram}</div>
    </div>
  );
}
