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

/**
 * The neutral look when no brand applies — calm zinc greys, white cards and a
 * modern sans, instead of Mermaid's lavender boxes and Trebuchet.
 */
export const NEUTRAL_THEME = Object.freeze({
  background: '#FFFFFF',
  primaryColor: '#FFFFFF',
  primaryBorderColor: '#D4D4D8',
  primaryTextColor: '#18181B',
  textColor: '#18181B',
  secondaryColor: '#F4F4F5',
  tertiaryColor: '#FAFAFA',
  lineColor: '#A1A1AA',
  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontSize: '14px',
});

/** Mermaid curve for connectors — smooth, calm S-curves. */
export const DEFAULT_CURVE = 'basis';

/**
 * The design finish baked into every diagram's own <style>, so the canvas,
 * PNG/JPG export and the SVG download all match. Mermaid scopes it to the
 * diagram; a file's own frontmatter `themeCSS` replaces it.
 *
 * Connectors are deliberately quiet (they guide, the content leads): 1.5px,
 * round caps, the line colour at 85%. Boxes are soft cards. Edge labels become
 * chips in `polishDiagramSvg`.
 *
 * @param {{ bg: string, line: string, ink: string }} c
 * @returns {string}
 */
export function modernDiagramCss(c) {
  return [
    `.flowchart-link{stroke:${c.line};stroke-width:1.5px;stroke-opacity:.85;stroke-linecap:round;stroke-linejoin:round}`,
    '.edge-thickness-thick{stroke-width:3px}',
    '.edge-pattern-dotted{stroke-dasharray:2 5}',
    `.marker,.arrowMarkerPath{fill:${c.line};stroke:${c.line};stroke-linejoin:round;fill-opacity:.85;stroke-opacity:.85}`,
    '.node rect,rect.actor,rect.note,rect.labelBox{rx:10px;ry:10px}',
    // Sequence diagrams: same quiet lines, arrowheads and text weight.
    `.messageLine0,.messageLine1{stroke:${c.line} !important;stroke-width:1.5px !important;stroke-opacity:.85}`,
    `[id$="arrowhead"] path,[id$="crosshead"] path,[id$="filled-head"] path{fill:${c.line} !important;stroke:${c.line} !important}`,
    `.messageText{font-weight:500;fill:${c.ink} !important}`,
    '.actor-line{stroke-opacity:.6}',
    '.node .label text,.nodeLabel{font-weight:500}',
    `.edgeLabel text{font-size:12px;font-weight:500;letter-spacing:.01em;fill:${c.ink};fill-opacity:.72}`,
    `.edgeLabel rect.lerret-chip{fill:${c.bg} !important;opacity:1 !important;stroke-width:1px}`,
  ].join('');
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Finish a rendered diagram in a live (hidden) DOM, where text can be
 * measured:
 *   - every edge label gets a real chip behind it (rounded, background fill,
 *     hairline border) — a connector never runs through its label;
 *   - arrowheads become slim tapered points instead of chunky triangles
 *     (same tip position, so they still meet the box edge exactly).
 *
 *   - connectors between neighbouring boxes become one even S-curve that
 *     leaves and arrives along the flow (`axis`), instead of a lopsided swoop.
 *
 * @param {string} svg
 * @param {{ bg: string, line: string }} c
 * @param {'x' | 'y' | null} [axis]  Flow axis of a flowchart; null → keep curves.
 * @returns {string}
 */
export function polishDiagramSvg(svg, c, axis = null) {
  if (typeof document === 'undefined') return svg;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    const root = host.querySelector('svg');
    if (!root) return svg;
    for (const text of root.querySelectorAll('.edgeLabel text')) {
      if (!text.textContent.trim()) continue;
      const b = text.getBBox();
      if (!b.width) continue;
      const padX = 8;
      const padY = 3;
      const h = b.height + padY * 2;
      const chip = document.createElementNS(SVG_NS, 'rect');
      chip.setAttribute('class', 'lerret-chip');
      chip.setAttribute('x', String(b.x - padX));
      chip.setAttribute('y', String(b.y - padY));
      chip.setAttribute('width', String(b.width + padX * 2));
      chip.setAttribute('height', String(h));
      chip.setAttribute('rx', String(h / 2));
      chip.setAttribute('fill', c.bg);
      chip.setAttribute('stroke', c.line);
      chip.setAttribute('stroke-opacity', '0.45');
      text.parentNode.insertBefore(chip, text);
    }
    if (axis) evenCurves(root, axis);
    // Slim, tapered arrowheads — tip stays at (10, 5) in the marker box.
    for (const marker of root.querySelectorAll('marker')) {
      const path = marker.querySelector('path');
      if (!path) continue;
      if (/-pointEnd$/.test(marker.id)) path.setAttribute('d', 'M 1.5 1.5 L 10 5 L 1.5 8.5 L 3.5 5 Z');
      else if (/-pointStart$/.test(marker.id)) path.setAttribute('d', 'M 8.5 1.5 L 0 5 L 8.5 8.5 L 6.5 5 Z');
    }
    return root.outerHTML;
  } finally {
    host.remove();
  }
}

/**
 * Redraw each flowchart connector between neighbouring ranks (dagre gives
 * exactly 3 points: start, bend, end) as one cubic whose tangents run along
 * the flow axis, so it leaves and arrives flat and is symmetric. Longer edges
 * (routed around boxes) keep Mermaid's path. Labels move to the new midpoint.
 *
 * @param {SVGSVGElement} root
 * @param {'x' | 'y'} axis
 */
function evenCurves(root, axis) {
  for (const path of root.querySelectorAll('path.flowchart-link')) {
    let pts;
    try {
      pts = JSON.parse(atob(path.dataset.points || ''));
    } catch {
      continue;
    }
    if (!Array.isArray(pts) || pts.length !== 3) continue;
    // Mermaid's own ends (already shortened for the arrowheads).
    const nums = (path.getAttribute('d') || '').match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number);
    if (!nums || nums.length < 4) continue;
    const [x0, y0] = nums;
    const [x1, y1] = nums.slice(-2);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const d = axis === 'x'
      ? `M${x0},${y0}C${mx},${y0},${mx},${y1},${x1},${y1}`
      : `M${x0},${y0}C${x0},${my},${x1},${my},${x1},${y1}`;
    path.setAttribute('d', d);
    // The cubic's t=0.5 point is the midpoint of its ends.
    const key = path.id.replace(/^.*?-(L_)/, '$1');
    const label = root.querySelector(`g.label[data-id="${CSS.escape(key)}"]`)?.closest('g.edgeLabel');
    if (label?.hasAttribute('transform')) label.setAttribute('transform', `translate(${mx}, ${my})`);
  }
}

/**
 * Flow axis of a flowchart's text, or null (other diagram types, or the file
 * picks its own `curve`).
 *
 * @param {string} text
 * @returns {'x' | 'y' | null}
 */
export function flowAxis(text) {
  if (/\bcurve\s*:/.test(text)) return null;
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const m = /^\s*(?:flowchart|graph)\b[ \t]*(\w*)/im.exec(body.replace(/^\s*%%.*$/gm, ''));
  if (!m) return null;
  return /^(LR|RL)$/i.test(m[1]) ? 'x' : 'y';
}

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
 *   Brand theme from `diagram-theme.js`; `null` → Lerret's neutral look.
 * @param {{ nodeSpacing?: number, rankSpacing?: number, curve?: string }} [flowchart]
 *   Extra flowchart layout defaults (page maps space artboards wider).
 * @returns {Promise<{ svg: string, width: number, height: number }>}
 */
/**
 * True when this document is laid out. A frame inside `display: none` (a chat
 * app can load the in-chat studio before it shows it) measures everything as
 * 0: Mermaid would size its boxes at 0 and page maps would read every card as
 * 0 tall, and both results stick.
 */
export function isLaidOut() {
  return typeof window === 'undefined' || window.innerWidth > 0;
}

/** Resolves once the document is laid out (showing a hidden frame fires `resize`). */
export function whenLaidOut() {
  if (isLaidOut()) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (!isLaidOut()) return;
      window.removeEventListener('resize', check);
      resolve();
    };
    window.addEventListener('resize', check);
  });
}

export function renderDiagram(text, look = null, flowchart = {}) {
  // Brand variables sit on top of the neutral look, so a partial brand (say,
  // only a background) still gets modern defaults for everything else.
  const vars = { ...NEUTRAL_THEME, ...(look ? look.themeVariables : {}) };
  const colors = {
    bg: String(vars.background),
    line: String(vars.lineColor),
    ink: String(vars.primaryTextColor ?? vars.textColor),
  };
  const run = async () => {
    await whenLaidOut();
    const mermaid = await loadMermaid();
    // `initialize` rebuilds Mermaid's site config from its defaults each
    // call, so one diagram's theme never leaks into the next (renders are
    // serialized below). The file's own frontmatter still wins over this.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false, curve: DEFAULT_CURVE, ...flowchart },
      theme: 'base',
      themeVariables: vars,
      themeCSS: modernDiagramCss(colors),
    });
    // Labels are measured at render time — make sure the brand font is
    // actually loaded (not just declared), then wait for any other web fonts.
    if (typeof document !== 'undefined' && document.fonts) {
      const family = vars.fontFamily;
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
    const { svg: raw } = await mermaid.render(`lerret-mmd-${renderCount}`, text);
    const svg = polishDiagramSvg(raw, colors, flowAxis(text));
    const size = svgSize(svg) ?? { width: 400, height: 300 };
    return { svg, ...size };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}
