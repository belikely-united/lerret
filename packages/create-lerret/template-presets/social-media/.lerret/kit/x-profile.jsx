// X / Twitter profile image (400 × 400).
//
// Square avatar. Bold monogram on the brand-color ground.

export const meta = {
  dimensions: { width: 400, height: 400 },
  label: 'X profile image',
  tags: ['social', 'x', 'profile', 'avatar'],
  propsSchema: {
    monogram: {
      type: 'string',
      default: '◆',
      description: 'Single character or short monogram (1–2 chars).',
    },
  },
};

export default function XProfile({ monogram = '◆' }) {
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
        borderRadius: '50%',
      }}
    >
      {/* Subtle inner ring. */}
      <div
        style={{
          position: 'absolute',
          inset: 16,
          borderRadius: '50%',
          border: '2px solid color-mix(in oklab, var(--accentColor, #F1EDE5) 35%, transparent)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          fontSize: 220,
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: '-0.04em',
        }}
      >
        {monogram}
      </div>
    </div>
  );
}
