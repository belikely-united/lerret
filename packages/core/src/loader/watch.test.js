// Tests for the normalized watch-event contract + incremental model patcher
// (`core/loader/watch.js`).
//
// The patcher is PURE — no filesystem, no DOM — so the suite is plain shape
// assertions against synthetic projects built with the model constructors,
// matching the style of `model.test.js` and `scan.test.js`.

import { describe, it, expect } from 'vitest';

import {
  createAssetNode,
  createGroupNode,
  createPageNode,
  createProjectNode,
  createFontFile,
} from './model.js';

import {
  applyWatchEvent,
  classifyPath,
  makeWatchEvent,
  watchEventType,
} from './watch.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROOT = '/proj/.lerret';

/** Build a `.jsx` component asset node at a given path. */
function jsxAsset(dirPath, name) {
  return createAssetNode({
    name,
    fileName: `${name}.jsx`,
    path: `${dirPath}/${name}.jsx`,
    assetKind: 'component',
    ext: '.jsx',
  });
}

/**
 * A minimal project model:
 *   .lerret/
 *     home/
 *       Hero.jsx
 *       components/
 *         Card.jsx
 *     about/
 *       _fonts/  (handled at root level via project.fonts; here we keep a font)
 */
function makeProject() {
  const buttons = createGroupNode({
    name: 'buttons',
    path: `${ROOT}/home/components/buttons`,
    assets: [jsxAsset(`${ROOT}/home/components/buttons`, 'PrimaryButton')],
  });
  const components = createGroupNode({
    name: 'components',
    path: `${ROOT}/home/components`,
    groups: [buttons],
    assets: [jsxAsset(`${ROOT}/home/components`, 'Card')],
  });
  const home = createPageNode({
    name: 'home',
    path: `${ROOT}/home`,
    groups: [components],
    assets: [jsxAsset(`${ROOT}/home`, 'Hero')],
  });
  const about = createPageNode({ name: 'about', path: `${ROOT}/about` });
  const font = createFontFile({
    fileName: 'Brand.woff2',
    path: `${ROOT}/_fonts/Brand.woff2`,
  });
  return createProjectNode({
    name: 'proj',
    path: ROOT,
    pages: [home, about],
    fonts: font ? [font] : [],
  });
}

// ---------------------------------------------------------------------------
// makeWatchEvent — shape contract
// ---------------------------------------------------------------------------

describe('makeWatchEvent', () => {
  it('builds an add/change/remove event with the canonical shape', () => {
    expect(makeWatchEvent('add', `${ROOT}/x/Y.jsx`)).toEqual({
      type: 'add',
      path: `${ROOT}/x/Y.jsx`,
    });
    expect(makeWatchEvent('change', `${ROOT}/a/b.jsx`).type).toBe('change');
    expect(makeWatchEvent('remove', `${ROOT}/a`).type).toBe('remove');
  });

  it('strips a trailing slash on the path', () => {
    expect(makeWatchEvent('remove', `${ROOT}/folder/`).path).toBe(`${ROOT}/folder`);
  });

  it('rejects an unknown event type', () => {
    expect(() => makeWatchEvent('mutate', `${ROOT}/a.jsx`)).toThrow(/type must be/);
  });

  it('rejects a non-string or empty path', () => {
    expect(() => makeWatchEvent('add', '')).toThrow(/non-empty/);
    // @ts-expect-error — exercising the runtime guard
    expect(() => makeWatchEvent('add', undefined)).toThrow();
  });

  it('exposes the watch-event-type constants', () => {
    expect(watchEventType).toEqual({ ADD: 'add', CHANGE: 'change', REMOVE: 'remove' });
  });
});

// ---------------------------------------------------------------------------
// classifyPath — the same rules `scan` enforces, shared by the watcher layer
// ---------------------------------------------------------------------------

describe('classifyPath', () => {
  it('classifies a regular root folder as a page', () => {
    expect(classifyPath(ROOT, `${ROOT}/marketing`, true).role).toBe('page-folder');
  });

  it('classifies a nested folder as a group', () => {
    expect(classifyPath(ROOT, `${ROOT}/home/components`, true).role).toBe('group-folder');
    expect(classifyPath(ROOT, `${ROOT}/home/components/buttons`, true).role).toBe('group-folder');
  });

  it('classifies a recognized asset file inside a page', () => {
    expect(classifyPath(ROOT, `${ROOT}/home/Hero.jsx`, false).role).toBe('asset-file');
    expect(classifyPath(ROOT, `${ROOT}/home/Notes.md`, false).role).toBe('asset-file');
    expect(classifyPath(ROOT, `${ROOT}/home/Toast.tsx`, false).role).toBe('asset-file');
  });

  it('classifies a font file under _fonts/', () => {
    expect(classifyPath(ROOT, `${ROOT}/_fonts/Brand.woff2`, false).role).toBe('font-file');
  });

  it('treats _fonts/ root as a reserved folder', () => {
    expect(classifyPath(ROOT, `${ROOT}/_fonts`, true).role).toBe('reserved-folder');
  });

  it('treats anything else under a reserved folder as irrelevant', () => {
    expect(classifyPath(ROOT, `${ROOT}/_assets/mark.png`, false).role).toBe('irrelevant');
    // An asset extension inside `_fonts/` (a `.jsx` there) is still irrelevant.
    expect(classifyPath(ROOT, `${ROOT}/_fonts/script.jsx`, false).role).toBe('irrelevant');
  });

  it('treats a root-level file as irrelevant — pages are folders, not files', () => {
    expect(classifyPath(ROOT, `${ROOT}/README.md`, false).role).toBe('irrelevant');
  });

  it('treats a config/data/image file as irrelevant', () => {
    expect(classifyPath(ROOT, `${ROOT}/home/config.json`, false).role).toBe('irrelevant');
    expect(classifyPath(ROOT, `${ROOT}/home/Hero.data.json`, false).role).toBe('irrelevant');
    expect(classifyPath(ROOT, `${ROOT}/home/logo.png`, false).role).toBe('irrelevant');
  });

  it('returns irrelevant for a path outside the scan root', () => {
    expect(classifyPath(ROOT, '/elsewhere/foo.jsx').role).toBe('irrelevant');
  });
});

// ---------------------------------------------------------------------------
// applyWatchEvent — add
// ---------------------------------------------------------------------------

describe('applyWatchEvent — add', () => {
  it('adds a new page when a regular root folder appears', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/marketing`),
      { isDirectory: true },
    );
    expect(next).not.toBe(prev);
    const pageNames = next.pages.map((p) => p.name);
    expect(pageNames).toContain('marketing');
    // Pages stay name-sorted (about, home, marketing).
    expect(pageNames).toEqual([...pageNames].sort());
    // The new page has empty groups/assets — it is a fresh node.
    const m = next.pages.find((p) => p.name === 'marketing');
    expect(m.assets).toEqual([]);
    expect(m.groups).toEqual([]);
  });

  it('adds a new asset inside an existing page', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/home/Banner.jsx`),
      { isDirectory: false },
    );
    expect(next).not.toBe(prev);
    const home = next.pages.find((p) => p.name === 'home');
    expect(home.assets.map((a) => a.fileName)).toEqual(['Banner.jsx', 'Hero.jsx']);
    // The new asset carries the canonical fields.
    const banner = home.assets.find((a) => a.fileName === 'Banner.jsx');
    expect(banner).toMatchObject({
      kind: 'asset',
      name: 'Banner',
      assetKind: 'component',
      ext: '.jsx',
      path: `${ROOT}/home/Banner.jsx`,
    });
  });

  it('adds a new asset inside a nested group', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/home/components/buttons/IconButton.jsx`),
      { isDirectory: false },
    );
    expect(next).not.toBe(prev);
    // The fixture inserts `home` first, then `about`. `createProjectNode` does
    // not sort — pages keep insertion order — so `home` is `pages[0]`. (A new
    // page added later is name-sorted into place; existing pages are not
    // re-sorted.)
    const buttons = next.pages[0].groups[0].groups[0];
    expect(buttons.path).toBe(`${ROOT}/home/components/buttons`);
    expect(buttons.assets.map((a) => a.fileName)).toEqual([
      'IconButton.jsx',
      'PrimaryButton.jsx',
    ]);
  });

  it('adds a new group inside an existing page', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/home/cards`),
      { isDirectory: true },
    );
    expect(next).not.toBe(prev);
    const home = next.pages.find((p) => p.name === 'home');
    const names = home.groups.map((g) => g.name);
    expect(names).toContain('cards');
    expect(names).toEqual([...names].sort());
    const cards = home.groups.find((g) => g.name === 'cards');
    expect(cards.assets).toEqual([]);
    expect(cards.groups).toEqual([]);
  });

  it('adds a new font file to project.fonts', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/_fonts/Display.woff`),
      { isDirectory: false },
    );
    expect(next).not.toBe(prev);
    expect(next.fonts.map((f) => f.fileName)).toEqual(['Brand.woff2', 'Display.woff']);
    const display = next.fonts.find((f) => f.fileName === 'Display.woff');
    expect(display.family).toBe('Display');
    expect(display.format).toBe('woff');
  });

  it('is a no-op for an add of a reserved-folder file (config / image / _assets)', () => {
    const prev = makeProject();
    expect(
      applyWatchEvent(prev, makeWatchEvent('add', `${ROOT}/home/config.json`), { isDirectory: false }),
    ).toBe(prev);
    expect(
      applyWatchEvent(prev, makeWatchEvent('add', `${ROOT}/_assets/logo.png`), { isDirectory: false }),
    ).toBe(prev);
    expect(
      applyWatchEvent(prev, makeWatchEvent('add', `${ROOT}/home/logo.png`), { isDirectory: false }),
    ).toBe(prev);
  });

  it('is idempotent — adding the same asset twice does not duplicate it', () => {
    const prev = makeProject();
    const once = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/home/Banner.jsx`),
      { isDirectory: false },
    );
    const twice = applyWatchEvent(
      once,
      makeWatchEvent('add', `${ROOT}/home/Banner.jsx`),
      { isDirectory: false },
    );
    expect(twice).toBe(once);
    const home = twice.pages.find((p) => p.name === 'home');
    expect(home.assets.filter((a) => a.fileName === 'Banner.jsx')).toHaveLength(1);
  });

  it('is silent when the add targets an unknown parent (race-safe)', () => {
    const prev = makeProject();
    // No `ghost-page` exists in the model yet — the asset add should be ignored,
    // not throw. (A subsequent page add would materialize it.)
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('add', `${ROOT}/ghost-page/Card.jsx`),
      { isDirectory: false },
    );
    expect(next).toBe(prev);
  });
});

// ---------------------------------------------------------------------------
// applyWatchEvent — remove
// ---------------------------------------------------------------------------

describe('applyWatchEvent — remove', () => {
  it('removes an asset from its page', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home/Hero.jsx`));
    expect(next).not.toBe(prev);
    const home = next.pages.find((p) => p.name === 'home');
    expect(home.assets.map((a) => a.fileName)).toEqual([]);
  });

  it('removes an asset from a nested group', () => {
    const prev = makeProject();
    const next = applyWatchEvent(
      prev,
      makeWatchEvent('remove', `${ROOT}/home/components/buttons/PrimaryButton.jsx`),
    );
    expect(next).not.toBe(prev);
    // home is pages[0] in insertion order (see the matching add test above).
    const buttons = next.pages[0].groups[0].groups[0];
    expect(buttons.assets).toEqual([]);
  });

  it('removes a group folder and cascades — every nested asset disappears', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home/components`));
    expect(next).not.toBe(prev);
    const home = next.pages.find((p) => p.name === 'home');
    expect(home.groups).toEqual([]);
    // Hero.jsx (a sibling of the removed group) is untouched.
    expect(home.assets.map((a) => a.fileName)).toEqual(['Hero.jsx']);
  });

  it('removes a page folder and cascades to all its descendants', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home`));
    expect(next).not.toBe(prev);
    expect(next.pages.map((p) => p.name)).toEqual(['about']);
  });

  it('removes a font from project.fonts', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/_fonts/Brand.woff2`));
    expect(next).not.toBe(prev);
    expect(next.fonts).toEqual([]);
  });

  it('is a no-op when removing a path the model never tracked', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home/config.json`));
    expect(next).toBe(prev);
  });

  it('is idempotent — removing an already-removed path is a no-op', () => {
    const prev = makeProject();
    const once = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home/Hero.jsx`));
    const twice = applyWatchEvent(once, makeWatchEvent('remove', `${ROOT}/home/Hero.jsx`));
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// applyWatchEvent — change
// ---------------------------------------------------------------------------

describe('applyWatchEvent — change', () => {
  it('is a no-op on the model — content edits do not restructure the tree', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('change', `${ROOT}/home/Hero.jsx`));
    expect(next).toBe(prev);
  });

  it('is a no-op even for a font content change', () => {
    const prev = makeProject();
    const next = applyWatchEvent(prev, makeWatchEvent('change', `${ROOT}/_fonts/Brand.woff2`));
    expect(next).toBe(prev);
  });
});

// ---------------------------------------------------------------------------
// applyWatchEvent — rename (modeled as remove + add)
// ---------------------------------------------------------------------------

describe('applyWatchEvent — rename (add + remove)', () => {
  it('a rename Hero.jsx → Banner.jsx is one remove and one add', () => {
    const prev = makeProject();
    const afterRemove = applyWatchEvent(prev, makeWatchEvent('remove', `${ROOT}/home/Hero.jsx`));
    const next = applyWatchEvent(
      afterRemove,
      makeWatchEvent('add', `${ROOT}/home/Banner.jsx`),
      { isDirectory: false },
    );
    const home = next.pages.find((p) => p.name === 'home');
    expect(home.assets.map((a) => a.fileName)).toEqual(['Banner.jsx']);
    expect(home.assets[0].name).toBe('Banner');
  });
});

// ---------------------------------------------------------------------------
// Defensive contract
// ---------------------------------------------------------------------------

describe('applyWatchEvent — contract', () => {
  it('rejects when called without a ProjectNode', () => {
    expect(() =>
      applyWatchEvent(/** @type {any} */ ({}), makeWatchEvent('change', `${ROOT}/x`)),
    ).toThrow(/expected a ProjectNode/);
  });

  it('rejects when called with a malformed event', () => {
    const prev = makeProject();
    expect(() => applyWatchEvent(prev, /** @type {any} */ (null))).toThrow();
    expect(() =>
      applyWatchEvent(prev, /** @type {any} */ ({ type: 'add' })),
    ).toThrow(/event.path/);
  });
});
