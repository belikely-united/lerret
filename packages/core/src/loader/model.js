// The canonical in-memory project model — the shapes the loader builds and the
// canvas renders (architecture: "Project model — In-memory tree (project →
// pages → groups → assets), built by the loader").
//
// The filesystem is the source of truth; this model is a *derived cache* of a
// `.lerret/` folder tree. Four node kinds make up the tree:
//
//   project ── pages[] ──┬── groups[]  (nestable, arbitrary depth)
//                        └── assets[]
//   group   ── groups[]  (nestable) + assets[]
//
// A page is a regular (non-underscore) folder directly under `.lerret/`; a
// group is any folder nested inside a page or another group; an asset is a
// recognized asset file (`.jsx` / `.tsx` / `.md`) inside a page or group.
//
// This file is PURE — JSDoc `@typedef`s plus small plain-data constructors and
// predicates. No filesystem access, no Node built-ins, no DOM APIs. All path
// values are {@link LerretPath} strings (forward-slash separators); the model
// never holds OS-native paths.

/**
 * @typedef {import('../fs/filesystem.js').LerretPath} LerretPath
 */

// ---------------------------------------------------------------------------
// Node-kind discriminant
// ---------------------------------------------------------------------------

/**
 * The `kind` discriminant carried by every model node, so consumers can branch
 * with a plain `switch` (`node.kind`) instead of structural sniffing.
 *
 * @typedef {'project' | 'page' | 'group' | 'asset'} NodeKind
 */

/**
 * The frozen set of node-kind string constants. Importing these avoids stray
 * string literals in consumers (the canvas, the watcher, tests).
 *
 * @type {Readonly<{ PROJECT: 'project', PAGE: 'page', GROUP: 'group', ASSET: 'asset' }>}
 */
export const NODE_KIND = Object.freeze({
  PROJECT: 'project',
  PAGE: 'page',
  GROUP: 'group',
  ASSET: 'asset',
});

// ---------------------------------------------------------------------------
// Asset kinds
// ---------------------------------------------------------------------------

/**
 * The kind of a recognized asset file, derived from its file extension.
 *
 * - `'component'` — a `.jsx` or `.tsx` file: a React component rendered as a
 *   live artboard (FR8).
 * - `'markdown'` — a `.md` file: rendered as a Markdown card on the canvas.
 *
 * @typedef {'component' | 'markdown'} AssetKind
 */

/**
 * The frozen set of asset-kind string constants.
 *
 * @type {Readonly<{ COMPONENT: 'component', MARKDOWN: 'markdown' }>}
 */
export const ASSET_KIND = Object.freeze({
  COMPONENT: 'component',
  MARKDOWN: 'markdown',
});

/**
 * Map of recognized asset file extension (lower-case, leading dot) to its
 * {@link AssetKind}. The loader uses this both to decide whether a file is an
 * asset at all and to classify the ones that are (FR4).
 *
 * @type {Readonly<Record<string, AssetKind>>}
 */
export const ASSET_EXTENSIONS = Object.freeze({
  '.jsx': ASSET_KIND.COMPONENT,
  '.tsx': ASSET_KIND.COMPONENT,
  '.md': ASSET_KIND.MARKDOWN,
});

// ---------------------------------------------------------------------------
// Font files
// ---------------------------------------------------------------------------

/**
 * Recognized font-file extensions (lower-case, leading dot) mapped to the CSS
 * `@font-face` `format()` hint for that file type. A file in the reserved
 * `_fonts/` root folder is registered as a custom font only if its extension
 * is one of these; any other file there is skipped (FR12).
 *
 * `.ttf` / `.otf` share the `'truetype'` / `'opentype'` formats; `.woff` and
 * `.woff2` are the compressed web formats. The format hint is advisory — every
 * modern browser sniffs the file anyway — but emitting it keeps the generated
 * `@font-face` rule correct and explicit.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FONT_EXTENSIONS = Object.freeze({
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
});

/**
 * A **font file** discovered in the reserved `.lerret/_fonts/` folder (FR12).
 *
 * Not a model *node* — `_fonts/` is reserved and never enters the page tree —
 * but a small plain-data record the loader records on the {@link ProjectNode}
 * so the studio can register each font with an `@font-face` rule. The studio
 * makes the font available to assets by its `family` name.
 *
 * @typedef {object} FontFile
 * @property {string} family
 *   The CSS font-family name the font is registered under — derived from the
 *   file name without its extension (e.g. `"MyBrandFont"` for
 *   `MyBrandFont.woff2`). This is the name an asset's CSS references.
 * @property {string} fileName
 *   The font file's full name with extension (e.g. `"MyBrandFont.woff2"`).
 * @property {LerretPath} path
 *   The font file's full normalized path (forward-slash separators), as the
 *   filesystem backend reported it. The studio resolves the served font URL
 *   from this.
 * @property {string} ext
 *   The file extension, lower-cased, including the leading dot (e.g.
 *   `".woff2"`).
 * @property {string} format
 *   The CSS `@font-face` `format()` hint for this file type (`'woff2'`,
 *   `'woff'`, `'truetype'`, `'opentype'`) — from {@link FONT_EXTENSIONS}.
 */

// ---------------------------------------------------------------------------
// Canonical node shapes
// ---------------------------------------------------------------------------

/**
 * An **asset node** — one recognized asset file inside a page or group (FR4).
 *
 * A leaf of the model tree: an asset has no children. The canvas renders a
 * component asset as a live React artboard and a markdown asset as a Markdown
 * card.
 *
 * @typedef {object} AssetNode
 * @property {'asset'} kind
 *   Discriminant — always `'asset'`.
 * @property {string} name
 *   The asset's display name: the file name *without* its extension
 *   (e.g. `"Button"` for `Button.jsx`). The canvas labels the artboard with
 *   this.
 * @property {string} fileName
 *   The asset's full file name *with* extension (e.g. `"Button.jsx"`) — the
 *   final segment of {@link AssetNode.path}.
 * @property {LerretPath} path
 *   The asset file's full normalized path (forward-slash separators), as the
 *   filesystem backend reported it. The runtime loads the file from here.
 * @property {AssetKind} assetKind
 *   `'component'` or `'markdown'` — classified from the file extension.
 * @property {string} ext
 *   The file extension, lower-cased, including the leading dot
 *   (e.g. `".jsx"`).
 */

/**
 * A **group node** — a folder nested inside a page or another group (FR3).
 *
 * Groups nest to arbitrary depth: a group's `groups` array may itself contain
 * groups. A group with no recognized children is still a valid node — its
 * `groups` and `assets` arrays are simply empty.
 *
 * @typedef {object} GroupNode
 * @property {'group'} kind
 *   Discriminant — always `'group'`.
 * @property {string} name
 *   The group's real folder name (e.g. `"components"`) — carried so the canvas
 *   can display it (FR3).
 * @property {LerretPath} path
 *   The group folder's full normalized path (forward-slash separators).
 * @property {GroupNode[]} groups
 *   Child group nodes — subfolders of this group. May be empty. Sorted by
 *   `name` for a stable, diffable model.
 * @property {AssetNode[]} assets
 *   Asset nodes — recognized asset files directly inside this group. May be
 *   empty. Sorted by `fileName`.
 */

/**
 * A **page node** — a regular (non-underscore) folder directly under
 * `.lerret/` (FR2).
 *
 * Structurally identical to a {@link GroupNode} (a named folder holding groups
 * and assets); the distinct `kind` marks it as a top-level page rather than a
 * nested group, which the canvas treats differently. An empty page is a valid
 * node with empty `groups` and `assets`.
 *
 * @typedef {object} PageNode
 * @property {'page'} kind
 *   Discriminant — always `'page'`.
 * @property {string} name
 *   The page's real folder name — carried so the canvas can display it (FR2).
 * @property {LerretPath} path
 *   The page folder's full normalized path (forward-slash separators).
 * @property {GroupNode[]} groups
 *   Child group nodes — subfolders of this page. May be empty. Sorted by
 *   `name`.
 * @property {AssetNode[]} assets
 *   Asset nodes — recognized asset files directly inside this page. May be
 *   empty. Sorted by `fileName`.
 */

/**
 * The **project node** — the root of the model tree.
 *
 * Holds the project's pages. Reserved underscore-prefixed root folders
 * (`_fonts/`, `_assets/`, …) are NOT represented as pages or groups (FR5) —
 * they never enter the page tree. The `_fonts/` folder is the one exception
 * that leaves a trace: its font files are recorded on {@link ProjectNode.fonts}
 * (still not as model nodes) so the studio can auto-register them (FR12). The
 * folders themselves remain on disk untouched.
 *
 * @typedef {object} ProjectNode
 * @property {'project'} kind
 *   Discriminant — always `'project'`.
 * @property {string} name
 *   The project's display name — the name of the folder that *contains*
 *   `.lerret/` (i.e. the project root), derived from the scan-root path.
 * @property {LerretPath} path
 *   The full normalized path of the scanned `.lerret/` directory itself.
 * @property {PageNode[]} pages
 *   The project's page nodes — one per regular subfolder of `.lerret/`. May be
 *   empty (a project with no pages). Sorted by `name`.
 * @property {FontFile[]} fonts
 *   Custom font files discovered in the reserved `.lerret/_fonts/` folder
 *   (FR12). Empty when `_fonts/` is absent, empty, or holds only unsupported
 *   file types. Sorted by `fileName`. These are font *files*, not model nodes —
 *   the studio registers each as an `@font-face` rule.
 */

/**
 * Any node in the project model — the union the canvas and watcher walk.
 *
 * @typedef {ProjectNode | PageNode | GroupNode | AssetNode} ModelNode
 */

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------
//
// Plain-data factories: every node in the model is created through one of
// these so the shape is constructed in exactly one place. They normalize
// nothing and read no filesystem — pure object assembly.

/**
 * Build an {@link AssetNode}.
 *
 * @param {object} fields
 * @param {string} fields.name      Display name — file name without extension.
 * @param {string} fields.fileName  Full file name with extension.
 * @param {LerretPath} fields.path  The asset file's normalized path.
 * @param {AssetKind} fields.assetKind  `'component'` or `'markdown'`.
 * @param {string} fields.ext       Lower-cased extension including the dot.
 * @returns {AssetNode}
 */
export function createAssetNode({ name, fileName, path, assetKind, ext }) {
  return { kind: NODE_KIND.ASSET, name, fileName, path, assetKind, ext };
}

/**
 * Build a {@link GroupNode}.
 *
 * @param {object} fields
 * @param {string} fields.name             The group's real folder name.
 * @param {LerretPath} fields.path         The group folder's normalized path.
 * @param {GroupNode[]} [fields.groups=[]]  Child groups.
 * @param {AssetNode[]} [fields.assets=[]]  Child assets.
 * @returns {GroupNode}
 */
export function createGroupNode({ name, path, groups = [], assets = [] }) {
  return { kind: NODE_KIND.GROUP, name, path, groups, assets };
}

/**
 * Build a {@link PageNode}.
 *
 * @param {object} fields
 * @param {string} fields.name             The page's real folder name.
 * @param {LerretPath} fields.path         The page folder's normalized path.
 * @param {GroupNode[]} [fields.groups=[]]  Child groups.
 * @param {AssetNode[]} [fields.assets=[]]  Child assets.
 * @returns {PageNode}
 */
export function createPageNode({ name, path, groups = [], assets = [] }) {
  return { kind: NODE_KIND.PAGE, name, path, groups, assets };
}

/**
 * Build a {@link ProjectNode}.
 *
 * @param {object} fields
 * @param {string} fields.name           The project's display name.
 * @param {LerretPath} fields.path       The scanned `.lerret/` directory path.
 * @param {PageNode[]} [fields.pages=[]]  The project's pages.
 * @param {FontFile[]} [fields.fonts=[]]  Custom fonts from `_fonts/` (FR12).
 * @returns {ProjectNode}
 */
export function createProjectNode({ name, path, pages = [], fonts = [] }) {
  return { kind: NODE_KIND.PROJECT, name, path, pages, fonts };
}

/**
 * Build a {@link FontFile} from a font-file directory entry in the reserved
 * `_fonts/` folder (FR12), or return `null` if the file's extension is not a
 * recognized font type — so a non-font file in `_fonts/` is simply skipped.
 *
 * The `family` name is derived from the file name without its extension; the
 * `format` hint is looked up from {@link FONT_EXTENSIONS}.
 *
 * @param {object} fields
 * @param {string} fields.fileName   The font file's full name with extension.
 * @param {LerretPath} fields.path   The font file's normalized path.
 * @returns {FontFile | null}
 */
export function createFontFile({ fileName, path }) {
  const dot = fileName.lastIndexOf('.');
  const ext = dot <= 0 ? '' : fileName.slice(dot).toLowerCase();
  const format = FONT_EXTENSIONS[ext];
  if (format === undefined) {
    return null; // Not a recognized font file — skipped (FR12).
  }
  return {
    family: dot <= 0 ? fileName : fileName.slice(0, dot),
    fileName,
    path,
    ext,
    format,
  };
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * @param {ModelNode} node
 * @returns {node is ProjectNode} `true` iff `node` is a project node.
 */
export function isProjectNode(node) {
  return node != null && node.kind === NODE_KIND.PROJECT;
}

/**
 * @param {ModelNode} node
 * @returns {node is PageNode} `true` iff `node` is a page node.
 */
export function isPageNode(node) {
  return node != null && node.kind === NODE_KIND.PAGE;
}

/**
 * @param {ModelNode} node
 * @returns {node is GroupNode} `true` iff `node` is a group node.
 */
export function isGroupNode(node) {
  return node != null && node.kind === NODE_KIND.GROUP;
}

/**
 * @param {ModelNode} node
 * @returns {node is AssetNode} `true` iff `node` is an asset node.
 */
export function isAssetNode(node) {
  return node != null && node.kind === NODE_KIND.ASSET;
}
