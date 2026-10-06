// workflow-graph.js — the workflow's data model, pure (no DOM, no React).
//
// A workflow is a small graph on one page:
//
//   [Spreadsheet] ──▶ [Design] ──▶ [Preview]
//                              └─▶ [Download (PNG / JPG / PDF)]
//
// The Design node maps text that appears on the design ("John Doe") to a
// spreadsheet column ("Name"); running an output node renders the design once
// per row with that text replaced. Saved per page as JSON.

/** @typedef {'data' | 'design' | 'preview' | 'download'} NodeType */

/**
 * @typedef {object} WorkflowNode
 * @property {string} id
 * @property {NodeType} type
 * @property {number} x
 * @property {number} y
 * @property {{ name: string, headers: string[], rows: string[][] }} [table]   data
 * @property {string} [assetPath]                                              design
 * @property {string} [variant]                                                design
 * @property {Record<string, string>} [mapping]  design: shown text → column header
 * @property {'png' | 'jpg' | 'pdf'} [format]                                  download
 * @property {string} [nameColumn]               download: file names from this column
 */

/** @typedef {{ from: string, to: string }} WorkflowEdge */
/** @typedef {{ version: 1, nodes: WorkflowNode[], edges: WorkflowEdge[] }} Workflow */

export const DOWNLOAD_FORMATS = Object.freeze([
  { id: 'png', label: 'PNG images (ZIP)' },
  { id: 'jpg', label: 'JPG images (ZIP)' },
  { id: 'pdf', label: 'One PDF' },
]);

/** Which node types may feed which. */
const ALLOWED = Object.freeze({
  data: ['design'],
  design: ['preview', 'download'],
  preview: [],
  download: [],
});

export const emptyWorkflow = () => ({ version: 1, nodes: [], edges: [] });

let seq = 0;
/** A short unique node id. */
export function newId(type) {
  seq += 1;
  return `${type}-${Date.now().toString(36)}-${seq}`;
}

/**
 * Whether an edge from `from` to `to` is allowed: right types, not a
 * duplicate, and an input that takes one connection (design ← one sheet,
 * output ← one design) is free.
 *
 * @param {Workflow} wf
 * @param {string} fromId
 * @param {string} toId
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canConnect(wf, fromId, toId) {
  const from = wf.nodes.find((n) => n.id === fromId);
  const to = wf.nodes.find((n) => n.id === toId);
  if (!from || !to || from.id === to.id) return { ok: false, reason: 'missing' };
  if (!ALLOWED[from.type].includes(to.type)) {
    return { ok: false, reason: `A ${label(from.type)} can’t connect to a ${label(to.type)}.` };
  }
  if (wf.edges.some((e) => e.from === fromId && e.to === toId)) return { ok: false, reason: 'Already connected.' };
  if (wf.edges.some((e) => e.to === toId)) return { ok: false, reason: `That ${label(to.type)} already has an input.` };
  return { ok: true };
}

/** Connect two nodes (replacing the target's existing input). */
export function connect(wf, fromId, toId) {
  const edges = wf.edges.filter((e) => e.to !== toId);
  return { ...wf, edges: [...edges, { from: fromId, to: toId }] };
}

/** Remove a node and its edges. */
export function removeNode(wf, id) {
  return { ...wf, nodes: wf.nodes.filter((n) => n.id !== id), edges: wf.edges.filter((e) => e.from !== id && e.to !== id) };
}

/** Patch one node. */
export function updateNode(wf, id, patch) {
  return { ...wf, nodes: wf.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

/** The node feeding `id`, if any. */
export function inputOf(wf, id) {
  const e = wf.edges.find((x) => x.to === id);
  return e ? wf.nodes.find((n) => n.id === e.from) || null : null;
}

export function label(type) {
  return { data: 'spreadsheet', design: 'design', preview: 'preview', download: 'download' }[type] || type;
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Column headers that usually mean "the person's name". */
const NAME_HEADERS = ['name', 'fullname', 'employeename', 'employee', 'recipient', 'awardee', 'winner', 'firstname'];

/**
 * Suggest which text on the design each column replaces.
 *
 * `fields` are the design's texts, with the data prop they come from when
 * known (`{ text: 'Ada Lovelace', prop: 'name' }`). A text whose prop name
 * matches a header is mapped first; otherwise a "name"-like header is offered
 * to the text that looks most like a person's name.
 *
 * @param {Array<{ text: string, prop?: string }>} fields
 * @param {string[]} headers
 * @returns {Record<string, string>}  text → header
 */
export function autoMap(fields, headers) {
  const mapping = {};
  const used = new Set();
  for (const f of fields) {
    if (!f.prop) continue;
    const h = headers.find((x) => !used.has(x) && norm(x) === norm(f.prop));
    if (h) {
      mapping[f.text] = h;
      used.add(h);
    }
  }
  const nameHeader = headers.find((h) => !used.has(h) && NAME_HEADERS.includes(norm(h)));
  if (nameHeader && !Object.keys(mapping).length) {
    const person =
      fields.find((f) => PLACEHOLDER_NAMES.has(norm(f.text))) || fields.find((f) => looksLikePersonName(f.text));
    if (person) mapping[person.text] = nameHeader;
  }
  return mapping;
}

/** Stand-in names designers type where a real name will go. */
const PLACEHOLDER_NAMES = new Set([
  'johndoe', 'janedoe', 'yourname', 'fullname', 'namehere', 'recipientname', 'firstnamelastname', 'name', 'firstlast',
]);

/** Words that mark a phrase as a heading or caption, never someone's name. */
const NOT_A_NAME = /\b(of|for|the|and|to|in|by|at|with|certificate|award|awarded|excellence|achievement|presented|performance|performer|best|team|inc|ltd|llc|company|year|month|quarter|employee|appreciation|recognition)\b/i;

/**
 * Two or three capitalized words, no digits, not ALL CAPS, no heading words:
 * "Priya Sharma" yes, "CERTIFICATE OF EXCELLENCE" / "Best Performer" no.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikePersonName(text) {
  const t = String(text ?? '').trim();
  if (!/^\p{Lu}[\p{L}'’.-]+(\s+\p{Lu}[\p{L}'’.-]+){1,2}$/u.test(t)) return false;
  if (t === t.toUpperCase()) return false;
  return !NOT_A_NAME.test(t);
}

/**
 * The text replacements for one row: shown text → that row's cell.
 *
 * @param {Record<string, string>} mapping
 * @param {string[]} headers
 * @param {string[]} row
 * @returns {Array<[string, string]>}
 */
export function replacementsFor(mapping, headers, row) {
  return Object.entries(mapping || {})
    .map(([text, header]) => [text, row[headers.indexOf(header)] ?? ''])
    .filter(([, v]) => v !== undefined);
}

/**
 * File names for every row, from one column (fallback: "<base> 01" …),
 * made filesystem-safe and unique.
 *
 * @param {string[][]} rows
 * @param {string[]} headers
 * @param {string | undefined} column
 * @param {string} base
 * @returns {string[]}
 */
export function fileNamesFor(rows, headers, column, base) {
  const idx = column ? headers.indexOf(column) : -1;
  const seen = new Map();
  const pad = String(rows.length).length;
  return rows.map((row, i) => {
    const raw = idx >= 0 && row[idx] ? row[idx] : `${base} ${String(i + 1).padStart(Math.max(2, pad), '0')}`;
    let name = String(raw).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || `${base} ${i + 1}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
}

/**
 * Parse a saved workflow, dropping anything malformed (and edges to missing
 * nodes) rather than failing — a hand-edited file shouldn't break the view.
 *
 * @param {string} json
 * @returns {Workflow}
 */
export function parseWorkflow(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyWorkflow();
  }
  const types = new Set(Object.keys(ALLOWED));
  const nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).filter(
    (n) => n && typeof n.id === 'string' && types.has(n.type) && Number.isFinite(n.x) && Number.isFinite(n.y),
  );
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(raw?.edges) ? raw.edges : []).filter((e) => e && ids.has(e.from) && ids.has(e.to));
  return { version: 1, nodes, edges };
}

/** Where a page's workflow is saved: `<.lerret>/.workflows/<page-rel>.json`. */
export function workflowPathFor(lerretDir, pagePath) {
  const root = String(lerretDir).replace(/\/+$/, '');
  const rel = String(pagePath).startsWith(`${root}/`) ? String(pagePath).slice(root.length + 1) : String(pagePath);
  return `${root}/.workflows/${rel.replace(/[\\/]+/g, '__') || 'page'}.json`;
}
