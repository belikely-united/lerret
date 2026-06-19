// entry-name.test.js — name validation + starter-content helpers.

import { describe, expect, it } from 'vitest';

import {
  validateEntryName,
  assetFileName,
  componentIdentifier,
  starterAssetContent,
  starterAssetData,
  MAX_ENTRY_NAME_LENGTH,
} from './entry-name.js';

describe('validateEntryName', () => {
  it('accepts ordinary names (incl. spaces, dashes, unicode)', () => {
    expect(validateEntryName('landing', { kind: 'page' })).toEqual({ ok: true, name: 'landing' });
    expect(validateEntryName('tw-banner', { kind: 'group' })).toEqual({ ok: true, name: 'tw-banner' });
    expect(validateEntryName('My Page', { kind: 'page' })).toEqual({ ok: true, name: 'My Page' });
    expect(validateEntryName('Café', { kind: 'page' })).toEqual({ ok: true, name: 'Café' });
  });

  it('trims whitespace and trailing dots/spaces', () => {
    expect(validateEntryName('  hero  ', { kind: 'asset' })).toEqual({ ok: true, name: 'hero' });
    expect(validateEntryName('hero. ', { kind: 'group' })).toEqual({ ok: true, name: 'hero' });
  });

  it('rejects empty / whitespace-only', () => {
    expect(validateEntryName('', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('   ', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName(null, { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName(42, { kind: 'page' }).ok).toBe(false);
  });

  it('rejects path separators and OS-illegal characters', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(validateEntryName(bad, { kind: 'page' }).ok).toBe(false);
    }
  });

  it('allows spaces but rejects control characters', () => {
    expect(validateEntryName('a b', { kind: 'page' }).ok).toBe(true);
    const nul = String.fromCharCode(0);
    const tab = String.fromCharCode(9);
    expect(validateEntryName('a' + nul + 'b', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('tab' + tab + 'name', { kind: 'group' }).ok).toBe(false);
  });

  it('rejects "." / ".." and leading-dot names', () => {
    expect(validateEntryName('.', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('..', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('.hidden', { kind: 'group' }).ok).toBe(false);
  });

  it('reserves leading underscore for folders, but allows it for files', () => {
    expect(validateEntryName('_foo', { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('_foo', { kind: 'group' }).ok).toBe(false);
    expect(validateEntryName('_foo', { kind: 'asset' })).toEqual({ ok: true, name: '_foo' });
  });

  it('rejects Windows reserved device names (case-insensitively)', () => {
    for (const bad of ['CON', 'con', 'PRN', 'nul', 'COM1', 'lpt9']) {
      expect(validateEntryName(bad, { kind: 'page' }).ok).toBe(false);
    }
  });

  it('enforces the length cap', () => {
    const long = 'a'.repeat(MAX_ENTRY_NAME_LENGTH + 1);
    expect(validateEntryName(long, { kind: 'page' }).ok).toBe(false);
    expect(validateEntryName('a'.repeat(MAX_ENTRY_NAME_LENGTH), { kind: 'page' }).ok).toBe(true);
  });

  it('strips a recognized asset extension from an asset name', () => {
    expect(validateEntryName('Hero.jsx', { kind: 'asset' })).toEqual({ ok: true, name: 'Hero' });
    expect(validateEntryName('Hero.TSX', { kind: 'asset' })).toEqual({ ok: true, name: 'Hero' });
    expect(validateEntryName('notes.md', { kind: 'asset' })).toEqual({ ok: true, name: 'notes' });
    // A non-asset extension stays part of the name (it's not stripped).
    expect(validateEntryName('data.json', { kind: 'asset' })).toEqual({ ok: true, name: 'data.json' });
  });
});

describe('assetFileName', () => {
  it('appends the right extension per kind', () => {
    expect(assetFileName('Hero', 'component')).toBe('Hero.jsx');
    expect(assetFileName('notes', 'markdown')).toBe('notes.md');
  });
});

describe('componentIdentifier', () => {
  it('produces a valid PascalCase identifier', () => {
    expect(componentIdentifier('tw-banner')).toBe('TwBanner');
    expect(componentIdentifier('og card')).toBe('OgCard');
    expect(componentIdentifier('01-intro')).toBe('A01Intro');
    expect(componentIdentifier('!!!')).toBe('Asset');
  });
});

describe('starterAssetContent', () => {
  it('component starter is a valid, data-driven renderable module', () => {
    const src = starterAssetContent('tw-banner', 'component');
    expect(src).toContain('export const meta');
    // Data-driven: declares a `title` prop in propsSchema and reads it, so the
    // text comes from the companion data file (Tier 1), not a baked-in literal.
    expect(src).toContain('propsSchema');
    expect(src).toContain('export default function TwBanner({ title = "tw-banner" })');
    expect(src).toContain('{title}');
  });

  it('markdown starter is a heading + prompt (no data file)', () => {
    const src = starterAssetContent('Notes', 'markdown');
    expect(src.startsWith('# Notes')).toBe(true);
    expect(src).not.toContain('propsSchema');
  });

  it('escapes a hostile display label safely', () => {
    // A quote in the name must not break the generated JS string (prop default).
    const src = starterAssetContent('a"b', 'component');
    expect(src).toContain('"a\\"b"');
  });
});

describe('starterAssetData', () => {
  it('is the companion JSON holding the title text, keyed to the title prop', () => {
    const data = starterAssetData('tw-banner');
    expect(JSON.parse(data)).toEqual({ title: 'tw-banner' });
  });

  it('round-trips a name containing quotes through valid JSON', () => {
    const data = starterAssetData('a"b');
    expect(JSON.parse(data)).toEqual({ title: 'a"b' });
  });
});
