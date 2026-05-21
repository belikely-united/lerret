export const meta = {
  dimensions: { width: 1080, height: 1080 },
  label: 'Instagram square',
  tags: ['instagram', 'square', 'social'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'The title of your post',
      required: true,
    },
    subtitle: {
      type: 'string',
      default: 'A supporting line of context.',
    },
  },
};

const THEMES = {
  ocean: { bg: '#1B2A3B', title: '#E0FBFC', sub: '#8BAEC8', tag: '#3D5A80', tagText: '#E0FBFC' },
  sand:  { bg: '#F5EFE0', title: '#2C1C0E', sub: '#7A6148', tag: '#C4975B', tagText: '#FFFFFF' },
  slate: { bg: '#1E2530', title: '#F0F4F8', sub: '#90A4BC', tag: '#4A5568', tagText: '#F0F4F8' },
};

function Card({ title, subtitle, theme }) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: theme.bg,
      color: theme.title,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '80px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 32, opacity: 0.6, letterSpacing: '0.1em' }}>YOUR BRAND</div>
      <div>
        <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em' }}>
          {title}
        </div>
        <div style={{ fontSize: 32, marginTop: 24, color: theme.sub, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      </div>
      <div style={{
        alignSelf: 'flex-start',
        background: theme.tag,
        color: theme.tagText,
        fontSize: 22,
        fontWeight: 600,
        padding: '12px 28px',
        borderRadius: 100,
      }}>
        #lerret
      </div>
    </div>
  );
}

export default function Ocean(props) {
  return <Card {...props} theme={THEMES.ocean} />;
}

export function Sand(props) {
  return <Card {...props} theme={THEMES.sand} />;
}

export function Slate(props) {
  return <Card {...props} theme={THEMES.slate} />;
}
