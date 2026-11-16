// map-edit-layer.jsx — edit a page map (`_index.mmd`) right on the canvas
// (spec-mermaid-diagrams.md, Phase 5).
//
// Every gesture rewrites the plain Mermaid file; the canvas then re-lays the
// page out from the file as usual, so hand edits and canvas edits never fight.
//   - Connect (`ConnectHandle`, on every card): drag its handle onto another
//     card of the same folder → `a --> b`. The first arrow creates the map.
//   - Arrow (`MapEditLayer`): click it → label, solid/dashed/thick, delete.
//   - Toolbar (on hover): flip direction, open the file.
// Notes are `.md` assets connected like any card — not text boxes in the map.
// No free drag-to-position: Mermaid owns the layout.

import React from 'react';
import { createPortal } from 'react-dom';
import { writeProjectFile } from '../../runtime/write-client.js';
import {
  EDGE_STYLES, PAGE_MAP_FILE, addEdge, firstPageMap, listEdges, mapDirection, removeEdge,
  toggleDirection, updateEdge,
} from '../../runtime/diagram-map.js';
import { inCliMode, reveal } from '../menu/index.js';
import { dcToast } from '../../design-canvas.jsx';

const ID_SAFE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const CTA = 'dc-section-cta'; // the viewport never starts a pan on these

const CSS_RULES = [
  '.dc-map-bg .lerret-hit{pointer-events:stroke;cursor:pointer}',
  '.lm-map-handle,.lm-map-bar{opacity:0;transition:opacity .12s}',
  '[data-dc-slot]:hover>.lm-map-handle,[data-dc-page-map]:hover .lm-map-bar,.lm-map-bar:focus-within,.lm-map-handle:focus-visible,.lm-map-handle[data-active]{opacity:1}',
  '.lm-map-handle{position:absolute;width:14px;height:14px;padding:0;border-radius:50%;border:2px solid var(--lm-accent,#111);background:var(--lm-bg-primary,#fff);cursor:crosshair;transform:translate(-50%,-50%) scale(var(--lm-map-inv,1));z-index:4;box-shadow:0 1px 3px rgba(0,0,0,.18)}',
  '.lm-map-handle:hover,.lm-map-handle[data-active]{background:var(--lm-accent,#111)}',
  '.lm-map-pop,.lm-map-bar{position:absolute;z-index:5;display:flex;align-items:center;gap:4px;padding:4px;border-radius:10px;background:var(--lm-bg-primary,#fff);color:var(--lm-text-primary,#0A0A0A);box-shadow:0 4px 16px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06);font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;white-space:nowrap}',
  '.lm-map-pop{transform-origin:0 0;transform:scale(var(--lm-map-inv,1)) translate(-50%,10px)}',
  '.lm-map-bar{right:0;top:0;transform-origin:right bottom;transform:translateY(-100%) scale(var(--lm-map-inv,1)) translateY(-8px)}',
  '.lm-map-pop button,.lm-map-bar button{height:26px;padding:0 9px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
  '.lm-map-pop button:hover,.lm-map-bar button:hover{background:var(--lm-bg-secondary,#F4F4F5)}',
  '.lm-map-pop button[aria-pressed=true]{background:var(--lm-bg-secondary,#F4F4F5);font-weight:600}',
  '.lm-map-pop button.lm-danger{color:#DC2626}',
  '.lm-map-pop input{height:26px;width:150px;padding:0 8px;border:1px solid var(--lm-border,#E4E4E7);border-radius:7px;font:inherit;color:inherit;background:transparent;outline:none}',
  '.lm-map-pop input:focus{border-color:var(--lm-accent,#111)}',
  '.lm-map-sep{width:1px;height:16px;background:var(--lm-border,#E4E4E7);margin:0 2px}',
].join('');

/** One shared stylesheet for every handle and map, added on first use. */
function useMapStyles() {
  React.useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById('lm-map-styles')) return;
    const el = document.createElement('style');
    el.id = 'lm-map-styles';
    el.textContent = CSS_RULES;
    document.head.appendChild(el);
  }, []);
}

const DIR_LABEL = { LR: '→ Left to right', RL: '← Right to left', TB: '↓ Top to bottom', BT: '↑ Bottom to top' };

/** Card side a handle sits on: where the flow leaves (the row reads left → right). */
const SIDE = {
  LR: { left: '100%', top: '50%' },
  RL: { left: 0, top: '50%' },
  TB: { left: '50%', top: '100%' },
  BT: { left: '50%', top: 0 },
};

async function writeMap(path, next) {
  const res = await writeProjectFile(path, next);
  if (!res.ok) dcToast(`Couldn’t update the page map: ${res.error || 'unknown error'}`);
}

/**
 * Asset name of a card in `sectionId` (its node id in the map), or null for
 * variants, the map itself, cards of other folders and names Mermaid can't use.
 *
 * @param {string} slotId  The card's slot id — its asset path.
 * @param {string} sectionId
 */
export function connectName(slotId, sectionId) {
  if (!slotId || slotId.slice(0, slotId.lastIndexOf('/')) !== sectionId) return null;
  const file = slotId.split('/').pop();
  if (file === PAGE_MAP_FILE) return null;
  const name = file.replace(/\.[^.]+$/, '');
  return ID_SAFE.test(name) ? name : null;
}

/**
 * The connect handle on one card. Drag it onto another card of the same
 * folder to add `this --> that` to the folder's `_index.mmd` — creating the
 * map on the first arrow. Lives inside the card's slot, so it is there whether
 * the card is placed by a map or still in the normal row.
 *
 * @param {object} props
 * @param {string} props.sectionId
 * @param {string} props.slotId
 * @param {{ text?: string, path: string } | null} props.map  The folder's map file, if any.
 * @param {'LR'|'RL'|'TB'|'BT'} [props.dir]  Side to sit on (map direction; row → LR).
 */
export function ConnectHandle({ sectionId, slotId, map, dir = 'LR' }) {
  const ref = React.useRef(null);
  const [inv, setInv] = React.useState(1);
  const [drag, setDrag] = React.useState(null); // { x0, y0, x, y, target: { key, rect } | null }
  const name = connectName(slotId, sectionId);
  useMapStyles();

  // Constant on-screen size at any zoom: measure the card when the pointer
  // arrives (the canvas applies its zoom outside React).
  React.useEffect(() => {
    const slot = ref.current?.parentElement;
    if (!slot) return undefined;
    const onEnter = () => {
      const w = slot.getBoundingClientRect().width;
      if (!w) return;
      const next = Math.min(12, slot.offsetWidth / w);
      setInv((v) => (Math.abs(v - next) / next > 0.01 ? next : v));
    };
    slot.addEventListener('pointerenter', onEnter);
    return () => slot.removeEventListener('pointerenter', onEnter);
  }, []);

  if (!name) return null;

  const targetAt = (e) => {
    const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-dc-slot]');
    const key = slot?.getAttribute('data-dc-slot');
    if (!key || key === slotId || !connectName(key, sectionId)) return null;
    return { key, rect: slot.getBoundingClientRect() };
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const x0 = r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    setDrag({ x0, y0, x: x0, y: y0, target: null });
  };
  const onMove = (e) => {
    if (!drag) return;
    setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, target: targetAt(e) });
  };
  const onUp = () => {
    const d = drag;
    setDrag(null);
    const to = d?.target && connectName(d.target.key, sectionId);
    if (!to) return;
    if (!map) {
      writeMap(`${sectionId}/${PAGE_MAP_FILE}`, firstPageMap(name, to));
    } else if (typeof map.text === 'string') {
      const next = addEdge(map.text, name, to);
      if (next !== map.text) writeMap(map.path, next);
    } else {
      dcToast('The page map couldn’t be read — open it to fix it first.');
    }
  };

  return (
    <>
      <button ref={ref} type="button" className={`lm-map-handle ${CTA}`}
        data-active={drag ? '' : undefined}
        title="Drag to another card to connect" aria-label={`Connect ${name} to another card`}
        style={{ ...SIDE[dir], '--lm-map-inv': inv }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)} onClick={(e) => e.stopPropagation()} />
      {drag && typeof document !== 'undefined' && createPortal(
        // Drawn in screen space (portaled out of the zoomed canvas).
        <svg style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 2147483000 }}>
          {drag.target && (
            <rect x={drag.target.rect.left - 3} y={drag.target.rect.top - 3}
              width={drag.target.rect.width + 6} height={drag.target.rect.height + 6}
              rx="10" fill="none" stroke="var(--lm-accent,#111)" strokeWidth="2" />
          )}
          <line x1={drag.x0} y1={drag.y0} x2={drag.x} y2={drag.y}
            stroke="var(--lm-accent,#111)" strokeWidth="2" strokeDasharray="6 4" strokeLinecap="round" />
          <circle cx={drag.x} cy={drag.y} r="4" fill="var(--lm-accent,#111)" />
        </svg>,
        document.body,
      )}
    </>
  );
}

/**
 * Arrow editing + toolbar over a laid-out map.
 *
 * @param {object} props
 * @param {{ text: string, path: string, width: number }} props.layout
 */
export function MapEditLayer({ layout }) {
  const rootRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [edge, setEdge] = React.useState(null); // { id, x, y }
  const [hover, setHover] = React.useState(null);
  const [inv, setInv] = React.useState(1);
  useMapStyles();
  const { text, path } = layout;
  const dir = mapDirection(text);

  const edit = React.useCallback((fn) => {
    const next = fn(text);
    if (next == null) {
      dcToast('That line is written in a form the canvas can’t edit — open the file to change it.');
      return;
    }
    if (next !== text) writeMap(path, next);
  }, [text, path]);

  // Map-local coordinates (the map's own px, before canvas zoom).
  const toLocal = React.useCallback((e) => {
    const r = rootRef.current.getBoundingClientRect();
    const s = r.width / layout.width || 1;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
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
      setEdge({ id: hit.getAttribute('data-edge'), x: p.x, y: p.y });
    };
    const onOver = (e) => {
      setHover(hitOf(e)?.getAttribute('data-edge') || null);
      const r = rootRef.current.getBoundingClientRect();
      const next = Math.min(12, layout.width / (r.width || 1));
      setInv((v) => (Math.abs(v - next) / next > 0.01 ? next : v));
    };
    const onLeave = () => setHover(null);
    host.addEventListener('click', onClick);
    host.addEventListener('pointerover', onOver);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('click', onClick);
      host.removeEventListener('pointerover', onOver);
      host.removeEventListener('pointerleave', onLeave);
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

  const lit = edge?.id || hover;
  const info = edge ? listEdges(text).find((x) => x.id === edge.id) : null;
  const esc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s);

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', '--lm-map-inv': inv }}>
      {lit && (
        <style>{`.dc-map-bg path.flowchart-link[id$="-${esc(lit)}"]{stroke:var(--lm-accent,#111)!important;stroke-opacity:1!important}`}</style>
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
        {inCliMode() && <button type="button" onClick={() => reveal(path, 'editor')}>Edit file</button>}
      </div>
    </div>
  );
}

export default MapEditLayer;
