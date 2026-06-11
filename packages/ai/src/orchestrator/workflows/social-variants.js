// W3 social-variant expansion (Story 8.8, AC-5..AC-7) — turns a recognized
// social-variants shape into a SINGLE `.data.json` write step.
//
// The entire point of FR23 variant expansion: ONE component, N data-driven
// artboards. This planner reads the reference asset's existing `.data.json`
// (the named-export-variant map — `default` plus N named keys), APPENDS
// `count` new variant entries with brand-anchored + prompt-derived props, and
// emits exactly ONE `{ op: 'write' }` step carrying the WHOLE merged object.
// It NEVER touches the `.jsx`, never deletes, never mkdirs — the v1 runtime
// (core `data/loader.js` co-location discovery → `resolveVariants` →
// `resolveProps`) renders the new artboards through the existing live-edit
// loop with no new render path (AC-7).
//
// PLANNING ONLY: no writes here. The single read (the existing `.data.json`)
// goes through the injected read surface; the Worker executes the returned
// step through the sandbox. Serialization + the co-located data-file path
// both REUSE the v1 generation substrate (`planVariantExpansion` /
// `componentBasename` — last-dot stem, two-space indent, trailing newline)
// so the merged file is byte-stable and loadable by `loadAssetData`.

/* global TextDecoder */
//
// `TextDecoder` is a universal global (browser + Node ≥ 11); the directive
// mirrors core's `/* global console */` precedent in data/loader.js.

import { planVariantExpansion, componentBasename } from '../../memory/generation.js';
import { canonToken } from '../agents/ds-curator.js';
import { ensureLerretPrefix } from './launch-kit.js';

/**
 * @typedef {import('../agents/worker.js').WorkerStep} WorkerStep
 * @typedef {import('./launch-kit.js').ReadSurface} ReadSurface
 */

/** Default + ceiling for the variant count (defensive — a runaway `count`
 * must not balloon a single data file into hundreds of artboards). */
const DEFAULT_COUNT = 3;
const MAX_COUNT = 20;

/** The copy-bearing prop keys, in preference order — the first one present
 * in the reference entry receives the prompt-derived copy. */
const TEXT_PROP_KEYS = Object.freeze([
  'headline',
  'title',
  'text',
  'caption',
  'tagline',
  'subhead',
]);

/** The brand props injected/refreshed on every new variant (canonical-match
 * against the brand tokens; injected keys ride the v1 tier-1 data layer —
 * a component that does not consume them simply ignores them). */
const BRAND_PROP_KEYS = Object.freeze(['brandColor', 'accentColor']);

/** A hex-color literal (#RGB … #RRGGBBAA) — the ONLY template-prop value
 * shape the brand re-anchor loop may overwrite (see the loop comment). */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Normalize the requested count: explicit `count` param wins, then the
 * recognizer's `reference.count`, then {@link DEFAULT_COUNT}; floored,
 * floor ≥ 1, capped at {@link MAX_COUNT}.
 *
 * @param {unknown} count
 * @param {unknown} referenceCount
 * @returns {number}
 */
function normalizeCount(count, referenceCount) {
  for (const candidate of [count, referenceCount]) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), MAX_COUNT);
  }
  return DEFAULT_COUNT;
}

/**
 * Strip the variant cue + the reference path out of the prompt, leaving the
 * topic the new variants are about (`three more social posts in the same
 * style as <path>` → `social posts`). May be `''` — the template copy then
 * stands.
 *
 * @param {string} prompt
 * @param {string} referencePath  As written in the prompt.
 * @returns {string}
 */
function deriveTopic(prompt, referencePath) {
  let t = String(prompt ?? '');
  if (referencePath) t = t.split(referencePath).join(' ');
  return t
    .replace(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+more\b/gi, ' ')
    .replace(/\banother\s+version\s+of\b/gi, ' ')
    .replace(/\bvariants?\s+of\b/gi, ' ')
    .replace(/\bin the same style(?:\s+(?:as|of))?\b/gi, ' ')
    .replace(/\b(?:like|as)\s+$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,;:.—–-]+/, '')
    .replace(/[\s,;:.—–-]+$/, '');
}

/**
 * Pick the template entry the new variants are shaped from: the `default`
 * key when present (the primary variant), else the first object value, else
 * an empty object (a missing/empty data file degrades gracefully — the new
 * entries then carry only the brand + copy props).
 *
 * @param {Record<string, unknown>} existing
 * @returns {Record<string, unknown>}
 */
function templateEntry(existing) {
  const def = existing.default;
  if (def && typeof def === 'object' && !Array.isArray(def)) return def;
  for (const value of Object.values(existing)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return {};
}

/**
 * Plan the W3 social-variant expansion for a reference asset.
 *
 * Contract pins (each has a test):
 *   - APPEND, never replace: every existing key survives with its value
 *     untouched; the merged object is `{ ...existing, ...newEntries }`.
 *   - New keys are unique + stable: `Variant<n>` numbered from
 *     `existing-key-count + 1`, skipping upward past any collision.
 *   - Exactly ONE step, an `{ op: 'write' }` to `<stem>.data.json` (the
 *     core last-dot co-location stem) — ZERO `.jsx` writes.
 *   - Brand-anchored: `brandColor` / `accentColor` resolve from the brand
 *     tokens (canonical match) on every new entry.
 *   - Prompt-derived copy: the topic (prompt minus cue + path) lands on the
 *     entry's copy-bearing prop, numbered for distinctness when `count > 1`.
 *
 * @param {{
 *   prompt?: string,
 *   reference: { path: string, count?: number } | string,
 *   count?: number,
 *   brandTokens?: Record<string, string>,
 *   ds?: { resolveBrandTokens?: Function },
 *   projectModel?: { pages?: Array<object> },
 *   fs?: ReadSurface,
 * }} args
 *   `reference` — the recognizer's `{ path, count }` (or a bare path string);
 *   `count`     — optional explicit override of `reference.count`;
 *   `brandTokens` — the DSCurator node's state slot (preferred);
 *   `ds`        — optional `resolveBrandTokens()` fallback seam;
 *   `projectModel` — accepted for signature symmetry with `planLaunchKit`
 *                 but ignored (the reference path IS the target — it is
 *                 simply not destructured below);
 *   `fs`        — the per-turn sandbox (the one read: the existing data file).
 * @returns {Promise<WorkerStep[]>}
 */
export async function planSocialVariants({
  prompt = '',
  reference,
  count,
  brandTokens,
  ds,
  fs,
} = {}) {
  const rawPath = typeof reference === 'string' ? reference : reference?.path;
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new TypeError(
      'planSocialVariants: reference must carry the reference asset path (a non-empty string)',
    );
  }
  const componentPath = ensureLerretPrefix(rawPath.trim());

  // The reference component must actually exist — W3 expands an EXISTING
  // asset (AC-5). A mistyped/hallucinated reference yields an EMPTY plan
  // (the turn completes with zero writes) rather than fabricating a data
  // file beside a component that is not there.
  if (fs && typeof fs.exists === 'function') {
    let present = false;
    try {
      present = await fs.exists(componentPath);
    } catch {
      present = false;
    }
    if (!present) return [];
  }

  const referenceCount =
    reference && typeof reference === 'object' ? reference.count : undefined;
  const n = normalizeCount(count, referenceCount);

  // The existing named-export-variant map (AC-5's extracted reference shape).
  // Graceful absence/malformed → {} (the plan still emits ONE data write and
  // ZERO .jsx writes; the appended entries simply have no existing siblings).
  const dir = componentPath.slice(0, componentPath.lastIndexOf('/'));
  const stem = componentBasename(componentPath);
  const dataPath = `${dir}/${stem}.data.json`;
  /** @type {Record<string, unknown>} */
  let existing = {};
  if (fs && typeof fs.readFile === 'function') {
    try {
      const raw = await fs.readFile(dataPath, { encoding: 'utf-8' });
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed;
      }
    } catch {
      existing = {};
    }
  }

  // Brand tokens: the state slot when present, the ds fallback seam else.
  let tokens = brandTokens && typeof brandTokens === 'object' ? brandTokens : {};
  if (Object.keys(tokens).length === 0 && ds && typeof ds.resolveBrandTokens === 'function') {
    try {
      const resolved = await ds.resolveBrandTokens({ fs });
      if (resolved && typeof resolved === 'object') tokens = resolved;
    } catch {
      tokens = {};
    }
  }
  const tokenByCanon = new Map();
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value !== 'string') continue;
    const canon = canonToken(key);
    if (!tokenByCanon.has(canon)) tokenByCanon.set(canon, value);
  }

  const template = templateEntry(existing);
  const topic = deriveTopic(prompt, rawPath.trim());
  const textKey =
    TEXT_PROP_KEYS.find((key) => typeof template[key] === 'string') ??
    (topic ? 'headline' : null);

  // Generate the new entries with unique, stable keys.
  const taken = new Set(Object.keys(existing));
  /** @type {Record<string, object>} */
  const appended = {};
  let next = Object.keys(existing).length + 1;
  for (let i = 1; i <= n; i++) {
    while (taken.has(`Variant${next}`)) next++;
    const key = `Variant${next}`;
    taken.add(key);
    next++;

    /** @type {Record<string, unknown>} */
    const entry = { ...template };
    if (textKey && topic) {
      entry[textKey] = n > 1 ? `${topic} — ${i}` : topic;
    }
    // Brand anchoring: refresh/inject the brand props from the tokens. A
    // template prop is re-anchored ONLY when its current value is a
    // hex-color literal (a drifted hex in old data gets pulled back to the
    // design system's value) — a canonical-name match alone must NOT clobber
    // copy props (`headlineFont` canons to `headline`; the fixture's
    // body/display font tokens canon onto `body`-named copy props).
    for (const propKey of Object.keys(entry)) {
      const current = entry[propKey];
      if (typeof current !== 'string' || !HEX_COLOR_RE.test(current)) continue;
      const tokenValue = tokenByCanon.get(canonToken(propKey));
      if (typeof tokenValue === 'string') entry[propKey] = tokenValue;
    }
    for (const propKey of BRAND_PROP_KEYS) {
      const tokenValue = tokenByCanon.get(canonToken(propKey));
      if (typeof tokenValue === 'string') entry[propKey] = tokenValue;
    }
    appended[key] = entry;
  }

  // ONE write of the WHOLE merged map, via the v1 generation substrate (the
  // co-located path + canonical serialization come from planVariantExpansion;
  // its componentPath-derived data path equals `dataPath` by construction).
  const merged = { ...existing, ...appended };
  return planVariantExpansion({ componentPath, variantData: merged }).steps;
}
