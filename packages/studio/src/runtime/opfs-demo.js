// opfs-demo.js — a zero-setup sample project in the browser's Origin Private
// File System, for "Try a demo" on the hosted entry screen. No folder pick, no
// permission prompt — a first-time visitor sees the studio working in one click.
// (Epic 10 / H8.)
//
// The demo's CONTENT lives as real files under `./demo-project/files/**` — a
// genuine multi-page `.lerret/` project (welcome · brand · social · live ·
// launch) that exercises data-driven props, auto-refresh, multi-format social,
// and Markdown. They are pulled in as raw text at build time and written
// verbatim into OPFS, so "Try a demo" loads through the EXACT same scan → render
// path as a real folder — nothing about the demo is special-cased in the studio.

// Every file under demo-project/files, as raw text. `import.meta.glob` inlines
// them into the bundle at build time (the same `?raw` mechanism the dev-harness
// uses for its fixture). Keys look like './demo-project/files/welcome/Welcome.jsx'.
const RAW_FILES = import.meta.glob('./demo-project/files/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FILES_PREFIX = './demo-project/files/';

/**
 * The demo project as a flat `{ '<path under .lerret/>': '<file text>' }` map —
 * e.g. `{ 'config.json': '…', 'welcome/Welcome.jsx': '…' }`. Exported so the
 * seed manifest can be asserted in tests without touching OPFS.
 * @type {Record<string, string>}
 */
export const DEMO_FILES = Object.fromEntries(
  Object.entries(RAW_FILES).map(([key, text]) => [key.slice(FILES_PREFIX.length), text]),
);

/**
 * The File System Access API exposes permission methods on real
 * `showDirectoryPicker` handles, but OPFS handles do not need (or have) them.
 * The FSA backend's permission guard calls `queryPermission`/`requestPermission`,
 * so wrap the OPFS root to answer 'granted' while forwarding everything else.
 *
 * @param {FileSystemDirectoryHandle} root
 * @returns {FileSystemDirectoryHandle}
 */
function grantedHandle(root) {
  return new Proxy(root, {
    get(target, prop) {
      if (prop === 'queryPermission') return async () => 'granted';
      if (prop === 'requestPermission') return async () => 'granted';
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function writeFileTo(dir, name, content) {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Write `content` to `relPath` (forward-slash, relative to the project root),
 * creating every intermediate directory on the way — e.g. 'social/og-card.jsx'
 * creates the `social/` folder then writes `og-card.jsx`.
 *
 * @param {FileSystemDirectoryHandle} root
 * @param {string} relPath
 * @param {string} content
 */
async function writeNested(root, relPath, content) {
  const parts = relPath.split('/');
  const fileName = parts.pop();
  let dir = root;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  await writeFileTo(dir, fileName, content);
}

/**
 * Seed (replacing any prior demo) the sample `.lerret/` project in OPFS and
 * return a permission-granted root handle ready for the hosted bring-up.
 *
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function createDemoProject() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry('.lerret', { recursive: true });
  } catch {
    /* nothing to clear */
  }
  const lerret = await root.getDirectoryHandle('.lerret', { create: true });
  for (const [relPath, content] of Object.entries(DEMO_FILES)) {
    await writeNested(lerret, relPath, content);
  }
  return grantedHandle(root);
}
