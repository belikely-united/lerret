// diagram-map.js — `_index.mmd`: Mermaid arranges a page or group's canvas
// (spec-mermaid-diagrams.md, Phase 4).
//
// A page or group may hold an `_index.mmd`. It stays a plain Mermaid file, but
// in Lerret it is not an artboard of its own — it is the LAYOUT of that folder:
// every flowchart node named after an asset in the folder (`og-card` ↔
// `og-card.jsx`, `notes` ↔ `notes.md`) is where that asset's real artboard is
// placed, and Mermaid's arrows/labels/other boxes are drawn behind them.
// Assets the map doesn't name keep the normal row, below the map.
//
// How: each matched node is re-declared as an image node sized to the real
// artboard (`id@{ img, w, h }`, transparent placeholder) so Mermaid's layout
// leaves exactly the right hole; after rendering, each hole's position is read
// from the SVG and the canvas puts the artboard there.

import { PAGE_MAP_FILE } from '@lerret/core';

export { PAGE_MAP_FILE };

/** 1×1 transparent PNG — what Mermaid lays out where an artboard goes. */
export const MAP_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/**
 * Default spacing between artboards, in MAP units (see `mapScale`); the
 * file's frontmatter can override. ×scale on the canvas.
 */
export const MAP_SPACING = Object.freeze({ nodeSpacing: 56, rankSpacing: 96 });

/**
 * How much bigger than Mermaid units the map is drawn. Artboards are large
 * (600–1500 px) and a page is viewed zoomed out, so a map drawn at 1:1 would
 * show hairline arrows and unreadable labels. Instead Mermaid lays the map out
 * with every artboard shrunk by `k`, and the canvas shows the result `k`×
 * larger — lines, arrowheads, labels and spacing all scale with the artboards.
 *
 * @param {Array<{ width: number, height: number }>} artboards
 * @returns {number}  1 … 6
 */
export function mapScale(artboards) {
  const sizes = (artboards || []).map((a) => Math.max(a.width, a.height)).filter((n) => n > 0).sort((a, b) => a - b);
  if (sizes.length === 0) return 1;
  const median = sizes[Math.floor(sizes.length / 2)];
  return Math.min(6, Math.max(1, median / 240));
}

/** @param {{ fileName?: string }} asset */
export function isPageMap(asset) {
  return !!asset && asset.fileName === PAGE_MAP_FILE;
}

/** A name that can be a Mermaid node id as written (letters, digits, `_`, `-`). */
const ID_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

/** The diagram type line (after optional frontmatter and comments). */
function diagramType(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  const line = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%'));
  return (line || '').split(/\s+/)[0].toLowerCase();
}

/**
 * Turn every node that names a sibling asset into a hole exactly the size of
 * that asset's artboard — so Mermaid aims each arrow at the artboard's centre
 * and stops it at the artboard's edge. (The artboard's name label sits above
 * the card, inside Mermaid's node spacing.)
 *
 * Only flowcharts (`flowchart` / `graph`) — image nodes are a flowchart
 * feature; any other diagram type leaves the folder's normal layout alone.
 *
 * @param {string} text  The `_index.mmd` source.
 * @param {Array<{ id: string, name: string, width: number, height: number }>} artboards
 *   The folder's artboards: `id` = canvas slot id, `name` = asset name.
 * @param {number} [k]  Map scale — node sizes are the artboard sizes ÷ k.
 * @returns {{ text: string, nodes: Array<{ id: string, slotId: string, width: number, height: number }> }}
 */
export function preparePageMap(text, artboards, k = 1) {
  const type = diagramType(text);
  if (type !== 'flowchart' && type !== 'graph') return { text, nodes: [] };
  const nodes = [];
  const lines = [];
  const seen = new Set();
  for (const a of artboards || []) {
    if (!a || seen.has(a.name) || !ID_SAFE.test(a.name)) continue;
    // Used as a node id: the whole name, not part of a longer id.
    const used = new RegExp(`(^|[^A-Za-z0-9_-])${a.name.replace(/-/g, '\\-')}(?![A-Za-z0-9_])(?!-[A-Za-z0-9_])`, 'm');
    if (!used.test(text)) continue;
    seen.add(a.name);
    const w = Math.round(a.width / k);
    const h = Math.round(a.height / k);
    nodes.push({ id: a.name, slotId: a.id, width: w, height: h });
    lines.push(`  ${a.name}@{ img: "${MAP_PLACEHOLDER}", label: "", w: ${w}, h: ${h} }`);
  }
  if (nodes.length === 0) return { text, nodes };
  return { text: `${text.replace(/\s*$/, '')}\n${lines.join('\n')}\n`, nodes };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Render a prepared map and read where each artboard goes.
 *
 * @param {string} text  The `_index.mmd` source.
 * @param {Array<{ id: string, name: string, width: number, height: number }>} artboards
 * @param {(text: string) => Promise<{ svg: string, width: number, height: number }>} render
 * @returns {Promise<{ svg: string, width: number, height: number,
 *   positions: Record<string, { left: number, top: number, width: number, height: number }> } | null>}
 *   The returned `svg` has the placeholder nodes removed (the real artboards
 *   go there) — a user's own image nodes are kept.
 *   `names` maps each placed slot to its node id; `scale` is the map scale.
 *   `null` when the map names no artboard (normal layout applies).
 */
export async function layoutPageMap(text, artboards, render) {
  const k = mapScale(artboards);
  const { text: prepared, nodes } = preparePageMap(text, artboards, k);
  if (nodes.length === 0) return null;
  const out = await render(prepared);
  // Measure in a hidden, unscaled copy: 1 SVG unit = 1 px.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  host.innerHTML = out.svg;
  document.body.appendChild(host);
  try {
    const svg = host.querySelector('svg');
    Object.assign(svg.style, { width: `${out.width}px`, height: `${out.height}px`, maxWidth: 'none' });
    const origin = svg.getBoundingClientRect();
    const groups = [...svg.querySelectorAll('g.image-shape')];
    const positions = {};
    for (const n of nodes) {
      const re = new RegExp(`-flowchart-${escapeRe(n.id)}-\\d+$`);
      const group = groups.find((g) => re.test(g.id));
      const img = group?.querySelector('image');
      if (!img) continue;
      const r = img.getBoundingClientRect();
      positions[n.slotId] = { left: (r.left - origin.left) * k, top: (r.top - origin.top) * k, width: r.width * k, height: r.height * k };
      group.remove(); // the real artboard is drawn here instead
    }
    // Wide invisible twins of the connectors, so an arrow is easy to click.
    for (const link of svg.querySelectorAll('path.flowchart-link')) {
      const hit = link.cloneNode(false);
      hit.removeAttribute('style');
      hit.removeAttribute('marker-end');
      hit.removeAttribute('marker-start');
      hit.setAttribute('class', 'lerret-hit dc-section-cta'); // dc-section-cta: no canvas pan
      hit.setAttribute('data-edge', link.id.replace(/^.*?-(L_)/, '$1'));
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '12');
      link.parentNode.appendChild(hit);
    }
    svg.style.removeProperty('width');
    svg.style.removeProperty('height');
    svg.style.removeProperty('max-width');
    const names = Object.fromEntries(nodes.filter((n) => positions[n.slotId]).map((n) => [n.slotId, n.id]));
    return { svg: svg.outerHTML, width: out.width * k, height: out.height * k, positions, names, scale: k };
  } finally {
    host.remove();
  }
}

/**
 * Placed artboards whose live height no longer matches the hole Mermaid left
 * for them. Notes are auto-height and keep growing after the layout ran (their
 * Markdown renders, a web font loads); a card taller than its hole spills over
 * its neighbours and the arrows aim at its middle — so any drift means one
 * more layout pass, measured from the cards as they are now.
 *
 * @param {Record<string, { height: number }>} positions  `layoutPageMap().positions`
 * @param {(slotId: string) => number} heightOf  Live card height; 0 = not rendered.
 * @param {number} [tolerance]  px of drift ignored (rounding through the map scale).
 * @returns {string[]} The drifted slot ids.
 */
export function driftedSlots(positions, heightOf, tolerance = 8) {
  return Object.keys(positions || {}).filter((id) => {
    const h = heightOf(id);
    return h > 0 && Math.abs(h - positions[id].height) > tolerance;
  });
}

/**
 * Starter `_index.mmd` for a folder: one node per asset, left to right, so
 * the user only has to draw the arrows.
 *
 * @param {Array<{ name: string, fileName?: string }>} assets
 * @returns {string}
 */
export function starterPageMap(assets) {
  const ids = (assets || []).filter((a) => a && !isPageMap(a) && ID_SAFE.test(a.name)).map((a) => a.name);
  const body = ids.length ? ids.map((id) => `  ${id}`).join('\n') : '  start[Add arrows between your assets]';
  return [
    '%% Page map: this file arranges the page. Each box named after an asset here',
    '%% is where that asset sits on the canvas. Connect them, e.g.  og-card --> x-banner',
    'flowchart LR',
    body,
    '',
  ].join('\n');
}

// ── Editing a map from the canvas (Phase 5) ────────────────────────────────
// Every gesture is a small rewrite of the plain Mermaid text, so the file stays
// the source of truth and hand edits keep working. Only simple one-edge lines
// (`a --> b`, `a -.->|text| b`) are edited in place; anything fancier (chains,
// `a & b`, `-- text -->`) is left to the code editor (helpers return null).

/** Arrow styles the canvas offers → Mermaid arrows. */
export const EDGE_STYLES = Object.freeze({ solid: '-->', dashed: '-.->', thick: '==>' });
const STYLE_OF = { '-->': 'solid', '---': 'solid', '-.->': 'dashed', '-.-': 'dashed', '==>': 'thick', '===': 'thick' };

const ID = '[A-Za-z0-9_][A-Za-z0-9_-]*?';
const EDGE_LINE = new RegExp(`^(\\s*)(${ID})\\s*(-->|-\\.->|==>|---|-\\.-|===)\\s*(?:\\|([^|]*)\\|\\s*)?(${ID})\\s*;?\\s*$`);

/**
 * Simple edges, each with the id Mermaid gives its SVG path (`L_a_b_N`, N
 * counting repeats of the same pair).
 *
 * @param {string} text
 * @returns {Array<{ id: string, line: number, from: string, to: string, style: string, label: string }>}
 */
export function listEdges(text) {
  const seen = {};
  const out = [];
  text.split('\n').forEach((raw, line) => {
    const m = EDGE_LINE.exec(raw);
    if (!m) return;
    const [, , from, arrow, label = '', to] = m;
    const pair = `${from}_${to}`;
    const n = seen[pair] ?? 0;
    seen[pair] = n + 1;
    out.push({ id: `L_${pair}_${n}`, line, from, to, style: STYLE_OF[arrow], label: label.trim() });
  });
  return out;
}

const cleanLabel = (s) => String(s || '').replace(/[|\n]/g, ' ').trim();

/** Append `from --> to` (no-op text when that edge already exists). */
export function addEdge(text, from, to) {
  if (from === to || listEdges(text).some((e) => e.from === from && e.to === to)) return text;
  return `${text.replace(/\s*$/, '')}\n  ${from} --> ${to}\n`;
}

/**
 * Change an edge's label and/or style; `null` → not a simple edge line.
 *
 * @param {string} text
 * @param {string} edgeId  e.g. `L_story_og-card_0`
 * @param {{ label?: string, style?: 'solid'|'dashed'|'thick' }} patch
 * @returns {string | null}
 */
export function updateEdge(text, edgeId, patch) {
  const edge = listEdges(text).find((e) => e.id === edgeId);
  if (!edge) return null;
  const lines = text.split('\n');
  const indent = /^\s*/.exec(lines[edge.line])[0];
  const label = cleanLabel(patch.label ?? edge.label);
  const arrow = EDGE_STYLES[patch.style ?? edge.style];
  lines[edge.line] = `${indent}${edge.from} ${arrow}${label ? `|${label}|` : ''} ${edge.to}`;
  return lines.join('\n');
}

/** Delete an edge's line; `null` → not a simple edge line. */
export function removeEdge(text, edgeId) {
  const edge = listEdges(text).find((e) => e.id === edgeId);
  if (!edge) return null;
  const lines = text.split('\n');
  lines.splice(edge.line, 1);
  return lines.join('\n');
}

/** `LR` | `RL` | `TB` | `BT` of the flowchart line (`TD` → `TB`; none → `TB`). */
export function mapDirection(text) {
  const m = /^\s*(?:flowchart|graph)\b[ \t]*(\w*)/im.exec(text.replace(/^---\n[\s\S]*?\n---\n/, ''));
  const d = (m?.[1] || 'TB').toUpperCase();
  return d === 'TD' ? 'TB' : ['LR', 'RL', 'TB', 'BT'].includes(d) ? d : 'TB';
}

/** Flip a horizontal map vertical and back (rewrites the `flowchart` line). */
export function toggleDirection(text) {
  const next = { LR: 'TB', RL: 'BT', TB: 'LR', BT: 'RL' }[mapDirection(text)];
  return text.replace(/^(\s*(?:flowchart|graph))\b[ \t]*\w*/im, `$1 ${next}`);
}

/** The map a folder gets from its first canvas arrow: just that arrow. */
export function firstPageMap(from, to) {
  return [
    '%% Page map: arranges this folder. Each box named after an asset here is',
    '%% where that asset sits on the canvas; the others stay in the row below.',
    'flowchart LR',
    `  ${from} --> ${to}`,
    '',
  ].join('\n');
}
