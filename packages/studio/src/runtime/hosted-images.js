// runtime/hosted-images.js — register a hosted project's image files with the
// module service worker so `<img src>` references resolve (Epic 10 follow-up).
//
// WHY: the SW serves Sucrase-transformed JS modules, registered by walking each
// asset's JS `import`s. A plain `<img src="…/logo.png">` is NOT a JS import and
// the file is binary, so it is never registered — the request 404s and the
// image shows broken. So the SW asks the page for an image when a card first
// requests it; the page reads that one file via the FSA backend and sends the
// bytes keyed by their project-relative path. The SW maps an `<img>` request's
// tail to that key, so it is TOLERANT of the `../` depth in the reference (and
// of the CLI's `/@lerret-project/` route) — logos under `.lerret/_assets/` and
// companion images both display. Nothing is preloaded.

/** Extension → MIME for the image kinds Lerret recognizes. */
const IMAGE_MIME = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
});

/**
 * The MIME type for a filename's extension, or null when it is not a known
 * image kind.
 *
 * @param {string} name
 * @returns {string | null}
 */
export function imageMime(name) {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return IMAGE_MIME[name.slice(dot).toLowerCase()] || null;
}

/** What the NEED_BINARY listener reads from — the latest mounted project. */
const current = { fs: null, scanRoot: '.lerret', installed: false };

/**
 * Answer the service worker's on-demand image requests from the mounted
 * project. The SW asks with the candidate project-relative keys for a request
 * (`NEED_BINARY`); the first that is an image file in the project is read and
 * sent back (`REGISTER_BINARY`), then `BINARY_RESULT` says which (or none).
 *
 * @param {MessageEvent} event
 */
export async function onSwMessage(event) {
  const data = event.data;
  if (!data || data.type !== 'NEED_BINARY' || !Array.isArray(data.keys)) return;
  const target = event.source || (navigator.serviceWorker && navigator.serviceWorker.controller);
  if (!target) return;
  let found = null;
  for (const key of data.keys) {
    const contentType = imageMime(key);
    if (!contentType || !current.fs || key.split('/').includes('..')) continue;
    try {
      const bytes = await current.fs.readFile(`${current.scanRoot}/${key}`, { encoding: 'binary' });
      if (!ArrayBuffer.isView(bytes)) continue;
      target.postMessage({ type: 'REGISTER_BINARY', key, bytes, contentType });
      found = key;
      break;
    } catch {
      // not this candidate
    }
  }
  target.postMessage({ type: 'BINARY_RESULT', id: data.id, key: found });
}

/**
 * Serve the project's image files to the service worker ON DEMAND, so
 * `<img src>` references in assets resolve in hosted mode. Nothing is read up
 * front — a project with gigabytes of images opens immediately, and each image
 * is read once, when a card first shows it. Call again after an image changes
 * on disk: the SW drops its cached bytes and re-reads on the next request.
 *
 * (Name kept from the eager version it replaced; resolves to 0 images read.)
 *
 * @param {import('@lerret/core').FilesystemAccess} fs
 * @param {{ postMessage: (message: object) => void }} sw
 * @param {string} [scanRoot]  The project scan root; defaults to `.lerret`.
 * @returns {Promise<number>}
 */
export async function registerProjectImages(fs, sw, scanRoot = '.lerret') {
  if (!fs || typeof fs.readFile !== 'function' || !sw || typeof sw.postMessage !== 'function') {
    return 0;
  }
  current.fs = fs;
  current.scanRoot = scanRoot;
  if (!current.installed && typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    current.installed = true;
  }
  sw.postMessage({ type: 'ENABLE_IMAGES' });
  return 0;
}
