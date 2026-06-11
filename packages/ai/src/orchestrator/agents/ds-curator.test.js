// @vitest-environment node
//
// Unit tests for the DS Curator node — brand-token authority. Pins:
//   - `_design-system.md` is PRIMARY; `config.json` `vars` is SECONDARY,
//   - a token both sources define DIFFERENTLY emits a conflict tool-call note
//     and resolves to the primary value (never auto-reconciles),
//   - secondary fills gaps the primary leaves,
//   - Story 8.3 review proto-safety: a token named `constructor` is stored as a
//     real own key (Object.create(null) map) and does not break resolution.

import { describe, it, expect, vi } from 'vitest';

import {
  createDsCuratorNode,
  createDSCurator,
  toClarifyingNotes,
  matchTokenReferences,
  canonToken,
} from './ds-curator.js';
import { DESIGN_SYSTEM_PATH } from '../../memory/paths.js';

const DS_PATH = '.lerret/_design-system.md';
const CFG_PATH = '.lerret/config.json';

/**
 * A sandbox stub backed by a plain map of relPath → string contents. A missing
 * path makes `exists` false and `readFile` throw (graceful-absence exercise).
 */
function makeSandbox(files = {}) {
  return {
    exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
    readFile: vi.fn(async (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error(`ENOENT ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    }),
  };
}

describe('createDsCuratorNode — authority order', () => {
  it('design-system PRIMARY wins on conflict and emits a conflict note', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- brand-orange: #ff6600',
      [CFG_PATH]: JSON.stringify({ vars: { 'brand-orange': '#ff0000' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    expect(out.brandTokens['brand-orange']).toBe('#ff6600'); // primary, not config
    const note = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'clarifying-note');
    expect(note).toBeDefined();
    expect(note.note).toMatch(/brand-token conflict on 'brand-orange'/);
    expect(note.note).toMatch(/using _design-system\.md \(primary\)/);
  });

  it('secondary (config vars) fills tokens the primary does not define; no spurious note', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- brand-orange: #ff6600',
      [CFG_PATH]: JSON.stringify({ vars: { radius: '8px' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    expect(out.brandTokens).toMatchObject({ 'brand-orange': '#ff6600', radius: '8px' });
    // Disjoint keys → no conflict note.
    expect(emit.mock.calls.some((c) => c[0]?.type === 'clarifying-note')).toBe(false);
  });

  it('agreeing values do not emit a conflict note', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- brand-orange: #ff6600',
      [CFG_PATH]: JSON.stringify({ vars: { 'brand-orange': '#ff6600' } }),
    });
    await createDsCuratorNode({ sandbox, emit })({});
    expect(emit.mock.calls.some((c) => c[0]?.type === 'clarifying-note')).toBe(false);
  });

  it("real-vocabulary conflict: DS 'brand' vs vars 'brandColor' fires, names the config key, and DEDUPES brandTokens", async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '```lerret-tokens\ncolors:\n  brand: "#B85B33"\n```',
      [CFG_PATH]: JSON.stringify({ vars: { brandColor: '#FF0000', radius: '8px' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    // Primary wins; the canonically-colliding secondary var is EXCLUDED so
    // brandTokens never carries both brand:#B85B33 and brandcolor:#FF0000.
    expect(out.brandTokens.brand).toBe('#B85B33');
    expect(out.brandTokens.brandcolor).toBeUndefined();
    expect(out.brandTokens.radius).toBe('8px'); // non-colliding var still fills the gap
    const note = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'clarifying-note');
    expect(note).toBeDefined();
    expect(note.note).toMatch(/brand-token conflict on 'brand'/);
    expect(note.note).toContain("brandColor"); // the user's ACTUAL var key
    expect(note.note).toContain('#FF0000');
    expect(note.note).toMatch(/using _design-system\.md \(primary\)/);
  });

  it('a canonically-colliding var that AGREES is excluded from brandTokens without a note', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '```lerret-tokens\ncolors:\n  brand: "#B85B33"\n```',
      [CFG_PATH]: JSON.stringify({ vars: { brandColor: '#B85B33' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    expect(out.brandTokens).toEqual({ brand: '#B85B33' });
    expect(emit.mock.calls.some((c) => c[0]?.type === 'clarifying-note')).toBe(false);
  });

  it('case-different same hex values are NOT a conflict (normalized compare)', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- brand-orange: #ff6600',
      [CFG_PATH]: JSON.stringify({ vars: { 'brand-orange': '#FF6600' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    expect(out.brandTokens['brand-orange']).toBe('#ff6600');
    expect(emit.mock.calls.some((c) => c[0]?.type === 'clarifying-note')).toBe(false);
  });
});

describe('canonToken — canonical cross-source token form', () => {
  it('lowercases, strips non-alphanumerics, strips ONE trailing color/colour/font suffix', () => {
    expect(canonToken('brandColor')).toBe('brand');
    expect(canonToken('accent-color')).toBe('accent');
    expect(canonToken('displayFont')).toBe('display');
    expect(canonToken('brand_colour')).toBe('brand');
    expect(canonToken('brand')).toBe('brand');
    expect(canonToken('NeutralDark')).toBe('neutraldark');
  });

  it("a bare 'color'/'colour'/'font' stays itself (nothing before the suffix)", () => {
    expect(canonToken('color')).toBe('color');
    expect(canonToken('colour')).toBe('colour');
    expect(canonToken('font')).toBe('font');
  });

  it('strips only ONE suffix layer', () => {
    expect(canonToken('colorColor')).toBe('color');
  });
});

describe('createDsCuratorNode — graceful absence + robustness', () => {
  it('no files → empty brandTokens, no events, no throw', async () => {
    const emit = vi.fn();
    const out = await createDsCuratorNode({ sandbox: makeSandbox({}), emit })({});
    expect(out.brandTokens).toEqual({});
    expect(emit).not.toHaveBeenCalled();
  });

  it('malformed config.json is swallowed; primary still resolves', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- brand-orange: #ff6600',
      [CFG_PATH]: '{ this is : not json',
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    expect(out.brandTokens).toEqual({ 'brand-orange': '#ff6600' });
  });

  it('aborted signal short-circuits to empty brandTokens without reading', async () => {
    const sandbox = makeSandbox({ [DS_PATH]: '- x: #fff' });
    const controller = new AbortController();
    controller.abort();
    const out = await createDsCuratorNode({ sandbox, emit: vi.fn() })({
      signal: controller.signal,
    });
    expect(out.brandTokens).toEqual({});
    expect(sandbox.exists).not.toHaveBeenCalled();
  });
});

describe('createDsCuratorNode — prototype-pollution safety', () => {
  it("a token named 'constructor' is captured as data, conflicts correctly, and never pollutes", async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({
      [DS_PATH]: '- constructor: #fff',
      [CFG_PATH]: JSON.stringify({ vars: { constructor: '#000' } }),
    });
    const out = await createDsCuratorNode({ sandbox, emit })({});
    // Resolved as a plain data value, primary wins.
    expect(out.brandTokens.constructor).toBe('#fff');
    // Conflict surfaced like any other token.
    const note = emit.mock.calls.map((c) => c[0]).find((e) => e.type === 'clarifying-note');
    expect(note.note).toMatch(/brand-token conflict on 'constructor'/);
    // Object.prototype is untouched.
    expect(Object.prototype.constructor).toBe(Object);
  });
});

// ─── Story 8.6 additions ─────────────────────────────────────────────────────

const ROOT = '/proj';

const CANONICAL_DS = [
  '## Brand tokens',
  '```lerret-tokens',
  'colors:',
  '  brand: "#B85B33"',
  '  accent: "#F1EDE5"',
  'fonts:',
  '  display: "Geist"',
  '```',
].join('\n');

/** Read-only `fs` over an absolute-path map; ENOENT on absence. */
function makeReadFs(files = {}) {
  return {
    readFile: vi.fn(async (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error(`ENOENT ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    }),
  };
}

describe('matchTokenReferences', () => {
  it('matches a direct token-name mention in the prompt', () => {
    expect(matchTokenReferences('use the brand color', ['brand', 'accent'])).toContain(
      'brand',
    );
  });

  it('resolves the "our brand" natural-language alias to brand-ish tokens', () => {
    const hits = matchTokenReferences('paint it in our brand', ['brand', 'accent']);
    expect(hits).toContain('brand');
    expect(hits).not.toContain('accent');
  });

  it('returns [] when the prompt references no known token', () => {
    expect(matchTokenReferences('a quiet poem', ['brand', 'accent'])).toEqual([]);
  });
});

describe('createDSCurator — resolveTokens (design-system PRIMARY)', () => {
  it('resolves a referenced token from _design-system.md (primary), not config vars', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { resolved } = await curator.resolveTokens({
      prompt: 'render the brand color block',
      vars: { brand: '#FF0000' },
    });
    const brand = resolved.find((r) => r.ref === 'brand');
    expect(brand).toMatchObject({ source: 'design-system', value: '#B85B33' });
    // Absolute-path threading: the DS file is read at projectRoot + rel.
    expect(fs.readFile).toHaveBeenCalledWith(`${ROOT}/${DESIGN_SYSTEM_PATH}`, {
      encoding: 'utf-8',
    });
  });

  it('falls back to config vars only when the design system lacks the token', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { resolved } = await curator.resolveTokens({
      prompt: 'use the radius token',
      vars: { radius: '12px' },
    });
    expect(resolved.find((r) => r.ref === 'radius')).toMatchObject({
      source: 'config-vars',
      value: '12px',
    });
  });

  it('a fresh project with no _design-system.md resolves purely from vars (graceful absence)', async () => {
    const curator = createDSCurator({ projectRoot: ROOT, fs: makeReadFs({}) });
    const { resolved, conflicts } = await curator.resolveTokens({
      prompt: 'the brand color',
      vars: { brand: '#123456' },
    });
    expect(resolved).toEqual([{ ref: 'brand', source: 'config-vars', value: '#123456' }]);
    expect(conflicts).toEqual([]);
  });
});

describe('createDSCurator — conflict detection (AC-3)', () => {
  it('records a conflict when both sources define a token differently; resolves to design-system', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { resolved, conflicts } = await curator.resolveTokens({
      prompt: 'use the brand color',
      targetScope: 'social-media/',
      vars: { brand: '#FF0000' }, // mismatching
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      token: 'brand',
      designSystemValue: '#B85B33',
      configValue: '#FF0000',
      scope: 'social-media/',
    });
    // RESOLVED value is the design-system one — turn proceeds, never blocks.
    expect(resolved.find((r) => r.ref === 'brand').value).toBe('#B85B33');
  });

  it('agreeing values produce NO conflict', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { conflicts } = await curator.resolveTokens({
      prompt: 'use the brand color',
      vars: { brand: '#B85B33' },
    });
    expect(conflicts).toEqual([]);
  });

  it('surfaces a conflict even when the prompt does not name the token (project-health signal)', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { conflicts } = await curator.resolveTokens({
      prompt: 'make a poster', // no token mention
      vars: { brand: '#FF0000' },
    });
    expect(conflicts.map((c) => c.token)).toContain('brand');
  });

  it("real vocabulary: DS 'brand' vs vars 'brandColor' → ONE conflict naming brandColor, resolved to the DS value", async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { resolved, conflicts } = await curator.resolveTokens({
      prompt: 'use the brand color',
      targetScope: 'social-media/',
      vars: { brandColor: '#FF0000', accentColor: '#F1EDE5', radius: '12px' },
    });
    // Exactly one conflict (accentColor agrees with `accent`; radius has no
    // primary counterpart), carrying BOTH original names.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      token: 'brand',
      configToken: 'brandColor',
      designSystemValue: '#B85B33',
      configValue: '#FF0000',
      scope: 'social-media/',
    });
    // RESOLVED value is the design-system one — turn proceeds, never blocks.
    expect(resolved.find((r) => r.ref === 'brand').value).toBe('#B85B33');
    // No resolution ever surfaces the contradicting config value.
    expect(resolved.some((r) => r.value === '#FF0000')).toBe(false);
  });

  it('a prompt referencing `brand` resolves a SECONDARY-ONLY `brandColor` var via canonical match', async () => {
    // No _design-system.md at all — vars is the only source.
    const curator = createDSCurator({ projectRoot: ROOT, fs: makeReadFs({}) });
    const { resolved, conflicts } = await curator.resolveTokens({
      prompt: 'paint it in our brand',
      vars: { brandColor: '#123456' },
    });
    expect(resolved).toEqual([
      { ref: 'brandcolor', source: 'config-vars', value: '#123456' },
    ]);
    expect(conflicts).toEqual([]);
  });

  it('case-different same hex values are NOT a conflict (normalized compare)', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { conflicts } = await curator.resolveTokens({
      prompt: 'use the brand color',
      vars: { brandColor: '#b85b33' }, // same hex as the DS '#B85B33', lowercased
    });
    expect(conflicts).toEqual([]);
  });

  it('omits configToken when the config key IS the design-system token name', async () => {
    const fs = makeReadFs({ [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: CANONICAL_DS });
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    const { conflicts } = await curator.resolveTokens({
      prompt: 'use the brand color',
      vars: { brand: '#FF0000' },
    });
    expect(conflicts[0].token).toBe('brand');
    expect(conflicts[0]).not.toHaveProperty('configToken');
  });
});

describe('toClarifyingNotes', () => {
  it('the note carries BOTH values (resolved DS value + the config value it overrode)', () => {
    const notes = toClarifyingNotes([
      {
        token: 'brand',
        designSystemValue: '#B85B33',
        configValue: '#FF0000',
        scope: 'social-media/',
      },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('clarifying-note');
    expect(notes[0].token).toBe('brand');
    expect(notes[0].designSystemValue).toBe('#B85B33');
    expect(notes[0].configValue).toBe('#FF0000');
    expect(notes[0].scope).toBe('social-media/');
    expect(notes[0].note).toContain('#B85B33');
    expect(notes[0].note).toContain('#FF0000'); // the overridden config value, in the copy
    expect(notes[0].note).toContain('_design-system.md');
    // Calm voice: no exclamation marks.
    expect(notes[0].note).not.toContain('!');
  });

  it("names the user's ACTUAL config key (configToken) in the note copy", () => {
    const notes = toClarifyingNotes([
      {
        token: 'brand',
        configToken: 'brandColor',
        designSystemValue: '#B85B33',
        configValue: '#FF0000',
        scope: 'social-media/',
      },
    ]);
    expect(notes[0].configToken).toBe('brandColor');
    expect(notes[0].note).toContain('brandColor');
    expect(notes[0].note).toContain('`social-media/config.json`');
    expect(notes[0].note).toContain('#B85B33');
    expect(notes[0].note).toContain('#FF0000');
    expect(notes[0].note).not.toContain('!');
  });

  it('returns [] for a non-array / empty input', () => {
    expect(toClarifyingNotes([])).toEqual([]);
    expect(toClarifyingNotes(null)).toEqual([]);
  });
});

describe('createDSCurator — read-only invariant', () => {
  it('the agent surface exposes no write method and never receives a sandbox', () => {
    const fs = makeReadFs({});
    const curator = createDSCurator({ projectRoot: ROOT, fs });
    // The DS Curator MUST NOT write config.json or _design-system.md.
    expect(curator.writeFile).toBeUndefined();
    expect(curator.deleteFile).toBeUndefined();
    expect(Object.keys(curator).sort()).toEqual(['resolveTokens', 'toClarifyingNotes']);
  });

  it('throws if constructed without a readable fs', () => {
    expect(() => createDSCurator({ projectRoot: ROOT, fs: {} })).toThrow(/readFile/);
    expect(() => createDSCurator({ projectRoot: '', fs: makeReadFs({}) })).toThrow(
      /projectRoot/,
    );
  });

  it('throws TypeError on a non-absolute projectRoot (mirrors createMockSandbox)', () => {
    const fs = makeReadFs({});
    expect(() => createDSCurator({ projectRoot: 'proj', fs })).toThrow(TypeError);
    expect(() => createDSCurator({ projectRoot: 'proj', fs })).toThrow(/projectRoot/);
    expect(() => createDSCurator({ projectRoot: 42, fs })).toThrow(/projectRoot/);
    expect(() => createDSCurator({ projectRoot: '/abs', fs })).not.toThrow();
  });
});
