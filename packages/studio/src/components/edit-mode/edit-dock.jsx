// The editor's controls — built for people who design, not people who code.
//
//   • The dock, in Edit mode: Done · Add (text, image, shapes, phone frame) ·
//     Undo / Redo · save status.
//   • The Design panel (right side): what the selected thing is, in plain
//     words — Background, Text, Image, Screenshot, Phone, Shape — with only the
//     controls that kind of thing needs: fonts, colours and gradients, corners,
//     shadows, position and size, arrange. No tag names, file names or CSS.
//
// Every change previews instantly on the canvas and saves after a short pause
// through the edit session (undoable). The canvas side — select, drag to move,
// handles to resize, snap guides, double-click to type — is
// edit-mode-layer.jsx.
//
// Motion: the panel slides in from the right edge it lives on (spatial
// consistency, 220ms --lm-ease, translate + opacity) and only fades under
// prefers-reduced-motion; the Add menu grows from its button.

import React from 'react';
import { createPortal } from 'react-dom';

import { elementJsx, ELEMENTS } from '@lerret/core';

import '../forms/form-controls.css';
import './edit-mode.css';
import {
  useEditMode,
  toggleEditMode,
  setEditEnabled,
  selectElement,
  canSave,
  readAssetData,
  dataValueFor,
  saveSourceEdit,
  saveStyles,
  saveDataEdit,
  addElement,
  placeImage,
  insertImagesIntoAsset,
  undo,
  redo,
} from './edit-session.js';
import {
  SAVE_DELAY_MS,
  nodesFor,
  selectedNodes,
  slotOf,
  cssValue,
  toHex,
  isTransparent,
  parseStyleInput,
  parseTranslate,
  formatTranslate,
  isArtboardRoot,
  absoluteBox,
  inspect,
  textTarget,
  commitText,
  referencedProps,
  selectionFrom,
  deleteElement,
} from './edit-mode-layer.jsx';
import { CURATED_FONTS, matchCuratedFont, loadCuratedFonts } from '../../fonts/curated-fonts.js';
import { readImageFile, splitImageName, insertBoxFor, isImageFile } from '../canvas/image-drop.js';
import { listProjectDir } from '../../runtime/write-client.js';

loadCuratedFonts();

const SRC_ATTR = 'data-lerret-src';

// ── Dock entry point ────────────────────────────────────────────────────────

/**
 * The dock's Edit slot: a plain "Edit" button when off; Done · Add · history
 * when on, with the Design panel docked on the right.
 */
export function EditModeDock({ Button, Separator }) {
  const { enabled, selection } = useEditMode();
  if (!enabled) {
    return <Button label="Edit" icon="✎" onClick={toggleEditMode} title="Edit — click anything on a design to change it (E)" />;
  }
  return (
    <div className="lm-edock" data-edit-ui role="toolbar" aria-label="Edit">
      <Button label="Done" icon="✎" active onClick={() => setEditEnabled(false)} title="Finish editing (Esc)" />
      <Separator />
      <AddMenu selection={selection} />
      <Separator />
      <History />
      <DesignPanel selection={selection} />
    </div>
  );
}

function History() {
  const { status, error, canUndo, canRedo } = useEditMode();
  const label = status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved'
    : status === 'error' ? `Couldn’t save${error ? ` · ${error}` : ''}` : status === 'notice' ? error : '';
  return (
    <React.Fragment>
      <button type="button" className="lm-edock-btn lm-edock-icon" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">↶</button>
      <button type="button" className="lm-edock-btn lm-edock-icon" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
      {!canSave() ? (
        <span className="lm-edock-status lm-edock-status--warn" title="This studio can’t save files. Run `lerret dev` to save edits.">Preview only</span>
      ) : label ? (
        <span key={label} className={`lm-edock-status lm-edock-status--${status}`} role="status" title={label}>{label}</span>
      ) : null}
    </React.Fragment>
  );
}

// ── The selected artboard ───────────────────────────────────────────────────

/**
 * The artboard a selection lives in: its root element's source stamp and its
 * size, for adding things to it.
 *
 * @param {object | null} selection
 * @returns {{ slot: Element, root: Element, path: string, offset: number, width: number, height: number } | null}
 */
export function artboardOf(selection) {
  if (!selection) return null;
  const slot = [...document.querySelectorAll('[data-dc-slot]')].find((n) => n.getAttribute('data-dc-slot') === selection.slot);
  const root = slot?.querySelector(`.dc-card [${SRC_ATTR}]`);
  const m = /^(.*):(\d+)$/.exec(root?.getAttribute(SRC_ATTR) || '');
  if (!slot || !root || !m) return null;
  return {
    slot,
    root,
    path: m[1],
    offset: Number(m[2]),
    width: Number(slot.getAttribute('data-dc-w')) || root.offsetWidth,
    height: Number(slot.getAttribute('data-dc-h')) || root.offsetHeight,
  };
}

/** Wait for a newly-added top layer to render, then select it. */
function selectNewestChild(board, before) {
  const started = Date.now();
  const tick = () => {
    const fresh = artboardOf({ slot: board.slot.getAttribute('data-dc-slot') });
    const kids = fresh ? [...fresh.root.children].filter((n) => n.hasAttribute(SRC_ATTR)) : [];
    if (fresh && kids.length > before) {
      selectElement(selectionFrom(kids[kids.length - 1]));
      return;
    }
    if (Date.now() - started < 3000) setTimeout(tick, 120);
  };
  setTimeout(tick, 120);
}

// ── Add menu ────────────────────────────────────────────────────────────────

const ADD_ICONS = {
  text: 'M4 4h10M9 4v11',
  image: 'M3 4h12v10H3zM3 12l4-4 3 3 2-2 3 3',
  rectangle: 'M3.5 4.5h11v9h-11z',
  circle: 'M9 3.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z',
  phone: 'M6 2.5h6a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 14V4A1.5 1.5 0 0 1 6 2.5zM8 13.5h2',
};

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path d={ADD_ICONS[name] || ACTION_ICONS[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function AddMenu({ selection }) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const board = artboardOf(selection);

  const add = async (kind) => {
    setOpen(false);
    if (!board) return;
    if (kind === 'image') {
      fileRef.current?.click();
      return;
    }
    const before = [...board.root.children].filter((n) => n.hasAttribute(SRC_ATTR)).length;
    const res = await addElement(board.path, board.offset, elementJsx(kind, board));
    if (res.ok) selectNewestChild(board, before);
  };

  const onFile = async (e) => {
    const files = [...(e.target.files || [])].filter(isImageFile);
    e.target.value = '';
    if (!board || files.length === 0) return;
    const folder = board.path.slice(0, board.path.lastIndexOf('/'));
    const listing = await listProjectDir(folder);
    const taken = new Set((listing.entries || []).map((x) => String(x.name).toLowerCase()));
    const images = [];
    for (const [i, file] of files.entries()) {
      const { base, ext } = splitImageName(file.name);
      let name = base;
      for (let n = 2; taken.has(`${name}.${ext}`.toLowerCase()); n += 1) name = `${base}-${n}`;
      taken.add(`${name}.${ext}`.toLowerCase());
      const read = await readImageFile(file);
      images.push({
        file: `${name}.${ext}`,
        base64: read.base64,
        alt: name,
        ...insertBoxFor(read, board, { x: board.width / 2, y: board.height / 2 }, i),
      });
    }
    const before = [...board.root.children].filter((n) => n.hasAttribute(SRC_ATTR)).length;
    const res = await insertImagesIntoAsset({ path: board.path, offset: board.offset, images });
    if (res.ok) selectNewestChild(board, before);
  };

  return (
    <React.Fragment>
      <button
        ref={btnRef}
        type="button"
        className="lm-edock-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!board}
        title={board ? 'Add text, an image, a shape or a phone frame' : 'Click a design first, then add to it'}
        onClick={() => setOpen((o) => !o)}
        data-testid="lm-design-add"
      >
        + Add
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFile} data-testid="lm-design-add-file" />
      {open && (
        <Popover anchorRef={btnRef} onClose={() => setOpen(false)} width={200} label="Add">
          <div role="menu" className="lm-design-menu">
            {[{ id: 'text', label: 'Text' }, { id: 'image', label: 'Image…' }, ...ELEMENTS.filter((x) => x.id !== 'text')].map((item) => (
              <button key={item.id} type="button" role="menuitem" className="lm-design-menu__item" onClick={() => add(item.id)} data-testid={`lm-design-add-${item.id}`}>
                <Icon name={item.id} />
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </React.Fragment>
  );
}

/** A small popover above the dock, anchored to a button. */
function Popover({ anchorRef, onClose, width, label, children }) {
  const ref = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  React.useLayoutEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const dock = a.closest('[data-tour="dock"]') || a;
    const ar = a.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const left = Math.min(Math.max(ar.left + ar.width / 2 - width / 2, 12), window.innerWidth - width - 12);
    setPos({ left, bottom: window.innerHeight - dr.top + 8, originX: ar.left + ar.width / 2 - left });
  }, [anchorRef, width]);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose, anchorRef]);
  if (!pos) return null;
  return createPortal(
    <div ref={ref} className="lm-edit-pop" data-edit-ui aria-label={label} style={{ left: pos.left, bottom: pos.bottom, width, transformOrigin: `${pos.originX}px 100%` }}>
      {children}
    </div>,
    document.body,
  );
}

// ── Design panel ────────────────────────────────────────────────────────────

const ACTION_ICONS = {
  parent: 'M6 13V5h8M6 5l4-4M6 5l4 4',
  duplicate: 'M6 6h8v8H6zM3 11V3h8',
  delete: 'M3 5h12M7 5V3h4v2M5 5l1 10h6l1-10',
  front: 'M4 7h10v8H4zM7 3h8v8',
  back: 'M7 3h8v8H7zM4 7h10v8H4z',
};

/**
 * What the selected thing IS, in the user's words.
 *
 * @returns {'background' | 'text' | 'image' | 'screenshot' | 'phone' | 'shape'}
 */
export function kindOf(node, isText) {
  if (!node || isArtboardRoot(node)) return 'background';
  if (node.tagName === 'IMG') return 'image';
  if (node.hasAttribute('data-image-slot')) return 'screenshot';
  if (node.getAttribute('data-lerret-role') === 'phone') return 'phone';
  return isText ? 'text' : 'shape';
}

const KIND_TITLES = {
  background: 'Background',
  text: 'Text',
  image: 'Image',
  screenshot: 'Screenshot',
  phone: 'Phone frame',
  shape: 'Shape',
};

function DesignPanel({ selection }) {
  return createPortal(
    <aside className="lm-design-panel" data-edit-ui aria-label="Design" data-testid="lm-design-panel">
      {selection ? (
        <ElementPanel key={`${selection.stamp}|${selection.slot}`} selection={selection} />
      ) : (
        <div className="lm-design-empty">
          <h2>Design</h2>
          <p>Click anything on a design to change it.</p>
          <ul>
            <li>Double-click text to type</li>
            <li>Drag to move · pull the handles to resize</li>
            <li>Drop images from your computer onto a design</li>
            <li>Use <b>+ Add</b> for text, shapes or a phone frame</li>
          </ul>
        </div>
      )}
    </aside>,
    document.body,
  );
}

function ElementPanel({ selection }) {
  const ins = useInspector(selection);
  const { info, style, isText, first } = ins;
  const kind = kindOf(first, isText);
  const root = first ? isArtboardRoot(first) : true;
  const parent = first?.parentElement?.closest(`[${SRC_ATTR}]`);
  const hasParent = !!parent && slotOf(parent) === selection.slot && !isArtboardRoot(first);

  return (
    <div className="lm-design-body">
      <header className="lm-design-head">
        <h2>{KIND_TITLES[kind]}</h2>
        <span className="lm-design-head__actions">
          {hasParent && <PanelAction icon="parent" label="Select what it’s inside" onClick={() => selectElement(selectionFrom(parent))} />}
          {!root && (
            <PanelAction
              icon="duplicate"
              label="Duplicate"
              onClick={() => saveSourceEdit(selection.path, selection.offset, { type: 'duplicate', expectTag: selection.tag })}
            />
          )}
          {!root && <PanelAction icon="delete" label="Delete (⌫)" onClick={() => deleteElement(selection)} />}
        </span>
      </header>
      {ins.otherArtboards > 0 && (
        <p className="lm-edit-note">Changes here also show on {ins.otherArtboards === 1 ? '1 other design' : `${ins.otherArtboards} other designs`} that share this layout.</p>
      )}
      {!info ? (
        <p className="lm-edit-hint">{ins.loadError || 'Loading…'}</p>
      ) : style === null ? (
        <p className="lm-edit-hint">This part is built in a way the editor can’t change. Ask the AI, or edit the file.</p>
      ) : (
        <React.Fragment>
          {kind === 'text' && <TextSection ins={ins} selection={selection} />}
          {kind === 'image' && <ImageSection ins={ins} selection={selection} />}
          {kind === 'screenshot' && <ScreenshotSection selection={selection} hasImage={!!first?.querySelector('img')} />}
          {(kind === 'background' || kind === 'shape' || kind === 'phone') && (
            <Section title={kind === 'background' ? 'Fill' : 'Fill'}>
              <FillControl ins={ins} allowNone={kind !== 'background'} />
            </Section>
          )}
          {(kind === 'shape' || kind === 'phone' || kind === 'image' || kind === 'screenshot') && <CornersAndBorder ins={ins} kind={kind} />}
          {!root && <PositionSection ins={ins} />}
          {!root && <ArrangeSection ins={ins} selection={selection} />}
        </React.Fragment>
      )}
    </div>
  );
}

function PanelAction({ icon, label, onClick }) {
  return (
    <button type="button" className="lm-edock-btn lm-edock-icon" onClick={onClick} title={label} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}

// ── Sections ────────────────────────────────────────────────────────────────

const WEIGHT_OPTIONS = [
  ['300', 'Light'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'],
  ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black'],
];

function TextSection({ ins, selection }) {
  const { info, target, data, style, computed } = ins;
  const textValue = target?.kind === 'prop'
    ? String(dataValueFor(data, selection.variant, target.name) ?? ins.first?.textContent ?? '')
    : info.text.kind === 'literal' ? String(info.text.value) : '';
  const fontValue = style?.fontFamily?.kind === 'literal' ? style.fontFamily.value : computed?.fontFamily;
  const fontMatch = matchCuratedFont(fontValue);
  const weight = style?.fontWeight?.kind === 'literal' ? String(style.fontWeight.value) : String(computed?.fontWeight ?? '400');
  return (
    <Section title="Text">
      {target ? (
        <TextInput label="Text" multiline commitOnBlur value={textValue} onInput={ins.commitText} />
      ) : (
        <p className="lm-edit-hint">This text is filled in automatically — ask the AI to change how.</p>
      )}
      <Field label="Font">
        <select className="lm-input lm-select lm-edit-input" value={fontMatch || ''} onChange={(e) => ins.onStyle('fontFamily', e.target.value)} aria-label="Font">
          {!fontMatch && <option value="">Custom</option>}
          {CURATED_FONTS.map(([label, css]) => <option key={label} value={css} style={{ fontFamily: css }}>{label}</option>)}
        </select>
      </Field>
      <div className="lm-edit-grid">
        <NumberField ins={ins} k="fontSize" label="Size" />
        <Field label="Weight">
          <select className="lm-input lm-select lm-edit-input" value={WEIGHT_OPTIONS.some(([v]) => v === weight) ? weight : '400'} onChange={(e) => ins.onStyle('fontWeight', e.target.value)} aria-label="Weight">
            {WEIGHT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Colour"><ColorRow ins={ins} k="color" /></Field>
      <AlignControl value={style?.textAlign} fallback={computed?.textAlign} onInput={(v) => ins.onStyle('textAlign', v)} />
      <div className="lm-edit-grid">
        <NumberField ins={ins} k="lineHeight" label="Line" unitless step={0.05} />
        <NumberField ins={ins} k="letterSpacing" label="Letter" />
      </div>
    </Section>
  );
}

/** Pick an image file, then hand its bytes + a free name to `place`. */
function useImagePicker(selection, place) {
  const ref = React.useRef(null);
  const onChange = async (e) => {
    const file = [...(e.target.files || [])].find(isImageFile);
    e.target.value = '';
    if (!file) return;
    const folder = selection.path.slice(0, selection.path.lastIndexOf('/'));
    const listing = await listProjectDir(folder);
    const taken = new Set((listing.entries || []).map((x) => String(x.name).toLowerCase()));
    const { base, ext } = splitImageName(file.name);
    let name = base;
    for (let n = 2; taken.has(`${name}.${ext}`.toLowerCase()); n += 1) name = `${base}-${n}`;
    const read = await readImageFile(file);
    place({ file: `${name}.${ext}`, base64: read.base64 });
  };
  return {
    open: () => ref.current?.click(),
    input: <input ref={ref} type="file" accept="image/*" hidden onChange={onChange} />,
  };
}

function ImageSection({ ins, selection }) {
  const picker = useImagePicker(selection, (image) => placeImage(selection.path, selection.offset, image));
  const fit = ins.style?.objectFit?.kind === 'literal' ? ins.style.objectFit.value : ins.computed?.objectFit;
  return (
    <Section title="Image">
      <button type="button" className="lm-design-btn" onClick={picker.open}>Replace image…</button>
      {picker.input}
      <Segmented
        label="Fit"
        value={fit === 'cover' ? 'cover' : 'contain'}
        options={[['contain', 'Show all'], ['cover', 'Fill frame']]}
        onChange={(v) => ins.onStyle('objectFit', v)}
      />
    </Section>
  );
}

function ScreenshotSection({ selection, hasImage }) {
  const picker = useImagePicker(selection, (image) => placeImage(selection.path, selection.offset, image));
  return (
    <Section title="Screenshot">
      <p className="lm-edit-hint">{hasImage ? 'Swap in a different screen.' : 'Add a screenshot of your app — or drop one onto the phone.'}</p>
      <button type="button" className="lm-design-btn lm-design-btn--primary" onClick={picker.open}>{hasImage ? 'Replace screenshot…' : 'Add screenshot…'}</button>
      {picker.input}
    </Section>
  );
}

const SWATCHES = ['#FFFFFF', '#F5F5F7', '#D1D1D6', '#111111', '#2F5BFF', '#5856D6', '#FF2D55', '#FF9500', '#34C759', '#00C7BE'];
const GRADIENTS = [
  ['Mist', 'linear-gradient(180deg, #F5F5F7 0%, #E3E3E8 100%)'],
  ['Night', 'linear-gradient(160deg, #1C1C1E 0%, #000000 100%)'],
  ['Ocean', 'linear-gradient(160deg, #2F80ED 0%, #56CCF2 100%)'],
  ['Sunset', 'linear-gradient(160deg, #FF6A88 0%, #FF9A8B 100%)'],
  ['Grape', 'linear-gradient(160deg, #5B2EFF 0%, #B86BFF 100%)'],
  ['Mint', 'linear-gradient(160deg, #11998E 0%, #38EF7D 100%)'],
];

function FillControl({ ins, allowNone }) {
  const key = ins.bgKey;
  const current = ins.style?.[key]?.kind === 'literal' ? String(ins.style[key].value) : '';
  const set = (v) => {
    // A gradient only works as `background`; normalize to it.
    if (key === 'backgroundColor' && /gradient/.test(v)) {
      ins.onStyle('backgroundColor', '');
      ins.onStyle('background', v);
    } else ins.onStyle(key, v);
  };
  return (
    <div className="lm-design-fill">
      <div className="lm-design-swatches" role="radiogroup" aria-label="Colour">
        {allowNone && (
          <button type="button" role="radio" aria-checked={!current} className="lm-design-swatch lm-design-swatch--none" title="None" aria-label="None" onClick={() => ins.onStyle(key, '')} />
        )}
        {SWATCHES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={current.toUpperCase() === c} className="lm-design-swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => set(c)} />
        ))}
        <label className="lm-design-swatch lm-design-swatch--custom" title="Pick any colour">
          <input type="color" aria-label="Pick any colour" value={toHex(/gradient/.test(current) ? '' : current || ins.computed?.backgroundColor)} onChange={(e) => set(e.target.value)} />
        </label>
      </div>
      <div className="lm-design-gradients" role="radiogroup" aria-label="Gradient">
        {GRADIENTS.map(([name, g]) => (
          <button key={name} type="button" role="radio" aria-checked={current === g} className="lm-design-gradient" style={{ background: g }} title={name} aria-label={`${name} gradient`} onClick={() => set(g)} />
        ))}
      </div>
    </div>
  );
}

const SHADOWS = [
  ['none', 'None', undefined],
  ['soft', 'Soft', '0 12px 32px rgba(0, 0, 0, 0.12)'],
  ['strong', 'Strong', '0 40px 80px rgba(0, 0, 0, 0.22)'],
];

function CornersAndBorder({ ins, kind }) {
  const shadow = ins.style?.boxShadow?.kind === 'literal' ? ins.style.boxShadow.value : '';
  const shadowId = SHADOWS.find(([, , v]) => v === shadow)?.[0] || (shadow ? '' : 'none');
  return (
    <Section title="Shape">
      <NumberField ins={ins} k="borderRadius" label="Corners" />
      {kind !== 'screenshot' && (
        <Segmented
          label="Shadow"
          value={shadowId}
          options={SHADOWS.map(([id, label]) => [id, label])}
          onChange={(id) => ins.onStyle('boxShadow', SHADOWS.find(([x]) => x === id)?.[2] ?? '')}
        />
      )}
    </Section>
  );
}

function PositionSection({ ins }) {
  const { style, first } = ins;
  const abs = first ? absoluteBox(first) : null;
  const tr = style?.translate;
  const t = tr?.kind === 'literal' ? parseTranslate(tr.value) : tr ? null : [0, 0];
  const num = (k) => (style?.[k]?.kind === 'literal' && typeof style[k].value === 'number' ? style[k].value : null);
  const x = abs ? num('left') ?? abs.left : t?.[0];
  const y = abs ? num('top') ?? abs.top : t?.[1];
  const setXY = (nx, ny) => {
    if (abs) {
      ins.onStyle('left', String(Math.round(Number(nx) || 0)));
      ins.onStyle('top', String(Math.round(Number(ny) || 0)));
    } else {
      ins.onStyle('translate', formatTranslate(Number(nx) || 0, Number(ny) || 0) ?? '');
    }
  };
  return (
    <Section title="Position & size">
      <div className="lm-edit-grid">
        {x !== undefined && x !== null ? (
          <React.Fragment>
            <Field label="X"><TextInput value={String(Math.round(x))} onInput={(v) => setXY(v, y)} /></Field>
            <Field label="Y"><TextInput value={String(Math.round(y))} onInput={(v) => setXY(x, v)} /></Field>
          </React.Fragment>
        ) : null}
        <NumberField ins={ins} k="width" label="W" fallback={first?.offsetWidth} />
        <NumberField ins={ins} k="height" label="H" fallback={first?.offsetHeight} />
      </div>
      <OpacitySlider ins={ins} />
    </Section>
  );
}

function ArrangeSection({ ins, selection }) {
  const toFront = () => saveStyles(selection.path, selection.offset, [{ key: 'zIndex', value: 10 }], selection.tag);
  const toBack = async () => {
    // The element first (its offset is current), then the root: z-index -1
    // stays above the design's background because the root isolates stacking.
    // The root edit sits before the element — the session rebases the selection.
    const res = await saveStyles(selection.path, selection.offset, [{ key: 'zIndex', value: -1 }], selection.tag);
    const board = artboardOf(selection);
    if (res.ok && board) {
      const m = /^(.*):(\d+)$/.exec(board.root.getAttribute(SRC_ATTR));
      if (m) await saveStyles(m[1], Number(m[2]), [{ key: 'isolation', value: 'isolate' }], board.root.tagName.toLowerCase());
    }
  };
  return (
    <Section title="Arrange">
      <div className="lm-edit-grid">
        <button type="button" className="lm-design-btn" onClick={toFront}><Icon name="front" /> Bring to front</button>
        <button type="button" className="lm-design-btn" onClick={toBack}><Icon name="back" /> Send to back</button>
      </div>
    </Section>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

/** A number box bound to one style key (px unless `unitless`). */
function NumberField({ ins, k, label, unitless = false, step = 1, fallback }) {
  const v = ins.style?.[k];
  if (v && v.kind !== 'literal') {
    return <Field label={label}><span className="lm-edit-code" title="Set automatically">Auto</span></Field>;
  }
  const raw = v ? v.value : undefined;
  const shown = typeof raw === 'number' ? raw : raw !== undefined ? parseFloat(raw) : NaN;
  const computedPx = parseFloat(ins.computed?.[k]);
  const placeholder = Number.isFinite(fallback) ? String(Math.round(fallback))
    : Number.isFinite(computedPx) && !unitless ? String(Math.round(computedPx * 100) / 100) : '';
  return (
    <Field label={label}>
      <TextInput
        value={Number.isFinite(shown) ? String(shown) : ''}
        placeholder={placeholder}
        onInput={(val) => {
          const n = Number(val);
          ins.onStyle(k, val === '' ? '' : Number.isFinite(n) ? String(step < 1 || unitless ? n : Math.round(n)) : val);
        }}
      />
    </Field>
  );
}

function OpacitySlider({ ins }) {
  const v = ins.style?.opacity;
  const value = v?.kind === 'literal' ? Number(v.value) : 1;
  return (
    <label className="lm-design-slider">
      <span className="lm-edit-field__k">Opacity</span>
      <input type="range" min="0" max="100" value={Math.round((Number.isFinite(value) ? value : 1) * 100)} onChange={(e) => ins.onStyle('opacity', String(Number(e.target.value) / 100))} />
      <span className="lm-design-slider__v">{Math.round((Number.isFinite(value) ? value : 1) * 100)}%</span>
    </label>
  );
}

function ColorRow({ ins, k }) {
  const v = ins.style?.[k];
  const value = v?.kind === 'literal' ? String(v.value) : '';
  return <ColorInput value={value} fallback={ins.computed?.[k]} label="Colour" onInput={(c) => ins.onStyle(k, c)} />;
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="lm-design-seg-row">
      <span className="lm-edit-field__k">{label}</span>
      <div className="lm-edit-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} data-set={value === v || undefined} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * Everything about the selected element that isn't in the dock row. Reads the
 * source through the engine; writes via the session (debounced for styles).
 */
function useInspector(selection) {
  const { revision } = useEditMode();
  const [info, setInfo] = React.useState(null);
  const [data, setData] = React.useState({});
  const [loadError, setLoadError] = React.useState(null);
  const timers = React.useRef(new Map());
  const originals = React.useRef(new Map());
  const stamp = selection.stamp;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await inspect(selection);
        if (cancelled) return;
        setInfo(next);
        setLoadError(next ? null : 'Couldn’t read this element’s source');
        if (next?.component && referencedProps(next).length) {
          const d = (await readAssetData(selection.assetPath)).value;
          if (!cancelled) setData(d);
        }
      } catch {
        // Dev server gone (stopped, laptop slept) — say so instead of "Loading…" forever.
        if (!cancelled) setLoadError('Can’t reach the Lerret server — is `lerret dev` running?');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, revision]);

  // Flush pending saves when the selection changes or Edit mode closes.
  React.useEffect(() => () => {
    for (const [, t] of timers.current) {
      clearTimeout(t.id);
      t.run();
    }
    timers.current.clear();
  }, []);

  const all = nodesFor(stamp);
  const first = selectedNodes(selection)[0] || all[0];
  const computed = first ? getComputedStyle(first) : null;
  const style = info ? info.style : undefined;

  const preview = (key, value) => {
    for (const n of nodesFor(stamp)) {
      if (!originals.current.has(key)) originals.current.set(key, n.style[key]);
      n.style[key] = value === undefined ? '' : cssValue(key, value);
    }
  };
  // Success re-reads via `revision`; failure puts the previewed value back.
  const afterSave = (res, key) => {
    if (res.ok || !key) return originals.current.delete(key);
    if (!originals.current.has(key)) return undefined;
    for (const n of nodesFor(stamp)) n.style[key] = originals.current.get(key);
    return undefined;
  };
  const schedule = (key, run) => {
    const prev = timers.current.get(key);
    if (prev) clearTimeout(prev.id);
    const t = { run: () => { timers.current.delete(key); run(); } };
    t.id = setTimeout(t.run, SAVE_DELAY_MS);
    timers.current.set(key, t);
  };

  const onStyle = (key, raw) => {
    const original = style?.[key]?.kind === 'literal' ? style[key].value : undefined;
    const value = parseStyleInput(raw, original);
    preview(key, value);
    schedule(`style:${key}`, async () => {
      afterSave(await saveSourceEdit(selection.path, selection.offset,
        { type: 'style', key, value, expectTag: selection.tag }), key);
    });
  };
  const onAttr = async (name, value) => {
    afterSave(await saveSourceEdit(selection.path, selection.offset,
      { type: 'attr', name, value: value === '' ? undefined : value, expectTag: selection.tag }));
  };
  const onProp = (name, value) => {
    setData((d) => ({ ...d, ...(d[selection.variant] && typeof d[selection.variant] === 'object'
      ? { [selection.variant]: { ...d[selection.variant], [name]: value } }
      : { [name]: value }) }));
    schedule(`prop:${name}`, async () => {
      afterSave(await saveDataEdit(selection.assetPath, selection.variant, name, value));
    });
  };

  /** One style control; renders "Set in code" for values we must not rewrite. */
  const field = (key, label, { kind = 'text', compact = false } = {}) => {
    const v = style?.[key];
    if (v && v.kind !== 'literal') {
      return <Field key={key} label={label} compact={compact}><Code title={v.text || v.name} /></Field>;
    }
    const value = v ? String(v.value) : '';
    const shown = computed ? computed[key === 'background' ? 'backgroundColor' : key] : '';
    const onInput = (raw) => onStyle(key, raw);
    if (kind === 'swatch') {
      return <Swatch key={key} label={label} value={value} fallback={shown} onInput={onInput} />;
    }
    return (
      <Field key={key} label={label} compact={compact} kind={kind}>
        {kind === 'color' ? <ColorInput value={value} fallback={shown} label={label} onInput={onInput} />
          : kind === 'weight' ? <SelectInput value={value} options={WEIGHT_OPTIONS} onInput={onInput} />
            : <TextInput value={value} placeholder={shortPlaceholder(shown)} onInput={onInput} />}
      </Field>
    );
  };

  const kind = info?.text.kind;
  return {
    info,
    data,
    loadError,
    style,
    computed,
    first,
    otherArtboards: new Set(all.map(slotOf)).size - 1,
    isText: kind === 'literal' || kind === 'identifier' || kind === 'expression',
    bgKey: style && 'backgroundColor' in style && !('background' in style) ? 'backgroundColor' : 'background',
    target: info ? textTarget(info, selection) : null,
    field,
    onStyle,
    onAttr,
    onProp,
    commitText: (v) => commitText(selection, textTarget(info, selection), v).then((r) => afterSave(r)),
  };
}

/** Computed values make useful placeholders only when short ("24px", "normal"). */
function shortPlaceholder(v) {
  return v && v.length <= 12 && !/rgba?\(/.test(v) ? v : '';
}

// ── Small UI pieces ─────────────────────────────────────────────────────────

function Section({ title, action, children }) {
  return (
    <section className="lm-edit-section">
      <div className="lm-edit-section__head">
        <h3>{title}</h3>
        {action && <button type="button" className="lm-edit-link" onClick={action.onClick}>{action.label}</button>}
      </div>
      {children}
    </section>
  );
}

/** A filled well: muted label prefix + borderless input. */
function Field({ label, compact = false, kind, children }) {
  return (
    <label className={`lm-edit-field${compact ? ` lm-edit-field--compact${kind ? ` lm-edit-field--${kind}` : ''}` : ''}`}>
      <span className="lm-edit-field__k">{label}</span>
      {children}
    </label>
  );
}

function Code({ title, block = false }) {
  return (
    <span className={`lm-edit-code${block ? ' lm-edit-code--block' : ''}`} title={title ? `Set in code: ${title}` : 'Set in code'}>
      Set in code
    </span>
  );
}

/**
 * Text input that follows outside updates while unfocused. `onInput` fires on
 * every keystroke (styles: live preview + debounced save) or, with
 * `commitOnBlur`, once on blur / Enter (text, attrs, props).
 */
function TextInput({ value, onInput, placeholder, label, multiline = false, commitOnBlur = false }) {
  const [local, setLocal] = React.useState(value);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (document.activeElement !== ref.current) setLocal(value);
  }, [value]);
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Tag
      ref={ref}
      className="lm-input lm-edit-input"
      aria-label={label}
      value={local}
      placeholder={placeholder}
      rows={multiline ? 2 : undefined}
      onChange={(e) => {
        setLocal(e.target.value);
        if (!commitOnBlur) onInput(e.target.value);
      }}
      onBlur={() => {
        if (commitOnBlur && local !== value) onInput(local);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setLocal(value);
        }
      }}
    />
  );
}

function SelectInput({ value, onInput, options }) {
  const known = options.some(([v]) => v === value);
  return (
    <select className="lm-input lm-select lm-edit-input" value={value} onChange={(e) => onInput(e.target.value)}>
      {!known && <option value={value}>{value}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function useFollow(value) {
  const [local, setLocal] = React.useState(value);
  React.useEffect(() => setLocal(value), [value]);
  return [local, setLocal];
}

/** Swatch + hex field (popover). */
function ColorInput({ value, onInput, fallback, label }) {
  const [local, setLocal] = useFollow(value);
  const none = !local && isTransparent(fallback);
  const change = (v) => {
    setLocal(v);
    onInput(v);
  };
  return (
    <span className="lm-edit-color">
      <SwatchChip color={local || fallback} none={none} label={label} onChange={change} />
      <TextInput value={local} placeholder={none ? 'None' : toHex(fallback).toUpperCase()} onInput={change} />
    </span>
  );
}

/** Swatch-only color control (dock row). */
function Swatch({ value, onInput, fallback, label }) {
  const [local, setLocal] = useFollow(value);
  const none = !local && isTransparent(fallback);
  return (
    <span className="lm-edock-swatch" title={`${label}: ${local || (none ? 'none' : toHex(fallback).toUpperCase())}`}>
      <span className="lm-edock-swatch__k">{label}</span>
      <SwatchChip
        color={local || fallback}
        none={none}
        label={label}
        onChange={(v) => {
          setLocal(v);
          onInput(v);
        }}
      />
    </span>
  );
}

function SwatchChip({ color, none, label, onChange }) {
  return (
    <span className={`lm-edit-swatch${none ? ' lm-edit-swatch--none' : ''}`} style={none ? undefined : { background: color }}>
      <input type="color" aria-label={`${label} color`} value={toHex(color)} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

const ALIGN_ICONS = {
  left: 'M2 3h12M2 7h8M2 11h12M2 15h8',
  center: 'M2 3h12M4 7h8M2 11h12M4 15h8',
  right: 'M2 3h12M6 7h8M2 11h12M6 15h8',
};

function AlignControl({ value, fallback, onInput }) {
  if (value && value.kind !== 'literal') return <Field label="Align" compact><Code title={value.text || value.name} /></Field>;
  const current = value ? value.value : '';
  const active = current || (fallback === 'start' ? 'left' : fallback);
  return (
    <div className="lm-edit-seg" role="radiogroup" aria-label="Text align">
      {['left', 'center', 'right'].map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={active === v}
          aria-label={`Align ${v}`}
          title={`Align ${v}`}
          data-set={current === v || undefined}
          onClick={() => onInput(current === v ? '' : v)}
        >
          <svg width="14" height="14" viewBox="0 0 16 18" aria-hidden="true">
            <path d={ALIGN_ICONS[v]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      ))}
    </div>
  );
}
