// Design-token parser (AC-3 primary authority) — PURE: no fs, no DOM, no
// markdown library, no `node:*`. Reads the canonical machine-parseable token
// block out of `_design-system.md`.
//
// ── Canonical `_design-system.md` token format (fixture + parser lockstep) ────
//
// The fixture's `_design-system.md` carries a fenced block tagged
// `lerret-tokens` with simple `key: value` lines under `colors:` / `fonts:`
// sub-maps (a tiny YAML-ish shape — no `js-yaml` dep):
//
//     ```lerret-tokens
//     colors:
//       brand: "#B85B33"
//       accent: "#F1EDE5"
//       neutralDark: "#1A1714"
//     fonts:
//       display: "Geist"
//       body: "Geist"
//     ```
//
// Rules the parser honors:
//   - Only the FIRST ```lerret-tokens fenced block is read; prose + voice rules
//     outside it are ignored by DS Curator (the Memory agent reads those for
//     prompt context, not this parser).
//   - A line `colors:` / `fonts:` with no value opens that sub-map; ONLY
//     subsequent INDENTED `key: value` lines populate it. Any NON-indented
//     `key: value` line (e.g. a stray top-level `title: My Brand`) CLOSES the
//     open sub-map and is otherwise ignored — it is never recorded as a token.
//   - Values may be quoted ("…" or '…') or bare. A quoted value is the quoted
//     content — anything after the closing quote (a trailing `# comment`) is
//     ignored. An unquoted value strips a trailing ` # comment` (whitespace
//     before the `#` required, so a bare hex like `#B85B33` is untouched).
//     Keys are kept verbatim (case preserved) AND mirrored lowercase so a
//     reference like "brand" or "Brand" both resolve — use `lookupToken` for
//     fully case-insensitive (both-direction) resolution.
//   - Malformed / absent input fails SOFT: empty maps, never a throw (AC-3
//     graceful absence; the fixture is the happy path, real projects vary).

const TOKEN_FENCE_RE = /```lerret-tokens\s*\n([\s\S]*?)\n```/;

/**
 * Resolve a raw value to its token value:
 *   - a QUOTED value ("…" or '…') yields the quoted content; anything after
 *     the closing quote (a trailing YAML-style ` # comment`) is ignored;
 *   - an UNQUOTED value strips a trailing ` # comment` — the strip pattern
 *     requires at least one non-space value character followed by whitespace
 *     before the `#`, so a bare hex value like `#B85B33` is never eaten.
 * Trims whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
function unquote(raw) {
  const v = String(raw ?? '').trim();
  const dq = /^"([^"]*)"/.exec(v);
  if (dq) return dq[1];
  const sq = /^'([^']*)'/.exec(v);
  if (sq) return sq[1];
  return v.replace(/(\S)\s+#.*$/, '$1');
}

/**
 * Set both the verbatim key and its lowercase mirror in a null-proto map so a
 * brand-token reference resolves case-insensitively without polluting the
 * prototype (a token literally named `constructor` stays a real data key).
 *
 * @param {Map<string, string>} map
 * @param {string} key
 * @param {string} value
 */
function setTokenCaseInsensitive(map, key, value) {
  map.set(key, value);
  const lower = key.toLowerCase();
  if (lower !== key && !map.has(lower)) map.set(lower, value);
}

/**
 * Parse the `lerret-tokens` block out of a `_design-system.md` body into
 * `colors` + `fonts` Maps plus the `raw` sub-map objects. Fail-soft.
 *
 * @param {string} designSystemMarkdown
 * @returns {{
 *   colors: Map<string, string>,
 *   fonts: Map<string, string>,
 *   raw: { colors: Record<string, string>, fonts: Record<string, string> },
 * }}
 */
export function parseDesignTokens(designSystemMarkdown) {
  const colors = new Map();
  const fonts = new Map();
  const rawColors = Object.create(null);
  const rawFonts = Object.create(null);
  const empty = { colors, fonts, raw: { colors: rawColors, fonts: rawFonts } };

  if (typeof designSystemMarkdown !== 'string' || designSystemMarkdown.length === 0) {
    return empty;
  }
  const fence = TOKEN_FENCE_RE.exec(designSystemMarkdown);
  if (!fence) return empty;
  const block = fence[1];

  /** @type {Map<string,string> | null} The sub-map currently being filled. */
  let current = null;
  /** @type {Record<string,string> | null} */
  let currentRaw = null;

  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim().length === 0) continue;
    const indented = /^\s+\S/.test(line);
    const m = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];

    if (!indented) {
      if (value === undefined || value.trim().length === 0) {
        // Top-level sub-map header (`colors:` / `fonts:`).
        const k = key.toLowerCase();
        if (k === 'colors') {
          current = colors;
          currentRaw = rawColors;
        } else if (k === 'fonts') {
          current = fonts;
          currentRaw = rawFonts;
        } else {
          current = null;
          currentRaw = null;
        }
      } else {
        // A top-level `key: value` line (`title: My Brand`) CLOSES the open
        // sub-map and is otherwise ignored — never recorded as a token.
        current = null;
        currentRaw = null;
      }
      continue;
    }

    // Population happens ONLY for indented lines under an open sub-map.
    if (current && currentRaw && value !== undefined && value.trim().length > 0) {
      const val = unquote(value);
      setTokenCaseInsensitive(current, key, val);
      currentRaw[key] = val;
    }
  }

  return empty;
}

/**
 * Flatten the parsed design tokens into a single `tokenName → value` lookup
 * Map (colors + fonts merged; on a name collision colors win, which never
 * happens with the canonical format's disjoint namespaces). Used by DS Curator
 * to resolve a brand-token reference against ONE map. Case-insensitive keys are
 * already present from {@link parseDesignTokens}.
 *
 * @param {{ colors: Map<string,string>, fonts: Map<string,string> }} parsed
 * @returns {Map<string, string>}
 */
export function flattenTokens(parsed) {
  const flat = new Map();
  if (!parsed) return flat;
  for (const [k, v] of parsed.fonts ?? []) flat.set(k, v);
  for (const [k, v] of parsed.colors ?? []) flat.set(k, v);
  return flat;
}

/**
 * Case-insensitive token lookup — BOTH directions of the documented contract:
 * the maps mirror mixed-case KEYS lowercase (`neutralDark` → also
 * `neutraldark`), and this helper lowercases the QUERY too, so `Brand` /
 * `BRAND` resolve a stored `brand` just as `neutraldark` resolves a stored
 * `neutralDark`. A verbatim hit wins over the lowercased fallback.
 *
 * @param {Map<string, string>} map  A map from {@link parseDesignTokens} / {@link flattenTokens}.
 * @param {string} name  The token reference, any casing.
 * @returns {string | undefined}
 */
export function lookupToken(map, name) {
  if (!(map instanceof Map)) return undefined;
  const key = String(name ?? '');
  if (map.has(key)) return map.get(key);
  const lower = key.toLowerCase();
  return map.has(lower) ? map.get(lower) : undefined;
}
