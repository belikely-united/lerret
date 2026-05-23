// `@lerret/cli export` — headless capture of a project's artboards to image files
// (FR37, FR38).
//
// Renders every artboard in scope through the EXACT same `captureArtboard`
// path the studio uses, so a `@lerret/cli export` run produces a
// pixel-faithful match to what the same project produces from a click in the
// in-studio export buttons. The mechanism is:
//
//   1. Resolve the project — either from the optional `[path]` positional, or
//      by walking up `.lerret/` from the caller's CWD.
//      If `[path]` points at a page or group folder inside `.lerret/`, that
//      becomes the export scope; if it points at the project root, the whole
//      project is the scope.
//   2. Load the project model (`scan()` via the Node `FilesystemAccess`
//      backend), then call `collectArtboards(model, scope)` to
//      pick which artboards to capture.
//   3. Boot a Vite dev server programmatically against the studio source plus
//      the same `vite-plugin-lerret-project` `@lerret/cli dev` uses — exactly the
//      runtime that serves the studio so the project is mounted there.
//   4. Launch a headless Chromium through Playwright. Prefer the system
//      `chrome`/`msedge` channel so `npx`-style invocations stay light; fall
//      back to a bundled `playwright` browser if it has been installed; print
//      a clear, actionable message if neither is available.
//   5. Navigate to the studio URL, wait for the first artboard slot to
//      appear, then for each artboard call `captureArtboard` INSIDE the page
//      via `page.evaluate` (the same module the studio bundles). Each blob is
//      transferred back to Node as a Uint8Array and written to disk under
//      `--out` using either the structured (default) or `--flat` layout.
//
// FR39 adds two override flags:
//   --data <path>    JSON or .js file; overrides the data tier (tier 1) in
//                    `resolveProps` for each artboard in this run.
//   --config <path>  JSON or .js file; is deep-merged into the cascade
//                    (using `computeCascadedConfig` semantics) so every
//                    folder's effective config is overridden for this run.
//
//   Both override paths are resolved relative to the caller's CWD. They are
//   loaded BEFORE the Vite server starts; any missing-file or parse error
//   aborts the run immediately (exit 1) so the user gets clear feedback before
//   spending time booting Chromium.
//
//   Neither override is ever written back to the user's `.lerret/` (NFR13).
//   The loaded values flow into `lerretProjectPlugin` as in-memory constructor
//   options; the plugin exposes them via the `virtual:lerret-project` module's
//   `overrides` export so the studio runtime can apply them during rendering.
//
// Output:
//   Structured (default): `<out>/<page>[/<group>[/…]]/<asset.name>[-<variant>].<ext>`
//   Flat (`--flat`):      `<out>/<asset.name>[-<variant>].<ext>` (collisions
//                         disambiguated by joining locationSegments with `-`).
//
// Exit code policy:
//   0 — every selected artboard was captured and written (a per-artboard
//       failure that the run continued past is logged and still 0; the run
//       did not abort).
//   1 — fatal: no project resolved, no artboards in scope, output dir could
//       not be created, Vite failed to start, or no Chromium could be launched.
//       Also 1 when a --data / --config file is missing or unparseable.
//
// Failure isolation: an individual artboard capture failure is reported but
// does NOT abort the run; remaining artboards still write. Unembedded fonts
// across all captures are aggregated and named in the final summary.
//
// Separation invariant (NFR13): the CLI never writes into the user's
// `.lerret/`. All output lands under `--out`, which defaults to a fresh
// `./lerret-export` directory relative to the CWD. Override values supplied
// via --data / --config are kept entirely in memory for the duration of the
// run and are discarded on exit.

import { parseArgs } from 'node:util';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import {
  scan,
  collectArtboards,
  computeCascadedConfig,
  partitionByExclusion,
  excludedFolderPaths,
} from '@lerret/core';

import {
  createNodeBackend,
  ensureDir,
  pathExists,
  realpathOfExistingPrefix,
  realpathOrSelf,
  readTextFile,
} from './fs/node-backend.js';
import { resolveProject } from './resolve-project.js';
import { resolveStudioRoot } from './dev.js';
import { lerretProjectPlugin } from './vite-plugin-lerret-project.js';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The argv shape `parseArgs` produces for `@lerret/cli export`.
 *
 * @typedef {object} ExportFlags
 * @property {string | undefined} pathArg
 *   The optional positional argument — a project root, or a page/group folder
 *   inside `.lerret/`. `undefined` means "walk up from CWD".
 * @property {'png' | 'jpg'} format
 *   Output image format. Defaults to `'png'`.
 * @property {string} out
 *   Output directory. Defaults to `./lerret-export` relative to CWD.
 * @property {boolean} flat
 *   When true, all images are written directly into `out` with collision
 *   disambiguation. When false (default), `out` receives nested folders
 *   mirroring the project's page/group hierarchy.
 * @property {string | undefined} data
 *   Path to a JSON or .js file whose contents override the data tier (tier 1)
 *   of `resolveProps` for every artboard in this run (FR39).
 *   Resolved relative to CWD. `undefined` → no data override.
 * @property {string | undefined} config
 *   Path to a JSON or .js file whose contents are deep-merged into the
 *   cascaded config for every folder in this run (FR39).
 *   Resolved relative to CWD. `undefined` → no config override.
 * @property {boolean} help
 */

/**
 * Loaded override pair — the result of calling `loadOverrideFiles`.
 *
 * @typedef {object} OverrideFiles
 * @property {Record<string, unknown> | undefined} dataOverride
 *   The parsed data override object, or `undefined` when `--data` was not
 *   supplied.
 * @property {Record<string, unknown> | undefined} configOverride
 *   The parsed config override object, or `undefined` when `--config` was not
 *   supplied.
 */

/**
 * @typedef {object} ScopeResolution
 * @property {boolean} found
 *   True when both project root AND scope path resolve to a node in the model.
 * @property {string} [projectRoot]  Absolute, forward-slash project root path.
 * @property {string} [lerretDir]    Absolute, forward-slash `.lerret/` path.
 * @property {string | null} [scopePath]
 *   The `LerretPath` to pass to `collectArtboards` — `null` for "whole project",
 *   or a page/group path. Only meaningful when `found === true`.
 * @property {'project' | 'page' | 'group'} [scopeKind]
 *   How the scope was classified. Useful for the start-of-run log.
 * @property {object} [model]
 *   The scanned project model — populated on `found === true` so the caller
 *   does not have to scan twice. Untyped here (it is `ProjectNode` from
 *   `@lerret/core`) to keep this CLI module's JSDoc imports minimal.
 * @property {string} [error]
 *   Human-readable failure reason when `found === false`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default output directory (created relative to CWD) when `--out` is omitted.
 * Chosen to be obvious, non-magical, and clearly distinct from any project-
 * internal folder — the CLI never writes inside `.lerret/` (NFR13).
 *
 * @type {string}
 */
export const DEFAULT_OUT_DIR = './lerret-export';

/**
 * Default image format when `--format` is omitted. Matches the studio's per-
 * artboard PNG button and the bulk-export panel default.
 *
 * @type {'png'}
 */
export const DEFAULT_FORMAT = 'png';

/**
 * Selectors used to find an artboard in the rendered studio. The canvas
 * marks each artboard slot with `data-dc-slot="<id>"` where `<id>` is the
 * asset path (primary export) or `<asset.path>#<variantName>` (variant). The
 * inner `.dc-card` is the actual element `captureArtboard` rasterizes — the
 * same DOM node the studio's per-artboard PNG button uses.
 *
 * @type {{ slotByDataAttr: (id: string) => string, innerCardSelector: string }}
 */
export const ARTBOARD_SELECTORS = {
  slotByDataAttr: (id) =>
    `[data-dc-slot=${JSON.stringify(id)}]`,
  innerCardSelector: '.dc-card',
};

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print `@lerret/cli export`'s usage banner.
 *
 * @returns {void}
 */
function printUsage() {
  const lines = [
    '@lerret/cli export — render a project (or page/group) headlessly to image files.',
    '',
    'Usage: @lerret/cli export [path] [options]',
    '',
    'Arguments:',
    '  path             Project root, or a page/group folder inside `.lerret/`.',
    '                   Omitted: walk up from CWD to find the nearest project.',
    '',
    'Options:',
    `  --format <fmt>   Image format — png (default) or jpg.`,
    `  --out <dir>      Output directory (default: ${DEFAULT_OUT_DIR}).`,
    '  --flat           Write all images directly under --out; default is',
    '                   nested folders mirroring page/group hierarchy.',
    '  --data <path>    JSON or .js file whose contents override the data tier',
    '                   (tier 1) for every artboard in this run. Resolved',
    '                   relative to CWD. Missing / invalid file → exit 1.',
    '  --config <path>  JSON or .js file deep-merged into the cascaded config',
    '                   for this run. Resolved relative',
    '                   to CWD. Missing / invalid file → exit 1.',
    '  -h, --help       Show this help.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Parse `@lerret/cli export`'s argv. A separate function so tests can verify flag
 * handling without booting Vite or Playwright.
 *
 * @param {string[]} argv  Argv slice after the `export` subcommand.
 * @returns {{ flags: ExportFlags | null, error: string | null }}
 *   `error` is set when parsing fails — the caller prints it and the usage
 *   banner. On success the caller acts on `flags`.
 */
export function parseExportArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        format: { type: 'string' },
        out: { type: 'string' },
        flat: { type: 'boolean' },
        data: { type: 'string' },
        config: { type: 'string' },
        // Animated-export flags (Story 7.8) — only meaningful when --format is
        // one of webp|gif|apng|mp4. Ignored for static formats.
        duration: { type: 'string' },
        fps: { type: 'string' },
        scale: { type: 'string' },
        loop: { type: 'string' },
        capture: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      // Reject unknown flags — surface a typo as a usage error rather than
      // silently ignoring it.
      strict: true,
      // The optional `[path]` is the only allowed positional.
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

  // Only zero or one positional argument is accepted. The first is the
  // `[path]`; anything beyond it is a usage error.
  if (positionals.length > 1) {
    return {
      flags: null,
      error: `unexpected extra arguments: ${positionals.slice(1).join(' ')}`,
    };
  }

  // Format: defaults to 'png'. `jpeg` is accepted as an alias for `jpg` for
  // parity with `resolveFormat` used by the studio; both normalize to the
  // 'jpg' string here so downstream code is straightforward. Animated formats
  // (gif, webp, apng, mp4) route to the animated-export pipeline.
  const ANIMATED_FORMATS = new Set(['gif', 'webp', 'apng', 'mp4']);
  let format = DEFAULT_FORMAT;
  if (typeof values.format === 'string') {
    const f = values.format.toLowerCase();
    if (f === 'png') {
      format = 'png';
    } else if (f === 'jpg' || f === 'jpeg') {
      format = 'jpg';
    } else if (ANIMATED_FORMATS.has(f)) {
      format = f;
    } else {
      return {
        flags: null,
        error: `--format: unsupported value "${values.format}" (expected png, jpg, gif, webp, apng, or mp4)`,
      };
    }
  }

  const isAnimated = ANIMATED_FORMATS.has(format);

  // Parse animated-export flags. They're all optional and only meaningful for
  // animated formats. A static-format export with these flags set surfaces a
  // clear warning later (we don't error so existing scripts don't break).
  let durationMs = 3000;
  if (typeof values.duration === 'string') {
    const m = values.duration.match(/^(\d+(?:\.\d+)?)(?:\s*s)?$/);
    if (!m) {
      return {
        flags: null,
        error: `--duration: invalid value "${values.duration}" (expected e.g. "3s" or "3000")`,
      };
    }
    const num = Number(m[1]);
    // If suffix was "s" OR the number is small (< 100), treat as seconds.
    durationMs = values.duration.includes('s') || num < 100 ? num * 1000 : num;
    if (durationMs < 100 || durationMs > 10000) {
      return {
        flags: null,
        error: `--duration: out of range — must be between 0.1s and 10s, got ${durationMs}ms`,
      };
    }
  }

  let fps = 24;
  if (typeof values.fps === 'string') {
    const n = Number(values.fps);
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      return {
        flags: null,
        error: `--fps: invalid value "${values.fps}" (expected 1–60)`,
      };
    }
    fps = Math.round(n);
  }

  let scale = 1;
  if (typeof values.scale === 'string') {
    const m = values.scale.match(/^(\d+)x?$/);
    if (!m) {
      return {
        flags: null,
        error: `--scale: invalid value "${values.scale}" (expected 1x, 2x, or 3x)`,
      };
    }
    const n = Number(m[1]);
    if (n < 1 || n > 3) {
      return {
        flags: null,
        error: `--scale: out of range "${values.scale}" (expected 1x, 2x, or 3x)`,
      };
    }
    scale = n;
  }

  let loop = 'infinite';
  if (typeof values.loop === 'string') {
    if (values.loop === '∞' || values.loop === 'infinite') loop = 'infinite';
    else if (values.loop === 'once') loop = 'once';
    else if (/^\d+$/.test(values.loop)) loop = Number(values.loop);
    else {
      return {
        flags: null,
        error: `--loop: invalid value "${values.loop}" (expected ∞, infinite, once, or a positive integer)`,
      };
    }
  }

  let captureMode = 'cycle';
  if (typeof values.capture === 'string') {
    if (values.capture === 'cycle' || values.capture === 'now') captureMode = values.capture;
    else {
      return {
        flags: null,
        error: `--capture: invalid value "${values.capture}" (expected "cycle" or "now")`,
      };
    }
  }

  const out = typeof values.out === 'string' ? values.out : DEFAULT_OUT_DIR;
  const flat = values.flat === true;
  const pathArg = positionals.length === 1 ? positionals[0] : undefined;
  const data = typeof values.data === 'string' ? values.data : undefined;
  const config = typeof values.config === 'string' ? values.config : undefined;

  return {
    flags: {
      pathArg,
      format,
      isAnimated,
      out,
      flat,
      data,
      config,
      // Animated-only flags — present always so the runner doesn't have to
      // null-check, but only honored when `isAnimated` is true.
      durationMs,
      fps,
      scale,
      loop,
      captureMode,
      help: !!values.help,
    },
    error: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize an OS path to the forward-slash form `core` and the
 * `FilesystemAccess` contract use. Pure helper — no fs access.
 *
 * @param {string} osPath
 * @returns {string}
 */
function toLerretPath(osPath) {
  return osPath.replaceAll('\\', '/');
}

/**
 * Locate the page or group node within the loaded model whose `path` equals
 * `target`. Walks the tree depth-first and returns the matching node + its
 * kind (`'page'` or `'group'`), or null when no match is found.
 *
 * Exposed for tests so they can verify the project/page/group classification
 * without booting the rest of the export pipeline.
 *
 * @param {object} model           A scanned project model (`ProjectNode`).
 * @param {string} target          The `LerretPath` to look up.
 * @returns {{ kind: 'page' | 'group' } | null}
 */
export function findModelNode(model, target) {
  if (!model || typeof target !== 'string') return null;
  for (const page of model.pages || []) {
    if (page.path === target) return { kind: 'page' };
    const groupHit = findGroupRecursive(page.groups || [], target);
    if (groupHit) return groupHit;
  }
  return null;
}

/**
 * Recursive helper for {@link findModelNode}.
 *
 * @param {Array<object>} groups
 * @param {string} target
 * @returns {{ kind: 'group' } | null}
 */
function findGroupRecursive(groups, target) {
  for (const group of groups) {
    if (group.path === target) return { kind: 'group' };
    const hit = findGroupRecursive(group.groups || [], target);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve the project, the scope path within it, and the kind of that scope.
 *
 * The PRD's path-argument flow:
 *   - `pathArg` omitted → walk up from `cwd`.
 *   - `pathArg` is a project root (directly contains `.lerret/`) → scope =
 *     whole project (`scopePath = null`).
 *   - `pathArg` is inside an ancestor's `.lerret/` → scope = page or group at
 *     that path. The project root is the nearest ancestor with `.lerret/`.
 *
 * Returns a tagged-union-like result `{ found, ... }` so the caller can branch
 * cleanly. Tests inject a stub `fs` backend to keep this offline.
 *
 * @param {object} opts
 * @param {string | undefined} opts.pathArg
 * @param {string} opts.cwd
 *   The working directory used as the walk-up starting point when `pathArg` is
 *   omitted. Always an absolute, native-separator path.
 * @param {import('@lerret/core').FilesystemAccess} [opts.fs]
 *   The filesystem backend to read through. Defaults to a fresh Node backend.
 * @returns {Promise<ScopeResolution>}
 */
export async function resolveScope({ pathArg, cwd, fs = createNodeBackend() }) {
  // Step 1: figure out the start dir for project detection.
  //
  // When pathArg is given we resolve it to an absolute path and start the
  // walk-up there. The walk-up call still does the right thing whether the
  // user passed a project root or a sub-folder — `resolveProject` finds the
  // nearest ancestor that owns `.lerret/`.
  const absoluteStart = pathArg
    ? toLerretPath(resolvePath(cwd, pathArg))
    : toLerretPath(resolvePath(cwd));

  const projectResolution = await resolveProject(absoluteStart, fs);
  if (!projectResolution.found) {
    return {
      found: false,
      error:
        `no \`.lerret/\` project found from ${absoluteStart} — ` +
        'pass a project path or run from inside a project directory',
    };
  }

  // Canonicalize both ends so the path-arg comparisons below work even when
  // the user supplied a symlinked path (the classic macOS `/tmp` →
  // `/private/tmp` gotcha that `@lerret/cli dev` also has to handle).
  const projectRoot = toLerretPath(realpathOrSelf(projectResolution.projectRoot));
  const lerretDir = toLerretPath(realpathOrSelf(projectResolution.lerretDir));

  // Step 2: load the project model so we can classify pathArg against the
  // tree. A `scan` failure is fatal — without a model we cannot collect any
  // artboards. We `scan` from the canonicalized `lerretDir` so the model's
  // node paths are canonical too — they then compare equal to the canonical
  // pathArg below regardless of which symlink hop the caller used.
  let model;
  try {
    model = await scan(fs, lerretDir);
  } catch (err) {
    return {
      found: false,
      projectRoot,
      lerretDir,
      error: `project scan failed: ${err && err.message ? err.message : String(err)}`,
    };
  }

  // Step 3: classify the scope.
  //
  // When no pathArg was given, OR the pathArg equals the project root /
  // `.lerret/`, the scope is the whole project. Otherwise the absolute
  // pathArg must match a page or group path inside the model. We do an
  // exact-string match (after realpath-resolving so symlinks-in-paths don't
  // foil the lookup), keeping the rule simple and easy to predict.
  if (!pathArg) {
    return {
      found: true,
      projectRoot,
      lerretDir,
      scopePath: null,
      scopeKind: 'project',
      model,
    };
  }

  const pathArgAbs = toLerretPath(realpathOrSelf(resolvePath(cwd, pathArg)));

  // Project root or `.lerret/` itself — whole project.
  if (pathArgAbs === projectRoot || pathArgAbs === lerretDir) {
    return {
      found: true,
      projectRoot,
      lerretDir,
      scopePath: null,
      scopeKind: 'project',
      model,
    };
  }

  // Anywhere outside `.lerret/` cannot be a page or group.
  if (!pathArgAbs.startsWith(lerretDir + '/')) {
    return {
      found: false,
      projectRoot,
      lerretDir,
      error:
        `path "${pathArg}" is not the project root nor inside ` +
        `\`.lerret/\` — only project / page / group folders are valid scopes`,
    };
  }

  // Must match a page or group node in the loaded model.
  const hit = findModelNode(model, pathArgAbs);
  if (!hit) {
    return {
      found: false,
      projectRoot,
      lerretDir,
      error:
        `path "${pathArg}" does not match any page or group in the project ` +
        'model — verify the folder is a known page / group (folders that ' +
        'begin with `_` are excluded)',
    };
  }

  return {
    found: true,
    projectRoot,
    lerretDir,
    scopePath: pathArgAbs,
    scopeKind: hit.kind,
    model,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Override-file loading (FR39)
// ─────────────────────────────────────────────────────────────────────────────
//
// Both --data and --config accept either a JSON file (loaded via `readFile` +
// `JSON.parse`) or a `.js` / `.mjs` file (loaded via `dynamic import()` with
// `file://` URL, default export consumed). The file path is always resolved
// relative to the caller's CWD before loading.
//
// Any failure (file not found, invalid JSON, non-object default export, …) is
// returned as `{ ok: false, error }` so the caller can emit a clear message
// and exit 1 BEFORE starting Vite or Playwright (fail fast, fail cheap).
//
// Neither loaded value is ever written anywhere — both are kept in memory for
// the duration of the run and discarded on process exit (NFR13).

/**
 * Load a single override file (JSON or .js) and return its parsed value.
 *
 * @param {string} filePath  Absolute path to the override file.
 * @returns {Promise<{ ok: true, value: Record<string, unknown> } | { ok: false, error: string }>}
 */
export async function loadOverrideFile(filePath) {
  const isJs =
    filePath.endsWith('.js') ||
    filePath.endsWith('.mjs') ||
    filePath.endsWith('.cjs');

  if (isJs) {
    // Dynamic import via a file:// URL so Node resolves the path correctly
    // regardless of CWD and the import doesn't cache-bust the entire module graph.
    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: `could not import override file "${filePath}": ${cause}`,
      };
    }
    // Expect the default export to be a plain object.
    const value = mod && mod.default !== undefined ? mod.default : mod;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return {
        ok: false,
        error:
          `override file "${filePath}": default export must be a plain object ` +
          `(got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value})`,
      };
    }
    return { ok: true, value: /** @type {Record<string, unknown>} */ (value) };
  }

  // JSON path — readTextFile then JSON.parse.
  let raw;
  try {
    raw = await readTextFile(filePath);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `override file "${filePath}" not found or unreadable: ${cause}`,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `override file "${filePath}" contains invalid JSON: ${cause}`,
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error:
        `override file "${filePath}": top-level JSON value must be a plain object ` +
        `(got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed})`,
    };
  }

  return { ok: true, value: /** @type {Record<string, unknown>} */ (parsed) };
}

/**
 * Load the `--data` and `--config` override files (if supplied), resolving
 * their paths relative to `cwd`. Returns the loaded values, or `{ ok: false }`
 * with an actionable error on the first failure so the caller can emit it and
 * exit 1 before booting Vite.
 *
 * @param {object} opts
 * @param {string | undefined} opts.dataPath  Raw `--data` flag value (or undefined).
 * @param {string | undefined} opts.configPath  Raw `--config` flag value (or undefined).
 * @param {string} opts.cwd  Caller's working directory (for path resolution).
 * @returns {Promise<
 *   { ok: true, overrides: OverrideFiles } |
 *   { ok: false, error: string }
 * >}
 */
export async function loadOverrideFiles({ dataPath, configPath, cwd }) {
  /** @type {Record<string, unknown> | undefined} */
  let dataOverride;
  /** @type {Record<string, unknown> | undefined} */
  let configOverride;

  if (dataPath !== undefined) {
    const absPath = resolvePath(cwd, dataPath);
    const result = await loadOverrideFile(absPath);
    if (!result.ok) return { ok: false, error: result.error };
    dataOverride = result.value;
  }

  if (configPath !== undefined) {
    const absPath = resolvePath(cwd, configPath);
    const result = await loadOverrideFile(absPath);
    if (!result.ok) return { ok: false, error: result.error };
    configOverride = result.value;
  }

  return { ok: true, overrides: { dataOverride, configOverride } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output path naming
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip characters that are illegal in common OS file systems and collapse
 * internal whitespace. Mirrors the `safeName` used by the studio's single-
 * export filename builder so the CLI's filenames are predictable
 * even when an asset name contains odd characters.
 *
 * @param {string} text
 * @returns {string}
 */
function safeName(text) {
  return (
    (text || 'artboard')
      .toString()
      .replace(/[\\/:*?"<>|\x00-\x1F]+/g, '') // eslint-disable-line no-control-regex
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'artboard'
  );
}

/**
 * Build a base filename from one artboard record (asset name + optional
 * variant + extension). Matches the bulk-export naming convention from
 * `studio/export/zip.js`: `<asset.name>[-<variant>].<ext>`.
 *
 * @param {object} artboard            An `Artboard` from `collectArtboards`,
 *                                     optionally enriched with a `variantName`.
 * @param {{ name: string }} artboard.asset
 * @param {string} [artboard.variantName]
 * @param {string} extension           e.g. `'png'`.
 * @returns {string}                   e.g. `'HeroBanner.png'` or `'BadgeVariants-Ghost.png'`.
 */
export function buildBaseFilename(artboard, extension) {
  const base = safeName(artboard.asset.name);
  const variant = artboard.variantName;
  const stem = variant && variant !== 'default' ? `${base}-${safeName(variant)}` : base;
  return `${stem}.${extension}`;
}

/**
 * Compute the on-disk output path for one artboard.
 *
 * Structured (default): `<outDir>/<page>[/<group>[/…]]/<filename>` per the PRD —
 * the page name (derived from `artboard.pagePath`) is always present, so that
 * a project with `landing/heroes/Card1.jsx` and `social/Banner.jsx` writes to
 * `out/landing/heroes/Card1.png` and `out/social/Banner.png` (and assets named
 * the same in different pages cannot collide).
 *
 * Flat: `<outDir>/[<segments-joined-by---if-collision>]<filename>` — flat mode
 * never used the page prefix; we leave it as-is so existing `--flat` users see
 * no path change.
 *
 * For flat layout, collision disambiguation needs to know whether OTHER items
 * in the same run would produce the same base filename. The caller supplies
 * `nameCount` — the number of items in the run sharing this base filename —
 * so this function stays pure.
 *
 * @param {object} args
 * @param {string} args.outDir
 *   Output root, absolute and using forward slashes.
 * @param {object} args.artboard
 * @param {string[]} args.artboard.locationSegments
 *   Group chain — `[]` for an asset directly in a page. The page level is
 *   derived separately from `artboard.pagePath`, not carried here (the studio's
 *   ZIP exporter shares this field and intentionally omits the page prefix —
 *   see packages/studio/src/export/zip.js).
 * @param {string} [args.artboard.pagePath]
 *   Full LerretPath of the containing page. The basename becomes the top-level
 *   folder in structured mode. When absent (older callers / hand-crafted
 *   artboards in tests), the page level is omitted gracefully.
 * @param {string} args.filename
 *   The base filename, already extension-suffixed.
 * @param {boolean} args.flat
 * @param {number} [args.nameCount=1]
 *   How many items in the current export run share `filename`. Only meaningful
 *   when `flat === true`. When `> 1`, the locationSegments are joined with `-`
 *   and prepended to disambiguate.
 * @returns {string}  The full output file path.
 */
export function buildOutputPath({ outDir, artboard, filename, flat, nameCount = 1 }) {
  const segments = Array.isArray(artboard.locationSegments)
    ? artboard.locationSegments
    : [];

  if (flat) {
    if (nameCount > 1 && segments.length > 0) {
      const prefix = segments.map(safeName).join('-');
      return joinForward(outDir, `${prefix}-${filename}`);
    }
    return joinForward(outDir, filename);
  }

  const pageName = pageNameFromPagePath(artboard.pagePath);
  const structuredSegs = pageName ? [pageName, ...segments] : segments;

  if (structuredSegs.length === 0) {
    return joinForward(outDir, filename);
  }

  const safeSegs = structuredSegs.map(safeName);
  return joinForward(outDir, ...safeSegs, filename);
}

/**
 * Extract the page-folder name from an Artboard's `pagePath`. The path is a
 * forward-slash LerretPath like `/proj/.lerret/landing`; the basename is the
 * page-folder name (`landing`). Returns `null` when the input is missing or
 * unusable so callers can fall back gracefully.
 *
 * @param {unknown} pagePath
 * @returns {string | null}
 */
function pageNameFromPagePath(pagePath) {
  if (typeof pagePath !== 'string' || pagePath.length === 0) return null;
  const trimmed = pagePath.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  const name = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1);
  return name.length > 0 ? name : null;
}

/**
 * Join path segments using forward slashes, regardless of platform. The CLI
 * normalizes every path to the contract's forward-slash form at its boundary
 * so we don't need `node:path.join`'s native-separator behavior here.
 *
 * @param  {...string} parts
 * @returns {string}
 */
function joinForward(...parts) {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter((p) => p.length > 0)
    .join('/');
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant expansion
// ─────────────────────────────────────────────────────────────────────────────
//
// `collectArtboards` returns ONE entry per asset. Each asset's `meta.variants`
// (FR10) lists the named-export variants the asset contributes — including
// `'default'` for the primary export. The CLI must expand the variant list
// into one capture-per-variant so a component with three variants writes
// three image files. We do this expansion server-side (here) and pass the
// per-variant id to the page so the existing studio-side DOM (which renders
// one DCArtboard per variant with `data-dc-slot=<asset.path>#<variantName>`)
// can be selected directly.

/**
 * Expand each `Artboard` from `collectArtboards` into one record per
 * rendered DOM artboard, enriched with the per-variant id used to look up
 * the slot in the page.
 *
 * Resolution rules (mirror the studio's runtime):
 *   - If the asset's parsed `meta.variants` is a non-empty list, emit one
 *     record per variant. The `domId` is `<asset.path>#<variantName>` unless
 *     the variant is the primary `default` AND it is the only variant — in
 *     which case `domId` is the bare `asset.path` (matching `vite-runtime.js`).
 *   - If `meta.variants` is empty or absent, emit ONE record with
 *     `variantName === undefined` and `domId === asset.path`.
 *
 * @param {Array<object>} artboards  `Artboard[]` from `collectArtboards`.
 * @returns {Array<{ artboard: object, variantName: string | undefined, domId: string }>}
 */
export function expandArtboardVariants(artboards) {
  const out = [];
  for (const artboard of artboards) {
    const variants = readAssetVariants(artboard.asset);
    if (variants.length === 0) {
      out.push({ artboard, variantName: undefined, domId: artboard.asset.path });
      continue;
    }
    // Single-default-only is rendered as the primary; the studio's
    // `vite-runtime.js` emits the bare path in that case.
    if (variants.length === 1 && variants[0] === 'default') {
      out.push({ artboard, variantName: undefined, domId: artboard.asset.path });
      continue;
    }
    for (const variantName of variants) {
      const isPrimary = variantName === 'default';
      const domId = isPrimary
        ? artboard.asset.path
        : `${artboard.asset.path}#${variantName}`;
      // Enrich the artboard clone with the variantName so filename derivation
      // produces `<name>-<variant>` for non-primary variants.
      const enriched = { ...artboard, variantName: isPrimary ? undefined : variantName };
      out.push({ artboard: enriched, variantName: isPrimary ? undefined : variantName, domId });
    }
  }
  return out;
}

/**
 * Read the variant list off an asset's parsed `meta`. Falls back to `[]` for
 * any asset whose meta has not been parsed (markdown documents, assets the
 * loader could not statically introspect — those will render a single primary
 * artboard at runtime). Conservative on shape so a future meta tweak does not
 * break the CLI.
 *
 * @param {object} asset
 * @returns {string[]}  An array of variant names (may include `'default'`).
 */
function readAssetVariants(asset) {
  if (!asset || !asset.meta) return [];
  const v = asset.meta.variants;
  if (!Array.isArray(v)) return [];
  return v
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
        return entry.name;
      }
      return null;
    })
    .filter((name) => typeof name === 'string' && name.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Playwright launch — system Chrome first, bundled fallback, clear error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to launch a headless Chromium. Strategy:
 *
 *   1. Try `playwright-core`'s `chromium.launch({ channel: 'chrome' })`. If
 *      the user has Google Chrome / Chromium / Edge installed in a standard
 *      location, this succeeds without downloading anything — keeping `npx
 *      @lerret/cli export` light, per the architecture decision.
 *   2. If the channel launch fails, try `playwright` (the full package,
 *      which ships its bundled browser when installed). Only present when
 *      the user opts in by installing the full `playwright` package.
 *   3. If neither works, throw a clear error explaining BOTH paths the user
 *      can take to make a browser available.
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
    'Could not launch a headless Chromium for the export run.',
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

// ─────────────────────────────────────────────────────────────────────────────
// Vite server boot — programmatic, headless (no browser open)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Boot a Vite dev server programmatically — same plugin / fs.allow shape as
 * `@lerret/cli dev`, but with `server.open = false` and an undefined port (Vite
 * picks a free one). The returned `address` is the URL to navigate to.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.lerretDir
 * @param {Record<string, unknown> | undefined} [opts.dataOverride]
 *   Optional in-memory data override from `--data`. Forwarded to
 *   the plugin so the virtual module exposes it; the studio runtime merges it
 *   at tier 1 of `resolveProps`. Never written to disk (NFR13).
 * @param {Record<string, unknown> | undefined} [opts.configOverride]
 *   Optional in-memory config override from `--config`. Deep-merged
 *   into the cascade server-side by the plugin. Never written to disk (NFR13).
 * @returns {Promise<{ server: import('vite').ViteDevServer, url: string }>}
 */
export async function bootViteServer({ projectRoot, lerretDir, dataOverride, configOverride }) {
  const studioRoot = resolveStudioRoot();
  const vite = await import('vite');
  const { createServer, searchForWorkspaceRoot } = vite;
  const workspaceRoot = searchForWorkspaceRoot(studioRoot);

  // Whether we are serving from the pre-built CLI bundle or from source.
  // When pre-built, skip the React plugin — JSX is already compiled.
  const cliDir = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
  const isPreBuilt = pathExists(resolvePath(cliDir, 'dist-studio', 'index.html')) &&
    studioRoot === resolvePath(cliDir, 'dist-studio');

  const plugins = [
    lerretProjectPlugin({
      projectRoot: toLerretPath(realpathOrSelf(projectRoot)),
      lerretDir: toLerretPath(realpathOrSelf(lerretDir)),
      dataOverride,
      configOverride,
    }),
  ];
  if (!isPreBuilt) {
    const reactPlugin = (await import('@vitejs/plugin-react')).default;
    plugins.unshift(reactPlugin());
  }

  // The user's `.jsx`/`.tsx` assets get transformed by Vite/esbuild into
  // imports of `react/jsx-dev-runtime`. The user's project has no
  // `node_modules`, so those imports must resolve against the CLI's own
  // React. Without these aliases the user's assets fail to load in
  // `dist-studio/` mode and the studio renders empty slots — `@lerret/cli dev`
  // has the same shape; we keep them in lock-step.
  const cliRequire = createRequire(import.meta.url);
  const reactAliases = [
    { find: 'react/jsx-dev-runtime', replacement: cliRequire.resolve('react/jsx-dev-runtime') },
    { find: 'react/jsx-runtime', replacement: cliRequire.resolve('react/jsx-runtime') },
    { find: 'react-dom/client', replacement: cliRequire.resolve('react-dom/client') },
    { find: /^react-dom$/, replacement: cliRequire.resolve('react-dom') },
    { find: /^react$/, replacement: cliRequire.resolve('react') },
  ];

  const server = await createServer({
    configFile: false,
    root: studioRoot,
    plugins,
    resolve: { alias: reactAliases },
    server: {
      open: false, // headless — never open a real browser
      fs: {
        allow: [studioRoot, workspaceRoot],
      },
      // Suppress the long warning Vite prints when a host-check would be
      // helpful — we're talking to ourselves on localhost.
      host: '127.0.0.1',
    },
    // Lower the log level so a non-interactive run is not flooded with
    // Vite's HMR chatter; the CLI prints its own per-artboard progress.
    logLevel: 'warn',
  });

  await server.listen();
  const addr = server.httpServer && server.httpServer.address();
  if (!addr || typeof addr === 'string' || !addr.port) {
    await server.close().catch(() => {});
    throw new Error('Vite dev server did not bind to a TCP address');
  }
  const url = `http://127.0.0.1:${addr.port}`;
  return { server, url };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-artboard capture inside the page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run the studio-bundled `captureArtboard` for one artboard, INSIDE the
 * headless page, and transfer the resulting bytes back to Node as a base64
 * string. (Playwright's `evaluate` cannot directly serialize Blobs across the
 * Node/browser bridge — base64 is the universal escape hatch.)
 *
 * Locates the artboard DOM node by its `data-dc-slot=<domId>` attribute, then
 * invokes the EXACT same `captureArtboard` module the studio uses for its
 * per-artboard PNG/JPG buttons. Every font-embedding path inside that module
 * runs unchanged, so a headless capture is pixel-faithful to a studio click.
 *
 * Returns `{ ok: true, bytesB64, unembeddedFonts }` on success, or
 * `{ ok: false, error }` on any in-page failure. The function never throws —
 * the caller treats `ok: false` as a per-artboard failure and continues.
 *
 * @param {object} page  A Playwright `Page` instance.
 * @param {string} domId  The artboard's `data-dc-slot` id (asset path, or
 *                        `<asset.path>#<variantName>` for a variant).
 * @param {'png' | 'jpg'} format
 * @returns {Promise<{ ok: boolean, bytesB64?: string, unembeddedFonts?: string[], error?: string }>}
 */
export async function evaluateCaptureInPage(page, domId, format) {
  // The arrow below executes INSIDE the Chromium page — `document`, `btoa`,
  // and `window.__lerret_capture` are browser-side and the lint
  // (which sees this file as Node-only) cannot tell. The targeted disable
  // covers only that callback.
  //
  // `window.__lerret_capture` is published by the studio's CLI-mode entry
  // (`cli-project-source.jsx`) — a stable hook that survives production
  // bundling. The old dynamic `import('/src/export/capture.js')` only worked
  // when Vite served the studio from source; against the pre-built
  // `dist-studio/` (hashed chunks) the source path 404s.
  return await page.evaluate(
    /* eslint-disable no-undef */
    async ({ domId, format, slotSelector, innerCardSelector }) => {
      try {
        const slot = document.querySelector(slotSelector);
        if (!slot) return { ok: false, error: `slot not found for "${domId}"` };
        const card = slot.querySelector(innerCardSelector);
        if (!card) return { ok: false, error: `inner card not found inside slot "${domId}"` };

        // Wait for the studio's CLI-mode entry to publish `__lerret_capture`.
        // The studio loads `cli-project-source.jsx` asynchronously from
        // `main.jsx`, so on a fast-navigating page the global may not be
        // present yet when this callback first fires. Poll briefly with a
        // generous ceiling — in practice it appears within the first frame
        // after the studio root mounts.
        const deadline = Date.now() + 10000;
        while (typeof window.__lerret_capture !== 'function') {
          if (Date.now() > deadline) {
            return {
              ok: false,
              error:
                '`window.__lerret_capture` was not published by the studio ' +
                '— the bundled studio may be out of date with this CLI',
            };
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        const { blob, unembeddedFonts } = await window.__lerret_capture(card, { format });

        // Transfer the blob as base64 — Playwright `evaluate` serializes
        // primitives but cannot pass Blobs across the bridge.
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return {
          ok: true,
          bytesB64: btoa(binary),
          unembeddedFonts: unembeddedFonts || [],
        };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : String(err),
        };
      }
    },
    /* eslint-enable no-undef */
    {
      domId,
      format,
      slotSelector: ARTBOARD_SELECTORS.slotByDataAttr(domId),
      innerCardSelector: ARTBOARD_SELECTORS.innerCardSelector,
    },
  );
}

/**
 * Same shape as `evaluateCaptureInPage` but invokes the studio's animated
 * capture bridge (`window.__lerret_capture_animated`). Returns the encoded
 * Blob's bytes as base64 plus the MIME type so the caller can pick the right
 * file extension.
 *
 * @param {object} page
 * @param {string} domId
 * @param {{ format: 'webp'|'gif'|'apng'|'mp4', durationMs: number, fps: number, scale: number, loop: 'infinite'|'once'|number, captureMode: 'cycle'|'now', width: number, height: number, liveRefreshIntervalMs?: number }} settings
 * @returns {Promise<{ ok: boolean, bytesB64?: string, mimeType?: string, error?: string }>}
 */
export async function evaluateAnimatedCaptureInPage(page, domId, settings) {
  return await page.evaluate(
    /* eslint-disable no-undef */
    async ({ domId, settings, slotSelector, innerCardSelector }) => {
      try {
        const slot = document.querySelector(slotSelector);
        if (!slot) return { ok: false, error: `slot not found for "${domId}"` };
        const card = slot.querySelector(innerCardSelector);
        if (!card) return { ok: false, error: `inner card not found inside slot "${domId}"` };

        const deadline = Date.now() + 10000;
        while (typeof window.__lerret_capture_animated !== 'function') {
          if (Date.now() > deadline) {
            return {
              ok: false,
              error:
                '`window.__lerret_capture_animated` was not published — the bundled ' +
                'studio may be missing @lerret/animation. Install @lerret/animation, ' +
                'or use a static format (png/jpg).',
            };
          }
          await new Promise((r) => setTimeout(r, 50));
        }

        const result = await window.__lerret_capture_animated(card, settings);
        return {
          ok: true,
          bytesB64: result.bytesB64,
          mimeType: result.mimeType,
        };
      } catch (err) {
        return {
          ok: false,
          error: err && err.message ? err.message : String(err),
        };
      }
    },
    /* eslint-enable no-undef */
    {
      domId,
      settings,
      slotSelector: ARTBOARD_SELECTORS.slotByDataAttr(domId),
      innerCardSelector: ARTBOARD_SELECTORS.innerCardSelector,
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal: format an artboard's location for the start-of-run progress log.
 *
 * @param {string[]} segments
 * @returns {string}
 */
function formatLocation(segments) {
  return segments.length === 0 ? '(top)' : segments.join('/');
}

/**
 * Group expanded artboard entries by their `pagePath`, preserving first-seen
 * order. Each entry is paired with its pre-computed base filename so the
 * downstream capture loop doesn't have to re-derive names.
 *
 * The studio renders one project-page at a time, so the CLI navigates the
 * URL hash to each page once and captures every artboard on that page before
 * moving on. The returned order is whatever order pages first appear in
 * `expanded` — which mirrors `collectArtboards`'s model-walk order (already
 * alphabetical, so a project's page-visit order is deterministic).
 *
 * @param {Array<{ artboard: object, variantName: string | undefined, domId: string }>} expanded
 * @param {string[]} baseFilenames  Same length as `expanded`; the precomputed
 *   filename for each entry.
 * @returns {Array<{
 *   pagePath: string | null,
 *   entries: Array<{ artboard: object, variantName: string | undefined, domId: string, filename: string }>
 * }>}
 *   One group per distinct `pagePath`. `pagePath` is `null` only for hand-
 *   crafted artboards in tests that omit the field — the orchestrator skips
 *   navigation for that bucket and uses whatever the studio is showing.
 */
export function groupEntriesByPage(expanded, baseFilenames) {
  /** @type {Map<string, Array<{ artboard: object, variantName: string | undefined, domId: string, filename: string }>>} */
  const byPath = new Map();
  const NULL_KEY = '__lerret_no_page__';
  for (let i = 0; i < expanded.length; i++) {
    const entry = expanded[i];
    const pagePath =
      entry.artboard && typeof entry.artboard.pagePath === 'string'
        ? entry.artboard.pagePath
        : null;
    const key = pagePath === null ? NULL_KEY : pagePath;
    const paired = { ...entry, filename: baseFilenames[i] };
    const bucket = byPath.get(key);
    if (bucket) {
      bucket.push(paired);
    } else {
      byPath.set(key, [paired]);
    }
  }
  return [...byPath.entries()].map(([key, entries]) => ({
    pagePath: key === NULL_KEY ? null : key,
    entries,
  }));
}

/**
 * Run `@lerret/cli export`. Resolves the scope, boots Vite + Chromium, captures
 * each artboard, writes the result to disk, and returns an exit code.
 *
 * @param {string[]} argv  Argv slice after the `export` subcommand.
 * @param {object} [deps]  Injectable dependencies for tests.
 * @param {typeof launchHeadlessBrowser} [deps.launchBrowser]
 * @param {typeof bootViteServer} [deps.bootServer]
 * @param {typeof evaluateCaptureInPage} [deps.captureInPage]
 * @param {(filePath: string, bytes: Uint8Array) => Promise<void>} [deps.writeBinary]
 * @param {(dir: string) => Promise<void>} [deps.ensureDir]
 * @param {() => string} [deps.getCwd]  Returns the working directory.
 * @param {typeof loadOverrideFiles} [deps.loadOverrides]
 *   Override the file-loading function (for tests that don't want real fs reads).
 * @returns {Promise<number>}  Exit code.
 */
export async function runExport(argv, deps = {}) {
  const { flags, error } = parseExportArgs(argv);
  if (error) {
    process.stderr.write(`@lerret/cli export: ${error}\n\n`);
    printUsage();
    return 1;
  }

  if (flags.help) {
    printUsage();
    return 0;
  }

  const getCwd = deps.getCwd || (() => process.cwd());
  const cwd = getCwd();

  // 0. Load --data / --config override files. This happens BEFORE
  //    scope resolution and before Vite is booted so that a bad override path
  //    or malformed JSON produces a fast, cheap, actionable error. Neither
  //    value is ever written to disk (NFR13).
  const loadOverridesFn = deps.loadOverrides || loadOverrideFiles;
  const overrideResult = await loadOverridesFn({
    dataPath: flags.data,
    configPath: flags.config,
    cwd,
  });
  if (!overrideResult.ok) {
    process.stderr.write(`@lerret/cli export: ${overrideResult.error}\n`);
    return 1;
  }
  const { dataOverride, configOverride } = overrideResult.overrides;

  // 1. Resolve project + scope.
  const scope = await resolveScope({ pathArg: flags.pathArg, cwd });
  if (!scope.found) {
    process.stderr.write(`@lerret/cli export: ${scope.error}\n`);
    return 1;
  }

  // 2. Pick the artboards in scope and expand variants.
  let baseArtboards;
  try {
    baseArtboards = collectArtboards(scope.model, scope.scopePath);
  } catch (err) {
    process.stderr.write(`@lerret/cli export: ${err && err.message ? err.message : String(err)}\n`);
    return 1;
  }

  // 2a. Filter out pages/groups with `excludeFromExport: true` (FR52).
  //     Uses the same cascaded-config resolver as the studio (single source).
  let excludedFolders = [];
  try {
    const backend = createNodeBackend();
    const cascade = await computeCascadedConfig(scope.model, backend);
    const getConfigFor = (path) => cascade.get(path);
    const { kept, excluded } = partitionByExclusion(baseArtboards, getConfigFor);
    if (excluded.length > 0) {
      excludedFolders = excludedFolderPaths(excluded);
      baseArtboards = kept;
    }
  } catch (err) {
    // Cascade load failures are non-fatal — log a warn and proceed without
    // exclusion filtering. The export pipeline runs at full v1 behavior.
    process.stderr.write(
      `@lerret/cli export: warning — could not compute cascaded config for excludeFromExport ` +
        `filter (${err && err.message ? err.message : String(err)}); exporting every artboard.\n`,
    );
  }

  const expanded = expandArtboardVariants(baseArtboards);
  if (expanded.length === 0) {
    if (excludedFolders.length > 0) {
      const names = excludedFolders.map((p) => p.split('/').filter(Boolean).pop() || p).join(', ');
      process.stderr.write(
        `@lerret/cli export: every artboard in scope was excluded via excludeFromExport ` +
          `(${names}). Nothing to export.\n`,
      );
    } else {
      process.stderr.write(
        `@lerret/cli export: no artboards found in scope (${scope.scopeKind}). Nothing to export.\n`,
      );
    }
    return 1;
  }

  // 3. Prepare the output directory.
  //
  // We canonicalize the OUT path so the NFR13 "no writes into `.lerret/`"
  // check is not foiled by symlinks (`/tmp` → `/private/tmp` on macOS is the
  // textbook gotcha). The path likely does not yet exist on disk —
  // `realpathOfExistingPrefix` walks up to the deepest ancestor that does
  // exist, canonicalizes it, and re-attaches the leaf components verbatim.
  const outDirAbs = realpathOfExistingPrefix(resolvePath(cwd, flags.out));
  // Refuse to write into the user's `.lerret/` — the separation invariant
  // (NFR13) is enforced at the CLI boundary.
  if (
    outDirAbs === scope.lerretDir ||
    outDirAbs.startsWith(scope.lerretDir + '/')
  ) {
    process.stderr.write(
      `@lerret/cli export: refusing to write into the project's \`.lerret/\` directory ` +
        `(${scope.lerretDir}). Pick an --out directory outside the project's .lerret/ tree.\n`,
    );
    return 1;
  }

  const ensureDirFn = deps.ensureDir || ensureDir;
  try {
    await ensureDirFn(outDirAbs);
  } catch (err) {
    process.stderr.write(
      `@lerret/cli export: could not create output directory ${outDirAbs}: ` +
        `${err && err.message ? err.message : String(err)}\n`,
    );
    return 1;
  }

  // 4. Boot Vite + Playwright. Either can fail with a clear, actionable
  //    message; both must be torn down on success or partial failure.
  const overrideNote =
    dataOverride !== undefined && configOverride !== undefined
      ? ' [--data + --config overrides active]'
      : dataOverride !== undefined
        ? ' [--data override active]'
        : configOverride !== undefined
          ? ' [--config override active]'
          : '';
  process.stdout.write(
    `@lerret/cli export: project ${scope.projectRoot}\n` +
      `@lerret/cli export: scope ${scope.scopeKind}${scope.scopePath ? ` (${scope.scopePath})` : ''}\n` +
      `@lerret/cli export: ${expanded.length} artboard${expanded.length === 1 ? '' : 's'} to capture (${flags.format})${overrideNote}\n` +
      `@lerret/cli export: writing to ${outDirAbs}${flags.flat ? ' (flat layout)' : ''}\n`,
  );

  const bootServer = deps.bootServer || bootViteServer;
  const launchBrowser = deps.launchBrowser || launchHeadlessBrowser;
  const captureInPage = deps.captureInPage || evaluateCaptureInPage;
  const writeBinary = deps.writeBinary || writeBinaryToDisk;

  /** @type {{ close: () => Promise<unknown> } | null} */
  let server = null;
  /** @type {{ close: () => Promise<unknown> } | null} */
  let browser = null;

  try {
    let url;
    try {
      const booted = await bootServer({
        projectRoot: scope.projectRoot,
        lerretDir: scope.lerretDir,
        dataOverride,
        configOverride,
      });
      server = booted.server;
      url = booted.url;
    } catch (err) {
      process.stderr.write(
        `@lerret/cli export: Vite dev server failed to start: ` +
          `${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }

    try {
      const launched = await launchBrowser();
      browser = launched.browser;
      process.stdout.write(`@lerret/cli export: ${launched.launchedVia}\n`);
    } catch (err) {
      process.stderr.write(
        `@lerret/cli export: ${err && err.message ? err.message : String(err)}\n`,
      );
      return 1;
    }

    // Open a single page and navigate to the studio. We use one page for the
    // whole run — captureArtboard is independent per artboard and the studio
    // pages share the same Vite/HMR session. A fresh page per artboard would
    // re-bundle / re-fetch fonts each time.
    //
    // The studio renders ONE project-page at a time (the dock's page picker
    // drives `ProjectStudio`'s hash route — see `packages/studio/src/project-
    // studio.jsx`). To capture artboards across every project page we group
    // by `pagePath`, navigate the URL hash to each page, wait for its first
    // slot to attach, then capture all of that page's artboards before
    // moving on. The first hash-set fires `hashchange` even when it matches
    // the default page, which keeps the navigation predictable.
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // 5. Build name counts for flat-mode disambiguation. These are computed
    //    across the WHOLE run so collisions are detected even when colliding
    //    artboards live on different pages.
    /** @type {Map<string, number>} */
    const nameCounts = new Map();
    const baseFilenames = expanded.map((entry) =>
      buildBaseFilename(entry.artboard, flags.format),
    );
    for (const name of baseFilenames) {
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }

    // 6. Group entries by `pagePath` so we can navigate the studio to each
    //    page once. Insertion order matters — `collectArtboards` walks pages
    //    in model order (alphabetical by the loader), so the resulting page
    //    visit order is deterministic.
    const pageGroups = groupEntriesByPage(expanded, baseFilenames);

    // 7. Capture each artboard, one page-batch at a time. Failures are
    //    isolated — a single bad capture is logged and the run continues.
    //    Unembedded fonts are aggregated across the run.
    const allUnembeddedFonts = new Set();
    /** @type {Array<{ artboard: object, reason: string }>} */
    const failures = [];
    let writtenCount = 0;
    let runIndex = 0;

    for (const group of pageGroups) {
      // Navigate the studio to this page via the hash. `ProjectStudio`'s
      // `useHashRoute` listens on `hashchange`, so setting `location.hash`
      // re-renders `ProjectCanvas` for the matching page. When `pagePath` is
      // null (test artboards without a page hint) we skip navigation —
      // whatever the studio is currently showing serves the capture.
      if (group.pagePath !== null) {
        try {
          await page.evaluate((p) => {
            // eslint-disable-next-line no-undef
            window.location.hash = '#' + p;
          }, group.pagePath);
        } catch (err) {
          // A navigation failure for this page is fatal for the page batch
          // but not for the run — log every entry in this group as failed
          // and move on. We don't return 1 because other pages may succeed.
          const reason =
            `could not navigate to page ${group.pagePath}: ` +
            `${err && err.message ? err.message : String(err)}`;
          for (const entry of group.entries) {
            runIndex++;
            const human = `${runIndex}/${expanded.length}`;
            const label = `${formatLocation(entry.artboard.locationSegments)}/${entry.artboard.asset.name}${entry.variantName ? `#${entry.variantName}` : ''}`;
            process.stderr.write(`[${human}] FAILED ${label}: ${reason}\n`);
            failures.push({ artboard: entry.artboard, reason });
          }
          continue;
        }
      }

      // Wait for the first slot on this page to attach. If the studio fails
      // to render this page's artboards within the timeout, log every entry
      // in the batch as failed (with a clear reason) and move to the next
      // page rather than aborting — partial output is more useful than zero.
      const firstSelector = ARTBOARD_SELECTORS.slotByDataAttr(group.entries[0].domId);
      try {
        await page.waitForSelector(firstSelector, { state: 'attached', timeout: 30000 });
      } catch (err) {
        const reason =
          `studio did not render page ${group.pagePath || '(default)'} within 30s ` +
          `(${err && err.message ? err.message : String(err)})`;
        for (const entry of group.entries) {
          runIndex++;
          const human = `${runIndex}/${expanded.length}`;
          const label = `${formatLocation(entry.artboard.locationSegments)}/${entry.artboard.asset.name}${entry.variantName ? `#${entry.variantName}` : ''}`;
          process.stderr.write(`[${human}] FAILED ${label}: ${reason}\n`);
          failures.push({ artboard: entry.artboard, reason });
        }
        continue;
      }

      for (const entry of group.entries) {
        runIndex++;
        const filename = entry.filename;
        const nameCount = nameCounts.get(filename) ?? 1;
        const outputPath = buildOutputPath({
          outDir: outDirAbs,
          artboard: entry.artboard,
          filename,
          flat: flags.flat,
          nameCount,
        });

        const human = `${runIndex}/${expanded.length}`;
        const label = `${formatLocation(entry.artboard.locationSegments)}/${entry.artboard.asset.name}${entry.variantName ? `#${entry.variantName}` : ''}`;
        process.stdout.write(`[${human}] capturing ${label}\n`);

        let result;
        try {
          if (flags.isAnimated) {
            const dims = entry.artboard?.asset?.meta?.dimensions || { width: 1280, height: 720 };
            result = await evaluateAnimatedCaptureInPage(page, entry.domId, {
              format: flags.format,
              durationMs: flags.durationMs,
              fps: flags.fps,
              scale: flags.scale,
              loop: flags.loop,
              captureMode: flags.captureMode,
              width: dims.width,
              height: dims.height,
            });
          } else {
            result = await captureInPage(page, entry.domId, flags.format);
          }
        } catch (err) {
          result = {
            ok: false,
            error: err && err.message ? err.message : String(err),
          };
        }

        if (!result || !result.ok) {
          const reason = (result && result.error) || 'unknown capture failure';
          process.stderr.write(`[${human}] FAILED ${label}: ${reason}\n`);
          failures.push({ artboard: entry.artboard, reason });
          continue;
        }

        // Decode base64 → Uint8Array and write the bytes to disk.
        let bytes;
        try {
          const binary = Buffer.from(result.bytesB64, 'base64');
          bytes = new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
        } catch (err) {
          const reason = `failed to decode capture bytes: ${err && err.message ? err.message : String(err)}`;
          process.stderr.write(`[${human}] FAILED ${label}: ${reason}\n`);
          failures.push({ artboard: entry.artboard, reason });
          continue;
        }

        try {
          await ensureDirFn(toLerretPath(dirname(outputPath)));
          await writeBinary(outputPath, bytes);
          writtenCount++;
          process.stdout.write(`[${human}] wrote ${outputPath}\n`);
        } catch (err) {
          const reason = `write failed: ${err && err.message ? err.message : String(err)}`;
          process.stderr.write(`[${human}] FAILED ${label}: ${reason}\n`);
          failures.push({ artboard: entry.artboard, reason });
          continue;
        }

        for (const font of result.unembeddedFonts || []) {
          allUnembeddedFonts.add(font);
        }
      }
    }

    // 7. Summary.
    const summaryLines = [
      '',
      `@lerret/cli export: wrote ${writtenCount} of ${expanded.length} image${expanded.length === 1 ? '' : 's'} to ${outDirAbs}`,
    ];
    if (failures.length > 0) {
      summaryLines.push(
        `@lerret/cli export: ${failures.length} artboard${failures.length === 1 ? '' : 's'} failed (see messages above)`,
      );
    }
    if (excludedFolders.length > 0) {
      const names = excludedFolders
        .map((p) => p.split('/').filter(Boolean).pop() || p)
        .join(', ');
      summaryLines.push(
        `@lerret/cli export: skipped ${excludedFolders.length} page${excludedFolders.length === 1 ? '' : 's'} (excludeFromExport): ${names}`,
      );
    }
    if (allUnembeddedFonts.size > 0) {
      summaryLines.push(
        `@lerret/cli export: fonts not embedded: ${[...allUnembeddedFonts].sort().join(', ')}`,
      );
    }
    process.stdout.write(summaryLines.join('\n') + '\n');

    // Exit code is 0 when at least one artboard was written and the run
    // completed without a fatal error; a fully failed run (zero writes)
    // exits non-zero so CI surfaces it.
    return writtenCount === 0 ? 1 : 0;
  } finally {
    // Clean teardown — Playwright first, then Vite. Either may throw on a
    // half-initialized state during an early-exit; swallow so the finally
    // never masks the original error.
    if (browser) {
      try {
        await browser.close();
      } catch {
        // teardown best-effort
      }
    }
    if (server) {
      try {
        await server.close();
      } catch {
        // teardown best-effort
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary file writer (default implementation, injectable for tests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default implementation of "write these bytes to this file". Delegates to the
 * Node backend's atomic `writeFile` (with `WriteFileOptions` using
 * `encoding: 'binary'`). Tests can override via `runExport`'s `deps.writeBinary`.
 *
 * @param {string} filePath  Absolute, forward-slash file path.
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
async function writeBinaryToDisk(filePath, bytes) {
  const backend = createNodeBackend();
  await backend.writeFile(filePath, bytes, { encoding: 'binary' });
}

// `runExport` is the only programmatic entry from this module; the top-level
// `lerret.js` dispatch is what users hit at the shell. No auto-invocation guard
// here — running this file standalone would compete with the dispatcher.
