// watch.js — the normalized change-event contract + pure helpers that patch a
// `ProjectNode` in place of a full rescan.
//
// The architecture (AR5 / "Internal data shapes") fixes one canonical
// change-event shape — `{ type: 'add' | 'change' | 'remove', path }` — emitted
// identically by both filesystem backends. The CLI watcher (`lerret`'s
// `chokidar` wrapper) and the future hosted polling watcher each turn their
// raw signal into one of these and hand it to the loader. The loader patches
// the in-memory model incrementally so the canvas reflects an add / remove /
// rename without a full directory rescan (FR7).
//
// This file is PURE — no Node built-ins, no DOM. It owns:
//   - the {@link WatchEvent} `@typedef` and the frozen string-constants enum
//     (`watchEventType`),
//   - `makeWatchEvent` — a validator/normalizer used by every watcher so the
//     emitted shape is checked in exactly one place,
//   - `applyWatchEvent` — the pure incremental patcher: given a `ProjectNode`
//     and a `WatchEvent`, returns a new `ProjectNode` reflecting the change.
//
// `applyWatchEvent` is intentionally narrow. It mirrors the same `.lerret/`
// mapping rules `scan` enforces (FR2-7): a root regular folder is a page; a
// nested folder is a group; a recognized `.jsx`/`.tsx`/`.md` file is an asset;
// `_fonts/<font>` is a `FontFile`; everything else (`_assets/`, `config.json`,
// `.data.*`, images) is silent — a change there is a no-op for the model.
// Source changes inside an asset file (a `.jsx` edit) are also no-ops here:
// the studio re-renders via Vite Fast Refresh + a cache-bust `loadAsset`
// re-eval, not via a model patch.

/**
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 * @typedef {import('./model.js').ProjectNode} ProjectNode
 * @typedef {import('./model.js').PageNode} PageNode
 * @typedef {import('./model.js').GroupNode} GroupNode
 * @typedef {import('./model.js').AssetNode} AssetNode
 * @typedef {import('./model.js').FontFile} FontFile
 */

import {
  ASSET_EXTENSIONS,
  FONT_EXTENSIONS,
  NODE_KIND,
  createAssetNode,
  createFontFile,
  createGroupNode,
  createPageNode,
} from './model.js';

// ---------------------------------------------------------------------------
// Event shape — the binding contract
// ---------------------------------------------------------------------------

/**
 * The kind of a normalized {@link WatchEvent}. Three discriminants — exactly
 * the granularity the loader patcher needs:
 *
 * - `'add'`     — a path appeared (a new file or folder under `.lerret/`).
 * - `'change'`  — an existing file's content changed (renames are NOT changes;
 *   they are an `add` of the new path + a `remove` of the old).
 * - `'remove'`  — a path disappeared (a file or folder was deleted).
 *
 * @typedef {'add' | 'change' | 'remove'} WatchEventType
 */

/**
 * Frozen string constants for {@link WatchEventType} — importing these keeps
 * stray literals out of consumers (the watcher, the patcher, tests).
 *
 * @type {Readonly<{ ADD: 'add', CHANGE: 'change', REMOVE: 'remove' }>}
 */
export const watchEventType = Object.freeze({
  ADD: 'add',
  CHANGE: 'change',
  REMOVE: 'remove',
});

/**
 * A normalized change event — the architecture's
 * `{ type: 'add' | 'change' | 'remove', path }` contract. Emitted identically
 * by both filesystem backends; consumed identically by the loader patcher.
 *
 * @typedef {object} WatchEvent
 * @property {WatchEventType} type
 *   What happened at `path` — see {@link WatchEventType}.
 * @property {LerretPath} path
 *   The full normalized `LerretPath` (forward slashes, no trailing slash) of
 *   the affected entry — a file or a folder. The watcher reports the path
 *   that was added / changed / removed; for a folder remove the patcher
 *   treats every nested model node as removed.
 */

/**
 * Build and validate a {@link WatchEvent}. Used by every watcher so the
 * emitted shape is checked in exactly one place rather than re-checked at
 * every consumer.
 *
 * Throws on a malformed event (an unknown `type`, a non-string `path`, an
 * empty `path`) — a watcher producing garbage is a wiring bug, not a runtime
 * condition to silently swallow.
 *
 * @param {WatchEventType} type
 * @param {LerretPath} path
 * @returns {WatchEvent}
 */
export function makeWatchEvent(type, path) {
  if (
    type !== watchEventType.ADD &&
    type !== watchEventType.CHANGE &&
    type !== watchEventType.REMOVE
  ) {
    throw new TypeError(
      `makeWatchEvent: type must be 'add' | 'change' | 'remove', got: ${String(type)}`,
    );
  }
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('makeWatchEvent: path must be a non-empty LerretPath string');
  }
  // Strip a trailing slash so `'/a/b/'` and `'/a/b'` are the same event.
  const normalized = path.replace(/\/+$/, '') || path;
  return { type, path: normalized };
}

// ---------------------------------------------------------------------------
// Path helpers — plain string work on forward-slash `LerretPath`s
// ---------------------------------------------------------------------------

/**
 * The final segment of a forward-slash path — the entry's own name.
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
 * The path of `path`'s containing directory — the prefix before the final
 * `'/'`. For a top-level path (no slash) returns `''`.
 *
 * @param {LerretPath} path
 * @returns {string}
 */
function parentPath(path) {
  const trimmed = path.replace(/\/+$/, '');
  const slash = trimmed.lastIndexOf('/');
  return slash <= 0 ? '' : trimmed.slice(0, slash);
}

/**
 * Whether `child` is `parent` itself or lives strictly under it (a descendant
 * folder or file). Pure string check — no filesystem.
 *
 * @param {LerretPath} parent
 * @param {LerretPath} child
 * @returns {boolean}
 */
function pathIsUnder(parent, child) {
  if (parent === child) return true;
  return child.startsWith(parent + '/');
}

/**
 * Split a file name into its lower-cased extension (including the dot) and
 * the stem (the name minus that extension). A leading dot is NOT an extension
 * separator (so `.gitkeep` has no recognized extension).
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
 * Stable sort comparator by a key — used to keep the model's `groups[]` /
 * `assets[]` / `fonts[]` in canonical name order after a patch (matches
 * `scan`'s `sortedByName`).
 *
 * @template T
 * @param {(item: T) => string} keyOf
 * @returns {(a: T, b: T) => number}
 */
function byKey(keyOf) {
  return (a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}

// ---------------------------------------------------------------------------
// Path classification — exactly the same rules `scan` enforces
// ---------------------------------------------------------------------------

/**
 * The role a path inside `.lerret/` plays in the project model, in the
 * canonical names the patcher branches on. This is the single source of
 * truth — `scan`'s walk and `applyWatchEvent`'s patch use the same rules.
 *
 * `'page-folder'`     — a regular (non-underscore) folder directly under root.
 * `'group-folder'`    — a folder nested inside a page or another group.
 * `'asset-file'`      — a recognized `.jsx`/`.tsx`/`.md` file at any depth ≥ 2.
 * `'font-file'`       — a recognized font file directly inside `_fonts/`.
 * `'reserved-folder'` — a `_xxx/` folder directly under root (never a page).
 * `'irrelevant'`      — anything else (a `config.json`, a `.png`, a file at
 *                       root, an asset extension inside a reserved folder).
 *
 * @typedef {(
 *   | 'page-folder'
 *   | 'group-folder'
 *   | 'asset-file'
 *   | 'font-file'
 *   | 'reserved-folder'
 *   | 'irrelevant'
 * )} PathRole
 */

/**
 * Compute the path of every model-relevant ancestor segment of `path` under
 * the scan root, plus a final segment + its kind (file/folder unknown).
 *
 * Returns `null` if `path` is not under `scanRoot`.
 *
 * Internal helper — `classifyPath` and the patcher both walk these segments.
 *
 * @param {LerretPath} scanRoot   The project's scan root (`.lerret/`).
 * @param {LerretPath} path       The event's path.
 * @returns {{ segments: string[] } | null}
 */
function relativeSegments(scanRoot, path) {
  const root = scanRoot.replace(/\/+$/, '');
  const target = path.replace(/\/+$/, '');
  if (target === root) {
    return { segments: [] };
  }
  if (!target.startsWith(root + '/')) {
    return null;
  }
  const rest = target.slice(root.length + 1);
  return { segments: rest.split('/').filter((s) => s.length > 0) };
}

/**
 * Classify the role of a path inside `.lerret/`, exactly as the loader would.
 *
 * The watcher does not know whether a given path is a file or a folder — the
 * raw event carries only a path string. `isDirectory` resolves that
 * ambiguity when the consumer knows (chokidar tells us); when unknown,
 * extension is the tiebreak.
 *
 * @param {LerretPath} scanRoot
 * @param {LerretPath} path
 * @param {boolean} [isDirectory]
 *   Known kind, when the watcher reports it. Omit if unknown — then any path
 *   without a recognized file extension is treated as a folder, matching the
 *   behavior `chokidar`'s `addDir` / `unlinkDir` events would have given.
 * @returns {{ role: PathRole, segments: string[], name: string }}
 */
export function classifyPath(scanRoot, path, isDirectory) {
  const rel = relativeSegments(scanRoot, path);
  if (rel === null) {
    return { role: 'irrelevant', segments: [], name: '' };
  }
  const { segments } = rel;
  if (segments.length === 0) {
    // The scan root itself — never a model node.
    return { role: 'irrelevant', segments, name: '' };
  }
  const top = segments[0];
  const name = segments[segments.length - 1];
  const isUnderscoreRoot = top.startsWith('_');

  // Decide file vs folder. An explicit boolean from the watcher wins;
  // otherwise a recognized file extension marks a file, anything else a
  // folder — the only ambiguous case is a directory whose name happens to
  // contain a dot, which is rare and harmless either way.
  let directoryLike;
  if (isDirectory === true) {
    directoryLike = true;
  } else if (isDirectory === false) {
    directoryLike = false;
  } else {
    const { ext } = splitExtension(name);
    directoryLike = ext === '' || (!ASSET_EXTENSIONS[ext] && !FONT_EXTENSIONS[ext]);
  }

  // The `_fonts/<font>` special case (FR12).
  if (isUnderscoreRoot && top === '_fonts' && segments.length === 2 && !directoryLike) {
    const { ext } = splitExtension(name);
    if (FONT_EXTENSIONS[ext]) {
      return { role: 'font-file', segments, name };
    }
    return { role: 'irrelevant', segments, name };
  }
  // Any other path inside a reserved (`_`) root folder is silent for the
  // model — `_assets/foo.png` is not an asset, it is a resource the user's
  // code imports (FR5).
  if (isUnderscoreRoot) {
    if (segments.length === 1 && directoryLike) {
      return { role: 'reserved-folder', segments, name };
    }
    return { role: 'irrelevant', segments, name };
  }

  if (directoryLike) {
    if (segments.length === 1) {
      return { role: 'page-folder', segments, name };
    }
    return { role: 'group-folder', segments, name };
  }

  // A file at root is not an asset (assets live inside pages/groups).
  if (segments.length < 2) {
    return { role: 'irrelevant', segments, name };
  }
  const { ext } = splitExtension(name);
  if (ASSET_EXTENSIONS[ext]) {
    return { role: 'asset-file', segments, name };
  }
  // `config.json`, `.data.json`, images, anything else — not in the model.
  return { role: 'irrelevant', segments, name };
}

// ---------------------------------------------------------------------------
// Tree patch primitives — pure, return-new style
// ---------------------------------------------------------------------------

/**
 * @typedef {PageNode | GroupNode} Container
 *   A page or a group — anything that holds `groups[]` + `assets[]`.
 */

/**
 * Locate the container at `containerPath` inside `project`, returning the
 * stack of ancestors from root → leaf (`[project, page, ...groups, container]`)
 * — or `null` if no such page/group exists.
 *
 * The stack lets the caller rebuild every level above the leaf when patching:
 * a deep change in a group means returning new instances of that group, its
 * parents, the page, and the project so React sees fresh references.
 *
 * Pure: nothing mutated, no filesystem.
 *
 * @param {ProjectNode} project
 * @param {LerretPath} containerPath
 * @returns {Array<ProjectNode | PageNode | GroupNode> | null}
 */
function findContainerStack(project, containerPath) {
  if (project.path === containerPath) {
    return [project];
  }
  for (const page of project.pages) {
    if (page.path === containerPath) {
      return [project, page];
    }
    if (containerPath.startsWith(page.path + '/')) {
      const sub = findGroupStack(page, containerPath);
      if (sub) return [project, page, ...sub];
    }
  }
  return null;
}

/**
 * Recursive helper for {@link findContainerStack}: walk a page-or-group's
 * `groups[]` looking for the group whose `path === containerPath`.
 *
 * @param {Container} container
 * @param {LerretPath} containerPath
 * @returns {GroupNode[] | null}
 */
function findGroupStack(container, containerPath) {
  for (const group of container.groups) {
    if (group.path === containerPath) {
      return [group];
    }
    if (containerPath.startsWith(group.path + '/')) {
      const sub = findGroupStack(group, containerPath);
      if (sub) return [group, ...sub];
    }
  }
  return null;
}

/**
 * Return a copy of `project` with one of its pages replaced. The order in
 * `pages[]` is preserved (the caller decides where the replacement goes).
 *
 * @param {ProjectNode} project
 * @param {PageNode[]} newPages
 * @returns {ProjectNode}
 */
function withPages(project, newPages) {
  return { ...project, pages: newPages };
}

/**
 * Return a copy of `container` with the supplied groups/assets — both fields
 * default to the existing ones, so a caller patching one passes only that.
 *
 * @template {Container} C
 * @param {C} container
 * @param {{ groups?: GroupNode[], assets?: AssetNode[] }} patch
 * @returns {C}
 */
function withChildren(container, patch) {
  return {
    ...container,
    groups: patch.groups ?? container.groups,
    assets: patch.assets ?? container.assets,
  };
}

/**
 * Rebuild a container stack from leaf upward, swapping the leaf for `newLeaf`
 * and replacing each parent's reference to its child along the way. Returns
 * the new root (always a fresh {@link ProjectNode}).
 *
 * @param {Array<ProjectNode | PageNode | GroupNode>} stack
 * @param {PageNode | GroupNode} newLeaf
 * @returns {ProjectNode}
 */
function replaceLeafInStack(stack, newLeaf) {
  let child = newLeaf;
  for (let i = stack.length - 2; i >= 0; i--) {
    const parent = stack[i];
    if (parent.kind === NODE_KIND.PROJECT) {
      const pages = parent.pages.map((p) => (p.path === child.path ? /** @type {PageNode} */ (child) : p));
      return withPages(parent, pages);
    }
    // parent is a page or a group — child is a group.
    const groups = parent.groups.map((g) => (g.path === child.path ? /** @type {GroupNode} */ (child) : g));
    child = withChildren(parent, { groups });
  }
  // Shouldn't reach here in practice — replaceLeafInStack is only called with
  // stacks of length >= 2 (the project node is always at index 0).
  return /** @type {ProjectNode} */ (child);
}

// ---------------------------------------------------------------------------
// Operation: add
// ---------------------------------------------------------------------------

/**
 * Add a new page to `project.pages` in canonical (name-sorted) order. A
 * duplicate by `path` is silently merged — re-adding the same page is a no-op
 * on the model, the same way `scan` would not produce duplicates.
 *
 * @param {ProjectNode} project
 * @param {string} pageName
 * @param {LerretPath} pagePath
 * @returns {ProjectNode}
 */
function addPage(project, pageName, pagePath) {
  if (project.pages.some((p) => p.path === pagePath)) {
    return project;
  }
  const next = [...project.pages, createPageNode({ name: pageName, path: pagePath })];
  next.sort(byKey((p) => p.name));
  return withPages(project, next);
}

/**
 * Add a new group inside `parentPath` — which may be a page or another group.
 * If `parentPath` does not exist in the model the add is silently ignored
 * (most likely a race where the parent has not been seen yet).
 *
 * @param {ProjectNode} project
 * @param {LerretPath} parentLerretPath
 * @param {string} groupName
 * @param {LerretPath} groupPath
 * @returns {ProjectNode}
 */
function addGroup(project, parentLerretPath, groupName, groupPath) {
  const stack = findContainerStack(project, parentLerretPath);
  if (stack === null) return project;
  const leaf = /** @type {Container} */ (stack[stack.length - 1]);
  if (leaf.kind === NODE_KIND.PROJECT) {
    // The project root doesn't directly hold groups — groups live in pages
    // or other groups. A `'group-folder'` whose parent is the project root
    // means it is actually a top-level folder under `.lerret/`, classified
    // as a page elsewhere; reach here only on malformed input.
    return project;
  }
  if (leaf.groups.some((g) => g.path === groupPath)) {
    return project;
  }
  const groups = [...leaf.groups, createGroupNode({ name: groupName, path: groupPath })].sort(
    byKey((g) => g.name),
  );
  const newLeaf = withChildren(leaf, { groups });
  return replaceLeafInStack(stack, newLeaf);
}

/**
 * Add a new asset inside the page or group at `parentPath`. Silently ignored
 * if `parentPath` is unknown or if the asset already exists.
 *
 * @param {ProjectNode} project
 * @param {LerretPath} parentLerretPath
 * @param {string} fileName
 * @param {LerretPath} assetPath
 * @returns {ProjectNode}
 */
function addAsset(project, parentLerretPath, fileName, assetPath) {
  const stack = findContainerStack(project, parentLerretPath);
  if (stack === null) return project;
  const leaf = /** @type {Container} */ (stack[stack.length - 1]);
  if (leaf.kind === NODE_KIND.PROJECT) return project;
  if (leaf.assets.some((a) => a.path === assetPath)) {
    return project;
  }
  const { stem, ext } = splitExtension(fileName);
  const assetKind = ASSET_EXTENSIONS[ext];
  if (assetKind === undefined) return project; // shouldn't happen — classify already filtered.
  const asset = createAssetNode({
    name: stem,
    fileName,
    path: assetPath,
    assetKind,
    ext,
  });
  const assets = [...leaf.assets, asset].sort(byKey((a) => a.fileName));
  const newLeaf = withChildren(leaf, { assets });
  return replaceLeafInStack(stack, newLeaf);
}

/**
 * Add (or replace) a recognized font file in `project.fonts`. Skips
 * unrecognized extensions (the file would have been classified as
 * `'irrelevant'` anyway).
 *
 * @param {ProjectNode} project
 * @param {string} fileName
 * @param {LerretPath} fontPath
 * @returns {ProjectNode}
 */
function addFont(project, fileName, fontPath) {
  const font = createFontFile({ fileName, path: fontPath });
  if (font === null) return project;
  // Replace an existing entry with the same path so `add` after `change` of
  // the same font file is idempotent.
  const others = project.fonts.filter((f) => f.path !== fontPath);
  const fonts = [...others, font].sort(byKey((f) => f.fileName));
  return { ...project, fonts };
}

// ---------------------------------------------------------------------------
// Operation: remove
// ---------------------------------------------------------------------------

/**
 * Remove every page, group, asset, and font file at or under `path` from the
 * project — used for both a precise file remove and a folder remove (the
 * folder remove cascades to every nested model node, since `scan` had built
 * them all from the same subtree).
 *
 * Anything not present in the model (or not under `.lerret/`) is silently
 * ignored.
 *
 * @param {ProjectNode} project
 * @param {LerretPath} removedPath
 * @returns {ProjectNode}
 */
function removeUnder(project, removedPath) {
  // Drop matching pages outright. A page removed cascades — its descendant
  // groups and assets are dropped with it. We track whether anything actually
  // changed (rather than rebuilding `pages` unconditionally) so the patcher
  // can return the *same* `project` reference for a no-op remove — the
  // canonical "did this change anything?" signal callers depend on.
  let pagesChanged = false;
  const pages = [];
  for (const page of project.pages) {
    if (pathIsUnder(removedPath, page.path)) {
      pagesChanged = true;
      continue; // the page (and every descendant) is gone
    }
    const next = removeFromContainer(page, removedPath);
    if (next !== page) pagesChanged = true;
    pages.push(next);
  }

  // Drop matching fonts — same reference-identity discipline.
  let fontsChanged = false;
  const fonts = [];
  for (const font of project.fonts) {
    if (pathIsUnder(removedPath, font.path)) {
      fontsChanged = true;
      continue;
    }
    fonts.push(font);
  }

  if (!pagesChanged && !fontsChanged) {
    return project;
  }
  return {
    ...project,
    pages: pagesChanged ? pages : project.pages,
    fonts: fontsChanged ? fonts : project.fonts,
  };
}

/**
 * Apply `removeUnder` recursively to a container, returning a new container
 * (or the same one when nothing changed).
 *
 * @template {Container} C
 * @param {C} container
 * @param {LerretPath} removedPath
 * @returns {C}
 */
function removeFromContainer(container, removedPath) {
  // If the remove targets this very container, the caller already filtered
  // it out — reaching here means we keep the container itself and prune its
  // children.
  let changed = false;
  const groups = [];
  for (const group of container.groups) {
    if (pathIsUnder(removedPath, group.path)) {
      changed = true;
      continue; // entire group (and its descendants) is gone
    }
    const next = removeFromContainer(group, removedPath);
    if (next !== group) changed = true;
    groups.push(next);
  }
  const assets = container.assets.filter((a) => !pathIsUnder(removedPath, a.path));
  if (assets.length !== container.assets.length) changed = true;
  if (!changed) return container;
  return withChildren(container, { groups, assets });
}

// ---------------------------------------------------------------------------
// Public: applyWatchEvent
// ---------------------------------------------------------------------------

/**
 * Apply one normalized {@link WatchEvent} to the in-memory project model.
 * Returns a new {@link ProjectNode} when the event affected the model; the
 * same `project` reference when it did not (so callers can `if (next !==
 * prev)` to decide whether a re-render is needed).
 *
 * Mapping rules — identical to `scan`'s (FR2-7, FR12):
 *
 * - `add`/`remove` of a regular root folder → page added/removed.
 * - `add`/`remove` of a folder nested inside a page or group → group
 *   added/removed. A folder remove cascades to every nested asset / group.
 * - `add`/`remove` of a `.jsx`/`.tsx`/`.md` file inside a page/group → asset
 *   added/removed.
 * - `add`/`remove` of a font file directly inside `_fonts/` → font added/
 *   removed on `project.fonts`.
 * - A `change` event is a content-only change. The model identity of the
 *   path does not change, so this is a no-op on the model — the studio's
 *   asset runtime handles content re-evaluation separately. Returning the
 *   same `project` lets callers skip the re-render path when only content
 *   moved.
 * - Anything else (a `_assets/` file, a `config.json`, a root file, an
 *   asset extension inside a reserved folder) is silent.
 *
 * @param {ProjectNode} project   The current project model.
 * @param {WatchEvent} event      The normalized change event.
 * @param {object} [opts]
 * @param {boolean} [opts.isDirectory]
 *   Watcher-known kind for the path. If the watcher reports `addDir` /
 *   `unlinkDir` chokidar already distinguishes file from folder; pass
 *   that knowledge through so the classifier never has to guess.
 * @returns {ProjectNode}
 */
export function applyWatchEvent(project, event, opts = {}) {
  if (project == null || project.kind !== NODE_KIND.PROJECT) {
    throw new TypeError('applyWatchEvent(project): expected a ProjectNode');
  }
  if (event == null || typeof event !== 'object') {
    throw new TypeError('applyWatchEvent(event): expected a WatchEvent');
  }
  const { type, path } = event;
  if (
    type !== watchEventType.ADD &&
    type !== watchEventType.CHANGE &&
    type !== watchEventType.REMOVE
  ) {
    throw new TypeError(`applyWatchEvent: unknown event type: ${String(type)}`);
  }
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('applyWatchEvent: event.path must be a non-empty string');
  }

  // Content-only edits never restructure the tree.
  if (type === watchEventType.CHANGE) {
    return project;
  }

  // For a remove the watcher's `isDirectory` is often unknown (the path is
  // gone). The classifier's extension fallback handles both cases; a folder
  // remove cascades correctly through `removeUnder` regardless of whether
  // we recognized the kind precisely.
  if (type === watchEventType.REMOVE) {
    return removeUnder(project, path);
  }

  // Add. Classify and route to the right add primitive.
  const cls = classifyPath(project.path, path, opts.isDirectory);
  switch (cls.role) {
    case 'page-folder':
      return addPage(project, cls.name, path);
    case 'group-folder': {
      const parent = parentPath(path);
      return addGroup(project, parent, cls.name, path);
    }
    case 'asset-file': {
      const parent = parentPath(path);
      return addAsset(project, parent, cls.name, path);
    }
    case 'font-file':
      return addFont(project, cls.name, path);
    case 'reserved-folder':
    case 'irrelevant':
    default:
      return project;
  }
}

// ---------------------------------------------------------------------------
// Re-exports — the small public surface
// ---------------------------------------------------------------------------

export { baseName, parentPath };
