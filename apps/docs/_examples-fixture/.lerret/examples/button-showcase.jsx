function DemoButton({ label = 'Click me', variant = 'primary', size = 'md' }) {
  const styles = {
    primary:   { bg: '#B85B33', fg: '#FFFFFF' },
    secondary: { bg: 'transparent', fg: '#1A1714', border: '1px solid #1A1714' },
    ghost:     { bg: 'transparent', fg: '#1A1714' },
  };
  const sizes = {
    sm: { padding: '8px 16px',  fontSize: 14 },
    md: { padding: '12px 24px', fontSize: 16 },
    lg: { padding: '16px 32px', fontSize: 18 },
  };
  const v = styles[variant];
  const s = sizes[size];
  return (
    <button style={{
      background: v.bg,
      color: v.fg,
      border: v.border || 'none',
      borderRadius: 8,
      fontWeight: 600,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      cursor: 'pointer',
      ...s,
    }}>
      {label}
    </button>
  );
}

export const meta = {
  dimensions: { width: 1600, height: 900 },
  label: 'Button — all states',
  tags: ['showcase', 'components', 'button'],
};

export default function ButtonShowcase() {
  return (
    <div style={{
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: 80,
      background: '#F2EEE6',
      color: '#1A1714',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'auto repeat(3, 1fr)',
      rowGap: 32,
      columnGap: 48,
      alignItems: 'center',
    }}>
      <div style={{ fontSize: 18, opacity: 0.6 }}>SMALL</div>
      <div style={{ fontSize: 18, opacity: 0.6 }}>MEDIUM</div>
      <div style={{ fontSize: 18, opacity: 0.6 }}>LARGE</div>
      {['primary', 'secondary', 'ghost'].map((variant) =>
        ['sm', 'md', 'lg'].map((size) => (
          <DemoButton key={`${variant}-${size}`} label={variant} variant={variant} size={size} />
        ))
      ).flat()}
    </div>
  );
}
