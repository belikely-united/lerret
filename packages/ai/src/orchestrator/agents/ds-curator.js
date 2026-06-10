// DS Curator agent — owns brand-token authority.
//
// Authority order (architecture-epic-8.md §Multi-Agent Orchestrator + the
// change-proposal open-question-#3 decision): `_design-system.md` is PRIMARY;
// `config.json` `vars` is the SECONDARY, code-facing layer. When the two
// DISAGREE on a token, the DS Curator surfaces a CLARIFYING NOTE to the user
// but PROCEEDS with the `_design-system.md` value — it never auto-reconciles,
// never blocks, never writes either file.
//
// ── Two surfaces, one authority rule ─────────────────────────────────────────
//
// `createDsCuratorNode({ sandbox, emit })` — the Story 8.3 LangGraph node.
//   Returns `{ brandTokens }`. Its return contract + its conflict `tool-call`
//   emit are UNCHANGED by Story 8.6. It now DELEGATES token parsing of
//   `_design-system.md` to `../../memory/design-tokens.js` (the canonical
//   `lerret-tokens` fenced block) while KEEPING the lenient `- name: value`
//   line parser as a fallback so the existing node tests (which feed
//   `- brand-orange: #ff6600`) still pass.
//
// `createDSCurator({ projectRoot, fs })` — the richer Story 8.6 surface:
//   `resolveTokens({ prompt, targetScope, vars })` resolves brand-token
//   references in a prompt, with `_design-system.md` PRIMARY and the cascaded
//   `config.json` `vars` (passed IN via DI — guardrail #9) SECONDARY; it
//   returns `{ resolved, conflicts }`. `toClarifyingNotes(conflicts)` turns
//   conflicts into `ClarifyingNoteEvent`s for the orchestrator to splice into
//   its `runTurn` stream.
//
// READ-ONLY invariant: this agent NEVER writes `config.json` or
// `_design-system.md`. It has no sandbox/write surface — `createDSCurator`
// takes only the unwrapped `fs` (reads). The no-direct-fs guard
// (./worker-no-direct-fs.test.js) is satisfied: no `node:*` import, no
// `fs.writeFile`/`fs.mkdir`/`fs.unlink`.
//
// ── ClarifyingNoteEvent (local typedef — Story 8.3 owns events.js) ───────────
//
// `orchestrator/events.js` EXISTS (Story 8.3) but its TurnEvent union does NOT
// yet carry a `clarifying-note` factory (its types are thinking/reading/
// writing/deleting/mkdir/tool-call/done/error/stopped/needs-vision-fallback).
// Per the story this typedef is defined LOCALLY here, mirroring how `worker.js`
// inlines `WorkerEvent`. STORY 8.3 SHOULD: add a `clarifyingNote(...)` factory +
// the `'clarifying-note'` type to events.js and move this typedef there
// verbatim, then import it here. Until then it is local.

import { toolCall } from '../events.js';
import { DESIGN_SYSTEM_PATH } from '../../memory/paths.js';
import { parseDesignTokens, flattenTokens } from '../../memory/design-tokens.js';

const PROJECT_CONFIG_PATH = '.lerret/config.json';

/**
 * @typedef {{
 *   type: 'clarifying-note',
 *   note: string,
 *   token: string,
 *   configToken?: string,
 *   designSystemValue: string,
 *   configValue: string,
 *   scope?: string,
 * }} ClarifyingNoteEvent
 *   A one-line, calm/factual note that two brand-authority sources disagree on
 *   a token. The orchestrator surfaces `note` in the turn-outcome card (Story
 *   8.2) and PROCEEDS with `designSystemValue` (the `_design-system.md` value).
 *   `configToken` is the user's ACTUAL `config.json` var key when it differs
 *   from the design-system token name (e.g. token `brand` vs `brandColor`).
 */

/**
 * @typedef {{
 *   token: string,
 *   configToken?: string,
 *   designSystemValue: string,
 *   configValue: string,
 *   scope?: string,
 * }} Conflict
 *   `token` is the design-system (primary) token name; `configToken` is the
 *   config-vars key that canonically collides with it, present only when the
 *   two names differ.
 */

/**
 * Canonical token-name form used ONLY for cross-source comparison (never for
 * display): lowercase, strip non-alphanumerics, then strip ONE trailing
 * `colour` | `color` | `font` suffix. The design system speaks bare names
 * (`brand`, `accent`, `display` — the `lerret-tokens` block) while every real
 * preset config speaks `vars.brandColor` / `accentColor` / `displayFont` —
 * exact-key comparison can never see those collide; this form can:
 * `'brandColor'` → `'brand'`, `'accent-color'` → `'accent'`,
 * `'displayFont'` → `'display'`. A bare `'color'` / `'colour'` / `'font'`
 * has nothing before the suffix and stays itself.
 *
 * @param {string} name
 * @returns {string}
 */
export function canonToken(name) {
  let c = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const m = /^(.+?)(colour|color|font)$/.exec(c);
  if (m) c = m[1];
  return c;
}

/** Hex-color literal — the one value family compared case-insensitively. */
const HEX_VALUE_RE = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Compare two token VALUES for conflict detection. Both are trimmed; when
 * BOTH are hex-color literals they compare case-insensitively
 * (`#B85B33` ≡ `#b85b33` — not a conflict); anything else compares as the
 * trimmed strings.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function tokenValuesEqual(a, b) {
  const ta = String(a ?? '').trim();
  const tb = String(b ?? '').trim();
  if (HEX_VALUE_RE.test(ta) && HEX_VALUE_RE.test(tb)) {
    return ta.toLowerCase() === tb.toLowerCase();
  }
  return ta === tb;
}

/**
 * @typedef {{ key: string, lower: string, canon: string, value: string }} SecondaryVar
 *   One `config.json` `vars` entry with its ORIGINAL key preserved (for
 *   user-facing naming), plus the lowercase + canonical lookup forms.
 */

/**
 * Collect the string-valued `vars` entries with their original key names.
 *
 * @param {object | undefined | null} vars
 * @returns {SecondaryVar[]}
 */
function collectSecondaryVars(vars) {
  /** @type {SecondaryVar[]} */
  const out = [];
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'string') {
        out.push({ key: k, lower: k.toLowerCase(), canon: canonToken(k), value: v });
      }
    }
  }
  return out;
}

/**
 * Find the secondary var corresponding to a (lowercased) token name: an exact
 * lowercase key match wins; otherwise the first canonical match
 * (`brand` ↔ `brandColor`).
 *
 * @param {SecondaryVar[]} secondaryVars
 * @param {string} tokenName
 * @returns {SecondaryVar | null}
 */
function findSecondaryFor(secondaryVars, tokenName) {
  const lower = String(tokenName).toLowerCase();
  const exact = secondaryVars.find((s) => s.lower === lower);
  if (exact) return exact;
  const canon = canonToken(tokenName);
  return secondaryVars.find((s) => s.canon === canon) ?? null;
}

/**
 * Lenient legacy line parser: `- name: value` or `name: value`. Retained as a
 * FALLBACK for the graph node so the Story 8.3 node tests (which feed loose
 * lines, not the canonical fenced block) still resolve. Null-proto map so a
 * token named `constructor`/`__proto__` is a real own key (no prototype
 * pollution).
 *
 * @param {string} md
 * @returns {Record<string, string>}
 */
function parseLooseLines(md) {
  /** @type {Record<string, string>} */
  const tokens = Object.create(null);
  for (const raw of String(md ?? '').split('\n')) {
    const line = raw.replace(/^\s*[-*]\s*/, '').trim();
    const m = /^([A-Za-z][\w-]*)\s*:\s*(#[0-9a-fA-F]{3,8}|[^\s].*)$/.exec(line);
    if (m) tokens[m[1].toLowerCase()] = m[2].trim();
  }
  return tokens;
}

/**
 * Parse `_design-system.md` into a flat `tokenName → value` record. Prefers the
 * canonical `lerret-tokens` fenced block (design-tokens.js); if that yields
 * nothing, falls back to the loose `- name: value` line scan. The precedence
 * is EXCLUSIVE: when the canonical block yields at least one token, loose
 * `name: value` lines OUTSIDE the fence are ignored entirely (block present →
 * block only; no block → loose-line fallback). Keys are lowercased for
 * case-insensitive resolution. Null-proto.
 *
 * @param {string} md
 * @returns {Record<string, string>}
 */
function parseDesignSystemTokens(md) {
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  const flat = flattenTokens(parseDesignTokens(md));
  for (const [k, v] of flat) out[k.toLowerCase()] = v;
  if (Object.keys(out).length === 0) {
    const loose = parseLooseLines(md);
    for (const k of Object.keys(loose)) out[k] = loose[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Story 8.6 agent surface — createDSCurator({ projectRoot, fs })
// ---------------------------------------------------------------------------

/**
 * Join `projectRoot` + a project-relative path into an absolute POSIX path.
 *
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {string}
 */
function absoluteOf(projectRoot, relPath) {
  const root = String(projectRoot ?? '').replace(/\/+$/, '');
  return `${root}/${relPath}`;
}

/**
 * Match brand-token references in a free-text prompt to the known token names.
 * Recognizes a direct token-name mention (`brand`, `accent`, `display`) AND a
 * couple of natural-language aliases ("our orange" → `brand`-ish names). The
 * matcher is intentionally simple — a precise NLP pass is out of scope; the
 * goal is to surface the tokens a prompt plausibly references so they can be
 * resolved + conflict-checked.
 *
 * @param {string} prompt
 * @param {Iterable<string>} tokenNames  Lowercased known token names.
 * @returns {string[]} The token names the prompt references (lowercased).
 */
export function matchTokenReferences(prompt, tokenNames) {
  const text = String(prompt ?? '').toLowerCase();
  const names = [...tokenNames];
  const hits = new Set();
  for (const name of names) {
    // Whole-word-ish match on the token name itself.
    if (name.length >= 2 && new RegExp(`\\b${escapeRe(name)}\\b`).test(text)) {
      hits.add(name);
    }
  }
  // Natural-language colour aliases: "our orange" / "the brand color" → any
  // token name containing 'brand'. Kept minimal + documented.
  if (/\b(our|the)\s+(brand|primary)\b/.test(text) || /\bbrand\s+colou?r\b/.test(text)) {
    for (const name of names) if (name.includes('brand')) hits.add(name);
  }
  return [...hits];
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create the Story 8.6 DS Curator agent.
 *
 * @param {{ projectRoot: string, fs: { readFile: (p: string, o?: object) => Promise<string | Uint8Array> } }} deps
 * @returns {{
 *   resolveTokens: (args: { prompt?: string, targetScope?: string, vars?: object }) => Promise<{ resolved: Array<{ ref: string, source: 'design-system' | 'config-vars', value: string }>, conflicts: Conflict[] }>,
 *   toClarifyingNotes: (conflicts: Conflict[]) => ClarifyingNoteEvent[],
 * }}
 */
export function createDSCurator({ projectRoot, fs }) {
  // Mirrors createMockSandbox's validation: the v1 FilesystemAccess backends
  // speak ABSOLUTE paths, so a relative projectRoot would ENOENT every read.
  if (typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) {
    throw new TypeError(
      'createDSCurator: projectRoot must be an absolute path (a string starting with "/")',
    );
  }
  if (!fs || typeof fs.readFile !== 'function') {
    throw new TypeError('createDSCurator: fs must expose readFile (reads only)');
  }

  /** Read + parse `_design-system.md` (primary). Graceful absence → {}. */
  async function readDesignSystemTokens() {
    try {
      const raw = await fs.readFile(absoluteOf(projectRoot, DESIGN_SYSTEM_PATH), {
        encoding: 'utf-8',
      });
      const md = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      return parseDesignSystemTokens(md);
    } catch {
      return Object.create(null);
    }
  }

  /**
   * Resolve the brand-token references a prompt makes. `_design-system.md`
   * wins; the cascaded `config.json` `vars` (passed IN via `vars`, DI per
   * guardrail #9) fills tokens the design system lacks. Cross-source matching
   * is CANONICAL (`canonToken`): the design system's `brand` and the real
   * preset configs' `vars.brandColor` are the same token. A token both
   * sources define (canonically) with DIFFERENT normalized values is recorded
   * as a conflict naming BOTH original keys; the RESOLVED value is always the
   * design-system value (proceed, never block).
   *
   * @param {{ prompt?: string, targetScope?: string, vars?: object }} args
   */
  async function resolveTokens({ prompt = '', targetScope, vars } = {}) {
    const primary = await readDesignSystemTokens();
    const secondaryVars = collectSecondaryVars(vars);
    const scopeField = typeof targetScope === 'string' ? targetScope : undefined;

    // Canonical index of the primary tokens for cross-vocabulary matching.
    const primaryByCanon = new Map();
    for (const k of Object.keys(primary)) {
      const c = canonToken(k);
      if (!primaryByCanon.has(c)) primaryByCanon.set(c, k);
    }

    // The references the prompt makes (against the union of known names).
    const known = new Set([
      ...Object.keys(primary),
      ...secondaryVars.map((s) => s.lower),
    ]);
    const refs = matchTokenReferences(prompt, known);

    /** @type {Array<{ ref: string, source: 'design-system' | 'config-vars', value: string }>} */
    const resolved = [];
    /** @type {Conflict[]} */
    const conflicts = [];

    /** Record one conflict per primary token, keeping BOTH original names. */
    const recordConflict = (primaryKey, secondaryVar) => {
      if (conflicts.some((c) => c.token === primaryKey)) return;
      conflicts.push({
        token: primaryKey,
        ...(secondaryVar.key !== primaryKey ? { configToken: secondaryVar.key } : {}),
        designSystemValue: primary[primaryKey],
        configValue: secondaryVar.value,
        scope: scopeField,
      });
    };

    for (const ref of refs) {
      // Primary hit: exact name first, then canonical (a prompt referencing
      // `brand` resolves the design system's `brand`; a ref that is the
      // config's `brandcolor` also lands on the SAME primary token).
      const primaryKey = Object.prototype.hasOwnProperty.call(primary, ref)
        ? ref
        : (primaryByCanon.get(canonToken(ref)) ?? null);
      // Secondary hit: exact key first, then canonical — a prompt referencing
      // `brand` must also consider a secondary-only `brandColor` var.
      const secondaryVar = findSecondaryFor(secondaryVars, ref);
      if (primaryKey != null) {
        resolved.push({ ref, source: 'design-system', value: primary[primaryKey] });
        if (secondaryVar && !tokenValuesEqual(primary[primaryKey], secondaryVar.value)) {
          recordConflict(primaryKey, secondaryVar);
        }
      } else if (secondaryVar) {
        resolved.push({ ref, source: 'config-vars', value: secondaryVar.value });
      }
    }

    // Also surface conflicts for tokens BOTH sources define (canonically)
    // even when the prompt did not explicitly reference them — the conflict
    // is a project health signal the user should see regardless of phrasing.
    for (const token of Object.keys(primary)) {
      const secondaryVar = findSecondaryFor(secondaryVars, token);
      if (secondaryVar && !tokenValuesEqual(primary[token], secondaryVar.value)) {
        recordConflict(token, secondaryVar);
      }
    }

    return { resolved, conflicts };
  }

  return { resolveTokens, toClarifyingNotes };
}

/**
 * Turn conflicts into `ClarifyingNoteEvent`s. The note copy is calm/factual per
 * the v1 voice, names the user's ACTUAL config key (`configToken` when the two
 * vocabularies differ) and carries BOTH values so the user can act without
 * opening either file. Exported standalone (and returned from
 * `createDSCurator`) so Story 8.3's orchestrator can splice the notes into its
 * `runTurn` stream.
 *
 * @param {Conflict[]} conflicts
 * @returns {ClarifyingNoteEvent[]}
 */
export function toClarifyingNotes(conflicts) {
  if (!Array.isArray(conflicts)) return [];
  return conflicts.map((c) => {
    const where = c.scope ? `\`${c.scope}config.json\`` : '`config.json`';
    const keyName = c.configToken ?? c.token;
    return {
      type: 'clarifying-note',
      note:
        `\`_design-system.md\` and ${where} disagree on ${keyName} — ` +
        `using \`${c.designSystemValue}\` from \`_design-system.md\` ` +
        `(config.json says \`${c.configValue}\`).`,
      token: c.token,
      ...(c.configToken ? { configToken: c.configToken } : {}),
      designSystemValue: c.designSystemValue,
      configValue: c.configValue,
      ...(c.scope ? { scope: c.scope } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Story 8.3 graph node — createDsCuratorNode({ sandbox, emit })
// ---------------------------------------------------------------------------

/**
 * Create the DS Curator graph node. Reads `_design-system.md` (primary) and the
 * project `config.json` `vars` (secondary) via the sandbox; records the
 * resolved token map in the `brandTokens` state slot and emits a `tool-call`
 * conflict note for any token the two sources disagree on.
 *
 * Story 8.6 rewires token parsing of `_design-system.md` to delegate to
 * design-tokens.js (canonical fenced block) with the loose-line fallback, so
 * the node now understands BOTH the canonical token format AND the loose lines
 * the Story 8.3 tests feed. The `{ brandTokens }` RETURN CONTRACT and the
 * `tool-call` conflict-note emit are UNCHANGED.
 *
 * @param {{ sandbox: import('./types.js').Sandbox, emit: (ev: unknown) => void }} deps
 * @returns {(state: object) => Promise<{ brandTokens: Record<string, string> }>}
 */
export function createDsCuratorNode({ sandbox, emit }) {
  return async function dsCuratorNode(state) {
    if (state?.signal?.aborted) return { brandTokens: {} };

    /** @type {Record<string, string>} */
    let primary = Object.create(null);
    /** @type {SecondaryVar[]} */
    let secondaryVars = [];

    try {
      if (await sandbox.exists(DESIGN_SYSTEM_PATH)) {
        const raw = await sandbox.readFile(DESIGN_SYSTEM_PATH, { encoding: 'utf-8' });
        const md = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        primary = parseDesignSystemTokens(md);
      }
    } catch {
      // graceful absence
    }

    try {
      if (await sandbox.exists(PROJECT_CONFIG_PATH)) {
        const raw = await sandbox.readFile(PROJECT_CONFIG_PATH, { encoding: 'utf-8' });
        const json = JSON.parse(
          typeof raw === 'string' ? raw : new TextDecoder().decode(raw),
        );
        const vars = json && typeof json.vars === 'object' && json.vars ? json.vars : {};
        secondaryVars = collectSecondaryVars(vars);
      }
    } catch {
      // graceful absence / malformed config
    }

    // Canonical index of the primary tokens — the design system speaks bare
    // names ('brand'); the real preset configs speak 'brandColor'. Exact-key
    // comparison can never see those collide; canonToken can.
    const primaryByCanon = new Map();
    for (const k of Object.keys(primary)) {
      const c = canonToken(k);
      if (!primaryByCanon.has(c)) primaryByCanon.set(c, k);
    }

    // Resolve with `_design-system.md` PRIMARY; config vars fill the gaps.
    // A secondary var whose CANONICAL form collides with a primary token is
    // EXCLUDED from brandTokens (primary wins — the merge must not carry both
    // `brand: #B85B33` and a contradicting `brandcolor: #FF0000`). When the
    // colliding values also DIFFER (normalized — hex compares
    // case-insensitively), surface the conflict note and proceed with primary.
    /** @type {Record<string, string>} */
    const resolved = Object.create(null);
    for (const sv of secondaryVars) {
      const primaryKey = primaryByCanon.get(sv.canon);
      if (primaryKey != null) {
        if (!tokenValuesEqual(primary[primaryKey], sv.value)) {
          const viaKey = sv.lower === primaryKey ? '' : ` (as '${sv.key}')`;
          emit(
            toolCall(
              `brand-token conflict on '${primaryKey}': _design-system.md says '${primary[primaryKey]}', ` +
                `config.json vars${viaKey} says '${sv.value}' — using _design-system.md (primary)`,
            ),
          );
        }
        continue; // canonical collision → excluded; primary supplies the value.
      }
      resolved[sv.lower] = sv.value;
    }
    for (const [k, v] of Object.entries(primary)) resolved[k] = v;

    return { brandTokens: resolved };
  };
}
