// Section divider slides (1920 × 1080, 16:9).
//
// Three variants — `default`, `PartTwo`, `PartThree` — so a talk can have
// multiple section breaks. Each shows a big numeral + section title.
//
// Edit `section-divider.data.json` to change the section names without
// touching JSX.

import React from 'react';

export const meta = {
  dimensions: { width: 1920, height: 1080 },
  label: 'Section divider',
  tags: ['talks', 'slide', 'divider', '16:9'],
  variants: ['default', 'PartTwo', 'PartThree'],
  propsSchema: {
    number: {
      type: 'string',
      default: '01',
      description: 'Section number (any short string).',
    },
    title: {
      type: 'string',
      default: 'The Problem',
      description: 'Section title.',
      required: true,
    },
    blurb: {
      type: 'string',
      default: 'Why the existing tools fall short for people who ship code.',
      description: 'One-line section summary.',
    },
  },
};

function SectionDivider({ number, title, blurb }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background: 'var(--neutralLight, #F8F4EC)',
        color: 'var(--neutralDark, #1A1714)',
        padding: '120px 140px',
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        alignItems: 'center',
        gap: 96,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* Hairline frame. */}
      <div
        style={{
          position: 'absolute',
          inset: 60,
          border: '1px solid color-mix(in oklab, var(--neutralDark, #1A1714) 12%, transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Left — giant numeral. */}
      <div
        style={{
          fontSize: 480,
          fontWeight: 700,
          lineHeight: 0.85,
          letterSpacing: '-0.04em',
          color: 'var(--brandColor, #B85B33)',
          position: 'relative',
        }}
      >
        {number}
      </div>

      {/* Right — title + blurb. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, position: 'relative' }}>
        <div
          style={{
            fontSize: 26,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'var(--brandColor, #B85B33)',
          }}
        >
          ◆ section
        </div>
        <div
          style={{
            fontSize: 120,
            fontWeight: 700,
            lineHeight: 1.04,
            letterSpacing: '-0.025em',
            maxWidth: 1100,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 32,
            lineHeight: 1.4,
            color: 'color-mix(in oklab, var(--neutralDark, #1A1714) 65%, transparent)',
            maxWidth: 1100,
          }}
        >
          {blurb}
        </div>
      </div>
    </div>
  );
}

export default function SectionDividerDefault(props) { return <SectionDivider {...props} />; }
export function PartTwo(props) { return <SectionDivider {...props} />; }
export function PartThree(props) { return <SectionDivider {...props} />; }
