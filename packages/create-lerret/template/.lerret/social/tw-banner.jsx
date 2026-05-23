// tw-banner.jsx — X / Twitter header (1500 × 500).
//
// Teaches **named-export variants** (FR10): one file, multiple artboards.
// The studio renders one artboard per export. Variants share a single
// implementation (`TwBanner`) but render with different props pulled from
// `tw-banner.data.json`, which is keyed by the export name.
//
// `default`, `Maker`, and `Talk` are three separate artboards on the canvas.

import React from 'react';

export const meta = {
  dimensions: { width: 1500, height: 500 },
  label: 'X / Twitter banner',
  tags: ['social', 'banner', 'twitter', 'x'],
  variants: ['default', 'Maker', 'Talk'],
};

function TwBanner({ title, eyebrow, glyph }) {
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
        display: 'grid',
        gridTemplateColumns: '1fr 360px',
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Left — text block. */}
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
            fontSize: 14,
            letterSpacing: '0.36em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 58,
            lineHeight: 1.04,
            letterSpacing: '-0.02em',
            color: 'var(--neutralLight, #F7F4F0)',
            textIndent: '-0.04em',
            maxWidth: 820,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralLight, #F7F4F0) 55%, transparent)',
          }}
        >
          ◆ lerret &nbsp;//&nbsp; 1500 × 500
        </div>
      </div>

      {/* Right — accent panel with giant glyph. */}
      <div
        style={{
          position: 'relative',
          background:
            'color-mix(in oklab, var(--brandColor, #B85B33) 35%, var(--neutralDark, #1A1814))',
          borderLeft:
            '1px solid color-mix(in oklab, var(--neutralLight, #F7F4F0) 15%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M40 0H0V40' fill='none' stroke='%23F7F4F0' stroke-width='1' stroke-opacity='0.08'/%3E%3C/svg%3E\")",
            backgroundSize: '40px 40px',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            fontSize: 240,
            lineHeight: 1,
            color: 'var(--accentColor, #F4D5C3)',
            opacity: 0.95,
            transform: 'translateY(-0.04em)',
          }}
        >
          {glyph}
        </div>
      </div>
    </div>
  );
}

export default function TwBannerDefault(props) {
  return <TwBanner {...props} />;
}

// Two named variants — each becomes an extra artboard on the canvas, and
// each gets its own props slice from `tw-banner.data.json` keyed by export
// name.
export function Maker(props) {
  return <TwBanner {...props} />;
}

export function Talk(props) {
  return <TwBanner {...props} />;
}
