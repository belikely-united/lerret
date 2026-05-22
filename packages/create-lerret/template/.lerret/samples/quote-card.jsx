// Sample asset — quote card (1080 × 1080, Instagram-square dimensions).
//
// Demonstrates a `propsSchema` enum (`tone`) — the studio's Data editor
// renders a select control for it, and the component branches on the chosen
// value to swap palettes.
//
// Aesthetic notes:
//   • Display type (the quote itself) uses the bundled `LerretFixtureMono`,
//     sized large and indented so the leading character optically hangs.
//   • Three tones: `dark` (default — deep ground, accent quote mark),
//     `light` (cream ground, accent attribution rule), `accent` (cyan ground,
//     dark type — the "highlight" tone). Each commits to a single dominant.

const PALETTES = {
  dark: {
    bg: 'var(--neutralDark, #1B2A3B)',
    quote: 'var(--neutralLight, #F4F7FA)',
    quoteMark: 'var(--accentColor, #E0FBFC)',
    attribution: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 55%, transparent)',
    rule: 'var(--accentColor, #E0FBFC)',
  },
  light: {
    bg: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 96%, var(--brandColor, #3D5A80))',
    quote: 'var(--neutralDark, #1B2A3B)',
    quoteMark: 'var(--brandColor, #3D5A80)',
    attribution: 'color-mix(in oklab, var(--neutralDark, #1B2A3B) 65%, transparent)',
    rule: 'var(--brandColor, #3D5A80)',
  },
  accent: {
    bg: 'var(--accentColor, #E0FBFC)',
    quote: 'var(--neutralDark, #1B2A3B)',
    quoteMark: 'var(--brandColor, #3D5A80)',
    attribution: 'color-mix(in oklab, var(--neutralDark, #1B2A3B) 65%, transparent)',
    rule: 'var(--brandColor, #3D5A80)',
  },
};

export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Quote card',
  tags: ['quote', 'square', 'personal'],
  propsSchema: {
    quote: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'The quote text itself.',
      required: true,
    },
    attribution: {
      type: 'string',
      default: '— from the Lerret sample set',
      description: 'Who said it (or where it came from).',
    },
    tone: {
      type: 'select',
      default: 'dark',
      options: ['dark', 'light', 'accent'],
      description: 'Color palette.',
    },
  },
};

export default function QuoteCard({
  quote = 'Designs are just files.',
  attribution = '— from the Lerret sample set',
  tone = 'dark',
}) {
  const palette = PALETTES[tone] || PALETTES.dark;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: palette.bg,
        padding: '96px 88px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Giant decorative quote mark — anchored top-left, behind the type. */}
      <div
        style={{
          position: 'absolute',
          left: 40,
          top: -120,
          fontFamily: "'LerretFixtureMono', monospace",
          fontSize: 540,
          lineHeight: 1,
          color: palette.quoteMark,
          opacity: tone === 'accent' ? 0.18 : 0.28,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        "
      </div>

      {/* Tiny corner mark — same on every tone. */}
      <div
        style={{
          fontFamily: "'LerretFixtureMono', monospace",
          fontSize: 18,
          letterSpacing: '0.32em',
          color: palette.attribution,
          textTransform: 'uppercase',
          position: 'relative',
        }}
      >
        ◆ lerret
      </div>

      {/* The quote. */}
      <div
        style={{
          fontFamily: "'LerretFixtureMono', monospace",
          fontSize: 76,
          lineHeight: 1.12,
          letterSpacing: '-0.015em',
          color: palette.quote,
          position: 'relative',
          textIndent: '-0.04em',
          maxWidth: 900,
        }}
      >
        {quote}
      </div>

      {/* Attribution + accent rule. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, position: 'relative' }}>
        <div
          style={{
            width: 88,
            height: 4,
            background: palette.rule,
          }}
        />
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 24,
            fontWeight: 500,
            color: palette.attribution,
            letterSpacing: '0.01em',
          }}
        >
          {attribution}
        </div>
      </div>
    </div>
  );
}
