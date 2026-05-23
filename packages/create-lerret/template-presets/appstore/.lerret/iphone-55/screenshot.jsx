// App Store screenshot — iPhone 5.5" (1242 × 2208).
//
// Six variants share one composition and one palette (driven from project
// root `vars`). Same shape as the 6.7" / 6.5" pages, tuned for the shorter
// 5.5" canvas — image-mock is shorter so all type still fits.

import React from 'react';

export const meta = {
  dimensions: { width: 1242, height: 2208 },
  label: 'iPhone 5.5" screenshot',
  tags: ['appstore', 'iphone', 'screenshot', '5.5'],
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
        padding: '140px 90px 80px',
        gap: 44,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 1500,
          height: 1500,
          borderRadius: '50%',
          top: -550,
          right: -550,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 25%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          fontSize: 30,
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
          fontSize: 108,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          textAlign: 'center',
          maxWidth: 1020,
          position: 'relative',
        }}
      >
        {headline}
      </div>

      <div
        style={{
          fontSize: 38,
          lineHeight: 1.35,
          textAlign: 'center',
          maxWidth: 920,
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 80%, transparent)',
          position: 'relative',
        }}
      >
        {subhead}
      </div>

      <div
        style={{
          marginTop: 28,
          width: 800,
          height: 1080,
          borderRadius: 60,
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--neutralDark, #1A1714) 92%, transparent) 0%, color-mix(in oklab, var(--neutralDark, #1A1714) 78%, transparent) 100%)',
          border: '8px solid color-mix(in oklab, var(--accentColor, #F1EDE5) 35%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 18,
            width: 180,
            height: 30,
            borderRadius: 999,
            background: 'var(--neutralDark, #1A1714)',
          }}
        />
        <div
          style={{
            fontSize: 170,
            lineHeight: 1,
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.4,
          }}
        >
          ◆
        </div>
        <div
          style={{
            fontSize: 36,
            letterSpacing: '0.04em',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.8,
          }}
        >
          {mockText}
        </div>
        <div
          style={{
            fontSize: 22,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--accentColor, #F1EDE5) 55%, transparent)',
            marginTop: 12,
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
