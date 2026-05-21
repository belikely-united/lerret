// Custom 404 page. Next.js needs this so it does not try to render the
// catch-all `[[...mdxPath]]` route for an unknown path.

export default function NotFound() {
  return (
    <div
      style={{
        padding: '4rem 1.5rem',
        textAlign: 'center',
        maxWidth: '32rem',
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>404</h1>
      <p style={{ marginBottom: '1.5rem', color: '#666' }}>
        That page could not be found.
      </p>
      <a
        href="/"
        style={{
          display: 'inline-block',
          padding: '0.5rem 1rem',
          borderRadius: '6px',
          background: '#000',
          color: '#fff',
          textDecoration: 'none',
        }}
      >
        ← Back to Lerret docs
      </a>
    </div>
  );
}
