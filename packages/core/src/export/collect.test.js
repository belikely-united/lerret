// Tests for collectArtboards (FR36).
//
// All tests are PURE: no filesystem access, no imports of Node built-ins.
// Fixtures build up minimal ProjectNode trees using the model constructors from
// `../loader/model.js` so that tests stay decoupled from internal details.
//
// Test scenarios:
//   (a) whole-project scope — all assets across all pages
//   (b) single-page scope — only that page's assets and nested-group assets
//   (c) single-group scope — only that group's subtree
//   (d) deep nested groups — locationSegments chain is correct
//   (e) missing page path → throws RangeError
//   (f) missing group path → throws RangeError
//   (g) empty page → returns []
//   (h) empty project → returns []
//   (i) sort / walk order — depth-first pre-order within each container
//   (j) whole-project via model.path sentinel
//   (k) null scope === whole project
//   (l) undefined scope === whole project
//   (m) null model → throws TypeError
//   (n) group-scoped locationPath and locationSegments for root-level assets

import { describe, it, expect } from 'vitest';

import {
  createProjectNode,
  createPageNode,
  createGroupNode,
  createAssetNode,
} from '../loader/model.js';
import { collectArtboards } from './collect.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * Make a minimal AssetNode with just enough fields for traversal tests.
 * Path is `${parentPath}/${fileName}` for convenience.
 *
 * @param {string} name
 * @param {string} parentPath
 * @returns {import('../loader/model.js').AssetNode}
 */
function asset(name, parentPath) {
  const fileName = `${name}.jsx`;
  return createAssetNode({
    name,
    fileName,
    path: `${parentPath}/${fileName}`,
    assetKind: 'component',
    ext: '.jsx',
  });
}

/**
 * Tiny project with:
 *   .lerret/
 *     ui/           ← page
 *       Button.jsx
 *       icons/      ← group
 *         Icon.jsx
 *     marketing/    ← page
 *       Hero.jsx
 */
function buildTwoPageProject() {
  const iconsGroup = createGroupNode({
    name: 'icons',
    path: '.lerret/ui/icons',
    assets: [asset('Icon', '.lerret/ui/icons')],
    groups: [],
  });
  const uiPage = createPageNode({
    name: 'ui',
    path: '.lerret/ui',
    assets: [asset('Button', '.lerret/ui')],
    groups: [iconsGroup],
  });
  const marketingPage = createPageNode({
    name: 'marketing',
    path: '.lerret/marketing',
    assets: [asset('Hero', '.lerret/marketing')],
    groups: [],
  });
  return createProjectNode({
    name: 'my-project',
    path: '.lerret',
    pages: [uiPage, marketingPage],
  });
}

/**
 * Project with deeply nested groups:
 *   .lerret/
 *     design/               ← page
 *       components/         ← group (depth 1)
 *         buttons/          ← group (depth 2)
 *           primary/        ← group (depth 3)
 *             Primary.jsx
 *           Secondary.jsx
 */
function buildDeepProject() {
  const primaryGroup = createGroupNode({
    name: 'primary',
    path: '.lerret/design/components/buttons/primary',
    assets: [asset('Primary', '.lerret/design/components/buttons/primary')],
    groups: [],
  });
  const buttonsGroup = createGroupNode({
    name: 'buttons',
    path: '.lerret/design/components/buttons',
    assets: [asset('Secondary', '.lerret/design/components/buttons')],
    groups: [primaryGroup],
  });
  const componentsGroup = createGroupNode({
    name: 'components',
    path: '.lerret/design/components',
    assets: [],
    groups: [buttonsGroup],
  });
  const designPage = createPageNode({
    name: 'design',
    path: '.lerret/design',
    assets: [],
    groups: [componentsGroup],
  });
  return createProjectNode({
    name: 'deep-project',
    path: '.lerret',
    pages: [designPage],
  });
}

// ---------------------------------------------------------------------------
// (a) Whole-project scope via null — all assets across all pages
// ---------------------------------------------------------------------------

describe('collectArtboards — whole project (null scope)', () => {
  it('(a) returns all assets across all pages and groups', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, null);
    const names = artboards.map((a) => a.asset.name);
    // depth-first within each page: Button (ui), Icon (ui/icons), Hero (marketing)
    expect(names).toEqual(['Button', 'Icon', 'Hero']);
  });

  it('(a) each artboard carries the correct pagePath', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, null);
    const [button, icon, hero] = artboards;
    expect(button.pagePath).toBe('.lerret/ui');
    expect(icon.pagePath).toBe('.lerret/ui');
    expect(hero.pagePath).toBe('.lerret/marketing');
  });

  it('(a) assetPath equals asset.path', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, null);
    for (const ab of artboards) {
      expect(ab.assetPath).toBe(ab.asset.path);
    }
  });

  it('(a) groupPath is null for page-level assets, group path for group assets', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, null);
    const [button, icon, hero] = artboards;
    expect(button.groupPath).toBeNull();
    expect(icon.groupPath).toBe('.lerret/ui/icons');
    expect(hero.groupPath).toBeNull();
  });

  it('(a) locationPath and locationSegments reflect group nesting', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, null);
    const [button, icon, hero] = artboards;

    expect(button.locationPath).toBe('');
    expect(button.locationSegments).toEqual([]);

    expect(icon.locationPath).toBe('icons');
    expect(icon.locationSegments).toEqual(['icons']);

    expect(hero.locationPath).toBe('');
    expect(hero.locationSegments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (j) Whole-project via model.path sentinel
// ---------------------------------------------------------------------------

describe('collectArtboards — whole project (model.path scope)', () => {
  it('(j) model.path as scope collects all assets', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, model.path);
    const names = artboards.map((a) => a.asset.name);
    expect(names).toEqual(['Button', 'Icon', 'Hero']);
  });
});

// ---------------------------------------------------------------------------
// (k) (l) null / undefined sentinel
// ---------------------------------------------------------------------------

describe('collectArtboards — whole project (undefined scope)', () => {
  it('(k/l) undefined scope behaves the same as null', () => {
    const model = buildTwoPageProject();
    const byNull = collectArtboards(model, null);
    const byUndefined = collectArtboards(model, undefined);
    expect(byUndefined.map((a) => a.asset.name)).toEqual(byNull.map((a) => a.asset.name));
  });
});

// ---------------------------------------------------------------------------
// (b) Single-page scope
// ---------------------------------------------------------------------------

describe('collectArtboards — single page scope', () => {
  it('(b) returns only assets on the targeted page', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, '.lerret/marketing');
    const names = artboards.map((a) => a.asset.name);
    expect(names).toEqual(['Hero']);
  });

  it('(b) includes nested-group assets of the page', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, '.lerret/ui');
    const names = artboards.map((a) => a.asset.name);
    // Button (page level) then Icon (icons group)
    expect(names).toEqual(['Button', 'Icon']);
  });

  it('(b) locationSegments for page-scoped group asset includes the group name', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, '.lerret/ui');
    const iconAb = artboards.find((a) => a.asset.name === 'Icon');
    expect(iconAb).toBeDefined();
    expect(iconAb.locationSegments).toEqual(['icons']);
    expect(iconAb.locationPath).toBe('icons');
  });
});

// ---------------------------------------------------------------------------
// (c) Single-group scope — only that group's subtree
// ---------------------------------------------------------------------------

describe('collectArtboards — single group scope', () => {
  it('(c) returns assets of the group and descendant groups', () => {
    const model = buildDeepProject();
    // scope = components group — should get Secondary (buttons) and Primary (buttons/primary)
    const artboards = collectArtboards(model, '.lerret/design/components');
    const names = artboards.map((a) => a.asset.name);
    expect(names).toEqual(['Secondary', 'Primary']);
  });

  it('(c) scope is the innermost group — returns only its direct assets', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components/buttons/primary');
    const names = artboards.map((a) => a.asset.name);
    expect(names).toEqual(['Primary']);
  });

  it('(c) pagePath is correct even for deeply nested group scope', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components/buttons/primary');
    expect(artboards[0].pagePath).toBe('.lerret/design');
  });
});

// ---------------------------------------------------------------------------
// (d) Deep nested groups — locationSegments carry the full chain
// ---------------------------------------------------------------------------

describe('collectArtboards — deep nested groups locationSegments', () => {
  it('(d) Secondary (buttons) has locationSegments=["buttons"] when scoped to components', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components');
    const secondary = artboards.find((a) => a.asset.name === 'Secondary');
    expect(secondary).toBeDefined();
    expect(secondary.locationSegments).toEqual(['buttons']);
    expect(secondary.locationPath).toBe('buttons');
  });

  it('(d) Primary (buttons/primary) has locationSegments=["buttons","primary"] when scoped to components', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components');
    const primary = artboards.find((a) => a.asset.name === 'Primary');
    expect(primary).toBeDefined();
    expect(primary.locationSegments).toEqual(['buttons', 'primary']);
    expect(primary.locationPath).toBe('buttons/primary');
  });

  it('(d) Primary locationSegments=["primary"] when scoped to buttons (immediate parent)', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components/buttons');
    const primary = artboards.find((a) => a.asset.name === 'Primary');
    expect(primary).toBeDefined();
    expect(primary.locationSegments).toEqual(['primary']);
    expect(primary.locationPath).toBe('primary');
  });

  it('(d) Secondary locationSegments=[] when scoped to buttons (it lives directly in buttons)', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, '.lerret/design/components/buttons');
    const secondary = artboards.find((a) => a.asset.name === 'Secondary');
    expect(secondary).toBeDefined();
    expect(secondary.locationSegments).toEqual([]);
    expect(secondary.locationPath).toBe('');
  });

  it('(d) whole-project scope carries full locationSegments chain from page down', () => {
    const model = buildDeepProject();
    const artboards = collectArtboards(model, null);
    const primary = artboards.find((a) => a.asset.name === 'Primary');
    expect(primary).toBeDefined();
    // From page: components/buttons/primary
    expect(primary.locationSegments).toEqual(['components', 'buttons', 'primary']);
    expect(primary.locationPath).toBe('components/buttons/primary');
  });
});

// ---------------------------------------------------------------------------
// (e) Missing page path → throws RangeError
// ---------------------------------------------------------------------------

describe('collectArtboards — missing scope throws', () => {
  it('(e) throws RangeError for a non-existent page path', () => {
    const model = buildTwoPageProject();
    expect(() => collectArtboards(model, '.lerret/nonexistent')).toThrowError(RangeError);
  });

  it('(e) error message identifies the missing path', () => {
    const model = buildTwoPageProject();
    expect(() => collectArtboards(model, '.lerret/ghost-page')).toThrow(
      /".lerret\/ghost-page"/,
    );
  });

  it('(f) throws RangeError for a non-existent group path', () => {
    const model = buildTwoPageProject();
    expect(() => collectArtboards(model, '.lerret/ui/phantom-group')).toThrowError(RangeError);
  });

  it('(f) error message mentions "not found in the model"', () => {
    const model = buildTwoPageProject();
    expect(() => collectArtboards(model, '.lerret/ui/phantom-group')).toThrow(
      /not found in the model/i,
    );
  });
});

// ---------------------------------------------------------------------------
// (g) Empty page → returns []
// ---------------------------------------------------------------------------

describe('collectArtboards — empty page/group returns []', () => {
  it('(g) empty page returns an empty array', () => {
    const model = createProjectNode({
      name: 'proj',
      path: '.lerret',
      pages: [
        createPageNode({ name: 'empty', path: '.lerret/empty', assets: [], groups: [] }),
      ],
    });
    const artboards = collectArtboards(model, '.lerret/empty');
    expect(artboards).toEqual([]);
  });

  it('(g) empty group returns an empty array', () => {
    const emptyGroup = createGroupNode({
      name: 'hollow',
      path: '.lerret/page/hollow',
      assets: [],
      groups: [],
    });
    const model = createProjectNode({
      name: 'proj',
      path: '.lerret',
      pages: [
        createPageNode({
          name: 'page',
          path: '.lerret/page',
          assets: [],
          groups: [emptyGroup],
        }),
      ],
    });
    const artboards = collectArtboards(model, '.lerret/page/hollow');
    expect(artboards).toEqual([]);
  });

  it('(h) empty project returns an empty array for null scope', () => {
    const model = createProjectNode({ name: 'proj', path: '.lerret', pages: [] });
    const artboards = collectArtboards(model, null);
    expect(artboards).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (i) Walk order — depth-first pre-order (assets before child groups)
// ---------------------------------------------------------------------------

describe('collectArtboards — deterministic depth-first walk order', () => {
  it('(i) assets in a container appear before child groups', () => {
    // page has: asset A, group alpha (with asset B)
    const alphaGroup = createGroupNode({
      name: 'alpha',
      path: '.lerret/page/alpha',
      assets: [asset('B', '.lerret/page/alpha')],
      groups: [],
    });
    const model = createProjectNode({
      name: 'proj',
      path: '.lerret',
      pages: [
        createPageNode({
          name: 'page',
          path: '.lerret/page',
          assets: [asset('A', '.lerret/page')],
          groups: [alphaGroup],
        }),
      ],
    });
    const artboards = collectArtboards(model, null);
    expect(artboards.map((a) => a.asset.name)).toEqual(['A', 'B']);
  });

  it('(i) sibling groups appear in model order (alphabetical from loader)', () => {
    const betaGroup = createGroupNode({
      name: 'beta',
      path: '.lerret/page/beta',
      assets: [asset('Beta', '.lerret/page/beta')],
      groups: [],
    });
    const alphaGroup = createGroupNode({
      name: 'alpha',
      path: '.lerret/page/alpha',
      assets: [asset('Alpha', '.lerret/page/alpha')],
      groups: [],
    });
    // alpha before beta in the groups array (as loader would sort them)
    const model = createProjectNode({
      name: 'proj',
      path: '.lerret',
      pages: [
        createPageNode({
          name: 'page',
          path: '.lerret/page',
          assets: [],
          groups: [alphaGroup, betaGroup],
        }),
      ],
    });
    const artboards = collectArtboards(model, null);
    expect(artboards.map((a) => a.asset.name)).toEqual(['Alpha', 'Beta']);
  });
});

// ---------------------------------------------------------------------------
// (m) Null model → throws TypeError
// ---------------------------------------------------------------------------

describe('collectArtboards — invalid model argument', () => {
  it('(m) throws TypeError when model is null', () => {
    expect(() => collectArtboards(null, null)).toThrowError(TypeError);
  });

  it('(m) throws TypeError when model is undefined', () => {
    expect(() => collectArtboards(undefined, null)).toThrowError(TypeError);
  });
});

// ---------------------------------------------------------------------------
// (n) Group-scoped locationPath for root-level assets in the group
// ---------------------------------------------------------------------------

describe('collectArtboards — group scope locationPath root assets', () => {
  it('(n) assets directly in the scoped group get locationPath=""', () => {
    const model = buildTwoPageProject();
    const artboards = collectArtboards(model, '.lerret/ui/icons');
    expect(artboards).toHaveLength(1);
    expect(artboards[0].locationPath).toBe('');
    expect(artboards[0].locationSegments).toEqual([]);
  });
});
