#!/usr/bin/env node
// `create-lerret` scaffolder.
//
// Usage:
//   create-lerret <name>              Full project with sample assets (default)
//   create-lerret <name> --no-samples Minimal empty project (just .lerret/config.json)
//
// Default (no flag): copies the template's `.lerret/` tree verbatim — sample
// assets in `social/`, brand fonts in `_fonts/`, and `config.json` with
// preset brand variables.
//
// --no-samples: creates only `.lerret/config.json` with a minimal root config
// (`{ "vars": {} }`). No `_fonts/`, no `social/` pages, no sample artboards.
// The resulting project opens in the studio showing the calm empty-but-correct
// canvas (zero pages, zero assets — valid state).
//
// Minimal config format: plain `JSON.stringify(value, null, 2) + '\n'` — no
// external serialiser dependency so the scaffolder stays self-contained.
//
// Arg parsing: `node:util` parseArgs, per the architecture's convention.
// `--no-samples` is order-independent relative to the positional name argument.
//
// Existing-target behaviour (FR41):
//   Non-empty dir  → refuse with clear message, exit 1, no writes at all.
//   Empty dir      → proceed to populate (choice A — empty dirs are often
//                    pre-created by users; refusing would be unnecessary friction).
//   Path is a file → refuse with clear message, exit 1.
//   Parent missing → refuse with clear message, exit 1.
//   Unwritable     → refuse with clear message, exit 1.
//   Mid-copy fail  → clean up any partial destDir, then exit 1.
//
// Exit codes:
//   0 — success.
//   1 — missing/invalid project name, filesystem error, or usage error.

// The `no-restricted-imports` ESLint rule gates `node:fs` to node-backend.js.
// The scaffolder is an installable Node CLI tool (analogous to
// packages/cli/scripts/bundle-studio.js) and must access the filesystem
// directly — it runs outside the studio's FilesystemAccess abstraction.
// eslint-disable-next-line no-restricted-imports
import { constants, realpathSync, promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------
//
// The template lives at `<this-package>/template/.lerret/`. Resolving via
// `import.meta.url` makes the path correct both when running from within the
// workspace (`node packages/create-lerret/src/create-lerret.js`) AND when the
// package is installed as a global npm package (where `__dirname` is not
// available in ESM, but `import.meta.url` always points to this file).

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATE_SRC = join(PACKAGE_ROOT, 'template', '.lerret');

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------
//
// Accepts alphanumeric characters plus `.`, `_`, and `-` for maximum
// cross-platform portability. Rejects path traversal (`..`/`.`), path
// separators, and characters that are illegal or problematic on common OSes
// (Windows bans `\/:*?"<>|`; POSIX bans NUL). This regex is intentionally
// conservative — a safe subset is always valid everywhere.

const VALID_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a candidate project name.
 *
 * @param {string} name  The raw value supplied by the user.
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
function validateName(name) {
  if (name === '') {
    return { ok: false, reason: 'Project name cannot be empty.' };
  }
  if (name === '.' || name === '..') {
    return {
      ok: false,
      reason: `"${name}" is not a valid project name. Use a plain directory name.`,
    };
  }
  // Reject path separators (both POSIX `/` and Windows `\`).
  if (name.includes('/') || name.includes(sep) || name.includes('\\')) {
    return {
      ok: false,
      reason: `Project name "${name}" must not contain path separators. Use a plain directory name.`,
    };
  }
  if (!VALID_NAME_RE.test(name)) {
    return {
      ok: false,
      reason:
        `Project name "${name}" contains characters that are not safe for a ` +
        'directory name on all platforms. ' +
        'Use only letters, digits, dots (.), hyphens (-), or underscores (_).',
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Usage banner
// ---------------------------------------------------------------------------

function printUsage() {
  process.stdout.write(
    [
      'create-lerret — scaffold a new Lerret project',
      '',
      'Usage:',
      '  create-lerret <name>               Create a project with sample assets (default)',
      '  create-lerret <name> --no-samples  Scaffold a minimal empty project',
      '',
      'Arguments:',
      '  name           Directory name for the new project (letters, digits, . - _)',
      '',
      'Options:',
      '  --no-samples   Create only .lerret/config.json — no sample assets or fonts',
      '  --help, -h     Show this usage message',
      '',
      'Examples:',
      '  create-lerret my-project',
      '  create-lerret my-project --no-samples',
      '  create-lerret --no-samples my-brand',
      '  npx create-lerret my-project',
    ].join('\n') + '\n',
  );
}

// ---------------------------------------------------------------------------
// Pre-flight destination check (FR41)
// ---------------------------------------------------------------------------
//
// Called before any write so we can refuse cleanly without leaving partials.
//
// Returns:
//   { ok: true }                     — safe to proceed
//   { ok: false; reason: string }    — caller must print and exit 1

/**
 * Verify that `destDir` is a safe write target.
 *
 * Rules (in order):
 *  1. If the path is an existing FILE  → refuse.
 *  2. If the path is a non-empty DIR   → refuse.
 *  3. If the path is an empty DIR      → proceed (choice A).
 *  4. If the path doesn't exist (ENOENT):
 *       a. Check that the parent dir exists.
 *       b. Check that the parent is writable.
 *  5. On any other stat error → propagate as an unexpected failure.
 *
 * @param {string} destDir  Absolute path to the intended project root.
 * @returns {Promise<{ ok: true } | { ok: false; reason: string }>}
 */
async function preflightDest(destDir) {
  // ── Step 1 & 2 & 3: stat destDir ────────────────────────────────────────
  let destStat;
  try {
    destStat = await fsp.stat(destDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      destStat = null; // does not exist yet — check the parent below
    } else {
      // Unexpected error (EACCES on the path itself, etc.)
      return {
        ok: false,
        reason: `Cannot access "${destDir}": ${err && err.message ? err.message : String(err)}`,
      };
    }
  }

  if (destStat !== null) {
    if (!destStat.isDirectory()) {
      // destDir already exists as a non-directory (file, symlink, …).
      return {
        ok: false,
        reason:
          `Target "${destDir}" already exists and is a file, not a directory — ` +
          'pick a different name or remove the existing file.',
      };
    }

    // destDir is a directory — check whether it's empty.
    const entries = await fsp.readdir(destDir);
    if (entries.length > 0) {
      // Non-empty dir: refuse to overwrite (no partial copy ever created).
      const name = destDir.split(/[\\/]/).pop() ?? destDir;
      return {
        ok: false,
        reason:
          `Directory ${name} already exists and is not empty — ` +
          'refusing to overwrite. ' +
          'Pick a different name or remove the existing folder.',
      };
    }

    // Empty dir — proceed (choice A).
    return { ok: true };
  }

  // ── Steps 4a & 4b: destDir doesn't exist — check parent ─────────────────
  const parent = dirname(destDir);

  let parentStat;
  try {
    parentStat = await fsp.stat(parent);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return {
        ok: false,
        reason: `Parent directory "${parent}" does not exist.`,
      };
    }
    return {
      ok: false,
      reason: `Cannot access parent directory "${parent}": ${err && err.message ? err.message : String(err)}`,
    };
  }

  if (!parentStat.isDirectory()) {
    return {
      ok: false,
      reason: `Parent path "${parent}" is not a directory.`,
    };
  }

  // Check write permission on the parent.
  try {
    await fsp.access(parent, constants.W_OK);
  } catch (err) {
    const code = err && err.code;
    if (code === 'EACCES' || code === 'EROFS') {
      return {
        ok: false,
        reason: `Cannot write to "${parent}": permission denied.`,
      };
    }
    return {
      ok: false,
      reason: `Cannot write to "${parent}": ${err && err.message ? err.message : String(err)}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Scaffold
// ---------------------------------------------------------------------------

/**
 * Copy the template `.lerret/` directory into `<destDir>/.lerret/`, excluding
 * any tooling artifacts that may have crept into the template tree.
 *
 * On mid-copy failure the destination directory is removed so no partial
 * project is left behind.
 *
 * @param {string} templateSrc  Absolute path to the template's `.lerret/` dir.
 * @param {string} destDir      Absolute path to the new project root (`<name>/`).
 * @param {boolean} destExisted Whether `destDir` was already present before we
 *   started (true = empty-dir case; false = we created it).  When cleanup is
 *   needed we only remove `destDir` if we created it; if it already existed as
 *   an empty dir we remove just `.lerret/` so we leave the user's dir intact.
 * @returns {Promise<void>}
 */
async function copyTemplate(templateSrc, destDir, destExisted) {
  const destLerret = join(destDir, '.lerret');
  await fsp.mkdir(destDir, { recursive: true });
  try {
    await fsp.cp(templateSrc, destLerret, {
      recursive: true,
      // Exclude tooling artifacts that must not reach the end user.
      filter: (src) => {
        const base = src.split(/[\\/]/).pop() ?? '';
        return base !== '.DS_Store' && base !== 'node_modules' && base !== '.git';
      },
    });
  } catch (err) {
    // Mid-copy failure: clean up whatever was partially written.
    if (destExisted) {
      // Dir existed before us (empty-dir case) — remove only what we wrote.
      await fsp.rm(destLerret, { recursive: true, force: true });
    } else {
      // We created destDir — remove the whole thing.
      await fsp.rm(destDir, { recursive: true, force: true });
    }
    throw err;
  }
}

/**
 * Scaffold a minimal empty Lerret project — just `.lerret/config.json`.
 *
 * The config contains an empty `vars` map so the loader's schema is satisfied
 * without any pre-set values.  No `_fonts/`, no `social/` pages, no sample
 * artboards.  When opened in the studio the canvas shows the calm empty state
 * (zero pages, zero assets).
 *
 * The file is written as `JSON.stringify(value, null, 2) + '\n'` — stable,
 * human-readable, trailing newline — with no external serialiser dependency.
 *
 * On mid-write failure the destination directory is cleaned up.
 *
 * @param {string} destDir      Absolute path to the new project root (`<name>/`).
 * @param {boolean} destExisted Whether `destDir` already existed before we started.
 * @returns {Promise<void>}
 */
async function scaffoldMinimal(destDir, destExisted) {
  const destLerret = join(destDir, '.lerret');
  await fsp.mkdir(destLerret, { recursive: true });

  /** @type {{ vars: Record<string, string> }} */
  const minimalConfig = { vars: {} };
  const configJson = JSON.stringify(minimalConfig, null, 2) + '\n';
  try {
    await fsp.writeFile(join(destLerret, 'config.json'), configJson, 'utf8');
  } catch (err) {
    // Mid-write failure: clean up whatever was partially written.
    if (destExisted) {
      await fsp.rm(destLerret, { recursive: true, force: true });
    } else {
      await fsp.rm(destDir, { recursive: true, force: true });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Entry point for the `create-lerret` CLI. Separated from the direct
 * `process.exit` call so tests can call it and inspect the result.
 *
 * @param {string[]} [argv]  The argument slice to parse (defaults to
 *   `process.argv.slice(2)`).
 * @returns {Promise<number>}  The exit code — 0 on success, 1 on error.
 */
export async function main(argv = process.argv.slice(2)) {
  // Parse flags first (order-independent relative to the positional).
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        'no-samples': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    }));
  } catch (err) {
    process.stderr.write(
      `create-lerret: ${err && err.message ? err.message : String(err)}\n\n`,
    );
    printUsage();
    return 1;
  }

  if (values.help) {
    printUsage();
    return 0;
  }

  const noSamples = values['no-samples'] === true;

  const name = positionals[0] ?? '';

  if (!name) {
    process.stderr.write('create-lerret: missing required argument <name>.\n\n');
    printUsage();
    return 1;
  }

  const validation = validateName(name);
  if (!validation.ok) {
    process.stderr.write(`create-lerret: ${validation.reason}\n`);
    return 1;
  }

  const destDir = resolve(process.cwd(), name);

  // ── Pre-flight check (FR41) ──────────────────────────────────────────────
  // Run before any write so we can refuse cleanly without leaving partials.
  const preflight = await preflightDest(destDir);
  if (!preflight.ok) {
    process.stderr.write(`create-lerret: ${preflight.reason}\n`);
    return 1;
  }

  // Determine whether destDir already existed (empty-dir case) so the
  // scaffold helpers can decide what to remove on mid-copy failure.
  let destExisted = false;
  try {
    await fsp.stat(destDir);
    destExisted = true;
  } catch {
    // ENOENT — will be created by the scaffold helper.
  }

  if (noSamples) {
    // Minimal-project path: write only .lerret/config.json.
    // No template access needed — nothing is copied from the template.
    try {
      await scaffoldMinimal(destDir, destExisted);
    } catch (err) {
      process.stderr.write(
        `create-lerret: failed to scaffold "${name}": ` +
          `${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }

    // Success message — reflects the minimal/empty nature of the project.
    process.stdout.write(
      [
        `✓ Created ${name}/.lerret/ — empty project, ready for your first asset.`,
        '',
        'Next:',
        `  cd ${name}`,
        '  npx @lerret/cli dev',
        '',
      ].join('\n'),
    );

    return 0;
  }

  // Full-template path (default): copy the sample project verbatim.

  // Check the template exists (safeguard against a misconfigured package).
  try {
    await fsp.access(TEMPLATE_SRC);
  } catch {
    process.stderr.write(
      `create-lerret: template not found at ${TEMPLATE_SRC}\n` +
        'This is a bug — please report it at https://github.com/belikely-united/lerret\n',
    );
    return 1;
  }

  try {
    await copyTemplate(TEMPLATE_SRC, destDir, destExisted);
  } catch (err) {
    process.stderr.write(
      `create-lerret: failed to scaffold "${name}": ` +
        `${err && err.message ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // Success message — calm, friendly, exact next commands.
  process.stdout.write(
    [
      `✓ Created ${name}/.lerret/ with sample assets.`,
      '',
      'Next:',
      `  cd ${name}`,
      '  npx @lerret/cli dev',
      '',
    ].join('\n'),
  );

  return 0;
}

// Only run main() when this file is the process entry — keeps the exported
// `main` callable from tests without firing the real CLI.
//
// `process.argv[1]` is the path the user invoked. When installed as a package
// (e.g. via `pnpm dlx` or `npx`) the path may be a symlink inside the runner's
// cache directory, while `import.meta.url` is resolved to the real (physical)
// path. We use `realpathSync` to dereference both sides before comparing so
// that symlinked installs (pnpm's virtual store, npx cache) are handled
// correctly across all four zero-install runners.
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
  const code = await main();
  process.exit(code);
}
