// Path-scoped anchoring parser (FR53) — PURE: no fs, no DOM, no `node:*`.
//
// A `_design-system.md` / `_context.md` / `_memory.md` body can carry both
// project-wide ("global") rules AND per-folder rules. A per-folder section is
// opened by an HTML comment of the form:
//
//   <!-- scope: social/ -->
//
// Everything from that comment until the NEXT `<!-- scope: ... -->` comment
// (or EOF) is keyed to that folder path. Content BEFORE the first scope comment
// is `global`. The active turn's target scope selects which scoped sections
// apply: closer-scope rules win (the LONGEST scope key that prefixes the target
// scope is included on top of the global block).
//
// This module is the curation logic Story 8.6 adds: the Memory agent reads the
// raw Markdown and delegates the scope split + closer-scope selection here.

// Case-insensitive: `<!-- Scope: x/ -->` / `<!-- SCOPE: x/ -->` open a section
// exactly like the lowercase form (the key capture preserves its case).
const SCOPE_RE = /<!--\s*scope:\s*([^\s][^>]*?)\s*-->/gi;

/**
 * Normalize a scope key: trim surrounding whitespace and ensure exactly one
 * trailing `/` so folder-prefix matching is unambiguous (`social` and
 * `social/` resolve to the same key). An empty / whitespace-only raw value
 * normalizes to `'/'` (the project root scope).
 *
 * @param {string} raw
 * @returns {string}
 */
export function normalizeScopeKey(raw) {
  let k = String(raw ?? '').trim();
  if (k.length === 0) return '/';
  // Collapse any internal trailing slashes to a single one.
  k = k.replace(/\/+$/, '');
  return k.length === 0 ? '/' : `${k}/`;
}

/**
 * Normalize a TARGET scope the same way scope KEYS are normalized so the
 * prefix comparison in {@link longestPrefixMatch} is apples-to-apples. A
 * nullish / empty target normalizes to `''` (matches global only).
 *
 * @param {string | null | undefined} target
 * @returns {string}
 */
export function normalizeTargetScope(target) {
  if (target == null) return '';
  let t = String(target).trim();
  if (t.length === 0) return '';
  t = t.replace(/\/+$/, '');
  return t.length === 0 ? '/' : `${t}/`;
}

/**
 * Split a Markdown body into a `global` block + a `Map<scopeKey, content>`.
 *
 * A scope key that normalizes to `'/'` (the project root — `<!-- scope: / -->`)
 * is GLOBAL content: its section folds into the global block instead of being
 * keyed (it applies everywhere, and `'/'` could never prefix-match a folder
 * target — keying it would silently drop the content).
 *
 * @param {string} markdown
 * @returns {{ global: string, scopes: Map<string, string> }}
 */
export function parseScopedSections(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) {
    return { global: '', scopes: new Map() };
  }
  /** @type {Map<string, string>} */
  const scopes = new Map();
  let lastIndex = 0;
  /** @type {string | null} `null` ≡ the global (pre-first-comment) block; `'/'` folds in too. */
  let currentKey = null;
  let global = '';
  let m;
  SCOPE_RE.lastIndex = 0;
  while ((m = SCOPE_RE.exec(markdown)) !== null) {
    const chunk = markdown.slice(lastIndex, m.index);
    if (currentKey === null || currentKey === '/') global += chunk;
    else scopes.set(currentKey, (scopes.get(currentKey) ?? '') + chunk);
    currentKey = normalizeScopeKey(m[1]);
    lastIndex = SCOPE_RE.lastIndex;
    // Guard against a zero-width match looping forever (defensive — the
    // regex always advances, but RegExp state is shared across calls).
    if (m.index === SCOPE_RE.lastIndex) SCOPE_RE.lastIndex++;
  }
  const tail = markdown.slice(lastIndex);
  if (currentKey === null || currentKey === '/') global += tail;
  else scopes.set(currentKey, (scopes.get(currentKey) ?? '') + tail);

  // Trim each scoped section so a section is "" iff it is whitespace-only.
  for (const [k, v] of scopes) scopes.set(k, v.trim());
  return { global: global.trim(), scopes };
}

/**
 * Return the content of the LONGEST scope key in `scopes` that is a prefix of
 * `targetScope` (closer-scope wins per AC-2). Returns `''` when no key
 * prefixes the target. Both keys and the target are already trailing-slash
 * normalized, so a simple `startsWith` is a true folder-prefix test
 * (`social/` prefixes `social/twitter/` but not `social-media/`).
 *
 * @param {Map<string, string>} scopes
 * @param {string} targetScope  Already normalized via {@link normalizeTargetScope}.
 * @returns {string}
 */
export function longestPrefixMatch(scopes, targetScope) {
  if (!(scopes instanceof Map) || scopes.size === 0 || !targetScope) return '';
  let best = '';
  let bestLen = -1;
  for (const [key, content] of scopes) {
    if (targetScope.startsWith(key) && key.length > bestLen) {
      best = content;
      bestLen = key.length;
    }
  }
  return best;
}

/**
 * Resolve the global + closer-scope content for a target scope across the
 * design-system and context bodies. Both files contribute their `global` block
 * unconditionally; each then contributes the single closest-scoped section that
 * prefixes `targetScope` (if any). Empty sections drop out.
 *
 * @param {{ designSystem?: string, context?: string, memory?: string }} bodies
 * @param {string | null | undefined} targetScope  Folder path, e.g. `'social-media/'`.
 * @returns {string} The composed brand-context fragment (plain Markdown).
 */
export function resolveScopedContext(bodies, targetScope) {
  const target = normalizeTargetScope(targetScope);
  const parts = [];
  // Apply the same uniform parser to all three files: `_memory.md` is treated
  // as global-only UNLESS it also carries scope comments (then they apply).
  for (const md of [bodies?.designSystem, bodies?.context, bodies?.memory]) {
    if (typeof md !== 'string' || md.length === 0) continue;
    const { global, scopes } = parseScopedSections(md);
    if (global) parts.push(global);
    const match = longestPrefixMatch(scopes, target);
    if (match) parts.push(match);
  }
  return parts.join('\n\n');
}
