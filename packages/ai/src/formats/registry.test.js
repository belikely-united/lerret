import { describe, it, expect } from 'vitest';

import {
  KNOWN_PRESETS,
  FORMAT_PROFILES,
  KNOWN_PLATFORMS,
  buildPlatformMap,
} from './registry.js';

// The exact `KNOWN_PLATFORMS` literal that lived in
// orchestrator/workflows/recognize.js before the registry refactor. Phase 1 is
// behavior-preserving, so the DERIVED map must equal this byte-for-byte —
// including key insertion order, which the recognizer's same-length keyword
// tie-breaking depends on.
const LEGACY_KNOWN_PLATFORMS = {
  twitter: { preset: 'social-media', page: 'social-media/twitter' },
  x: { preset: 'social-media', page: 'social-media/twitter' },
  instagram: { preset: 'social-media', page: 'social-media/instagram' },
  linkedin: { preset: 'social-media', page: 'social-media/linkedin' },
  bluesky: { preset: 'social-media', page: 'social-media/bluesky' },
  'app store hero': { preset: 'appstore', page: 'appstore/hero' },
  'app store': { preset: 'appstore', page: 'appstore/hero' },
  appstore: { preset: 'appstore', page: 'appstore/hero' },
  'product hunt': { preset: 'producthunt', page: 'producthunt/launch' },
  producthunt: { preset: 'producthunt', page: 'producthunt/launch' },
};

const LEGACY_KNOWN_PRESETS = [
  'producthunt',
  'social-media',
  'appstore',
  'talks',
  'personal',
  'live',
];

describe('format registry — Phase 1 behavior equivalence', () => {
  it('derived KNOWN_PLATFORMS deep-equals the legacy literal', () => {
    expect(KNOWN_PLATFORMS).toEqual(LEGACY_KNOWN_PLATFORMS);
  });

  it('preserves the legacy key insertion order', () => {
    expect(Object.keys(KNOWN_PLATFORMS)).toEqual(Object.keys(LEGACY_KNOWN_PLATFORMS));
  });

  it('KNOWN_PRESETS is unchanged from the legacy list', () => {
    expect(KNOWN_PRESETS).toEqual(LEGACY_KNOWN_PRESETS);
  });
});

describe('format registry — invariants', () => {
  it('every profile.preset is a known preset family', () => {
    for (const profile of FORMAT_PROFILES) {
      expect(KNOWN_PRESETS).toContain(profile.preset);
    }
  });

  it('profile ids are unique', () => {
    const ids = FORMAT_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every alias resolves to exactly one profile (no alias collisions)', () => {
    const aliases = FORMAT_PROFILES.flatMap((p) => p.aliases);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('freezes the derived map and every entry', () => {
    expect(Object.isFrozen(KNOWN_PLATFORMS)).toBe(true);
    for (const entry of Object.values(KNOWN_PLATFORMS)) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('buildPlatformMap', () => {
  it('is pure — rebuilding from FORMAT_PROFILES reproduces KNOWN_PLATFORMS', () => {
    expect(buildPlatformMap(FORMAT_PROFILES)).toEqual(KNOWN_PLATFORMS);
  });

  it('flattens aliases in declaration order', () => {
    const profiles = [
      { id: 'a', preset: 'social-media', page: 'p/a', aliases: ['a1', 'a2'] },
      { id: 'b', preset: 'appstore', page: 'p/b', aliases: ['b1'] },
    ];
    expect(Object.keys(buildPlatformMap(profiles))).toEqual(['a1', 'a2', 'b1']);
  });
});
