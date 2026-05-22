// `@lerret/cli clear` — remove sample assets or whole subtrees from a project.
//
// The scaffolder (`create-lerret`) ships an opinionated sample set so a brand-
// new project boots into something visible. When a user wants to replace those
// samples with their own work, the polite UX is one command — not "find the
// folder yourself, then `rm -rf` it from a guarded location."
//
// Shape (matches `dev` / `export`'s `node:util` parseArgs convention — no heavy
// CLI framework):
//
//   @lerret/cli clear [path...] [--all] [--yes] [--dry-run] [-h]
//
//   path...     One or more paths to remove (files or folders). Each must be
//               inside the project's `.lerret/` tree. Relative paths resolve
//               against CWD; absolute paths must still land inside `.lerret/`.
//
//   --all       Remove every immediate child of `.lerret/` EXCEPT the always-
//               protected `config.json` and `_fonts/`. Mutually exclusive with
//               positional paths — pass one or the other.
//   --yes       Skip the "are you sure" confirmation prompt. Required for
//               non-interactive runs. Without this flag and without a TTY, the
//               command refuses to act and exits 1 with a message.
//   --dry-run   Print the plan and exit without touching the filesystem.
//   -h/--help   Print this usage and exit 0.
//
// Protected paths (always refused, never removed):
//   - the project root `.lerret/` itself
//   - `.lerret/config.json` (per-project root config)
//   - `.lerret/_fonts/` (auto-registered fonts directory)
//
// Resolution rules:
//   - The project is resolved from CWD via `resolveProject` (same walk-up rule
//     `dev` and `export` use). No `--folder` override here — `clear` is a
//     deliberately scoped command; if you need to point at a foreign project,
//     `cd` into it first. Smaller surface = fewer footguns.
//   - Each positional is canonicalized via `realpathOfExistingPrefix` so the
//     "must be inside `.lerret/`" check survives macOS's `/tmp` -> `/private/tmp`
//     symlink and similar.
//
// Exit codes:
//   0 — clear succeeded (including dry-run), `--help`, or "nothing to remove".
//   1 — usage error, no project found, target outside `.lerret/`, target hit a
//       protected path, confirmation refused, or a deletion failed.

import { parseArgs } from 'node:util';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline/promises';

import {
  createNodeBackend,
  deleteEntry,
  pathExists,
  realpathOfExistingPrefix,
  realpathOrSelf,
} from './fs/node-backend.js';
import { resolveProject } from './resolve-project.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Names directly under `.lerret/` that `clear` will refuse to touch regardless
 * of how they are addressed. `config.json` carries the project's root config
 * and `vars`; removing it silently breaks every asset that resolves a Tier-2
 * prop. `_fonts/` is the project's font home — keeping it intact survives the
 * common "wipe samples, keep my font" workflow.
 *
 * @type {ReadonlySet<string>}
 */
const PROTECTED_LEAF_NAMES = new Set(['config.json', '_fonts']);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ClearFlags
 * @property {string[]} paths
 *   Positional paths the user passed. Empty when `--all` is used.
 * @property {boolean} all
 * @property {boolean} yes
 * @property {boolean} dryRun
 * @property {boolean} help
 */

/**
 * One resolved removal target: a canonical absolute path plus the human-
 * readable display form (relative to `.lerret/`) used in prompts and logs.
 *
 * @typedef {object} ClearTarget
 * @property {string} absPath     Canonical, forward-slash absolute path.
 * @property {string} displayPath Path relative to the project's `.lerret/`.
 * @property {'file' | 'directory'} kind
 */

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print `@lerret/cli clear`'s usage banner.
 *
 * @returns {void}
 */
function printUsage() {
  const lines = [
    '@lerret/cli clear — remove sample assets or subtrees from a project.',
    '',
    'Usage: @lerret/cli clear [path...] [options]',
    '',
    'Arguments:',
    '  path...          One or more files or folders to remove. Each must be',
    '                   inside the project\'s `.lerret/` tree. Mutually',
    '                   exclusive with --all.',
    '',
    'Options:',
    '  --all            Remove every child of `.lerret/` EXCEPT the always-',
    '                   protected `config.json` and `_fonts/`. Use this to',
    '                   wipe scaffolded samples and start fresh.',
    '  --yes            Skip the confirmation prompt (required for scripts).',
    '  --dry-run        Print the plan; do not touch the filesystem.',
    '  -h, --help       Show this help.',
    '',
    'Protected paths (never removed): `.lerret/config.json`, `.lerret/_fonts/`.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Parse `@lerret/cli clear`'s argv slice.
 *
 * @param {string[]} argv
 * @returns {{ flags: ClearFlags | null, error: string | null }}
 */
export function parseClearArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        all: { type: 'boolean' },
        yes: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    return {
      flags: null,
      error: err && err.message ? err.message : String(err),
    };
  }

  const values = parsed.values || {};
  const positionals = parsed.positionals || [];

  const flags = {
    paths: positionals,
    all: values.all === true,
    yes: values.yes === true,
    dryRun: values['dry-run'] === true,
    help: values.help === true,
  };

  // `--all` and positional paths are mutually exclusive — they answer the
  // same question two different ways and combining them invites "did --all win
  // or did the path arg win?" ambiguity.
  if (flags.all && flags.paths.length > 0) {
    return {
      flags: null,
      error: '--all and positional paths are mutually exclusive — pick one',
    };
  }

  return { flags, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Target resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an OS path to the contract-level forward-slash form. Pure helper.
 *
 * @param {string} osPath
 * @returns {string}
 */
function toLerretPath(osPath) {
  return osPath.replaceAll('\\', '/');
}

/**
 * Strip the `.lerret/` prefix from an absolute path for display purposes. The
 * prefix is implied by the command's scope, and stripping it keeps the prompt
 * compact and project-relative.
 *
 * @param {string} absPath
 * @param {string} lerretDir
 * @returns {string}
 */
function displayPathFor(absPath, lerretDir) {
  if (absPath === lerretDir) return '.';
  if (absPath.startsWith(lerretDir + '/')) {
    return absPath.slice(lerretDir.length + 1);
  }
  return absPath;
}

/**
 * Resolve a single user-supplied positional into a concrete target inside the
 * project's `.lerret/` tree, or an error explaining why it cannot be removed.
 *
 * Resolution priority:
 *
 *   1. Absolute path — used as-is.
 *   2. Path starting with `.lerret/` or an explicit `./` / `../` — CWD-relative
 *      (standard shell expectation).
 *   3. Bare name (the common case, e.g. `social`) — resolved against
 *      `.lerret/`. Lerret users think in canvas-folder names, not in OS paths.
 *
 * @param {string} rawPath  The user's input (may be relative).
 * @param {object} ctx
 * @param {string} ctx.cwd
 * @param {string} ctx.lerretDir
 * @returns {{ ok: true, target: ClearTarget } | { ok: false, error: string }}
 */
export function resolvePositionalTarget(rawPath, { cwd, lerretDir }) {
  const isExplicitRelative =
    rawPath === '.' ||
    rawPath === '..' ||
    rawPath.startsWith('./') ||
    rawPath.startsWith('../') ||
    rawPath.startsWith('.lerret/') ||
    rawPath.startsWith('.lerret\\');

  let absRaw;
  if (isAbsolute(rawPath)) {
    absRaw = rawPath;
  } else if (isExplicitRelative) {
    absRaw = resolvePath(cwd, rawPath);
  } else {
    // Bare name → resolve against .lerret/.
    absRaw = resolvePath(lerretDir, rawPath);
  }

  // Canonicalize so the containment check survives symlink-in-prefix gotchas
  // (macOS `/tmp` → `/private/tmp`). `realpathOfExistingPrefix` handles
  // not-yet-existing leaves without throwing.
  const abs = toLerretPath(realpathOfExistingPrefix(absRaw));

  // Containment FIRST — for a path outside `.lerret/`, "outside" is more
  // informative than "does not exist", and accurate either way.
  if (abs === lerretDir) {
    return {
      ok: false,
      error:
        `"${rawPath}" resolves to the project's \`.lerret/\` itself — refusing ` +
        'to remove the project root. Use --all to wipe its contents while ' +
        'preserving config.json and _fonts/.',
    };
  }

  if (!abs.startsWith(lerretDir + '/')) {
    return {
      ok: false,
      error:
        `"${rawPath}" is outside the project's \`.lerret/\` tree (${abs}). ` +
        '`clear` only operates inside `.lerret/`.',
    };
  }

  // Protected-leaf check BEFORE existence — config.json / _fonts/ are special
  // even when present, and the "protected" wording is more actionable.
  const relSegments = abs.slice(lerretDir.length + 1).split('/');
  const firstSegment = relSegments[0];
  if (PROTECTED_LEAF_NAMES.has(firstSegment)) {
    return {
      ok: false,
      error:
        `"${rawPath}" hits a protected path (.lerret/${firstSegment}). ` +
        '`config.json` and `_fonts/` are never removed by `clear`.',
    };
  }

  if (!pathExists(abs)) {
    return {
      ok: false,
      error: `"${rawPath}" does not exist (resolved to ${abs})`,
    };
  }

  const kind = classifyKind(abs);
  return {
    ok: true,
    target: {
      absPath: abs,
      displayPath: displayPathFor(abs, lerretDir),
      kind,
    },
  };
}

/**
 * Best-effort kind classification for prompt display. The node-backend does
 * not expose a synchronous `stat`, and the `node:fs` import ban prevents us
 * from reaching for one directly. A wrong classification only affects how the
 * plan line is decorated (trailing slash on dirs) — `deleteEntry` handles
 * both kinds via `rm -rf` semantics — so a path-suffix heuristic suffices:
 * a recognizable extension means file, anything else means directory.
 *
 * @param {string} absPath
 * @returns {'file' | 'directory'}
 */
function classifyKind(absPath) {
  return /\.[A-Za-z0-9]+$/.test(absPath) ? 'file' : 'directory';
}

/**
 * Enumerate the targets for `--all`: every immediate child of `.lerret/`
 * EXCEPT the protected leaves.
 *
 * @param {object} ctx
 * @param {import('@lerret/core').FilesystemAccess} ctx.fs
 * @param {string} ctx.lerretDir
 * @returns {Promise<ClearTarget[]>}
 */
export async function resolveAllTargets({ fs, lerretDir }) {
  const entries = await fs.readDir(lerretDir);
  return entries
    .filter((entry) => !PROTECTED_LEAF_NAMES.has(entry.name))
    .map((entry) => ({
      absPath: toLerretPath(entry.path),
      displayPath: entry.name,
      kind: entry.isDirectory ? 'directory' : 'file',
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prompt the user with the plan and wait for a y/N answer. `y` / `yes`
 * (case-insensitive) confirms; anything else cancels. Always answers
 * "cancelled" when stdin is not a TTY and `--yes` was not passed, so a
 * non-interactive run never deletes without the explicit flag.
 *
 * @param {string} question
 * @param {object} [io]
 * @param {NodeJS.ReadableStream} [io.input]
 * @param {NodeJS.WritableStream} [io.output]
 * @param {boolean} [io.isTty]
 * @returns {Promise<boolean>}
 */
export async function promptYesNo(question, io = {}) {
  const input = io.input || process.stdin;
  const output = io.output || process.stdout;
  const isTty = io.isTty !== undefined ? io.isTty : Boolean(input.isTTY);

  if (!isTty) {
    output.write(
      `${question}\nCannot prompt in a non-TTY context. Re-run with --yes to proceed.\n`,
    );
    return false;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {ClearTarget[]} targets
 * @returns {string}  A multi-line summary string with no trailing newline.
 */
function formatTargetList(targets) {
  if (targets.length === 0) return '  (nothing)';
  return targets
    .map((t) => `  - ${t.displayPath}${t.kind === 'directory' ? '/' : ''}`)
    .join('\n');
}

/**
 * Run `@lerret/cli clear`. Resolves the project, builds the target list,
 * confirms (or skips on --yes / --dry-run), and removes each target.
 *
 * @param {string[]} argv  Argv slice after the `clear` subcommand.
 * @param {object} [deps]  Injectable for tests.
 * @param {() => string} [deps.getCwd]
 * @param {(target: string) => Promise<void>} [deps.remove]
 *   Override the per-target deletion (tests use this to avoid touching disk).
 *   Defaults to `deleteEntry` from the node backend.
 * @param {(question: string) => Promise<boolean>} [deps.confirm]
 *   Override the y/N prompt (tests inject a deterministic answer).
 * @returns {Promise<number>}  Exit code.
 */
export async function runClear(argv, deps = {}) {
  const { flags, error } = parseClearArgs(argv);
  if (error) {
    process.stderr.write(`@lerret/cli clear: ${error}\n\n`);
    printUsage();
    return 1;
  }

  if (flags.help) {
    printUsage();
    return 0;
  }

  if (!flags.all && flags.paths.length === 0) {
    process.stderr.write(
      '@lerret/cli clear: pass one or more paths to remove, or --all to wipe ' +
        'samples (`config.json` and `_fonts/` are preserved).\n\n',
    );
    printUsage();
    return 1;
  }

  const getCwd = deps.getCwd || (() => process.cwd());
  const cwd = getCwd();

  // Resolve the project — same walk-up rule `dev` and `export` use. We accept
  // no `--folder` override here on purpose: `cd` into the project you mean.
  const backend = createNodeBackend();
  const projectResolution = await resolveProject(
    toLerretPath(resolvePath(cwd)),
    backend,
  );
  if (!projectResolution.found) {
    process.stderr.write(
      '@lerret/cli clear: no `.lerret/` project found from the current ' +
        'directory. `cd` into a project root (a folder that contains `.lerret/`) ' +
        'and try again.\n',
    );
    return 1;
  }

  const lerretDir = toLerretPath(realpathOrSelf(projectResolution.lerretDir));

  // Build the target list.
  /** @type {ClearTarget[]} */
  let targets;
  if (flags.all) {
    try {
      targets = await resolveAllTargets({ fs: backend, lerretDir });
    } catch (err) {
      process.stderr.write(
        `@lerret/cli clear: could not read ${lerretDir}: ` +
          `${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }
  } else {
    targets = [];
    for (const rawPath of flags.paths) {
      const res = resolvePositionalTarget(rawPath, { cwd, lerretDir });
      if (!res.ok) {
        process.stderr.write(`@lerret/cli clear: ${res.error}\n`);
        return 1;
      }
      targets.push(res.target);
    }
  }

  if (targets.length === 0) {
    process.stdout.write(
      `@lerret/cli clear: nothing to remove in ${lerretDir}.\n`,
    );
    return 0;
  }

  // Print the plan. Dry-run stops here.
  const planHeader = flags.all
    ? `@lerret/cli clear: will remove ${targets.length} item${targets.length === 1 ? '' : 's'} from .lerret/ (preserving config.json and _fonts/):`
    : `@lerret/cli clear: will remove ${targets.length} item${targets.length === 1 ? '' : 's'} from .lerret/:`;
  process.stdout.write(`${planHeader}\n${formatTargetList(targets)}\n`);

  if (flags.dryRun) {
    process.stdout.write('@lerret/cli clear: dry run — nothing was removed.\n');
    return 0;
  }

  // Confirm unless --yes was passed.
  if (!flags.yes) {
    const confirmFn = deps.confirm || promptYesNo;
    const ok = await confirmFn('Proceed?');
    if (!ok) {
      process.stdout.write('@lerret/cli clear: cancelled — nothing removed.\n');
      return 1;
    }
  }

  // Execute removals serially so the first failure stops the cascade. The
  // node backend's `deleteEntry` is `rm -rf`-style: missing targets succeed
  // silently, files and directories both work.
  const removeFn = deps.remove || deleteEntry;
  let removedCount = 0;
  for (const target of targets) {
    try {
      await removeFn(target.absPath);
      removedCount++;
      process.stdout.write(`  removed ${target.displayPath}${target.kind === 'directory' ? '/' : ''}\n`);
    } catch (err) {
      process.stderr.write(
        `@lerret/cli clear: failed to remove ${target.displayPath}: ` +
          `${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }
  }

  process.stdout.write(
    `@lerret/cli clear: removed ${removedCount} item${removedCount === 1 ? '' : 's'} from .lerret/.\n`,
  );
  return 0;
}
