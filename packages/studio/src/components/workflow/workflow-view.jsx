// workflow-view.jsx — the Workflow mode canvas: nodes + connections.
//
//   [Spreadsheet] ──▶ [Design] ──▶ [Preview] / [Download]
//
// • The page's designs are listed on the left — click one to add its node.
// • Drop an Excel (.xlsx) or CSV file anywhere (or use "Upload spreadsheet…")
//   to add a Spreadsheet node.
// • Drag from a node's right dot to another node's left dot to connect.
// • The Design node maps text shown on the design to a column; Preview renders
//   every row; Download saves them as PNG/JPG files (ZIP) or one PDF.
//
// The graph saves per page to `.lerret/.workflows/<page>.json`.
//
// Motion: nodes and the view fade + scale in on mount (@starting-style,
// --lm-duration-base); dragging and wiring track the pointer 1:1 (no easing on
// direct manipulation). Reduced motion keeps only the fades.

import React from 'react';
import * as ReactDOM from 'react-dom';
import { zipSync } from 'fflate';

import { readProjectFile, writeProjectFile, listProjectDir } from '../../runtime/write-client.js';
import { readAssetData } from '../edit-mode/edit-session.js';
import { buildVarsStyle } from '../canvas/vars-injector.jsx';
import { useCascadedConfig } from '../canvas/cascade-context.jsx';
import { downloadBlob } from '../../export/app-store.js';
import { setWorkflowMode } from './workflow-mode.js';
import { readSpreadsheet, isSpreadsheetFile } from './spreadsheet.js';
import { buildJpegPdf } from './pdf.js';
import { baseProps, designSize, renderRow, withRenderedDesign, visibleTexts } from './batch-render.jsx';
import {
  DOWNLOAD_FORMATS,
  emptyWorkflow,
  newId,
  canConnect,
  connect,
  removeNode,
  updateNode,
  inputOf,
  autoMap,
  replacementsFor,
  fileNamesFor,
  parseWorkflow,
  workflowPathFor,
} from './workflow-graph.js';
import './workflow.css';

const NODE_W = 300;
const baseName = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
const designKey = (e) => `${e.asset.path}#${e.variantName || 'default'}`;

/**
 * @param {{
 *   page: { path: string, name: string },
 *   lerretDir: string,
 *   entries: Array<object>,  runtime component entries on this page
 * }} props
 */
export function WorkflowView({ page, lerretDir, entries }) {
  const [wf, setWf] = React.useState(null); // null until loaded
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [wire, setWire] = React.useState(null); // { from, x, y } while connecting
  const [notice, setNotice] = React.useState(null);
  const [dropping, setDropping] = React.useState(false);
  const surfaceRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const savePath = workflowPathFor(lerretDir, page.path);
  const getConfigFor = useCascadedConfig();

  const designs = React.useMemo(() => {
    const seen = new Set();
    return entries.filter((e) => {
      const k = designKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [entries]);
  const entryFor = React.useCallback(
    (node) => designs.find((e) => e.asset.path === node.assetPath && (e.variantName || 'default') === (node.variant || 'default')),
    [designs],
  );

  // ── Load + save ───────────────────────────────────────────────────────────
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const dir = savePath.slice(0, savePath.lastIndexOf('/'));
      const listing = await listProjectDir(dir);
      const exists = (listing.entries || []).some((x) => x.name === baseName(savePath));
      let next = emptyWorkflow();
      if (exists) {
        const r = await readProjectFile(savePath);
        if (r.ok) next = parseWorkflow(r.content);
      }
      if (next.nodes.length === 0) {
        // First visit: the page's designs are already here as nodes.
        next.nodes = designs.slice(0, 3).map((e, i) => ({
          id: newId('design'),
          type: 'design',
          x: 380,
          y: 60 + i * 300,
          assetPath: e.asset.path,
          variant: e.variantName || 'default',
          mapping: {},
        }));
      }
      if (!cancelled) setWf(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savePath]);

  const firstSave = React.useRef(true);
  React.useEffect(() => {
    if (!wf) return undefined;
    if (firstSave.current) {
      firstSave.current = false;
      return undefined;
    }
    const t = setTimeout(() => {
      writeProjectFile(savePath, `${JSON.stringify(wf, null, 2)}\n`).then((r) => {
        if (!r.ok) setNotice(`Couldn’t save the workflow: ${r.error}`);
      });
    }, 500);
    return () => clearTimeout(t);
  }, [wf, savePath]);

  React.useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Adding nodes ──────────────────────────────────────────────────────────
  const freeSpot = (x) => {
    const below = (wf?.nodes || []).filter((n) => Math.abs(n.x - x) < NODE_W).map((n) => n.y + 260);
    return { x: x - pan.x, y: Math.max(60, ...below) - pan.y };
  };
  const addNode = (node) => setWf((cur) => ({ ...cur, nodes: [...cur.nodes, node] }));

  const addDesign = (e) => addNode({ id: newId('design'), type: 'design', ...freeSpot(380), assetPath: e.asset.path, variant: e.variantName || 'default', mapping: {} });
  const addOutput = (type) =>
    addNode({ id: newId(type), type, ...freeSpot(740), ...(type === 'download' ? { format: 'png' } : {}) });

  const addSheet = async (file, at) => {
    try {
      const table = await readSpreadsheet(file);
      const pos = at || freeSpot(40);
      setWf((cur) => {
        const node = { id: newId('data'), type: 'data', x: pos.x, y: pos.y, table };
        let next = { ...cur, nodes: [...cur.nodes, node] };
        // One design on the page and nothing feeding it? Connect straight away.
        const lone = next.nodes.filter((n) => n.type === 'design');
        if (lone.length === 1 && !inputOf(next, lone[0].id)) {
          next = connect(next, node.id, lone[0].id);
          // Sit it to the design's left so the connection reads left → right.
          if (node.x + NODE_W > lone[0].x - 60) {
            next = updateNode(next, node.id, { x: lone[0].x - NODE_W - 80, y: lone[0].y });
          }
        }
        return next;
      });
      setNotice(`Added ${table.name} · ${table.rows.length} rows`);
    } catch (err) {
      setNotice(err.message || String(err));
    }
  };

  // ── Drop a spreadsheet ────────────────────────────────────────────────────
  const onDragOver = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    setDropping(false);
    const file = Array.from(e.dataTransfer.files || []).find(isSpreadsheetFile) || e.dataTransfer.files?.[0];
    if (!file) return;
    const r = surfaceRef.current.getBoundingClientRect();
    addSheet(file, { x: e.clientX - r.left - pan.x - 40, y: e.clientY - r.top - pan.y - 20 });
  };

  // ── Panning the surface ───────────────────────────────────────────────────
  const onSurfaceDown = (e) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const x0 = e.clientX - pan.x;
    const y0 = e.clientY - pan.y;
    const move = (ev) => setPan({ x: ev.clientX - x0, y: ev.clientY - y0 });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ── Wiring ────────────────────────────────────────────────────────────────
  const startWire = (fromId, e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = surfaceRef.current.getBoundingClientRect();
    const at = (ev) => ({ x: ev.clientX - r.left - pan.x, y: ev.clientY - r.top - pan.y });
    setWire({ from: fromId, ...at(e) });
    const move = (ev) => setWire({ from: fromId, ...at(ev) });
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setWire(null);
      const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-wf-node]');
      const toId = target?.getAttribute('data-wf-node');
      if (!toId || toId === fromId) return;
      setWf((cur) => {
        const check = canConnect(cur, fromId, toId);
        if (!check.ok && check.reason !== 'missing' && !/already has an input/.test(check.reason)) {
          setNotice(check.reason);
          return cur;
        }
        return check.reason === 'missing' ? cur : connect(cur, fromId, toId);
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const moveNode = (id, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const node = wf.nodes.find((n) => n.id === id);
    const x0 = e.clientX - node.x;
    const y0 = e.clientY - node.y;
    const move = (ev) => setWf((cur) => updateNode(cur, id, { x: ev.clientX - x0, y: ev.clientY - y0 }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (typeof document === 'undefined') return null;

  // Port positions for the edges (node-local offsets are fixed: header 22px).
  const port = (node, side) => ({ x: node.x + (side === 'out' ? NODE_W : 0), y: node.y + 24 });
  const curve = (a, b) => {
    const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  const ctx = { wf, setWf, entryFor, getConfigFor, setNotice, startWire, moveNode, page };

  return ReactDOM.createPortal(
    <div className="lm-wf" data-lm-workflow data-testid="lm-workflow" role="region" aria-label="Workflow">
      <aside className="lm-wf-palette" aria-label="Add to workflow">
        <div className="lm-wf-palette__head">
          <h2>Workflow</h2>
          <p>{page.name}</p>
        </div>
        <section>
          <h3>Data</h3>
          <button type="button" className="lm-wf-add" onClick={() => fileRef.current?.click()} data-testid="lm-wf-upload">
            <span className="lm-wf-dot lm-wf-dot--data" /> Upload spreadsheet…
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addSheet(f); }} />
          <p className="lm-wf-hint">Or drop an Excel (.xlsx) or CSV file anywhere.</p>
        </section>
        <section>
          <h3>Designs on this page</h3>
          {designs.length === 0 ? (
            <p className="lm-wf-hint">No designs on this page yet.</p>
          ) : designs.map((e) => (
            <button key={designKey(e)} type="button" className="lm-wf-add" onClick={() => addDesign(e)} title="Add to the workflow">
              <span className="lm-wf-dot lm-wf-dot--design" />
              {e.label || baseName(e.asset.path)}
            </button>
          ))}
        </section>
        <section>
          <h3>Finish with</h3>
          <button type="button" className="lm-wf-add" onClick={() => addOutput('preview')} data-testid="lm-wf-add-preview">
            <span className="lm-wf-dot lm-wf-dot--out" /> Preview
          </button>
          <button type="button" className="lm-wf-add" onClick={() => addOutput('download')} data-testid="lm-wf-add-download">
            <span className="lm-wf-dot lm-wf-dot--out" /> Download
          </button>
        </section>
        <button type="button" className="lm-wf-back" onClick={() => setWorkflowMode(false)}>← Back to designs</button>
      </aside>

      <div
        ref={surfaceRef}
        className={`lm-wf-surface${dropping ? ' lm-wf-surface--drop' : ''}`}
        onPointerDown={onSurfaceDown}
        onDragOver={onDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={onDrop}
        style={{ backgroundPosition: `${pan.x}px ${pan.y}px` }}
      >
        {!wf ? (
          <p className="lm-wf-empty">Loading…</p>
        ) : (
          <div className="lm-wf-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
            <svg className="lm-wf-edges" aria-hidden="false">
              {wf.edges.map((e) => {
                const a = wf.nodes.find((n) => n.id === e.from);
                const b = wf.nodes.find((n) => n.id === e.to);
                if (!a || !b) return null;
                const d = curve(port(a, 'out'), port(b, 'in'));
                return (
                  <g key={`${e.from}>${e.to}`} className="lm-wf-edge" onClick={() => setWf((cur) => ({ ...cur, edges: cur.edges.filter((x) => x !== e) }))}>
                    <title>Click to disconnect</title>
                    <path d={d} className="lm-wf-edge__hit" />
                    <path d={d} className="lm-wf-edge__line" />
                  </g>
                );
              })}
              {wire && (() => {
                const a = wf.nodes.find((n) => n.id === wire.from);
                return a ? <path d={curve(port(a, 'out'), wire)} className="lm-wf-edge__line lm-wf-edge__line--live" /> : null;
              })()}
            </svg>
            {wf.nodes.map((n) => <Node key={n.id} node={n} ctx={ctx} />)}
            {wf.nodes.length > 0 && !wf.nodes.some((n) => n.type === 'data') && (
              <div className="lm-wf-callout" style={{ left: 40, top: 60 }}>
                <b>Drop your spreadsheet here</b>
                <span>An Excel or CSV file — one row per certificate, card or post.</span>
              </div>
            )}
          </div>
        )}
        {dropping && <div className="lm-wf-dropzone">Drop to add a spreadsheet</div>}
      </div>
      {notice && <div className="lm-wf-notice" role="status">{notice}</div>}
    </div>,
    document.body,
  );
}

// ── Nodes ───────────────────────────────────────────────────────────────────

const TITLES = { data: 'Spreadsheet', design: 'Design', preview: 'Preview', download: 'Download' };

function Node({ node, ctx }) {
  const hasIn = node.type !== 'data';
  const hasOut = node.type === 'data' || node.type === 'design';
  return (
    <div className={`lm-wf-node lm-wf-node--${node.type}`} style={{ left: node.x, top: node.y, width: NODE_W }} data-wf-node={node.id} data-testid={`lm-wf-node-${node.type}`}>
      <header className="lm-wf-node__head" onPointerDown={(e) => ctx.moveNode(node.id, e)}>
        <span>{TITLES[node.type]}</span>
        <button type="button" aria-label={`Remove ${TITLES[node.type]}`} title="Remove" onPointerDown={(e) => e.stopPropagation()} onClick={() => ctx.setWf((cur) => removeNode(cur, node.id))}>×</button>
      </header>
      {hasIn && <span className="lm-wf-port lm-wf-port--in" title="Input" />}
      {hasOut && (
        <span
          className="lm-wf-port lm-wf-port--out"
          title="Drag to connect"
          onPointerDown={(e) => ctx.startWire(node.id, e)}
          data-testid={`lm-wf-out-${node.type}`}
        />
      )}
      <div className="lm-wf-node__body">
        {node.type === 'data' && <DataBody node={node} />}
        {node.type === 'design' && <DesignBody node={node} ctx={ctx} />}
        {node.type === 'preview' && <PreviewBody node={node} ctx={ctx} />}
        {node.type === 'download' && <DownloadBody node={node} ctx={ctx} />}
      </div>
    </div>
  );
}

function DataBody({ node }) {
  const { table } = node;
  if (!table) return <p className="lm-wf-hint">No data.</p>;
  return (
    <>
      <p className="lm-wf-meta"><b>{table.name}</b> · {table.rows.length} rows</p>
      <div className="lm-wf-table" role="table" aria-label={table.name}>
        <div role="row" className="lm-wf-table__row lm-wf-table__row--head">
          {table.headers.slice(0, 3).map((h) => <span role="columnheader" key={h}>{h}</span>)}
        </div>
        {table.rows.slice(0, 3).map((r, i) => (
          <div role="row" key={i} className="lm-wf-table__row">
            {r.slice(0, 3).map((v, j) => <span role="cell" key={j}>{v}</span>)}
          </div>
        ))}
        {table.rows.length > 3 && <p className="lm-wf-hint">+ {table.rows.length - 3} more</p>}
      </div>
    </>
  );
}

/** Everything needed to render this design node: entry, props, vars. */
function useDesign(node, ctx) {
  const entry = ctx.entryFor(node);
  const [data, setData] = React.useState({ loaded: false, value: undefined });
  React.useEffect(() => {
    let cancelled = false;
    if (!entry) return undefined;
    readAssetData(entry.asset.path).then((r) => {
      if (!cancelled) setData({ loaded: true, value: r.value });
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);
  if (!entry || !data.loaded) return { entry, ready: false };
  const folder = entry.asset.path.slice(0, entry.asset.path.lastIndexOf('/'));
  return {
    entry,
    ready: true,
    props: baseProps(entry, data.value),
    varsStyle: buildVarsStyle(ctx.getConfigFor(folder)?.vars, folder),
  };
}

function DesignBody({ node, ctx }) {
  const design = useDesign(node, ctx);
  const sheet = inputOf(ctx.wf, node.id);
  const table = sheet?.type === 'data' ? sheet.table : null;
  const [fields, setFields] = React.useState(null); // [{ text, prop }]
  const [thumb, setThumb] = React.useState(null);

  // Render once: list the texts on the design and make a thumbnail.
  React.useEffect(() => {
    if (!design.ready) return undefined;
    let cancelled = false;
    let url = null;
    withRenderedDesign(design, async (host) => {
      const texts = visibleTexts(host);
      const byValue = new Map(Object.entries(design.props).filter(([, v]) => typeof v === 'string').map(([k, v]) => [v.trim(), k]));
      const { width } = designSize(design.entry);
      const { captureArtboard } = await import('../../export/capture.js');
      const { blob } = await captureArtboard(host.firstElementChild || host, { format: 'png', pixelRatio: Math.min(1, 560 / width) });
      return { texts: texts.map((t) => ({ text: t, prop: byValue.get(t) })), blob };
    }).then(({ texts, blob }) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setThumb(url);
      setFields(texts);
    }).catch((err) => !cancelled && ctx.setNotice(`Couldn’t read ${node.assetPath ? baseName(node.assetPath) : 'the design'}: ${err.message}`));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design.ready, design.entry]);

  // Suggest a mapping the first time a sheet is connected.
  const suggested = React.useRef(false);
  React.useEffect(() => {
    if (!table || !fields || suggested.current || Object.keys(node.mapping || {}).length) return;
    suggested.current = true;
    const mapping = autoMap(fields, table.headers);
    if (Object.keys(mapping).length) ctx.setWf((cur) => updateNode(cur, node.id, { mapping }));
  }, [table, fields, node.mapping, node.id, ctx]);

  if (!design.entry) return <p className="lm-wf-hint">This design is no longer on the page. Remove this node.</p>;
  const setMap = (text, header) => {
    const mapping = { ...(node.mapping || {}) };
    if (header) mapping[text] = header;
    else delete mapping[text];
    ctx.setWf((cur) => updateNode(cur, node.id, { mapping }));
  };
  return (
    <>
      <p className="lm-wf-meta"><b>{design.entry.label || baseName(node.assetPath)}</b></p>
      <div className="lm-wf-thumb">{thumb ? <img src={thumb} alt="" /> : <span>Rendering…</span>}</div>
      {!table ? (
        <p className="lm-wf-hint">Connect a spreadsheet to fill this design from its rows.</p>
      ) : !fields ? null : (
        <div className="lm-wf-map">
          <p className="lm-wf-label">Replace text with a column</p>
          {fields.map((f) => (
            <label key={f.text} className="lm-wf-map__row">
              <span title={f.text}>“{f.text.length > 26 ? `${f.text.slice(0, 26)}…` : f.text}”</span>
              <select value={node.mapping?.[f.text] || ''} onChange={(e) => setMap(f.text, e.target.value)} aria-label={`Replace “${f.text}” with`}>
                <option value="">Keep as is</option>
                {table.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

/** The design + sheet an output node renders, or why it can't. */
function sourceOf(ctx, node) {
  const design = inputOf(ctx.wf, node.id);
  if (!design || design.type !== 'design') return { error: 'Connect a design to this node.' };
  const entry = ctx.entryFor(design);
  if (!entry) return { error: 'The connected design is no longer on the page.' };
  const sheet = inputOf(ctx.wf, design.id);
  if (!sheet || sheet.type !== 'data' || !sheet.table) return { error: 'Connect a spreadsheet to the design.' };
  if (!Object.keys(design.mapping || {}).length) return { error: 'In the design node, pick which text each column replaces.' };
  return { design, entry, table: sheet.table };
}

/** Render every row of a source; `onRow(i, blob)` after each. */
async function renderAll(ctx, src, { format, pixelRatio }, onRow) {
  const { value } = await readAssetData(src.entry.asset.path);
  const folder = src.entry.asset.path.slice(0, src.entry.asset.path.lastIndexOf('/'));
  const design = {
    entry: src.entry,
    props: baseProps(src.entry, value),
    varsStyle: buildVarsStyle(ctx.getConfigFor(folder)?.vars, folder),
  };
  for (const [i, row] of src.table.rows.entries()) {
    const blob = await renderRow(design, replacementsFor(src.design.mapping, src.table.headers, row), { format, pixelRatio });
    await onRow(i, blob);
  }
}

function Progress({ done, total }) {
  return (
    <div className="lm-wf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      <em>{done} of {total}</em>
    </div>
  );
}

function PreviewBody({ node, ctx }) {
  const src = sourceOf(ctx, node);
  const [items, setItems] = React.useState([]); // [{ name, url }]
  const [busy, setBusy] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  React.useEffect(() => () => items.forEach((it) => URL.revokeObjectURL(it.url)), [items]);
  const run = async () => {
    if (src.error) return;
    items.forEach((it) => URL.revokeObjectURL(it.url));
    setItems([]);
    const names = fileNamesFor(src.table.rows, src.table.headers, Object.values(src.design.mapping)[0], src.entry.label || 'Design');
    const { width } = designSize(src.entry);
    setBusy({ done: 0, total: src.table.rows.length });
    try {
      await renderAll(ctx, src, { format: 'png', pixelRatio: Math.min(1, 640 / width) }, (i, blob) => {
        const url = URL.createObjectURL(blob);
        setItems((cur) => [...cur, { name: names[i], url }]);
        setBusy({ done: i + 1, total: src.table.rows.length });
      });
    } catch (err) {
      ctx.setNotice(`Couldn’t render: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };
  if (src.error) return <p className="lm-wf-hint">{src.error}</p>;
  return (
    <>
      <button type="button" className="lm-wf-run" onClick={run} disabled={!!busy} data-testid="lm-wf-run-preview">
        {busy ? 'Rendering…' : items.length ? `Refresh ${src.table.rows.length} previews` : `Preview ${src.table.rows.length} designs`}
      </button>
      {busy && <Progress {...busy} />}
      {items.length > 0 && (
        <div className="lm-wf-grid" data-testid="lm-wf-previews">
          {items.map((it) => (
            <button key={it.url} type="button" className="lm-wf-grid__item" onClick={() => setOpen(it)} title={it.name}>
              <img src={it.url} alt={it.name} />
              <span>{it.name}</span>
            </button>
          ))}
        </div>
      )}
      {open && ReactDOM.createPortal(
        <div className="lm-wf-lightbox" role="dialog" aria-modal="true" aria-label={open.name} onClick={() => setOpen(null)}>
          <img src={open.url} alt={open.name} />
          <p>{open.name}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

function DownloadBody({ node, ctx }) {
  const src = sourceOf(ctx, node);
  const [busy, setBusy] = React.useState(null);
  const format = node.format || 'png';
  const scale = node.scale === 2 ? 2 : 1;
  const headers = src.table?.headers || [];
  const nameColumn = node.nameColumn && headers.includes(node.nameColumn)
    ? node.nameColumn
    : Object.values(src.design?.mapping || {})[0] || headers[0];
  const set = (patch) => ctx.setWf((cur) => updateNode(cur, node.id, patch));

  const run = async () => {
    if (src.error) return;
    const label = src.entry.label || baseName(src.entry.asset.path).replace(/\.[jt]sx?$/, '');
    const names = fileNamesFor(src.table.rows, headers, nameColumn, label);
    const { width, height } = designSize(src.entry);
    const total = src.table.rows.length;
    setBusy({ done: 0, total });
    try {
      if (format === 'pdf') {
        const pages = [];
        await renderAll(ctx, src, { format: 'jpg', pixelRatio: scale }, async (i, blob) => {
          pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), imageWidth: width * scale, imageHeight: height * scale, width, height });
          setBusy({ done: i + 1, total });
        });
        downloadBlob(new Blob([buildJpegPdf(pages)], { type: 'application/pdf' }), `${label}.pdf`);
      } else {
        const files = {};
        await renderAll(ctx, src, { format, pixelRatio: scale }, async (i, blob) => {
          files[`${names[i]}.${format}`] = new Uint8Array(await blob.arrayBuffer());
          setBusy({ done: i + 1, total });
        });
        downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `${label}.zip`);
      }
      ctx.setNotice(`Downloaded ${total} ${format === 'pdf' ? 'pages' : 'files'}`);
    } catch (err) {
      ctx.setNotice(`Couldn’t export: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <label className="lm-wf-field">
        <span>Save as</span>
        <select value={format} onChange={(e) => set({ format: e.target.value })} data-testid="lm-wf-format">
          {DOWNLOAD_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      <label className="lm-wf-field">
        <span>Quality</span>
        <select value={String(scale)} onChange={(e) => set({ scale: Number(e.target.value) })} data-testid="lm-wf-scale">
          <option value="1">Standard · {src.entry ? `${designSize(src.entry).width}px wide` : 'design size'}</option>
          <option value="2">High · 2× for print</option>
        </select>
      </label>
      {format !== 'pdf' && headers.length > 0 && (
        <label className="lm-wf-field">
          <span>Name files by</span>
          <select value={nameColumn} onChange={(e) => set({ nameColumn: e.target.value })}>
            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      )}
      {src.error ? (
        <p className="lm-wf-hint">{src.error}</p>
      ) : (
        <button type="button" className="lm-wf-run lm-wf-run--primary" onClick={run} disabled={!!busy} data-testid="lm-wf-run-download">
          {busy ? 'Exporting…' : `Download ${src.table.rows.length} ${format === 'pdf' ? 'as one PDF' : 'files'}`}
        </button>
      )}
      {busy && <Progress {...busy} />}
    </>
  );
}

export default WorkflowView;
