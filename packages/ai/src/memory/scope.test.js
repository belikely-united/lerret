// @vitest-environment node
//
// Unit tests for the path-scoped anchoring parser (scope.js, PURE).

import { describe, it, expect } from 'vitest';

import {
  parseScopedSections,
  resolveScopedContext,
  longestPrefixMatch,
  normalizeScopeKey,
  normalizeTargetScope,
} from './scope.js';

describe('normalizeScopeKey', () => {
  it('trims and ensures exactly one trailing slash', () => {
    expect(normalizeScopeKey('  social ')).toBe('social/');
    expect(normalizeScopeKey('social/')).toBe('social/');
    expect(normalizeScopeKey('social///')).toBe('social/');
  });

  it('an empty / whitespace raw key normalizes to the root scope', () => {
    expect(normalizeScopeKey('')).toBe('/');
    expect(normalizeScopeKey('   ')).toBe('/');
  });
});

describe('parseScopedSections', () => {
  it('returns all-global when there are no scope comments', () => {
    const { global, scopes } = parseScopedSections('# Title\n\nbody text');
    expect(global).toBe('# Title\n\nbody text');
    expect(scopes.size).toBe(0);
  });

  it('splits a global block and N keyed scope sections', () => {
    const md = [
      'global rule one',
      '<!-- scope: social/ -->',
      'social rule',
      '<!-- scope: appstore/ -->',
      'appstore rule',
    ].join('\n');
    const { global, scopes } = parseScopedSections(md);
    expect(global).toBe('global rule one');
    expect(scopes.get('social/')).toBe('social rule');
    expect(scopes.get('appstore/')).toBe('appstore rule');
    expect(scopes.size).toBe(2);
  });

  it('content before the first scope comment is global; trailing scope reaches EOF', () => {
    const md = 'pre\n<!-- scope: x/ -->\nlast line';
    const { global, scopes } = parseScopedSections(md);
    expect(global).toBe('pre');
    expect(scopes.get('x/')).toBe('last line');
  });

  it('normalizes scope keys (no trailing slash in the comment → adds one)', () => {
    const { scopes } = parseScopedSections('<!-- scope: social -->\nrule');
    expect(scopes.has('social/')).toBe(true);
  });

  it('an empty / non-string input yields empty global + empty map', () => {
    expect(parseScopedSections('')).toEqual({ global: '', scopes: new Map() });
    expect(parseScopedSections(null)).toEqual({ global: '', scopes: new Map() });
  });

  it('merges repeated sections with the same scope key', () => {
    const md =
      '<!-- scope: a/ -->\nfirst\n<!-- scope: b/ -->\nb\n<!-- scope: a/ -->\nsecond';
    const { scopes } = parseScopedSections(md);
    expect(scopes.get('a/')).toBe('first\n\nsecond');
    expect(scopes.get('b/')).toBe('b');
  });

  it('the scope marker is case-insensitive (<!-- Scope: x/ --> works)', () => {
    const titleCase = parseScopedSections('<!-- Scope: social/ -->\nrule');
    expect(titleCase.scopes.get('social/')).toBe('rule');
    const upper = parseScopedSections('g\n<!-- SCOPE: appstore/ -->\nA rule');
    expect(upper.global).toBe('g');
    expect(upper.scopes.get('appstore/')).toBe('A rule');
  });

  it("a `<!-- scope: / -->` section folds into the GLOBAL block (never silently dropped)", () => {
    const { global, scopes } = parseScopedSections('pre\n<!-- scope: / -->\nroot rule');
    expect(global).toContain('pre');
    expect(global).toContain('root rule');
    expect(scopes.size).toBe(0);
    // …and therefore reaches EVERY target through resolveScopedContext.
    const out = resolveScopedContext(
      { designSystem: 'pre\n<!-- scope: / -->\nroot rule' },
      'appstore/',
    );
    expect(out).toContain('root rule');
  });
});

describe('longestPrefixMatch', () => {
  it('picks the longest scope key that prefixes the target (closer-scope wins)', () => {
    const scopes = new Map([
      ['social/', 'broad'],
      ['social/twitter/', 'narrow'],
    ]);
    expect(longestPrefixMatch(scopes, 'social/twitter/')).toBe('narrow');
    expect(longestPrefixMatch(scopes, 'social/instagram/')).toBe('broad');
  });

  it('returns empty string when no key prefixes the target', () => {
    const scopes = new Map([['social/', 'x']]);
    expect(longestPrefixMatch(scopes, 'appstore/')).toBe('');
  });

  it('a sibling-name lookalike does not falsely prefix-match', () => {
    // 'social/' must NOT match 'social-media/' (not a folder prefix).
    const scopes = new Map([['social/', 'x']]);
    expect(longestPrefixMatch(scopes, normalizeTargetScope('social-media'))).toBe('');
  });
});

describe('resolveScopedContext', () => {
  const designSystem = 'DS global\n<!-- scope: social-media/ -->\nDS social';
  const context = 'CTX global';
  const memory = 'MEM global';

  it('includes both global blocks plus the closest-scope section for the target', () => {
    const out = resolveScopedContext({ designSystem, context, memory }, 'social-media/');
    expect(out).toContain('DS global');
    expect(out).toContain('DS social');
    expect(out).toContain('CTX global');
    expect(out).toContain('MEM global');
  });

  it('a target that matches no scope still returns the global blocks (no scoped leak)', () => {
    const out = resolveScopedContext({ designSystem, context, memory }, 'appstore/');
    expect(out).toContain('DS global');
    expect(out).not.toContain('DS social'); // closer-scope-wins: no match → excluded
  });

  it('treats _memory.md uniformly — its scope comments also apply', () => {
    const mem = 'mem global\n<!-- scope: talks/ -->\nmem talks';
    const out = resolveScopedContext(
      { designSystem: '', context: '', memory: mem },
      'talks/',
    );
    expect(out).toContain('mem global');
    expect(out).toContain('mem talks');
  });

  it('a nullish target scope yields global content only', () => {
    const out = resolveScopedContext({ designSystem, context, memory }, undefined);
    expect(out).toContain('DS global');
    expect(out).not.toContain('DS social');
  });
});
