// Sample asset — landing-page hero (1600 × 900).
//
// The "your-project-launches-here" surface. Demonstrates Tier-1 prop
// resolution: the headline / subhead / cta values below come from
// `landing-hero.data.json` sitting next to this file. Delete that file (or
// edit it) to see the propsSchema defaults take over.
//
// Aesthetic notes — committed to a single direction (refined / editorial):
//   • Display type is the bundled `LerretFixtureMono` (not the system stack).
//     The system stack is reserved for the subhead at ~28px. This matches the
//     anti-slop checklist.
//   • Dominant ground = deep `--neutralDark` from the project's config.json
//     vars. Single sharp accent = `--accentColor` cyan on the CTA chip.
//   • Atmosphere comes from one large off-axis radial gradient + a hairline
//     vertical grid at 4% opacity — atmosphere, not decoration.

export const meta = {
  dimensions: { width: 1600, height: 900 },
  label: 'Landing hero',
  tags: ['landing', 'hero', 'marketing'],
  propsSchema: {
    headline: {
      type: 'string',
      default: 'A canvas for the things you ship.',
      description: 'Hero headline.',
      required: true,
    },
    subhead: {
      type: 'string',
      default: 'Open-source. Lives in your repo. Renders React.',
      description: 'Supporting line under the headline.',
    },
    cta: {
      type: 'string',
      default: 'npx create-lerret@latest',
      description: 'CTA chip text — typically a CLI invocation or button label.',
    },
    eyebrow: {
      type: 'string',
      default: 'design canvas',
      description: 'Small label above the headline.',
    },
  },
};

export default function LandingHero({
  headline = 'A canvas for the things you ship.',
  subhead = 'Open-source. Lives in your repo. Renders React.',
  cta = 'npx create-lerret@latest',
  eyebrow = 'design canvas',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1B2A3B)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 140px',
        position: 'relative',
        overflow: 'hidden',
        color: 'var(--neutralLight, #F4F7FA)',
      }}
    >
      {/* Atmospheric gradient — single large off-axis disc. */}
      <div
        style={{
          position: 'absolute',
          right: -160,
          bottom: -200,
          width: 900,
          height: 900,
          borderRadius: '50%',
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--brandColor, #3D5A80) 55%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Hairline vertical grid — atmosphere, not decoration. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Cpath d='M0 0V80' stroke='%23F4F7FA' stroke-width='1' stroke-opacity='0.06'/%3E%3C/svg%3E\")",
          backgroundSize: '80px 80px',
          pointerEvents: 'none',
        }}
      />

      {/* Brand mark, top-left. */}
      <div
        style={{
          position: 'absolute',
          top: 56,
          left: 140,
          fontFamily: "'LerretFixtureMono', monospace",
          fontSize: 22,
          letterSpacing: '0.32em',
          color: 'var(--neutralLight, #F4F7FA)',
          opacity: 0.75,
        }}
      >
        ◆ lerret
      </div>

      {/* Content stack. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36, maxWidth: 1020, position: 'relative' }}>
        <div
          style={{
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 18,
            letterSpacing: '0.36em',
            color: 'var(--accentColor, #E0FBFC)',
            textTransform: 'uppercase',
          }}
        >
          {eyebrow}
        </div>

        <div
          style={{
            // Display type — custom font, deliberately not the system stack.
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 88,
            fontWeight: 400,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: 'var(--neutralLight, #F4F7FA)',
            // Slight optical hang for the opening character.
            textIndent: '-0.04em',
          }}
        >
          {headline}
        </div>

        <div
          style={{
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.45,
            color: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 70%, transparent)',
            maxWidth: 800,
          }}
        >
          {subhead}
        </div>

        {/* CTA chip — single sharp accent. */}
        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              fontFamily: "'LerretFixtureMono', monospace",
              fontSize: 22,
              padding: '14px 26px',
              border: '1px solid var(--accentColor, #E0FBFC)',
              borderRadius: 999,
              color: 'var(--accentColor, #E0FBFC)',
              letterSpacing: '0.04em',
              background:
                'color-mix(in oklab, var(--accentColor, #E0FBFC) 6%, transparent)',
            }}
          >
            {cta}
          </div>
          <div
            style={{
              fontFamily: "'LerretFixtureMono', monospace",
              fontSize: 14,
              letterSpacing: '0.28em',
              color: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 50%, transparent)',
              textTransform: 'uppercase',
            }}
          >
            zero-install
          </div>
        </div>
      </div>
    </div>
  );
}
