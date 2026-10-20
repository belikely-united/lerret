// asset-platforms.test.js — integrity checks for the New-asset size presets.

import { describe, expect, it } from 'vitest';
import { validateAssetDimensions } from '@lerret/core';

import {
  ASSET_PLATFORMS,
  CUSTOM_PLATFORM_ID,
  findPlatform,
  formatRatio,
  defaultFormatCounts,
  expandFormatSet,
  uniqueName,
} from './asset-platforms.js';

describe('ASSET_PLATFORMS', () => {
  it('has unique platform ids, none colliding with the custom option', () => {
    const ids = ASSET_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(CUSTOM_PLATFORM_ID);
  });

  it('every platform has formats with unique ids and creatable sizes', () => {
    for (const platform of ASSET_PLATFORMS) {
      expect(platform.formats.length).toBeGreaterThan(0);
      const ids = platform.formats.map((f) => f.id);
      expect(new Set(ids).size, platform.id).toBe(ids.length);
      for (const f of platform.formats) {
        expect(validateAssetDimensions(f), `${platform.id}/${f.id}`).toEqual({ ok: true });
      }
    }
  });

  it('includes the Microsoft Store, defaulting to a desktop screenshot', () => {
    const ms = findPlatform('microsoftstore');
    expect(ms.label).toBe('Microsoft Store');
    expect(ms.formats[0]).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe('formatRatio', () => {
  it('reduces small ratios exactly and approximates the rest', () => {
    expect(formatRatio(1080, 1920)).toBe('9:16');
    expect(formatRatio(1440, 2160)).toBe('2:3');
    expect(formatRatio(1200, 630)).toBe('1.9:1');
  });
});

describe('format sets', () => {
  it('defaults to what a real listing needs', () => {
    expect(defaultFormatCounts(findPlatform('microsoftstore'))).toEqual({ screenshot: 5, hero: 1, poster: 1 });
    expect(defaultFormatCounts(findPlatform('appstore'))).toEqual({ 'iphone-69': 5 });
    expect(defaultFormatCounts({ id: 'p', label: 'P', formats: [{ id: 'a', label: 'A', width: 10, height: 10 }] })).toEqual({ a: 1 });
  });

  it('expands counts into named assets in format order', () => {
    const items = expandFormatSet(findPlatform('microsoftstore'), { hero: 1, screenshot: 2 });
    expect(items.map((i) => i.name)).toEqual(['desktop-screenshot-1', 'desktop-screenshot-2', 'hero-art']);
    expect(items[2].dimensions).toEqual({ width: 1920, height: 1080 });
    expect(expandFormatSet(findPlatform('microsoftstore'), { screenshot: 99 })).toHaveLength(10);
  });

  it('picks a unique group name', () => {
    expect(uniqueName('Microsoft Store', [])).toBe('Microsoft Store');
    expect(uniqueName('Microsoft Store', ['microsoft store', 'Microsoft Store 2'])).toBe('Microsoft Store 3');
  });
});
