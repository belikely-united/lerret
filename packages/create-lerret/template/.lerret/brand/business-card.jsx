// business-card.jsx — a business card (1050 × 600, US 3.5" × 2" at 300 DPI).
//
// Teaches the **`propsSchema` validation badge** (FR32). The `name` prop
// below is `required: true` and ships with NO schema default. When the
// resolved props don't include a `name`, the studio shows a ⚠️ badge on
// the artboard — click it to see exactly which prop is missing.
//
// Two artboards on this page intentionally pair up:
//   • `default` reads `business-card.data.json` — INCOMPLETE on purpose,
//     omits `name`. Badge fires.
//   • `Complete` reads `business-card.Complete.data.json` (via the JSON-keyed
//     data file convention) — provides every prop. No badge.

import React from 'react';

export const meta = {
  dimensions: { width: 1050, height: 600 },
  label: 'Business card',
  tags: ['brand', 'card', 'print', 'identity'],
  variants: ['default', 'Complete'],
  propsSchema: {
    name: {
      // No `default:` here on purpose — combined with `required: true` this
      // means an absent `name` cannot be back-filled by tier 3 of the prop
      // chain, and the validation badge will fire.
      type: 'string',
      required: true,
      description: 'The card-holder\'s full name (REQUIRED — no default).',
    },
    title: {
      type: 'string',
      default: 'maker',
      description: 'Job title or role.',
    },
    email: {
      type: 'string',
      default: 'hello@example.com',
      description: 'Contact email.',
    },
    location: {
      type: 'string',
      default: '— / —',
      description: 'Optional location line.',
    },
  },
};

function BusinessCard({ name, title, email, location }) {
  // Defensive render: if `name` is missing (validation badge will be firing),
  // show the placeholder slot so the canvas doesn't render a blank-looking
  // card. The badge tells the user what to fix; the slot shows them where.
  const displayName = name && name.length > 0 ? name : '[ no name yet ]';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        background: 'var(--neutralLight, #F7F4F0)',
        color: 'var(--neutralDark, #1A1814)',
        padding: '64px 72px',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 40,
        fontFamily: "'LerretFixtureMono', monospace",
      }}
    >
      {/* Vertical brand bar — left edge. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 16,
          height: '100%',
          background: 'var(--brandColor, #B85B33)',
        }}
      />

      {/* Left — identity block. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          paddingLeft: 24,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              letterSpacing: '0.36em',
              textTransform: 'uppercase',
              color: 'var(--brandColor, #B85B33)',
              marginBottom: 18,
            }}
          >
            ◆ lerret
          </div>
          <div
            style={{
              fontSize: 56,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              color:
                name && name.length > 0
                  ? 'var(--neutralDark, #1A1814)'
                  : 'color-mix(in oklab, var(--neutralDark, #1A1814) 35%, transparent)',
            }}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 22,
              marginTop: 14,
              color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 55%, transparent)',
              letterSpacing: '0.04em',
            }}
          >
            {title}
          </div>
        </div>
        <div
          style={{
            fontSize: 16,
            color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 55%, transparent)',
            letterSpacing: '0.04em',
          }}
        >
          {email}
        </div>
      </div>

      {/* Right — location + edge meta. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          textAlign: 'right',
        }}
      >
        <div
          style={{
            fontSize: 14,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 45%, transparent)',
          }}
        >
          {location}
        </div>
        <div
          style={{
            fontSize: 12,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--neutralDark, #1A1814) 35%, transparent)',
          }}
        >
          1050 × 600
        </div>
      </div>
    </div>
  );
}

export default function BusinessCardDefault(props) {
  return <BusinessCard {...props} />;
}

export function Complete(props) {
  return <BusinessCard {...props} />;
}
