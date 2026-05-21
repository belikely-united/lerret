// Tests for the co-located data-file loader (`data/loader.js`).
//
// The suite is environment-agnostic: it uses the same in-memory
// `FilesystemAccess` fake pattern as `loader/scan.test.js`, so no `node:fs`
// is needed and the tests stay aligned with the core purity invariant.
//
// Coverage:
//   - Asset with co-located `.data.json` → parsed value, keyed by asset path.
//   - Asset with co-located `.data.js`   → 'js' source, dataPath recorded.
//   - Asset with BOTH                    → `.data.js` wins, warning emitted.
//   - Asset with no data file            → 'absent', no error.
//   - Malformed `.data.json`             → 'absent' + warning, isolated.
//   - Multiple assets, independent results.
//   - `collectAssets` — flattens a ProjectNode tree.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createAssetNode, createProjectNode, createPageNode, createGroupNode } from '../loader/model.js';

import { loadAssetData, collectAssets } from './loader.js';

// ---------------------------------------------------------------------------
// In-memory FilesystemAccess fake
// ---------------------------------------------------------------------------

/**
 * Build an in-memory `FilesystemAccess` from a nested plain-object tree.
 *
 * The same helper shape used in scan.test.js — consistent fake in both suites.
 * A directory key holds an object; a file key holds its string content.
 *
 * @param {string} rootPath
 * @param {object} tree
 * @returns {import('../fs/filesystem.js').FilesystemAccess}
 */
function makeMemoryFs(rootPath, tree) {
  function resolve(path) {
    const norm = path.replace(/\/+$/, '');
    const root = rootPath.replace(/\/+$/, '');
    if (norm === root) return tree;
    if (!norm.startsWith(root + '/')) return undefined;
    const rest = norm.slice(root.length + 1);
    let node = tree;
    for (const seg of rest.split('/')) {
      if (node === null || typeof node !== 'object' || !(seg in node)) return undefined;
      node = node[seg];
    }
    return node;
  }

  return {
    async readDir(dirPath) {
      const node = resolve(dirPath);
      if (node === undefined) throw new Error(`ENOENT: ${dirPath}`);
      if (typeof node !== 'object') throw new Error(`ENOTDIR: ${dirPath}`);
      const base = dirPath.replace(/\/+$/, '');
      return Object.entries(node).map(([name, value]) => {
        const isDirectory = typeof value === 'object' && value !== null;
        return {
          name,
          path: `${base}/${name}`,
          kind: isDirectory ? 'directory' : 'file',
          isFile: !isDirectory,
          isDirectory,
        };
      });
    },
    async readFile(filePath) {
      const node = resolve(filePath);
      if (node === undefined) throw new Error(`ENOENT: ${filePath}`);
      if (typeof node !== 'string') throw new Error(`EISDIR: ${filePath}`);
      return node;
    },
    async writeFile() {},
    watch() { return { close() {} }; },
    capabilities: { canWrite: true, canWatch: false, canReveal: false },
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ROOT = '/proj/.lerret/home';

/**
 * Build an AssetNode at ROOT/<fileName>.
 *
 * @param {string} fileName e.g. "Button.jsx"
 * @returns {import('../loader/model.js').AssetNode}
 */
function asset(fileName) {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const name = fileName.slice(0, fileName.lastIndexOf('.'));
  return createAssetNode({
    name,
    fileName,
    path: `${ROOT}/${fileName}`,
    assetKind: 'component',
    ext,
  });
}

// ---------------------------------------------------------------------------
// Spy on console.warn
// ---------------------------------------------------------------------------

let warnSpy;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadAssetData', () => {
  // ── AC: .data.json ──────────────────────────────────────────────────────
  describe('asset with co-located .data.json', () => {
    it('returns source="json" with the parsed value, keyed by asset path', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': 'export default function Button() {}',
          'Button.data.json': JSON.stringify({ label: 'Click me', count: 42 }),
        },
      });

      const map = await loadAssetData([btn], backend);

      expect(map.size).toBe(1);
      const entry = map.get(btn.path);
      expect(entry.source).toBe('json');
      expect(entry.value).toEqual({ label: 'Click me', count: 42 });
      expect(entry.dataPath).toBe(`${ROOT}/Button.data.json`);
    });

    it('emits no warnings for a clean .data.json load', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          'Button.data.json': '{"x":1}',
        },
      });

      await loadAssetData([btn], backend);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── AC: .data.js ────────────────────────────────────────────────────────
  describe('asset with co-located .data.js', () => {
    it('returns source="js" with the dataPath recorded, value undefined', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          'Button.data.js': 'export default { label: "dynamic" }',
        },
      });

      const map = await loadAssetData([btn], backend);

      const entry = map.get(btn.path);
      expect(entry.source).toBe('js');
      expect(entry.value).toBeUndefined();
      expect(entry.dataPath).toBe(`${ROOT}/Button.data.js`);
    });

    it('emits no warnings for a lone .data.js', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          'Button.data.js': 'export default {}',
        },
      });

      await loadAssetData([btn], backend);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── AC: BOTH present — .data.js wins ────────────────────────────────────
  describe('asset with BOTH .data.json and .data.js', () => {
    it('returns source="js" (.data.js wins) and emits a console.warn', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          'Button.data.json': '{"static": true}',
          'Button.data.js': 'export default { dynamic: true }',
        },
      });

      const map = await loadAssetData([btn], backend);

      const entry = map.get(btn.path);
      expect(entry.source).toBe('js');
      expect(entry.dataPath).toBe(`${ROOT}/Button.data.js`);

      expect(warnSpy).toHaveBeenCalledOnce();
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain('Button.jsx');
      expect(msg).toContain('.data.js');
      expect(msg).toContain('.data.json');
    });
  });

  // ── AC: no co-located data file ─────────────────────────────────────────
  describe('asset with no data file', () => {
    it('returns source="absent", no error, no warning', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          // no data file
        },
      });

      const map = await loadAssetData([btn], backend);

      const entry = map.get(btn.path);
      expect(entry.source).toBe('absent');
      expect(entry.value).toBeUndefined();
      expect(entry.dataPath).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  // ── AC: malformed .data.json ─────────────────────────────────────────────
  describe('malformed .data.json', () => {
    it('returns source="absent" and emits a console.warn with file path', async () => {
      const btn = asset('Button.jsx');
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Button.jsx': '',
          'Button.data.json': 'this is { not json',
        },
      });

      const map = await loadAssetData([btn], backend);

      const entry = map.get(btn.path);
      expect(entry.source).toBe('absent');

      expect(warnSpy).toHaveBeenCalledOnce();
      const msg = warnSpy.mock.calls[0][0];
      expect(msg).toContain('Button.data.json');
    });

    it('isolates the failure — other assets still load successfully', async () => {
      const bad = asset('Bad.jsx');
      const good = asset('Good.jsx');

      // Need separate directories to avoid name collision; use sub-paths instead
      // by building two separate asset nodes in the same dir with distinct names.
      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Bad.jsx': '',
          'Bad.data.json': '<<<invalid json>>>',
          'Good.jsx': '',
          'Good.data.json': '{"ok": true}',
        },
      });

      const map = await loadAssetData([bad, good], backend);

      expect(map.get(bad.path).source).toBe('absent');
      expect(map.get(good.path).source).toBe('json');
      expect(map.get(good.path).value).toEqual({ ok: true });
    });
  });

  // ── Multiple assets, independent results ─────────────────────────────────
  describe('multiple assets', () => {
    it('returns an entry for every asset, independently', async () => {
      const a = asset('Alpha.jsx');
      const b = asset('Beta.jsx');
      const c = asset('Gamma.jsx');

      const backend = makeMemoryFs('/proj/.lerret', {
        home: {
          'Alpha.jsx': '',
          'Alpha.data.json': '{"a":1}',
          'Beta.jsx': '',
          'Beta.data.js': 'export default { b: 2 }',
          'Gamma.jsx': '',
          // no data file for Gamma
        },
      });

      const map = await loadAssetData([a, b, c], backend);

      expect(map.size).toBe(3);
      expect(map.get(a.path).source).toBe('json');
      expect(map.get(a.path).value).toEqual({ a: 1 });

      expect(map.get(b.path).source).toBe('js');
      expect(map.get(b.path).dataPath).toContain('Beta.data.js');

      expect(map.get(c.path).source).toBe('absent');
    });
  });

  // ── Input validation ─────────────────────────────────────────────────────
  describe('input validation', () => {
    it('throws TypeError when assets is not an array', async () => {
      const backend = makeMemoryFs('/proj/.lerret', { home: {} });
      await expect(loadAssetData(null, backend)).rejects.toThrow(TypeError);
    });

    it('throws when backend does not satisfy FilesystemAccess contract', async () => {
      await expect(loadAssetData([], {})).rejects.toThrow(/FilesystemAccess/);
    });

    it('resolves with an empty map for an empty assets array', async () => {
      const backend = makeMemoryFs('/proj/.lerret', { home: {} });
      const map = await loadAssetData([], backend);
      expect(map.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// collectAssets helper
// ---------------------------------------------------------------------------

describe('collectAssets', () => {
  it('collects assets from pages and nested groups', () => {
    const a1 = createAssetNode({ name: 'A', fileName: 'A.jsx', path: '/p/A.jsx', assetKind: 'component', ext: '.jsx' });
    const a2 = createAssetNode({ name: 'B', fileName: 'B.jsx', path: '/p/g/B.jsx', assetKind: 'component', ext: '.jsx' });
    const a3 = createAssetNode({ name: 'C', fileName: 'C.md', path: '/p/g/h/C.md', assetKind: 'markdown', ext: '.md' });

    const project = createProjectNode({
      name: 'demo',
      path: '/proj/.lerret',
      pages: [
        createPageNode({
          name: 'home',
          path: '/proj/.lerret/home',
          assets: [a1],
          groups: [
            createGroupNode({
              name: 'g',
              path: '/proj/.lerret/home/g',
              assets: [a2],
              groups: [
                createGroupNode({
                  name: 'h',
                  path: '/proj/.lerret/home/g/h',
                  assets: [a3],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const flat = collectAssets(project);
    expect(flat).toHaveLength(3);
    expect(flat.map(a => a.path)).toContain(a1.path);
    expect(flat.map(a => a.path)).toContain(a2.path);
    expect(flat.map(a => a.path)).toContain(a3.path);
  });

  it('returns empty array for a project with no pages', () => {
    const project = createProjectNode({ name: 'empty', path: '/proj/.lerret' });
    expect(collectAssets(project)).toEqual([]);
  });
});
