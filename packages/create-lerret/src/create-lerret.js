#!/usr/bin/env node
// `create-lerret` scaffolder.
//
// Usage:
//   create-lerret <name>                       Full project with sample assets (default)
//   create-lerret <name> --no-samples          Minimal empty project (just .lerret/config.json)
//   create-lerret <name> --no-ai-rules         Skip ALL AI-tool integration files
//   create-lerret <name> --ai-tools=claude,...  Scope which AI-tool surfaces ship
//
// Default (no flag): copies the template's `.lerret/` tree verbatim — sample
// assets in `social/`, brand fonts in `_fonts/`, and `config.json` with
// preset brand variables. Also emits all four AI-tool surfaces (Claude,
// Cursor, Copilot, AGENTS.md) rendered from `ai-content.js`.
//
// --no-samples: creates only `.lerret/config.json` with a minimal root config
// (`{ "vars": {} }`). No `_fonts/`, no `social/` pages, no sample artboards.
// The resulting project opens in the studio showing the calm empty-but-correct
// canvas (zero pages, zero assets — valid state). AI-tool surfaces still ship
// unless --no-ai-rules is set.
//
// --no-ai-rules: skips every AI-tool surface (no .claude/, no .cursor/, no
// .github/copilot-instructions.md, no AGENTS.md). The scaffolded project
// still works and contains only .lerret/.
//
// --ai-tools=...: comma-separated list of tools to include (valid: claude,
// cursor, copilot, agents). Unknown values produce a clear error.
// Mutually exclusive with --no-ai-rules.
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

import { AI_TOOLS, VALID_AI_TOOL_IDS } from './ai-content.js';

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------
//
// The template lives at `<this-package>/template/`. Inside it:
//   - `.lerret/`  — the sample asset project (always copied unless --no-samples)
//
// The AI-tool surfaces (`.claude/`, `.cursor/`, `.github/copilot-instructions.md`,
// `AGENTS.md`) are NOT shipped as static files in the template. They are
// rendered at scaffold time from `ai-content.js` so the Lerret-authoring
// prose stays single-sourced across all four tools.
//
// Resolving via `import.meta.url` makes the path correct both when running
// from within the workspace (`node packages/create-lerret/src/create-lerret.js`)
// AND when the package is installed as a global npm package (where `__dirname`
// is not available in ESM, but `import.meta.url` always points to this file).

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATE_ROOT = join(PACKAGE_ROOT, 'template');
const TEMPLATE_SRC = join(TEMPLATE_ROOT, '.lerret');

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
// --ai-tools=... parsing
// ---------------------------------------------------------------------------
//
// Comma-separated list of tool ids. Whitespace tolerant, case-insensitive on
// the tool id. Empty tokens are ignored. Unknown values produce an error
// naming the unknown value(s) and listing the valid options.

/**
 * @param {string} raw     The verbatim value of --ai-tools=...
 * @returns {{ ok: true; ids: string[] } | { ok: false; reason: string }}
 */
function parseAiTools(raw) {
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return {
      ok: false,
      reason:
        '--ai-tools requires at least one tool. ' +
        `Valid values: ${VALID_AI_TOOL_IDS.join(', ')}.`,
    };
  }

  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const ids = [];
  for (const tok of tokens) {
    if (VALID_AI_TOOL_IDS.includes(tok)) {
      if (!ids.includes(tok)) ids.push(tok);
    } else {
      unknown.push(tok);
    }
  }

  if (unknown.length > 0) {
    const which = unknown.map((u) => `"${u}"`).join(', ');
    return {
      ok: false,
      reason:
        `--ai-tools: unknown ${unknown.length === 1 ? 'value' : 'values'} ${which}. ` +
        `Valid values: ${VALID_AI_TOOL_IDS.join(', ')}.`,
    };
  }

  return { ok: true, ids };
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
      '  create-lerret <name>                       Create a project with sample assets (default)',
      '  create-lerret <name> --no-samples          Scaffold a minimal empty project',
      '  create-lerret <name> --no-ai-rules         Skip every AI-tool integration file',
      '  create-lerret <name> --ai-tools=<list>     Scope AI-tool surfaces to a comma-separated list',
      '',
      'Arguments:',
      '  name             Directory name for the new project (letters, digits, . - _)',
      '',
      'Options:',
      '  --no-samples     Create only .lerret/config.json — no sample assets or fonts',
      '  --no-ai-rules    Skip all AI-tool integration files (.claude/, .cursor/, .github/, AGENTS.md)',
      '  --ai-tools=...   Comma-separated list of AI tools to include',
      `                   (valid: ${VALID_AI_TOOL_IDS.join(', ')}; default: all)`,
      '                   Mutually exclusive with --no-ai-rules.',
      '  --help, -h       Show this usage message',
      '',
      'Examples:',
      '  create-lerret my-project',
      '  create-lerret my-project --no-samples',
      '  create-lerret my-project --no-ai-rules',
      '  create-lerret my-project --ai-tools=claude,cursor',
      '  npx create-lerret@latest my-project',
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
 * The filter used by every `fsp.cp` call in this file. Excludes tooling
 * artifacts that may have crept into a template tree and must not reach end
 * users.
 *
 * @param {string} src  The source path candidate (passed by `fsp.cp`).
 * @returns {boolean}   `true` to include, `false` to skip.
 */
function templateCopyFilter(src) {
  const base = src.split(/[\\/]/).pop() ?? '';
  return base !== '.DS_Store' && base !== 'node_modules' && base !== '.git';
}

/**
 * Emit every AI-tool surface from the selected tools list. Each surface's
 * content is rendered by the corresponding `render()` in `ai-content.js`.
 *
 * Files are written under `destDir` at the path declared by the tool's entry
 * in `AI_TOOLS`. Parent directories are created as needed.
 *
 * @param {string} destDir       Absolute path to the new project root.
 * @param {string[]} selectedIds Tool ids to emit (subset of VALID_AI_TOOL_IDS).
 * @returns {Promise<string[]>}  Sorted list of relative file paths actually written.
 */
async function emitAiTools(destDir, selectedIds) {
  /** @type {string[]} */
  const written = [];
  for (const tool of AI_TOOLS) {
    if (!selectedIds.includes(tool.id)) continue;
    for (const file of tool.files) {
      const targetPath = join(destDir, file.path);
      await fsp.mkdir(dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, file.render(), 'utf8');
      written.push(file.path);
    }
  }
  return written.sort();
}

/**
 * Copy the template `.lerret/` directory into `<destDir>/.lerret/`. Then,
 * if any AI tools are selected, render and emit their files.
 *
 * The copy uses `templateCopyFilter` (drops `.DS_Store`, `node_modules`,
 * `.git`).
 *
 * On mid-scaffold failure the destination directory (or, when it existed as
 * an empty dir, only the trees we wrote) is removed so no partial project
 * is left behind.
 *
 * @param {string} templateLerretSrc  Absolute path to the template's `.lerret/` dir.
 * @param {string} destDir            Absolute path to the new project root.
 * @param {boolean} destExisted       Whether `destDir` was already present before we
 *   started (true = empty-dir case; false = we created it). When cleanup is
 *   needed we only remove `destDir` if we created it; if it already existed as
 *   an empty dir we remove only the trees we wrote so we leave the user's dir
 *   intact.
 * @param {string[]} selectedAiTools  Tool ids to emit (empty array = no AI files).
 * @returns {Promise<string[]>}       Sorted list of AI-tool file paths written.
 */
async function copyTemplate(templateLerretSrc, destDir, destExisted, selectedAiTools) {
  const destLerret = join(destDir, '.lerret');
  await fsp.mkdir(destDir, { recursive: true });
  /** @type {string[]} */
  let aiFilesWritten = [];
  try {
    await fsp.cp(templateLerretSrc, destLerret, {
      recursive: true,
      filter: templateCopyFilter,
    });

    aiFilesWritten = await emitAiTools(destDir, selectedAiTools);
  } catch (err) {
    // Mid-scaffold failure: clean up whatever was partially written.
    if (destExisted) {
      // Dir existed before us (empty-dir case) — remove only what we wrote.
      await fsp.rm(destLerret, { recursive: true, force: true });
      for (const subdir of ['.claude', '.cursor', '.github']) {
        await fsp.rm(join(destDir, subdir), { recursive: true, force: true });
      }
      await fsp.rm(join(destDir, 'AGENTS.md'), { force: true });
    } else {
      // We created destDir — remove the whole thing.
      await fsp.rm(destDir, { recursive: true, force: true });
    }
    throw err;
  }
  return aiFilesWritten;
}

/**
 * Scaffold a minimal empty Lerret project — `.lerret/config.json`. If any
 * AI tools are selected, also render and emit their files.
 *
 * The config contains an empty `vars` map so the loader's schema is satisfied
 * without any pre-set values. No `_fonts/`, no `social/` pages, no sample
 * artboards. When opened in the studio the canvas shows the calm empty state
 * (zero pages, zero assets).
 *
 * An empty project benefits the most from AI guidance — you have nothing to
 * copy from yet — so the AI-tool surfaces ship in minimal scaffolds too
 * unless --no-ai-rules / --ai-tools=... filters them out.
 *
 * The config file is written as `JSON.stringify(value, null, 2) + '\n'` —
 * stable, human-readable, trailing newline — with no external serialiser
 * dependency.
 *
 * On mid-write failure the destination directory is cleaned up.
 *
 * @param {string} destDir            Absolute path to the new project root (`<name>/`).
 * @param {boolean} destExisted       Whether `destDir` already existed before we started.
 * @param {string[]} selectedAiTools  Tool ids to emit (empty array = no AI files).
 * @returns {Promise<string[]>}       Sorted list of AI-tool file paths written.
 */
async function scaffoldMinimal(destDir, destExisted, selectedAiTools) {
  const destLerret = join(destDir, '.lerret');
  await fsp.mkdir(destLerret, { recursive: true });

  /** @type {{ vars: Record<string, string> }} */
  const minimalConfig = { vars: {} };
  const configJson = JSON.stringify(minimalConfig, null, 2) + '\n';
  /** @type {string[]} */
  let aiFilesWritten = [];
  try {
    await fsp.writeFile(join(destLerret, 'config.json'), configJson, 'utf8');
    aiFilesWritten = await emitAiTools(destDir, selectedAiTools);
  } catch (err) {
    // Mid-write failure: clean up whatever was partially written.
    if (destExisted) {
      await fsp.rm(destLerret, { recursive: true, force: true });
      for (const subdir of ['.claude', '.cursor', '.github']) {
        await fsp.rm(join(destDir, subdir), { recursive: true, force: true });
      }
      await fsp.rm(join(destDir, 'AGENTS.md'), { force: true });
    } else {
      await fsp.rm(destDir, { recursive: true, force: true });
    }
    throw err;
  }
  return aiFilesWritten;
}

// ---------------------------------------------------------------------------
// Disclosure summary
// ---------------------------------------------------------------------------
//
// Post-scaffold message enumerates every AI-tool file written so the user
// knows exactly what reached their workspace. Explicit disclosure, no silent
// writes (FR / Story 6.11).

/**
 * @param {string} name                 Project name (for the next-step cd).
 * @param {string} headline             First line of the success message.
 * @param {string[]} aiFilesWritten     Relative paths of every AI-tool file written.
 * @param {boolean} noAiRules           True when --no-ai-rules was set.
 * @returns {string}                    The full success message (ends with '\n').
 */
function formatSuccess(name, headline, aiFilesWritten, noAiRules) {
  /** @type {string[]} */
  const lines = [];
  lines.push(headline);
  lines.push('');

  if (noAiRules) {
    lines.push('(no AI-tool files created — --no-ai-rules was set)');
    lines.push('');
  } else if (aiFilesWritten.length > 0) {
    lines.push('AI-tool integrations created:');
    for (const rel of aiFilesWritten) {
      lines.push(`  ${rel}`);
    }
    lines.push('');
  } else {
    // --ai-tools=... that filtered to nothing (e.g. an empty subset after
    // future-flag changes) — shouldn't happen in practice but kept defensive.
    lines.push('(no AI-tool files created)');
    lines.push('');
  }

  lines.push('Next:');
  lines.push(`  cd ${name}`);
  lines.push('  npx @lerret/cli@latest dev');
  lines.push('');

  return lines.join('\n');
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
  // Reject repeat use of --ai-tools BEFORE parseArgs. `parseArgs` with a
  // string-typed option silently keeps only the last value, so
  // `--ai-tools=claude --ai-tools=cursor` would otherwise resolve to just
  // `cursor` with no warning. Count both `--ai-tools=value` and
  // `--ai-tools value` forms.
  const aiToolsOccurrences = argv.filter(
    (a) => a === '--ai-tools' || a.startsWith('--ai-tools='),
  ).length;
  if (aiToolsOccurrences > 1) {
    process.stderr.write(
      'create-lerret: --ai-tools was passed multiple times; ' +
        'pass a single comma-separated list instead.\n',
    );
    return 1;
  }

  // Parse flags first (order-independent relative to the positional).
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        'no-samples': { type: 'boolean', default: false },
        'no-ai-rules': { type: 'boolean', default: false },
        'ai-tools': { type: 'string' },
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
  const noAiRules = values['no-ai-rules'] === true;
  const aiToolsRaw = values['ai-tools'];

  // --no-ai-rules and --ai-tools=... are mutually exclusive.
  if (noAiRules && typeof aiToolsRaw === 'string') {
    process.stderr.write(
      'create-lerret: --no-ai-rules and --ai-tools cannot be used together. ' +
        'Pick one: --no-ai-rules to skip every AI-tool file, or --ai-tools=... to scope which tools ship.\n',
    );
    return 1;
  }

  /** @type {string[]} */
  let selectedAiTools;
  if (noAiRules) {
    selectedAiTools = [];
  } else if (typeof aiToolsRaw === 'string') {
    const parsed = parseAiTools(aiToolsRaw);
    if (!parsed.ok) {
      process.stderr.write(`create-lerret: ${parsed.reason}\n`);
      return 1;
    }
    selectedAiTools = parsed.ids;
  } else {
    selectedAiTools = [...VALID_AI_TOOL_IDS];
  }

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
    // Minimal-project path: write `.lerret/config.json` and emit selected
    // AI-tool surfaces.
    /** @type {string[]} */
    let aiFilesWritten = [];
    try {
      aiFilesWritten = await scaffoldMinimal(destDir, destExisted, selectedAiTools);
    } catch (err) {
      process.stderr.write(
        `create-lerret: failed to scaffold "${name}": ` +
          `${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }

    process.stdout.write(
      formatSuccess(
        name,
        `✓ Created ${name}/.lerret/ — empty project, ready for your first asset.`,
        aiFilesWritten,
        noAiRules,
      ),
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

  /** @type {string[]} */
  let aiFilesWritten = [];
  try {
    aiFilesWritten = await copyTemplate(TEMPLATE_SRC, destDir, destExisted, selectedAiTools);
  } catch (err) {
    process.stderr.write(
      `create-lerret: failed to scaffold "${name}": ` +
        `${err && err.message ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stdout.write(
    formatSuccess(
      name,
      `✓ Created ${name}/.lerret/ with sample assets.`,
      aiFilesWritten,
      noAiRules,
    ),
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
