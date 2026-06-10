// Preset discovery (FR54 / AC-4) — PURE: no fs, no DOM, no `node:*`.
//
// When the Planner (Story 8.3) decomposes a generation prompt ("social post
// about the v0.4 launch"), it needs to know which themed preset pages already
// exist in the project so generation can route into the right page. The known
// v1 / Epic 7 preset names are frozen below; discovery walks the loaded project
// model's pages and matches them by TWO heuristics:
//
//   1. `_meta.preset` — the page's cascaded config carries a `_meta.preset`
//      string equal to a known preset name (the authoritative signal).
//   2. folder name — the page folder's `name` equals a known preset name (the
//      convenience signal for projects created from the v1 templates).
//
// Either heuristic qualifies a page; `_meta.preset` is preferred and recorded
// as `matchedBy: 'meta'` vs `matchedBy: 'name'` so the caller can tell which
// fired. Pages matching neither are ignored.

/**
 * The known v1 / Epic 7 themed preset names. Frozen — mirrors the
 * `PROVIDER_NAMES` `Object.freeze([...])` constant style from Story 8.1.
 *
 * @type {readonly string[]}
 */
export const KNOWN_PRESETS = Object.freeze([
  'producthunt',
  'social-media',
  'appstore',
  'talks',
  'personal',
  'live',
]);

const KNOWN_SET = new Set(KNOWN_PRESETS);

/**
 * Normalize a raw `_meta.preset` value to the bare name `KNOWN_SET` holds:
 * lowercase + strip a trailing `-v<digits>` template-version suffix. The REAL
 * create-lerret templates write versioned values (e.g. `"social-media-v1"` —
 * see `packages/create-lerret/template-presets/<preset>/.lerret/config.json`),
 * so an exact match against the bare names would never fire on a scaffolded
 * project.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizePresetName(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/-v\d+$/, '');
}

/**
 * Read a page's `_meta.preset` from either an inline `config` object on the
 * page node OR an externally-supplied cascaded-config map keyed by page path.
 * Returns the preset string or `null`.
 *
 * @param {{ path?: string, config?: object }} page
 * @param {Map<string, object> | undefined} cascadedConfig
 * @returns {string | null}
 */
function readMetaPreset(page, cascadedConfig) {
  const sources = [];
  if (cascadedConfig instanceof Map && page && typeof page.path === 'string') {
    sources.push(cascadedConfig.get(page.path));
  }
  if (page && page.config && typeof page.config === 'object') {
    sources.push(page.config);
  }
  for (const cfg of sources) {
    const meta = cfg && typeof cfg === 'object' ? cfg._meta : undefined;
    const preset = meta && typeof meta === 'object' ? meta.preset : undefined;
    if (typeof preset === 'string' && preset.length > 0) return preset;
  }
  return null;
}

/**
 * Discover themed preset pages in the project. Accepts either a `projectModel`
 * (the loader's `ProjectNode` with `.pages`) or a bare `pages` array, plus an
 * OPTIONAL `cascadedConfig` map (page path → effective config) so the caller
 * (the orchestrator, which already computed the cascade) can feed `_meta.preset`
 * without this pure helper importing the cascade.
 *
 * @param {{
 *   projectModel?: { pages?: Array<object> },
 *   pages?: Array<object>,
 *   cascadedConfig?: Map<string, object>,
 * }} args
 * @returns {Array<{ preset: string, pagePath: string, matchedBy: 'meta' | 'name' }>}
 */
export function discoverPresets({ projectModel, pages, cascadedConfig } = {}) {
  const list = Array.isArray(pages)
    ? pages
    : Array.isArray(projectModel?.pages)
      ? projectModel.pages
      : [];

  /** @type {Array<{ preset: string, pagePath: string, matchedBy: 'meta' | 'name' }>} */
  const out = [];
  for (const page of list) {
    if (!page || typeof page !== 'object') continue;
    const pagePath = typeof page.path === 'string' ? page.path : '';

    // Heuristic 1 (authoritative): `_meta.preset`, normalized so the real
    // templates' versioned values (`social-media-v1`) match the bare names.
    const metaPreset = readMetaPreset(page, cascadedConfig);
    const normalized = metaPreset ? normalizePresetName(metaPreset) : null;
    if (normalized && KNOWN_SET.has(normalized)) {
      out.push({ preset: normalized, pagePath, matchedBy: 'meta' });
      continue;
    }

    // Heuristic 2 (convenience): folder name equals a known preset.
    const name = typeof page.name === 'string' ? page.name : '';
    if (KNOWN_SET.has(name)) {
      out.push({ preset: name, pagePath, matchedBy: 'name' });
    }
  }
  return out;
}
