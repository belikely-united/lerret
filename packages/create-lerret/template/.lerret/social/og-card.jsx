// og-card.jsx — Instagram-square / OG card (1080 × 1080).
//
// Teaches **`propsSchema`** + co-located data. The `meta.propsSchema` block
// below declares the component's props with types, defaults, and (for `tone`)
// an enum of options. The studio's Data editor uses the schema to render the
// right controls (text inputs, select dropdowns). Real prop values resolve
// from `og-card.data.json` sitting next to this file — Tier 1 of the
// four-tier resolution chain.

const PALETTES = {
  dark: {
    bg: 'var(--neutralDark, #1A1814)',
    text: 'var(--neutralLight, #F7F4F0)',
    accent: 'var(--brandColor, #B85B33)',
    soft: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 60%, transparent)',
  },
  light: {
    bg: 'var(--neutralLight, #F7F4F0)',
    text: 'var(--neutralDark, #1A1814)',
    accent: 'var(--brandColor, #B85B33)',
    soft: 'color-mix(in oklab, var(--neutralDark, #1A1814) 60%, transparent)',
  },
  brand: {
    bg: 'var(--brandColor, #B85B33)',
    text: 'var(--neutralLight, #F7F4F0)',
    accent: 'var(--accentColor, #F4D5C3)',
    soft: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 70%, transparent)',
  },
};

export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'OG card',
  tags: ['social', 'square', 'instagram', 'og-image'],
  propsSchema: {
    headline: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'The headline shown front-and-center on the card.',
      required: true,
    },
    kicker: {
      type: 'string',
      default: 'lerret',
      description: 'Tiny eyebrow label above the headline.',
    },
    tone: {
      type: 'select',
      default: 'dark',
      options: ['dark', 'light', 'brand'],
      description: 'Color palette.',
    },
    handle: {
      type: 'string',
      default: '@lerret',
      description: 'Bottom-right author / handle line.',
    },
  },
};

export default function OgCard({
  headline = 'Designs are just files.',
  kicker = 'lerret',
  tone = 'dark',
  handle = '@lerret',
}) {
  const palette = PALETTES[tone] || PALETTES.dark;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: palette.bg,
        color: palette.text,
        padding: '96px 88px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Giant decorative quote-mark behind the type. */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: -120,
          fontSize: 540,
          lineHeight: 1,
          color: palette.accent,
          opacity: tone === 'brand' ? 0.22 : 0.18,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        ◆
      </div>

      {/* Top — kicker. */}
      <div
        style={{
          fontSize: 18,
          letterSpacing: '0.36em',
          textTransform: 'uppercase',
          color: palette.accent,
          position: 'relative',
        }}
      >
        {kicker}
      </div>

      {/* Middle — headline. */}
      <div
        style={{
          position: 'relative',
          fontSize: 88,
          lineHeight: 1.08,
          letterSpacing: '-0.02em',
          color: palette.text,
          textIndent: '-0.04em',
          maxWidth: 900,
        }}
      >
        {headline}
      </div>

      {/* Bottom — handle + accent rule. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          position: 'relative',
        }}
      >
        <div
          style={{
            width: 96,
            height: 4,
            background: palette.accent,
          }}
        />
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.16em',
            color: palette.soft,
          }}
        >
          {handle}
        </div>
      </div>
    </div>
  );
}
