// brand-apply.js — use a brand library item on the current selection.
//
// Everything is applied LINKED: colours/fonts as `var(--brand-…, fallback)`,
// logos by their path in `_brand/` — so library edits flow to every design.

import { colorRef, fontRef, logoPathFrom } from '@lerret/core';

import { getEditState, saveStyles, placeImage, insertImagesIntoAsset } from '../edit-mode/edit-session.js';
import { selectedNodes, inspect } from '../edit-mode/edit-mode-layer.jsx';
import { kindOf, artboardOf } from '../edit-mode/edit-dock.jsx';
import { insertBoxFor } from '../canvas/image-drop.js';
import { getBrandState } from './brand-store.js';

const NOTHING = { ok: false, error: 'Select something on a design first, then click a brand item.' };
const folderOf = (p) => p.slice(0, p.lastIndexOf('/'));

/** What the selection is, plus the inspected source info. */
async function current() {
  const sel = getEditState().selection;
  if (!sel) return null;
  const node = selectedNodes(sel)[0];
  const info = await inspect(sel);
  if (!node || !info) return null;
  const isText = ['literal', 'identifier', 'expression'].includes(info.text?.kind);
  return { sel, node, info, kind: kindOf(node, isText) };
}

/** Text gets the colour as its text colour; anything else as its fill. */
export async function applyBrandColor(color) {
  const c = await current();
  if (!c) return NOTHING;
  if (c.kind === 'image') return { ok: false, error: 'Images can’t take a colour — select text, a shape or the background.' };
  const style = c.info.style || {};
  const key = c.kind === 'text' ? 'color' : 'backgroundColor' in style && !('background' in style) ? 'backgroundColor' : 'background';
  return saveStyles(c.sel.path, c.sel.offset, [{ key, value: colorRef(color) }], c.sel.tag);
}

export async function applyBrandFont(font) {
  const c = await current();
  if (!c) return NOTHING;
  if (c.kind !== 'text') return { ok: false, error: 'Select some text to change its font.' };
  return saveStyles(c.sel.path, c.sel.offset, [{ key: 'fontFamily', value: fontRef(font) }], c.sel.tag);
}

/**
 * Put a logo on the selection: an image or phone screen takes it in place;
 * otherwise it's added to the centre of the selected design.
 *
 * @param {{ file: string, name: string }} logo
 * @param {{ width: number, height: number }} natural  The logo's pixel size.
 */
export async function placeBrandLogo(logo, natural) {
  const sel = getEditState().selection;
  if (!sel) return NOTHING;
  const { lerretDir } = getBrandState();
  const node = selectedNodes(sel)[0];
  if (node && (node.tagName === 'IMG' || node.hasAttribute('data-image-slot'))) {
    return placeImage(sel.path, sel.offset, { file: logoPathFrom(folderOf(sel.path), lerretDir, logo.file) });
  }
  const board = artboardOf(sel);
  if (!board) return NOTHING;
  return insertImagesIntoAsset({
    path: board.path,
    offset: board.offset,
    images: [
      {
        file: logoPathFrom(folderOf(board.path), lerretDir, logo.file),
        alt: logo.name,
        ...insertBoxFor(natural, board, { x: board.width / 2, y: board.height / 2 }),
      },
    ],
  });
}

/** The drag payload type for a logo dragged from the Brand panel. */
export const LOGO_DRAG_TYPE = 'application/x-lerret-brand-logo';
