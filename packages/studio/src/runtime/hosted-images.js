// runtime/hosted-images.js — register a hosted project's image files with the
// module service worker so `<img src>` references resolve (Epic 10 follow-up).
//
// WHY: the SW serves Sucrase-transformed JS modules, registered by walking each
// asset's JS `import`s. A plain `<img src="…/logo.png">` is NOT a JS import and
// the file is binary, so it is never registered — the request 404s and the
// image shows broken. This walks the `.lerret/` tree, reads each image's bytes
// via the FSA backend, and registers them with the SW keyed by their
// project-relative path. The SW resolves an `<img>` request's tail to that key,
// so it is TOLERANT of the `../` depth the agent used in the reference — logos
// under `.lerret/_assets/` and companion images both display.

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

/**
 * Walk a project's `.lerret/` tree and register every image file's bytes with
 * the service worker, keyed by the path RELATIVE to `scanRoot` (so the SW can
 * match an `<img>` request's tail regardless of its `../` depth). The snapshot
 * sidecar (`.state/`) is skipped — it holds no canvas images.
 *
 * Resolves to the number of images registered (handy for diagnostics/tests).
 *
 * @param {import('@lerret/core').FilesystemAccess} fs
 * @param {{ postMessage: (message: object) => void }} sw
 * @param {string} [scanRoot]  The project scan root; defaults to `.lerret`.
 * @returns {Promise<number>}
 */
export async function registerProjectImages(fs, sw, scanRoot = '.lerret') {
  if (!fs || typeof fs.readDir !== 'function' || !sw || typeof sw.postMessage !== 'function') {
    return 0;
  }
  let count = 0;
  const walk = async (dir) => {
    let entries;
    try {
      entries = await fs.readDir(dir);
    } catch {
      return; // missing / unreadable dir contributes nothing
    }
    for (const entry of entries) {
      const path = entry && entry.path ? entry.path : `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        if (entry.name === '.state') continue; // snapshot store — no canvas images
        await walk(path);
        continue;
      }
      const contentType = imageMime(entry.name);
      if (!contentType) continue;
      let bytes;
      try {
        bytes = await fs.readFile(path, { encoding: 'binary' });
      } catch {
        continue;
      }
      if (!ArrayBuffer.isView(bytes)) continue;
      const prefix = `${scanRoot}/`;
      const key = path.startsWith(prefix) ? path.slice(prefix.length) : path;
      sw.postMessage({ type: 'REGISTER_BINARY', key, bytes, contentType });
      count += 1;
    }
  };
  await walk(scanRoot);
  return count;
}
