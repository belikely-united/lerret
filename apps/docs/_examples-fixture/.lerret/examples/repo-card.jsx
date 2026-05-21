export const meta = {
  dimensions: { width: 1200, height: 600 },
  label: 'GitHub repo card',
  tags: ['github', 'og', 'stats'],
  propsSchema: {
    owner: { type: 'string', default: 'belikely-united', required: true },
    name: { type: 'string', default: 'lerret', required: true },
    tagline: { type: 'string', default: 'A folder is a canvas.' },
    stars: { type: 'string', default: '0' },
    forks: { type: 'string', default: '0' },
    language: { type: 'string', default: 'JavaScript' },
  },
};

function Stat({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 56, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

export default function RepoCard({
  owner = 'belikely-united',
  name = 'lerret',
  tagline = 'A folder is a canvas.',
  stars = '0',
  forks = '0',
  language = 'JavaScript',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '64px 80px',
      background: '#0E1116',
      color: '#F4F4F0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div>
        <div style={{ fontSize: 24, opacity: 0.5, fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {owner}/
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, marginTop: 8 }}>
          {name}
        </div>
        <div style={{ fontSize: 28, marginTop: 24, opacity: 0.7, lineHeight: 1.4 }}>
          {tagline}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 80, alignItems: 'flex-end' }}>
        <Stat label="Stars" value={`★ ${stars}`} />
        <Stat label="Forks" value={`⑃ ${forks}`} />
        <Stat label="Language" value={language} />
      </div>
    </div>
  );
}
