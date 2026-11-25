// embed-media.js — project images and fonts inside the chat iframe.
//
// In the hosted studio a service worker answers `<img src="./logo.png">` and
// `@font-face url(...)` requests. The chat sandbox has no service worker, and
// its CSP allows `data:` images but not `data:` fonts, so:
//   - images: a MutationObserver swaps relative `<img src>` for data URLs,
//     matched by path tail (same tolerance as the service worker);
//   - fonts: `_fonts/*` are registered with the FontFace API from bytes.

import { imageMime } from '../runtime/hosted-images.js';
import { bytesToDataUrl } from '../runtime/diagram-theme.js';

const FONT_EXT = /\.(woff2?|ttf|otf)$/i;

/** `./a/../b/logo.png` → `b/logo.png` (drop `./` and leading `../`). */
function tailOf(src) {
  return src.split(/[?#]/)[0].split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
}

/**
 * Resolve relative `<img src>` in `root` to project images, now and as the
 * canvas re-renders.
 *
 * @param {() => Map<string, string | Uint8Array>} getFiles  path → content.
 * @param {Element} [root]
 * @param {Record<string, string>} [fixed]  Exact `src` → URL for the studio's own UI images.
 * @param {(path: string) => Promise<Uint8Array | string | undefined>} [load]
 *   The file's bytes, fetched if not loaded yet (default: what `getFiles` holds).
 * @returns {() => void} stop
 */
export function startImageResolver(getFiles, root = document.body, fixed = {}, load = async (path) => getFiles().get(path)) {
  const cache = new Map(); // tail → Promise<data URL | null>
  const lookup = (tail) => {
    if (cache.has(tail)) return cache.get(tail);
    let best = null;
    for (const path of getFiles().keys()) {
      if ((path === tail || path.endsWith(`/${tail}`)) && (!best || path.length < best.length)) best = path;
    }
    const mime = imageMime(tail);
    const url = best && mime
      ? load(best).then((bytes) => (ArrayBuffer.isView(bytes) ? bytesToDataUrl(bytes, mime) : null), () => null)
      : Promise.resolve(null);
    cache.set(tail, url);
    return url;
  };
  const fix = (img) => {
    const src = img.getAttribute('src');
    if (fixed[src]) return img.setAttribute('src', fixed[src]);
    if (!src || /^(data:|https?:|blob:)/i.test(src) || !imageMime(src.split(/[?#]/)[0])) return;
    lookup(tailOf(src)).then((url) => {
      if (url && img.getAttribute('src') === src) img.setAttribute('src', url);
    });
  };
  const scan = (node) => {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'IMG') fix(node);
    node.querySelectorAll?.('img').forEach(fix);
  };
  scan(root);
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') fix(r.target);
      else r.addedNodes.forEach(scan);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  return () => {
    observer.disconnect();
    cache.clear();
  };
}

/**
 * Register every font file under `_fonts/` with the FontFace API (family =
 * file basename, matching the studio's font registry). Returns the faces so a
 * reload can remove them.
 *
 * @param {Map<string, string | Uint8Array>} files
 * @param {FontFace[]} [previous]
 * @returns {Promise<FontFace[]>}
 */
export async function registerFonts(files, previous = []) {
  for (const face of previous) document.fonts.delete(face);
  const faces = [];
  for (const [path, bytes] of files) {
    if (!path.includes('/_fonts/') || !FONT_EXT.test(path) || !ArrayBuffer.isView(bytes)) continue;
    const family = path.split('/').pop().replace(FONT_EXT, '');
    try {
      const face = new FontFace(family, bytes.slice().buffer);
      await face.load();
      document.fonts.add(face);
      faces.push(face);
    } catch {
      // unreadable font: the card falls back like a missing font
    }
  }
  return faces;
}
