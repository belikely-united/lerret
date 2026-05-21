// Fixture asset — a component declaring a FULL `meta` export (FR11):
// all four well-known keys spelled by their exact camelCase names.
//
// This is *user content*. The vite-runtime parses this `meta` through `core`'s
// `parseMeta` and the artboard then renders at the declared 640×280 dimensions
// with the `meta.label` ("Launch hero banner") as its label.
//
// The `propsSchema` describes typed fields (string +
// select + boolean) with `default`s, and the component reads its props so the
// Data editor can demonstrate per-field commits feeding back onto the canvas
// via the watcher → reload loop. A co-located `HeroBanner.data.json` carries
// the on-disk values.

// All four well-known keys: `dimensions`, `label`, `tags`, `propsSchema`.
export const meta = {
 dimensions: { width: 640, height: 280 },
 label: 'Launch hero banner',
 tags: ['hero', 'marketing', 'wide'],
 // Schema fields the Data editor renders as a form. Each entry
 // carries a `default` so the four-tier prop resolver can fall back to it
 // when the data file omits a key.
 propsSchema: {
 headline: {
 type: 'string',
 default: 'Ship your design system',
 description: 'Top-line headline displayed prominently.',
 required: true,
 },
 subhead: {
 type: 'string',
 default: 'A wide hero artboard sized entirely by its meta.dimensions.',
 description: 'Supporting line under the headline.',
 },
 tone: {
 type: 'select',
 default: 'warm',
 description: 'Color treatment for the gradient background.',
 options: ['warm', 'cool', 'mono'],
 },
 showBadge: {
 type: 'boolean',
 default: true,
 description: 'Show the "640 × 280 · FROM META" badge in the corner.',
 },
 },
};

const TONE_GRADIENTS = {
 warm: 'linear-gradient(115deg, #fb923c, #f43f5e)',
 cool: 'linear-gradient(115deg, #38bdf8, #6366f1)',
 mono: 'linear-gradient(115deg, #1f2937, #111827)',
};

export default function HeroBanner({
 headline = 'Ship your design system',
 subhead = 'A wide hero artboard sized entirely by its meta.dimensions.',
 tone = 'warm',
 showBadge = true,
}) {
 return (
 <div
 style={{
 width: '100%',
 height: '100%',
 boxSizing: 'border-box',
 padding: '40px 48px',
 display: 'flex',
 flexDirection: 'column',
 justifyContent: 'center',
 gap: 12,
 background: TONE_GRADIENTS[tone] || TONE_GRADIENTS.warm,
 color: '#fff',
 fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
 }}
 >
 {showBadge && (
 <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.16em', opacity: 0.85 }}>
 640 × 280 · FROM META
 </div>
 )}
 <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
 {headline}
 </div>
 <div style={{ fontSize: 15, opacity: 0.9 }}>{subhead}</div>
 </div>
 );
}
