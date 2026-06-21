// Product Hunt thumbnail (240 × 240).
//
// The square logo tile shown alongside the listing. Single sharp glyph on
// the brand color — the canonical brand-mark thumbnail.

export const meta = {
  dimensions: { width: 240, height: 240 },
  label: 'Product Hunt thumbnail',
  tags: ['producthunt', 'thumbnail', 'logo'],
  propsSchema: {
    glyph: {
      type: 'string',
      default: '◆',
      description: 'A single character — used as the logo.',
    },
  },
};

export default function Thumbnail({ glyph = '◆' }) {
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
      }}
    >
      {/* Faint diagonal sweep. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(135deg, color-mix(in oklab, var(--accentColor, #F1EDE5) 18%, transparent) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          fontSize: 160,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          color: 'var(--neutralLight, #F8F4EC)',
        }}
      >
        {glyph}
      </div>
    </div>
  );
}
