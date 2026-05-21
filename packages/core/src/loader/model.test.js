// Tests for the project-model shapes — the node-kind / asset-kind constants,
// the plain-data constructors, and the predicates. The shapes themselves are
// JSDoc `@typedef`s; what runs (and is tested here) is the constructor +
// predicate surface in `model.js`.

import { describe, it, expect } from 'vitest';

import {
  NODE_KIND,
  ASSET_KIND,
  ASSET_EXTENSIONS,
  FONT_EXTENSIONS,
  createProjectNode,
  createPageNode,
  createGroupNode,
  createAssetNode,
  createFontFile,
  isProjectNode,
  isPageNode,
  isGroupNode,
  isAssetNode,
} from './model.js';

describe('node-kind and asset-kind constants', () => {
  it('exposes the four node kinds', () => {
    expect(NODE_KIND).toEqual({
      PROJECT: 'project',
      PAGE: 'page',
      GROUP: 'group',
      ASSET: 'asset',
    });
  });

  it('exposes the two asset kinds', () => {
    expect(ASSET_KIND).toEqual({ COMPONENT: 'component', MARKDOWN: 'markdown' });
  });

  it('maps the recognized asset extensions to kinds', () => {
    expect(ASSET_EXTENSIONS['.jsx']).toBe('component');
    expect(ASSET_EXTENSIONS['.tsx']).toBe('component');
    expect(ASSET_EXTENSIONS['.md']).toBe('markdown');
  });

  it('does not recognize non-asset extensions', () => {
    expect(ASSET_EXTENSIONS['.json']).toBeUndefined();
    expect(ASSET_EXTENSIONS['.png']).toBeUndefined();
    expect(ASSET_EXTENSIONS['.js']).toBeUndefined();
  });

  it('freezes the constant objects so consumers cannot mutate them', () => {
    expect(Object.isFrozen(NODE_KIND)).toBe(true);
    expect(Object.isFrozen(ASSET_KIND)).toBe(true);
    expect(Object.isFrozen(ASSET_EXTENSIONS)).toBe(true);
  });
});

describe('font extensions', () => {
  it('maps each recognized font extension to its @font-face format hint', () => {
    expect(FONT_EXTENSIONS['.woff2']).toBe('woff2');
    expect(FONT_EXTENSIONS['.woff']).toBe('woff');
    expect(FONT_EXTENSIONS['.ttf']).toBe('truetype');
    expect(FONT_EXTENSIONS['.otf']).toBe('opentype');
  });

  it('does not recognize non-font extensions', () => {
    expect(FONT_EXTENSIONS['.txt']).toBeUndefined();
    expect(FONT_EXTENSIONS['.jsx']).toBeUndefined();
    expect(FONT_EXTENSIONS['.png']).toBeUndefined();
  });

  it('freezes the constant so consumers cannot mutate it', () => {
    expect(Object.isFrozen(FONT_EXTENSIONS)).toBe(true);
  });
});

describe('createAssetNode', () => {
  it('builds an asset node with all fields', () => {
    const asset = createAssetNode({
      name: 'Button',
      fileName: 'Button.jsx',
      path: '/p/.lerret/ui/Button.jsx',
      assetKind: 'component',
      ext: '.jsx',
    });
    expect(asset).toEqual({
      kind: 'asset',
      name: 'Button',
      fileName: 'Button.jsx',
      path: '/p/.lerret/ui/Button.jsx',
      assetKind: 'component',
      ext: '.jsx',
    });
  });
});

describe('createGroupNode', () => {
  it('defaults groups and assets to empty arrays', () => {
    const group = createGroupNode({ name: 'components', path: '/p/.lerret/ui/components' });
    expect(group).toEqual({
      kind: 'group',
      name: 'components',
      path: '/p/.lerret/ui/components',
      groups: [],
      assets: [],
    });
  });

  it('carries provided child groups and assets', () => {
    const child = createGroupNode({ name: 'inner', path: '/p/.lerret/ui/g/inner' });
    const asset = createAssetNode({
      name: 'Card',
      fileName: 'Card.tsx',
      path: '/p/.lerret/ui/g/Card.tsx',
      assetKind: 'component',
      ext: '.tsx',
    });
    const group = createGroupNode({
      name: 'g',
      path: '/p/.lerret/ui/g',
      groups: [child],
      assets: [asset],
    });
    expect(group.groups).toEqual([child]);
    expect(group.assets).toEqual([asset]);
  });
});

describe('createPageNode', () => {
  it('defaults groups and assets to empty arrays', () => {
    const page = createPageNode({ name: 'Home', path: '/p/.lerret/Home' });
    expect(page).toEqual({
      kind: 'page',
      name: 'Home',
      path: '/p/.lerret/Home',
      groups: [],
      assets: [],
    });
  });
});

describe('createProjectNode', () => {
  it('defaults pages and fonts to empty arrays', () => {
    const project = createProjectNode({ name: 'my-app', path: '/p/.lerret' });
    expect(project).toEqual({
      kind: 'project',
      name: 'my-app',
      path: '/p/.lerret',
      pages: [],
      fonts: [],
    });
  });

  it('carries provided custom fonts', () => {
    const font = createFontFile({
      fileName: 'Brand.woff2',
      path: '/p/.lerret/_fonts/Brand.woff2',
    });
    const project = createProjectNode({
      name: 'my-app',
      path: '/p/.lerret',
      fonts: [font],
    });
    expect(project.fonts).toEqual([font]);
  });
});

describe('createFontFile', () => {
  it('builds a font file deriving the family name from the file name', () => {
    const font = createFontFile({
      fileName: 'MyBrandFont.woff2',
      path: '/p/.lerret/_fonts/MyBrandFont.woff2',
    });
    expect(font).toEqual({
      family: 'MyBrandFont',
      fileName: 'MyBrandFont.woff2',
      path: '/p/.lerret/_fonts/MyBrandFont.woff2',
      ext: '.woff2',
      format: 'woff2',
    });
  });

  it('classifies every recognized font extension, case-insensitively', () => {
    const cases = [
      ['Inter.WOFF2', '.woff2', 'woff2'],
      ['Serif.Woff', '.woff', 'woff'],
      ['Display.TTF', '.ttf', 'truetype'],
      ['Mono.otf', '.otf', 'opentype'],
    ];
    for (const [fileName, ext, format] of cases) {
      const font = createFontFile({ fileName, path: `/p/.lerret/_fonts/${fileName}` });
      expect(font.ext).toBe(ext);
      expect(font.format).toBe(format);
    }
  });

  it('keeps a dotted family name intact, splitting only the final extension', () => {
    const font = createFontFile({
      fileName: 'Brand.Bold.woff2',
      path: '/p/.lerret/_fonts/Brand.Bold.woff2',
    });
    expect(font.family).toBe('Brand.Bold');
    expect(font.ext).toBe('.woff2');
  });

  it('returns null for a file whose extension is not a recognized font type', () => {
    expect(
      createFontFile({ fileName: 'OFL.txt', path: '/p/.lerret/_fonts/OFL.txt' }),
    ).toBeNull();
    expect(
      createFontFile({ fileName: 'README', path: '/p/.lerret/_fonts/README' }),
    ).toBeNull();
    expect(
      createFontFile({ fileName: 'logo.png', path: '/p/.lerret/_fonts/logo.png' }),
    ).toBeNull();
  });
});

describe('node predicates', () => {
  const project = createProjectNode({ name: 'p', path: '/p/.lerret' });
  const page = createPageNode({ name: 'Home', path: '/p/.lerret/Home' });
  const group = createGroupNode({ name: 'g', path: '/p/.lerret/Home/g' });
  const asset = createAssetNode({
    name: 'A',
    fileName: 'A.md',
    path: '/p/.lerret/Home/A.md',
    assetKind: 'markdown',
    ext: '.md',
  });

  it('identifies each node kind exactly', () => {
    expect(isProjectNode(project)).toBe(true);
    expect(isPageNode(page)).toBe(true);
    expect(isGroupNode(group)).toBe(true);
    expect(isAssetNode(asset)).toBe(true);
  });

  it('rejects other kinds', () => {
    expect(isProjectNode(page)).toBe(false);
    expect(isPageNode(group)).toBe(false);
    expect(isGroupNode(asset)).toBe(false);
    expect(isAssetNode(project)).toBe(false);
  });

  it('is safe on null and undefined', () => {
    for (const predicate of [isProjectNode, isPageNode, isGroupNode, isAssetNode]) {
      expect(predicate(null)).toBe(false);
      expect(predicate(undefined)).toBe(false);
    }
  });
});
