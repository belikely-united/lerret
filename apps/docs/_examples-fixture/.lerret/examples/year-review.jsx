export const meta = {
  dimensions: { width: 1200, height: 1500 },
  label: 'Year in review — annual report',
  tags: ['poster', 'recap', 'annual-report'],
  propsSchema: {
    year: { type: 'string', default: '26', required: true },
    company: { type: 'string', default: 'Belikely United' },
    headline: { type: 'string', default: 'A year of building, in plain sight.' },
    stat1: { type: 'string', default: '127K' },
    stat1Label: { type: 'string', default: 'Users onboarded' },
    stat2: { type: 'string', default: '$2.4M' },
    stat2Label: { type: 'string', default: 'ARR' },
    stat3: { type: 'string', default: '12' },
    stat3Label: { type: 'string', default: 'Releases shipped' },
    stat4: { type: 'string', default: '847' },
    stat4Label: { type: 'string', default: 'Stars on GitHub' },
  },
};

export default function YearReviewPoster({
  year = '26',
  company = 'Belikely United',
  headline = 'A year of building, in plain sight.',
  stat1 = '127K',
  stat1Label = 'Users onboarded',
  stat2 = '$2.4M',
  stat2Label = 'ARR',
  stat3 = '12',
  stat3Label = 'Releases shipped',
  stat4 = '847',
  stat4Label = 'Stars on GitHub',
}) {
  const stats = [
    [stat1, stat1Label],
    [stat2, stat2Label],
    [stat3, stat3Label],
    [stat4, stat4Label],
  ];
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      background: '#EAE0CD',
      color: '#1F0F08',
      fontFamily: 'Georgia, "Times New Roman", serif',
      position: 'relative',
      overflow: 'hidden',
      padding: '64px 72px',
    }}>
      {/* Top masthead */}
      <div style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderBottom: '2px solid #1F0F08',
        paddingBottom: 16,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 13,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          fontWeight: 800,
        }}>
          {company} · Annual Report
        </div>
        <div style={{
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: 13,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
        }}>
          Vol. III
        </div>
      </div>

      {/* Giant year */}
      <div style={{
        position: 'absolute',
        left: 56,
        right: 56,
        top: 140,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 56,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 520,
          fontWeight: 900,
          lineHeight: 0.8,
          letterSpacing: '-0.08em',
          color: '#8C2A1B',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {year}
        </div>
        <div style={{ paddingTop: 80 }}>
          <div style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: 12,
            letterSpacing: '0.45em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#8C2A1B',
            marginBottom: 14,
          }}>
            The year in
          </div>
          <div style={{
            fontSize: 56,
            fontWeight: 400,
            fontStyle: 'italic',
            letterSpacing: '-0.025em',
            lineHeight: 1,
          }}>
            review.
          </div>
        </div>
      </div>

      {/* Headline / sub */}
      <div style={{
        position: 'absolute',
        left: 56,
        right: 56,
        top: 670,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 38,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          lineHeight: 1.15,
          maxWidth: '78%',
        }}>
          {headline}
        </div>
      </div>

      {/* Stats ledger */}
      <div style={{
        position: 'absolute',
        left: 56,
        right: 56,
        bottom: 80,
      }}>
        <div style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: 12,
          letterSpacing: '0.45em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: '#8C2A1B',
          marginBottom: 24,
        }}>
          By the numbers
        </div>
        {stats.map(([v, l], i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            borderTop: '1.5px solid #1F0F08',
            padding: '20px 0',
            gap: 32,
          }}>
            <div style={{
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 14,
              letterSpacing: '0.2em',
              color: '#8C2A1B',
              fontWeight: 700,
              minWidth: 64,
            }}>
              0{i + 1} /
            </div>
            <div style={{
              fontSize: 19,
              fontStyle: 'italic',
              letterSpacing: '-0.005em',
              flex: 1,
            }}>
              {l}
            </div>
            <div style={{
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontSize: 56,
              fontWeight: 900,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 200,
              textAlign: 'right',
            }}>
              {v}
            </div>
          </div>
        ))}
        <div style={{
          borderTop: '1.5px solid #1F0F08',
        }} />
      </div>
    </div>
  );
}
