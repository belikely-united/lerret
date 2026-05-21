// Fixture asset — a second `.jsx` component in the deeply nested
// `ui-components/buttons/icon-buttons/` group, so the nested-of-nested section
// holds more than one artboard.

export default function CloseButton() {
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
 aria-label="Close"
 style={{
 width: 44,
 height: 44,
 borderRadius: 12,
 border: '1.5px solid rgba(248,250,252,0.4)',
 background: 'transparent',
 color: '#f8fafc',
 cursor: 'pointer',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 }}
 >
 <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
 <path d="M3 3l10 10M13 3L3 13" />
 </svg>
 </button>
 </div>
 );
}
