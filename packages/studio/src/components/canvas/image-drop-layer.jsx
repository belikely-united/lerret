// image-drop-layer.jsx — drag image files from the desktop onto the canvas.
//
//   • Drop on the BACKGROUND (a page, or a group under the pointer) → each
//     image becomes a new asset in that folder, sized to the image.
//   • Drop on an ARTBOARD → the images are inserted into that asset as top
//     layers at the drop point, scaled to fit.
//
// While a file drag is over the canvas, the target is outlined with a label
// saying what will happen. Drops anywhere else in the studio are swallowed so
// the browser never navigates away to show the image.
//
// Motion: the outline + label fade in (opacity, --lm-duration-fast). They
// jump to a new target instantly — sliding between targets would lag the
// pointer. Feedback for an occasional action; nothing moves under
// prefers-reduced-motion except that fade.

import React from 'react';
import * as ReactDOM from 'react-dom';

import { listProjectDir } from '../../runtime/write-client.js';
import { createImageAssets, insertImagesIntoAsset, placeImage } from '../edit-mode/edit-session.js';
import { dcToast } from '../../design-canvas.jsx';
import {
  dragHasFiles,
  isImageFile,
  splitImageName,
  uniqueBase,
  artboardSizeFor,
  insertBoxFor,
  readImageFile,
} from './image-drop.js';

const SRC_ATTR = 'data-lerret-src';

if (typeof document !== 'undefined' && !document.getElementById('lm-image-drop-styles')) {
  const s = document.createElement('style');
  s.id = 'lm-image-drop-styles';
  s.textContent = `
.lm-image-drop {
  position: fixed;
  z-index: 60;
  pointer-events: none;
  border-radius: 12px;
  box-shadow: inset 0 0 0 2px var(--lm-accent, #111111);
  background: var(--lm-accent-light, rgba(17, 17, 17, 0.06));
  opacity: 1;
  transition: opacity var(--lm-duration-fast, 120ms) var(--lm-ease, ease);
}
@starting-style {
  .lm-image-drop { opacity: 0; }
}
.lm-image-drop__label {
  position: absolute;
  top: 8px;
  left: 8px;
  max-width: calc(100% - 16px);
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--lm-accent, #111111);
  color: #fff;
  font: 600 12px/1.4 var(--lm-font-sans, system-ui);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`;
  document.head.appendChild(s);
}

const lerretRel = (p) => {
  const i = String(p).lastIndexOf('/.lerret/');
  return i === -1 ? String(p).replace(/^\/+/, '') : String(p).slice(i + '/.lerret/'.length);
};
const baseName = (p) => String(p).split('/').filter(Boolean).pop() || String(p);
/**
 * A name-collision check for one folder, from ONE listing (no per-name probes
 * that 404 — see CLAUDE.md "Studio ↔ CLI data contract"). Case-insensitive,
 * like the server's own collision rule.
 *
 * @param {string} folder
 * @returns {Promise<(path: string) => Promise<boolean>>}
 */
async function existsIn(folder) {
  const res = await listProjectDir(folder);
  const names = new Set((res.entries || []).map((e) => String(e.name).toLowerCase()));
  return async (path) => names.has(baseName(path).toLowerCase());
}

/**
 * Resolve what a drop at `el` would do.
 *
 * @param {Element | null} el
 * @param {string} pagePath
 * @returns {null
 *   | { kind: 'fill', box: Element, slot: Element, assetPath: string, stamp: string, label: string }
 *   | { kind: 'insert', box: Element, slot: Element, assetPath: string, label: string }
 *   | { kind: 'create', box: Element, folder: string, label: string }}
 */
export function resolveDropTarget(el, pagePath) {
  if (!el || typeof el.closest !== 'function') return null;
  // The canvas, or an empty page's notice (marked data-lm-drop-page).
  const canvas = el.closest('.design-canvas, [data-lm-drop-page]');
  if (!canvas) return null;
  const slot = el.closest('[data-dc-asset-path]');
  const assetPath = slot?.getAttribute('data-dc-asset-path') || '';
  if (slot && /\.(jsx|tsx)$/.test(assetPath)) {
    // A phone screen (image slot) or an existing image takes the picture
    // itself instead of getting a new layer on top.
    const hole = el.closest(`[data-image-slot][${SRC_ATTR}], img[${SRC_ATTR}]`);
    if (hole && slot.contains(hole)) {
      return {
        kind: 'fill',
        box: hole,
        slot,
        assetPath,
        stamp: hole.getAttribute(SRC_ATTR),
        label: hole.tagName === 'IMG' ? 'Replace image' : 'Place screenshot here',
      };
    }
    const name = slot.getAttribute('data-dc-label') || baseName(assetPath);
    return { kind: 'insert', box: slot.querySelector('.dc-card') || slot, slot, assetPath, label: `Insert into ${name}` };
  }
  const section = el.closest('[data-dc-section]');
  const folder = section?.getAttribute('data-dc-section') || pagePath;
  const box = section && section.getAttribute('data-dc-section-bare') !== 'true' ? section : canvas;
  return { kind: 'create', box, folder, label: `Add as new asset to ${baseName(folder)}` };
}

/**
 * Drop images INTO an artboard: as top layers inside its root element.
 *
 * @param {{ slot: Element, assetPath: string }} target
 * @param {File[]} files
 * @param {{ x: number, y: number }} client  Drop point (viewport px).
 */
async function dropIntoAsset(target, files, client) {
  const card = target.slot.querySelector('.dc-card');
  const root = card?.querySelector(`[${SRC_ATTR}]`);
  const m = /^(.*):(\d+)$/.exec(root?.getAttribute(SRC_ATTR) || '');
  if (!card || !m) {
    dcToast('Couldn’t find where to put the image in this asset.');
    return;
  }
  const stampPath = m[1];
  const offset = Number(m[2]);
  if (lerretRel(stampPath) !== lerretRel(target.assetPath)) {
    dcToast('This artboard’s layout comes from another file — drop the image there instead.');
    return;
  }
  const artboard = {
    width: Number(target.slot.getAttribute('data-dc-w')) || card.offsetWidth,
    height: Number(target.slot.getAttribute('data-dc-h')) || card.offsetHeight,
  };
  const rect = card.getBoundingClientRect();
  const scale = rect.width / artboard.width || 1;
  const point = { x: (client.x - rect.left) / scale, y: (client.y - rect.top) / scale };
  const folder = stampPath.slice(0, stampPath.lastIndexOf('/'));
  const exists = await existsIn(folder);

  const reserved = new Set();
  const images = [];
  for (const [i, file] of files.entries()) {
    const { base, ext } = splitImageName(file.name);
    const name = await uniqueBase(base, (c) => [`${folder}/${c}.${ext}`], exists, reserved);
    reserved.add(name);
    const read = await readImageFile(file);
    images.push({
      file: `${name}.${ext}`,
      base64: read.base64,
      alt: name,
      ...insertBoxFor(read, artboard, point, i),
    });
  }
  const res = await insertImagesIntoAsset({ path: stampPath, offset, images });
  const what = images.length === 1 ? images[0].file : `${images.length} images`;
  dcToast(res.ok ? `Added ${what} to ${baseName(target.assetPath)}` : `Couldn’t add the image: ${res.error}`);
}

/**
 * Drop an image INTO a slot (phone screen) or onto an image (replace it).
 * One image fills one slot — extra files are ignored with a notice.
 *
 * @param {{ assetPath: string, stamp: string }} target
 * @param {File[]} files
 */
async function dropIntoSlot(target, files) {
  const m = /^(.*):(\d+)$/.exec(target.stamp || '');
  if (!m) return;
  const stampPath = m[1];
  const folder = stampPath.slice(0, stampPath.lastIndexOf('/'));
  const exists = await existsIn(folder);
  const { base, ext } = splitImageName(files[0].name);
  const name = await uniqueBase(base, (c) => [`${folder}/${c}.${ext}`], exists);
  const read = await readImageFile(files[0]);
  const res = await placeImage(stampPath, Number(m[2]), { file: `${name}.${ext}`, base64: read.base64 });
  if (files.length > 1) dcToast('One image per spot — used the first one.');
  else dcToast(res.ok ? `Placed ${name}.${ext}` : `Couldn’t place the image: ${res.error}`);
}

/**
 * Drop images onto the background: one new image asset per file.
 *
 * @param {{ folder: string }} target
 * @param {File[]} files
 */
async function dropAsNewAssets(target, files) {
  const { folder } = target;
  const exists = await existsIn(folder);
  const reserved = new Set();
  const images = [];
  for (const file of files) {
    const { base, ext } = splitImageName(file.name);
    const name = await uniqueBase(base, (c) => [`${folder}/${c}.jsx`, `${folder}/${c}.${ext}`], exists, reserved);
    reserved.add(name);
    const read = await readImageFile(file);
    images.push({ name, file: `${name}.${ext}`, base64: read.base64, ...artboardSizeFor(read.width, read.height) });
  }
  const res = await createImageAssets({ folder, images });
  const what = images.length === 1 ? `${images[0].name} (${images[0].width}×${images[0].height})` : `${images.length} images`;
  dcToast(res.ok ? `Added ${what} to ${baseName(folder)}` : `Couldn’t add the image: ${res.error}`);
}

/**
 * Mount once per canvas. Listens at the document so a drop anywhere in the
 * studio is handled (or safely swallowed).
 *
 * @param {{ pagePath: string, enabled: boolean }} props
 *   `enabled` — writes are possible (CLI dev server / hosted folder grant).
 */
export function ImageDropLayer({ pagePath, enabled }) {
  const [hint, setHint] = React.useState(null); // { rect, label } | null
  const lastBoxRef = React.useRef(null);
  const lastLabelRef = React.useRef(null);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const clear = () => {
      lastBoxRef.current = null;
      lastLabelRef.current = null;
      setHint(null);
    };
    const onDragOver = (e) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      // The Workflow view takes its own drops (spreadsheets).
      if (e.target?.closest?.('[data-lm-workflow]')) return;
      e.preventDefault(); // never let the browser open the file instead
      const target = enabled ? resolveDropTarget(e.target, pagePath) : null;
      e.dataTransfer.dropEffect = target ? 'copy' : 'none';
      if (!target) return clear();
      if (lastBoxRef.current === target.box && lastLabelRef.current === target.label) return undefined;
      lastBoxRef.current = target.box;
      lastLabelRef.current = target.label;
      const r = target.box.getBoundingClientRect();
      setHint({ rect: { left: r.left, top: r.top, width: r.width, height: r.height }, label: target.label });
      return undefined;
    };
    const onDragLeave = (e) => {
      // Leaving the window: relatedTarget is null.
      if (dragHasFiles(e.dataTransfer) && !e.relatedTarget) clear();
    };
    const onDrop = (e) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      if (e.target?.closest?.('[data-lm-workflow]')) return;
      e.preventDefault();
      clear();
      const target = enabled ? resolveDropTarget(e.target, pagePath) : null;
      if (!target) return;
      const all = Array.from(e.dataTransfer.files || []);
      const files = all.filter(isImageFile);
      if (files.length === 0) {
        dcToast('Only images can be dropped here (PNG, JPG, GIF, WebP, SVG or AVIF).');
        return;
      }
      if (files.length < all.length) dcToast(`Skipped ${all.length - files.length} file(s) that aren’t images.`);
      const client = { x: e.clientX, y: e.clientY };
      const run =
        target.kind === 'fill'
          ? dropIntoSlot(target, files)
          : target.kind === 'insert'
            ? dropIntoAsset(target, files, client)
            : dropAsNewAssets(target, files);
      run.catch((err) => dcToast(`Couldn’t add the image: ${err?.message ?? err}`));
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', clear);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
      document.removeEventListener('dragend', clear);
    };
  }, [enabled, pagePath]);

  if (!hint || typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <div className="lm-image-drop" data-testid="lm-image-drop" style={hint.rect} aria-hidden="true">
      <span className="lm-image-drop__label">{hint.label}</span>
    </div>,
    document.body,
  );
}

export default ImageDropLayer;
