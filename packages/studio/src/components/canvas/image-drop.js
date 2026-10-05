// image-drop.js — pure helpers for dropping image files onto the canvas.
//
// The drop layer (image-drop-layer.jsx) decides WHERE a drop lands; these
// helpers turn the dropped files into what the edit session writes: names that
// don't collide, the image's natural size, and — for a drop onto an artboard —
// the box the image occupies inside it.

import { validateEntryName, MIN_ASSET_DIMENSION, MAX_ASSET_DIMENSION } from '@lerret/core';

/** Image kinds a drop accepts (by extension, for files the OS gives no type). */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

/** Default size for an image the browser reports as 0×0 (an SVG without one). */
export const FALLBACK_IMAGE_SIZE = Object.freeze({ width: 512, height: 512 });

/** An inserted image fits within this share of the artboard's width/height. */
export const INSERT_MAX_SHARE = 0.5;

/** Successive images from one drop are offset by this much (px) so none hide. */
export const CASCADE_PX = 24;

/**
 * @param {{ name?: string, type?: string }} file
 * @returns {boolean}
 */
export function isImageFile(file) {
  if (!file) return false;
  if (typeof file.type === 'string' && file.type.startsWith('image/')) return true;
  return IMAGE_EXT.test(String(file.name ?? ''));
}

/** Whether a drag carries files at all (types are all a dragover can see). */
export function dragHasFiles(dataTransfer) {
  const types = dataTransfer?.types;
  return !!types && Array.from(types).includes('Files');
}

/**
 * Split a dropped filename into a safe asset base name and its extension:
 * `My Logo (final).PNG` → `{ base: 'My Logo final', ext: 'png' }`.
 *
 * @param {string} fileName
 * @returns {{ base: string, ext: string }}
 */
export function splitImageName(fileName) {
  const name = String(fileName ?? '');
  const dot = name.lastIndexOf('.');
  const ext = (dot > 0 ? name.slice(dot + 1) : 'png').toLowerCase().replace(/^jpeg$/, 'jpg');
  let base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  if (!validateEntryName(base, { kind: 'asset' }).ok) base = 'image';
  return { base, ext };
}

/**
 * The first `base`, `base-2`, `base-3`, … for which every derived path is free.
 *
 * @param {string} base
 * @param {(candidate: string) => string[]} pathsFor  Paths that candidate would take.
 * @param {(path: string) => Promise<boolean>} exists
 * @param {Set<string>} [reserved]  Candidates already claimed by this drop.
 * @returns {Promise<string>}
 */
export async function uniqueBase(base, pathsFor, exists, reserved = new Set()) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (reserved.has(candidate)) continue;
    const taken = await Promise.all(pathsFor(candidate).map((p) => exists(p)));
    if (!taken.some(Boolean)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Clamp an image's natural size into the range an artboard accepts, keeping
 * its aspect ratio where possible.
 *
 * @param {number} width
 * @param {number} height
 * @returns {{ width: number, height: number }}
 */
export function artboardSizeFor(width, height) {
  let w = Number(width) || 0;
  let h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { ...FALLBACK_IMAGE_SIZE };
  const down = Math.min(1, MAX_ASSET_DIMENSION / Math.max(w, h));
  w *= down;
  h *= down;
  return {
    width: Math.max(MIN_ASSET_DIMENSION, Math.round(w)),
    height: Math.max(MIN_ASSET_DIMENSION, Math.round(h)),
  };
}

/**
 * Where an image dropped onto an artboard goes: scaled down (never up) to fit
 * {@link INSERT_MAX_SHARE} of the artboard, centered on the drop point, nudged
 * by {@link CASCADE_PX} per extra image, and kept inside the artboard.
 *
 * @param {{ width: number, height: number }} natural  The image's size.
 * @param {{ width: number, height: number }} artboard  The artboard's size.
 * @param {{ x: number, y: number }} point  Drop point in artboard px.
 * @param {number} [index]  Position of this image within the drop.
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function insertBoxFor(natural, artboard, point, index = 0) {
  const nat = natural.width > 0 && natural.height > 0 ? natural : FALLBACK_IMAGE_SIZE;
  const s = Math.min(
    1,
    (artboard.width * INSERT_MAX_SHARE) / nat.width,
    (artboard.height * INSERT_MAX_SHARE) / nat.height,
  );
  const width = Math.max(1, Math.round(nat.width * s));
  const height = Math.max(1, Math.round(nat.height * s));
  const clamp = (v, max) => Math.round(Math.min(Math.max(v, 0), Math.max(0, max)));
  return {
    left: clamp(point.x - width / 2 + index * CASCADE_PX, artboard.width - width),
    top: clamp(point.y - height / 2 + index * CASCADE_PX, artboard.height - height),
    width,
    height,
  };
}

/**
 * Read a dropped image: its bytes as base64 and its natural size.
 *
 * @param {File} file
 * @returns {Promise<{ base64: string, width: number, height: number }>}
 */
export async function readImageFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const { width, height } = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
}
