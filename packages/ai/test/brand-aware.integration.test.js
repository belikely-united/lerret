// @vitest-environment node
//
// Brand-aware integration test (Story 8.6, AC-6). Drives the Memory + DS
// Curator agents — and the Worker's brand-asset copy — against the on-disk
// `brand-aware-project` fixture with a MOCKED provider (a vi.fn()-backed fake
// that records the messages it receives; NO real network, NO key).
//
// Four assertions per Task 9:
//   1. Brand context reaches the provider (the assembled prompt fragment
//      carries content from _design-system.md, _context.md, _memory.md).
//   2. Scoped anchoring: a social-media turn includes the `<!-- scope:
//      social-media/ -->` section; an unrelated-scope turn excludes it.
//   3. Conflict path fires: an in-memory `vars.brandColor: "#FF0000"` overlay
//      makes DS Curator emit a clarifying note naming `brandColor`, both
//      values, AND resolve to `#B85B33` (design-system wins; turn proceeds).
//   4. Worker output includes the logo: a planned generation that "includes our
//      logo" copies `_brand/logo.svg`'s content into the target, executed by the
//      real `createWorker` against an in-memory sandbox (assert
//      `sandbox.writeFile` got the logo content).
//
// A Node-`fs`-backed FilesystemAccess points at the fixture for the READ side
// (Memory + DS Curator are read-only). The WRITE side (the Worker) uses the
// Story 8.5 in-memory sandbox mock so the test never touches the real fixture
// on disk. Reading the on-disk fixture is why this test runs in the node env.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryAgent } from '../src/orchestrator/agents/memory.js';
import {
  createDSCurator,
  toClarifyingNotes,
} from '../src/orchestrator/agents/ds-curator.js';
import { planBrandAssetCopy } from '../src/memory/generation.js';
import { createWorker } from '../src/orchestrator/agents/worker.js';
import {
  createInMemoryFs,
  createMockSandbox,
} from '../src/snapshot/__test-helpers__/in-memory-fs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'brand-aware-project');

/**
 * A read-only FilesystemAccess over the real Node fs, rooted nowhere (the
 * agents thread absolute paths). Matches the v1 contract the agents need:
 * `readFile(absPath, { encoding })` + `readDir(absPath)`.
 */
function nodeReadFs() {
  return {
    async readFile(absPath, opts = {}) {
      const enc = opts.encoding === 'binary' ? null : 'utf-8';
      return readFile(absPath, enc);
    },
    async readDir(absPath) {
      const dirents = await readdir(absPath, { withFileTypes: true });
      return dirents.map((d) => ({
        name: d.name,
        path: join(absPath, d.name),
        isFile: d.isFile(),
        isDirectory: d.isDirectory(),
        kind: d.isDirectory() ? 'directory' : 'file',
      }));
    },
  };
}

/** A mocked provider that records the messages it is asked to complete. */
function makeMockProvider() {
  const calls = [];
  return {
    calls,
    complete: vi.fn(async ({ messages }) => {
      calls.push(messages);
      return { text: 'ok' };
    }),
  };
}

/**
 * Run a synthetic turn: Memory assembles the brand context for the target
 * scope, the assembled fragment is shipped as the system message to the mock
 * provider. Returns the provider + the assembled fragment for assertions.
 */
async function runSyntheticTurn({ fs, projectRoot, targetScope }) {
  const memory = createMemoryAgent({ projectRoot, fs });
  const bodies = await memory.readMemory();
  const { promptFragment, filesRead } = memory.assembleContext({
    memory: bodies,
    targetScope,
  });
  const provider = makeMockProvider();
  await provider.complete({
    messages: [
      { role: 'system', content: promptFragment },
      { role: 'user', content: 'make a launch post' },
    ],
  });
  return { provider, promptFragment, filesRead };
}

let fs;
beforeAll(() => {
  fs = nodeReadFs();
});

describe('AC-6.1 — brand context reaches the provider', () => {
  it('the system message carries content from all three reserved files', async () => {
    const { provider, filesRead } = await runSyntheticTurn({
      fs,
      projectRoot: FIXTURE_ROOT,
      targetScope: 'social-media/',
    });
    const systemMessage = provider.calls[0].find((m) => m.role === 'system').content;

    // PROOF that on-disk FILE CONTENT flows (not just hardcoded phrases that
    // could drift from the fixture): extract a sentinel from the fixture's
    // _context.md AS READ FROM DISK — its longest prose line, which exists
    // only in that file — and assert the provider received it verbatim.
    const ctxOnDisk = await readFile(
      join(FIXTURE_ROOT, '.lerret', '_context.md'),
      'utf-8',
    );
    const sentinel = ctxOnDisk
      .split('\n')
      .map((l) => l.trim())
      .reduce((longest, line) => (line.length > longest.length ? line : longest), '');
    expect(sentinel.length).toBeGreaterThan(40); // a real prose line, not a heading
    expect(systemMessage).toContain(sentinel);

    // _design-system.md (the canonical brand color).
    expect(systemMessage).toContain('#B85B33');
    // _memory.md (a past-decision phrase).
    expect(systemMessage).toContain('brand orange');
    // All three reserved files contributed → the "Read N files" count.
    expect(filesRead).toHaveLength(3);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});

describe('AC-6.2 — scoped anchoring (closer-scope wins)', () => {
  it('a social-media turn includes the scoped section; an unrelated scope excludes it', async () => {
    const social = await runSyntheticTurn({
      fs,
      projectRoot: FIXTURE_ROOT,
      targetScope: 'social-media/',
    });
    const appstore = await runSyntheticTurn({
      fs,
      projectRoot: FIXTURE_ROOT,
      targetScope: 'appstore/',
    });

    // The `<!-- scope: social-media/ -->` section's distinctive line.
    expect(social.promptFragment).toContain('One idea per post');
    expect(appstore.promptFragment).not.toContain('One idea per post');

    // Both still carry the global voice rules.
    expect(social.promptFragment).toContain('builder-to-builder');
    expect(appstore.promptFragment).toContain('builder-to-builder');
  });

  it('closer-wins end-to-end: the nested social-media/twitter/ section replaces the broader one', async () => {
    const twitter = await runSyntheticTurn({
      fs,
      projectRoot: FIXTURE_ROOT,
      targetScope: 'social-media/twitter/',
    });
    const social = await runSyntheticTurn({
      fs,
      projectRoot: FIXTURE_ROOT,
      targetScope: 'social-media/',
    });

    // The twitter-scoped turn gets the NESTED section's distinctive line…
    expect(twitter.promptFragment).toContain('under 200 characters');
    // …and per resolveScopedContext's longest-prefix semantics each file
    // contributes its single CLOSEST section only — the broader social-media
    // section is replaced, not stacked.
    expect(twitter.promptFragment).not.toContain('One idea per post');
    // The global voice rules still apply at every depth.
    expect(twitter.promptFragment).toContain('builder-to-builder');

    // A social-media/ turn does NOT leak the nested twitter-only content.
    expect(social.promptFragment).not.toContain('under 200 characters');
    expect(social.promptFragment).toContain('One idea per post');
  });
});

describe('AC-6.3 — conflict-clarification path fires (real config vocabulary)', () => {
  it("the FIXTURE's vars.brandColor, mutated to mismatch, conflicts with the DS `brand` token end-to-end", async () => {
    const curator = createDSCurator({ projectRoot: FIXTURE_ROOT, fs });

    // Start from the REAL fixture config (the actual `vars.brandColor` /
    // `accentColor` key vocabulary every scaffolded template uses), then
    // mutate ONLY brandColor in memory (Task 9 prefers an in-memory mutation
    // over a second on-disk conflicting fixture).
    const cfgRaw = await readFile(
      join(FIXTURE_ROOT, '.lerret', 'social-media', 'config.json'),
      'utf-8',
    );
    const cfg = JSON.parse(cfgRaw);
    expect(cfg.vars.brandColor).toBe('#B85B33'); // the fixture agrees on disk
    const vars = { ...cfg.vars, brandColor: '#FF0000' };

    const { resolved, conflicts } = await curator.resolveTokens({
      prompt: 'use our brand color for the headline',
      targetScope: 'social-media/',
      vars,
    });

    // ONE conflict: DS `brand` vs config `brandColor` (canonical match);
    // accentColor agrees and radius has no DS counterpart.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      token: 'brand',
      configToken: 'brandColor',
      designSystemValue: '#B85B33',
      configValue: '#FF0000',
    });
    // Resolved value is the design-system one — the turn proceeds.
    expect(resolved.find((r) => r.ref === 'brand').value).toBe('#B85B33');

    // The note the dock thread (Story 8.2) renders: names the user's ACTUAL
    // config key and carries BOTH values. Calm voice.
    const notes = toClarifyingNotes(conflicts);
    expect(notes[0].type).toBe('clarifying-note');
    expect(notes[0].note).toContain('brandColor');
    expect(notes[0].note).toContain('#B85B33');
    expect(notes[0].note).toContain('#FF0000');
    expect(notes[0].note).not.toContain('!');
  });
});

describe('AC-6.4 — Worker output includes the logo from _brand/', () => {
  it('plans + executes a copy of _brand/logo.svg into the target page', async () => {
    const memory = createMemoryAgent({ projectRoot: FIXTURE_ROOT, fs });
    const brandIndex = await memory.indexBrandFolder();
    const logoContent = await memory.readBrandAsset('logo.svg');
    expect(logoContent).toContain('Lerret logo'); // real fixture bytes

    // Plan the copy step (selection + write-step shape).
    const steps = planBrandAssetCopy({
      brandIndex,
      request: 'include our logo',
      targetDir: '.lerret/social-media',
      readContent: (entry) => (entry.name === 'logo.svg' ? logoContent : ''),
    });
    expect(steps).toEqual([
      { op: 'write', path: '.lerret/social-media/logo.svg', content: logoContent },
    ]);

    // Execute via the REAL Worker against an in-memory sandbox.
    const memFs = createInMemoryFs();
    const sandbox = createMockSandbox(memFs, '/proj');
    const writeSpy = vi.spyOn(sandbox, 'writeFile');
    const worker = createWorker({ sandbox });
    const events = [];
    for await (const ev of worker.executeStep(steps[0])) events.push(ev);

    expect(events).toEqual([{ type: 'writing', file: '.lerret/social-media/logo.svg' }]);
    expect(writeSpy).toHaveBeenCalledWith('.lerret/social-media/logo.svg', logoContent);
    // The logo content actually landed in the sandbox-backed FS.
    const written = await memFs.readFile('/proj/.lerret/social-media/logo.svg');
    expect(written).toContain('Lerret logo');
  });
});
