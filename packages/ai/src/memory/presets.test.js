// @vitest-environment node
//
// Unit tests for preset discovery (presets.js, PURE).

import { describe, it, expect } from 'vitest';

import { discoverPresets, KNOWN_PRESETS } from './presets.js';

describe('KNOWN_PRESETS', () => {
  it('is the frozen v1/Epic 7 preset name set', () => {
    expect(KNOWN_PRESETS).toEqual([
      'producthunt',
      'social-media',
      'appstore',
      'talks',
      'personal',
      'live',
    ]);
    expect(Object.isFrozen(KNOWN_PRESETS)).toBe(true);
  });
});

describe('discoverPresets — heuristics', () => {
  it('matches a page by folder name', () => {
    const out = discoverPresets({
      pages: [
        { name: 'social-media', path: '.lerret/social-media' },
        { name: 'producthunt', path: '.lerret/producthunt' },
      ],
    });
    expect(out).toEqual([
      { preset: 'social-media', pagePath: '.lerret/social-media', matchedBy: 'name' },
      { preset: 'producthunt', pagePath: '.lerret/producthunt', matchedBy: 'name' },
    ]);
  });

  it('matches a page by inline config _meta.preset even when the folder name differs', () => {
    const out = discoverPresets({
      pages: [
        {
          name: 'my-posts',
          path: '.lerret/my-posts',
          config: { _meta: { preset: 'social-media' } },
        },
      ],
    });
    expect(out).toEqual([
      { preset: 'social-media', pagePath: '.lerret/my-posts', matchedBy: 'meta' },
    ]);
  });

  it("matches the REAL scaffolded template value ('social-media-v1') via normalization", () => {
    // Mirrors packages/create-lerret/template-presets/social-media/.lerret/config.json:
    // the templates write a versioned `_meta.preset`, not the bare name.
    const out = discoverPresets({
      pages: [
        {
          name: 'my-posts',
          path: '.lerret/my-posts',
          config: { _meta: { preset: 'social-media-v1' } },
        },
        {
          name: 'launch',
          path: '.lerret/launch',
          config: { _meta: { preset: 'ProductHunt-V2' } }, // case + version variant
        },
      ],
    });
    expect(out).toEqual([
      { preset: 'social-media', pagePath: '.lerret/my-posts', matchedBy: 'meta' },
      { preset: 'producthunt', pagePath: '.lerret/launch', matchedBy: 'meta' },
    ]);
  });

  it('reads _meta.preset from an injected cascadedConfig map (DI, no core import)', () => {
    const cascadedConfig = new Map([['.lerret/p', { _meta: { preset: 'appstore' } }]]);
    const out = discoverPresets({
      pages: [{ name: 'p', path: '.lerret/p' }],
      cascadedConfig,
    });
    expect(out).toEqual([
      { preset: 'appstore', pagePath: '.lerret/p', matchedBy: 'meta' },
    ]);
  });

  it('ignores pages matching neither heuristic', () => {
    const out = discoverPresets({
      pages: [
        { name: 'random-page', path: '.lerret/random-page' },
        {
          name: 'notes',
          path: '.lerret/notes',
          config: { _meta: { preset: 'not-a-preset' } },
        },
      ],
    });
    expect(out).toEqual([]);
  });

  it('accepts a projectModel.pages shape and an empty/garbage input', () => {
    expect(
      discoverPresets({
        projectModel: { pages: [{ name: 'talks', path: '.lerret/talks' }] },
      }),
    ).toEqual([{ preset: 'talks', pagePath: '.lerret/talks', matchedBy: 'name' }]);
    expect(discoverPresets({})).toEqual([]);
    expect(discoverPresets()).toEqual([]);
  });
});
