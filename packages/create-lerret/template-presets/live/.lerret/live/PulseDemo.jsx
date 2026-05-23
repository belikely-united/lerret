// PulseDemo.jsx — LiveRefresh artboard #4.
//
// The natural target of the animated-export feature: tap the kebab on this
// artboard → Export animated… and capture the pulse as a GIF / WebP / MP4.
//
// `liveRefresh: { PulseDemo: 2000 }` keeps the asset re-rendering on the same
// cadence as the pulse itself; the actual breathing is a CSS keyframes
// animation so it interpolates smoothly between snapshots.

export const meta = {
  dimensions: { width: 800, height: 400 },
  label: 'Animated-export demo',
  tags: ['live', 'pulse', 'liveRefresh', 'animated-export'],
};

export default function PulseDemo() {
  return (
    <>
      <style>{`
        @keyframes lerret-pulse {
          0%   { opacity: 0.45; transform: scale(0.985); }
          50%  { opacity: 1;    transform: scale(1.0); }
          100% { opacity: 0.45; transform: scale(0.985); }
        }
      `}</style>
      <div
        style={{
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          background:
            'linear-gradient(135deg, var(--neutralDark, #1A1714) 0%, color-mix(in oklab, var(--brandColor, #B85B33) 55%, var(--neutralDark, #1A1714)) 100%)',
          color: 'var(--neutralLight, #F8F4EC)',
          padding: '36px 48px',
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          gap: 16,
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 16,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.85,
          }}
        >
          ◆ animated export / 2 s
        </div>

        <div
          style={{
            alignSelf: 'center',
            justifySelf: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              animation: 'lerret-pulse 2s ease-in-out infinite',
              fontSize: 56,
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              maxWidth: 660,
            }}
          >
            Tap the kebab → Export animated…
          </div>
          <div
            style={{
              fontSize: 18,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 75%, transparent)',
            }}
          >
            this pulse breathes over 2 seconds
          </div>
        </div>

        <div
          style={{
            fontSize: 16,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 55%, transparent)',
          }}
        >
          gif · webp · apng · mp4
        </div>
      </div>
    </>
  );
}
