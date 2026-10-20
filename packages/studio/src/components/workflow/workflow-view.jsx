// workflow-view.jsx — the Workflow mode canvas: nodes + connections.
//
//   [Spreadsheet] ──▶ [Design] ──▶ [Preview] / [Download]
//
// • Click anywhere on the canvas (the cursor shows a ⊕) to add a step there:
//   upload a data file, one of the page's designs, or — once there is
//   something to finish — a Preview / Download. A new step connects to the
//   step before it when the types fit.
// • Drop an Excel (.xlsx) or CSV file anywhere to add a Spreadsheet node too.
// • Drag from a node's right dot to another node's left dot to connect.
// • The Design node maps text shown on the design to a column; Preview renders
//   every row; Download saves them as PNG/JPG files (ZIP) or one PDF.
//
// The graph saves per page to `.lerret/.workflows/<page>.json`.
//
// Motion: nodes and the view fade + scale in on mount (@starting-style,
// --lm-duration-base); the add menu grows from the click point (fast, ease
// out); dragging and wiring track the pointer 1:1 (no easing on direct
// manipulation). Reduced motion keeps only the fades.

import React from 'react';
import * as ReactDOM from 'react-dom';
import { zipSync } from 'fflate';

import { readProjectFile, writeProjectFile, listProjectDir } from '../../runtime/write-client.js';
import { readAssetData } from '../edit-mode/edit-session.js';
import { buildVarsStyle } from '../canvas/vars-injector.jsx';
import { useCascadedConfig } from '../canvas/cascade-context.jsx';
import { downloadBlob } from '../../export/app-store.js';
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
// Saved workflows keep a spreadsheet's rows only up to this size (the project
// write limit is 5 MB). A bigger sheet stays in memory for the session and is
// saved as its columns + first rows; after a reload it asks to be uploaded again.
const MAX_SAVED_TABLE_CHARS = 1_500_000;
const SAVED_SAMPLE_ROWS = 20;
// Preview renders this many rows at most; Download always renders them all.
const MAX_PREVIEW_ROWS = 60;

/** The workflow as saved: big spreadsheets trimmed to a sample. */
function persistable(wf) {
  return {
    ...wf,
    nodes: wf.nodes.map((n) => {
      if (n.type !== 'data' || !n.table || n.table.partial) return n;
      if (JSON.stringify(n.table.rows).length <= MAX_SAVED_TABLE_CHARS) return n;
      const { rows, ...rest } = n.table;
      return { ...n, table: { ...rest, rows: rows.slice(0, SAVED_SAMPLE_ROWS), rowCount: rows.length, partial: true } };
    }),
  };
}
const UPLOAD_INPUT_ID = 'lm-wf-upload-input';
// Offer every spreadsheet file so none is greyed out in the picker; ones we
// can't read get a clear "save it as…" message instead.
const SPREADSHEET_ACCEPT = '.xlsx,.xls,.csv,.tsv,.numbers,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
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
  // The surface's camera: offset in screen px + zoom. `viewRef` mirrors it
  // for listeners that outlive a render (wheel, drags).
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const viewRef = React.useRef(view);
  React.useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const [wire, setWire] = React.useState(null); // { from, x, y } while connecting
  const [notice, setNotice] = React.useState(null);
  const [dropping, setDropping] = React.useState(false);
  // The add menu: where it opened (px inside the surface) and the world point.
  const [menu, setMenu] = React.useState(null);
  const surfaceRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const uploadAt = React.useRef(null);
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
      if (!cancelled) setWf(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [savePath]);

  const firstSave = React.useRef(true);
  React.useEffect(() => {
    if (!wf) return undefined;
    if (firstSave.current) {
      firstSave.current = false;
      return undefined;
    }
    const t = setTimeout(() => {
      writeProjectFile(savePath, `${JSON.stringify(persistable(wf), null, 2)}\n`).then((r) => {
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

  React.useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // ── Adding nodes ──────────────────────────────────────────────────────────
  /** Screen point → surface (world) coordinates under the current camera. */
  const toWorld = (clientX, clientY) => {
    const r = surfaceRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.k, y: (clientY - r.top - v.y) / v.k };
  };
  /**
   * Add a node at a world point, connected to the step before it when the
   * types fit: a sheet feeds the newest design without an input; a design is
   * fed by the newest sheet; a finish step is fed by the newest design.
   */
  const addAt = (node) =>
    setWf((cur) => {
      let next = { ...cur, nodes: [...cur.nodes, node] };
      const newest = (type, ok = () => true) => [...cur.nodes].reverse().find((n) => n.type === type && ok(n));
      // Connected steps read left → right: a step dropped on top of the one it
      // connects to is nudged to that step's left (input) or right (output).
      const overlaps = (a) => node.x < a.x + NODE_W + 40 && node.x + NODE_W + 40 > a.x && Math.abs(node.y - a.y) < 240;
      const besides = (a, side) => (overlaps(a) ? { x: side === 'left' ? a.x - NODE_W - 80 : a.x + NODE_W + 80, y: a.y } : null);
      let moved = null;
      if (node.type === 'data') {
        const d = newest('design', (n) => !inputOf(cur, n.id));
        if (d) {
          next = connect(next, node.id, d.id);
          moved = besides(d, 'left');
        }
      } else if (node.type === 'design') {
        const sheet = newest('data');
        if (sheet) {
          next = connect(next, sheet.id, node.id);
          moved = besides(sheet, 'right');
        }
      } else {
        const d = newest('design');
        if (d) {
          next = connect(next, d.id, node.id);
          moved = besides(d, 'right');
        }
      }
      return moved ? updateNode(next, node.id, moved) : next;
    });
  /** Where a node added from the menu goes: its corner just above-left of the click. */
  const spot = (at) => ({ x: Math.round(at.x - 24), y: Math.round(at.y - 20) });

  const addDesign = (e, at) =>
    addAt({ id: newId('design'), type: 'design', ...spot(at), assetPath: e.asset.path, variant: e.variantName || 'default', mapping: {} });
  const addOutput = (type, at) =>
    addAt({ id: newId(type), type, ...spot(at), ...(type === 'download' ? { format: 'png' } : {}) });

  const addSheet = async (file, at) => {
    try {
      const table = await readSpreadsheet(file);
      addAt({ id: newId('data'), type: 'data', ...spot(at || toWorld(window.innerWidth / 2, window.innerHeight / 3)), table });
      setNotice(`Added ${table.name} · ${table.rows.length} rows`);
    } catch (err) {
      setNotice(err.message || String(err));
    }
  };

  /** Run a menu choice, then close the menu. */
  const choose = (fn) => {
    const at = menu.at;
    setMenu(null);
    fn(at);
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
    addSheet(file, toWorld(e.clientX, e.clientY));
  };

  // ── Panning + zooming the surface ─────────────────────────────────────────
  // Drag any empty spot (left or middle button) to pan; a left CLICK (no
  // drag) opens the add menu there, or closes it if it's open. Nodes,
  // connections, the menu and the zoom control keep their own handling.
  const onSurfaceDown = (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.target.closest?.('.lm-wf-node, .lm-wf-edge, .lm-wf-zoom, .lm-wf-menu')) return;
    e.preventDefault();
    const start = viewRef.current;
    const cx = e.clientX;
    const cy = e.clientY;
    let dragged = false;
    const move = (ev) => {
      if (!dragged && Math.hypot(ev.clientX - cx, ev.clientY - cy) < 4) return;
      dragged = true;
      setView((v) => ({ ...v, x: start.x + ev.clientX - cx, y: start.y + ev.clientY - cy }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (dragged || e.button !== 0) return;
      if (menu) {
        setMenu(null);
        return;
      }
      const r = surfaceRef.current.getBoundingClientRect();
      setMenu({ x: cx - r.left, y: cy - r.top, at: toWorld(cx, cy) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Zoom by `factor` keeping the surface point under (sx, sy) still. */
  const zoomAt = React.useCallback((factor, sx, sy) => {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      if (k === v.k) return v;
      const r = surfaceRef.current?.getBoundingClientRect();
      const px = sx ?? (r ? r.width / 2 : 0);
      const py = sy ?? (r ? r.height / 2 : 0);
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  }, []);

  /** Frame every node in the surface (never zooming past 100%). */
  const fitAll = React.useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const nodes = [...surface.querySelectorAll('.lm-wf-node')];
    if (nodes.length === 0) {
      setView({ x: 0, y: 0, k: 1 });
      return;
    }
    const v = viewRef.current;
    const sr = surface.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const x0 = (r.left - sr.left - v.x) / v.k;
      const y0 = (r.top - sr.top - v.y) / v.k;
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x0 + r.width / v.k);
      maxY = Math.max(maxY, y0 + r.height / v.k);
    }
    const pad = 60;
    const k = Math.min(1, Math.max(MIN_ZOOM, Math.min((sr.width - pad * 2) / (maxX - minX), (sr.height - pad * 2 - 80) / (maxY - minY))));
    setView({ k, x: (sr.width - (maxX - minX) * k) / 2 - minX * k, y: pad - minY * k });
  }, []);

  // Trackpad / wheel: two-finger scroll pans; pinch or Ctrl/⌘ + scroll zooms at
  // the pointer. Scrolling inside a node's own list (previews) stays native.
  const loaded = wf !== null;
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const onWheel = (e) => {
      const zooming = e.ctrlKey || e.metaKey;
      if (!zooming && e.target.closest?.('.lm-wf-grid, .lm-wf-map')) return;
      e.preventDefault();
      if (zooming) {
        const r = surface.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [zoomAt, loaded]);

  // ⌘/Ctrl + = / − zoom, ⌘/Ctrl + 0 fits everything.
  React.useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = document.activeElement;
      if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
      if (e.key === '=' || e.key === '+') zoomAt(1.2);
      else if (e.key === '-') zoomAt(1 / 1.2);
      else if (e.key === '0') fitAll();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomAt, fitAll]);

  // ── Wiring ────────────────────────────────────────────────────────────────
  const startWire = (fromId, e) => {
    e.preventDefault();
    e.stopPropagation();
    const at = (ev) => toWorld(ev.clientX, ev.clientY);
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
    const cx = e.clientX;
    const cy = e.clientY;
    const move = (ev) => {
      const k = viewRef.current.k;
      setWf((cur) => updateNode(cur, id, { x: Math.round(node.x + (ev.clientX - cx) / k), y: Math.round(node.y + (ev.clientY - cy) / k) }));
    };
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
      {/* Visually hidden, not display:none — the menu's label opens it natively. */}
      <input
        ref={fileRef}
        id={UPLOAD_INPUT_ID}
        type="file"
        accept={SPREADSHEET_ACCEPT}
        className="lm-wf-file"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) addSheet(f, uploadAt.current);
        }}
        data-testid="lm-wf-upload-input"
      />
      <div
        ref={surfaceRef}
        className={`lm-wf-surface${dropping ? ' lm-wf-surface--drop' : ''}`}
        onPointerDown={onSurfaceDown}
        onDragOver={onDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
        onDrop={onDrop}
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${22 * view.k}px ${22 * view.k}px` }}
      >
        {!wf ? (
          <p className="lm-wf-empty">Loading…</p>
        ) : (
          <div className="lm-wf-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
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
          </div>
        )}
        {wf && wf.nodes.length === 0 && !menu && (
          <div className="lm-wf-start" data-testid="lm-wf-start">
            <b>Click anywhere to add your first step</b>
            <span>Start with a data file (Excel or CSV) or one of this page’s designs.</span>
          </div>
        )}
        {menu && (
          <AddMenu
            menu={menu}
            designs={designs}
            canFinish={wf.nodes.length > 0}
            onUpload={() => {
              // The label opens the picker itself; close the menu after this
              // click so the label is still there when the browser acts on it.
              uploadAt.current = menu.at;
              setTimeout(() => setMenu(null), 0);
            }}
            onDesign={(d) => choose((at) => addDesign(d, at))}
            onFinish={(type) => choose((at) => addOutput(type, at))}
          />
        )}
        {dropping && <div className="lm-wf-dropzone">Drop to add a spreadsheet</div>}
        <div className="lm-wf-zoom" role="group" aria-label="Zoom" data-testid="lm-wf-zoom">
          <button type="button" onClick={() => zoomAt(1.2)} aria-label="Zoom in" title="Zoom in (⌘+)">+</button>
          <button type="button" className="lm-wf-zoom__pct" onClick={() => zoomAt(1 / view.k)} title="Reset to 100%" data-testid="lm-wf-zoom-pct">
            {Math.round(view.k * 100)}%
          </button>
          <button type="button" onClick={() => zoomAt(1 / 1.2)} aria-label="Zoom out" title="Zoom out (⌘−)">−</button>
          <button type="button" onClick={fitAll} aria-label="Fit everything" title="Fit everything (⌘0)">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      {notice && <div className="lm-wf-notice" role="status">{notice}</div>}
    </div>,
    document.body,
  );
}

/**
 * The add menu, opened where the canvas was clicked. Finish steps appear once
 * the workflow has something to finish.
 */
function AddMenu({ menu, designs, canFinish, onUpload, onDesign, onFinish }) {
  const ref = React.useRef(null);
  // Keep it on screen: flip left / up when the click is near an edge.
  const [pos, setPos] = React.useState({ left: menu.x, top: menu.y, origin: '0 0' });
  React.useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = menu.x + w > parent.clientWidth - 12;
    const flipY = menu.y + h > parent.clientHeight - 96;
    // Flip up near the bottom, but never past the top or under the dock.
    const top = flipY ? menu.y - h : menu.y;
    setPos({
      left: flipX ? Math.max(12, menu.x - w) : menu.x,
      top: Math.max(12, Math.min(top, parent.clientHeight - 96 - h)),
      origin: `${flipX ? '100%' : '0'} ${flipY ? '100%' : '0'}`,
    });
    el.querySelector('[role="menuitem"]')?.focus();
  }, [menu]);
  return (
    <div
      ref={ref}
      className="lm-wf-menu"
      role="menu"
      aria-label="Add a step"
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}
      data-testid="lm-wf-menu"
    >
      <label
        htmlFor={UPLOAD_INPUT_ID}
        role="menuitem"
        tabIndex={0}
        className="lm-wf-add"
        onClick={onUpload}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.currentTarget.click();
        }}
        data-testid="lm-wf-upload"
      >
        <span className="lm-wf-dot lm-wf-dot--data" />
        <span className="lm-wf-add__text">
          Upload data file…
          <em>Excel or CSV</em>
        </span>
      </label>
      <p className="lm-wf-menu__label">Designs on this page</p>
      {designs.length === 0 ? (
        <p className="lm-wf-hint lm-wf-menu__hint">No designs on this page yet.</p>
      ) : (
        // Only the designs scroll — Upload and Finish stay in view.
        <div className="lm-wf-menu__designs" data-testid="lm-wf-menu-designs">
          {designs.map((e) => (
            <button key={designKey(e)} type="button" role="menuitem" className="lm-wf-add" onClick={() => onDesign(e)} data-testid="lm-wf-add-design">
              <span className="lm-wf-dot lm-wf-dot--design" />
              {e.label || baseName(e.asset.path)}
            </button>
          ))}
        </div>
      )}
      {canFinish && (
        <>
          <p className="lm-wf-menu__label">Finish with</p>
          <button type="button" role="menuitem" className="lm-wf-add" onClick={() => onFinish('preview')} data-testid="lm-wf-add-preview">
            <span className="lm-wf-dot lm-wf-dot--out" /> Preview
          </button>
          <button type="button" role="menuitem" className="lm-wf-add" onClick={() => onFinish('download')} data-testid="lm-wf-add-download">
            <span className="lm-wf-dot lm-wf-dot--out" /> Download
          </button>
        </>
      )}
    </div>
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
        {node.type === 'data' && <DataBody node={node} ctx={ctx} />}
        {node.type === 'design' && <DesignBody node={node} ctx={ctx} />}
        {node.type === 'preview' && <PreviewBody node={node} ctx={ctx} />}
        {node.type === 'download' && <DownloadBody node={node} ctx={ctx} />}
      </div>
    </div>
  );
}

function DataBody({ node, ctx }) {
  const { table } = node;
  const fileRef = React.useRef(null);
  if (!table) return <p className="lm-wf-hint">No data.</p>;
  // Re-read a big sheet that was saved as a sample only.
  const reupload = async (file) => {
    try {
      const next = await readSpreadsheet(file);
      ctx.setWf((cur) => updateNode(cur, node.id, { table: next }));
      ctx.setNotice(`Loaded ${next.name} · ${next.rows.length} rows`);
    } catch (err) {
      ctx.setNotice(err.message || String(err));
    }
  };
  return (
    <>
      <p className="lm-wf-meta"><b>{table.name}</b> · {(table.partial ? table.rowCount : table.rows.length).toLocaleString()} rows</p>
      {table.partial && (
        <div className="lm-wf-partial" data-testid="lm-wf-partial">
          <p className="lm-wf-hint">Large files aren’t kept after a reload — upload it again to use all its rows.</p>
          <button type="button" className="lm-wf-run" onClick={() => fileRef.current?.click()}>Upload again…</button>
          <input
            ref={fileRef}
            type="file"
            accept={SPREADSHEET_ACCEPT}
            className="lm-wf-file"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) reupload(f);
            }}
          />
        </div>
      )}
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
  if (sheet.table.partial) return { error: `Upload ${sheet.table.name} again in the spreadsheet step — large files aren’t kept after a reload.` };
  if (!Object.keys(design.mapping || {}).length) return { error: 'In the design node, pick which text each column replaces.' };
  return { design, entry, table: sheet.table };
}

/** Render every row of a source (or the first `limit`); `onRow(i, blob)` after each. */
async function renderAll(ctx, src, { format, pixelRatio, limit = Infinity }, onRow) {
  const { value } = await readAssetData(src.entry.asset.path);
  const folder = src.entry.asset.path.slice(0, src.entry.asset.path.lastIndexOf('/'));
  const design = {
    entry: src.entry,
    props: baseProps(src.entry, value),
    varsStyle: buildVarsStyle(ctx.getConfigFor(folder)?.vars, folder),
  };
  for (const [i, row] of src.table.rows.slice(0, limit).entries()) {
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
    const total = Math.min(src.table.rows.length, MAX_PREVIEW_ROWS);
    setBusy({ done: 0, total });
    try {
      await renderAll(ctx, src, { format: 'png', pixelRatio: Math.min(1, 640 / width), limit: MAX_PREVIEW_ROWS }, (i, blob) => {
        const url = URL.createObjectURL(blob);
        setItems((cur) => [...cur, { name: names[i], url }]);
        setBusy({ done: i + 1, total });
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
        {busy ? 'Rendering…' : items.length ? `Refresh ${items.length} previews` : `Preview ${Math.min(src.table.rows.length, MAX_PREVIEW_ROWS)} designs`}
      </button>
      {src.table.rows.length > MAX_PREVIEW_ROWS && (
        <p className="lm-wf-hint">Previews the first {MAX_PREVIEW_ROWS} of {src.table.rows.length.toLocaleString()} rows — Download makes them all.</p>
      )}
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
          {busy ? 'Exporting…' : `Download ${src.table.rows.length.toLocaleString()} ${format === 'pdf' ? 'as one PDF' : 'files'}`}
        </button>
      )}
      {busy && <Progress {...busy} />}
    </>
  );
}

export default WorkflowView;
