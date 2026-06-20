// opfs-demo.js — a zero-setup sample project in the browser's Origin Private
// File System, for "Try a demo" on the hosted entry screen. No folder pick, no
// permission prompt — a first-time visitor sees the studio working in one click.
// (Epic 10 / H8.)

const DEMO_SOURCE = `import { useState } from 'react';

export const meta = { dimensions: { width: 1200, height: 630 } };

export default function Welcome() {
  const [clicks, setClicks] = useState(0);
  return (
    <div
      onClick={() => setClicks((c) => c + 1)}
      style={{
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: '#FAF8F2',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        cursor: 'pointer',
      }}
    >
      <img src="../_assets/lerret-mark.svg" width="84" height="84" alt="Lerret" style={{ display: 'block' }} />
      <div style={{ fontSize: 64, fontWeight: 700, color: '#1A1714' }}>Welcome to Lerret</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: '#B85B33' }}>
        Your folder is a canvas. Clicks: {clicks}
      </div>
      <div style={{ fontSize: 15, color: '#6E6960' }}>
        Edit .lerret/welcome/Welcome.jsx and it re-renders.
      </div>
    </div>
  );
}
`;

// A tiny brand mark shipped with the demo so `<img src>` (and the whole hosted
// image pipeline) is exercised out of the box — an orange rounded square + "L".
const LERRET_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
  '<rect width="96" height="96" rx="22" fill="#B85B33"/>' +
  '<path d="M34 26h10v36h22v10H34z" fill="#FAF8F2"/></svg>\n';

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
 * Seed (replacing any prior demo) a one-page sample `.lerret/` project in OPFS
 * and return a permission-granted root handle ready for the hosted bring-up.
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
  await writeFileTo(lerret, 'config.json', JSON.stringify({ vars: { brand: '#B85B33' } }, null, 2));
  const page = await lerret.getDirectoryHandle('welcome', { create: true });
  await writeFileTo(page, 'Welcome.jsx', DEMO_SOURCE);
  // A shared brand mark under `_assets/` that Welcome.jsx references via
  // `<img src="../_assets/lerret-mark.svg">` — exercises hosted image serving.
  const assets = await lerret.getDirectoryHandle('_assets', { create: true });
  await writeFileTo(assets, 'lerret-mark.svg', LERRET_MARK_SVG);
  return grantedHandle(root);
}
