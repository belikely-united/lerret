// Workflow-shape recognizer (Story 8.8, AC-1 / AC-5) — PURE: no fs, no DOM,
// no `node:*`, and — critically — NO LLM call. This is deterministic
// pre-routing the Planner consults BEFORE deciding how to decompose a turn:
// a recognized `launch-kit` or `social-variants` shape routes to the
// matching workflow planner (`planLaunchKit` / `planSocialVariants`); the
// `edit` / `generic` fall-throughs keep the Story 8.3 LLM-driven
// decomposition path unchanged.
//
// Classification precedence (first match wins, documented + pinned by tests):
//   0. An edit / negation / question cue ANYWHERE in the prompt (`tweak the
//      launch kit`, `do NOT make a launch kit`, `what would a launch kit
//      cost?`) disables BOTH workflow kinds — the prompt is ABOUT a workflow,
//      not a request to run one. It falls through to `edit` (when an asset
//      path is referenced) or `generic` (the LLM planner path).
//   1. `launch-kit`      — a kit keyword (`launch kit` / `launch assets` /
//                          `marketing kit`) AND ≥1 named platform from
//                          {@link KNOWN_PLATFORMS}. A kit keyword WITHOUT a
//                          platform falls through (the LLM planner handles
//                          platform-less kit prompts — e.g. the smoke's bare
//                          `launch kit for v0.4`).
//   2. `social-variants` — a variant cue (`N more`, `more … in the same
//                          style`, `variants of`, `another version of`) AND a
//                          referenced asset path (`<page>/<name>.jsx` — at
//                          least one folder segment).
//   3. `edit`            — a referenced asset path WITHOUT a variant cue.
//   4. `generic`         — everything else (including empty / non-string).

/**
 * @typedef {{ preset: string, page: string }} PlatformSpec
 *   `preset` — the themed-preset family (a `KNOWN_PRESETS` name); `page` — the
 *   canonical folder under `.lerret/` the platform's assets land in.
 */

// The platform-keyword → `{ preset, page }` map now lives in the format
// registry (../../formats/registry.js), DERIVED from `FORMAT_PROFILES` so a
// format is declared once. Imported (the recognizer reads it) AND re-exported
// so this module's public surface — and workflows/index.js's re-export — is
// unchanged. The derived value is byte-for-byte equivalent to the literal it
// replaced (pinned by formats/registry.test.js). See registry.js for the why.
import { KNOWN_PLATFORMS } from '../../formats/registry.js';

export { KNOWN_PLATFORMS };

/** The W2 kit-request keywords (any one qualifies). */
const LAUNCH_KIT_RE = /\b(?:launch\s+kit|launch\s+assets|marketing\s+kit)\b/i;

/**
 * Edit / negation / question cues that mean the prompt is ABOUT a workflow,
 * not a request to RUN one (`tweak the launch kit headline`, `delete the
 * launch kit`, `don't make a launch kit yet`, `what would a launch kit
 * cost?`, `how much is …`). Any hit disables the `launch-kit` AND
 * `social-variants` classifications — the prompt falls through to `edit` /
 * `generic` so the LLM planner (which understands intent) owns the turn.
 * Case-insensitive; matched anywhere in the prompt.
 */
const WORKFLOW_OVERRIDE_CUE_RE =
  /\b(?:edit|tweak|change|update|fix|rename|delete|remove|never|costs?|how\s+much)\b|\bdon['’]t\b|\bdo\s+not\b|\?/i;

/**
 * The W3 variant cues. `N more` accepts digits or the number words one–ten;
 * `more … in the same style` tolerates up to 120 chars between the two
 * anchors so `more social posts in the same style as <path>` matches.
 */
const VARIANT_CUE_RES = Object.freeze([
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+more\b/i,
  /\bmore\b[\s\S]{0,120}?\bin the same style\b/i,
  /\bvariants?\s+of\b/i,
  /\banother\s+version\s+of\b/i,
]);

/**
 * An asset-path reference: one or more folder segments then `<name>.jsx` /
 * `.tsx` (core's `ASSET_EXTENSIONS` component kinds). A bare `name.jsx` with
 * no folder does NOT qualify (the spec's shape is `<page>/<name>.jsx`).
 * A leading `.lerret/` segment is allowed and captured as written — the
 * workflow planners normalize prefixes, not the recognizer.
 */
const REFERENCE_PATH_RE = /((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:jsx|tsx))/;

const NUMBER_WORDS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
});

/** The default variant count when a cue names no number (`variants of …`). */
const DEFAULT_VARIANT_COUNT = 3;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the named platforms from a prompt, in PROMPT ORDER, deduped by
 * resolved page (`twitter, x` yields one entry — both map to
 * `social-media/twitter`). Longer keywords win overlapping shorter ones at
 * the same span (`app store hero` consumes the text `app store` would also
 * match). Matching is case-insensitive with non-alphanumeric boundaries, so
 * the single-letter `x` keyword only fires standalone (never inside `export`).
 *
 * @param {string} prompt
 * @returns {string[]} The matched canonical keywords (lowercase), prompt order.
 */
function extractPlatforms(prompt) {
  const text = String(prompt).toLowerCase();
  const keywords = Object.keys(KNOWN_PLATFORMS).sort((a, b) => b.length - a.length);
  /** @type {Array<{ start: number, end: number, keyword: string }>} */
  const spans = [];
  for (const keyword of keywords) {
    const re = new RegExp(
      `(?<![a-z0-9])${escapeRe(keyword).replace(/ /g, '\\s+')}(?![a-z0-9])`,
      'g',
    );
    let m;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      // Skip a span overlapping an already-claimed (longer) keyword match.
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, keyword });
    }
  }
  spans.sort((a, b) => a.start - b.start);

  const platforms = [];
  const seenPages = new Set();
  for (const s of spans) {
    const { page } = KNOWN_PLATFORMS[s.keyword];
    if (seenPages.has(page)) continue;
    seenPages.add(page);
    platforms.push(s.keyword);
  }
  return platforms;
}

/**
 * Extract the FIRST referenced asset path (`<page>/<name>.jsx`) from a
 * prompt, or `null`.
 *
 * @param {string} prompt
 * @returns {string | null}
 */
function extractReferencePath(prompt) {
  const m = REFERENCE_PATH_RE.exec(String(prompt));
  return m ? m[1] : null;
}

/**
 * Extract the requested variant count from a W3 cue:
 *   - `N more` (digits or one–ten) → N;
 *   - `another version of` → 1;
 *   - any other cue (`variants of`, bare `more … in the same style`) →
 *     {@link DEFAULT_VARIANT_COUNT}.
 *
 * @param {string} prompt
 * @returns {number}
 */
function extractCount(prompt) {
  const m = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+more\b/i.exec(
    String(prompt),
  );
  if (m) {
    const raw = m[1].toLowerCase();
    const n = NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1) return n;
  }
  if (/\banother\s+version\s+of\b/i.test(prompt)) return 1;
  return DEFAULT_VARIANT_COUNT;
}

/**
 * @typedef {{ kind: 'launch-kit', platforms: string[] }
 *           | { kind: 'social-variants', reference: { path: string, count: number } }
 *           | { kind: 'edit', reference: { path: string } }
 *           | { kind: 'generic' }
 *          } WorkflowShape
 */

/**
 * Classify a prompt into its generation-workflow shape. Deterministic —
 * heuristic keyword + path matching only; the Planner still owns the
 * LLM-driven decomposition for `edit` / `generic` turns, and the workflow
 * planners (`planLaunchKit` / `planSocialVariants`) own the recognized kinds.
 *
 * @param {unknown} prompt  The user's turn prompt.
 * @param {{ scopePath?: string }} [opts]  `scopePath` is the dock selection
 *   chip's file path. When the prompt carries a variant cue but names no
 *   asset path ("make 3 variants of this"), the selected asset is the
 *   reference — the planning artifacts never specified W3's reference
 *   selection mechanism; the selection chip is the deterministic answer
 *   (gap closed 2026-06-12). Only `.jsx` selections qualify (W3 variants
 *   are component+data expansions of a component file).
 * @returns {WorkflowShape}
 */
export function recognizeWorkflow(prompt, opts = {}) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { kind: 'generic' };
  }

  // 0. Edit / negation / question cues disable both workflow kinds — the
  //    prompt is ABOUT a workflow, not a request to run one (precedence
  //    rule 0 in the header). Fall through to edit / generic below.
  const workflowsBlocked = WORKFLOW_OVERRIDE_CUE_RE.test(prompt);

  // 1. W2 launch-kit: kit keyword AND ≥1 named platform.
  if (!workflowsBlocked && LAUNCH_KIT_RE.test(prompt)) {
    const platforms = extractPlatforms(prompt);
    if (platforms.length > 0) return { kind: 'launch-kit', platforms };
  }

  // 2. W3 social-variants: variant cue AND a referenced asset path. A path
  //    named IN THE PROMPT wins; otherwise the selection chip's .jsx file
  //    serves as the reference.
  const promptPath = extractReferencePath(prompt);
  const scopePath =
    typeof opts.scopePath === 'string' && /\.jsx$/i.test(opts.scopePath)
      ? opts.scopePath.replace(/^\.lerret\//, '')
      : undefined;
  const path = promptPath ?? scopePath;
  if (!workflowsBlocked && path && VARIANT_CUE_RES.some((re) => re.test(prompt))) {
    return { kind: 'social-variants', reference: { path, count: extractCount(prompt) } };
  }

  // 3. Edit: a path referenced IN THE PROMPT without a variant cue. (A bare
  //    selection chip does NOT make a turn an `edit` shape — the LLM planner
  //    already receives the scoped file's content for those.)
  if (promptPath) return { kind: 'edit', reference: { path: promptPath } };

  // 4. Generic fall-through — the LLM planner decomposes.
  return { kind: 'generic' };
}
