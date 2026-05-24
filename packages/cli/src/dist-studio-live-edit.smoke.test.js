// dist-studio-live-edit.smoke.test.js — end-to-end guard that LIVE EDIT works
// from the PRE-BUILT `dist-studio` bundle (the path the published `@lerret/cli`
// actually serves), not just from studio source.
//
// ── Why this test exists ───────────────────────────────────────────────────
// `vite build` replaces `import.meta.hot` with `undefined` and tree-shakes away
// any block guarded by it. The studio receives the CLI's live-edit signal over
// a custom HMR event (`lerret:change`); when that listener was gated on
// `import.meta.hot`, it vanished from `dist-studio` — silently breaking EVERY
// watcher-driven update (save re-render, create, rename, move, data edits) in
// the published CLI, while source-mode dev kept working. Unit tests and
// source-mode smokes never caught it because the bug only manifests in the
// pre-built bundle served through a real browser.
//
// So this test does the only thing that can catch it: drives a REAL headless
// Chromium against the REAL pre-built bundle and asserts that file-system
// changes reach the canvas — IN PLACE, without a full page reload.
//
// ── Run modes ──────────────────────────────────────────────────────────────
//   • Default (`pnpm test`): the whole suite is SKIPPED. Keeps the unit suite
//     fast and browserless, and avoids depending on a built bundle.
//   • `LERRET_SMOKE=1` (CI, or `pnpm --filter @lerret/cli test:smoke`): the
//     suite RUNS and every precondition is REQUIRED — a missing bundle or no
//     headless browser is a hard FAILURE, so the regression can't slip through.
//     CI builds the bundle first and runs on a runner image that ships Chrome.

import { mkdtemp, rm, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resolveStudioRoot } from './dev.js';
import { bootViteServer, launchHeadlessBrowser } from './export.js';

/** Opt-in switch. The suite is inert unless explicitly enabled. */
const SMOKE_REQUIRED = process.env.LERRET_SMOKE === '1';

// packages/cli/src → packages/cli → dist-studio/index.html (the pre-built bundle).
const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distStudioIndex = resolve(cliDir, 'dist-studio', 'index.html');

/** A minimal, renderable component asset carrying a detectable marker. */
const componentAsset = (name, marker) =>
  `export default function ${name}() {\n` +
  `  return (\n` +
  `    <div style={{ width: 320, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>\n` +
  `      ${marker}\n` +
  `    </div>\n` +
  `  );\n` +
  `}\n`;

// ── In-browser predicates (run via Playwright `waitForFunction`) ────────────
// These execute INSIDE Chromium (where `document` is defined). Each must be
// fully self-contained (no closures) since Playwright ships their source.

/** Resolve once the page text contains `has` (if set) and not `hasNot` (if set). */
function pageTextState({ has, hasNot }) {
  const text = (document.body && document.body.innerText) || '';
  return (!has || text.includes(has)) && (!hasNot || !text.includes(hasNot));
}

/**
 * Resolve once an artboard whose `data-dc-slot` (the asset's scanned path) ends
 * with `suffix` is present (`present: true`) or absent (`present: false`).
 * Suffix-matching keeps the assertion independent of the OS temp dir and
 * symlink resolution (macOS `/tmp` → `/private/tmp`).
 */
function pageSlotState({ suffix, present }) {
  const slots = Array.from(document.querySelectorAll('[data-dc-slot]'))
    .map((el) => el.getAttribute('data-dc-slot') || '');
  const has = slots.some((s) => s.endsWith(suffix));
  return present ? has : !has;
}

describe.skipIf(!SMOKE_REQUIRED)('dist-studio live edit (pre-built bundle)', () => {
  /** @type {string} */ let workDir;
  /** @type {string} */ let lerretDir;
  /** @type {string} */ let introDir;
  /** @type {import('vite').ViteDevServer | undefined} */ let server;
  /** @type {string} */ let url;
  /** @type {any} */ let browser;
  /** @type {any} */ let page;

  beforeAll(async () => {
    // Precondition: the pre-built bundle must be present. Required (not skipped)
    // because the suite only runs when smoke is explicitly enabled.
    if (!existsSync(distStudioIndex)) {
      throw new Error(
        'LERRET_SMOKE=1 but packages/cli/dist-studio/index.html is missing.\n' +
        'Build it first: `pnpm --filter @lerret/cli build`.',
      );
    }
    // Guarantee we are actually exercising the pre-built path, not source.
    expect(resolveStudioRoot().replaceAll('\\', '/')).toMatch(/dist-studio$/);

    // Temp project: .lerret/intro/Hello.jsx (one page, one asset).
    workDir = await mkdtemp(join(tmpdir(), 'lerret-smoke-'));
    lerretDir = join(workDir, '.lerret');
    introDir = join(lerretDir, 'intro');
    await mkdir(introDir, { recursive: true });
    await writeFile(join(introDir, 'Hello.jsx'), componentAsset('Hello', 'LIVE_ALPHA'), 'utf-8');

    // Real headless browser. Required — a launch failure fails the smoke.
    ({ browser } = await launchHeadlessBrowser());

    // Same server boot the CLI uses; resolves to dist-studio because it exists.
    ({ server, url } = await bootViteServer({ projectRoot: workDir, lerretDir }));

    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  }, 180000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('save, create, rename, and move all reach the canvas without a reload', async () => {
    // Initial render of the starting asset.
    await page.waitForFunction(pageTextState, { has: 'LIVE_ALPHA' }, { timeout: 30000 });

    // Plant a sentinel. A full page reload (the pre-fix failure mode) wipes it;
    // a true in-place live update preserves it.
    await page.evaluate(() => { window.__lerretSmokeSentinel = 'KEPT'; });

    // 1) SAVE RE-RENDER — edit content; the artboard swaps in place.
    await writeFile(join(introDir, 'Hello.jsx'), componentAsset('Hello', 'LIVE_BRAVO'), 'utf-8');
    await page.waitForFunction(
      pageTextState,
      { has: 'LIVE_BRAVO', hasNot: 'LIVE_ALPHA' },
      { timeout: 30000 },
    );
    expect(
      await page.evaluate(() => window.__lerretSmokeSentinel === 'KEPT'),
      'content edit must update in place (no full reload)',
    ).toBe(true);

    // 2) CREATE — a brand-new asset file appears as a new artboard.
    await writeFile(join(introDir, 'Second.jsx'), componentAsset('Second', 'LIVE_SECOND'), 'utf-8');
    await page.waitForFunction(pageTextState, { has: 'LIVE_SECOND' }, { timeout: 30000 });

    // 3) RENAME — Hello.jsx → Greeting.jsx; the slot follows, the old one drops.
    await rename(join(introDir, 'Hello.jsx'), join(introDir, 'Greeting.jsx'));
    await page.waitForFunction(pageSlotState, { suffix: '/intro/Greeting.jsx', present: true }, { timeout: 30000 });
    await page.waitForFunction(pageSlotState, { suffix: '/intro/Hello.jsx', present: false }, { timeout: 30000 });

    // 4) MOVE — Second.jsx → intro/group/Second.jsx (into a new group on the
    //    same page); the slot follows the move.
    await mkdir(join(introDir, 'group'), { recursive: true });
    await rename(join(introDir, 'Second.jsx'), join(introDir, 'group', 'Second.jsx'));
    await page.waitForFunction(pageSlotState, { suffix: '/intro/group/Second.jsx', present: true }, { timeout: 30000 });
    await page.waitForFunction(pageSlotState, { suffix: '/intro/Second.jsx', present: false }, { timeout: 30000 });

    // Across the whole sequence, the page never reloaded — the live path is
    // HMR-in-place, not reload-driven.
    expect(
      await page.evaluate(() => window.__lerretSmokeSentinel === 'KEPT'),
      'structural edits must update in place (no full reload)',
    ).toBe(true);
  }, 180000);
});
