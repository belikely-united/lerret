// tweet-card.jsx — a square quote/announcement card for social feeds.

export const meta = {
  label: 'Tweet card',
  dimensions: { width: 700, height: 700 },
  tags: ['social'],
  propsSchema: {
    quote: { type: 'string', default: 'A folder of React files is a design system.' },
    author: { type: 'string', default: '@acme' },
  },
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

export default function TweetCard({ quote, author }) {
  return (
    <div
      style={{
        width: 700,
        height: 700,
        boxSizing: 'border-box',
        padding: 64,
        background: '#FAF8F2',
        color: '#1A1714',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 32,
        fontFamily: SANS,
        border: '1px solid #DDD7CA',
      }}
    >
      <span style={{ fontSize: 64, color: '#B85B33', lineHeight: 0.5 }}>&ldquo;</span>
      <p style={{ fontFamily: 'Georgia, serif', fontSize: 40, lineHeight: 1.25, margin: 0 }}>{quote}</p>
      <span style={{ fontSize: 22, color: '#6E6960' }}>{author}</span>
    </div>
  );
}
