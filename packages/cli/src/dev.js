// `lerret dev` — run the studio against a project folder.
//
// Boots a Node-side Vite dev server that serves the bundled studio plus the
// user's `.lerret/` folder, opens the studio in the browser (per `--open`),
// and runs until the user kills the process. Argument parsing uses node's
// built-in `util.parseArgs` — the architecture's explicit choice, no heavy
// CLI framework.
//
// ── Flags (PRD contract — names are fixed) ─────────────────────────────────
//   --port <n>      Dev-server port. Defaults to Vite's default.
//   --folder <path> Override the project folder, bypassing walk-up auto-
//                   detection. Useful for "I'm not cd'd into
//                   the project, but I want to point at THIS folder".
//   --open          Open the studio in the browser on start (Vite's
//                   `server.open`). Flip off with `--no-open`. Default: on.
//   --help, -h      Print this command's usage and exit.
//
// ── How the studio is loaded ───────────────────────────────────────────────
// We point Vite at the **studio package's source directory** — i.e. the same
// dir its standalone `vite dev` runs against. Vite serves `index.html` +
// `src/main.jsx` from there. The Lerret-specific bits are added by
// `vite-plugin-lerret-project`: a virtual module exposing the scanned project
// model, a stable URL prefix aliased to the user's project root, and the
// chokidar-driven `lerret:change` HMR event.
//
// In dev mode the studio is loaded *from source*. The production path
// uses a pre-built static bundle shipped inside the `@lerret/cli` npm package;
// the plugin contract here is the same, only the bit of code that figures
// out where the studio's HTML + JS live differs.

import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { realpathOrSelf, pathExists } from './fs/node-backend.js';
import { resolveProject } from './resolve-project.js';
import {
  lerretProjectPlugin,
  normalizeFolderArg,
  PROJECT_ASSET_BASE_URL,
} from './vite-plugin-lerret-project.js';

/**
 * The argv shape `parseArgs` produces for `lerret dev`.
 *
 * @typedef {object} DevFlags
 * @property {number | undefined} port
 * @property {string | undefined} folder
 * @property {boolean} open
 * @property {boolean} help
 */

/**
 * Print the `dev`-subcommand-specific usage banner.
 *
 * @returns {void}
 */
function printUsage() {
  const lines = [
    'lerret dev — run the studio against a project folder.',
    '',
    'Usage: lerret dev [options]',
    '',
    'Options:',
    '  --port <n>       Dev-server port (default: Vite default)',
    '  --folder <path>  Project folder (bypasses walk-up auto-detection)',
    '  --open           Open the studio in the browser on start (default)',
    '  --no-open        Do not open the browser on start',
    '  -h, --help       Show this help',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Parse `lerret dev`'s argv. A separate function so tests can verify flag
 * handling without spinning up a server.
 *
 * @param {string[]} argv
 * @returns {{ flags: DevFlags, error: string | null }}
 *   `error` is set when parsing fails — the caller prints it and the usage
 *   banner. On success the caller acts on `flags`.
 */
export function parseDevArgs(argv) {
  // `--no-open` is the documented PRD spelling for "do not open the
  // browser". Node's `parseArgs` does not turn `--no-<name>` into a boolean
  // false automatically in `strict` mode — it rejects the unknown flag — so
  // we strip the token here and remember the intent for the result. This
  // keeps the strict-unknown-flag check working for every OTHER bogus flag.
  let openIntent;
  const filteredArgv = [];
  for (const tok of argv) {
    if (tok === '--no-open') {
      openIntent = false;
    } else {
      filteredArgv.push(tok);
    }
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: filteredArgv,
      options: {
        port: { type: 'string' },
        folder: { type: 'string' },
        open: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      // Reject unknown flags rather than silently ignoring them — surface a
      // typo as a usage error.
      strict: true,
      // No positionals are expected; reject them too.
      allowPositionals: false,
    });
  } catch (err) {
    return { flags: /** @type {any} */ (null), error: err && err.message ? err.message : String(err) };
  }

  const values = parsed.values || {};

  // Port: `parseArgs` returns a string; coerce here. An invalid port is a
  // usage error.
  let port;
  if (typeof values.port === 'string') {
    const n = Number(values.port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { flags: /** @type {any} */ (null), error: `--port: not a valid port number: ${values.port}` };
    }
    port = n;
  }

  // Folder: pass through as a string; resolution to an absolute path is the
  // caller's job (so tests can verify the resolution step separately).
  const folder = typeof values.folder === 'string' ? values.folder : undefined;

  // Open: default true (matches "open the studio in the browser" in the
  // PRD). Explicit `--open` overrides nothing (it sets true already);
  // `--no-open` (stripped above) overrides to false.
  let open;
  if (openIntent === false) {
    open = false;
  } else if (values.open === true) {
    open = true;
  } else {
    open = true; // default
  }

  return {
    flags: {
      port,
      folder,
      open,
      help: !!values.help,
    },
    error: null,
  };
}

/**
 * Locate the studio root that the dev server will serve.
 *
 * Resolution order:
 *   1. `<cli-package>/dist-studio/` — the pre-built static assets bundled
 *      into the published `@lerret/cli` package. Present after `pnpm --filter
 *      @lerret/cli build` (or after `npm install @lerret/cli`).
 *   2. `<monorepo>/packages/studio/` source — the workspace fallback for
 *      fresh checkouts or contributors who haven't run the build yet. Vite
 *      will serve from source in this path, so HMR works but the bundle is
 *      NOT production-optimised. A warning is printed so the developer knows.
 *
 * In the published npm tarball only `dist-studio/` exists (the source is not
 * shipped), so path 1 is the only option for end users. Path 2 is a dev
 * convenience — it keeps `lerret dev` usable in the monorepo even without
 * a preceding build step.
 *
 * @returns {string}  An absolute path to the studio root (static or source).
 */
export function resolveStudioRoot() {
  // This file: packages/cli/src/dev.js → packages/cli/src/ → packages/cli/
  const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  // 1. Prefer the pre-built dist-studio/ (production / published case).
  const distStudio = resolve(cliDir, 'dist-studio');
  if (pathExists(resolve(distStudio, 'index.html'))) {
    return distStudio;
  }

  // 2. Fall back to the studio source for in-monorepo dev without a build.
  //    The warning surfaces the situation so contributors know why startup
  //    is slower (Vite transforms source on every request).
  const studioSource = resolve(cliDir, '..', 'studio');
  process.stderr.write(
    'lerret: dist-studio/ not found — serving studio from source.\n' +
    '        Run `pnpm --filter @lerret/cli build` for production performance.\n',
  );
  return studioSource;
}

/**
 * Run `lerret dev`. Resolves the project, starts the Vite server, waits for
 * Ctrl-C, and returns an exit code.
 *
 * @param {string[]} argv  Argv slice after the `dev` subcommand.
 * @returns {Promise<number>}  Exit code. 0 on graceful shutdown, 1 on an
 *   unrecoverable error (Vite failed to start, port already in use, etc.).
 */
export async function runDev(argv) {
  const { flags, error } = parseDevArgs(argv);
  if (error) {
    process.stderr.write(`lerret dev: ${error}\n\n`);
    printUsage();
    return 1;
  }

  if (flags.help) {
    printUsage();
    return 0;
  }

  // 1. Resolve the project.
  //
  // The PRD's flow:
  //   - `--folder <path>` overrides the start dir for the walk-up.
  //   - Otherwise we start from `process.cwd()` and let `resolveProject`
  //     find the nearest ancestor that owns `.lerret/`.
  //
  // A NOT-FOUND result is NOT a crash (FR43). We still start
  // the dev server, but the plugin exposes `project: null` and the studio
  // mounts its no-folder placeholder. This makes `lerret dev` always
  // reachable — even invoked from the wrong directory, the user sees the
  // studio and is guided to open a folder.
  const startDir = flags.folder
    ? normalizeFolderArg(flags.folder)
    : process.cwd();

  const projectResolution = await resolveProject(startDir);

  // Vite's `server.fs.allow` compares against symlink-resolved paths, so
  // we *always* canonicalize the project root before handing it to the
  // plugin. On macOS `/tmp` → `/private/tmp` is the classic gotcha; the
  // helper is a no-op for already-canonical paths.
  /** @type {string | null} */
  const projectRoot = projectResolution.found
    ? realpathOrSelf(projectResolution.projectRoot).replaceAll('\\', '/')
    : null;
  /** @type {string | null} */
  const lerretDir = projectResolution.found
    ? realpathOrSelf(projectResolution.lerretDir).replaceAll('\\', '/')
    : null;

  if (projectResolution.found) {
    process.stdout.write(`lerret dev: project ${projectRoot}\n`);
  } else {
    process.stdout.write(
      `lerret dev: no \`.lerret/\` project found from ${startDir} — starting in no-folder mode.\n`,
    );
  }

  // 2. Find the studio source dir Vite will serve as its root.
  const studioRoot = resolveStudioRoot();

  // 3. Boot Vite programmatically.
  //
  // We import `vite` dynamically so the CLI's static-analysis (and the
  // `lerret --help` path) doesn't pay the import cost up front.
  //
  // When serving from pre-built `dist-studio/` assets:
  //   - `@vitejs/plugin-react` is NOT needed — the JSX is already compiled.
  //   - Only the `lerretProjectPlugin` is needed (virtual module + HMR).
  //
  // When serving from studio source (fallback path):
  //   - `@vitejs/plugin-react` IS needed for the JSX transform + Fast Refresh.
  //
  // `searchForWorkspaceRoot` finds the workspace root (the pnpm-
  // workspace's top-level), which is what Vite uses by default when
  // `server.fs.allow` is undefined. We set it explicitly so we can append
  // the user's project root without losing the workspace access the studio
  // needs (its node_modules, its source dir, etc.).
  const vite = await import('vite');
  const { createServer, searchForWorkspaceRoot } = vite;

  // Whether we are serving from the pre-built CLI bundle or from source.
  const cliDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const isPreBuilt = pathExists(resolve(cliDir, 'dist-studio', 'index.html')) &&
    studioRoot === resolve(cliDir, 'dist-studio');

  const plugins = [lerretProjectPlugin({ projectRoot, lerretDir })];
  if (!isPreBuilt) {
    // Serving from source — need the React plugin for JSX transform.
    const reactPlugin = (await import('@vitejs/plugin-react')).default;
    plugins.unshift(reactPlugin());
  }

  const workspaceRoot = searchForWorkspaceRoot(studioRoot);

  // The user's `.jsx` assets get transformed by Vite/esbuild into imports
  // of `react/jsx-dev-runtime`. The user's project has no `node_modules`,
  // so those imports must resolve against the CLI's own React. Alias the
  // bare specifiers to the CLI-bundled copy.
  const cliRequire = createRequire(import.meta.url);
  const reactAliases = [
    { find: 'react/jsx-dev-runtime', replacement: cliRequire.resolve('react/jsx-dev-runtime') },
    { find: 'react/jsx-runtime', replacement: cliRequire.resolve('react/jsx-runtime') },
    { find: 'react-dom/client', replacement: cliRequire.resolve('react-dom/client') },
    { find: /^react-dom$/, replacement: cliRequire.resolve('react-dom') },
    { find: /^react$/, replacement: cliRequire.resolve('react') },
  ];

  const server = await createServer({
    // Don't pick up the studio's own `vite.config.js` (it has a fixture
    // alias the CLI doesn't want); we hand Vite a clean inline config.
    configFile: false,
    root: studioRoot,
    plugins,
    resolve: { alias: reactAliases },
    server: {
      port: flags.port,
      open: flags.open,
      fs: {
        // Studio root + monorepo/workspace root. The plugin appends the
        // user's project root on top of this list. The CLI never writes
        // to any of these — only reads (NFR13).
        allow: [studioRoot, workspaceRoot],
      },
      // `host` left undefined so Vite uses its default (localhost). Users
      // who need network access can re-run with --port and Vite's own
      // --host knob in a future change; for `lerret dev` against a local
      // user folder the default localhost behavior is right.
    },
  });

  await server.listen();
  server.printUrls();

  // The asset base URL the studio expects — log so a curious user can see
  // it (and to help debugging if a future change touches the contract).
  if (projectRoot) {
    process.stdout.write(`lerret dev: serving project at ${PROJECT_ASSET_BASE_URL}/\n`);
  }

  // 4. Hold the process open until SIGINT/SIGTERM, then close cleanly.
  //
  // Without this `await`, runDev would resolve and the CLI would exit
  // before the server ever served a request. With it, the function
  // resolves only when the user kills the process — perfect for a
  // long-running dev command.
  return await waitForShutdown(server);
}

/**
 * Resolve when the dev server should shut down — on SIGINT (Ctrl-C) or
 * SIGTERM. The handlers are removed after the first signal so a second one
 * can hard-kill if the close hangs.
 *
 * @param {import('vite').ViteDevServer} server
 * @returns {Promise<number>}
 */
function waitForShutdown(server) {
  return new Promise((resolve) => {
    let shuttingDown = false;
    const onSignal = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      process.stdout.write(`\nlerret dev: ${signal} received, shutting down…\n`);
      try {
        await server.close();
      } catch {
        // Best effort; we're exiting anyway.
      }
      // Detach the other handler so a second Ctrl-C exits immediately.
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      resolve(0);
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  });
}

/**
 * Re-export of the dev-side asset base URL, so the few studio-side tests
 * that need it can import it from the CLI without depending on the plugin
 * file directly.
 */
export { PROJECT_ASSET_BASE_URL };
