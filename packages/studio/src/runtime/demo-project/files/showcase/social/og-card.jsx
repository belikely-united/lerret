// og-card.jsx — a 1200×630 Open Graph / social share card.
//
// Prop-driven copy + a `.data.json` sidecar: the `default` artboard uses the
// schema defaults, the `Launch` artboard reads the `"Launch"` data slice. One
// file, two finished cards.

export const meta = {
  label: 'OG card',
  dimensions: { width: 1200, height: 630 },
  tags: ['social', 'og'],
  propsSchema: {
    headline: { type: 'string', default: 'Ship design straight from code' },
    tag: { type: 'string', default: 'lerret.belikely.com' },
  },
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

function OgCard({ headline, tag }) {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        boxSizing: 'border-box',
        padding: 88,
        background: 'linear-gradient(135deg, #1A1714 0%, #3A2A20 100%)',
        color: '#FAF8F2',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        fontFamily: SANS,
      }}
    >
      <span style={{ letterSpacing: '0.24em', textTransform: 'uppercase', fontSize: 22, color: '#E0B080' }}>
        ◆ Lerret
      </span>
      <h1
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 78,
          fontWeight: 600,
          lineHeight: 1.04,
          margin: 0,
          maxWidth: 920,
        }}
      >
        {headline}
      </h1>
      <span style={{ fontSize: 28, color: '#C9C3B8' }}>{tag}</span>
    </div>
  );
}

export default OgCard;
export const Launch = OgCard;
