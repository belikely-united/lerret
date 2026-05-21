// Sample asset — Twitter / X profile banner (1600 × 900).
//
// Plain React with inline styles. Uses `LerretFixtureMono` from the project's
// `_fonts/` folder, which Lerret auto-registers as an `@font-face` rule — no
// import or manual CSS needed. Edit the `meta` fields and the component body
// to make this banner your own.

export const meta = {
  dimensions: { width: 1600, height: 900 },
  label: 'Twitter / X banner',
  tags: ['social', 'twitter', 'banner', 'wide'],
  propsSchema: {
    headline: {
      type: 'string',
      default: 'Your project name',
      description: 'Main headline on the banner.',
      required: true,
    },
    tagline: {
      type: 'string',
      default: 'A short description of what you build.',
      description: 'Supporting tagline below the headline.',
    },
    showAccentBar: {
      type: 'boolean',
      default: true,
      description: 'Show the decorative color bar on the left.',
    },
  },
};

export default function TwitterBanner({
  headline = 'Your project name',
  tagline = 'A short description of what you build.',
  showAccentBar = true,
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: '#1B2A3B',
        display: 'flex',
        alignItems: 'center',
        padding: '0 120px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle background texture — two layered ellipses */}
      <div
        style={{
          position: 'absolute',
          right: -80,
          top: -120,
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(61,90,128,0.35) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 160,
          bottom: -160,
          width: 480,
          height: 480,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(224,251,252,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Left accent bar */}
      {showAccentBar && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 8,
            background: 'linear-gradient(180deg, #3D5A80 0%, #E0FBFC 100%)',
          }}
        />
      )}

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 900 }}>
        {/* Logotype — uses the auto-registered custom font */}
        <div
          style={{
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 48,
            color: '#E0FBFC',
            letterSpacing: '0.12em',
            lineHeight: 1,
          }}
        >
          lerret
        </div>

        {/* Headline */}
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 80,
            fontWeight: 800,
            color: '#F4F7FA',
            lineHeight: 1.05,
            letterSpacing: '-0.025em',
          }}
        >
          {headline}
        </div>

        {/* Tagline */}
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 34,
            fontWeight: 400,
            color: '#8BAEC8',
            lineHeight: 1.4,
            letterSpacing: '-0.01em',
          }}
        >
          {tagline}
        </div>
      </div>
    </div>
  );
}
