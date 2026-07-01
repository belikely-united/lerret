// Format profile registry — the single source of truth for the asset
// *formats* Lerret's AI can specialize in (Phase 1 of the format-specialist
// initiative; see the post-launch design-quality track).
//
// ── Why this module exists ───────────────────────────────────────────────────
//
// Before this, format knowledge was scattered across THREE hardcoded lists
// that each encoded a slice of the same model:
//
//   1. `KNOWN_PRESETS`   (memory/presets.js)      — the themed page FAMILIES.
//   2. `KNOWN_PLATFORMS` (orchestrator/.../recognize.js) — keyword → the
//      `{ preset, page }` a named platform lands in.
//   3. the workflow planners (launch-kit / social-variants) — how a recognized
//      multi-asset request decomposes.
//
// They were never one thing, but they describe one thing: "what formats do we
// generate, and where do they go." This module unifies the DATA so a format is
// declared ONCE. A "specialist" becomes a profile object, not a new code path
// or a new graph node — the existing AgentExecutor loop stays the only engine
// (FR57: one AI behind one input).
//
// ── Phase 1 scope (THIS change) ──────────────────────────────────────────────
//
// Pure refactor, NO behavior change. The two legacy exports are now DERIVED
// from this registry and are byte-for-byte equivalent to the literals they
// replaced (registry.test.js pins the equivalence). New design fields exist as
// documented-but-unset SLOTS on the profile type — Phase 2 populates them and
// adds new profiles (poster, email, flyer, instagram post, ppt …) by dropping
// entries here, with zero graph/loop changes. That is the "tweak and grow
// later" contract made concrete.
//
// CRITICAL: this module is PURE — no fs, no DOM, no `node:*`, no provider, no
// LangGraph. It is plain data + tiny pure builders, so it sits BELOW both
// `memory/` and `orchestrator/` with no import cycle.

/**
 * The themed page FAMILIES (formerly `KNOWN_PRESETS` in memory/presets.js).
 * A family is a page theme; several formats can share one family, and some
 * families (`talks`, `personal`, `live`) have no named surface yet — so this
 * stays its own ordered list rather than being derived from the profiles.
 *
 * Order is preserved from the original literal (discovery + tests depend on
 * the membership, not the order, but keeping it stable avoids churn).
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

/**
 * A single format profile — the whole specialist, as data.
 *
 * Phase 1 fields (LOAD-BEARING today): `id`, `preset`, `page`, `aliases`.
 * Phase 2+ fields (the growth seam — DECLARED here so the shape is stable,
 * left unset on the v1 profiles so behavior is unchanged):
 *   - `surface`       — canonical dimensions / aspect ratio (IG 1080², A4 …).
 *   - `layoutGrammar` — composition rules injected into the system prompt.
 *   - `exemplars`     — curated reference designs (the aesthetics lever).
 *   - `brandHooks`    — which design-system tokens dominate this format.
 *   - `validation`    — aspect-ratio / margin / text-density checks.
 *   - `multiAsset`    — N-asset expansion (ppt = slides, email = sections).
 *
 * @typedef {{
 *   id: string,
 *   preset: string,
 *   page: string,
 *   aliases: readonly string[],
 *   surface?: { width?: number, height?: number, aspect?: string },
 *   layoutGrammar?: string,
 *   exemplars?: readonly unknown[],
 *   brandHooks?: readonly string[],
 *   validation?: object,
 *   multiAsset?: object,
 * }} FormatProfile
 */

/**
 * The built-in format profiles — the v1 surfaces, unchanged in behavior from
 * the old `KNOWN_PLATFORMS` map. The ORDER (and each profile's alias order) is
 * load-bearing: {@link buildPlatformMap} flattens these to reproduce the
 * legacy map's exact insertion order, which the recognizer's same-length
 * keyword tie-breaking relies on.
 *
 * Every `preset` here is a member of {@link KNOWN_PRESETS} (asserted by
 * registry.test.js). Several aliases may resolve to the SAME page (`twitter` /
 * `x`); the recognizer dedupes by page downstream.
 *
 * @type {readonly FormatProfile[]}
 */
export const FORMAT_PROFILES = Object.freeze([
  Object.freeze({
    id: 'twitter',
    preset: 'social-media',
    page: 'social-media/twitter',
    aliases: Object.freeze(['twitter', 'x']),
  }),
  Object.freeze({
    id: 'instagram',
    preset: 'social-media',
    page: 'social-media/instagram',
    aliases: Object.freeze(['instagram']),
  }),
  Object.freeze({
    id: 'linkedin',
    preset: 'social-media',
    page: 'social-media/linkedin',
    aliases: Object.freeze(['linkedin']),
  }),
  Object.freeze({
    id: 'bluesky',
    preset: 'social-media',
    page: 'social-media/bluesky',
    aliases: Object.freeze(['bluesky']),
  }),
  Object.freeze({
    id: 'appstore-hero',
    preset: 'appstore',
    page: 'appstore/hero',
    aliases: Object.freeze(['app store hero', 'app store', 'appstore']),
  }),
  Object.freeze({
    id: 'producthunt-launch',
    preset: 'producthunt',
    page: 'producthunt/launch',
    aliases: Object.freeze(['product hunt', 'producthunt']),
  }),
]);

/**
 * Build the platform-keyword → `{ preset, page }` map (the shape formerly
 * hardcoded as `KNOWN_PLATFORMS`). Flattens every profile's aliases in
 * declaration order; the outer map and each entry are frozen, mirroring the
 * original literal exactly.
 *
 * @param {readonly FormatProfile[]} [profiles]
 * @returns {Readonly<Record<string, Readonly<{ preset: string, page: string }>>>}
 */
export function buildPlatformMap(profiles = FORMAT_PROFILES) {
  /** @type {Record<string, Readonly<{ preset: string, page: string }>>} */
  const map = {};
  for (const profile of profiles) {
    for (const alias of profile.aliases) {
      map[alias] = Object.freeze({ preset: profile.preset, page: profile.page });
    }
  }
  return Object.freeze(map);
}

/**
 * The derived platform map — the canonical `KNOWN_PLATFORMS` value, now
 * computed from {@link FORMAT_PROFILES}. Re-exported (and consumed) by
 * recognize.js so its public shape is unchanged.
 *
 * @type {Readonly<Record<string, Readonly<{ preset: string, page: string }>>>}
 */
export const KNOWN_PLATFORMS = buildPlatformMap();
