// map-edit-layer.jsx — edit a page map (`_index.mmd`) right on the canvas
// (spec-mermaid-diagrams.md, Phase 5).
//
// Every gesture rewrites the plain Mermaid file; the canvas then re-lays the
// page out from the file as usual, so hand edits and canvas edits never fight.
//   - Connect: drag a card's handle onto another card → `a --> b`.
//   - Arrow: click it → label, solid/dashed/thick, delete.
//   - Toolbar (on hover): flip direction, add a note box, open the file.
// No free drag-to-position: Mermaid owns the layout.

import React from 'react';
import { writeProjectFile } from '../../runtime/write-client.js';
import {
  EDGE_STYLES, addEdge, addNote, listEdges, mapDirection, removeEdge, toggleDirection, updateEdge,
} from '../../runtime/diagram-map.js';
import { inCliMode, reveal } from '../menu/index.js';
import { dcToast } from '../../design-canvas.jsx';

const ID_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const CTA = 'dc-section-cta'; // the viewport never starts a pan on these

const CSS_RULES = [
  '.dc-map-bg .lerret-hit{pointer-events:stroke;cursor:pointer}',
  '.lm-map-handle,.lm-map-bar{opacity:0;transition:opacity .12s}',
  '[data-dc-page-map]:hover .lm-map-handle,[data-dc-page-map]:hover .lm-map-bar,.lm-map-bar:focus-within,[data-map-dragging] .lm-map-handle{opacity:1}',
  '.lm-map-handle{position:absolute;width:14px;height:14px;padding:0;border-radius:50%;border:2px solid var(--lm-accent,#111);background:var(--lm-bg-primary,#fff);cursor:crosshair;transform:translate(-50%,-50%) scale(var(--lm-map-inv,1));z-index:4;box-shadow:0 1px 3px rgba(0,0,0,.18)}',
  '.lm-map-handle:hover{background:var(--lm-accent,#111)}',
  '.lm-map-pop,.lm-map-bar{position:absolute;z-index:5;display:flex;align-items:center;gap:4px;padding:4px;border-radius:10px;background:var(--lm-bg-primary,#fff);color:var(--lm-text-primary,#0A0A0A);box-shadow:0 4px 16px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;white-space:nowrap}',
  '.lm-map-pop{transform-origin:0 0;transform:scale(var(--lm-map-inv,1)) translate(-50%,10px)}',
  '.lm-map-bar{right:0;top:0;transform-origin:right bottom;transform:translateY(-100%) scale(var(--lm-map-inv,1)) translateY(-8px)}',
  '.lm-map-pop button,.lm-map-bar button{height:26px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
  '.lm-map-pop button:hover,.lm-map-bar button:hover{background:var(--lm-bg-secondary,#F4F4F5)}',
  '.lm-map-pop button[aria-pressed=true]{background:var(--lm-bg-secondary,#F4F4F5);font-weight:600}',
  '.lm-map-pop button.lm-danger{color:#DC2626}',
  '.lm-map-pop input,.lm-map-bar input{height:26px;width:150px;padding:0 8px;border:1px solid var(--lm-border,#E4E4E7);border-radius:7px;font:inherit;color:inherit;background:transparent;outline:none}',
  '.lm-map-pop input:focus,.lm-map-bar input:focus{border-color:var(--lm-accent,#111)}',
  '.lm-map-sep{width:1px;height:16px;background:var(--lm-border,#E4E4E7);margin:0 2px}',
].join('');

const DIR_LABEL = { LR: '→ Left to right', RL: '← Right to left', TB: '↓ Top to bottom', BT: '↑ Bottom to top' };

/** Where a card's connect handle sits: on the side the flow leaves from. */
function handlePoint(box, dir) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  if (dir === 'LR') return { x: box.left + box.width, y: cy };
  if (dir === 'RL') return { x: box.left, y: cy };
  if (dir === 'BT') return { x: cx, y: box.top };
  return { x: cx, y: box.top + box.height };
}

/**
 * @param {object} props
 * @param {string} props.sectionId  The folder the map arranges.
 * @param {{ text: string, path: string, width: number, height: number,
 *   positions: Record<string, { left: number, top: number, width: number, height: number }>,
 *   names: Record<string, string> }} props.layout
 */
export function MapEditLayer({ sectionId, layout }) {
  const rootRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [edge, setEdge] = React.useState(null); // { id, x, y }
  const [hover, setHover] = React.useState(null);
  const [drag, setDrag] = React.useState(null); // { from, x0, y0, x, y, target }
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [inv, setInv] = React.useState(1);
  const { text, path, positions } = layout;
  const dir = mapDirection(text);

  const edit = React.useCallback(async (fn) => {
    const next = fn(text);
    if (next == null) {
      dcToast('That line is written in a form the canvas can’t edit — open the file to change it.');
      return;
    }
    if (next === text) return;
    const res = await writeProjectFile(path, next);
    if (!res.ok) dcToast(`Couldn’t update the page map: ${res.error || 'unknown error'}`);
  }, [text, path]);

  // Map-local coordinates (the map's own px, before canvas zoom).
  const toLocal = React.useCallback((e) => {
    const r = rootRef.current.getBoundingClientRect();
    const s = r.width / layout.width || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s, s, r };
  }, [layout.width]);

  // Arrow clicks/hover — the hit paths live in the (pointer-transparent) SVG.
  React.useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return undefined;
    const hitOf = (e) => e.target instanceof Element && e.target.closest('.lerret-hit');
    const onClick = (e) => {
      const hit = hitOf(e);
      if (!hit) return;
      const p = toLocal(e);
      setNoteOpen(false);
      setEdge({ id: hit.getAttribute('data-edge'), x: p.x, y: p.y });
    };
    const onOver = (e) => {
      setHover(hitOf(e)?.getAttribute('data-edge') || null);
      // Controls keep a constant on-screen size at any zoom (the canvas
      // applies its zoom outside React, so measure when the pointer arrives).
      const r = rootRef.current.getBoundingClientRect();
      const next = Math.min(12, layout.width / (r.width || 1));
      setInv((v) => (Math.abs(v - next) / next > 0.01 ? next : v));
    };
    host.addEventListener('click', onClick);
    const onLeave = () => setHover(null);
    host.addEventListener('pointerover', onOver);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('click', onClick);
      host.removeEventListener('pointerover', onOver);
    };
  }, [toLocal, layout.width]);

  // Close the arrow editor on an outside press or Escape.
  React.useEffect(() => {
    if (!edge) return undefined;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || (e.target instanceof Element && e.target.closest('.lerret-hit'))) return;
      setEdge(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setEdge(null); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [edge]);

  /** Asset name of a card in THIS folder (placed or still in the row). */
  const nameOf = (slotId) => {
    if (layout.names[slotId]) return layout.names[slotId];
    if (slotId.slice(0, slotId.lastIndexOf('/')) !== sectionId) return null;
    const name = slotId.split('/').pop().replace(/\.[^.]+$/, '');
    return ID_SAFE.test(name) ? name : null;
  };

  const findTarget = (e, p, from) => {
    for (const [k, box] of Object.entries(positions)) {
      if (k !== from && p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height) {
        return { key: k, box };
      }
    }
    // A card of this folder that the map doesn't place yet (the normal row).
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dc-slot]');
    const key = slot?.getAttribute('data-dc-slot');
    if (!key || key === from || !nameOf(key)) return null;
    const b = slot.getBoundingClientRect();
    return { key, box: { left: (b.left - p.r.left) / p.s, top: (b.top - p.r.top) / p.s, width: b.width / p.s, height: b.height / p.s } };
  };

  const onHandleDown = (from, start) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setEdge(null);
    setDrag({ from, x0: start.x, y0: start.y, x: start.x, y: start.y, target: null });
  };
  const onHandleMove = (e) => {
    if (!drag) return;
    const p = toLocal(e);
    setDrag((d) => d && { ...d, x: p.x, y: p.y, target: findTarget(e, p, d.from) });
  };
  const onHandleUp = () => {
    const d = drag;
    setDrag(null);
    if (!d?.target) return;
    const a = nameOf(d.from);
    const b = nameOf(d.target.key);
    if (a && b) edit((t) => addEdge(t, a, b));
  };

  const lit = edge?.id || hover;
  const info = edge ? listEdges(text).find((x) => x.id === edge.id) : null;
  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s);

  return (
    <div ref={rootRef} data-map-dragging={drag ? '' : undefined}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', '--lm-map-inv': inv }}>
      <style>{CSS_RULES + (lit
        ? `.dc-map-bg path.flowchart-link[id$="-${esc(lit)}"]{stroke:var(--lm-accent,#111)!important;stroke-opacity:1!important}`
        : '')}</style>

      {Object.entries(positions).map(([k, box]) => {
        const p = handlePoint(box, dir);
        return (
          <button key={k} type="button" className={`lm-map-handle ${CTA}`}
            title="Drag to another card to connect" aria-label={`Connect ${nameOf(k) || k} to another card`}
            style={{ left: p.x, top: p.y, pointerEvents: 'auto' }}
            onPointerDown={onHandleDown(k, p)} onPointerMove={onHandleMove} onPointerUp={onHandleUp}
            onPointerCancel={() => setDrag(null)} />
        );
      })}

      {drag && (
        <svg width={layout.width} height={layout.height}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {drag.target && (
            <rect x={drag.target.box.left} y={drag.target.box.top} width={drag.target.box.width} height={drag.target.box.height}
              rx="12" fill="none" stroke="var(--lm-accent,#111)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )}
          <line x1={drag.x0} y1={drag.y0} x2={drag.x} y2={drag.y}
            stroke="var(--lm-accent,#111)" strokeWidth="2" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
        </svg>
      )}

      {edge && (
        <div ref={popRef} className={`lm-map-pop ${CTA}`} style={{ left: edge.x, top: edge.y, pointerEvents: 'auto' }}>
          {info ? (
            <>
              <input key={edge.id} autoFocus defaultValue={info.label} placeholder="Label" aria-label="Arrow label"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { edit((t) => updateEdge(t, edge.id, { label: e.currentTarget.value })); setEdge(null); }
                }}
                onBlur={(e) => { if (e.currentTarget.value.trim() !== info.label) edit((t) => updateEdge(t, edge.id, { label: e.currentTarget.value })); }} />
              <span className="lm-map-sep" />
              {Object.keys(EDGE_STYLES).map((s) => (
                <button key={s} type="button" aria-pressed={info.style === s}
                  onClick={() => edit((t) => updateEdge(t, edge.id, { style: s }))}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
              <span className="lm-map-sep" />
              <button type="button" className="lm-danger" onClick={() => { edit((t) => removeEdge(t, edge.id)); setEdge(null); }}>
                Delete
              </button>
            </>
          ) : (
            <>
              <span style={{ padding: '0 6px' }}>Edit this arrow in the file</span>
              {inCliMode() && <button type="button" onClick={() => reveal(path, 'editor')}>Open file</button>}
            </>
          )}
        </div>
      )}

      <div className={`lm-map-bar ${CTA}`} style={{ pointerEvents: 'auto' }}>
        <button type="button" aria-label={`Map direction: ${DIR_LABEL[dir].slice(2)}. Click to flip`} onClick={() => edit(toggleDirection)}>{DIR_LABEL[dir]}</button>
        {noteOpen ? (
          <input autoFocus placeholder="Note text, then Enter" aria-label="Note text"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const v = e.currentTarget.value; setNoteOpen(false); if (v.trim()) edit((t) => addNote(t, v)); }
              if (e.key === 'Escape') setNoteOpen(false);
            }}
            onBlur={() => setNoteOpen(false)} />
        ) : (
          <button type="button" onClick={() => { setEdge(null); setNoteOpen(true); }}>+ Note</button>
        )}
        {inCliMode() && <button type="button" onClick={() => reveal(path, 'editor')}>Edit file</button>}
      </div>
    </div>
  );
}

export default MapEditLayer;
