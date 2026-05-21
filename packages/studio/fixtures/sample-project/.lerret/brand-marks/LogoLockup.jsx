// Fixture asset — a `.jsx` component that imports a CO-LOCATED local image by
// relative path. This exercises FR13: the runtime loads the asset through the
// Vite dev server, and Vite resolves `./mark-glyph.png` (a real PNG sitting
// next to this file) to a served URL — so the rendered component gets a
// working image source with zero extra wiring.

import markGlyph from './mark-glyph.png';

export default function LogoLockup() {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 gap: 16,
 background: '#faf8f2',
 fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif',
 }}
 >
 <img
 src={markGlyph}
 alt="mark"
 width={56}
 height={56}
 style={{ borderRadius: 12, display: 'block' }}
 />
 <span style={{ fontSize: 40, letterSpacing: '-0.015em', color: '#1A1714' }}>
 Lerret
 </span>
 </div>
 );
}
