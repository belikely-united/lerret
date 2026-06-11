// Tests for the project loader (`scan`) — driven by a pure, in-memory
// `FilesystemAccess` fake so the suite needs no `node:fs` and stays
// environment-agnostic, exactly like the `core` code under test.
//
// Coverage: a single page, multiple pages, groups nested several levels
// deep, a reserved `_fonts/` root folder excluded from pages, unrecognized
// files excluded, and an empty page/group folder.
//
// Also covers custom-font discovery: font files in the reserved `_fonts/`
// folder are collected onto `project.fonts`, with non-font files skipped and
// an absent/empty `_fonts/` yielding `[]`.

import { describe, it, expect } from 'vitest';

import { isFilesystemAccess } from '../fs/filesystem.js';

import { scan } from './scan.js';

// ---------------------------------------------------------------------------
// In-memory FilesystemAccess fake
// ---------------------------------------------------------------------------

/**
 * Build an in-memory `FilesystemAccess` from a nested plain-object tree.
 *
 * Tree shape: a key whose value is an object is a directory; a key whose value
 * is a string is a file (the string is its content). Paths are
 * forward-slash `LerretPath`s, exactly as the real backends produce.
 *
 * Only `readDir` / `readFile` are exercised by the loader; `writeFile` and
 * `watch` are present so the object structurally satisfies the contract.
 *
 * @param {LerretPath} rootPath  The absolute path the tree is mounted at.
 * @param {object} tree          The nested directory/file object.
 * @returns {import('../fs/filesystem.js').FilesystemAccess}
 */
function makeMemoryFs(rootPath, tree) {
  /**
   * Resolve a path to its node in `tree`, or `undefined` if absent.
   * @param {string} path
   * @returns {object | string | undefined}
   */
  function resolve(path) {
    const norm = path.replace(/\/+$/, '');
    if (norm === rootPath.replace(/\/+$/, '')) {
      return tree;
    }
    if (!norm.startsWith(rootPath.replace(/\/+$/, '') + '/')) {
      return undefined;
    }
    const rest = norm.slice(rootPath.replace(/\/+$/, '').length + 1);
    let node = /** @type {object | string} */ (tree);
    for (const segment of rest.split('/')) {
      if (node === null || typeof node !== 'object' || !(segment in node)) {
        return undefined;
      }
      node = node[segment];
    }
    return node;
  }

  return {
    async readDir(dirPath) {
      const node = resolve(dirPath);
      if (node === undefined) {
        throw new Error(`ENOENT: no such directory: ${dirPath}`);
      }
      if (typeof node !== 'object') {
        throw new Error(`ENOTDIR: not a directory: ${dirPath}`);
      }
      const base = dirPath.replace(/\/+$/, '');
      // Insertion order is intentionally arbitrary here — `scan` must sort.
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
      if (node === undefined || typeof node === 'object') {
        throw new Error(`ENOENT: no such file: ${filePath}`);
      }
      return node;
    },
    async writeFile() {
      throw new Error('writeFile is not used by the loader');
    },
    watch() {
      return { close() {} };
    },
    async deleteFile() {
      throw new Error('deleteFile is not used by the loader');
    },
    async mkdir() {
      throw new Error('mkdir is not used by the loader');
    },
    async exists() {
      return false;
    },
    capabilities: { canWrite: false, canWatch: false, canReveal: false },
  };
}

// ---------------------------------------------------------------------------
// Fake sanity check
// ---------------------------------------------------------------------------

describe('in-memory FilesystemAccess fake', () => {
  it('structurally satisfies the FilesystemAccess contract', () => {
    expect(isFilesystemAccess(makeMemoryFs('/p/.lerret', {}))).toBe(true);
  });

  it('returns DirEntry shapes from readDir, in arbitrary order', async () => {
    const fs = makeMemoryFs('/p/.lerret', { 'B.jsx': 'x', sub: {} });
    const entries = await fs.readDir('/p/.lerret');
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['B.jsx']).toEqual({
      name: 'B.jsx',
      path: '/p/.lerret/B.jsx',
      kind: 'file',
      isFile: true,
      isDirectory: false,
    });
    expect(byName.sub.isDirectory).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scan — signature & guards
// ---------------------------------------------------------------------------

describe('scan — guards', () => {
  it('rejects a backend that violates the FilesystemAccess contract', async () => {
    await expect(scan({}, '/p/.lerret')).rejects.toThrow(
      /FilesystemAccess contract/,
    );
  });

  it('rejects a missing or empty scan root', async () => {
    const fs = makeMemoryFs('/p/.lerret', {});
    await expect(scan(fs, '')).rejects.toThrow(/non-empty path string/);
    await expect(scan(fs, /** @type {any} */ (undefined))).rejects.toThrow(
      /non-empty path string/,
    );
  });

  it('propagates a backend rejection when the scan root does not exist', async () => {
    const fs = makeMemoryFs('/p/.lerret', {});
    await expect(scan(fs, '/p/does-not-exist')).rejects.toThrow(/ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// scan — project root shape
// ---------------------------------------------------------------------------

describe('scan — project node', () => {
  it('builds a project node naming the folder that contains .lerret/', async () => {
    const fs = makeMemoryFs('/Users/me/my-app/.lerret', {});
    const project = await scan(fs, '/Users/me/my-app/.lerret');
    expect(project.kind).toBe('project');
    expect(project.name).toBe('my-app');
    expect(project.path).toBe('/Users/me/my-app/.lerret');
    expect(project.pages).toEqual([]);
  });

  it('handles a project with no pages — empty pages array, no crash', async () => {
    const fs = makeMemoryFs('/p/.lerret', {});
    const project = await scan(fs, '/p/.lerret');
    expect(project.pages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scan — pages (FR2)
// ---------------------------------------------------------------------------

describe('scan — single page (FR2)', () => {
  it('maps one regular root subfolder to a page with its assets', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        'Hero.jsx': 'export default () => null',
        'Notes.md': '# notes',
      },
    });
    const project = await scan(fs, '/p/.lerret');

    expect(project.pages).toHaveLength(1);
    const [home] = project.pages;
    expect(home.kind).toBe('page');
    expect(home.name).toBe('Home');
    expect(home.path).toBe('/p/.lerret/Home');
    expect(home.groups).toEqual([]);
    expect(home.assets.map((a) => a.fileName)).toEqual(['Hero.jsx', 'Notes.md']);

    const hero = home.assets.find((a) => a.fileName === 'Hero.jsx');
    expect(hero).toEqual({
      kind: 'asset',
      name: 'Hero',
      fileName: 'Hero.jsx',
      path: '/p/.lerret/Home/Hero.jsx',
      assetKind: 'component',
      ext: '.jsx',
    });
    const notes = home.assets.find((a) => a.fileName === 'Notes.md');
    expect(notes.assetKind).toBe('markdown');
    expect(notes.name).toBe('Notes');
  });
});

describe('scan — multiple pages (FR2)', () => {
  it('maps every regular root subfolder to a page, sorted by name', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Pricing: { 'Plan.tsx': 'x' },
      About: { 'Bio.md': 'x' },
      Home: { 'Hero.jsx': 'x' },
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.pages.map((p) => p.name)).toEqual(['About', 'Home', 'Pricing']);
  });

  it('ignores files sitting directly under .lerret/ — only folders are pages', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: { 'Hero.jsx': 'x' },
      'README.md': 'a stray file at the root',
      'Loose.jsx': 'a stray component at the root',
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.pages.map((p) => p.name)).toEqual(['Home']);
  });
});

// ---------------------------------------------------------------------------
// scan — nested groups, arbitrary depth (FR3)
// ---------------------------------------------------------------------------

describe('scan — nested groups several levels deep (FR3)', () => {
  it('maps subfolders of a page/group to nested groups at arbitrary depth', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        'Hero.jsx': 'x',
        sections: {
          'Banner.jsx': 'x',
          cards: {
            'Card.tsx': 'x',
            variants: {
              'Primary.jsx': 'x',
            },
          },
        },
      },
    });
    const project = await scan(fs, '/p/.lerret');

    const [home] = project.pages;
    expect(home.assets.map((a) => a.fileName)).toEqual(['Hero.jsx']);
    expect(home.groups).toHaveLength(1);

    const sections = home.groups[0];
    expect(sections.kind).toBe('group');
    expect(sections.name).toBe('sections');
    expect(sections.path).toBe('/p/.lerret/Home/sections');
    expect(sections.assets.map((a) => a.fileName)).toEqual(['Banner.jsx']);
    expect(sections.groups).toHaveLength(1);

    const cards = sections.groups[0];
    expect(cards.name).toBe('cards');
    expect(cards.assets.map((a) => a.fileName)).toEqual(['Card.tsx']);
    expect(cards.groups).toHaveLength(1);

    const variants = cards.groups[0];
    expect(variants.kind).toBe('group');
    expect(variants.name).toBe('variants');
    expect(variants.path).toBe('/p/.lerret/Home/sections/cards/variants');
    expect(variants.assets.map((a) => a.fileName)).toEqual(['Primary.jsx']);
    expect(variants.groups).toEqual([]);
  });

  it('sorts nested groups and assets by name for a stable model', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        zeta: {},
        alpha: {},
        'Z.jsx': 'x',
        'A.jsx': 'x',
      },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    expect(home.groups.map((g) => g.name)).toEqual(['alpha', 'zeta']);
    expect(home.assets.map((a) => a.fileName)).toEqual(['A.jsx', 'Z.jsx']);
  });

  it('treats an underscore-prefixed subfolder nested in a page as an ordinary group', async () => {
    // The reservation rule is root-only — a nested `_internal/` is NOT
    // reserved; it becomes a normal group.
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        _internal: { 'Secret.jsx': 'x' },
      },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    expect(home.groups).toHaveLength(1);
    expect(home.groups[0].name).toBe('_internal');
    expect(home.groups[0].assets.map((a) => a.fileName)).toEqual(['Secret.jsx']);
  });
});

// ---------------------------------------------------------------------------
// scan — reserved underscore root folders (FR5)
// ---------------------------------------------------------------------------

describe('scan — reserved _fonts/ root folder (FR5)', () => {
  it('excludes underscore-prefixed root folders from pages', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: { 'Hero.jsx': 'x' },
      _fonts: { 'Inter.woff2': 'binary-ish' },
      _assets: { 'logo.png': 'binary-ish' },
    });
    const project = await scan(fs, '/p/.lerret');
    // Only `Home` is a page; `_fonts` and `_assets` are reserved, not pages.
    expect(project.pages.map((p) => p.name)).toEqual(['Home']);
  });

  it('does not represent reserved folders as groups either', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _fonts: { nested: { 'Inter.woff2': 'x' } },
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.pages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// scan — custom fonts from _fonts/ (FR12)
// ---------------------------------------------------------------------------

describe('scan — custom fonts from _fonts/ (FR12)', () => {
  it('collects every recognized font file in _fonts/ onto project.fonts', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: { 'Hero.jsx': 'x' },
      _fonts: {
        'MyBrandFont.woff2': 'binary',
        'Display.ttf': 'binary',
      },
    });
    const project = await scan(fs, '/p/.lerret');

    // Sorted by file name; each font carries family, path, ext, and format.
    expect(project.fonts).toEqual([
      {
        family: 'Display',
        fileName: 'Display.ttf',
        path: '/p/.lerret/_fonts/Display.ttf',
        ext: '.ttf',
        format: 'truetype',
      },
      {
        family: 'MyBrandFont',
        fileName: 'MyBrandFont.woff2',
        path: '/p/.lerret/_fonts/MyBrandFont.woff2',
        ext: '.woff2',
        format: 'woff2',
      },
    ]);
    // The font discovery does not turn `_fonts/` into a page.
    expect(project.pages.map((p) => p.name)).toEqual(['Home']);
  });

  it('derives the family name from the font file name', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _fonts: { 'MyBrandFont.woff2': 'binary' },
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.fonts).toHaveLength(1);
    expect(project.fonts[0].family).toBe('MyBrandFont');
  });

  it('skips a non-font file in _fonts/ without breaking the valid fonts', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _fonts: {
        'Brand.woff2': 'binary', // valid font
        'OFL.txt': 'license text', // unsupported — skipped
        'README.md': '# fonts', // unsupported — skipped
        'notes': 'no extension', // unsupported — skipped
      },
    });
    const project = await scan(fs, '/p/.lerret');
    // Only the real font is registered; the non-font files do not appear.
    expect(project.fonts.map((f) => f.fileName)).toEqual(['Brand.woff2']);
  });

  it('ignores a subfolder inside _fonts/ — fonts are flat files', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _fonts: {
        'Brand.woff2': 'binary',
        weights: { 'Brand-Bold.woff2': 'binary' }, // nested — not collected
      },
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.fonts.map((f) => f.fileName)).toEqual(['Brand.woff2']);
  });

  it('yields an empty fonts array when _fonts/ is absent', async () => {
    const fs = makeMemoryFs('/p/.lerret', { Home: { 'Hero.jsx': 'x' } });
    const project = await scan(fs, '/p/.lerret');
    expect(project.fonts).toEqual([]);
  });

  it('yields an empty fonts array when _fonts/ is present but empty', async () => {
    const fs = makeMemoryFs('/p/.lerret', { Home: { 'Hero.jsx': 'x' }, _fonts: {} });
    const project = await scan(fs, '/p/.lerret');
    expect(project.fonts).toEqual([]);
  });

  it('yields an empty fonts array when _fonts/ holds only unsupported files', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _fonts: { 'OFL.txt': 'license', 'README.md': '# x' },
    });
    const project = await scan(fs, '/p/.lerret');
    expect(project.fonts).toEqual([]);
  });

  it('does not treat other underscore folders (_assets/) as fonts', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      _assets: { 'logo.woff2': 'binary' }, // a .woff2, but NOT in _fonts/
      _fonts: { 'Brand.woff2': 'binary' },
    });
    const project = await scan(fs, '/p/.lerret');
    // Only `_fonts/` is scanned for fonts — `_assets/` is left alone.
    expect(project.fonts.map((f) => f.path)).toEqual([
      '/p/.lerret/_fonts/Brand.woff2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// scan — unrecognized / non-asset files excluded (FR6)
// ---------------------------------------------------------------------------

describe('scan — unrecognized files excluded (FR6)', () => {
  it('keeps only .jsx/.tsx/.md files; excludes config, data, resource, and unknown files', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        'Hero.jsx': 'x', // recognized — component
        'Card.tsx': 'x', // recognized — component
        'Notes.md': 'x', // recognized — markdown
        'config.json': '{}', // configuration — not an asset node
        'Hero.data.json': '{}', // data file — not an asset node
        'Hero.data.js': 'export default {}', // data file — not an asset node
        'logo.png': 'binary', // resource — not an asset node
        'Inter.woff2': 'binary', // resource — not an asset node
        'helper.js': 'plain js', // unrecognized — excluded
        'styles.css': 'css', // unrecognized — excluded
        '.gitkeep': '', // dotfile, no extension — excluded
        'README': 'no extension', // no extension — excluded
      },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    expect(home.assets.map((a) => a.fileName).sort()).toEqual([
      'Card.tsx',
      'Hero.jsx',
      'Notes.md',
    ]);
  });

  it('excludes non-asset files inside nested groups too', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: {
        group: {
          'Real.jsx': 'x',
          'data.json': '{}',
          'image.svg': 'x',
        },
      },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    expect(home.groups[0].assets.map((a) => a.fileName)).toEqual(['Real.jsx']);
  });

  it('classifies extensions case-insensitively', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: { 'Hero.JSX': 'x', 'Doc.MD': 'x' },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    const byFile = Object.fromEntries(home.assets.map((a) => [a.fileName, a]));
    expect(byFile['Hero.JSX'].assetKind).toBe('component');
    expect(byFile['Hero.JSX'].ext).toBe('.jsx');
    expect(byFile['Doc.MD'].assetKind).toBe('markdown');
  });
});

// ---------------------------------------------------------------------------
// scan — empty page / group folders (no crash, no omission)
// ---------------------------------------------------------------------------

describe('scan — empty folders', () => {
  it('keeps an empty page in the model with zero groups and assets', async () => {
    const fs = makeMemoryFs('/p/.lerret', { Empty: {} });
    const project = await scan(fs, '/p/.lerret');
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0]).toEqual({
      kind: 'page',
      name: 'Empty',
      path: '/p/.lerret/Empty',
      groups: [],
      assets: [],
    });
  });

  it('keeps an empty group nested inside a page', async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      Home: { 'Hero.jsx': 'x', emptyGroup: {} },
    });
    const [home] = (await scan(fs, '/p/.lerret')).pages;
    expect(home.groups).toHaveLength(1);
    expect(home.groups[0]).toEqual({
      kind: 'group',
      name: 'emptyGroup',
      path: '/p/.lerret/Home/emptyGroup',
      groups: [],
      assets: [],
    });
  });

  it('keeps an empty page that contains only an empty group (no assets anywhere)', async () => {
    const fs = makeMemoryFs('/p/.lerret', { Page: { Group: {} } });
    const [page] = (await scan(fs, '/p/.lerret')).pages;
    expect(page.assets).toEqual([]);
    expect(page.groups[0].assets).toEqual([]);
    expect(page.groups[0].groups).toEqual([]);
  });
});

describe('dot-prefixed folders are reserved (Epic 8 .state)', () => {
  it("'.state' under .lerret/ is NOT a page (snapshot store stays invisible)", async () => {
    const fs = makeMemoryFs('/p/.lerret', {
      kit: { 'a.jsx': 'export default () => null;' },
      '.state': { history: { manifests: { 'm1.json': '{}' } } },
      '.git': { HEAD: 'ref: x' },
    });
    const project = await scan(fs, '/p/.lerret');
    const pageNames = project.pages.map((p) => p.name);
    expect(pageNames).toContain('kit');
    expect(pageNames).not.toContain('.state');
    expect(pageNames).not.toContain('.git');
  });
});
