// Fixture asset — a `.jsx` component inside a nested GROUP folder
// (`ui-components/buttons/`). Proves a group asset renders inside its group's
// section, not just a top-level page asset.
//
// Data-driven: the button label is a meta.propsSchema field read as a prop
// (current text as the default); the real value lives in PrimaryButton.data.json.

export const meta = {
 propsSchema: {
  label: {
   type: 'string',
   default: 'Get started',
   description: 'Text shown inside the primary button.',
  },
 },
};

export default function PrimaryButton({ label = 'Get started' }) {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: '#f8fafc',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 <button
 type="button"
 style={{
 padding: '12px 24px',
 borderRadius: 10,
 border: 'none',
 background: '#B85B33',
 color: '#fff',
 fontSize: 14,
 fontWeight: 600,
 cursor: 'pointer',
 boxShadow: '0 4px 14px rgba(184,91,51,0.35)',
 }}
 >
 {label}
 </button>
 </div>
 );
}
