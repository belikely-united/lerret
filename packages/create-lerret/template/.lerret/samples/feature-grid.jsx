// Sample asset — feature grid card (1200 × 630, OG-image dimensions).
//
// Demonstrates **variants**: this file exports three additional named
// components (`Fast`, `Open`, `Yours`) on top of the default. Each variant
// renders as its own artboard on the canvas, and each gets its own data
// slice from `feature-grid.data.json` (keyed by variant name).
//
// All variants share the same underlying `FeatureCard` — only the data
// changes. That's the recommended shape when you want N siblings that look
// alike but read differently.

import React from 'react';

export const meta = {
  dimensions: { width: 1200, height: 630 },
  label: 'Feature grid card',
  tags: ['og-image', 'feature', 'blog', 'social'],
  variants: ['default', 'Fast', 'Open', 'Yours'],
  propsSchema: {
    title: {
      type: 'string',
      default: 'A feature highlight',
      description: 'Feature title (large headline).',
      required: true,
    },
    description: {
      type: 'string',
      default: 'One sentence about the feature.',
      description: 'Short supporting copy beneath the title.',
    },
    glyph: {
      type: 'string',
      default: '◆',
      description: 'A single character — used as a giant decorative glyph.',
    },
    kicker: {
      type: 'string',
      default: 'feature',
      description: 'Tiny eyebrow label above the title.',
    },
  },
};

function FeatureCard({ title, description, glyph, kicker }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralDark, #1B2A3B)',
        position: 'relative',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '1fr 420px',
        color: 'var(--neutralLight, #F4F7FA)',
      }}
    >
      {/* Left pane — text. */}
      <div
        style={{
          padding: '64px 64px 64px 80px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
        }}
      >
        <div
          style={{
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 16,
            letterSpacing: '0.36em',
            color: 'var(--accentColor, #E0FBFC)',
            textTransform: 'uppercase',
          }}
        >
          /// {kicker}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div
            style={{
              fontFamily: "'LerretFixtureMono', monospace",
              fontSize: 68,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
              color: 'var(--neutralLight, #F4F7FA)',
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
              fontSize: 22,
              lineHeight: 1.45,
              color: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 65%, transparent)',
              maxWidth: 540,
            }}
          >
            {description}
          </div>
        </div>

        {/* Footer — brand mark. */}
        <div
          style={{
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 18,
            letterSpacing: '0.28em',
            color: 'color-mix(in oklab, var(--neutralLight, #F4F7FA) 55%, transparent)',
          }}
        >
          ◆ lerret
        </div>
      </div>

      {/* Right pane — giant glyph. */}
      <div
        style={{
          position: 'relative',
          background:
            'color-mix(in oklab, var(--brandColor, #3D5A80) 30%, var(--neutralDark, #1B2A3B))',
          borderLeft: '1px solid color-mix(in oklab, var(--accentColor, #E0FBFC) 20%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Faint grid overlay on the glyph pane. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M40 0H0V40' fill='none' stroke='%23E0FBFC' stroke-width='1' stroke-opacity='0.08'/%3E%3C/svg%3E\")",
            backgroundSize: '40px 40px',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            fontFamily: "'LerretFixtureMono', monospace",
            fontSize: 320,
            lineHeight: 1,
            color: 'var(--accentColor, #E0FBFC)',
            opacity: 0.92,
            transform: 'translateY(-0.04em)',
          }}
        >
          {glyph}
        </div>
      </div>
    </div>
  );
}

// `default` export is one of the variant artboards (`meta.variants` lists it
// first). The studio renders a default-only asset as one artboard; with
// variants listed it renders one per variant.
export default function FeatureGridDefault(props) {
  return <FeatureCard {...props} />;
}

// Three named variants — each gets its own data slice from
// `feature-grid.data.json` keyed by the export name.
export function Fast(props) { return <FeatureCard {...props} />; }
export function Open(props) { return <FeatureCard {...props} />; }
export function Yours(props) { return <FeatureCard {...props} />; }
