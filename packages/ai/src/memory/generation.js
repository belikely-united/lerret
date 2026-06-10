// Generation substrate helpers (FR54 / AC-4, AC-5) — PURE: no fs, no DOM, no
// `node:*`. These functions PLAN Worker steps; they do NOT write. The Worker
// (Story 8.3, via the sandbox) executes the returned `{ op: 'write', ... }`
// steps unchanged — the step shape matches `worker.js`'s `WorkerStep` union.
//
// This story REUSES the v1 generation substrate rather than reinventing it:
//   - `<Name>.data.json` co-location + discovery: `@lerret/core`'s
//     `data/loader.js` (a `<ComponentBasename>.data.json` next to the
//     component IS the loadable shape — no new render path).
//   - named-export variant → artboard expansion: `@lerret/core`'s
//     `assets/variants.js` `resolveVariants` (the `.data.json` keys the
//     per-variant data; FR23).
//   - four-tier prop resolution: `@lerret/core`'s `config/resolve-props.js`
//     `resolveProps` (`data → vars → propsSchema → component default`; FR24).
//
// The canvas re-render is the existing v1 watcher → loader → re-render chain;
// there is NO new render path (architecture §Asset Runtime).

/**
 * @typedef {{ op: 'write', path: string, content: string }} WriteStep
 *   Mirrors `orchestrator/agents/worker.js`'s `WorkerStep` write variant so the
 *   Worker executes a planned step with no translation.
 */

/**
 * Return the directory portion of a forward-slash path (everything up to but
 * EXCLUDING the last `/`). A path with no `/` returns `''`.
 *
 * @param {string} path
 * @returns {string}
 */
function dirNameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/**
 * Return the basename of a component file WITHOUT its extension — the stem the
 * v1 data-loader co-location rule keys on (`Hero.jsx` → `Hero`, so the data
 * file is `Hero.data.json`). Stems at the LAST dot, exactly like core's
 * loader, so a dotted component name survives (`Card.v2.jsx` → `Card.v2` →
 * data file `Card.v2.data.json`). A `.data.json` input additionally drops the
 * `.data` suffix (`Card.data.json` → `Card`).
 *
 * @param {string} componentPath
 * @returns {string}
 */
export function componentBasename(componentPath) {
  const base = componentPath.slice(componentPath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  let stem = dot <= 0 ? base : base.slice(0, dot);
  if (stem.endsWith('.data')) stem = stem.slice(0, -'.data'.length);
  return stem;
}

/**
 * Stable-stringify the data JSON with two-space indent + trailing newline so
 * the generated file is git-diffable and matches the v1 formatter's output.
 *
 * @param {unknown} value
 * @returns {string}
 */
function serializeDataJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Plan the `<ComponentBasename>.data.json` file that drives a component's
 * variant artboards (FR23/FR24). Given a target component path and the
 * per-variant data (a map keyed by named-export variant name, OR a plain
 * shared object applied to every variant), produce the co-located data-file
 * path + the JSON payload + a single Worker write step.
 *
 * This is the PLAN, not the write. The Worker writes the returned step; the
 * existing v1 runtime (`data/loader.js` discovers the file → `resolveVariants`
 * splits the exports → `resolveProps` resolves props) renders it with NO new
 * render path. The generated `.data.json` shape is exactly what
 * `loadAssetData` reads back.
 *
 * @param {{ componentPath: string, variantData: object }} args
 *   `componentPath` — the asset component file the data co-locates with.
 *   `variantData`   — keyed (`{ Dark: {...}, Compact: {...} }`) or shared
 *                     (`{ title: '...' }`) per-variant data.
 * @returns {{ dataFilePath: string, dataJson: object, steps: WriteStep[] }}
 */
export function planVariantExpansion({ componentPath, variantData } = {}) {
  if (typeof componentPath !== 'string' || componentPath.length === 0) {
    throw new TypeError('planVariantExpansion: componentPath must be a non-empty string');
  }
  const dir = dirNameOf(componentPath);
  const stem = componentBasename(componentPath);
  const dataFilePath = dir ? `${dir}/${stem}.data.json` : `${stem}.data.json`;
  const dataJson =
    variantData && typeof variantData === 'object' && !Array.isArray(variantData)
      ? variantData
      : {};
  /** @type {WriteStep} */
  const step = { op: 'write', path: dataFilePath, content: serializeDataJson(dataJson) };
  return { dataFilePath, dataJson, steps: [step] };
}

// ---------------------------------------------------------------------------
// Brand-asset copy planning (AC-5)
// ---------------------------------------------------------------------------

/**
 * The brand-index `type`s whose CONTENT is text (SVG) and therefore safe to
 * copy through the utf-8 read + write step. Raster `image` entries are
 * indexed (filename + type) but NEVER copy candidates in v1 — a utf-8 read
 * of PNG/JPEG bytes would corrupt the copy. Raster copies are deferred to
 * Story 8.7 (the vision/binary path).
 */
const TEXT_SAFE_COPY_TYPES = new Set(['logo', 'vector']);

/** Keyword → brand-index `type` affinity for matching a request to an asset. */
const REQUEST_TYPE_HINTS = [
  { re: /\blogo(?:type|mark)?\b/i, types: ['logo'] },
  { re: /\bswatch|palette|color\b/i, types: ['vector'] },
  { re: /\bicon\b/i, types: ['logo', 'vector'] },
];

/**
 * Score a brand-index entry against a free-text request. A direct filename /
 * basename substring hit scores highest; a type-hint match scores next; a
 * generic asset scores lowest. Returns a number ≥ 0 (0 = no match).
 *
 * @param {{ name: string, type: string }} entry
 * @param {string} request
 * @returns {number}
 */
function scoreBrandAsset(entry, request) {
  const name = String(entry?.name ?? '');
  const stem = name.slice(
    0,
    name.lastIndexOf('.') >= 0 ? name.lastIndexOf('.') : name.length,
  );
  const req = String(request ?? '').toLowerCase();
  let score = 0;
  // Direct name / stem reference in the request.
  if (stem.length > 0 && req.includes(stem.toLowerCase())) score += 100;
  // Type-hint affinity.
  for (const hint of REQUEST_TYPE_HINTS) {
    if (hint.re.test(req) && hint.types.includes(entry?.type)) {
      score += 50;
      // A "logo" request should also reward an entry literally named logo.
      if (hint.types.includes('logo') && /logo/i.test(stem)) score += 25;
    }
  }
  // The word in the request also appearing in the filename stem (e.g.
  // "include our logo" + `logo.svg`).
  for (const word of req.split(/[^a-z0-9]+/i)) {
    if (word.length >= 3 && stem.toLowerCase().includes(word)) score += 30;
  }
  return score;
}

/**
 * Select the brand asset that best matches a request and plan the Worker step
 * that copies its CONTENT into the target asset's folder (AC-5). The byte read
 * of `.lerret/_brand/<file>` is the Memory agent's `fs` read (the read helper
 * is `readBrandAsset` in `orchestrator/agents/memory.js`); this planner does
 * the SELECTION + produces the write step. The content is supplied by the
 * caller (already read) so this helper stays pure.
 *
 * Returns an EMPTY array when no brand asset matches (graceful — the turn
 * proceeds without a copied asset).
 *
 * Candidates are filtered to TEXT-SAFE types (`logo`, `vector` — SVG content)
 * BEFORE scoring: a raster (`image`) can never be selected, because the only
 * read path is utf-8 text and a text round-trip of raster bytes corrupts the
 * copy (the no-image-bytes guardrail). Raster copies are deferred to Story
 * 8.7's vision/binary path.
 *
 * @param {{
 *   brandIndex: Array<{ name: string, type: string, path?: string }>,
 *   request: string,
 *   targetDir: string,
 *   readContent?: (entry: { name: string, type: string, path?: string }) => string,
 * }} args
 *   `brandIndex` — `indexBrandFolder()` output.
 *   `request`    — the free-text brand-asset request ("include our logo").
 *   `targetDir`  — the destination folder for the copied asset.
 *   `readContent`— optional sync resolver returning the asset's text content;
 *                  when omitted the step carries `content: ''` and the caller
 *                  fills it after reading (the Worker owns the byte copy).
 * @returns {WriteStep[]}
 */
export function planBrandAssetCopy({ brandIndex, request, targetDir, readContent } = {}) {
  if (!Array.isArray(brandIndex) || brandIndex.length === 0) return [];
  // Text-safe candidates ONLY (see the guardrail note above) — a raster can
  // never win the scoring, so an index of only rasters plans nothing.
  const candidates = brandIndex.filter((e) => TEXT_SAFE_COPY_TYPES.has(e?.type));
  let best = null;
  let bestScore = 0;
  for (const entry of candidates) {
    const s = scoreBrandAsset(entry, request);
    if (s > bestScore) {
      best = entry;
      bestScore = s;
    }
  }
  if (!best || bestScore === 0) return [];
  const dir = typeof targetDir === 'string' ? targetDir.replace(/\/$/, '') : '';
  const destPath = dir ? `${dir}/${best.name}` : best.name;
  const content = typeof readContent === 'function' ? readContent(best) : '';
  return [{ op: 'write', path: destPath, content }];
}
