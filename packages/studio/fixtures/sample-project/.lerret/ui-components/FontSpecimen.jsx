// Fixture asset — proves custom-font auto-registration from `_fonts/` (FR12).
//
// This is *user content*: a plain `.jsx` component the user dropped into their
// `.lerret/` folder. Its heading uses `font-family: 'LerretFixtureMono'` — the
// family name of the font file at `.lerret/_fonts/LerretFixtureMono.woff2`.
//
// The user wrote NO `@font-face` rule and NO import. The font becomes available
// purely because Lerret discovered the file in the reserved `_fonts/` folder
// and auto-registered it by family name. `LerretFixtureMono` draws every glyph
// as a solid block, so the custom-font heading renders as a row of solid bars —
// unmistakably different from the system-font caption below it. If you see
// solid bars, the font registered and applied.

export const meta = {
 label: 'Font specimen',
 dimensions: { width: 460, height: 280 },
 tags: ['fonts', 'specimen'],
};

export default function FontSpecimen() {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: 32,
 display: 'flex',
 flexDirection: 'column',
 justifyContent: 'center',
 gap: 20,
 background: '#faf8f4',
 }}
 >
 {/* The custom font, referenced by family name only — no @font-face. */}
 <div
 data-testid="custom-font-heading"
 style={{
 fontFamily: "'LerretFixtureMono', monospace",
 fontSize: 44,
 lineHeight: 1.1,
 color: '#1a1714',
 }}
 >
 Lerret
 </div>

 {/* A system-font caption for contrast — this stays ordinary text. */}
 <div
 style={{
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 fontSize: 13,
 lineHeight: 1.5,
 color: '#6e6960',
 maxWidth: '34ch',
 }}
 >
 The heading above is set in <strong>LerretFixtureMono</strong>, a font
 dropped into <code>.lerret/_fonts/</code> — auto-registered by family
 name, with no <code>@font-face</code> written by hand.
 </div>
 </div>
 );
}
