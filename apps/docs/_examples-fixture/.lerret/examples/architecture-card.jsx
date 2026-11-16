// ArchitectureCard — made from the "Diagram card" template.
// A plain React component: it imports the `mermaid` npm package directly, so it
// works in any React app. Edit the title and the chart in the data file.
import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';

export const meta = {
  dimensions: { width: 1200, height: 630 },
  propsSchema: {
    title: { type: 'string', default: 'How it works' },
    chart: { type: 'string', default: "flowchart LR\n  idea[Idea] --> build[Build]\n  build --> launch[Launch]\n  launch --> feedback{Feedback}\n  feedback -->|iterate| build", description: 'Mermaid text.' },
  },
};

// A CSS variable from the page (Lerret injects brand colours), or a fallback.
function cssVar(el, name, fallback) {
  const v = el && name ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  return v || fallback;
}

export default function ArchitectureCard({ title = 'How it works', chart = "flowchart LR\n  idea[Idea] --> build[Build]\n  build --> launch[Launch]\n  launch --> feedback{Feedback}\n  feedback -->|iterate| build" }) {
  const renderId = `mmd${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const box = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    const bg = cssVar(box.current, null, "#FFFFFF");
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false, curve: 'basis' },
      theme: 'base',
      themeVariables: {
        background: cssVar(box.current, null, "#FFFFFF"),
        primaryColor: cssVar(box.current, null, "#FFFFFF"),
        primaryBorderColor: cssVar(box.current, null, "#D4D4D8"),
        primaryTextColor: cssVar(box.current, null, "#18181B"),
        lineColor: cssVar(box.current, null, "#A1A1AA"),
        fontFamily: getComputedStyle(box.current).fontFamily,
        fontSize: '15px',
      },
      // A calm, modern finish: soft cards, quiet curved connectors, and a halo
      // behind edge labels so a line never runs through the text.
      themeCSS: [
        '.node rect{rx:10px;ry:10px}',
        '.nodeLabel,.node .label text{font-weight:500}',
        '.flowchart-link{stroke-width:1.5px;stroke-opacity:.7;stroke-linecap:round}',
        '.marker,.arrowMarkerPath{fill-opacity:.7;stroke-opacity:.7}',
        `.edgeLabel text{font-size:13px;font-weight:500;paint-order:stroke;stroke:${bg};stroke-width:8px;stroke-linejoin:round}`,
      ].join(''),
    });
    mermaid.render(renderId, chart).then(
      (r) => { if (live) { setSvg(r.svg); setError(null); } },
      (e) => { if (live) setError(String(e?.message || e)); },
    );
    return () => { live = false; };
  }, [renderId, chart]);

  // Scale the diagram to fit its box.
  useEffect(() => {
    const el = box.current?.querySelector('svg');
    if (el) Object.assign(el.style, { width: '100%', height: '100%', maxWidth: 'none' });
  }, [svg]);

  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', padding: 50, display: 'flex', flexDirection: 'column', gap: 25, background: "#FFFFFF", color: "#111111" }}>
      <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, system-ui, sans-serif", fontSize: 50, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{title}</div>
      {error ? (
        <pre style={{ flex: 1, margin: 0, whiteSpace: 'pre-wrap', fontSize: 14, opacity: 0.7 }}>{error}</pre>
      ) : (
        <div
          ref={box}
          // Tells Lerret's export to wait until the diagram is drawn; does nothing elsewhere.
          data-lerret-pending={svg ? undefined : ''}
          style={{ flex: 1, minHeight: 0 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}
