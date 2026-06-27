// W2 launch-kit decomposition (Story 8.8, AC-1..AC-4) — turns a recognized
// launch-kit shape into an ordered, brand-anchored `WorkerStep[]`.
//
// PLANNING ONLY: this module NEVER writes. It emits the `{ op, path, content }`
// steps the Worker (orchestrator/agents/worker.js) executes through the
// sandbox — every emitted path starts with `.lerret/` so the sandbox accepts
// it, and the existing live-edit loop (watcher → loader → re-render) paints
// the artboards with NO special render path (architecture §Asset Runtime).
// The only I/O here is READS through the injected read surface (existence
// checks + existing `.data.json` / `config.json` reads) — reads are not
// write-sandboxed, and the per-turn sandbox is the canonical instance to pass.
//
// Deterministic by design (NO LLM call): the platform → preset-page mapping is
// `KNOWN_PLATFORMS` (recognize.js); page existence comes from the v1
// `projectModel` or `fs.exists`; the starter component is an INLINE template
// (decision per the story's "Starter component sourcing" note — a runtime
// read of `@lerret/create-lerret`'s template-presets is impossible from the
// browser bundle, so the starter is generated here, following the template
// shape exactly: `meta` block + a default function consuming
// `var(--brandColor, …)` CSS vars).
//
// Brand anchoring (AC-3) is the DS Curator's authority chain, never a
// hard-coded constant:
//   primary   — `brandTokens` (the DSCurator node's state slot: parsed
//               `_design-system.md` tokens, lowercased keys),
//   secondary — the target preset page's `config.json` `vars` (read here,
//               graceful absence),
//   absent    — the data key is OMITTED (never a raw placeholder default);
//               the v1 four-tier prop resolution falls back to
//               `propsSchema` / component defaults.

import { discoverPresets } from '../../memory/presets.js';
import { planVariantExpansion, componentBasename } from '../../memory/generation.js';
import { canonToken } from '../agents/ds-curator.js';
import { KNOWN_PLATFORMS } from './recognize.js';

/**
 * @typedef {import('../agents/worker.js').WorkerStep} WorkerStep
 */

/**
 * The minimal read surface the planners need. Speaks PROJECT-RELATIVE
 * `.lerret/...` paths — the per-turn sandbox (`createSandbox` /
 * `createMockSandbox`) satisfies this directly (its readFile/exists accept
 * relative paths and normalize against projectRoot).
 *
 * @typedef {{
 *   exists: (path: string) => Promise<boolean>,
 *   readFile: (path: string, options?: object) => Promise<string | Uint8Array>,
 * }} ReadSurface
 */

/** The conventional launch-asset stem for pages this workflow creates. */
const LAUNCH_STEM = 'launch';

/** The well-known brand data keys a preset `vars` block declares (AC-3). */
const BRAND_DATA_KEYS = Object.freeze([
  'brandColor',
  'accentColor',
  'neutralDark',
  'neutralLight',
  'displayName',
  'handle',
  'tagline',
]);

/**
 * Per-page artboard specs for the inline starter component — dimensions match
 * the platform's canonical post/hero size. Keyed by the CANONICAL
 * `KNOWN_PLATFORMS` page (rebasing a preset folder changes the target FOLDER,
 * never the artboard spec).
 */
const PAGE_SPECS = Object.freeze({
  'social-media/twitter': Object.freeze({
    width: 1200,
    height: 675,
    label: 'Twitter / X launch post',
    tags: Object.freeze(['social', 'twitter', 'x', 'launch']),
  }),
  'social-media/instagram': Object.freeze({
    width: 1080,
    height: 1080,
    label: 'Instagram launch post',
    tags: Object.freeze(['social', 'instagram', 'launch']),
  }),
  'social-media/linkedin': Object.freeze({
    width: 1200,
    height: 627,
    label: 'LinkedIn launch post',
    tags: Object.freeze(['social', 'linkedin', 'launch']),
  }),
  'social-media/bluesky': Object.freeze({
    width: 1200,
    height: 675,
    label: 'Bluesky launch post',
    tags: Object.freeze(['social', 'bluesky', 'launch']),
  }),
  'appstore/hero': Object.freeze({
    width: 1242,
    height: 2208,
    label: 'App Store hero',
    tags: Object.freeze(['appstore', 'hero', 'launch']),
  }),
  'producthunt/launch': Object.freeze({
    width: 1270,
    height: 760,
    label: 'Product Hunt gallery',
    tags: Object.freeze(['producthunt', 'launch']),
  }),
});

/** Render-safe NEUTRAL fallbacks for unresolved tokens — never brand claims. */
const NEUTRAL_FALLBACKS = Object.freeze({
  brandColor: '#444444',
  neutralDark: '#111111',
  neutralLight: '#ffffff',
  accentColor: '#dddddd',
});

/** A brand value gets burnt into single-quoted starter-JSX string literals
 * (the `var(--…, <value>)` fallbacks) — only a value free of quotes,
 * backslashes, backticks, and newlines is safe to interpolate verbatim.
 * Anything else falls back to the render-safe neutral (see `starterComponent`
 * `fallback`) so a hostile/typo'd token can never break the starter's parse. */
const SAFE_INLINE_VALUE_RE = /^[^'\\\r\n`]+$/;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a project-relative asset path carries the `.lerret/` prefix the
 * sandbox requires (`social-media/twitter/a.jsx` → `.lerret/social-media/…`;
 * an already-prefixed path is returned unchanged). Leading `./` and `/` are
 * stripped first so every spelling normalizes to ONE canonical form.
 *
 * @param {string} path
 * @returns {string}
 */
export function ensureLerretPrefix(path) {
  let p = String(path ?? '').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
  if (p === '.lerret' || p.startsWith('.lerret/')) return p;
  return `.lerret/${p}`;
}

/**
 * Normalize a loader-model node path (which may be backend-absolute, e.g.
 * `/Users/me/proj/.lerret/social-media`) to its project-relative folder form
 * WITHOUT the `.lerret/` prefix (`social-media`). A path with no `.lerret/`
 * segment is treated as already project-relative.
 *
 * @param {unknown} path
 * @returns {string}
 */
function projectRelativeFolder(path) {
  let s = String(path ?? '').replace(/\\/g, '/');
  const idx = s.indexOf('.lerret/');
  if (idx >= 0) s = s.slice(idx + '.lerret/'.length);
  else s = s.replace(/^\/+/, '');
  return s.replace(/\/+$/, '');
}

/** A rebased preset root must be a plain relative folder — no escapes. */
function isSafeFolderSegment(folder) {
  return (
    typeof folder === 'string' &&
    folder.length > 0 &&
    !folder.startsWith('/') &&
    !folder.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
  );
}

// ---------------------------------------------------------------------------
// Brand-token resolution (AC-3)
// ---------------------------------------------------------------------------

/**
 * Resolve the brand-token record: the caller-supplied `brandTokens` (the
 * DSCurator node's state slot) when non-empty; otherwise the optional `ds`
 * fallback seam (`resolveBrandTokens()` — the story's mock-interface contract
 * for environments where the DSCurator node has not run). Always a plain
 * record, never null.
 *
 * @param {{ brandTokens?: Record<string, string>, ds?: { resolveBrandTokens?: Function }, fs?: ReadSurface }} args
 * @returns {Promise<Record<string, string>>}
 */
async function resolveTokens({ brandTokens, ds, fs }) {
  if (brandTokens && typeof brandTokens === 'object' && Object.keys(brandTokens).length > 0) {
    return brandTokens;
  }
  if (ds && typeof ds.resolveBrandTokens === 'function') {
    try {
      const resolved = await ds.resolveBrandTokens({ fs });
      if (resolved && typeof resolved === 'object') return resolved;
    } catch {
      // graceful — fall through to empty
    }
  }
  return {};
}

/**
 * Build a canonical-form index of the brand tokens so the design system's
 * bare names (`brand`, `accent`, `neutraldark`) resolve the preset-vars
 * vocabulary (`brandColor`, `accentColor`, `neutralDark`) — the same
 * cross-vocabulary rule DS Curator uses (`canonToken`). First write wins.
 *
 * @param {Record<string, string>} tokens
 * @returns {Map<string, string>}
 */
function canonicalTokenIndex(tokens) {
  const index = new Map();
  for (const [key, value] of Object.entries(tokens ?? {})) {
    if (typeof value !== 'string') continue;
    const canon = canonToken(key);
    if (!index.has(canon)) index.set(canon, value);
  }
  return index;
}

/**
 * Read + parse a JSON file through the read surface. Graceful: any
 * missing/unreadable/malformed file yields `null` — as does an ARRAY-shaped
 * document (spreading an array as a variant map would corrupt it; callers
 * that must distinguish "absent" from "present but unusable" pair this with
 * {@link fsExists}).
 *
 * @param {ReadSurface | undefined} fs
 * @param {string} path
 * @returns {Promise<object | null>}
 */
async function readJson(fs, path) {
  if (!fs || typeof fs.readFile !== 'function') return null;
  try {
    const raw = await fs.readFile(path, { encoding: 'utf-8' });
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Non-throwing existence check through the read surface — a missing surface,
 * a sandbox violation, or a backend error all read as `false`.
 *
 * @param {ReadSurface | undefined} fs
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fsExists(fs, path) {
  if (!fs || typeof fs.exists !== 'function') return false;
  try {
    return Boolean(await fs.exists(path));
  } catch {
    return false;
  }
}

/**
 * Collect the secondary `config.json` `vars` for a target page: the preset
 * ROOT config first (`.lerret/<root>/config.json`), overlaid by the page's
 * own config when present (`.lerret/<root>/<sub>/config.json` — closer
 * cascade level wins). String values only. Graceful absence → `{}`.
 *
 * @param {ReadSurface | undefined} fs
 * @param {string} pageRel  Project-relative page folder (no `.lerret/`).
 * @returns {Promise<Record<string, string>>}
 */
async function readPageVars(fs, pageRel) {
  /** @type {Record<string, string>} */
  const vars = {};
  const segments = pageRel.split('/');
  const levels = [segments[0], pageRel].filter(
    (level, i, arr) => level && arr.indexOf(level) === i,
  );
  for (const level of levels) {
    const config = await readJson(fs, `.lerret/${level}/config.json`);
    const block = config && typeof config.vars === 'object' && config.vars ? config.vars : {};
    for (const [k, v] of Object.entries(block)) {
      if (typeof v === 'string') vars[k] = v;
    }
  }
  return vars;
}

/**
 * Resolve the brand-anchored data values for one asset (AC-3): for each
 * well-known brand data key, `_design-system.md` tokens win (canonical
 * match), preset `vars` fill the gaps, and an unresolved key is OMITTED —
 * never a raw placeholder.
 *
 * @param {Map<string, string>} tokenIndex  From {@link canonicalTokenIndex}.
 * @param {Record<string, string>} vars     From {@link readPageVars}.
 * @returns {Record<string, string>}
 */
function resolveBrandData(tokenIndex, vars) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of BRAND_DATA_KEYS) {
    const primary = tokenIndex.get(canonToken(key));
    const value = primary ?? (typeof vars[key] === 'string' ? vars[key] : undefined);
    if (typeof value === 'string' && value.length > 0) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt-derived copy (deterministic)
// ---------------------------------------------------------------------------

/**
 * Derive the launch headline from the prompt: a `vN[.N…]` version reference
 * becomes `"<version> is live"` (`derived: true`); otherwise the copy falls
 * back to a neutral launch line (`derived: false`). (Copy fallback ≠ brand
 * fallback — brand VALUES are never defaulted, per AC-3; the headline is turn
 * copy.) The `derived` flag lets the existing-page refresh path skip the
 * canned line: a user's hand-written headline is NEVER replaced by fallback
 * copy — only by copy the prompt itself supplied.
 *
 * @param {string} prompt
 * @returns {{ value: string, derived: boolean }}
 */
function deriveHeadline(prompt) {
  const version = /\bv\d+(?:\.\d+)*\b/i.exec(String(prompt ?? ''))?.[0];
  return version
    ? { value: `${version} is live`, derived: true }
    : { value: 'Launch day', derived: false };
}

// ---------------------------------------------------------------------------
// Inline starter component (AC-2)
// ---------------------------------------------------------------------------

function pascalCase(s) {
  return String(s ?? '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((seg) => seg[0].toUpperCase() + seg.slice(1))
    .join('');
}

/**
 * Generate the starter component for a missing preset page. Follows the
 * themed-preset template shape exactly: a `meta` block (`dimensions`,
 * `label`, `tags`, `propsSchema`) plus a default function consuming
 * `var(--…)` CSS vars so the artboard renders on-brand from `config.json`
 * `vars` + the co-located `.data.json` props. Resolved brand tokens are
 * burnt in as the `var(--…)` FALLBACKS (brand-anchored render even before a
 * config exists); unresolved tokens fall back to render-safe neutrals.
 *
 * @param {{
 *   page: string,
 *   preset: string,
 *   spec: { width: number, height: number, label: string, tags: readonly string[] },
 *   headline: string,
 *   brand: Record<string, string>,
 * }} args
 * @returns {string} The `.jsx` source.
 */
function starterComponent({ page, preset, spec, headline, brand }) {
  const lastSegment = page.split('/').pop();
  const componentName = `${pascalCase(lastSegment === LAUNCH_STEM ? preset : lastSegment)}Launch`;
  // SECURITY/robustness: brand values are interpolated into single-quoted
  // literals below — a value carrying a quote/backslash/newline/backtick
  // would break (or escape) the starter's parse, so only safe-charset values
  // are burnt in; everything else takes the render-safe neutral.
  const fallback = (key) => {
    const value = brand[key];
    return typeof value === 'string' && SAFE_INLINE_VALUE_RE.test(value)
      ? value
      : NEUTRAL_FALLBACKS[key];
  };
  const tagsLiteral = spec.tags.map((t) => `'${t}'`).join(', ');
  const headlineSize = Math.round(spec.width / 14);
  const padding = Math.round(spec.width / 16);

  return `// ${spec.label} — generated by Lerret AI (launch kit).
//
// Brand values resolve from config.json vars at render time; the co-located
// ${LAUNCH_STEM}.data.json carries this launch's copy + brand anchors. Edit either
// file (or this component) and the canvas re-renders live.

export const meta = {
  dimensions: { width: ${spec.width}, height: ${spec.height} },
  label: '${spec.label}',
  tags: [${tagsLiteral}],
  propsSchema: {
    headline: {
      type: 'string',
      default: '${headline.replace(/'/g, "\\'")}',
      description: 'Launch headline.',
      required: true,
    },
    subhead: {
      type: 'string',
      default: '',
      description: 'Supporting line under the headline.',
    },
    displayName: {
      type: 'string',
      default: '',
      description: 'Display name shown in the footer.',
    },
    handle: {
      type: 'string',
      default: '',
      description: 'Social handle shown in the footer.',
    },
  },
};

export default function ${componentName}({
  headline = '${headline.replace(/'/g, "\\'")}',
  subhead = '',
  displayName = '',
  handle = '',
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: ${padding},
        background:
          'linear-gradient(135deg, var(--brandColor, ${fallback('brandColor')}) 0%, var(--neutralDark, ${fallback('neutralDark')}) 100%)',
        color: 'var(--neutralLight, ${fallback('neutralLight')})',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          fontSize: ${Math.max(14, Math.round(spec.width / 60))},
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          color: 'var(--accentColor, ${fallback('accentColor')})',
          opacity: 0.85,
        }}
      >
        launch
      </div>
      <div>
        <div
          style={{
            fontSize: ${headlineSize},
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: '-0.02em',
            maxWidth: '92%',
          }}
        >
          {headline}
        </div>
        {subhead ? (
          <div
            style={{
              marginTop: ${Math.round(padding / 3)},
              fontSize: ${Math.max(16, Math.round(spec.width / 36))},
              lineHeight: 1.4,
              opacity: 0.88,
              maxWidth: '80%',
            }}
          >
            {subhead}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
          fontSize: ${Math.max(14, Math.round(spec.width / 52))},
          opacity: 0.9,
        }}
      >
        {displayName ? <span style={{ fontWeight: 600 }}>{displayName}</span> : null}
        {handle ? (
          <span style={{ color: 'var(--accentColor, ${fallback('accentColor')})' }}>{handle}</span>
        ) : null}
      </div>
    </div>
  );
}
`;
}

// ---------------------------------------------------------------------------
// Project-model existence lookup
// ---------------------------------------------------------------------------

/**
 * Walk every container (page + nested groups) of a loader project model.
 *
 * @param {{ pages?: Array<object> } | undefined} projectModel
 * @returns {Array<object>}
 */
function collectContainers(projectModel) {
  const out = [];
  const stack = Array.isArray(projectModel?.pages) ? [...projectModel.pages] : [];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node || typeof node !== 'object') continue;
    out.push(node);
    if (Array.isArray(node.groups)) stack.push(...node.groups);
  }
  return out;
}

/**
 * Locate an EXISTING component asset for a target page via the project model:
 * the container whose project-relative folder equals `pageRel`, and within
 * it the first `.jsx` / `.tsx` asset (sorted by file name for stability).
 * Returns the `.lerret/`-prefixed component path, or `null`.
 *
 * @param {{ pages?: Array<object> } | undefined} projectModel
 * @param {string} pageRel
 * @returns {string | null}
 */
function findExistingComponent(projectModel, pageRel) {
  for (const container of collectContainers(projectModel)) {
    if (projectRelativeFolder(container.path) !== pageRel) continue;
    const assets = Array.isArray(container.assets) ? container.assets : [];
    const components = assets
      .filter((a) => a && typeof a.path === 'string' && /\.(?:jsx|tsx)$/i.test(a.path))
      .sort((a, b) => String(a.path).localeCompare(String(b.path)));
    if (components.length === 0) continue;
    const rel = projectRelativeFolder(components[0].path);
    return ensureLerretPrefix(rel);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The W2 planner
// ---------------------------------------------------------------------------

/**
 * Resolve each platform keyword to its target page, honoring the project's
 * ACTUAL preset folder when discovery finds one under a different name
 * (e.g. a page named `social` carrying `_meta.preset: "social-media-v1"`
 * rebases `social-media/twitter` → `social/twitter`). Unknown platforms are
 * skipped (graceful — the recognizer only emits known keywords, but the
 * planner is defensive for direct callers).
 *
 * @param {{
 *   platforms: string[],
 *   presets?: Array<{ preset: string, pagePath: string }>,
 *   projectModel?: { pages?: Array<object> },
 * }} args
 * @returns {Array<{ keyword: string, preset: string, page: string, pageRel: string }>}
 */
function resolveTargets({ platforms, presets, projectModel }) {
  const discovered = Array.isArray(presets)
    ? presets
    : projectModel
      ? discoverPresets({ projectModel })
      : [];
  const rootByPreset = new Map();
  for (const entry of discovered) {
    if (!entry || typeof entry.preset !== 'string') continue;
    const root = projectRelativeFolder(entry.pagePath);
    if (isSafeFolderSegment(root) && !rootByPreset.has(entry.preset)) {
      rootByPreset.set(entry.preset, root);
    }
  }

  const targets = [];
  const seenPages = new Set();
  for (const raw of Array.isArray(platforms) ? platforms : []) {
    const keyword = String(raw ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
    const spec = KNOWN_PLATFORMS[keyword];
    if (!spec) continue; // unknown platform — skipped, never a throw
    const [defaultRoot, ...rest] = spec.page.split('/');
    const actualRoot = rootByPreset.get(spec.preset) ?? defaultRoot;
    const pageRel = [actualRoot, ...rest].join('/');
    if (seenPages.has(pageRel)) continue;
    seenPages.add(pageRel);
    targets.push({ keyword, preset: spec.preset, page: spec.page, pageRel });
  }
  return targets;
}

/**
 * Plan the W2 launch-kit decomposition: one brand-anchored asset per named
 * platform, mapped into the project's preset pages.
 *
 * Per platform (ordered as named in the prompt):
 *   - **component exists** (located via `projectModel`, else the
 *     conventional `launch.jsx` via `fs.exists`) → ONE data write that
 *     refreshes the existing `.data.json`'s `default` entry (existing
 *     variant keys + custom props survive; the component is NEVER
 *     overwritten);
 *   - **page folder exists, no component** → write `launch.jsx` (starter) +
 *     `launch.data.json` (no mkdir);
 *   - **page folder missing** → `mkdir` + write `launch.jsx` +
 *     `launch.data.json`.
 *
 * The data write is planned through the v1 generation substrate
 * (`planVariantExpansion`) so the file lands exactly where core's
 * `data/loader.js` co-location rule discovers it (last-dot stem), in the
 * canonical serialized form (two-space indent + trailing newline).
 *
 * @param {{
 *   prompt?: string,
 *   platforms?: string[],
 *   brandTokens?: Record<string, string>,
 *   ds?: { resolveBrandTokens?: Function },
 *   projectModel?: { pages?: Array<object> },
 *   presets?: Array<{ preset: string, pagePath: string }>,
 *   fs?: ReadSurface,
 * }} args
 *   `brandTokens` — the DSCurator node's state slot (preferred);
 *   `ds`          — optional fallback seam when the node has not run;
 *   `presets`     — pre-computed `discoverPresets()` output (else derived
 *                   from `projectModel` when given);
 *   `fs`          — the per-turn sandbox (reads only here).
 * @returns {Promise<WorkerStep[]>}
 */
export async function planLaunchKit({
  prompt = '',
  platforms = [],
  brandTokens,
  ds,
  projectModel,
  presets,
  fs,
} = {}) {
  const tokens = await resolveTokens({ brandTokens, ds, fs });
  const tokenIndex = canonicalTokenIndex(tokens);
  const { value: headline, derived: headlineDerived } = deriveHeadline(prompt);
  const targets = resolveTargets({ platforms, presets, projectModel });

  /** @type {WorkerStep[]} */
  const steps = [];
  for (const target of targets) {
    const pageDir = ensureLerretPrefix(target.pageRel);
    const vars = await readPageVars(fs, target.pageRel);
    const brand = resolveBrandData(tokenIndex, vars);
    /** @type {Record<string, string>} */
    const dataProps = { headline, ...brand };
    if (typeof brand.tagline === 'string' && brand.tagline.length > 0) {
      dataProps.subhead = brand.tagline;
    }

    // Existing component? Project model first, the conventional stem second.
    let componentPath = findExistingComponent(projectModel, target.pageRel);
    if (!componentPath) {
      const conventional = `${pageDir}/${LAUNCH_STEM}.jsx`;
      if (await fsExists(fs, conventional)) componentPath = conventional;
    }

    if (componentPath) {
      // AC-2 existing-page path: refresh data only — NEVER re-create or
      // overwrite the component.
      const dir = componentPath.slice(0, componentPath.lastIndexOf('/'));
      const stem = componentBasename(componentPath);
      const dataPath = `${dir}/${stem}.data.json`;
      const existing = await readJson(fs, dataPath);
      if (existing === null && (await fsExists(fs, dataPath))) {
        // The data file EXISTS but is unreadable/malformed/array-shaped —
        // a refresh would clobber state we cannot merge. SKIP this
        // platform's refresh and leave the file untouched.
        continue;
      }
      // Canned fallback copy must never replace a user's existing headline:
      // include `headline` in the refresh only when it was genuinely derived
      // from the prompt (a version reference), never the neutral fallback.
      const refreshProps = { ...dataProps };
      if (!headlineDerived) delete refreshProps.headline;
      const base = existing ?? {};
      const merged = {
        ...base,
        default: {
          ...(base.default && typeof base.default === 'object' ? base.default : {}),
          ...refreshProps,
        },
      };
      steps.push(...planVariantExpansion({ componentPath, variantData: merged }).steps);
      continue;
    }

    // Missing component: create the page (folder when absent) + starter
    // component + brand-anchored starter data.
    const folderExists = await fsExists(fs, pageDir);
    if (!folderExists) steps.push({ op: 'mkdir', path: pageDir });

    const newComponentPath = `${pageDir}/${LAUNCH_STEM}.jsx`;
    steps.push({
      op: 'write',
      path: newComponentPath,
      content: starterComponent({
        page: target.page,
        preset: target.preset,
        spec: PAGE_SPECS[target.page] ?? {
          width: 1200,
          height: 675,
          label: `${target.keyword} launch`,
          tags: ['launch'],
        },
        headline,
        brand,
      }),
    });
    steps.push(
      ...planVariantExpansion({
        componentPath: newComponentPath,
        variantData: { default: dataProps },
      }).steps,
    );
  }

  // Defensive invariant: every emitted path is sandbox-eligible. The map +
  // prefix helpers make this true by construction; a violation here is a
  // programming error worth failing loudly on (the sandbox would also throw,
  // but at Worker time — after the turn started writing).
  for (const step of steps) {
    if (!step.path.startsWith('.lerret/')) {
      throw new TypeError(
        `planLaunchKit: emitted a non-.lerret path '${step.path}' — workflow paths must live under .lerret/`,
      );
    }
  }
  return steps;
}
