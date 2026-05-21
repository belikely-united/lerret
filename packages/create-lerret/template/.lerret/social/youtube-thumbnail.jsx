// Sample asset — YouTube thumbnail (1280 × 720).
//
// Plain React with inline styles. Uses `LerretFixtureMono` from the project's
// `_fonts/` folder — Lerret auto-registers it with no manual `@font-face`
// needed. Edit the `meta` and the component body to make it your own.

export const meta = {
  dimensions: { width: 1280, height: 720 },
  label: 'YouTube thumbnail',
  tags: ['social', 'youtube', 'thumbnail', 'video'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'Video title goes here',
      description: 'Main title text on the thumbnail.',
      required: true,
    },
    episodeLabel: {
      type: 'string',
      default: 'EP 01',
      description: 'Episode or series label shown in the accent chip.',
    },
    showBrand: {
      type: 'boolean',
      default: true,
      description: 'Show the Lerret logotype watermark.',
    },
  },
};

export default function YoutubeThumbnail({
  title = 'Video title goes here',
  episodeLabel = 'EP 01',
  showBrand = true,
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: '#1B2A3B',
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Right panel: accent color block */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 480,
          background: 'linear-gradient(135deg, #3D5A80 0%, #2A4060 100%)',
        }}
      />

      {/* Diagonal cut between panels */}
      <div
        style={{
          position: 'absolute',
          right: 380,
          top: 0,
          bottom: 0,
          width: 160,
          background: '#1B2A3B',
          transform: 'skewX(-8deg)',
          transformOrigin: 'top left',
        }}
      />

      {/* Subtle grid overlay on right panel */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 480,
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.04) 40px), repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.04) 40px)',
          pointerEvents: 'none',
        }}
      />

      {/* Left content area */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '52px 56px',
          width: '62%',
        }}
      >
        {/* Top: episode chip */}
        <div
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            background: '#E0FBFC',
            color: '#1B2A3B',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '0.08em',
            padding: '8px 20px',
            borderRadius: 6,
          }}
        >
          {episodeLabel}
        </div>

        {/* Main title */}
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 68,
            fontWeight: 800,
            color: '#F4F7FA',
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
          }}
        >
          {title}
        </div>

        {/* Bottom: brand */}
        {showBrand && (
          <div
            style={{
              fontFamily: "'LerretFixtureMono', monospace",
              fontSize: 22,
              color: '#4A6380',
              letterSpacing: '0.12em',
              lineHeight: 1,
            }}
          >
            lerret
          </div>
        )}
      </div>

      {/* Right panel content: large number / decoration */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 480,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 200,
            fontWeight: 900,
            color: 'rgba(255,255,255,0.06)',
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          ▶
        </div>
      </div>
    </div>
  );
}
