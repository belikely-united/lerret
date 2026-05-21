export const meta = {
  dimensions: { width: 1200, height: 800 },
  label: 'Open source release',
  tags: ['poster', 'open-source', 'announcement'],
  propsSchema: {
    project: { type: 'string', default: 'Lerret', required: true },
    description: { type: 'string', default: 'A design canvas where a folder of React components renders as a visual canvas.' },
    repo: { type: 'string', default: 'github.com/belikely-united/lerret' },
    licence: { type: 'string', default: 'MIT' },
    note: { type: 'string', default: 'Free to fork, embed, and ship.' },
  },
};

export default function OpenSourceRelease({
  project = 'Lerret',
  description = 'A design canvas where a folder of React components renders as a visual canvas.',
  repo = 'github.com/belikely-united/lerret',
  licence = 'MIT',
  note = 'Free to fork, embed, and ship.',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#0A0F0A',
      color: '#A7F3D0',
      fontFamily: 'ui-monospace, Menlo, monospace',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      {/* Terminal-style grid pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: 'linear-gradient(rgba(167,243,208,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(167,243,208,0.04) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      {/* Subtle green bloom — top-left */}
      <div style={{
        position: 'absolute',
        top: -200,
        left: -100,
        width: 600,
        height: 600,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(52,211,153,0.18), transparent 60%)',
        filter: 'blur(40px)',
        pointerEvents: 'none',
      }} />

      {/* Top: terminal-style ledger */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottom: '1px solid rgba(167,243,208,0.25)',
        paddingBottom: 16,
        fontSize: 13,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
      }}>
        <span style={{ color: '#34D399', fontWeight: 700 }}>
          ● running · open source now
        </span>
        <span style={{ color: 'rgba(167,243,208,0.55)' }}>
          {licence} license
        </span>
      </div>

      {/* CENTER: project name in italic serif */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontSize: 18,
          letterSpacing: '0.4em',
          color: '#34D399',
          fontWeight: 700,
          marginBottom: 24,
        }}>
          $ git clone
        </div>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 200,
          fontWeight: 400,
          fontStyle: 'italic',
          letterSpacing: '-0.04em',
          lineHeight: 0.9,
          color: '#F2EEE5',
        }}>
          {project}.
        </div>
        <div style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 26,
          fontStyle: 'italic',
          lineHeight: 1.35,
          color: 'rgba(242,238,229,0.78)',
          marginTop: 20,
          maxWidth: '82%',
        }}>
          {description}
        </div>
      </div>

      {/* Bottom: repo + note */}
      <div style={{
        position: 'relative',
        borderTop: '1px solid rgba(167,243,208,0.25)',
        paddingTop: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        fontSize: 14,
        letterSpacing: '0.15em',
      }}>
        <span style={{ color: '#34D399', fontWeight: 700 }}>
          → {repo}
        </span>
        <span style={{ fontStyle: 'italic', color: 'rgba(167,243,208,0.7)', fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: 'normal', fontSize: 18 }}>
          {note}
        </span>
      </div>
    </div>
  );
}
