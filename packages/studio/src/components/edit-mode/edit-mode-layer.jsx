// Visual Edit mode — the canvas overlay + Inspector (spec-visual-edit-mode.md).
//
// Mounted once by the StudioShell. Dormant until Edit mode is on; then:
//   • hover  → dashed outline on the element under the pointer
//   • click  → select it (outlined in the artboard you clicked) + share it
//              with the AI chip
//   • drag the selected element / arrow keys → move it (saved as CSS `translate`)
//   • dblclick on text → edit it in place
//   • the edit controls live in the dock (edit-dock.jsx)
// Every DOM element of a user asset carries `data-lerret-src="path:offset"`
// (stamped at compile time), which is how a click finds its source.

import React from 'react';
import { createPortal } from 'react-dom';

import './edit-mode.css';
import { useSelectionScope, fileScope } from '../../ai/selection-scope-context.jsx';
import {
  useEditMode,
  getEditState,
  selectElement,
  loadEngine,
  readSource,
  saveSourceEdit,
  saveStyles,
  saveDataEdit,
  undo,
  redo,
  showNotice,
} from './edit-session.js';

const ATTR = 'data-lerret-src';
export const SAVE_DELAY_MS = 300;
const DRAG_THRESHOLD_PX = 3;

// React's unitless style keys we expose — every other number means px.
const UNITLESS = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink']);

export const WEIGHTS = [
  ['', '—'], ['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'],
  ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'],
];
// Keys the grouped sections render; anything else literal shows under "More".
export const GROUPED = new Set([
  'color', 'background', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textAlign', 'opacity', 'borderRadius', 'width', 'height', 'padding', 'margin', 'gap', 'translate',
]);
export const EDITABLE_ATTRS = ['src', 'alt', 'href', 'title'];

// ── DOM helpers ─────────────────────────────────────────────────────────────

function parseStamp(value) {
  const m = /^(.*):(\d+)$/.exec(value || '');
  return m ? { path: m[1], offset: Number(m[2]) } : null;
}

/** The stamped element an event target belongs to, if it's inside an artboard. */
function stampedTarget(target) {
  if (!target || typeof target.closest !== 'function') return null;
  if (target.closest('.dc-labelrow, [data-edit-ui]')) return null;
  const el = target.closest(`[${ATTR}]`);
  return el && el.closest('[data-dc-asset-path]') ? el : null;
}

export const slotOf = (el) => el.closest('[data-dc-slot]')?.getAttribute('data-dc-slot') || '';

/** Every rendered instance of a source element (all artboards / variants). */
export function nodesFor(stamp) {
  if (!stamp) return [];
  const sel = `[${ATTR}="${CSS.escape(stamp)}"]`;
  return [...document.querySelectorAll(sel)].filter((n) => n.closest('[data-dc-asset-path]'));
}

/** The instances inside the artboard the user actually clicked. */
export function selectedNodes(sel) {
  return sel ? nodesFor(sel.stamp).filter((n) => slotOf(n) === sel.slot) : [];
}

export function selectionFrom(el) {
  const stamp = el.getAttribute(ATTR);
  const slot = slotOf(el);
  return {
    stamp,
    ...parseStamp(stamp),
    tag: el.tagName.toLowerCase(),
    assetPath: el.closest('[data-dc-asset-path]').getAttribute('data-dc-asset-path'),
    slot,
    variant: /#([^#/]+)$/.exec(slot)?.[1] || 'default',
  };
}

const lerretRel = (p) => {
  const i = p.lastIndexOf('/.lerret/');
  return i === -1 ? p.replace(/^\/+/, '') : p.slice(i + '/.lerret/'.length);
};

export function isTyping() {
  const ae = document.activeElement;
  return !!ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName));
}

export function cssValue(key, v) {
  return typeof v === 'number' && !UNITLESS.has(key) ? `${v}px` : String(v ?? '');
}

export function toHex(color) {
  if (/^#[0-9a-f]{6}$/i.test(color || '')) return color;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color || '');
  return m ? '#' + m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
}

export const isTransparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

/** Typed input → the value written to source: pure numbers stay numbers. */
export function parseStyleInput(raw, original) {
  const s = String(raw).trim();
  if (s === '') return undefined; // remove the key
  if (/^-?\d+(\.\d+)?$/.test(s) && (original === undefined || typeof original === 'number')) return Number(s);
  return s;
}

export function parsePropInput(raw, sample) {
  if (typeof sample === 'boolean') return Boolean(raw);
  if (typeof sample === 'number' && /^-?\d+(\.\d+)?$/.test(String(raw).trim())) return Number(raw);
  return raw;
}

export const humanize = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

// ── Moving (CSS `translate`) ────────────────────────────────────────────────
// Moving writes the CSS `translate` property (`translate: '12px -8px'`). It
// never touches layout keys or an existing `transform` (rotate/scale stay
// intact), and it's one style key — so undo, the Inspector's X/Y fields and
// "Reset" all fall out of the normal style edit path.

/** `'12px -8px'` / `'12px'` / `'none'` → [x, y] in px, or null if not plain px. */
export function parseTranslate(value) {
  if (!value || value === 'none') return [0, 0];
  const m = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/.exec(String(value).trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : null;
}

export const formatTranslate = (x, y) => (Math.round(x) === 0 && Math.round(y) === 0
  ? undefined
  : `${Math.round(x)}px ${Math.round(y)}px`);

/** Canvas zoom as seen by this element (screen px per CSS px). */
function scaleOf(el) {
  return el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1;
}

/** An artboard's outermost element fills it — moving it only leaves a gap. */
export function isArtboardRoot(el) {
  const parent = el.parentElement?.closest(`[${ATTR}]`);
  return !parent || slotOf(parent) !== slotOf(el);
}

function previewTranslate(stamp, value) {
  for (const n of nodesFor(stamp)) n.style.translate = value ?? '';
}

/** Absolutely-positioned with plain px left/top — moved by rewriting left/top. */
export function absoluteBox(el) {
  const cs = getComputedStyle(el);
  if (cs.position !== 'absolute') return null;
  const left = parseFloat(el.style.left);
  const top = parseFloat(el.style.top);
  return Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null;
}

/**
 * Save a move; on a refused/failed save put the previous position back. An
 * absolutely-positioned element (Add-menu / template layers) gets clean
 * `left`/`top` values instead of an accumulating `translate`.
 */
async function commitMove(sel, value, previous, el) {
  const abs = el ? absoluteBox(el) : null;
  const delta = parseTranslate(value) || [0, 0];
  const prev = parseTranslate(previous || 'none') || [0, 0];
  if (abs && (delta[0] || delta[1] || prev[0] || prev[1])) {
    const left = Math.round(abs.left + delta[0]);
    const top = Math.round(abs.top + delta[1]);
    for (const n of nodesFor(sel.stamp)) {
      n.style.translate = '';
      n.style.left = `${left}px`;
      n.style.top = `${top}px`;
    }
    const res = await saveStyles(sel.path, sel.offset, [
      { key: 'left', value: left },
      { key: 'top', value: top },
      { key: 'translate', value: undefined },
    ], sel.tag);
    if (!res.ok) {
      for (const n of nodesFor(sel.stamp)) {
        n.style.left = `${abs.left}px`;
        n.style.top = `${abs.top}px`;
      }
    }
    return res;
  }
  const res = await saveSourceEdit(sel.path, sel.offset, { type: 'style', key: 'translate', value, expectTag: sel.tag });
  if (!res.ok) previewTranslate(sel.stamp, previous);
  return res;
}

// ── Snapping + guides ───────────────────────────────────────────────────────

/** Screen px within which a moving element's center snaps to the artboard's. */
export const SNAP_PX = 6;

/**
 * Snap a drag so the element's center lands on the artboard's center line
 * when it is within {@link SNAP_PX}. Returns the adjusted delta and which axes
 * snapped (for the guides).
 *
 * @param {DOMRect} el    The element's rect at drag start.
 * @param {DOMRect} board The artboard card's rect.
 * @param {number} dx
 * @param {number} dy
 * @returns {{ dx: number, dy: number, x: boolean, y: boolean }}
 */
export function snapToCenter(el, board, dx, dy) {
  const cx = el.left + el.width / 2 + dx;
  const cy = el.top + el.height / 2 + dy;
  const bx = board.left + board.width / 2;
  const by = board.top + board.height / 2;
  const x = Math.abs(cx - bx) <= SNAP_PX;
  const y = Math.abs(cy - by) <= SNAP_PX;
  return { dx: x ? dx + (bx - cx) : dx, dy: y ? dy + (by - cy) : dy, x, y };
}

function createGuides() {
  const make = (axis) => {
    const d = document.createElement('div');
    d.className = `lm-edit-guide lm-edit-guide--${axis}`;
    d.style.display = 'none';
    document.body.appendChild(d);
    return d;
  };
  const v = make('v');
  const h = make('h');
  return {
    show(board, snap) {
      v.style.display = snap.x ? '' : 'none';
      h.style.display = snap.y ? '' : 'none';
      Object.assign(v.style, { left: `${board.left + board.width / 2}px`, top: `${board.top}px`, height: `${board.height}px` });
      Object.assign(h.style, { top: `${board.top + board.height / 2}px`, left: `${board.left}px`, width: `${board.width}px` });
    },
    remove() {
      v.remove();
      h.remove();
    },
  };
}

// ── Resizing ────────────────────────────────────────────────────────────────

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Elements whose shape should keep its proportions unless Shift is held. */
function keepsRatio(el) {
  return el.tagName === 'IMG' || el.getAttribute('data-lerret-role') === 'phone' || el.hasAttribute('data-image-slot')
    || getComputedStyle(el).borderRadius === '50%';
}

/** Text boxes grow by width only — their height follows the text. */
function isTextBox(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !el.style.height;
}

/**
 * The size/position after dragging handle `dir` by (dx, dy) artboard px.
 *
 * @param {{ x: number, y: number, w: number, h: number }} start
 * @param {string} dir   One of HANDLES.
 * @param {number} dx
 * @param {number} dy
 * @param {{ ratio: boolean, widthOnly: boolean }} opts
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function resizeBox(start, dir, dx, dy, { ratio = false, widthOnly = false } = {}) {
  let { x, y, w, h } = start;
  if (dir.includes('e')) w = start.w + dx;
  if (dir.includes('w')) w = start.w - dx;
  if (!widthOnly) {
    if (dir.includes('s')) h = start.h + dy;
    if (dir.includes('n')) h = start.h - dy;
  }
  w = Math.max(8, w);
  h = Math.max(8, h);
  if (ratio && !widthOnly && start.w > 0 && start.h > 0) {
    const r = start.w / start.h;
    if (dir === 'n' || dir === 's') w = h * r;
    else h = w / r;
  }
  if (dir.includes('w')) x = start.x + (start.w - w);
  if (dir.includes('n')) y = start.y + (start.h - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function startResize(e, dir, sel) {
  const el = selectedNodes(sel)[0];
  if (!el || isArtboardRoot(el)) return;
  e.preventDefault();
  e.stopPropagation();
  const scale = scaleOf(el);
  const abs = absoluteBox(el);
  const t0 = parseTranslate(el.style.translate || getComputedStyle(el).translate) || [0, 0];
  const start = {
    x: abs ? abs.left : t0[0],
    y: abs ? abs.top : t0[1],
    w: el.offsetWidth,
    h: el.offsetHeight,
  };
  const widthOnly = isTextBox(el);
  const ratioDefault = keepsRatio(el);
  const x0 = e.clientX;
  const y0 = e.clientY;
  let box = start;
  const apply = (b) => {
    for (const n of nodesFor(sel.stamp)) {
      n.style.width = `${b.w}px`;
      if (!widthOnly) n.style.height = `${b.h}px`;
      if (abs) {
        n.style.left = `${b.x}px`;
        n.style.top = `${b.y}px`;
      } else {
        n.style.translate = formatTranslate(b.x, b.y) ?? '';
      }
    }
  };
  const move = (ev) => {
    box = resizeBox(start, dir, (ev.clientX - x0) / scale, (ev.clientY - y0) / scale, {
      ratio: ev.shiftKey ? !ratioDefault : ratioDefault,
      widthOnly,
    });
    apply(box);
  };
  const up = async () => {
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    if (box === start) return;
    const changes = [{ key: 'width', value: box.w }];
    if (!widthOnly) changes.push({ key: 'height', value: box.h });
    if (abs) changes.push({ key: 'left', value: box.x }, { key: 'top', value: box.y });
    else if (box.x !== start.x || box.y !== start.y) changes.push({ key: 'translate', value: formatTranslate(box.x, box.y) });
    const res = await saveStyles(sel.path, sel.offset, changes, sel.tag);
    if (!res.ok) apply(start);
  };
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
}

/** Delete the selected element from the source (undoable with ⌘Z). */
export async function deleteElement(sel) {
  const res = await saveSourceEdit(sel.path, sel.offset, { type: 'remove', expectTag: sel.tag });
  if (res.ok) {
    selectElement(null);
    showNotice('Deleted — ⌘Z to undo');
  }
  return res;
}

// ── Layer ───────────────────────────────────────────────────────────────────

export function EditModeLayer() {
  const { enabled } = useEditMode();
  const { setScope } = useSelectionScope();
  const boxesRef = React.useRef(null);
  const hoverRef = React.useRef(null);
  const nudgeRef = React.useRef(null);

  // `E` toggles Edit mode anywhere; the rest only while it is on.
  React.useEffect(() => {
    const onKey = (e) => {
      if (isTyping()) return;
      // A dialog owns the keyboard while it is open (New asset, confirms, …).
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const { selection: sel } = getEditState();
      if (e.key === 'Escape') {
        if (sel) selectElement(null);
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (sel && !mod && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteElement(sel);
      } else if (sel && !mod && e.key.startsWith('Arrow')) {
        // Nudge: 1px, Shift = 10px. Saves once the keys go quiet.
        const node = selectedNodes(sel)[0];
        if (!node || isArtboardRoot(node)) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const n = nudgeRef.current?.stamp === sel.stamp ? nudgeRef.current : null;
        const start = n ? n.start : node.style.translate || getComputedStyle(node).translate;
        const base = parseTranslate(n ? n.value : start);
        if (!base) return showNotice('Its position is set by code.');
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const value = formatTranslate(base[0] + dx, base[1] + dy);
        previewTranslate(sel.stamp, value);
        clearTimeout(n?.timer);
        nudgeRef.current = {
          stamp: sel.stamp,
          start,
          value,
          timer: setTimeout(() => {
            nudgeRef.current = null;
            commitMove(sel, value, start === 'none' ? '' : start, node);
          }, SAVE_DELAY_MS),
        };
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Pointer capture: runs before the canvas and the asset's own handlers, so
  // a click in Edit mode selects instead of pressing the asset's buttons, and
  // dragging the selected element moves it instead of panning the canvas.
  React.useEffect(() => {
    if (!enabled) return undefined;
    let swallowClick = false;

    const onMove = (e) => {
      hoverRef.current = stampedTarget(e.target);
    };

    // Where the last press started — a click that ends a canvas pan isn't a
    // "click on empty canvas" and must not clear the selection.
    let downAt = null;

    const onDown = (e) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      const sel = getEditState().selection;
      const el = stampedTarget(e.target);
      if (!sel || !el || el.isContentEditable) return;
      if (el.getAttribute(ATTR) !== sel.stamp || slotOf(el) !== sel.slot) return;
      e.stopPropagation(); // keep the canvas from panning
      e.preventDefault(); // no text selection while dragging
      const start = el.style.translate || getComputedStyle(el).translate;
      const base = parseTranslate(start);
      const scale = scaleOf(el);
      const x0 = e.clientX;
      const y0 = e.clientY;
      const rect0 = el.getBoundingClientRect();
      const board = el.closest('.dc-card')?.getBoundingClientRect();
      let guides = null;
      let dragging = false;
      let value;
      const move = (ev) => {
        let dx = ev.clientX - x0;
        let dy = ev.clientY - y0;
        if (!dragging) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          if (isArtboardRoot(el)) return showNotice('Select an element inside the artboard to move it.');
          if (!base) return showNotice('Its position is set by code.');
          dragging = true;
        }
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (board) {
          // Snap to the artboard's center lines (hold Alt to place freely).
          const snap = ev.altKey ? { dx, dy, x: false, y: false } : snapToCenter(rect0, board, dx, dy);
          dx = snap.dx;
          dy = snap.dy;
          guides = guides || createGuides();
          guides.show(board, snap);
        }
        value = formatTranslate(base[0] + dx / scale, base[1] + dy / scale);
        previewTranslate(sel.stamp, value);
      };
      const up = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        guides?.remove();
        if (!dragging) return;
        swallowClick = true; // the click that ends a drag isn't a selection
        commitMove(sel, value, start === 'none' ? '' : start, el);
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    };

    const onClick = (e) => {
      const el = stampedTarget(e.target);
      if (!el) {
        // A plain click on empty canvas (not a pan, not chrome) clears the selection.
        const t = e.target;
        const still = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < DRAG_THRESHOLD_PX;
        if (
          still &&
          t && typeof t.closest === 'function' &&
          t.closest('.design-canvas') &&
          !t.closest('[data-dc-slot], button, a, input, select, textarea, [role="menu"], .dc-section-tag')
        ) {
          selectElement(null);
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (swallowClick) {
        swallowClick = false;
        return;
      }
      if (el.isContentEditable) return;
      const sel = selectionFrom(el);
      selectElement(sel);
      const text = String(el.textContent ?? '').replace(/\s+/g, ' ').trim();
      const frameEl = el.closest('[data-dc-asset-path]');
      setScope(
        fileScope(sel.assetPath, undefined, text.length <= 120 ? { text, tag: sel.tag } : undefined, {
          variant: frameEl?.getAttribute('data-dc-variant') || undefined,
          slotId: frameEl?.getAttribute('data-dc-slot') || undefined,
        }),
      );
    };

    const onDbl = (e) => {
      const el = stampedTarget(e.target);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      startInlineTextEdit(el, selectionFrom(el));
    };

    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDbl, true);
    return () => {
      hoverRef.current = null;
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onDbl, true);
    };
  }, [enabled, setScope]);

  // Outlines follow pan/zoom/reloads: redraw each frame, touch the DOM only on change.
  React.useEffect(() => {
    if (!enabled) return undefined;
    let raf = 0;
    let lastKey = '';
    let marked = [];
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const selNodes = selectedNodes(getEditState().selection);
      const hov = hoverRef.current && !selNodes.includes(hoverRef.current) && hoverRef.current.isConnected
        ? [hoverRef.current] : [];
      const boxes = [
        ...selNodes.map((n) => ['sel', n.getBoundingClientRect()]),
        ...hov.map((n) => ['hov', n.getBoundingClientRect()]),
      ];
      const key = boxes.map(([k, r]) => `${k}${r.x | 0},${r.y | 0},${r.width | 0},${r.height | 0}`).join(';');
      if (key === lastKey || !boxesRef.current) return;
      lastKey = key;
      // The selected element shows a move cursor.
      marked.forEach((n) => n.removeAttribute('data-lm-edit-sel'));
      selNodes.forEach((n) => n.setAttribute('data-lm-edit-sel', ''));
      marked = selNodes;
      const sel = getEditState().selection;
      const resizable = selNodes.length > 0 && !isArtboardRoot(selNodes[0]);
      const widthOnly = resizable && isTextBox(selNodes[0]);
      boxesRef.current.replaceChildren(...boxes.map(([k, r], i) => {
        const d = document.createElement('div');
        d.className = `lm-edit-box lm-edit-box--${k}`;
        Object.assign(d.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
        // Resize handles on the clicked instance of the selection.
        if (k === 'sel' && i === 0 && resizable) {
          for (const dir of widthOnly ? ['e', 'w'] : HANDLES) {
            const h = document.createElement('div');
            h.className = `lm-edit-handle lm-edit-handle--${dir}`;
            h.setAttribute('data-edit-ui', '');
            h.addEventListener('pointerdown', (ev) => startResize(ev, dir, sel));
            d.appendChild(h);
          }
        }
        return d;
      }));
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      marked.forEach((n) => n.removeAttribute('data-lm-edit-sel'));
    };
  }, [enabled]);

  if (!enabled) return null;
  return createPortal(
    <div ref={boxesRef} aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }} />,
    document.body,
  );
}

// ── Inline text edit (double-click) ─────────────────────────────────────────

async function startInlineTextEdit(el, sel) {
  const info = await inspect(sel);
  if (!info) return;
  const target = textTarget(info, sel);
  if (!target) {
    showNotice(info.text.kind === 'none' ? 'This element has no text.' : 'This text is set by code — see Props or edit the file.');
    return;
  }
  const original = el.textContent;
  let cancelled = false;
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    } else if (e.key === 'Escape') {
      cancelled = true;
      el.blur();
    }
  };
  const onBlur = () => {
    el.removeEventListener('keydown', onKey);
    el.removeAttribute('contenteditable');
    const value = el.textContent;
    if (cancelled || value === original) {
      el.textContent = original;
      return;
    }
    commitText(sel, target, value);
  };
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur, { once: true });
}

export async function inspect(sel) {
  const [{ inspectElement }, read] = await Promise.all([loadEngine(), readSource(sel.path)]);
  if (!read.ok) return null;
  const info = inspectElement(read.source, sel.offset, sel.path);
  return info.ok ? info : null;
}

/**
 * Where a text edit goes: the JSX itself, or a data-file prop — `{title}`, or
 * an expression reading exactly one prop like `{name || 'Your name'}`.
 * Returns null when the text is code we can't safely retarget.
 */
export function textTarget(info, sel) {
  if (info.text.kind === 'literal') return { kind: 'source' };
  const sameFile = lerretRel(sel.path) === lerretRel(sel.assetPath);
  if (!sameFile || !info.component) return null;
  const isProp = (n) => Object.prototype.hasOwnProperty.call(info.component.props, n);
  if (info.text.kind === 'identifier' && isProp(info.text.name)) return { kind: 'prop', name: info.text.name };
  if (info.text.kind === 'expression') {
    const used = info.text.identifiers.filter(isProp);
    if (used.length === 1) return { kind: 'prop', name: used[0] };
  }
  return null;
}

export function commitText(sel, target, value) {
  if (target.kind === 'prop') return saveDataEdit(sel.assetPath, sel.variant, target.name, value);
  return saveSourceEdit(sel.path, sel.offset, { type: 'text', value, expectTag: sel.tag });
}

/** Props this element reads (text + style/attr expressions) that the data file can set. */
export function referencedProps(info) {
  const names = new Set();
  const add = (v) => {
    if (!v) return;
    if (v.kind === 'identifier') names.add(v.name);
    if (v.kind === 'expression') v.identifiers.forEach((n) => names.add(n));
  };
  add(info.text);
  Object.values(info.style || {}).forEach(add);
  Object.values(info.attrs).forEach(add);
  return [...names].filter((n) => Object.prototype.hasOwnProperty.call(info.component.props, n));
}

