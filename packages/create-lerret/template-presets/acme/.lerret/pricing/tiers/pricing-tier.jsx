// pricing-tier.jsx — one file, three artboards via named-export variants.
//
// The default export plus each component-valued named export becomes its own
// artboard. `meta` is shared across every variant of the file.

export const meta = {
  label: 'Pricing tier',
  dimensions: { width: 420, height: 560 },
  tags: ['marketing', 'pricing'],
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

function Tier({ tier, price, blurb, features, featured = false }) {
  return (
    <div
      style={{
        width: 420,
        height: 560,
        boxSizing: 'border-box',
        padding: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        fontFamily: SANS,
        background: featured ? '#1A1714' : '#FAF8F2',
        color: featured ? '#FAF8F2' : '#1A1714',
        border: featured ? '2px solid #B85B33' : '1px solid #DDD7CA',
        borderRadius: 18,
      }}
    >
      <div style={{ fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 16, color: '#B85B33' }}>
        {tier}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: 56, fontWeight: 600 }}>{price}</span>
        <span style={{ fontSize: 18, color: featured ? '#C9C3B8' : '#6E6960' }}>/mo</span>
      </div>
      <div style={{ fontSize: 16, color: featured ? '#C9C3B8' : '#6E6960', minHeight: 44 }}>{blurb}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 17 }}>
        {features.map((f) => (
          <li key={f} style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: '#B85B33' }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Free() {
  return <Tier tier="Free" price="$0" blurb="For solo experiments." features={['1 project', 'Local export', 'Community support']} />;
}

export function Pro() {
  return <Tier tier="Pro" price="$12" blurb="For working designers." featured features={['Unlimited projects', 'Animated export', 'Priority support']} />;
}

export function Team() {
  return <Tier tier="Team" price="$29" blurb="For shared design systems." features={['Everything in Pro', 'Shared brand kits', 'SSO & roles']} />;
}
