export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Phone-hero — app showcase',
  tags: ['poster', 'mockup', 'app-showcase', 'launch'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'NOW ON THE APP STORE' },
    headline: { type: 'string', default: 'Your folder is\nthe canvas.', required: true },
    tagline: { type: 'string', default: 'Design every social card, OG image, and release graphic — in plain React.' },
    appName: { type: 'string', default: 'Lerret' },
  },
};

// Re-usable iPhone-15-style frame. Built entirely with rounded rects,
// gradient-shaded bezel, dynamic island, status bar, and a slot for
// arbitrary screen content.
function PhoneFrame({ children, rotate = 0, scale = 1 }) {
  return (
    <div style={{
      width: 380,
      height: 820,
      transform: `rotate(${rotate}deg) scale(${scale})`,
      transformOrigin: 'center',
      position: 'relative',
      filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.35))',
    }}>
      {/* Outer titanium bezel */}
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 56,
        background: 'linear-gradient(135deg, #2b2a28 0%, #4a4844 35%, #2b2a28 70%, #1a1816 100%)',
        padding: 10,
      }}>
        {/* Inner glossy edge */}
        <div style={{
          position: 'absolute',
          inset: 4,
          borderRadius: 52,
          background: '#0a0908',
          padding: 4,
        }}>
          {/* Screen */}
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: 48,
            background: '#F4F0E8',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Status bar */}
            <div style={{
              position: 'absolute',
              top: 16,
              left: 28,
              right: 28,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 15,
              fontWeight: 700,
              color: '#1A1410',
              zIndex: 2,
            }}>
              <span>9:41</span>
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                <span>●●●●</span>
                <span style={{ marginLeft: 4 }}>5G</span>
                <span style={{ marginLeft: 6, fontSize: 13 }}>▮</span>
              </span>
            </div>
            {/* Dynamic Island */}
            <div style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 116,
              height: 34,
              background: '#0a0908',
              borderRadius: 18,
              zIndex: 3,
            }} />
            {/* Screen content */}
            <div style={{ width: '100%', height: '100%' }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Mock app: a Lerret-y canvas with three artboard cards stacked.
function MockApp({ appName }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      paddingTop: 70,
      paddingBottom: 64,
      paddingLeft: 20,
      paddingRight: 20,
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* App header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.02em', color: '#1A1410' }}>
          {appName}
        </div>
        <div style={{
          fontSize: 11,
          letterSpacing: '0.2em',
          color: '#B85B33',
          fontWeight: 700,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          ●●●
        </div>
      </div>

      <div style={{
        fontSize: 11,
        letterSpacing: '0.25em',
        color: 'rgba(26,20,16,0.55)',
        fontWeight: 700,
        marginBottom: 4,
        textTransform: 'uppercase',
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}>
        Marketing / Launch day
      </div>

      {/* Artboard card 1 — orange/PH style */}
      <div style={{
        background: 'linear-gradient(135deg, #2D1810 0%, #6B2616 60%, #DA552F 100%)',
        borderRadius: 14,
        padding: '20px 18px',
        color: '#FFE5A8',
        height: 120,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 9, letterSpacing: '0.2em', fontWeight: 700, opacity: 0.85 }}>
          LIVE ON PH
        </div>
        <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', fontStyle: 'italic', lineHeight: 0.95 }}>
          {appName}.
        </div>
        <div style={{ fontSize: 10, opacity: 0.7 }}>
          producthunt.com
        </div>
      </div>

      {/* Artboard card 2 — green / open source */}
      <div style={{
        background: '#0A0F0A',
        borderRadius: 14,
        padding: '20px 18px',
        color: '#A7F3D0',
        height: 96,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: 'ui-monospace, Menlo, monospace',
      }}>
        <div style={{ fontSize: 10, color: '#34D399', fontWeight: 700, letterSpacing: '0.15em' }}>
          ● OPEN SOURCE
        </div>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 28,
          fontStyle: 'italic',
          color: '#F2EEE5',
          fontWeight: 400,
          letterSpacing: '-0.025em',
        }}>
          {appName}.
        </div>
        <div style={{ fontSize: 9, opacity: 0.7 }}>
          → github.com
        </div>
      </div>

      {/* Artboard card 3 — testimonial */}
      <div style={{
        background: '#EFD9D4',
        borderRadius: 14,
        padding: '16px 16px',
        color: '#1E0F0C',
        height: 78,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{
          fontSize: 9,
          letterSpacing: '0.25em',
          color: '#8B3A2E',
          fontWeight: 700,
          textTransform: 'uppercase',
        }}>
          From our customers
        </div>
        <div style={{
          fontSize: 15,
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
          lineHeight: 1.15,
        }}>
          "Built our system in a weekend."
        </div>
      </div>

      {/* Bottom tab bar */}
      <div style={{
        position: 'absolute',
        left: 18,
        right: 18,
        bottom: 14,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '12px 0',
        borderTop: '1px solid rgba(26,20,16,0.12)',
      }}>
        {['◆', '⊞', '◯', '⚙'].map((g, i) => (
          <div key={i} style={{
            width: 24,
            height: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            color: i === 0 ? '#B85B33' : 'rgba(26,20,16,0.4)',
          }}>{g}</div>
        ))}
      </div>
    </div>
  );
}

export default function PhoneHero({
  eyebrow = 'NOW ON THE APP STORE',
  headline = 'Your folder is\nthe canvas.',
  tagline = 'Design every social card, OG image, and release graphic — in plain React.',
  appName = 'Lerret',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: 'linear-gradient(160deg, #F5EBD8 0%, #E8D8B0 50%, #C68A60 100%)',
      color: '#1A1410',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 80px',
    }}>
      {/* Soft warm orb top-left */}
      <div style={{
        position: 'absolute',
        top: -200,
        left: -200,
        width: 700,
        height: 700,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,229,168,0.45), transparent 65%)',
        filter: 'blur(20px)',
        pointerEvents: 'none',
      }} />

      {/* Eyebrow */}
      <div style={{
        position: 'relative',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 14,
        letterSpacing: '0.3em',
        color: '#B85B33',
        fontWeight: 700,
      }}>
        ◆ {eyebrow}
      </div>

      {/* Headline */}
      <div style={{
        position: 'relative',
        marginTop: 28,
        fontSize: 86,
        fontWeight: 900,
        lineHeight: 0.95,
        letterSpacing: '-0.045em',
        whiteSpace: 'pre-line',
        textWrap: 'balance',
        maxWidth: '74%',
      }}>
        {headline}
      </div>

      {/* Phone centered/right */}
      <div style={{
        position: 'absolute',
        right: 90,
        top: 360,
      }}>
        <PhoneFrame rotate={-6} scale={0.95}>
          <MockApp appName={appName} />
        </PhoneFrame>
      </div>

      {/* Tagline + footer */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 80,
      }}>
        <div style={{
          fontSize: 24,
          maxWidth: '60%',
          lineHeight: 1.4,
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: '#2A1810',
        }}>
          {tagline}
        </div>
        <div style={{
          marginTop: 32,
          borderTop: '1px solid rgba(26,20,16,0.3)',
          paddingTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: 'rgba(26,20,16,0.65)',
          fontWeight: 700,
        }}>
          <span>{appName.toLowerCase()}.app</span>
          <span>iOS · iPadOS · macOS</span>
        </div>
      </div>
    </div>
  );
}
