// The project loader — `scan`: a `.lerret/` folder tree → the in-memory
// project model (architecture: `core/loader/scan.js`, "folder → project
// model"; FR1–7).
//
// `scan` walks the `.lerret/` directory through an injected
// {@link FilesystemAccess} backend and never anything else — no `node:fs`, no
// File System Access API. That keeps `core` environment-agnostic: the same
// loader runs in the Node CLI and the browser studio, differing only in which
// backend is passed in.
//
// Mapping rules, exactly as the PRD fixes them:
//
//   - A regular (non-underscore) subfolder directly under `.lerret/` → a PAGE
//     (FR2).
//   - A subfolder nested inside a page or group → a GROUP, to arbitrary depth
//     (FR3).
//   - An underscore-prefixed folder *at the project root* (`_fonts/`,
//     `_assets/`) is RESERVED — not a page, not a group; it stays on disk for
//     assets to import but never enters the page tree (FR5). The underscore
//     rule applies only at the root: a `_foo/` folder nested inside a page IS
//     a normal group.
//   - The reserved `_fonts/` folder is the one root folder whose *contents*
//     are still recorded: each recognized font file (WOFF/WOFF2/TTF/OTF) is
//     collected onto `project.fonts` so the studio can auto-register it as an
//     `@font-face` rule (FR12). A non-font file in `_fonts/` is skipped.
//     `_fonts/` is still not a page and not a group — only its font files
//     leave a (non-node) trace.
//   - A recognized asset file (`.jsx` / `.tsx` / `.md`) inside a page or group
//     → an ASSET node (FR4).
//   - Any other file — unrecognized, or a `config.json` / `.data.*` / resource
//     file — is excluded from the model (FR6). The loader only ever *reads*;
//     it never deletes or moves anything, so resources stay on disk.
//   - An empty page or group folder still appears, with zero assets and zero
//     groups (no crash, no omission).
//
// This file is PURE. All path handling is plain string work on the
// forward-slash {@link LerretPath} strings the backend returns.

import { assertFilesystemContract } from '../fs/filesystem.js';

import {
  ASSET_EXTENSIONS,
  createAssetNode,
  createFontFile,
  createGroupNode,
  createPageNode,
  createProjectNode,
} from './model.js';

/**
 * @typedef {import('../fs/filesystem.js').FilesystemAccess} FilesystemAccess
 * @typedef {import('../fs/filesystem.js').DirEntry} DirEntry
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('./model.js').ProjectNode} ProjectNode
 * @typedef {import('./model.js').PageNode} PageNode
 * @typedef {import('./model.js').GroupNode} GroupNode
 * @typedef {import('./model.js').AssetNode} AssetNode
 * @typedef {import('./model.js').FontFile} FontFile
 */

/**
 * The reserved root folder that holds custom font files (FR12). Discovered by
 * exact name directly under the scan root; see {@link scanFontsFolder}.
 *
 * @type {string}
 */
const FONTS_FOLDER_NAME = '_fonts';

// ---------------------------------------------------------------------------
// Pure path helpers — plain string work on forward-slash `LerretPath`s.
// ---------------------------------------------------------------------------

/**
 * The final segment of a forward-slash path — the entry's own name.
 *
 * Trailing slashes are tolerated (a lone root `/` yields `''`). The backend
 * already strips them, but being defensive here costs nothing.
 *
 * @param {LerretPath} path
 * @returns {string}
 */
function baseName(path) {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash === -1 ? trimmed : trimmed.slice(slash + 1);
}

/**
 * Split a file name into its lower-cased extension (including the leading dot)
 * and the base name without that extension.
 *
 * A leading dot does not count as an extension separator, so a dotfile such as
 * `.gitkeep` yields `{ stem: '.gitkeep', ext: '' }` — it has no recognized
 * extension and is therefore excluded as a non-asset file.
 *
 * @param {string} fileName
 * @returns {{ stem: string, ext: string }}
 */
function splitExtension(fileName) {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) {
    return { stem: fileName, ext: '' };
  }
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot).toLowerCase() };
}

/**
 * Whether a folder name is reserved — a leading underscore (`_fonts`,
 * `_assets`; the FR5 convention) or a leading dot (`.state` — the Epic 8
 * snapshot store under `.lerret/.state/`, plus OS noise like `.git`). Only
 * meaningful at the project root; see the module header (FR5).
 *
 * @param {string} folderName
 * @returns {boolean}
 */
function isReservedFolderName(folderName) {
  return folderName.startsWith('_') || folderName.startsWith('.');
}

/**
 * Sort a `DirEntry[]` by name without mutating the input — `readDir` makes no
 * order guarantee, and the model must be stable and diffable.
 *
 * @param {DirEntry[]} entries
 * @returns {DirEntry[]}
 */
function sortedByName(entries) {
  return [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

/**
 * Build an {@link AssetNode} from a recognized asset-file directory entry, or
 * return `null` if the file is not a recognized asset (FR4 / FR6).
 *
 * @param {DirEntry} entry  A `kind: 'file'` directory entry.
 * @returns {AssetNode | null}
 */
function assetNodeFromEntry(entry) {
  const { stem, ext } = splitExtension(entry.name);
  const assetKind = ASSET_EXTENSIONS[ext];
  if (assetKind === undefined) {
    return null; // Not a recognized asset — excluded from the model (FR6).
  }
  return createAssetNode({
    name: stem,
    fileName: entry.name,
    path: entry.path,
    assetKind,
    ext,
  });
}

/**
 * Scan one page-or-group folder: read its immediate children, recurse into
 * every subfolder as a {@link GroupNode}, and collect every recognized asset
 * file as an {@link AssetNode}.
 *
 * Underscore-prefixed *subfolders* are NOT reserved — the reservation rule is
 * root-only — so a nested `_foo/` becomes an ordinary group. Empty folders
 * yield empty `groups` / `assets` arrays rather than being skipped.
 *
 * @param {FilesystemAccess} backend  The injected filesystem backend.
 * @param {LerretPath} dirPath        The page/group folder to scan.
 * @returns {Promise<{ groups: GroupNode[], assets: AssetNode[] }>}
 */
async function scanContainerFolder(backend, dirPath) {
  const entries = sortedByName(await backend.readDir(dirPath));

  /** @type {GroupNode[]} */
  const groups = [];
  /** @type {AssetNode[]} */
  const assets = [];

  for (const entry of entries) {
    if (entry.isDirectory) {
      const { groups: childGroups, assets: childAssets } =
        await scanContainerFolder(backend, entry.path);
      groups.push(
        createGroupNode({
          name: entry.name,
          path: entry.path,
          groups: childGroups,
          assets: childAssets,
        }),
      );
    } else if (entry.isFile) {
      const asset = assetNodeFromEntry(entry);
      if (asset !== null) {
        assets.push(asset);
      }
      // A non-asset file (config.json, .data.*, image, font, anything
      // unrecognized) is left on disk and simply not added to the model (FR6).
    }
    // Any other `kind` is ignored — the contract only surfaces file/directory.
  }

  return { groups, assets };
}

/**
 * Scan the reserved `_fonts/` folder and collect every recognized font file
 * into a sorted {@link FontFile}[] for `project.fonts` (FR12).
 *
 * Only the folder's *immediate* files are considered — fonts are not nested.
 * A file whose extension is not a recognized font type is skipped (so a
 * `README`, an `OFL.txt`, or any stray file in `_fonts/` is ignored without
 * affecting the valid fonts). Subfolders inside `_fonts/` are ignored too.
 *
 * If the entry is absent or not a directory, this returns `[]` — `_fonts/`
 * being absent or empty is normal, never an error.
 *
 * @param {FilesystemAccess} backend  The injected filesystem backend.
 * @param {DirEntry | undefined} fontsEntry
 *   The `_fonts/` directory entry from the root scan, or `undefined` if there
 *   is no such root folder.
 * @returns {Promise<FontFile[]>}  Recognized font files, sorted by `fileName`.
 */
async function scanFontsFolder(backend, fontsEntry) {
  if (fontsEntry === undefined || !fontsEntry.isDirectory) {
    return []; // No `_fonts/` folder — no custom fonts, and no error.
  }

  const entries = sortedByName(await backend.readDir(fontsEntry.path));

  /** @type {FontFile[]} */
  const fonts = [];
  for (const entry of entries) {
    if (!entry.isFile) {
      continue; // Fonts are flat files — ignore any nested folder.
    }
    const font = createFontFile({ fileName: entry.name, path: entry.path });
    if (font !== null) {
      fonts.push(font);
    }
    // A non-font file (a license text, a README, anything unrecognized) is
    // skipped — it does not register and does not break the valid fonts.
  }
  return fonts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a `.lerret/` directory and build the in-memory project model.
 *
 * Every regular subfolder directly under `scanRoot` becomes a {@link PageNode}
 * (FR2); folders nested below become {@link GroupNode}s to any depth (FR3);
 * recognized asset files become {@link AssetNode}s (FR4). Underscore-prefixed
 * root folders are reserved and skipped as pages (FR5); the reserved `_fonts/`
 * folder's font files are collected onto `project.fonts` (FR12); unrecognized
 * files are excluded (FR6). The loader only reads — it never writes, deletes,
 * or moves anything.
 *
 * @param {FilesystemAccess} backend
 *   The injected filesystem backend — the Node `fs` backend (CLI mode) or the
 *   File System Access backend (hosted mode). Validated against the
 *   `FilesystemAccess` contract before use; an invalid backend throws.
 * @param {LerretPath} scanRoot
 *   The normalized path of the `.lerret/` directory to scan (the loader's scan
 *   root, as resolved by project detection).
 * @returns {Promise<ProjectNode>}
 *   The project model rooted at a {@link ProjectNode}. Rejects only if a
 *   filesystem operation rejects (e.g. the scan root does not exist) — the
 *   backend's `Error` propagates for the caller to turn into a guided message.
 */
export async function scan(backend, scanRoot) {
  assertFilesystemContract(backend, 'scan(backend)');

  if (typeof scanRoot !== 'string' || scanRoot.length === 0) {
    throw new TypeError('scan(scanRoot): scanRoot must be a non-empty path string');
  }

  const rootEntries = sortedByName(await backend.readDir(scanRoot));

  /** @type {PageNode[]} */
  const pages = [];
  /** @type {DirEntry | undefined} The reserved `_fonts/` folder, if present. */
  let fontsEntry;

  for (const entry of rootEntries) {
    // Only directories can be pages; files directly under `.lerret/` are not
    // assets (assets live inside pages/groups) and are excluded.
    if (!entry.isDirectory) {
      continue;
    }
    // Underscore-prefixed root folders are reserved — not pages (FR5). They
    // stay on disk untouched for assets to import. The reserved `_fonts/`
    // folder is still scanned for its font files (FR12) — they are recorded on
    // `project.fonts`, but `_fonts/` is still not a page.
    if (isReservedFolderName(entry.name)) {
      if (entry.name === FONTS_FOLDER_NAME) {
        fontsEntry = entry;
      }
      continue;
    }

    const { groups, assets } = await scanContainerFolder(backend, entry.path);
    pages.push(
      createPageNode({
        name: entry.name,
        path: entry.path,
        groups,
        assets,
      }),
    );
  }

  // Collect the custom fonts from `_fonts/` (FR12) — `[]` when it is absent,
  // empty, or holds only unsupported file types.
  const fonts = await scanFontsFolder(backend, fontsEntry);

  return createProjectNode({
    // The project's display name is the folder that *contains* `.lerret/` —
    // i.e. the parent of the scan root.
    name: projectNameFromScanRoot(scanRoot),
    path: scanRoot,
    pages,
    fonts,
  });
}

/**
 * Derive the project's display name from the `.lerret/` scan-root path: the
 * name of the directory that contains `.lerret/` (the project root).
 *
 * Falls back to the scan root's own base name if there is no parent segment
 * (e.g. a bare `.lerret` with nothing before it).
 *
 * @param {LerretPath} scanRoot
 * @returns {string}
 */
function projectNameFromScanRoot(scanRoot) {
  const trimmed = scanRoot.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  if (slash <= 0) {
    return baseName(trimmed);
  }
  return baseName(trimmed.slice(0, slash));
}
