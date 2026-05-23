// App Store screenshot — iPhone 6.7" (1290 × 2796).
//
// Six variants share one composition and one palette (driven from project
// root `vars`). Each variant has its own hero text and accent tag — change
// the text in `screenshot.data.json` to re-skin all six in one pass.
//
// The "placeholder image area" is the rounded device-frame mock at the
// bottom — replace with a real screenshot in JSX when you have one.

import React from 'react';

export const meta = {
  dimensions: { width: 1290, height: 2796 },
  label: 'iPhone 6.7" screenshot',
  tags: ['appstore', 'iphone', 'screenshot', '6.7'],
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
        padding: '180px 100px 100px',
        gap: 64,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Atmospheric ring. */}
      <div
        style={{
          position: 'absolute',
          width: 1800,
          height: 1800,
          borderRadius: '50%',
          top: -700,
          right: -700,
          background:
            'radial-gradient(circle, color-mix(in oklab, var(--accentColor, #F1EDE5) 25%, transparent) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}
      />

      {/* Eyebrow. */}
      <div
        style={{
          fontSize: 36,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, #F1EDE5)',
          opacity: 0.85,
          position: 'relative',
        }}
      >
        {eyebrow}
      </div>

      {/* Headline. */}
      <div
        style={{
          fontSize: 130,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: '-0.025em',
          textAlign: 'center',
          maxWidth: 1080,
          position: 'relative',
        }}
      >
        {headline}
      </div>

      {/* Subhead. */}
      <div
        style={{
          fontSize: 48,
          lineHeight: 1.35,
          textAlign: 'center',
          maxWidth: 1000,
          color: 'color-mix(in oklab, var(--neutralLight, #F8F4EC) 80%, transparent)',
          position: 'relative',
        }}
      >
        {subhead}
      </div>

      {/* Placeholder device mock — rounded panel acting as the image slot. */}
      <div
        style={{
          marginTop: 60,
          width: 880,
          height: 1500,
          borderRadius: 80,
          background:
            'linear-gradient(180deg, color-mix(in oklab, var(--neutralDark, #1A1714) 92%, transparent) 0%, color-mix(in oklab, var(--neutralDark, #1A1714) 78%, transparent) 100%)',
          border: '8px solid color-mix(in oklab, var(--accentColor, #F1EDE5) 35%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Faux notch. */}
        <div
          style={{
            position: 'absolute',
            top: 24,
            width: 220,
            height: 36,
            borderRadius: 999,
            background: 'var(--neutralDark, #1A1714)',
          }}
        />
        {/* Glyph + text inside the mock. */}
        <div
          style={{
            fontSize: 220,
            lineHeight: 1,
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.4,
          }}
        >
          ◆
        </div>
        <div
          style={{
            fontSize: 44,
            letterSpacing: '0.04em',
            color: 'var(--accentColor, #F1EDE5)',
            opacity: 0.8,
          }}
        >
          {mockText}
        </div>
        <div
          style={{
            fontSize: 26,
            letterSpacing: '0.32em',
            textTransform: 'uppercase',
            color: 'color-mix(in oklab, var(--accentColor, #F1EDE5) 55%, transparent)',
            marginTop: 16,
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
