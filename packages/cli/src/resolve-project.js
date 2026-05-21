// resolve-project — project detection and `.lerret/` folder designation.
//
// A folder is a valid Lerret project if and only if it directly contains a
// `.lerret/` subdirectory (FR1) — the same "marker folder" idea as `git`'s
// `.git/`. Detection walks UP from a starting directory toward the filesystem
// root, returning the first ancestor that directly contains a `.lerret/`
// directory (FR43). If no ancestor has one, it reports "no project found" so
// the caller can fall back to a folder-picker / empty-state (that UI lives in
// the studio and is out of scope here — this module only branches the decision).
//
// IMPORTANT: detection reaches the filesystem ONLY through the `core`
// `FilesystemAccess` contract — never `node:fs` directly. The Node backend
// (`createNodeBackend()`) is the CLI-mode implementation. `node:path` is used
// purely for path arithmetic (walking up, normalizing), which the separation
// invariant explicitly permits.

import { dirname, resolve } from 'node:path';

import { createNodeBackend } from './fs/node-backend.js';

/**
 * The reserved marker directory whose presence designates a Lerret project.
 * @type {string}
 */
const LERRET_DIR_NAME = '.lerret';

/**
 * Successful project-detection result.
 *
 * @typedef {object} ProjectFound
 * @property {true} found
 *   Discriminant — `true` for a resolved project.
 * @property {string} projectRoot
 *   Absolute, normalized path of the folder that directly contains
 *   `.lerret/`. This is the project root.
 * @property {string} lerretDir
 *   Absolute, normalized path of the project's `.lerret/` directory — the
 *   loader's scan root.
 */

/**
 * Unsuccessful project-detection result: no `.lerret/` directory was found in
 * the start directory or any of its ancestors up to the filesystem root.
 *
 * @typedef {object} ProjectNotFound
 * @property {false} found
 *   Discriminant — `false` when no project was located.
 * @property {string} startDir
 *   Absolute, normalized path the walk started from, for diagnostics and for
 *   the caller's empty-state / folder-picker fallback.
 */

/**
 * The result of {@link resolveProject}: either a found project or a clear
 * not-found outcome. Callers branch on the `found` discriminant.
 *
 * @typedef {ProjectFound | ProjectNotFound} ProjectResolution
 */

/**
 * Determine whether a directory directly contains a `.lerret/` subdirectory.
 *
 * Goes through the {@link import('@lerret/core').FilesystemAccess} contract.
 * A `readDir` rejection (e.g. the directory is unreadable, or was removed
 * mid-walk) is treated as "no `.lerret/` here" rather than an error: the walk
 * should keep climbing toward the root instead of aborting on one bad
 * ancestor.
 *
 * @param {import('@lerret/core').FilesystemAccess} fs
 *   The filesystem backend to read through.
 * @param {string} dirPath
 *   A forward-slash directory path to inspect.
 * @returns {Promise<boolean>}
 *   `true` iff `dirPath` directly contains a `.lerret/` directory.
 */
async function hasLerretDir(fs, dirPath) {
  let entries;
  try {
    entries = await fs.readDir(dirPath);
  } catch {
    // Unreadable / vanished directory — not a project root we can use. Let
    // the caller keep walking up rather than failing the whole detection.
    return false;
  }

  return entries.some(
    (entry) => entry.isDirectory && entry.name === LERRET_DIR_NAME,
  );
}

/**
 * Detect the Lerret project containing a starting directory.
 *
 * Walks up from `startDir` toward the filesystem root. The first ancestor that
 * directly contains a `.lerret/` directory is the project root; its `.lerret/`
 * directory is the loader's scan root (FR43). If no ancestor qualifies, the
 * walk stops cleanly at the filesystem root and a not-found result is returned
 * — never an error, never an infinite loop.
 *
 * Path handling: `startDir` is resolved to an absolute path first (so a
 * relative or `.`-style argument works), then normalized to forward slashes so
 * every path in the result matches the `FilesystemAccess` contract convention.
 *
 * @param {string} [startDir=process.cwd()]
 *   The directory to begin detection from — typically the CLI's working
 *   directory. Resolved to absolute if relative.
 * @param {import('@lerret/core').FilesystemAccess} [fs]
 *   The filesystem backend to detect through. Defaults to a fresh Node backend
 *   (`createNodeBackend()`), the CLI-mode implementation. Injectable so tests
 *   and alternate hosts can supply their own backend.
 * @returns {Promise<ProjectResolution>}
 *   A {@link ProjectFound} carrying absolute `projectRoot` / `lerretDir`
 *   paths, or a {@link ProjectNotFound} carrying the absolute `startDir`.
 */
export async function resolveProject(
  startDir = process.cwd(),
  fs = createNodeBackend(),
) {
  // Resolve to an absolute path, then speak the contract's forward-slash
  // convention so every path we pass to `readDir` — and every path we return
  // — is normalized identically.
  const absoluteStart = toLerretPath(resolve(startDir));

  let current = absoluteStart;

  // Walk up one ancestor per iteration. The loop terminates because
  // `dirname()` strictly shortens the path until it reaches the filesystem
  // root, where `dirname(root) === root` — the explicit stop condition below.
  for (;;) {
    if (await hasLerretDir(fs, current)) {
      return {
        found: true,
        projectRoot: current,
        lerretDir: joinLerretPath(current, LERRET_DIR_NAME),
      };
    }

    const parent = toLerretPath(dirname(current));
    if (parent === current) {
      // Reached the filesystem root — `dirname` no longer shortens the path.
      // Stop cleanly: no `.lerret/` anywhere on the path to the root.
      break;
    }
    current = parent;
  }

  return { found: false, startDir: absoluteStart };
}

/**
 * Normalize an OS path to the forward-slash form the `FilesystemAccess`
 * contract uses. A near no-op on POSIX hosts; on Windows it bridges `\` to
 * `/`. A lone drive-root such as `C:\` keeps its trailing separator so it
 * stays a valid directory path.
 *
 * @param {string} osPath An absolute path using native separators.
 * @returns {string} The same path with forward slashes.
 */
function toLerretPath(osPath) {
  return osPath.replaceAll('\\', '/');
}

/**
 * Join a forward-slash directory path and a single child segment, without
 * reaching for `node:path` join semantics (which would re-introduce native
 * separators). The directory path is already absolute and normalized.
 *
 * @param {string} dirPath A forward-slash directory path.
 * @param {string} name A single path segment.
 * @returns {string} The joined forward-slash path.
 */
function joinLerretPath(dirPath, name) {
  // A filesystem root like `/` or `C:/` already ends in a separator; appending
  // another would produce `//`. Otherwise insert exactly one `/`.
  return dirPath.endsWith('/') ? `${dirPath}${name}` : `${dirPath}/${name}`;
}

export { LERRET_DIR_NAME };
