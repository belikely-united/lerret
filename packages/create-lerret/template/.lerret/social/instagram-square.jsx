// Sample asset — Instagram square post (1080 × 1080).
//
// Plain React with inline styles. Uses `LerretFixtureMono` from the project's
// `_fonts/` folder — Lerret auto-registers it with no manual `@font-face`
// needed. Edit the `meta` and the component body to make it your own.

export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Instagram square',
  tags: ['social', 'instagram', 'square'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'The title of your post',
      description: 'Primary text displayed on the post.',
      required: true,
    },
    subtitle: {
      type: 'string',
      default: 'A supporting line with a bit more context.',
      description: 'Secondary text below the title.',
    },
    tone: {
      type: 'select',
      default: 'ocean',
      description: 'Color palette for the card background.',
      options: ['ocean', 'sand', 'slate'],
    },
  },
};

const TONES = {
  ocean: {
    bg: 'linear-gradient(145deg, #1B2A3B 0%, #2E4A65 100%)',
    title: '#E0FBFC',
    subtitle: '#8BAEC8',
    tag: '#3D5A80',
    tagText: '#E0FBFC',
    mono: '#4A90B8',
  },
  sand: {
    bg: 'linear-gradient(145deg, #F5EFE0 0%, #E8D9BE 100%)',
    title: '#2C1C0E',
    subtitle: '#7A6148',
    tag: '#C4975B',
    tagText: '#fff',
    mono: '#C4975B',
  },
  slate: {
    bg: 'linear-gradient(145deg, #1E2530 0%, #2D3748 100%)',
    title: '#F0F4F8',
    subtitle: '#90A4BC',
    tag: '#4A5568',
    tagText: '#F0F4F8',
    mono: '#90A4BC',
  },
};

export default function InstagramSquare({
  title = 'The title of your post',
  subtitle = 'A supporting line with a bit more context.',
  tone = 'ocean',
}) {
  const colors = TONES[tone] || TONES.ocean;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: colors.bg,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '80px 80px 72px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Corner decoration */}
      <div
        style={{
          position: 'absolute',
          right: -60,
          top: -60,
          width: 320,
          height: 320,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.07)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -20,
          top: -20,
          width: 200,
          height: 200,
          borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.05)',
          pointerEvents: 'none',
        }}
      />

      {/* Top: logotype */}
      <div
        style={{
          fontFamily: "'LerretFixtureMono', monospace",
          fontSize: 36,
          color: colors.mono,
          letterSpacing: '0.1em',
          lineHeight: 1,
        }}
      >
        lerret
      </div>

      {/* Center: main content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* Decorative line */}
        <div
          style={{
            width: 56,
            height: 4,
            borderRadius: 2,
            background: colors.tag,
          }}
        />
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 72,
            fontWeight: 800,
            color: colors.title,
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 36,
            fontWeight: 400,
            color: colors.subtitle,
            lineHeight: 1.5,
            letterSpacing: '-0.01em',
          }}
        >
          {subtitle}
        </div>
      </div>

      {/* Bottom: tag pill */}
      <div
        style={{
          display: 'inline-flex',
          alignSelf: 'flex-start',
          background: colors.tag,
          color: colors.tagText,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: '0.04em',
          padding: '12px 28px',
          borderRadius: 100,
        }}
      >
        #lerret
      </div>
    </div>
  );
}
