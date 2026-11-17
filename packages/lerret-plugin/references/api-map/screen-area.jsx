// One area of an API map: each screen's screenshot on the left, the APIs it calls on the right.
// Copy to .lerret/_lib/screen-area.jsx. Area cards import it; their text comes from each card's .data.json.

const INK = '#0E0E0F';
const MUTED = '#6B6B70';
const LINE = '#E6E6E9';
const SHOT_W = 820;

const METHOD = {
  GET: ['#E6F4EA', '#16794A'],
  POST: ['#E8EFFD', '#1D5BD6'],
  PUT: ['#FFF3DF', '#9A5800'],
  PATCH: ['#FFF3DF', '#9A5800'],
  DELETE: ['#FDEBEC', '#C42B2B'],
};
const STATUS = { Live: ['#E6F4EA', '#16794A'], Static: ['#EFEFF1', '#55555B'], Stub: ['#FFF3DF', '#9A5800'] };

const shotUrl = (name) => new URL(`../_shots/${name}.jpeg`, import.meta.url).href;

const Chip = ({ bg, fg, children, mono }) => (
  <span style={{
    background: bg, color: fg, borderRadius: 7, padding: '2px 8px', fontWeight: 600, whiteSpace: 'nowrap',
    fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', fontSize: mono ? '0.86em' : '0.8em',
  }}>{children}</span>
);

// `code` → method chip + mono path; **bold** → bold. Nothing else.
function Inline({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**')) return <strong key={i} style={{ color: INK }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`')) {
      const code = p.slice(1, -1);
      const m = /^(GET|POST|PUT|PATCH|DELETE)\b\s*(.*)$/.exec(code);
      if (m) {
        const [bg, fg] = METHOD[m[1]];
        return (
          <span key={i} style={{ whiteSpace: 'nowrap' }}>
            <Chip bg={bg} fg={fg} mono>{m[1]}</Chip>
            {m[2] && <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em', marginLeft: 6, color: INK, whiteSpace: 'normal' }}>{m[2]}</code>}
          </span>
        );
      }
      return <code key={i} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9em', background: '#F0F0F2', borderRadius: 6, padding: '1px 6px' }}>{code}</code>;
    }
    return <span key={i}>{p}</span>;
  });
}

function Item({ text }) {
  const arrow = text.indexOf(' → ');
  const cell = { padding: '11px 0', borderTop: `1px solid ${LINE}` };
  if (arrow > 0) {
    return <>
      <div style={{ ...cell, paddingRight: 20, color: INK }}><Inline text={text.slice(0, arrow)} /></div>
      <div style={{ ...cell, color: MUTED }}><Inline text={text.slice(arrow + 3)} /></div>
    </>;
  }
  return <div style={{ ...cell, gridColumn: '1 / -1', color: MUTED }}><Inline text={text} /></div>;
}

function Groups({ groups }) {
  return groups.map((g, i) => (
    <div key={i} style={{ marginBottom: 22 }}>
      {g.title && <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>{g.title}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 38%) 1fr' }}>
        {g.items.map((t, k) => <Item key={k} text={t} />)}
      </div>
    </div>
  ));
}

function View({ view, first }) {
  return (
    <div style={{ marginTop: first ? 28 : 40 }}>
      {view.label && <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginBottom: 14 }}>↳ {view.label}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: view.shot ? `${SHOT_W}px 1fr` : '1fr', gap: 48, alignItems: 'start' }}>
        {view.shot && (
          <img src={shotUrl(view.shot)} alt={view.label || ''} style={{ width: SHOT_W, display: 'block', borderRadius: 14, border: `1px solid ${LINE}`, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }} />
        )}
        <div style={{ fontSize: 17, lineHeight: 1.5 }}><Groups groups={view.groups} /></div>
      </div>
    </div>
  );
}

function Screen({ s }) {
  const status = (/· (.+)$/.exec(s.where) || [])[1] || '';
  const where = s.where.replace(/\s*·\s*[^·]+$/, '');
  const [sbg, sfg] = STATUS[status.split(',')[0]] || STATUS.Static;
  return (
    <section style={{ background: '#F7F7F8', borderRadius: 28, padding: 44, marginTop: 40 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 38, fontWeight: 800, letterSpacing: '-0.02em', color: INK }}>{s.name}</h2>
        {where && <span style={{ fontSize: 18 }}><Inline text={where} /></span>}
        {status && <Chip bg={sbg} fg={sfg}>{status}</Chip>}
      </div>
      {s.about && <p style={{ margin: '10px 0 0', fontSize: 19, color: MUTED, maxWidth: 1100 }}>{s.about}</p>}
      {s.views.map((v, i) => <View key={i} view={v} first={i === 0} />)}
    </section>
  );
}

export function ScreenArea({ id, title, screens = [] }) {
  return (
    <div style={{ width: '100%', height: '100%', background: '#FFFFFF', color: INK, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', overflow: 'hidden' }}>
      <div data-area={id} style={{ padding: 64 }}>
        <h1 style={{ margin: 0, fontSize: 64, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h1>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, fontSize: 15, color: MUTED, alignItems: 'center' }}>
          <span>Each screen, then the APIs it calls.</span>
          {Object.entries(METHOD).map(([m, [bg, fg]]) => <Chip key={m} bg={bg} fg={fg} mono>{m}</Chip>)}
        </div>
        {screens.map((s, i) => <Screen key={i} s={s} />)}
      </div>
    </div>
  );
}
