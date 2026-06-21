// business-card.jsx — a print-ready business card, driven by props.
//
// `meta.propsSchema` makes the studio show a typed data editor and a
// validation badge when a required prop (here, `name`) is missing.

export const meta = {
  label: 'Business card',
  dimensions: { width: 1050, height: 600 },
  tags: ['brand', 'print'],
  propsSchema: {
    name: { type: 'string', required: true },
    title: { type: 'string', default: 'maker' },
    email: { type: 'string', default: 'hello@belikely.com' },
    location: { type: 'string', default: '' },
  },
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

function BusinessCard({ name, title, email, location }) {
  return (
    <div
      style={{
        width: 1050,
        height: 600,
        boxSizing: 'border-box',
        padding: 72,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#FAF8F2',
        color: '#1A1714',
        fontFamily: SANS,
        borderLeft: '14px solid #B85B33',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.2em', fontSize: 24, textTransform: 'uppercase' }}>
          ◆ Lerret
        </span>
        <span style={{ color: '#6E6960', fontSize: 18, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {location || 'everywhere'}
        </span>
      </div>

      <div>
        <div style={{ fontFamily: SERIF, fontSize: 66, fontWeight: 600, lineHeight: 1.04 }}>
          {name || '[ your name ]'}
        </div>
        <div style={{ fontSize: 28, color: '#3A3530', marginTop: 10 }}>{title}</div>
      </div>

      <div style={{ fontSize: 22, color: '#6E6960' }}>{email}</div>
    </div>
  );
}

// Two artboards from one file. The studio renders the `default` export plus
// every named component export as its own variant artboard. `default` reads the
// `"default"` slice of business-card.data.json (which omits the required `name`,
// so the validation badge fires); `Complete` reads the `"Complete"` slice
// (every prop present, no badge). Same component, different data.
export default BusinessCard;
export const Complete = BusinessCard;
