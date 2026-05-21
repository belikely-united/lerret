export const meta = {
  dimensions: { width: 1080, height: 1920 },
  label: 'App Store screenshot — feature highlight',
  tags: ['poster', 'mockup', 'app-store', 'screenshot'],
  propsSchema: {
    page: { type: 'string', default: '01 / 06' },
    headline: { type: 'string', default: 'Draft a launch\nin minutes.', required: true },
    subhead: { type: 'string', default: 'Type, save, export.' },
    appName: { type: 'string', default: 'Lerret' },
  },
};

function PhoneFrame({ children }) {
  return (
    <div style={{
      width: 540,
      height: 1170,
      position: 'relative',
      filter: 'drop-shadow(0 40px 80px rgba(0,0,0,0.45))',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 78,
        background: 'linear-gradient(135deg, #2b2a28 0%, #4a4844 35%, #2b2a28 70%, #1a1816 100%)',
        padding: 14,
      }}>
        <div style={{
          position: 'absolute',
          inset: 6,
          borderRadius: 72,
          background: '#0a0908',
          padding: 4,
        }}>
          <div style={{
            width: '100%',
            height: '100%',
            borderRadius: 68,
            background: '#F4F0E8',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              top: 22,
              left: 40,
              right: 40,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 20,
              fontWeight: 800,
              color: '#1A1410',
              zIndex: 2,
            }}>
              <span>9:41</span>
              <span style={{ fontSize: 14 }}>●●●●● 5G ▮</span>
            </div>
            <div style={{
              position: 'absolute',
              top: 18,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 160,
              height: 46,
              background: '#0a0908',
              borderRadius: 26,
              zIndex: 3,
            }} />
            <div style={{ width: '100%', height: '100%' }}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockEditor({ appName }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      paddingTop: 100,
      paddingLeft: 28,
      paddingRight: 28,
      paddingBottom: 100,
      boxSizing: 'border-box',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1A1410',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      {/* App header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.02em' }}>
          {appName}
        </div>
        <div style={{
          padding: '6px 12px',
          background: '#B85B33',
          color: '#FFE5A8',
          borderRadius: 100,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.15em',
        }}>
          EXPORT
        </div>
      </div>

      <div style={{
        fontSize: 12,
        letterSpacing: '0.2em',
        color: 'rgba(26,20,16,0.55)',
        fontWeight: 700,
        fontFamily: 'ui-monospace, Menlo, monospace',
        textTransform: 'uppercase',
      }}>
        .lerret / marketing / release.jsx
      </div>

      {/* Code editor mock */}
      <div style={{
        background: '#0a0908',
        borderRadius: 14,
        padding: '20px 18px',
        color: '#F2EEE5',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        flex: 1,
      }}>
        <div><span style={{ color: '#A7F3D0' }}>export const</span> <span style={{ color: '#FFD56B' }}>meta</span> = {'{'}</div>
        <div>{'  '}width: <span style={{ color: '#E8896C' }}>1200</span>,</div>
        <div>{'  '}height: <span style={{ color: '#E8896C' }}>1500</span>,</div>
        <div>{'};'}</div>
        <div style={{ marginTop: 8 }}><span style={{ color: '#A7F3D0' }}>export default function</span> <span style={{ color: '#FFD56B' }}>Card</span>() {'{'}</div>
        <div>{'  '}<span style={{ color: '#A7F3D0' }}>return</span> &lt;<span style={{ color: '#22D3EE' }}>div</span>&gt;</div>
        <div>{'    '}Launch day.</div>
        <div>{'  '}&lt;/<span style={{ color: '#22D3EE' }}>div</span>&gt;;</div>
        <div>{'}'}</div>
      </div>

      {/* Preview thumbnail mock */}
      <div style={{
        borderRadius: 14,
        background: 'linear-gradient(150deg, #08111A 0%, #1B2E45 100%)',
        height: 200,
        padding: 16,
        color: '#F4F7FA',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        <div style={{
          fontSize: 10,
          letterSpacing: '0.25em',
          color: '#E8C8B6',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontWeight: 700,
        }}>
          v2.0 · CODENAME HYDRA
        </div>
        <div style={{
          fontSize: 28,
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
        }}>
          A new way to ship.
        </div>
      </div>

      {/* Bottom tab */}
      <div style={{
        position: 'absolute',
        left: 28,
        right: 28,
        bottom: 28,
        display: 'flex',
        justifyContent: 'space-around',
        padding: '14px 0',
        borderTop: '1px solid rgba(26,20,16,0.12)',
      }}>
        {['◆', '⊞', '◯', '⚙'].map((g, i) => (
          <div key={i} style={{
            fontSize: 18,
            color: i === 0 ? '#B85B33' : 'rgba(26,20,16,0.4)',
          }}>{g}</div>
        ))}
      </div>
    </div>
  );
}

export default function AppStoreScreenshot({
  page = '01 / 06',
  headline = 'Draft a launch\nin minutes.',
  subhead = 'Type, save, export.',
  appName = 'Lerret',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: 'linear-gradient(180deg, #1A0F2E 0%, #2A1410 50%, #6B2616 100%)',
      color: '#F5EBD8',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Top glow */}
      <div style={{
        position: 'absolute',
        top: -300,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 1200,
        height: 800,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(232,165,63,0.4), transparent 65%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Top: pagination tag */}
      <div style={{
        position: 'absolute',
        top: 64,
        left: 64,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 18,
        letterSpacing: '0.35em',
        color: 'rgba(245,235,216,0.65)',
        fontWeight: 700,
      }}>
        {page}
      </div>

      {/* Eyebrow + headline at top */}
      <div style={{
        position: 'absolute',
        left: 64,
        right: 64,
        top: 160,
        textAlign: 'center',
      }}>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 18,
          letterSpacing: '0.4em',
          color: '#E8A53F',
          fontWeight: 700,
          marginBottom: 28,
        }}>
          ✦ {appName.toUpperCase()} FOR iOS
        </div>
        <div style={{
          fontSize: 96,
          fontWeight: 900,
          lineHeight: 0.95,
          letterSpacing: '-0.045em',
          whiteSpace: 'pre-line',
          textWrap: 'balance',
        }}>
          {headline}
        </div>
        <div style={{
          fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 32,
          marginTop: 22,
          opacity: 0.75,
        }}>
          {subhead}
        </div>
      </div>

      {/* Phone — anchored bottom-center */}
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: -60,
        transform: 'translateX(-50%)',
      }}>
        <PhoneFrame>
          <MockEditor appName={appName} />
        </PhoneFrame>
      </div>
    </div>
  );
}
