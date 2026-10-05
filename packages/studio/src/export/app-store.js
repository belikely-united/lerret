// app-store.js — package designs as App Store Connect screenshots.
//
// App Store Connect accepts screenshots only at specific pixel sizes per
// device, and rejects images with transparency. This module matches designs
// to those sizes, captures each one at EXACTLY its pixel size (the general
// export renders at 2×) as a JPG on white, and zips them in one folder per
// device class.

import { zipSync } from 'fflate';

import { captureArtboard } from './capture.js';

/**
 * Accepted screenshot sizes (portrait; landscape is the same pair swapped).
 * Grouped by the device class App Store Connect asks for.
 *
 * @type {ReadonlyArray<{ device: string, sizes: ReadonlyArray<[number, number]> }>}
 */
export const APP_STORE_SIZES = Object.freeze([
  { device: 'iPhone 6.9″', sizes: [[1320, 2868], [1290, 2796], [1260, 2736]] },
  { device: 'iPhone 6.5″', sizes: [[1284, 2778], [1242, 2688]] },
  { device: 'iPhone 6.3″', sizes: [[1206, 2622], [1179, 2556]] },
  { device: 'iPhone 6.1″', sizes: [[1170, 2532], [1125, 2436], [1080, 2340]] },
  { device: 'iPhone 5.5″', sizes: [[1242, 2208]] },
  { device: 'iPad 13″', sizes: [[2064, 2752], [2048, 2732]] },
  { device: 'iPad 11″', sizes: [[1668, 2420], [1668, 2388], [1640, 2360], [1488, 2266]] },
  { device: 'Mac', sizes: [[2880, 1800], [2560, 1600], [1440, 900], [1280, 800]] },
]);

/** The device a size belongs to (either orientation), or null. */
export function appStoreDeviceFor(width, height) {
  for (const { device, sizes } of APP_STORE_SIZES) {
    if (sizes.some(([w, h]) => (w === width && h === height) || (w === height && h === width))) return device;
  }
  return null;
}

/** Folder-safe device name: `iPhone 6.9″` → `iPhone 6.9-inch`. */
export function deviceFolder(device) {
  return device.replace(/″/g, '-inch');
}

const safe = (s) => String(s).replace(/[^\w .-]+/g, '-').replace(/\s+/g, ' ').trim() || 'design';

/**
 * Sort the designs inside `root` into App-Store-ready and not.
 *
 * @param {ParentNode} root  The page/group element to look in.
 * @returns {{ ready: Array<{ slot: Element, card: Element, label: string, device: string, width: number, height: number }>,
 *             skipped: Array<{ label: string, width: number, height: number }> }}
 */
export function collectAppStoreDesigns(root) {
  const ready = [];
  const skipped = [];
  for (const slot of root.querySelectorAll('[data-dc-slot]')) {
    const card = slot.querySelector('.dc-card');
    const width = Number(slot.getAttribute('data-dc-w'));
    const height = Number(slot.getAttribute('data-dc-h'));
    const label = slot.getAttribute('data-dc-label') || 'design';
    if (!card || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    const device = appStoreDeviceFor(width, height);
    if (device) ready.push({ slot, card, label, device, width, height });
    else skipped.push({ label, width, height });
  }
  return { ready, skipped };
}

/**
 * Capture the ready designs at exact size and zip them by device.
 *
 * @param {ReturnType<typeof collectAppStoreDesigns>['ready']} ready
 * @param {{ capture?: typeof captureArtboard, onProgress?: (done: number, total: number) => void }} [deps]
 * @returns {Promise<{ blob: Blob, failed: string[] }>}
 */
export async function buildAppStoreZip(ready, { capture = captureArtboard, onProgress } = {}) {
  const files = {};
  const failed = [];
  const counters = new Map();
  for (const [i, d] of ready.entries()) {
    try {
      // The card renders at the design's CSS size, so pixelRatio 1 = exact px.
      const { blob } = await capture(d.card, { format: 'jpg', pixelRatio: 1, quality: 0.95, backgroundColor: '#ffffff' });
      const n = (counters.get(d.device) || 0) + 1;
      counters.set(d.device, n);
      const name = `${deviceFolder(d.device)}/${String(n).padStart(2, '0')} ${safe(d.label)}.jpg`;
      files[name] = new Uint8Array(await blob.arrayBuffer());
    } catch {
      failed.push(d.label);
    }
    onProgress?.(i + 1, ready.length);
  }
  return { blob: new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), failed };
}

/** Save a blob as a download. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
