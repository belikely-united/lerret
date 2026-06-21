// logo.jsx — the Lerret logo lockup: the real mark + the wordmark.
//
// The mark lives once in `_assets/lerret-mark.svg` and is shared by every design
// that shows the brand (the Welcome hero, here, …). Swap that single file and
// the whole project re-brands.

export const meta = {
  label: 'Logo lockup',
  dimensions: { width: 1050, height: 600 },
  tags: ['brand', 'logo'],
};

export default function Logo() {
  return (
    <div
      style={{
        width: 1050,
        height: 600,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 44,
        background: 'var(--neutralLight, #FAF8F2)',
      }}
    >
      <img
        src="../../_assets/lerret-mark.svg"
        width={132}
        height={132}
        alt="Lerret mark"
        style={{ display: 'block' }}
      />
      <span
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 108,
          letterSpacing: '-0.02em',
          color: 'var(--neutralDark, #1A1714)',
        }}
      >
        Lerret
      </span>
    </div>
  );
}
