// @vitest-environment node
//
// Generation-workflows integration test (Story 8.8) — drives W2 (launch kit)
// and W3 (social variants) END-TO-END against the Story 8.6
// `brand-aware-project` fixture with a MOCKED provider and the REAL Worker /
// runTurn / snapshot machinery. No real network, no key. Mirrors the
// brand-aware.integration.test.js idiom: the on-disk fixture supplies the
// brand authority (read side); all writes land in the Story 8.5 in-memory
// FS + mock sandbox (the fixture on disk is never touched).
//
// The chains under test:
//   W2: recognizeWorkflow → REAL createDsCuratorNode (brandTokens from the
//       fixture's _design-system.md) → planLaunchKit → WorkerStep[] →
//       REAL createWorker / REAL runTurn (mock resolver) → files land →
//       core's loadAssetData discovers them (no special render path) →
//       snapshot.revertTurn restores the pre-turn state (AC-10's backend).
//   W3: recognizeWorkflow → planSocialVariants → ONE .data.json write →
//       existing variant keys survive, the .jsx is byte-untouched, the v1
//       loader sees the merged variant map (FR23).
//
// The BROWSER smoke (AC-8/9/10 — real pointer events, status pill, inline
// Revert in a live studio) is NOT here: per the epic-close browser-smoke
// rule it is the orchestrator's epic-close verification, run via
// chrome-devtools MCP against a served studio. This suite proves the
// backend of every beat the smoke replays.

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recognizeWorkflow } from '../src/orchestrator/workflows/recognize.js';
import { planLaunchKit } from '../src/orchestrator/workflows/launch-kit.js';
import { planSocialVariants } from '../src/orchestrator/workflows/social-variants.js';
import { createDsCuratorNode } from '../src/orchestrator/agents/ds-curator.js';
import { createWorker } from '../src/orchestrator/agents/worker.js';
import { runTurn } from '../src/orchestrator/run-turn.js';
import * as snapshot from '../src/snapshot/index.js';
import {
  createInMemoryFs,
  createMockSandbox,
  seedFs,
} from '../src/snapshot/__test-helpers__/in-memory-fs.js';
import { loadAssetData } from '@lerret/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, 'fixtures', 'brand-aware-project');
const ROOT = '/proj';

const W2_PROMPT = 'launch kit for v0.4 — twitter, instagram, app store hero';
const W3_REF = 'social-media/twitter/launch-1.jsx';
const W3_PROMPT = `three more social posts in the same style as ${W3_REF}`;

const W2_EXPECTED_FILES = [
  '.lerret/social-media/twitter/launch.jsx',
  '.lerret/social-media/twitter/launch.data.json',
  '.lerret/social-media/instagram/launch.jsx',
  '.lerret/social-media/instagram/launch.data.json',
  '.lerret/appstore/hero/launch.jsx',
  '.lerret/appstore/hero/launch.data.json',
];

/** Recursively copy the on-disk fixture into the in-memory FS under ROOT. */
async function seedFixture(fs, diskDir = FIXTURE_ROOT, rel = '') {
  const entries = await readdir(diskDir, { withFileTypes: true });
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await seedFixture(fs, join(diskDir, entry.name), childRel);
    } else {
      seedFs(fs, { [`${ROOT}/${childRel}`]: await readFile(join(diskDir, entry.name), 'utf-8') });
    }
  }
}

/** Build the per-test world: fixture-seeded in-memory FS + mock sandbox. */
async function makeWorld(extraFiles = {}) {
  const fs = createInMemoryFs();
  await seedFixture(fs);
  seedFs(
    fs,
    Object.fromEntries(Object.entries(extraFiles).map(([p, c]) => [`${ROOT}/${p}`, c])),
  );
  return { fs, sandbox: createMockSandbox(fs, ROOT) };
}

/** Resolve brandTokens through the REAL DS Curator node (fixture authority). */
async function resolveFixtureTokens(sandbox) {
  const node = createDsCuratorNode({ sandbox, emit: () => {} });
  const { brandTokens } = await node({ prompt: W2_PROMPT });
  return brandTokens;
}

/** Execute steps through the REAL Worker stub, collecting its events. */
async function executeSteps(sandbox, steps) {
  const worker = createWorker({ sandbox });
  const events = [];
  for (const step of steps) {
    for await (const ev of worker.executeStep(step)) events.push(ev);
  }
  return events;
}

/**
 * A mock resolver for runTurn. Its provider would answer with exactly
 * `steps` — but for a RECOGNIZED W2/W3 prompt the in-graph Planner routes
 * the deterministic workflow path and never calls the provider at all; the
 * resolver's real job in those tests is satisfying provider resolution.
 */
function stepsResolver(steps) {
  const handle = {
    name: 'anthropic',
    model: 'claude-opus-4-7',
    modelSupportsVision: () => true,
    complete: async () => ({ content: JSON.stringify({ steps }) }),
    async *stream() {},
  };
  return {
    async resolveActive() {
      return { handle, name: handle.name, model: handle.model };
    },
    async enumerateVision() {
      return [];
    },
    async resolveOverride() {
      return handle;
    },
  };
}

async function collect(iter) {
  const out = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('W2 launch kit — recognize → DS Curator → plan → REAL Worker', () => {
  it('one prompt becomes three brand-anchored assets in their preset pages', async () => {
    const { fs, sandbox } = await makeWorld();

    // 1. Deterministic recognition (no LLM).
    const shape = recognizeWorkflow(W2_PROMPT);
    expect(shape).toEqual({
      kind: 'launch-kit',
      platforms: ['twitter', 'instagram', 'app store hero'],
    });

    // 2. Brand authority flows from the REAL fixture through the REAL node.
    const brandTokens = await resolveFixtureTokens(sandbox);
    expect(brandTokens.brand).toBe('#B85B33'); // _design-system.md, not a constant

    // 3. The W2 decomposition: fixture has social-media/ (page root exists)
    //    but no twitter/ sub-page → full creation per platform.
    const steps = await planLaunchKit({
      prompt: W2_PROMPT,
      platforms: shape.platforms,
      brandTokens,
      fs: sandbox,
    });
    expect(steps.map((s) => s.op)).toEqual([
      'mkdir', 'write', 'write',
      'mkdir', 'write', 'write',
      'mkdir', 'write', 'write',
    ]);

    // 4. The REAL Worker executes every step through the sandbox.
    const events = await executeSteps(sandbox, steps);
    expect(events.filter((e) => e.type === 'mkdir')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'writing').map((e) => e.file)).toEqual(
      W2_EXPECTED_FILES,
    );
    expect(events.some((e) => e.type === 'error')).toBe(false);

    // 5. The files actually landed, brand-anchored end-to-end.
    for (const path of W2_EXPECTED_FILES) {
      expect(fs._files.has(`${ROOT}/${path}`)).toBe(true);
    }
    const twitterData = JSON.parse(
      await fs.readFile(`${ROOT}/.lerret/social-media/twitter/launch.data.json`),
    );
    expect(twitterData.default.headline).toBe('v0.4 is live'); // prompt-derived
    expect(twitterData.default.brandColor).toBe('#B85B33'); // fixture authority
    expect(twitterData.default.accentColor).toBe('#F1EDE5');
    expect(twitterData.default.neutralDark).toBe('#1A1714');
    const twitterJsx = await fs.readFile(`${ROOT}/.lerret/social-media/twitter/launch.jsx`);
    expect(twitterJsx).toContain('export const meta');
    expect(twitterJsx).toContain('var(--brandColor, #B85B33)');
  });

  it('the generated assets are discoverable by the v1 data loader (no special render path)', async () => {
    const { fs, sandbox } = await makeWorld();
    const brandTokens = await resolveFixtureTokens(sandbox);
    const { platforms } = recognizeWorkflow(W2_PROMPT);
    await executeSteps(
      sandbox,
      await planLaunchKit({ prompt: W2_PROMPT, platforms, brandTokens, fs: sandbox }),
    );

    // The v1 co-location rule (core data/loader.js) discovers every
    // generated .data.json next to its component — the exact pathway the
    // watcher → loader → re-render chain uses. No AI-specific loading.
    const assets = [
      { path: `${ROOT}/.lerret/social-media/twitter/launch.jsx`, name: 'launch', fileName: 'launch.jsx' },
      { path: `${ROOT}/.lerret/social-media/instagram/launch.jsx`, name: 'launch', fileName: 'launch.jsx' },
      { path: `${ROOT}/.lerret/appstore/hero/launch.jsx`, name: 'launch', fileName: 'launch.jsx' },
    ];
    const dataMap = await loadAssetData(assets, fs);
    for (const asset of assets) {
      const record = dataMap.get(asset.path);
      expect(record.source).toBe('json');
      expect(record.value.default.headline).toBe('v0.4 is live');
      expect(record.value.default.brandColor).toBe('#B85B33');
    }
  });

  it('a recognized W2 prompt round-trips the REAL runTurn pipeline (in-graph delegation + Worker + sandbox + snapshot)', async () => {
    const { fs, sandbox } = await makeWorld();
    const brandTokens = await resolveFixtureTokens(sandbox);
    const { platforms } = recognizeWorkflow(W2_PROMPT);
    const steps = await planLaunchKit({
      prompt: W2_PROMPT,
      platforms,
      brandTokens,
      fs: sandbox,
    });

    // Inside the REAL turn the Planner RECOGNIZES the W2 prompt and runs
    // planLaunchKit itself (deterministic — the resolver's canned provider
    // completion is never consulted, and parsePlan never runs). The plan
    // then flows through the Worker node, the sandbox, and the snapshot
    // store; the pre-computed `steps` above only pin what the in-graph
    // delegation must produce.
    const events = await collect(
      runTurn({
        prompt: W2_PROMPT,
        projectRoot: ROOT,
        fs,
        resolver: stepsResolver(steps),
      }),
    );

    expect(events.filter((e) => e.type === 'mkdir')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'writing').map((e) => e.file)).toEqual(
      W2_EXPECTED_FILES,
    );
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    expect(done.files.map((f) => f.path)).toEqual(W2_EXPECTED_FILES);
    expect(done.files.every((f) => f.op === 'create')).toBe(true);

    const manifests = await snapshot.listManifests({ projectRoot: ROOT, fs });
    expect(manifests).toHaveLength(1);
    expect(manifests[0].status).toBe('applied');
    expect(done.turnId).toBe(manifests[0].id);
  });

  it('quick-revert restores the pre-turn state: the three artboards disappear (AC-10 backend)', async () => {
    const { fs, sandbox } = await makeWorld();
    const brandTokens = await resolveFixtureTokens(sandbox);
    const { platforms } = recognizeWorkflow(W2_PROMPT);
    const steps = await planLaunchKit({
      prompt: W2_PROMPT,
      platforms,
      brandTokens,
      fs: sandbox,
    });
    const events = await collect(
      runTurn({ prompt: W2_PROMPT, projectRoot: ROOT, fs, resolver: stepsResolver(steps) }),
    );
    const { turnId } = events.find((e) => e.type === 'done');
    for (const path of W2_EXPECTED_FILES) {
      expect(fs._files.has(`${ROOT}/${path}`)).toBe(true);
    }

    // The dock's inline Revert routes here (Story 8.5's revertTurn).
    await snapshot.revertTurn({
      projectRoot: ROOT,
      fs,
      sandbox: createMockSandbox(fs, ROOT),
      turnId,
    });
    for (const path of W2_EXPECTED_FILES) {
      expect(fs._files.has(`${ROOT}/${path}`)).toBe(false);
    }
    // The fixture's own files are untouched by the revert.
    expect(fs._files.has(`${ROOT}/.lerret/social-media/config.json`)).toBe(true);
  });
});

describe('W3 social variants — recognize → plan → REAL Worker appends', () => {
  const JSX_SENTINEL = '// launch-1.jsx — hand-authored component, MUST stay byte-identical\n';
  const SEEDED_DATA = `${JSON.stringify(
    {
      default: { eyebrow: '01 / canvas', headline: 'Designs are just files.' },
      Features: { eyebrow: '02 / features', headline: 'Edit. Save. Render.' },
      Data: { eyebrow: '03 / data', headline: 'Props you can git diff.' },
    },
    null,
    2,
  )}\n`;
  const W3_FILES = {
    [`.lerret/${W3_REF}`]: JSX_SENTINEL,
    '.lerret/social-media/twitter/launch-1.data.json': SEEDED_DATA,
  };

  it('one prompt appends three variants to the EXISTING .data.json; the .jsx is untouched', async () => {
    const { fs, sandbox } = await makeWorld(W3_FILES);
    const brandTokens = await resolveFixtureTokens(sandbox);

    const shape = recognizeWorkflow(W3_PROMPT);
    expect(shape).toEqual({
      kind: 'social-variants',
      reference: { path: W3_REF, count: 3 },
    });

    const steps = await planSocialVariants({
      prompt: W3_PROMPT,
      reference: shape.reference,
      brandTokens,
      fs: sandbox,
    });
    expect(steps).toHaveLength(1); // ONE write — never a .jsx step

    const events = await executeSteps(sandbox, steps);
    expect(events).toEqual([
      { type: 'writing', file: '.lerret/social-media/twitter/launch-1.data.json' },
    ]);

    const merged = JSON.parse(
      await fs.readFile(`${ROOT}/.lerret/social-media/twitter/launch-1.data.json`),
    );
    // Existing keys survive with untouched values…
    expect(merged.default).toEqual({ eyebrow: '01 / canvas', headline: 'Designs are just files.' });
    expect(merged.Features).toEqual({ eyebrow: '02 / features', headline: 'Edit. Save. Render.' });
    expect(merged.Data).toEqual({ eyebrow: '03 / data', headline: 'Props you can git diff.' });
    // …the three appended variants are brand-anchored + prompt-derived…
    expect(Object.keys(merged)).toEqual([
      'default', 'Features', 'Data', 'Variant4', 'Variant5', 'Variant6',
    ]);
    expect(merged.Variant4.brandColor).toBe('#B85B33');
    expect(merged.Variant4.headline).toBe('social posts — 1');
    // …and the component file is BYTE-identical (FR23: one component, N artboards).
    expect(await fs.readFile(`${ROOT}/.lerret/${W3_REF}`)).toBe(JSX_SENTINEL);

    // The v1 loader reads back the merged map — the new keys ARE the new
    // artboards' variant keys (named-export-variant convention).
    const dataMap = await loadAssetData(
      [{ path: `${ROOT}/.lerret/${W3_REF}`, name: 'launch-1', fileName: 'launch-1.jsx' }],
      fs,
    );
    expect(Object.keys(dataMap.get(`${ROOT}/.lerret/${W3_REF}`).value)).toHaveLength(6);
  });

  it('W3 round-trips the REAL runTurn pipeline; revert restores the ORIGINAL data file bytes', async () => {
    const { fs, sandbox } = await makeWorld(W3_FILES);
    const brandTokens = await resolveFixtureTokens(sandbox);
    const { reference } = recognizeWorkflow(W3_PROMPT);
    const steps = await planSocialVariants({
      prompt: W3_PROMPT,
      reference,
      brandTokens,
      fs: sandbox,
    });

    const events = await collect(
      runTurn({ prompt: W3_PROMPT, projectRoot: ROOT, fs, resolver: stepsResolver(steps) }),
    );
    const done = events.find((e) => e.type === 'done');
    expect(done.files).toEqual([
      { path: '.lerret/social-media/twitter/launch-1.data.json', op: 'edit' },
    ]);

    // The manifest captured the before-image (op 'edit' + snapshotKey)…
    const manifests = await snapshot.listManifests({ projectRoot: ROOT, fs });
    const entry = manifests[0].files.find(
      (f) => f.path === '.lerret/social-media/twitter/launch-1.data.json',
    );
    expect(entry.op).toBe('edit');
    expect(typeof entry.snapshotKey).toBe('string');

    // …so revert restores the EXACT pre-turn bytes (the canvas re-renders
    // back to three artboards; the appended three disappear).
    await snapshot.revertTurn({
      projectRoot: ROOT,
      fs,
      sandbox: createMockSandbox(fs, ROOT),
      turnId: done.turnId,
    });
    expect(
      await fs.readFile(`${ROOT}/.lerret/social-media/twitter/launch-1.data.json`),
    ).toBe(SEEDED_DATA);
  });
});
