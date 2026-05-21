export const meta = {
  dimensions: { width: 1600, height: 800 },
  label: 'Doc hero',
  tags: ['hero', 'marketing'],
  propsSchema: {
    eyebrow: { type: 'string', default: 'Documentation' },
    headline: { type: 'string', default: 'Make the docs you wish you had.', required: true },
    cta: { type: 'string', default: 'Read the guide' },
  },
};

export default function DocHero({
  eyebrow = 'Documentation',
  headline = 'Make the docs you wish you had.',
  cta = 'Read the guide',
}) {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '96px',
      background: 'var(--heroBg, #F2EEE6)',
      color: 'var(--heroFg, #1A1714)',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
    }}>
      <div style={{
        fontFamily: "'MyBrand', 'system-ui', sans-serif",
        fontSize: 28,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        opacity: 0.7,
      }}>
        {eyebrow}
      </div>
      <div style={{
        fontSize: 112,
        fontWeight: 800,
        lineHeight: 1,
        letterSpacing: '-0.04em',
        textWrap: 'balance',
        maxWidth: '90%',
      }}>
        {headline}
      </div>
      <div style={{
        display: 'inline-flex',
        alignSelf: 'flex-start',
        alignItems: 'center',
        gap: 16,
        background: 'var(--ctaBg, #1A1714)',
        color: 'var(--ctaFg, #F2EEE6)',
        padding: '20px 36px',
        borderRadius: 12,
        fontSize: 22,
        fontWeight: 600,
      }}>
        {cta}
        <span aria-hidden="true">→</span>
      </div>
    </div>
  );
}
