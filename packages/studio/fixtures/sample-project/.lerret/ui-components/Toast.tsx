// Fixture asset — a `.tsx` component using TypeScript syntax.
//
// This file deliberately uses TS-only constructs (a typed props interface, a
// type annotation, an `as const`) to prove the runtime renders it WITHOUT the
// user adding any TypeScript configuration to their `.lerret/` folder: Vite's
// dev server transforms `.tsx` natively (esbuild strips the types) before the
// vite-runtime imports the module.

interface ToastProps {
 tone?: 'success' | 'info';
}

const TONES = {
 success: { bg: '#064e3b', accent: '#34d399', label: 'Saved' },
 info: { bg: '#1e3a5f', accent: '#60a5fa', label: 'Heads up' },
} as const;

export default function Toast({ tone = 'success' }: ToastProps) {
 const t: { bg: string; accent: string; label: string } = TONES[tone];
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 background: '#0f172a',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 <div
 style={{
 display: 'flex',
 alignItems: 'center',
 gap: 12,
 padding: '14px 18px',
 borderRadius: 12,
 background: t.bg,
 border: `1px solid ${t.accent}`,
 color: '#f8fafc',
 }}
 >
 <span
 style={{
 width: 10,
 height: 10,
 borderRadius: 999,
 background: t.accent,
 flexShrink: 0,
 }}
 />
 <span style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</span>
 <span style={{ fontSize: 13, color: '#cbd5e1' }}>
 Your changes are live.
 </span>
 </div>
 </div>
 );
}
