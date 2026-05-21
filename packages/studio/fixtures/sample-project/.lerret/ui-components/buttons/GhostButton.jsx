// Fixture asset — a second `.jsx` component in the `buttons/` group, so the
// group section has more than one artboard.

export default function GhostButton() {
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
 Learn more
 </button>
 </div>
 );
}
