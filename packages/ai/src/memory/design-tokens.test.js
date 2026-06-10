// @vitest-environment node
//
// Unit tests for the design-token parser (design-tokens.js, PURE).

import { describe, it, expect } from 'vitest';

import { parseDesignTokens, flattenTokens, lookupToken } from './design-tokens.js';

const CANONICAL = [
  '# Design System',
  '',
  '## Brand tokens',
  '',
  '```lerret-tokens',
  'colors:',
  '  brand: "#B85B33"',
  '  accent: "#F1EDE5"',
  '  neutralDark: "#1A1714"',
  'fonts:',
  '  display: "Geist"',
  '  body: "Geist"',
  '```',
  '',
  '## Voice',
  '- calm',
].join('\n');

describe('parseDesignTokens — canonical lerret-tokens block', () => {
  it('extracts the color palette', () => {
    const { colors } = parseDesignTokens(CANONICAL);
    expect(colors.get('brand')).toBe('#B85B33');
    expect(colors.get('accent')).toBe('#F1EDE5');
    expect(colors.get('neutralDark')).toBe('#1A1714');
  });

  it('extracts the type system', () => {
    const { fonts } = parseDesignTokens(CANONICAL);
    expect(fonts.get('display')).toBe('Geist');
    expect(fonts.get('body')).toBe('Geist');
  });

  it('mirrors keys lowercase for case-insensitive lookup', () => {
    const { colors } = parseDesignTokens(CANONICAL);
    // `neutralDark` is also reachable as `neutraldark`.
    expect(colors.get('neutraldark')).toBe('#1A1714');
  });

  it('strips surrounding quotes and ignores prose outside the fence', () => {
    const { colors, raw } = parseDesignTokens(CANONICAL);
    expect(colors.get('brand')).toBe('#B85B33'); // no quotes
    expect(raw.colors.brand).toBe('#B85B33');
    // Voice prose ("calm") never leaks into tokens.
    expect([...colors.keys()]).not.toContain('calm');
  });

  it('reads only the FIRST lerret-tokens block', () => {
    const md = CANONICAL + '\n```lerret-tokens\ncolors:\n  brand: "#000000"\n```';
    const { colors } = parseDesignTokens(md);
    expect(colors.get('brand')).toBe('#B85B33'); // first block wins
  });

  it('a top-level `key: value` line CLOSES the open sub-map and is never a token', () => {
    // Module contract: only INDENTED lines under an open sub-map populate it;
    // a non-indented `key: value` resets the sub-map and is otherwise ignored.
    const md = [
      '```lerret-tokens',
      'colors:',
      '  brand: "#B85B33"',
      'title: My Brand',
      '  sneaky: "#000000"',
      '```',
    ].join('\n');
    const { colors, fonts } = parseDesignTokens(md);
    expect(colors.get('brand')).toBe('#B85B33');
    expect(colors.has('title')).toBe(false); // not mis-attributed as a color
    expect(colors.has('sneaky')).toBe(false); // sub-map was closed by the top-level line
    expect(fonts.size).toBe(0);
  });
});

describe('parseDesignTokens — values with trailing YAML-style comments', () => {
  it('a quoted value takes the quoted content, ignoring a trailing comment', () => {
    const md = '```lerret-tokens\ncolors:\n  brand: "#B85B33" # primary\n```';
    expect(parseDesignTokens(md).colors.get('brand')).toBe('#B85B33');
  });

  it('an unquoted value strips a trailing ` # comment` without eating a bare hex', () => {
    const md = [
      '```lerret-tokens',
      'colors:',
      '  brand: #B85B33',
      '  size: 12px # note',
      '```',
    ].join('\n');
    const { colors } = parseDesignTokens(md);
    expect(colors.get('brand')).toBe('#B85B33'); // bare hex untouched
    expect(colors.get('size')).toBe('12px'); // comment stripped
  });
});

describe('parseDesignTokens — fail-soft', () => {
  it('returns empty maps for input with no fenced block (never throws)', () => {
    const { colors, fonts } = parseDesignTokens('# just prose, no tokens');
    expect(colors.size).toBe(0);
    expect(fonts.size).toBe(0);
  });

  it('returns empty maps for non-string / empty input', () => {
    expect(parseDesignTokens('').colors.size).toBe(0);
    expect(parseDesignTokens(null).fonts.size).toBe(0);
    expect(parseDesignTokens(undefined).colors.size).toBe(0);
  });
});

describe('flattenTokens', () => {
  it('merges colors + fonts into one lookup map', () => {
    const parsed = parseDesignTokens(CANONICAL);
    const flat = flattenTokens(parsed);
    expect(flat.get('brand')).toBe('#B85B33');
    expect(flat.get('display')).toBe('Geist');
  });
});

describe('lookupToken — case-insensitive BOTH directions', () => {
  it('a lowercase query resolves a mixed-case stored key (the mirror direction)', () => {
    const { colors } = parseDesignTokens(CANONICAL);
    expect(lookupToken(colors, 'neutraldark')).toBe('#1A1714');
    expect(lookupToken(colors, 'neutralDark')).toBe('#1A1714'); // verbatim still wins
  });

  it('a mixed-case query resolves a lowercase stored key (the query direction)', () => {
    const { colors, fonts } = parseDesignTokens(CANONICAL);
    expect(lookupToken(colors, 'Brand')).toBe('#B85B33');
    expect(lookupToken(colors, 'BRAND')).toBe('#B85B33');
    expect(lookupToken(fonts, 'Display')).toBe('Geist');
    expect(lookupToken(flattenTokens(parseDesignTokens(CANONICAL)), 'NEUTRALDARK')).toBe(
      '#1A1714',
    );
  });

  it('misses and bad inputs return undefined (never throw)', () => {
    const { colors } = parseDesignTokens(CANONICAL);
    expect(lookupToken(colors, 'nope')).toBeUndefined();
    expect(lookupToken(null, 'brand')).toBeUndefined();
    expect(lookupToken(colors, undefined)).toBeUndefined();
  });
});
