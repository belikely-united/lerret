// diagram-render.js — turns a `.mmd` / `.mermaid` file's text into an SVG
// string plus its natural size (spec-mermaid-diagrams.md, Phase 1).
//
// Rendering happens in the asset runtime, BEFORE the entry reaches the canvas.
// That keeps a diagram a plain fixed-size artboard: zoom, focus view and both
// export paths (studio + `@lerret/cli export`) see a finished SVG and never
// have to wait on Mermaid's async render.
//
// - Mermaid is imported lazily, so projects without diagrams never load it
//   (decision D5).
// - `securityLevel: 'strict'` always; `htmlLabels: false` so labels are SVG
//   `<text>` (html-to-image captures `foreignObject` unreliably).
// - Renders are serialized: Mermaid keeps global config and a temp DOM node
//   per render, so one at a time is the safe default.

let mermaidPromise = null;
let queue = Promise.resolve();
let renderCount = 0;

/** Padding (px) around the diagram inside its artboard (decision D3). */
export const DIAGRAM_PADDING = 32;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default ?? mod);
    // A failed chunk load must not poison every later render.
    mermaidPromise.catch(() => {
      mermaidPromise = null;
    });
  }
  return mermaidPromise;
}

/**
 * Read the natural size from an SVG's `viewBox`.
 *
 * @param {string} svg
 * @returns {{ width: number, height: number } | null}
 */
export function svgSize(svg) {
  const m = /viewBox="\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*"/i.exec(svg);
  if (!m) return null;
  const width = Math.ceil(Number(m[1]));
  const height = Math.ceil(Number(m[2]));
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Render Mermaid text to SVG.
 *
 * Rejects with Mermaid's own error (e.g. "Parse error on line 2: …") for
 * invalid text, so the caller can show it on the asset's error card.
 *
 * @param {string} text  Mermaid source.
 * @param {{ theme: string, themeVariables: Record<string, unknown> } | null} [look]
 *   Brand theme from `diagram-theme.js`; `null` → Mermaid's neutral default.
 * @returns {Promise<{ svg: string, width: number, height: number }>}
 */
export function renderDiagram(text, look = null) {
  const run = async () => {
    const mermaid = await loadMermaid();
    // `initialize` rebuilds Mermaid's site config from its defaults each
    // call, so one diagram's theme never leaks into the next (renders are
    // serialized below). The file's own frontmatter still wins over this.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: look ? look.theme : 'default',
      themeVariables: look ? look.themeVariables : {},
    });
    // Labels are measured at render time — make sure the brand font is
    // actually loaded (not just declared), then wait for any other web fonts.
    if (typeof document !== 'undefined' && document.fonts) {
      const family = look?.themeVariables?.fontFamily;
      if (typeof family === 'string') {
        try {
          await document.fonts.load(`16px ${family}`);
        } catch {
          // unknown font → fallback stack
        }
      }
      if (document.fonts.ready) await document.fonts.ready;
    }
    renderCount += 1;
    const { svg } = await mermaid.render(`lerret-mmd-${renderCount}`, text);
    const size = svgSize(svg) ?? { width: 400, height: 300 };
    return { svg, ...size };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
