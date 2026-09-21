// dist-studio-node-modules.smoke.test.js — guard that the pre-built studio
// still boots when it is served from INSIDE a `node_modules/` directory.
//
// ── Why this test exists ───────────────────────────────────────────────────
// The published `@lerret/cli` lives at `node_modules/@lerret/cli/`, so the
// bundle it serves is at `node_modules/@lerret/cli/dist-studio/`. Vite's dep
// optimizer treats every module it resolves under `node_modules/` as a
// dependency and stamps `?v=<browserHash>` onto its url — including the
// bundle's own chunk-to-chunk imports. The `<script>` tag in `index.html`
// loads the entry chunk WITHOUT that query, so the browser ended up with two
// urls for one module, evaluated `main.jsx` twice, and called `createRoot()`
// twice on `#root`: a blank canvas for `dev`, and `wrote 0 of N images` for
// `export`, on a freshly scaffolded project. (@lerret/cli 0.1.12.)
//
// In the monorepo `dist-studio/` is NOT under `node_modules/`, so no existing
// test could see it — every suite passed while the published CLI was dead.
// This one stages a copy of the real bundle under a `node_modules/` path and
// drives a real browser at it, which is the only shape that reproduces.
//
// Run modes match the sibling live-edit smoke: inert unless `LERRET_SMOKE=1`.

import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { bootViteServer, launchHeadlessBrowser } from './export.js';

/** Opt-in switch. The suite is inert unless explicitly enabled. */
const SMOKE_REQUIRED = process.env.LERRET_SMOKE === '1';

// packages/cli/src → packages/cli → dist-studio/ (the pre-built bundle).
const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distStudio = resolve(cliDir, 'dist-studio');

describe.skipIf(!SMOKE_REQUIRED)('dist-studio served from node_modules/', () => {
  /** @type {string} */ let workDir;
  /** @type {import('vite').ViteDevServer | undefined} */ let server;
  /** @type {string} */ let url;
  /** @type {any} */ let browser;
  /** @type {any} */ let page;
  /** @type {string[]} */ const consoleErrors = [];

  beforeAll(async () => {
    if (!existsSync(join(distStudio, 'index.html'))) {
      throw new Error(
        'LERRET_SMOKE=1 but packages/cli/dist-studio/index.html is missing.\n' +
        'Build it first: `pnpm --filter @lerret/cli build`.',
      );
    }

    workDir = await mkdtemp(join(tmpdir(), 'lerret-nm-smoke-'));

    // One asset, so "did the canvas mount" has something to show.
    const lerretDir = join(workDir, '.lerret');
    const introDir = join(lerretDir, 'intro');
    await mkdir(introDir, { recursive: true });
    await writeFile(
      join(introDir, 'Hello.jsx'),
      'export default function Hello() {\n' +
      '  return <div style={{ width: 320, height: 120 }}>NODE_MODULES_OK</div>;\n' +
      '}\n',
      'utf-8',
    );

    // Stage the REAL bundle under a `node_modules/` path — the whole point.
    const stagedStudio = join(workDir, 'node_modules', '@lerret', 'cli', 'dist-studio');
    await mkdir(dirname(stagedStudio), { recursive: true });
    await cp(distStudio, stagedStudio, { recursive: true });

    ({ browser } = await launchHeadlessBrowser());
    ({ server, url } = await bootViteServer({
      projectRoot: workDir,
      lerretDir,
      studioRootOverride: stagedStudio,
    }));

    const context = await browser.newContext();
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  }, 180000);

  afterAll(async () => {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it('mounts once and renders the canvas', async () => {
    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('NODE_MODULES_OK'),
      undefined,
      { timeout: 30000 },
    );

    // The entry chunk must have been evaluated under exactly ONE url. A second
    // `?v=`-suffixed copy is a second module instance, and the duplicate
    // `createRoot()` it causes is what blanked the canvas.
    const entryUrls = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /\/assets\/index-[^/]*\.js(\?|$)/.test(n)),
    );
    expect(entryUrls, `entry chunk fetched under ${entryUrls.length} urls`).toHaveLength(1);

    expect(
      consoleErrors.filter((t) => t.includes('createRoot()')),
      'the studio must mount exactly one React root',
    ).toEqual([]);
  }, 120000);
});
