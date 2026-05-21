export const meta = {
  dimensions: { width: 1600, height: 1000 },
  label: 'Multi-device — phone + laptop showcase',
  tags: ['poster', 'mockup', 'multi-device', 'launch'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'AVAILABLE EVERYWHERE' },
    headline: { type: 'string', default: 'Render once. Ship everywhere.', required: true },
    tagline: { type: 'string', default: 'One folder of React components. Every social card, OG image, app screenshot, and release graphic — generated from code.' },
    appName: { type: 'string', default: 'Lerret' },
  },
};

function PhoneFrame({ children, rotate = 0, scale = 1 }) {
  return (
    <div style={{
      width: 320,
      height: 690,
      transform: `rotate(${rotate}deg) scale(${scale})`,
      transformOrigin: 'center',
      position: 'relative',
      filter: 'drop-shadow(0 30px 60px rgba(0,0,0,0.5))',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 48,
        background: 'linear-gradient(135deg, #2b2a28 0%, #4a4844 35%, #2b2a28 70%, #1a1816 100%)',
        padding: 8,
      }}>
        <div style={{
          position: 'absolute',
          inset: 3,
          borderRadius: 45,
          background: '#0a0908',
          padding: 3,
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: 42,
            background: '#F4F0E8',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              top: 11,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 96,
              height: 28,
              background: '#0a0908',
              borderRadius: 16,
              zIndex: 3,
            }} />
            <div style={{ width: '100%', height: '100%' }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LaptopFrame({ children }) {
  return (
    <div style={{
      width: 800,
      height: 500,
      position: 'relative',
      filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.5))',
    }}>
      {/* Screen */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 30,
        right: 30,
        bottom: 30,
        background: 'linear-gradient(135deg, #2b2a28, #1a1816)',
        borderRadius: 16,
        padding: 12,
      }}>
        <div style={{
          width: '100%',
          height: '100%',
          background: '#F4F0E8',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
        }}>
          {children}
        </div>
      </div>
      {/* Bottom hinge / base */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 30,
        background: 'linear-gradient(180deg, #4a4844 0%, #2b2a28 100%)',
        borderRadius: '0 0 16px 16px',
      }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 120,
          height: 8,
          background: '#1a1816',
          borderRadius: '0 0 12px 12px',
        }} />
      </div>
    </div>
  );
}

function MockPhoneCanvas({ appName }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      paddingTop: 48,
      paddingBottom: 48,
      paddingLeft: 16,
      paddingRight: 16,
      boxSizing: 'border-box',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1A1410',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>{appName}</div>
        <div style={{ fontSize: 9, color: '#B85B33', fontWeight: 700 }}>●●●</div>
      </div>
      <div style={{
        background: 'linear-gradient(135deg, #2D1810 0%, #DA552F 100%)',
        borderRadius: 10,
        padding: 14,
        height: 100,
        color: '#FFE5A8',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 8, letterSpacing: '0.2em', fontWeight: 700 }}>LIVE ON PH</div>
        <div style={{ fontSize: 22, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.04em' }}>
          {appName}.
        </div>
      </div>
      <div style={{
        background: '#0A0F0A',
        borderRadius: 10,
        padding: 14,
        height: 80,
        color: '#A7F3D0',
        fontFamily: 'ui-monospace, Menlo, monospace',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 9, color: '#34D399', fontWeight: 700 }}>● OPEN SOURCE</div>
        <div style={{
          fontFamily: 'Georgia, serif',
          fontSize: 20,
          fontStyle: 'italic',
          color: '#F2EEE5',
        }}>
          {appName}.
        </div>
      </div>
      <div style={{
        background: '#EFD9D4',
        borderRadius: 10,
        padding: 12,
        height: 60,
        color: '#1E0F0C',
      }}>
        <div style={{ fontSize: 8, color: '#8B3A2E', fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          QUOTE
        </div>
        <div style={{
          fontSize: 12,
          fontStyle: 'italic',
          fontFamily: 'Georgia, serif',
          marginTop: 4,
          lineHeight: 1.2,
        }}>
          "Built in a weekend."
        </div>
      </div>
    </div>
  );
}

function MockLaptopCanvas({ appName }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      padding: 16,
      boxSizing: 'border-box',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1A1410',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        gap: 5,
        alignItems: 'center',
        paddingBottom: 8,
        borderBottom: '1px solid rgba(26,20,16,0.12)',
      }}>
        <div style={{ width: 10, height: 10, borderRadius: 5, background: '#E8896C' }} />
        <div style={{ width: 10, height: 10, borderRadius: 5, background: '#FFD56B' }} />
        <div style={{ width: 10, height: 10, borderRadius: 5, background: '#A7F3D0' }} />
        <div style={{
          marginLeft: 16,
          fontSize: 11,
          fontFamily: 'ui-monospace, Menlo, monospace',
          color: 'rgba(26,20,16,0.6)',
          fontWeight: 600,
        }}>
          .lerret / marketing
        </div>
      </div>

      {/* Canvas grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        gap: 10,
      }}>
        {/* Card 1: PH launch */}
        <div style={{
          background: 'linear-gradient(135deg, #2D1810, #DA552F)',
          borderRadius: 8,
          padding: 10,
          color: '#FFE5A8',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 7, letterSpacing: '0.2em', fontWeight: 800 }}>LIVE ON PH</div>
          <div style={{ fontSize: 18, fontStyle: 'italic', fontWeight: 900, letterSpacing: '-0.04em' }}>
            {appName}.
          </div>
        </div>
        {/* Card 2: stars */}
        <div style={{
          background: 'linear-gradient(160deg, #050818, #2A1147)',
          borderRadius: 8,
          padding: 10,
          color: '#FFD56B',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <div style={{
            fontSize: 38,
            fontWeight: 900,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            lineHeight: 1,
          }}>10K</div>
          <div style={{ fontSize: 7, marginTop: 4, opacity: 0.8, letterSpacing: '0.3em' }}>STARS</div>
        </div>
        {/* Card 3: hiring */}
        <div style={{
          background: '#F4E22B',
          borderRadius: 8,
          padding: 10,
          color: '#0B0B0B',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 7, letterSpacing: '0.2em', fontWeight: 800 }}>HIRING</div>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 0.95 }}>
            WANTED.
          </div>
        </div>
        {/* Card 4: open source */}
        <div style={{
          background: '#0A0F0A',
          borderRadius: 8,
          padding: 10,
          color: '#A7F3D0',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}>
          <div style={{ fontSize: 7, color: '#34D399', fontWeight: 700 }}>● OPEN SOURCE</div>
          <div style={{
            fontFamily: 'Georgia, serif',
            fontSize: 18,
            fontStyle: 'italic',
            color: '#F2EEE5',
          }}>
            {appName}.
          </div>
        </div>
        {/* Card 5: testimonial */}
        <div style={{
          background: '#EFD9D4',
          borderRadius: 8,
          padding: 10,
          color: '#1E0F0C',
        }}>
          <div style={{ fontSize: 7, color: '#8B3A2E', fontWeight: 800, letterSpacing: '0.15em' }}>QUOTE</div>
          <div style={{
            fontSize: 11,
            fontStyle: 'italic',
            fontFamily: 'Georgia, serif',
            marginTop: 4,
            lineHeight: 1.15,
          }}>
            "Built in a weekend."
          </div>
        </div>
        {/* Card 6: release */}
        <div style={{
          background: 'linear-gradient(150deg, #08111A, #1B2E45)',
          borderRadius: 8,
          padding: 10,
          color: '#F4F7FA',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div style={{
            fontSize: 7,
            letterSpacing: '0.2em',
            color: '#E8C8B6',
            fontWeight: 800,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}>
            v2.0
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.02em' }}>
            A new way<br/>to ship.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MultiDevice({
  eyebrow = 'AVAILABLE EVERYWHERE',
  headline = 'Render once. Ship everywhere.',
  tagline = 'One folder of React components. Every social card, OG image, app screenshot, and release graphic — generated from code.',
  appName = 'Lerret',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: 'linear-gradient(135deg, #1A0F2E 0%, #0F0A1F 100%)',
      color: '#F2E6C9',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 80px',
    }}>
      {/* Glow */}
      <div style={{
        position: 'absolute',
        bottom: -300,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 1400,
        height: 900,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(232,165,63,0.25), transparent 65%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Top: eyebrow + headline */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.35em',
          color: '#E8A53F',
          fontWeight: 700,
        }}>
          ◆ {eyebrow}
        </div>
        <div style={{
          marginTop: 22,
          fontSize: 72,
          fontWeight: 900,
          lineHeight: 0.98,
          letterSpacing: '-0.04em',
          textWrap: 'balance',
          maxWidth: '64%',
        }}>
          {headline}
        </div>
        <div style={{
          marginTop: 18,
          fontSize: 20,
          maxWidth: '52%',
          lineHeight: 1.45,
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
          color: 'rgba(242,230,201,0.75)',
        }}>
          {tagline}
        </div>
      </div>

      {/* Laptop — anchored right-center */}
      <div style={{
        position: 'absolute',
        right: 80,
        top: 240,
      }}>
        <LaptopFrame>
          <MockLaptopCanvas appName={appName} />
        </LaptopFrame>
      </div>

      {/* Phone — overlapping laptop bottom-left */}
      <div style={{
        position: 'absolute',
        right: 720,
        bottom: 60,
      }}>
        <PhoneFrame rotate={-6}>
          <MockPhoneCanvas appName={appName} />
        </PhoneFrame>
      </div>

      {/* Bottom rule + tags */}
      <div style={{
        position: 'absolute',
        left: 80,
        right: 80,
        bottom: 56,
        borderTop: '1px solid rgba(242,230,201,0.25)',
        paddingTop: 18,
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 12,
        letterSpacing: '0.25em',
        textTransform: 'uppercase',
        color: 'rgba(242,230,201,0.55)',
        fontWeight: 700,
      }}>
        <span>iOS · iPadOS · macOS · Web</span>
        <span>{appName.toLowerCase()}.com</span>
      </div>
    </div>
  );
}
