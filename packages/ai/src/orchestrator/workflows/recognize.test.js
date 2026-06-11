// @vitest-environment node
//
// Unit tests for the workflow-shape recognizer (Story 8.8, Task 1). Pure
// classification — no fs, no provider. Pins:
//   - per-kind happy paths (launch-kit / social-variants / edit / generic),
//   - multi-platform extraction in prompt order + page-dedupe,
//   - the strict launch-kit trigger (kit keyword AND ≥1 platform),
//   - reference-path + count extraction for W3,
//   - the frozen KNOWN_PLATFORMS single-source-of-truth map.

import { describe, it, expect } from 'vitest';

import { recognizeWorkflow, KNOWN_PLATFORMS } from './recognize.js';

describe('KNOWN_PLATFORMS — the AC-1 mapping source of truth', () => {
  it('maps every documented keyword to its { preset, page } pair', () => {
    expect(KNOWN_PLATFORMS.twitter).toEqual({
      preset: 'social-media',
      page: 'social-media/twitter',
    });
    expect(KNOWN_PLATFORMS.x).toEqual({
      preset: 'social-media',
      page: 'social-media/twitter',
    });
    expect(KNOWN_PLATFORMS.instagram).toEqual({
      preset: 'social-media',
      page: 'social-media/instagram',
    });
    expect(KNOWN_PLATFORMS.linkedin).toEqual({
      preset: 'social-media',
      page: 'social-media/linkedin',
    });
    expect(KNOWN_PLATFORMS.bluesky).toEqual({
      preset: 'social-media',
      page: 'social-media/bluesky',
    });
    expect(KNOWN_PLATFORMS['app store hero']).toEqual({
      preset: 'appstore',
      page: 'appstore/hero',
    });
    expect(KNOWN_PLATFORMS['app store']).toEqual({ preset: 'appstore', page: 'appstore/hero' });
    expect(KNOWN_PLATFORMS.appstore).toEqual({ preset: 'appstore', page: 'appstore/hero' });
    expect(KNOWN_PLATFORMS['product hunt']).toEqual({
      preset: 'producthunt',
      page: 'producthunt/launch',
    });
    expect(KNOWN_PLATFORMS.producthunt).toEqual({
      preset: 'producthunt',
      page: 'producthunt/launch',
    });
  });

  it('is deeply frozen — neither the map nor an entry is mutable', () => {
    expect(Object.isFrozen(KNOWN_PLATFORMS)).toBe(true);
    expect(Object.isFrozen(KNOWN_PLATFORMS.twitter)).toBe(true);
    expect(() => {
      'use strict';
      KNOWN_PLATFORMS.tiktok = { preset: 'social-media', page: 'social-media/tiktok' };
    }).toThrow(TypeError);
    expect(KNOWN_PLATFORMS.tiktok).toBeUndefined();
  });
});

describe('recognizeWorkflow — launch-kit (W2)', () => {
  it('classifies the canonical headline prompt with three platforms, prompt order', () => {
    const out = recognizeWorkflow(
      'launch kit for v0.4 — twitter, instagram, app store hero',
    );
    expect(out).toEqual({
      kind: 'launch-kit',
      platforms: ['twitter', 'instagram', 'app store hero'],
    });
  });

  it('accepts the alternate kit keywords (launch assets / marketing kit)', () => {
    expect(recognizeWorkflow('launch assets for product hunt and bluesky')).toEqual({
      kind: 'launch-kit',
      platforms: ['product hunt', 'bluesky'],
    });
    expect(recognizeWorkflow('a marketing kit for LinkedIn please')).toEqual({
      kind: 'launch-kit',
      platforms: ['linkedin'],
    });
  });

  it('is case-insensitive on both the keyword and the platforms', () => {
    expect(recognizeWorkflow('LAUNCH KIT for Twitter and Instagram')).toEqual({
      kind: 'launch-kit',
      platforms: ['twitter', 'instagram'],
    });
  });

  it('dedupes platforms that resolve to the same page (twitter + x)', () => {
    const out = recognizeWorkflow('launch kit for twitter and x');
    expect(out.kind).toBe('launch-kit');
    expect(out.platforms).toEqual(['twitter']); // both map to social-media/twitter
  });

  it('prefers the longest platform keyword at an overlapping span', () => {
    // 'app store hero' must consume the text so 'app store' does not double-fire.
    const out = recognizeWorkflow('launch kit: app store hero');
    expect(out.platforms).toEqual(['app store hero']);
  });

  it('matches the single-letter x platform only standalone — never inside a word', () => {
    // 'export' contains x; no standalone x → no platform → generic.
    expect(recognizeWorkflow('launch kit for the export flow').kind).toBe('generic');
    expect(recognizeWorkflow('launch kit for x').platforms).toEqual(['x']);
  });

  it('a kit keyword WITHOUT any platform falls through to generic (the LLM planner path)', () => {
    // The smoke types exactly this; the canned-provider LLM path handles it.
    expect(recognizeWorkflow('launch kit for v0.4')).toEqual({ kind: 'generic' });
  });

  it('platforms named WITHOUT a kit keyword do not trigger launch-kit', () => {
    expect(recognizeWorkflow('a post for twitter')).toEqual({ kind: 'generic' });
  });
});

describe('recognizeWorkflow — social-variants (W3)', () => {
  it('classifies the canonical variant prompt with path + count', () => {
    const out = recognizeWorkflow(
      'three more social posts in the same style as social-media/twitter/launch-1.jsx',
    );
    expect(out).toEqual({
      kind: 'social-variants',
      reference: { path: 'social-media/twitter/launch-1.jsx', count: 3 },
    });
  });

  it('parses a digit count (5 more)', () => {
    const out = recognizeWorkflow('5 more like social-media/instagram/post.jsx');
    expect(out.kind).toBe('social-variants');
    expect(out.reference).toEqual({ path: 'social-media/instagram/post.jsx', count: 5 });
  });

  it('defaults the count to 3 for a bare "variants of" cue', () => {
    const out = recognizeWorkflow('variants of social-media/instagram/post.jsx');
    expect(out).toEqual({
      kind: 'social-variants',
      reference: { path: 'social-media/instagram/post.jsx', count: 3 },
    });
  });

  it('"another version of" yields count 1', () => {
    const out = recognizeWorkflow('another version of producthunt/launch/thumbnail.jsx');
    expect(out.reference).toEqual({ path: 'producthunt/launch/thumbnail.jsx', count: 1 });
  });

  it('keeps a .lerret/-prefixed reference path as written (planners normalize)', () => {
    const out = recognizeWorkflow(
      'two more in the same style as .lerret/social-media/twitter/launch-1.jsx',
    );
    expect(out.kind).toBe('social-variants');
    expect(out.reference.path).toBe('.lerret/social-media/twitter/launch-1.jsx');
    expect(out.reference.count).toBe(2);
  });

  it('accepts a .tsx reference (core treats .tsx as a component asset too)', () => {
    const out = recognizeWorkflow('variants of pricing/tiers/card.tsx');
    expect(out.kind).toBe('social-variants');
    expect(out.reference.path).toBe('pricing/tiers/card.tsx');
  });

  it('a variant cue WITHOUT an asset path falls through to generic', () => {
    expect(recognizeWorkflow('three more posts like the last one')).toEqual({
      kind: 'generic',
    });
  });

  it('a bare filename with no folder segment is NOT a reference (<page>/<name>.jsx shape)', () => {
    expect(recognizeWorkflow('three more in the same style as launch.jsx')).toEqual({
      kind: 'generic',
    });
  });
});

describe('recognizeWorkflow — edit / generic fall-throughs + precedence', () => {
  it('an asset path WITHOUT a variant cue classifies as edit (with the reference)', () => {
    const out = recognizeWorkflow(
      'make the headline bigger in social-media/twitter/launch-1.jsx',
    );
    expect(out).toEqual({
      kind: 'edit',
      reference: { path: 'social-media/twitter/launch-1.jsx' },
    });
  });

  it('plain generation prompts classify as generic', () => {
    expect(recognizeWorkflow('a pricing table with three tiers')).toEqual({
      kind: 'generic',
    });
  });

  it('non-string / empty prompts classify as generic, never throw', () => {
    expect(recognizeWorkflow(undefined)).toEqual({ kind: 'generic' });
    expect(recognizeWorkflow(null)).toEqual({ kind: 'generic' });
    expect(recognizeWorkflow('')).toEqual({ kind: 'generic' });
    expect(recognizeWorkflow('   ')).toEqual({ kind: 'generic' });
    expect(recognizeWorkflow(42)).toEqual({ kind: 'generic' });
  });

  it('launch-kit wins over social-variants when a prompt matches both (documented precedence)', () => {
    const out = recognizeWorkflow(
      'launch kit for twitter — three more in the same style as social-media/twitter/a.jsx',
    );
    expect(out.kind).toBe('launch-kit');
    expect(out.platforms).toEqual(['twitter']);
  });
});

describe('recognizeWorkflow — edit/negation/question cues disable the workflows (rule 0)', () => {
  // A prompt ABOUT a launch kit (editing it, negating it, asking about it)
  // must never RUN the kit workflow — it falls through to the LLM planner.
  it.each([
    ['edit verb', 'edit the launch kit for twitter'],
    ['tweak verb', 'tweak the launch kit for twitter'],
    ['change verb', 'change the launch kit for twitter'],
    ['update verb', 'update the launch kit for twitter'],
    ['fix verb', 'fix the launch kit for twitter'],
    ['rename verb', 'rename the launch kit for twitter'],
    ['delete verb', 'delete the launch kit for twitter'],
    ['remove verb', 'remove the launch kit for twitter'],
    ["don't negation", "don't make a launch kit for twitter"],
    ['don’t negation (curly apostrophe)', 'don’t make a launch kit for twitter'],
    ['do not negation', 'do NOT make a launch kit for twitter'],
    ['never negation', 'never generate a launch kit for twitter'],
    ['cost question', 'what would a launch kit for twitter cost'],
    ['how much question', 'how much is a launch kit for twitter'],
    ['question mark', 'launch kit for twitter?'],
  ])('%s → generic, not launch-kit', (_label, prompt) => {
    expect(recognizeWorkflow(prompt)).toEqual({ kind: 'generic' });
  });

  it('an edit cue with a referenced asset path falls through to edit, not social-variants', () => {
    expect(recognizeWorkflow('tweak the variants of social-media/twitter/launch-1.jsx')).toEqual({
      kind: 'edit',
      reference: { path: 'social-media/twitter/launch-1.jsx' },
    });
    expect(
      recognizeWorkflow(
        "don't make three more in the same style as social-media/twitter/launch-1.jsx",
      ),
    ).toEqual({
      kind: 'edit',
      reference: { path: 'social-media/twitter/launch-1.jsx' },
    });
    expect(
      recognizeWorkflow('what would variants of social-media/twitter/launch-1.jsx cost?'),
    ).toEqual({
      kind: 'edit',
      reference: { path: 'social-media/twitter/launch-1.jsx' },
    });
  });

  it('the cues do not leak into ordinary kit prompts (no false disable)', () => {
    // None of the cue words appear — the canonical prompts still classify.
    expect(recognizeWorkflow('launch kit for v0.4 — twitter').kind).toBe('launch-kit');
    expect(
      recognizeWorkflow('three more social posts in the same style as social-media/twitter/launch-1.jsx').kind,
    ).toBe('social-variants');
  });
});
