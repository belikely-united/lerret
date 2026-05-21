// bundle-studio.js — copy the pre-built studio static assets into the CLI
// package so they ship inside the published `@lerret/cli` npm tarball.
//
// Run via: node packages/cli/scripts/bundle-studio.js
// Or implicitly via: pnpm --filter @lerret/cli build
//
// Steps:
//   1. Locate the studio's `dist/` directory (sibling workspace package).
//   2. Copy its contents into `packages/cli/dist-studio/`.
//   3. Write a `dist-studio/.bundle-stamp` file containing the studio version
//      and a timestamp — the test suite asserts this file exists to detect
//      missing-bundle regressions before publish.
//
// Why copy rather than symlink?
//   `npm pack` / `pnpm publish` only includes files listed in `files`. A
//   symlink to a sibling package would resolve outside the CLI's package
//   boundary and would NOT be included in the tarball. Copying is the only
//   reliable approach for npm packaging.
//
// No new runtime dependencies — `node:fs/promises` and `node:path` are
// sufficient.

import { copyFile, mkdir, readdir, stat, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/cli/scripts  →  packages/cli
const cliDir = resolve(here, '..');
// packages/cli  →  packages/studio
const studioDir = resolve(cliDir, '..', 'studio');
// The CLI build output uses `dist-cli/` to distinguish it from the hosted
// build (`dist/`). See `packages/studio/vite.config.js` `isCliBuild` branch.
const studioDistDir = join(studioDir, 'dist-cli');
const destDir = join(cliDir, 'dist-studio');

/**
 * Recursively copy a directory, creating parent directories as needed.
 *
 * @param {string} src   Absolute source directory.
 * @param {string} dest  Absolute destination directory.
 * @returns {Promise<void>}
 */
async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/**
 * Read the studio's version from its package.json (best-effort — falls back
 * to 'unknown' on any read/parse error).
 *
 * @returns {Promise<string>}
 */
async function readStudioVersion() {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const pkg = req(join(studioDir, 'package.json'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main() {
  // 1. Verify the studio dist exists.
  try {
    const s = await stat(studioDistDir);
    if (!s.isDirectory()) {
      throw new Error(`${studioDistDir} is not a directory`);
    }
  } catch (err) {
    process.stderr.write(
      `bundle-studio: studio dist not found at ${studioDistDir}\n` +
        `  Run: pnpm --filter @lerret/studio build\n` +
        `  Cause: ${err.message}\n`,
    );
    process.exit(1);
  }

  // 2. Verify index.html is in the dist (sanity check against a partial build).
  try {
    await stat(join(studioDistDir, 'index.html'));
  } catch {
    process.stderr.write(
      `bundle-studio: dist/index.html missing — the studio build may be incomplete.\n` +
        `  Run: pnpm --filter @lerret/studio build\n`,
    );
    process.exit(1);
  }

  // 3. Clear any previous dest so stale files from an old build don't linger.
  await rm(destDir, { recursive: true, force: true });

  // 4. Copy the studio dist into dist-studio/.
  process.stdout.write(`bundle-studio: copying ${studioDistDir} → ${destDir}\n`);
  await copyDir(studioDistDir, destDir);

  // 5a. Copy module-sw.js from the studio source (if not already in dist).
  //
  // The CLI build (`LERRET_CLI_BUILD=1`) skips the `lerretSelfHostPlugin`
  // that normally copies `module-sw.js` to the dist root, because the SW is
  // only needed in hosted mode. However, the spec's verification step checks
  // for `dist-studio/module-sw.js`, and having it available means `@lerret/cli dev`
  // can serve it to browsers that navigate to the SW URL — a no-op for CLI
  // mode (the studio never calls `navigator.serviceWorker.register` in CLI
  // mode), but harmless to include for completeness.
  const swSrc = resolve(studioDir, 'src', 'runtime', 'module-sw.js');
  const swDest = join(destDir, 'module-sw.js');
  try {
    await stat(swDest);
    // Already present (e.g. if the regular vite build was copied) — no-op.
  } catch {
    // Not present — copy from source.
    try {
      await copyFile(swSrc, swDest);
      process.stdout.write(`bundle-studio: copied module-sw.js from studio source.\n`);
    } catch (err) {
      // Non-fatal: the CLI does not register the SW, so a missing copy only
      // affects the spec's verification assertion — not runtime behaviour.
      process.stderr.write(`bundle-studio: warning — could not copy module-sw.js: ${err.message}\n`);
    }
  }

  // 5b. Write a stamp file so the packaging regression test can assert the
  //     bundle is present without running the full build again.
  const version = await readStudioVersion();
  const stamp = JSON.stringify(
    {
      studioVersion: version,
      builtAt: new Date().toISOString(),
      files: await listFiles(destDir),
    },
    null,
    2,
  );
  await writeFile(join(destDir, '.bundle-stamp'), stamp, 'utf-8');

  process.stdout.write(`bundle-studio: done. dist-studio/ is ready.\n`);
}

/**
 * Recursively list all file paths inside `dir`, relative to `dir`.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function listFiles(dir) {
  const result = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = entry.name;
    if (entry.isDirectory()) {
      const sub = await listFiles(join(dir, entry.name));
      result.push(...sub.map((f) => `${rel}/${f}`));
    } else {
      result.push(rel);
    }
  }
  return result.sort();
}

main().catch((err) => {
  process.stderr.write(`bundle-studio: unexpected error: ${err.message}\n`);
  process.exit(1);
});
