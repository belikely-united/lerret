// @vitest-environment node
//
// Unit tests for the generation substrate planners (generation.js, PURE).

import { describe, it, expect } from 'vitest';

import {
  planVariantExpansion,
  planBrandAssetCopy,
  componentBasename,
} from './generation.js';

describe('componentBasename', () => {
  it('strips directory + extension to the stem the data-loader keys on', () => {
    expect(componentBasename('.lerret/social-media/Hero.jsx')).toBe('Hero');
    expect(componentBasename('Launch.tsx')).toBe('Launch');
    expect(componentBasename('.lerret/x/Card.data.json')).toBe('Card');
  });

  it('stems at the LAST dot like core’s loader, so dotted component names survive', () => {
    expect(componentBasename('Card.v2.jsx')).toBe('Card.v2');
    expect(componentBasename('.lerret/social-media/Card.v2.jsx')).toBe('Card.v2');
  });
});

describe('planVariantExpansion', () => {
  it('plans a co-located <Stem>.data.json path next to the component', () => {
    const { dataFilePath } = planVariantExpansion({
      componentPath: '.lerret/social-media/Launch.jsx',
      variantData: {},
    });
    expect(dataFilePath).toBe('.lerret/social-media/Launch.data.json');
  });

  it('a dotted component name plans the loader-matching data path (last-dot stem)', () => {
    // Core's loader stems `Card.v2.jsx` to asset name `Card.v2`, so the
    // co-located data file it discovers is `Card.v2.data.json`.
    const { dataFilePath } = planVariantExpansion({
      componentPath: '.lerret/social-media/Card.v2.jsx',
      variantData: {},
    });
    expect(dataFilePath).toBe('.lerret/social-media/Card.v2.data.json');
  });

  it('emits a single write step matching the Worker WorkerStep shape', () => {
    const { steps } = planVariantExpansion({
      componentPath: '.lerret/social-media/Launch.jsx',
      variantData: { Dark: { title: 'v0.4' } },
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].op).toBe('write');
    expect(steps[0].path).toBe('.lerret/social-media/Launch.data.json');
    expect(typeof steps[0].content).toBe('string');
  });

  it('serializes the per-variant data as pretty JSON with a trailing newline', () => {
    const variantData = { Dark: { title: 'v0.4' }, Light: { title: 'v0.4 (light)' } };
    const { dataJson, steps } = planVariantExpansion({
      componentPath: 'Launch.jsx',
      variantData,
    });
    expect(dataJson).toEqual(variantData);
    expect(JSON.parse(steps[0].content)).toEqual(variantData);
    expect(steps[0].content.endsWith('\n')).toBe(true);
    expect(steps[0].content).toContain('\n  '); // two-space indent
  });

  it('coerces a non-object variantData to {}', () => {
    const { dataJson } = planVariantExpansion({
      componentPath: 'A.jsx',
      variantData: 42,
    });
    expect(dataJson).toEqual({});
  });

  it('throws only on a missing componentPath', () => {
    expect(() => planVariantExpansion({ variantData: {} })).toThrow(/componentPath/);
  });
});

describe('planBrandAssetCopy', () => {
  const brandIndex = [
    { name: 'logo.svg', type: 'logo', path: '.lerret/_brand/logo.svg' },
    { name: 'swatch-brand.svg', type: 'vector', path: '.lerret/_brand/swatch-brand.svg' },
  ];

  it('selects the logo for an "include our logo" request and plans a copy step', () => {
    const steps = planBrandAssetCopy({
      brandIndex,
      request: 'include our logo',
      targetDir: '.lerret/social-media',
      readContent: () => '<svg>logo</svg>',
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      op: 'write',
      path: '.lerret/social-media/logo.svg',
      content: '<svg>logo</svg>',
    });
  });

  it('carries empty content when no readContent is supplied (Worker fills the bytes)', () => {
    const steps = planBrandAssetCopy({
      brandIndex,
      request: 'add the logo',
      targetDir: '.lerret/social-media/',
    });
    expect(steps[0].content).toBe('');
    // Trailing slash on targetDir is normalized away.
    expect(steps[0].path).toBe('.lerret/social-media/logo.svg');
  });

  it('returns [] when no brand asset matches the request', () => {
    expect(
      planBrandAssetCopy({ brandIndex, request: 'a haiku about ducks', targetDir: 'x' }),
    ).toEqual([]);
  });

  it('returns [] for an empty brand index', () => {
    expect(
      planBrandAssetCopy({ brandIndex: [], request: 'logo', targetDir: 'x' }),
    ).toEqual([]);
  });

  it('NEVER plans a raster copy: an index with only an image for the request plans nothing', () => {
    // 'palette.png' would have scored on the /palette|color/ hint by NAME —
    // but a utf-8 text copy of raster bytes corrupts the file, so rasters are
    // filtered out before scoring (deferred to Story 8.7's vision/binary path).
    const steps = planBrandAssetCopy({
      brandIndex: [{ name: 'palette.png', type: 'image', path: '.lerret/_brand/palette.png' }],
      request: 'use our palette',
      targetDir: '.lerret/social-media',
      readContent: () => 'CORRUPT-IF-WRITTEN',
    });
    expect(steps).toEqual([]);
  });

  it('with a raster AND a logo in the index, the text-safe logo is selected', () => {
    const steps = planBrandAssetCopy({
      brandIndex: [
        { name: 'hero.png', type: 'image', path: '.lerret/_brand/hero.png' },
        { name: 'logo.svg', type: 'logo', path: '.lerret/_brand/logo.svg' },
      ],
      request: 'include our logo',
      targetDir: '.lerret/social-media',
      readContent: (entry) => (entry.name === 'logo.svg' ? '<svg>logo</svg>' : 'RASTER'),
    });
    expect(steps).toEqual([
      { op: 'write', path: '.lerret/social-media/logo.svg', content: '<svg>logo</svg>' },
    ]);
  });
});
