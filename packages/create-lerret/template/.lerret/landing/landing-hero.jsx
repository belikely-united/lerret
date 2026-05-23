// landing-hero.jsx — landing-page hero (1200 × 630).
//
// Teaches the **cascading `vars`** mechanism (FR20). Every color you see here
// comes from `.lerret/config.json`'s `vars` block via CSS custom properties —
// `var(--brandColor)`, `var(--neutralDark)`, etc. The Lerret runtime injects
// those vars onto the artboard root automatically, so the component just
// reads them like any other CSS variable.
//
// Try it: edit `.lerret/config.json` and change `vars.brandColor` from
// `#B85B33` to (say) `#3D5A80`. Save. The artboard re-renders and the new
// color flows through every gradient and accent here.

export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'Landing hero',
  tags: ['landing', 'hero', 'og-image'],
};

export default function LandingHero() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--neutralDark, #1A1814)',
        color: 'var(--neutralLight, #F7F4F0)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Background atmosphere — a single large off-axis disc driven by vars.brandColor. */}
      <div
        style={{
          position: 'absolute',
          right: -180,
          bottom: -220,
          width: 760,
          height: 760,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #B85B33) 70%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Hairline grid — atmosphere, not decoration. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Cpath d='M0 0V60' stroke='%23F7F4F0' stroke-width='1' stroke-opacity='0.05'/%3E%3C/svg%3E\")",
          backgroundSize: '60px 60px',
          pointerEvents: 'none',
        }}
      />

      {/* Top row — brand mark + tag. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'relative',
          fontSize: 14,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 70%, transparent)',
        }}
      >
        <div>◆ lerret</div>
        <div>landing / hero</div>
      </div>

      {/* Headline stack. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          position: 'relative',
          maxWidth: 880,
        }}
      >
        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.36em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          one canvas, many surfaces
        </div>
        <div
          style={{
            fontSize: 76,
            lineHeight: 1.04,
            letterSpacing: '-0.022em',
            color: 'var(--neutralLight, #F7F4F0)',
            textIndent: '-0.04em',
          }}
        >
          Designs are just files.
        </div>
        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 22,
            lineHeight: 1.45,
            fontWeight: 400,
            color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 70%, transparent)',
            maxWidth: 720,
          }}
        >
          Open-source. Lives in your repo. Renders React. Edit
          <span style={{ color: 'var(--brandColor, #B85B33)' }}> .lerret/config.json </span>
          and watch every artboard on this page re-skin.
        </div>
      </div>

      {/* Bottom row — CTA + scale rule. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 14,
            padding: '12px 22px',
            border: '1px solid var(--brandColor, #B85B33)',
            borderRadius: 999,
            fontSize: 16,
            letterSpacing: '0.04em',
            color: 'var(--brandColor, #B85B33)',
            background:
              'color-mix(in oklab, var(--brandColor, #B85B33) 10%, transparent)',
          }}
        >
          npx create-lerret@latest
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: 12,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 50%, transparent)',
          }}
        >
          <span>1200 × 630</span>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>og-image</span>
        </div>
      </div>
    </div>
  );
}
