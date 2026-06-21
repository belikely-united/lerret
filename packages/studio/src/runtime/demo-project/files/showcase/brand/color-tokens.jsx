// color-tokens.jsx — the brand palette, straight from `config.json` → `vars`.
//
// Each swatch paints itself with a brand token (`var(--brandColor)` …). Change
// a value in `.lerret/config.json` and this sheet — and every other design —
// re-tints at once. This is just a readable view of the same tokens.

export const meta = {
  label: 'Brand tokens',
  dimensions: { width: 1050, height: 600 },
  tags: ['brand', 'tokens'],
};

const TOKENS = [
  { name: 'brandColor', value: 'var(--brandColor, #B85B33)', hex: '#B85B33', dark: true },
  { name: 'accentColor', value: 'var(--accentColor, #F1EDE5)', hex: '#F1EDE5', dark: false },
  { name: 'neutralDark', value: 'var(--neutralDark, #1A1714)', hex: '#1A1714', dark: true },
  { name: 'neutralLight', value: 'var(--neutralLight, #FAF8F2)', hex: '#FAF8F2', dark: false },
];

export default function BrandTokens() {
  return (
    <div
      style={{
        width: 1050,
        height: 600,
        boxSizing: 'border-box',
        padding: 64,
        background: 'var(--neutralLight, #FAF8F2)',
        color: 'var(--neutralDark, #1A1714)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: 32,
      }}
    >
      <div style={{ fontSize: 22, letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--brandColor, #B85B33)' }}>
        ◆ brand tokens
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22, flex: 1 }}>
        {TOKENS.map((t) => (
          <div key={t.name} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                flex: 1,
                borderRadius: 16,
                background: t.value,
                border: '1px solid color-mix(in oklab, var(--neutralDark, #1A1714) 12%, transparent)',
              }}
            />
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 16, color: '#6E6960', fontFamily: 'ui-monospace, "Cascadia Code", monospace', marginTop: 4 }}>
                {t.hex}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
