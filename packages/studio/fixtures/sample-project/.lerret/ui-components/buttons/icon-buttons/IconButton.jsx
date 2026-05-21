// Fixture asset — a `.jsx` component inside a DEEPLY NESTED group:
// `ui-components/buttons/icon-buttons/`. The folder chain is
// page (`ui-components`) → group (`buttons`) → nested group (`icon-buttons`),
// i.e. a group inside a group. This renders as a nested/contained
// section so the folder nesting depth is visually legible on the canvas (FR3).

export default function IconButton() {
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
 aria-label="Add"
 style={{
 width: 44,
 height: 44,
 borderRadius: 12,
 border: 'none',
 background: '#B85B33',
 color: '#fff',
 cursor: 'pointer',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 boxShadow: '0 4px 14px rgba(184,91,51,0.35)',
 }}
 >
 <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
 <path d="M9 3v12M3 9h12" />
 </svg>
 </button>
 </div>
 );
}
