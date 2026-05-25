// browser-launch.js — headless Chromium launcher shared by the export pipeline
// (export.js) and the on-demand PDF endpoint (pdf-render.js).
//
// Kept in its own module so neither caller has to import the other: export.js
// imports the CLI's vite plugin, so importing the launcher *from* export.js
// into the plugin would form an import cycle. This module imports nothing of
// ours — only Playwright, lazily.

/**
 * Attempt to launch a headless Chromium. Strategy:
 *
 *   1. Try `playwright-core`'s `chromium.launch({ channel: 'chrome' })`. If the
 *      user has Google Chrome / Chromium / Edge installed in a standard
 *      location, this succeeds without downloading anything — keeping `npx
 *      @lerret/cli` light, per the architecture decision.
 *   2. If the channel launch fails, try `playwright` (the full package, which
 *      ships its bundled browser when installed). Only present when the user
 *      opts in by installing the full `playwright` package.
 *   3. If neither works, throw a clear error explaining BOTH paths the user can
 *      take to make a browser available.
 *
 * The dynamic `import()` of each package fails clearly if the package is not
 * installed — we map that to a friendly message and never leak a stack trace.
 *
 * @returns {Promise<{ browser: object, launchedVia: string }>}
 *   `browser` is a Playwright `Browser` instance (caller must `close()` it).
 *   `launchedVia` describes the path taken, for the start-of-run log.
 */
export async function launchHeadlessBrowser() {
  /** @type {Error | null} */
  let systemErr = null;
  /** @type {Error | null} */
  let bundledErr = null;

  // 1. Prefer system Chrome via playwright-core.
  let coreMod;
  try {
    coreMod = await import('playwright-core');
  } catch (err) {
    coreMod = null;
    systemErr = err instanceof Error ? err : new Error(String(err));
  }

  if (coreMod && coreMod.chromium && typeof coreMod.chromium.launch === 'function') {
    try {
      const browser = await coreMod.chromium.launch({
        headless: true,
        channel: 'chrome',
      });
      return { browser, launchedVia: 'system Chrome (playwright-core, channel:chrome)' };
    } catch (err) {
      systemErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  // 2. Fall back to the bundled browser shipped by the full `playwright`
  //    package (user opt-in install).
  let fullMod;
  try {
    fullMod = await import('playwright');
  } catch (err) {
    fullMod = null;
    bundledErr = err instanceof Error ? err : new Error(String(err));
  }

  if (fullMod && fullMod.chromium && typeof fullMod.chromium.launch === 'function') {
    try {
      const browser = await fullMod.chromium.launch({ headless: true });
      return { browser, launchedVia: 'bundled Chromium (playwright)' };
    } catch (err) {
      bundledErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  // 3. Neither worked — print one actionable message.
  const lines = [
    'Could not launch a headless Chromium.',
    '',
    'You have two options:',
    '  • Install Google Chrome (recommended — Lerret prefers a system browser to keep `npx` light).',
    '  • Install the full `playwright` package to download a bundled Chromium:',
    '        npm install -g playwright && npx playwright install chromium',
    '',
    'Last attempt details:',
    `  system Chrome: ${systemErr ? systemErr.message : 'not attempted'}`,
    `  bundled:       ${bundledErr ? bundledErr.message : 'not attempted'}`,
  ];
  throw new Error(lines.join('\n'));
}
