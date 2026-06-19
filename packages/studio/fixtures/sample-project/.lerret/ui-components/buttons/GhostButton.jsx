// Fixture asset — a second `.jsx` component in the `buttons/` group, so the
// group section has more than one artboard.
//
// Data-driven: the button label is a meta.propsSchema field read as a prop
// (current text as the default); the real value lives in GhostButton.data.json.

export const meta = {
 propsSchema: {
  label: {
   type: 'string',
   default: 'Learn more',
   description: 'Text shown inside the ghost button.',
  },
 },
};

export default function GhostButton({ label = 'Learn more' }) {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: '#1f2937',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 <button
 type="button"
 style={{
 padding: '12px 24px',
 borderRadius: 10,
 border: '1.5px solid rgba(248,250,252,0.4)',
 background: 'transparent',
 color: '#f8fafc',
 fontSize: 14,
 fontWeight: 600,
 cursor: 'pointer',
 }}
 >
 {label}
 </button>
 </div>
 );
}
