// Sample asset — typographic poster (1080 × 1620, ISO-216-ish tall ratio).
//
// Pure component — no data file, no propsSchema. Demonstrates a single
// strong typographic composition that lives in code rather than in props.
// Edit the JSX directly to change the words or the geometry.
//
// Aesthetic notes — committed to a single direction (brutalist / typographic):
//   • All type is `LerretFixtureMono`. No system stack anywhere.
//   • Heavy vertical rhythm: dateline at top, exploded headline mid-canvas,
//     metadata at bottom.
//   • One sharp accent block — the corner number-square — anchors the eye.

export const meta = {
  dimensions: { width: 1080, height: 1620 },
  label: 'Typographic poster',
  tags: ['poster', 'print', 'personal', 'vertical'],
};

export default function Poster() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1B2A3B)',
        color: 'var(--neutralLight, #F4F7FA)',
        padding: '72px 72px 56px',
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        gap: 32,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Hairline frame — typographic restraint. */}
      <div
        style={{
          position: 'absolute',
          inset: 40,
          border: '1px solid color-mix(in oklab, var(--neutralLight, #F4F7FA) 18%, transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Top row — dateline + corner number block. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'start',
          gap: 24,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 16, letterSpacing: '0.36em', textTransform: 'uppercase', opacity: 0.7 }}>
            ◆ lerret&nbsp;&nbsp;//&nbsp;&nbsp;sample n°04
          </div>
          <div style={{ fontSize: 14, letterSpacing: '0.28em', opacity: 0.5 }}>
            edit-me — typography only, no propsSchema
          </div>
        </div>

        <div
          style={{
            width: 112,
            height: 112,
            background: 'var(--accentColor, #E0FBFC)',
            color: 'var(--neutralDark, #1B2A3B)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 60,
            lineHeight: 1,
          }}
        >
          04
        </div>
      </div>

      {/* Headline — exploded across the canvas. The line breaks are part of
          the composition; don't reflow them to make them "fit nicer". */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <div style={{ fontSize: 168, lineHeight: 0.9, letterSpacing: '-0.025em', textIndent: '-0.06em' }}>
          designs
        </div>
        <div style={{ fontSize: 168, lineHeight: 0.9, letterSpacing: '-0.025em', textAlign: 'right', color: 'var(--accentColor, #E0FBFC)' }}>
          are just
        </div>
        <div style={{ fontSize: 168, lineHeight: 0.9, letterSpacing: '-0.025em', textIndent: '-0.06em' }}>
          files.
        </div>
      </div>

      {/* Bottom metadata row. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 20,
          fontSize: 16,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 70%, transparent)',
          position: 'relative',
          paddingTop: 24,
          borderTop: '1px solid color-mix(in oklab, var(--neutralLight, #F4F7FA) 18%, transparent)',
        }}
      >
        <div>format / 1080 × 1620</div>
        <div style={{ textAlign: 'center' }}>medium / .jsx</div>
        <div style={{ textAlign: 'right' }}>edit me ↗</div>
      </div>
    </div>
  );
}
