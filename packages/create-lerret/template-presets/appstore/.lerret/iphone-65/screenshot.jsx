// App Store screenshot — iPhone 6.5" (1242 × 2688).
//
// Six variants share one composition and one palette (driven from project
// root `vars`). Same shape as the 6.7" page, scaled to the smaller canvas.

import React from 'react';

export const meta = {
  dimensions: { width: 1242, height: 2688 },
  label: 'iPhone 6.5" screenshot',
  tags: ['appstore', 'iphone', 'screenshot', '6.5'],
  variants: ['default', 'Features', 'Data', 'LiveRefresh', 'Exports', 'OpenSource'],
  propsSchema: {
    eyebrow: {
      type: 'string',
      default: '01 / canvas',
      description: 'Small label above the headline.',
    },
    headline: {
      type: 'string',
      default: 'Designs are just files.',
      description: 'Main marketing headline.',
      required: true,
    },
    subhead: {
      type: 'string',
      default: 'Open-source. Lives in your repo. Renders React.',
      description: 'Supporting line under the headline.',
    },
    mockText: {
      type: 'string',
      default: 'lerret.your-project',
      description: 'Text shown inside the device-frame mock.',
    },
  },
};

function Screenshot({ eyebrow, headline, subhead, mockText }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        background:
          'linear-gradient(160deg, var(--brandColor, #B85B33) 0%, color-mix(in oklab, var(--brandColor, #B85B33) 70%, var(--neutralDark, #1A1714)) 100%)',
        color: 'var(--neutralLight, #F8F4EC)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '170px 90px 90px',
        gap: 60,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 1700,
          height: 1700,
          borderRadius: '50%',
          top: -650,
          right: -650,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 25%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontSize: 34,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.85,
          position: 'relative',
        }}
      >
        {eyebrow}
      </div>

      <div
        style={{
          fontSize: 124,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          textAlign: 'center',
          maxWidth: 1040,
          position: 'relative',
        }}
      >
        {headline}
      </div>

      <div
        style={{
          fontSize: 44,
          lineHeight: 1.35,
          textAlign: 'center',
          maxWidth: 960,
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 80%, transparent)',
          position: 'relative',
        }}
      >
        {subhead}
      </div>

      <div
        style={{
          marginTop: 50,
          width: 840,
          height: 1440,
          borderRadius: 76,
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--neutralDark, #1A1714) 92%, transparent) 0%, color-mix(in oklab, var(--neutralDark, #1A1714) 78%, transparent) 100%)',
          border: '8px solid color-mix(in oklab, var(--accentColor, #F1EDE5) 35%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 30,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 22,
            width: 210,
            height: 34,
            borderRadius: 999,
            background: 'var(--neutralDark, #1A1714)',
          }}
        />
        <div
          style={{
            fontSize: 200,
            lineHeight: 1,
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.4,
          }}
        >
          ◆
        </div>
        <div
          style={{
            fontSize: 40,
            letterSpacing: '0.04em',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.8,
          }}
        >
          {mockText}
        </div>
        <div
          style={{
            fontSize: 24,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--accentColor, #F1EDE5) 55%, transparent)',
            marginTop: 14,
          }}
        >
          replace with your screenshot
        </div>
      </div>
    </div>
  );
}

export default function ScreenshotDefault(props) { return <Screenshot {...props} />; }
export function Features(props) { return <Screenshot {...props} />; }
export function Data(props) { return <Screenshot {...props} />; }
export function LiveRefresh(props) { return <Screenshot {...props} />; }
export function Exports(props) { return <Screenshot {...props} />; }
export function OpenSource(props) { return <Screenshot {...props} />; }
