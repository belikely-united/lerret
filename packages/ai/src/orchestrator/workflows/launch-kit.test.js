// @vitest-environment node
//
// Unit tests for the W2 launch-kit planner (Story 8.8, Tasks 2 + 3). Uses the
// Story 8.5 in-memory FS + mock-sandbox helpers — no fake-indexeddb, no new
// test dep. Pins:
//   - missing-page creation: mkdir + starter .jsx + brand-anchored .data.json,
//   - existing-page path: NO component re-create, data refresh only (existing
//     keys survive),
//   - brand anchoring through the DS Curator authority chain (tokens primary,
//     preset vars secondary, ABSENT keys omitted — no placeholders),
//   - every emitted path starts with .lerret/; a doctored non-.lerret step
//     throws SandboxViolationError through the mock sandbox,
//   - preset rebase via discoverPresets-shaped input + unknown-platform skip.

import { describe, it, expect, vi } from 'vitest';

import { planLaunchKit, ensureLerretPrefix } from './launch-kit.js';
import { createWorker } from '../agents/worker.js';
import {
  createInMemoryFs,
  createMockSandbox,
  seedFs,
} from '../../snapshot/__test-helpers__/in-memory-fs.js';

const ROOT = '/proj';

/** The DSCurator-node-shaped brand tokens (lowercased keys, DS vocabulary). */
const TOKENS = Object.freeze({
  brand: '#B85B33',
  accent: '#F1EDE5',
  neutraldark: '#1A1714',
  display: 'Geist',
  body: 'Geist',
});

function makeWorld(files = {}) {
  const fs = createInMemoryFs();
  seedFs(
    fs,
    Object.fromEntries(Object.entries(files).map(([p, c]) => [`${ROOT}/${p}`, c])),
  );
  const sandbox = createMockSandbox(fs, ROOT);
  return { fs, sandbox };
}

function parseStepJson(step) {
  expect(step.op).toBe('write');
  return JSON.parse(step.content);
}

describe('ensureLerretPrefix', () => {
  it('prefixes a bare project-relative path and keeps an already-prefixed one', () => {
    expect(ensureLerretPrefix('social-media/twitter/a.jsx')).toBe(
      '.lerret/social-media/twitter/a.jsx',
    );
    expect(ensureLerretPrefix('.lerret/social-media/twitter/a.jsx')).toBe(
      '.lerret/social-media/twitter/a.jsx',
    );
    expect(ensureLerretPrefix('./social-media/a.jsx')).toBe('.lerret/social-media/a.jsx');
    expect(ensureLerretPrefix('/social-media/a.jsx')).toBe('.lerret/social-media/a.jsx');
  });
});

describe('planLaunchKit — missing-page creation (AC-2)', () => {
  it('emits mkdir + starter .jsx + .data.json per missing platform page, in platform order', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter, instagram, app store hero',
      platforms: ['twitter', 'instagram', 'app store hero'],
      brandTokens: TOKENS,
      fs: sandbox,
    });

    expect(steps.map((s) => `${s.op} ${s.path}`)).toEqual([
      'mkdir .lerret/social-media/twitter',
      'write .lerret/social-media/twitter/launch.jsx',
      'write .lerret/social-media/twitter/launch.data.json',
      'mkdir .lerret/social-media/instagram',
      'write .lerret/social-media/instagram/launch.jsx',
      'write .lerret/social-media/instagram/launch.data.json',
      'mkdir .lerret/appstore/hero',
      'write .lerret/appstore/hero/launch.jsx',
      'write .lerret/appstore/hero/launch.data.json',
    ]);
  });

  it('the starter component follows the themed-preset template shape (meta + var(--…) CSS vars)', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const jsx = steps.find((s) => s.path.endsWith('.jsx')).content;

    expect(jsx).toContain('export const meta = {');
    expect(jsx).toContain('dimensions: { width: 1200, height: 675 }');
    expect(jsx).toContain('propsSchema');
    expect(jsx).toContain('export default function TwitterLaunch(');
    // Brand-anchored render: the resolved token rides as the var() fallback.
    expect(jsx).toContain('var(--brandColor, #B85B33)');
    expect(jsx).toContain('var(--neutralDark, #1A1714)');
    expect(jsx).toContain('var(--accentColor, #F1EDE5)');
  });

  it('platform-specific artboard dimensions land in each starter meta', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — instagram, app store, product hunt',
      platforms: ['instagram', 'app store', 'product hunt'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const jsxFor = (frag) => steps.find((s) => s.path.includes(frag) && s.path.endsWith('.jsx')).content;
    expect(jsxFor('instagram')).toContain('width: 1080, height: 1080');
    expect(jsxFor('appstore/hero')).toContain('width: 1242, height: 2208');
    expect(jsxFor('producthunt/launch')).toContain('width: 1270, height: 760');
  });

  it('the starter .data.json carries brand-anchored values + the prompt-derived headline (AC-3)', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const data = parseStepJson(steps.find((s) => s.path.endsWith('.data.json')));

    expect(data.default.headline).toBe('v0.4 is live'); // prompt-derived
    expect(data.default.brandColor).toBe('#B85B33'); // token 'brand' via canonical match
    expect(data.default.accentColor).toBe('#F1EDE5');
    expect(data.default.neutralDark).toBe('#1A1714');
  });

  it('unresolved brand keys are OMITTED — never raw placeholder defaults', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: {}, // nothing resolved, no config vars in the project
      fs: sandbox,
    });
    const data = parseStepJson(steps.find((s) => s.path.endsWith('.data.json')));

    expect(data.default.headline).toBe('Launch day'); // copy fallback only
    expect(data.default).not.toHaveProperty('brandColor');
    expect(data.default).not.toHaveProperty('displayName');
    expect(data.default).not.toHaveProperty('handle');
  });

  it('preset config vars are the SECONDARY source: they fill gaps, tokens win collisions', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/config.json': JSON.stringify({
        _meta: { preset: 'social-media-v1' },
        vars: {
          brandColor: '#FF0000', // collides with token 'brand' → token wins
          displayName: 'Lerret', // no token → vars fill
          handle: '@lerret',
          tagline: 'Designs are just files.',
        },
      }),
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    const data = parseStepJson(steps.find((s) => s.path.endsWith('.data.json')));

    expect(data.default.brandColor).toBe('#B85B33'); // _design-system.md PRIMARY
    expect(data.default.displayName).toBe('Lerret'); // vars SECONDARY fill
    expect(data.default.handle).toBe('@lerret');
    expect(data.default.tagline).toBe('Designs are just files.');
    expect(data.default.subhead).toBe('Designs are just files.'); // tagline doubles as subhead copy
  });

  it('skips the mkdir when the page folder already exists (component still missing)', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/notes.md': '# scratch',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps.map((s) => s.op)).toEqual(['write', 'write']); // no mkdir
    expect(steps[0].path).toBe('.lerret/social-media/twitter/launch.jsx');
    expect(steps[1].path).toBe('.lerret/social-media/twitter/launch.data.json');
  });
});

describe('planLaunchKit — existing-page path (do not overwrite the component)', () => {
  it('an existing conventional launch.jsx yields ONE data write — no .jsx write, no mkdir', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored — must survive',
      '.lerret/social-media/twitter/launch.data.json': JSON.stringify({
        default: { headline: 'old', custom: 'keep-me' },
        Dark: { headline: 'dark' },
      }),
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].op).toBe('write');
    expect(steps[0].path).toBe('.lerret/social-media/twitter/launch.data.json');
    expect(steps.some((s) => s.path.endsWith('.jsx'))).toBe(false);

    const data = JSON.parse(steps[0].content);
    // Refresh, append — never replace: the named variant + custom props survive.
    expect(data.Dark).toEqual({ headline: 'dark' });
    expect(data.default.custom).toBe('keep-me');
    expect(data.default.headline).toBe('v0.4 is live');
    expect(data.default.brandColor).toBe('#B85B33');
  });

  it('a prompt WITHOUT a version reference never replaces an existing headline with canned copy', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored',
      '.lerret/social-media/twitter/launch.data.json': JSON.stringify({
        default: { headline: 'My hand-written headline', custom: 'keep-me' },
      }),
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter', // no vN → headline is the canned fallback, NOT derived
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });

    expect(steps).toHaveLength(1);
    const data = JSON.parse(steps[0].content);
    // The canned 'Launch day' fallback must NOT clobber the user's copy…
    expect(data.default.headline).toBe('My hand-written headline');
    expect(data.default.custom).toBe('keep-me');
    // …while the brand refresh still lands.
    expect(data.default.brandColor).toBe('#B85B33');
  });

  it('a derived headline (version in the prompt) still refreshes existing copy; starters still get the neutral line', async () => {
    // Existing page + version prompt → derived copy replaces the old headline.
    const existingWorld = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored',
      '.lerret/social-media/twitter/launch.data.json': JSON.stringify({
        default: { headline: 'old' },
      }),
    });
    const refreshed = await planLaunchKit({
      prompt: 'launch kit for v2 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: existingWorld.sandbox,
    });
    expect(JSON.parse(refreshed[0].content).default.headline).toBe('v2 is live');

    // Missing page + version-less prompt → the CREATION path still carries the
    // neutral copy (a brand-new starter needs SOME headline).
    const freshWorld = makeWorld();
    const created = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: freshWorld.sandbox,
    });
    const starterData = JSON.parse(
      created.find((s) => s.path.endsWith('.data.json')).content,
    );
    expect(starterData.default.headline).toBe('Launch day');
  });

  it('locates an existing component (any name) via the projectModel and targets ITS data file', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/post.jsx': '// existing component',
    });
    const projectModel = {
      pages: [
        {
          kind: 'page',
          name: 'social-media',
          path: `${ROOT}/.lerret/social-media`,
          assets: [],
          groups: [
            {
              kind: 'group',
              name: 'twitter',
              path: `${ROOT}/.lerret/social-media/twitter`,
              groups: [],
              assets: [
                {
                  kind: 'asset',
                  name: 'post',
                  fileName: 'post.jsx',
                  path: `${ROOT}/.lerret/social-media/twitter/post.jsx`,
                },
              ],
            },
          ],
        },
      ],
    };
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      projectModel,
      fs: sandbox,
    });

    expect(steps).toHaveLength(1);
    expect(steps[0].path).toBe('.lerret/social-media/twitter/post.data.json');
  });
});

describe('planLaunchKit — malformed existing data skips the refresh (file left untouched)', () => {
  it('an existing data file that fails to parse skips that platform entirely', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored',
      '.lerret/social-media/twitter/launch.data.json': '{ not json at all',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    // No write, no mkdir — a refresh would clobber state we cannot merge.
    expect(steps).toEqual([]);
  });

  it('an array-shaped data file also skips the refresh', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored',
      '.lerret/social-media/twitter/launch.data.json': '[{"headline":"not a variant map"}]',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toEqual([]);
  });

  it('a skipped platform does not block the other platforms in the same kit', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored',
      '.lerret/social-media/twitter/launch.data.json': '{ not json',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter and instagram',
      platforms: ['twitter', 'instagram'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    // Twitter (malformed data) skipped; Instagram (missing page) fully planned.
    expect(steps.map((s) => `${s.op} ${s.path}`)).toEqual([
      'mkdir .lerret/social-media/instagram',
      'write .lerret/social-media/instagram/launch.jsx',
      'write .lerret/social-media/instagram/launch.data.json',
    ]);
  });

  it('a MISSING data file beside an existing component still plans the fresh data write', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// hand-authored, no data file yet',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].path).toBe('.lerret/social-media/twitter/launch.data.json');
    expect(JSON.parse(steps[0].content).default.headline).toBe('v0.4 is live');
  });
});

describe('planLaunchKit — starter JSX burn-in hygiene', () => {
  it('a quote-bearing brand value falls back to the NEUTRAL inline value (parse-safe starter)', async () => {
    const evil = "#B85B33'; alert(1); '";
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: { brand: evil, accent: '#F1EDE5' },
      fs: sandbox,
    });
    const jsx = steps.find((s) => s.path.endsWith('.jsx')).content;

    // The unsafe value never lands in the source; the neutral stands in.
    expect(jsx).not.toContain(evil);
    expect(jsx).toContain('var(--brandColor, #444444)');
    // Safe values still burn in verbatim.
    expect(jsx).toContain('var(--accentColor, #F1EDE5)');
    // The DATA write still carries the raw value — JSON-encoding makes it
    // safe there, and brand authority is not the starter's to censor.
    const data = JSON.parse(steps.find((s) => s.path.endsWith('.data.json')).content);
    expect(data.default.brandColor).toBe(evil);
  });

  it('newline- and backtick-bearing values are also neutralized', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: { brand: '#fff\n#000', neutraldark: '`#111`' },
      fs: sandbox,
    });
    const jsx = steps.find((s) => s.path.endsWith('.jsx')).content;
    expect(jsx).toContain('var(--brandColor, #444444)');
    expect(jsx).toContain('var(--neutralDark, #111111)');
    expect(jsx).not.toContain('`#111`');
  });
});

describe('planLaunchKit — preset rebase + platform hygiene', () => {
  it("rebases the page onto the project's actual preset folder (discoverPresets-shaped input)", async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      presets: [{ preset: 'social-media', pagePath: `${ROOT}/.lerret/social`, matchedBy: 'meta' }],
      fs: sandbox,
    });
    expect(steps.map((s) => s.path)).toEqual([
      '.lerret/social/twitter',
      '.lerret/social/twitter/launch.jsx',
      '.lerret/social/twitter/launch.data.json',
    ]);
  });

  it('ignores an unsafe rebase root (traversal) and falls back to the canonical page', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      presets: [{ preset: 'social-media', pagePath: '../evil', matchedBy: 'meta' }],
      fs: sandbox,
    });
    expect(steps[0].path).toBe('.lerret/social-media/twitter');
    expect(steps.every((s) => s.path.startsWith('.lerret/') && !s.path.includes('..'))).toBe(
      true,
    );
  });

  it('skips unknown platforms and dedupes same-page keywords (twitter + x)', async () => {
    const { sandbox } = makeWorld();
    const steps = await planLaunchKit({
      prompt: 'launch kit — twitter, x, myspace',
      platforms: ['twitter', 'x', 'myspace'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    // ONE page planned: twitter and x share social-media/twitter; myspace skipped.
    expect(steps.map((s) => s.path)).toEqual([
      '.lerret/social-media/twitter',
      '.lerret/social-media/twitter/launch.jsx',
      '.lerret/social-media/twitter/launch.data.json',
    ]);
  });

  it('returns [] for an empty / all-unknown platform list', async () => {
    const { sandbox } = makeWorld();
    expect(await planLaunchKit({ prompt: 'launch kit', platforms: [], fs: sandbox })).toEqual(
      [],
    );
    expect(
      await planLaunchKit({ prompt: 'launch kit', platforms: ['myspace'], fs: sandbox }),
    ).toEqual([]);
  });
});

describe('planLaunchKit — brand-token resolution seams', () => {
  it('falls back to ds.resolveBrandTokens when brandTokens is absent (the 8.6 mock-interface seam)', async () => {
    const { sandbox } = makeWorld();
    const ds = { resolveBrandTokens: vi.fn(async () => ({ brand: '#123456' })) };
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter',
      platforms: ['twitter'],
      ds,
      fs: sandbox,
    });
    expect(ds.resolveBrandTokens).toHaveBeenCalledTimes(1);
    const data = parseStepJson(steps.find((s) => s.path.endsWith('.data.json')));
    expect(data.default.brandColor).toBe('#123456');
  });

  it('prefers non-empty brandTokens over the ds seam (state slot wins)', async () => {
    const { sandbox } = makeWorld();
    const ds = { resolveBrandTokens: vi.fn(async () => ({ brand: '#123456' })) };
    await planLaunchKit({
      prompt: 'launch kit — twitter',
      platforms: ['twitter'],
      brandTokens: TOKENS,
      ds,
      fs: sandbox,
    });
    expect(ds.resolveBrandTokens).not.toHaveBeenCalled();
  });
});

describe('planLaunchKit — sandbox eligibility (Worker execution)', () => {
  it('every emitted path starts with .lerret/ across all configurations', async () => {
    const { sandbox } = makeWorld({
      '.lerret/social-media/twitter/launch.jsx': '// existing',
    });
    const steps = await planLaunchKit({
      prompt: 'launch kit for v0.4 — twitter, instagram, linkedin, bluesky, app store, product hunt',
      platforms: ['twitter', 'instagram', 'linkedin', 'bluesky', 'app store', 'product hunt'],
      brandTokens: TOKENS,
      fs: sandbox,
    });
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.path.startsWith('.lerret/')).toBe(true);
    }
  });

  it('a doctored non-.lerret step throws SandboxViolationError through the Worker + mock sandbox', async () => {
    const { sandbox } = makeWorld();
    const worker = createWorker({ sandbox });
    const doctored = { op: 'write', path: 'outside.txt', content: 'nope' };
    await expect(async () => {
      for await (const ev of worker.executeStep(doctored)) void ev;
    }).rejects.toMatchObject({ name: 'SandboxViolationError' });
  });
});
