#!/usr/bin/env node
// `lerret` CLI entry point.
//
// The `lerret` binary's command surface starts here. Argument parsing uses
// node's built-in `util.parseArgs` — the architecture's explicit choice, no
// heavy CLI framework. Recognized subcommands:
//
//   lerret dev    [--port <n>] [--folder <path>] [--open | --no-open]
//   lerret export [path] [--format png|jpg] [--out <dir>] [--flat]
//
// Adding a new subcommand is the act of importing one more module and adding
// an entry to the `SUBCOMMANDS` table below — the usage banner is derived
// from the same table so the two never drift apart.
//
// Exit codes:
//   0 — success, usage requested (`--help`), or graceful shutdown.
//   1 — unknown subcommand, malformed flags, or a runtime error.
//
// Process model: each subcommand owns its own lifecycle. `dev` starts a
// long-running Vite server and only resolves on SIGINT/SIGTERM; `export`
// drives a headless Chromium through Playwright once and exits when the
// capture run finishes; `--help` and unknown-command paths exit synchronously.

import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { runDev } from './dev.js';
import { runExport } from './export.js';

/**
 * The set of recognized subcommands and their entry points. Centralized so the
 * usage banner and the dispatch loop never drift apart.
 *
 * @type {Record<string, { describe: string, run: (argv: string[]) => Promise<number> | number }>}
 */
const SUBCOMMANDS = {
  dev: {
    describe: 'Run the studio against a `.lerret/` project folder (Vite dev server)',
    run: runDev,
  },
  export: {
    describe: 'Headlessly render a project (or page/group) to image files',
    run: runExport,
  },
};

/**
 * Print the top-level usage banner to stdout. Intentionally short — each
 * subcommand prints its own `--help` flag detail.
 *
 * @returns {void}
 */
function printUsage() {
  const lines = [
    'lerret — the design-canvas CLI',
    '',
    'Usage: lerret <command> [options]',
    '',
    'Commands:',
    ...Object.entries(SUBCOMMANDS).map(
      ([name, { describe }]) => `  ${name.padEnd(8)} ${describe}`,
    ),
    '',
    'Run `lerret <command> --help` for command-specific options.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * The CLI's top-level entry. Parses only the very first positional (the
 * subcommand) and hands the remaining argv to that subcommand. The subcommand
 * does its own flag parsing — keeping each command's flag surface owned by its
 * own module, which is what `parseArgs` is designed for.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 *   The argv slice to parse — defaults to the real process argv, overridable
 *   for tests.
 * @returns {Promise<number>}  The exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  // A bare invocation or an explicit help flag prints usage and exits 0.
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    return 0;
  }

  const [command, ...rest] = argv;
  const handler = SUBCOMMANDS[command];

  if (!handler) {
    // An unknown subcommand is a usage error — print the banner so the user
    // can see what is valid, then exit non-zero.
    process.stderr.write(`lerret: unknown command "${command}"\n\n`);
    printUsage();
    return 1;
  }

  try {
    const code = await handler.run(rest);
    return typeof code === 'number' ? code : 0;
  } catch (err) {
    // A genuine runtime failure inside a subcommand — surface a short error and
    // exit non-zero. The subcommand owns its own error UX otherwise.
    process.stderr.write(`lerret ${command}: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
  }
}

/**
 * `parseArgs` itself is exported for tests so they can verify the basic
 * dispatch shape without spinning up `dev`.
 *
 * @type {typeof parseArgs}
 */
export { parseArgs };

// Only run main() when this file is the process entry. The exported `main`
// stays callable from tests without firing the real CLI.
//
// `process.argv[1]` is the path the user invoked. When installed via a zero-
// install runner (npx, pnpm dlx, bunx) the path may be a symlink inside the
// runner's cache, while `import.meta.url` is the physical (real) path. We
// dereference with `realpathSync` before comparing so all four runners work.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  process.argv[1].length > 0 &&
  (() => {
    try {
      return (
        import.meta.url ===
        pathToFileURL(realpathSync(process.argv[1])).href
      );
    } catch {
      return false;
    }
  })();

if (invokedDirectly) {
  main().then((code) => process.exit(code));
}
