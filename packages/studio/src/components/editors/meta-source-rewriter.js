// meta-source-rewriter.js — pure source-surgery for an asset's `meta` export
//.
//
// ── What this does ───────────────────────────────────────────────────────────
// Given the FULL source text of a `.jsx` / `.tsx` asset file, locates the
// `export const meta = { … }` block at module top-level and replaces ONLY that
// object-literal span with a freshly-serialized object built from the editor's
// next-meta value. Everything else — component code, other exports, imports,
// comments *outside* the meta block — is preserved byte-for-byte (NFR9 atomic
// safe-write guarantees no truncation; this function additionally guarantees
// no semantic corruption of the rest of the file).
//
// ── Approach ─────────────────────────────────────────────────────────────────
// Pure regex + balanced-brace scanning. We deliberately DO NOT pull in an AST
// library (`acorn`, `recast`, …) — every author-friendly form documented by the
// PRD is reachable with a small, auditable parser. When the source uses a shape
// outside that supported matrix the function returns `{ ok: false, reason }`
// and the caller surfaces "open the file in your editor" guidance (NFR8). At
// no point is a half-edited or syntactically-invalid file written back.
//
// ── Author conventions supported (the "support matrix") ──────────────────────
//
// 1. The conventional declaration:
//
// export const meta = {
// dimensions: { width: 320, height: 200 },
// label: 'Primary button',
// tags: ['button', 'cta'],
// propsSchema: { … },
// };
//
// 2. `let` / `var` in place of `const`:
//
// export let meta = { … };
// export var meta = { … };
//
// 3. Single-line declarations:
//
// export const meta = { dimensions: { width: 320, height: 200 } };
//
// 4. Multi-line, mixed indent (tabs/spaces), with or without a trailing
// semicolon, with or without trailing commas, with single- or double-quoted
// strings, and with comments INSIDE the object literal — those comments
// are dropped on rewrite (the rewriter emits a canonical object). Comments
// OUTSIDE the literal (above the `export const meta` line, between the meta
// block and the rest of the source) are preserved verbatim.
//
// 5. The variable name MUST be exactly `meta`. `Meta`, `META`, `_meta`, etc.
// are not the public contract and not supported here — the rewriter returns
// `{ ok: false }` so the editor's "edit the file by hand" guidance kicks in.
//
// ── Forms intentionally NOT supported ─────────────────────────────────────────
//
// • The right-hand-side is NOT an object literal. E.g.
//
// export const meta = buildMeta();
// export const meta = MERGED_META;
// export const meta = { ...DEFAULT_META, label: 'x' };
//
// A computed value cannot be safely re-serialized in-place without losing
// the user's expression. `{ ok: false, reason: 'meta is not an object literal' }`.
//
// • A "named export" form (`export { meta }` separately from the declaration) —
// supported by the JS spec but not idiomatic; rewriter returns
// `{ ok: false }` so the user edits the file directly.
//
// • Multiple `export const meta` declarations in the same file (which would
// anyway be a syntax error in real JS, but defend against it). Anything
// after the first match is ignored; we only rewrite the first occurrence.
//
// ── What the rewritten object looks like ─────────────────────────────────────
// The emitted object uses two-space indent, double-quoted JSON-style strings
// for object keys (bare-identifier-style), and ordered keys —
// `dimensions`, `label`, `tags`, `propsSchema` (when present).
// `propsSchema` is preserved verbatim by copying its original source span
// (the rewriter doesn't reformat the schema — only the three user-edited
// fields are re-serialized). This keeps schema authoring stable across saves.

/**
 * The four well-known top-level keys of an asset's `meta`. The rewriter emits
 * them in this order; any other top-level keys in the input `nextMeta` are
 * ignored (they cannot be edited from the Meta editor in this story).
 *
 * @type {readonly ['dimensions','label','tags','propsSchema']}
 */
const META_KEY_ORDER = /** @type {const} */ (['dimensions', 'label', 'tags', 'propsSchema']);

/**
 * The result of {@link rewriteMetaExport}.
 *
 * @typedef {{ ok: true, source: string } | { ok: false, reason: string }} RewriteResult
 */

/**
 * The next-meta shape the editor hands in. Only `dimensions`, `label`, and
 * `tags` may be edited via the editor in this story; `propsSchema` is read
 * from the existing source span and carried through unchanged.
 *
 * @typedef {object} NextMeta
 * @property {{ width?: number, height?: number }} [dimensions]
 * @property {string | undefined} [label]
 * @property {string[]} [tags]
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Locate the matching `}` for the `{` at `openIdx`, ignoring braces inside
 * single-quoted strings, double-quoted strings, template literals, line
 * comments, and block comments. The scanner is intentionally string-aware but
 * NOT a full JS lexer — that's enough for object-literal `meta` blocks, which
 * cannot contain executable statements at the top level.
 *
 * Returns the index of the closing `}` (inclusive), or -1 if not found.
 *
 * @param {string} src
 * @param {number} openIdx Position of the opening `{`.
 * @returns {number}
 */
function findMatchingBrace(src, openIdx) {
 let depth = 0;
 let i = openIdx;
 const n = src.length;
 while (i < n) {
 const c = src[i];

 // String literals
 if (c === '"' || c === "'" || c === '`') {
 const quote = c;
 i += 1;
 while (i < n) {
 const cc = src[i];
 if (cc === '\\') { i += 2; continue; }
 // template-string interpolation can re-enter expression-land; treat the
 // `${…}` body as a balanced brace pair so we don't get confused.
 if (quote === '`' && cc === '$' && src[i + 1] === '{') {
 const close = findMatchingBrace(src, i + 1);
 if (close === -1) return -1;
 i = close + 1;
 continue;
 }
 if (cc === quote) { i += 1; break; }
 i += 1;
 }
 continue;
 }

 // Line comment `// …`
 if (c === '/' && src[i + 1] === '/') {
 const nl = src.indexOf('\n', i + 2);
 i = nl === -1 ? n : nl;
 continue;
 }

 // Block comment `/* … */`
 if (c === '/' && src[i + 1] === '*') {
 const end = src.indexOf('*/', i + 2);
 if (end === -1) return -1;
 i = end + 2;
 continue;
 }

 // Braces
 if (c === '{') depth += 1;
 else if (c === '}') {
 depth -= 1;
 if (depth === 0) return i;
 }

 i += 1;
 }
 return -1;
}

/**
 * Inside an already-located meta object span, find the literal source range
 * (start..end inclusive of value, excluding trailing comma) for a top-level
 * key. We do this so `propsSchema` can be carried through verbatim. Returns
 * `null` if the key is not present.
 *
 * The scanner walks the body, skipping nested braces/brackets/strings/comments
 * the same way as {@link findMatchingBrace}. It looks for top-level
 * `<key>` then `:` then a value, where the value ends at the next top-level
 * `,` or the final `}`.
 *
 * @param {string} src The full source text.
 * @param {number} bodyStart Index AFTER the opening `{` of the meta literal.
 * @param {number} bodyEnd Index OF the closing `}`.
 * @param {string} key The bare key name to find.
 * @returns {{ start: number, end: number } | null}
 * start: index of the first non-whitespace char of the value
 * end: index AFTER the last char of the value (exclusive)
 */
function findKeySpan(src, bodyStart, bodyEnd, key) {
 // We need to walk the body and split on top-level commas. We don't actually
 // need a parser: scan, track string/comment/nesting depth, and at each
 // top-level entry, snapshot the key. When we find the requested key, snapshot
 // the value-span by walking until the next top-level `,` or the body end.
 let i = bodyStart;
 while (i < bodyEnd) {
 // Skip whitespace.
 while (i < bodyEnd && /\s/.test(src[i])) i += 1;
 if (i >= bodyEnd) return null;

 // Skip comments at the entry boundary.
 if (src[i] === '/' && src[i + 1] === '/') {
 const nl = src.indexOf('\n', i + 2);
 i = nl === -1 ? bodyEnd : nl + 1;
 continue;
 }
 if (src[i] === '/' && src[i + 1] === '*') {
 const end = src.indexOf('*/', i + 2);
 if (end === -1) return null;
 i = end + 2;
 continue;
 }

 // Read the key — bare identifier OR a quoted string. We don't need a
 // perfect JS identifier grammar; the well-known keys are ASCII-only.
 let keyName;
 if (src[i] === '"' || src[i] === "'") {
 const quote = src[i];
 const close = src.indexOf(quote, i + 1);
 if (close === -1) return null;
 keyName = src.slice(i + 1, close);
 i = close + 1;
 } else {
 const m = /[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
 if (!m || m.index !== 0) return null;
 keyName = m[0];
 i += keyName.length;
 }

 // Skip whitespace to the `:`.
 while (i < bodyEnd && /\s/.test(src[i])) i += 1;
 if (src[i] !== ':') return null;
 i += 1;
 // Skip whitespace after the `:`.
 while (i < bodyEnd && /\s/.test(src[i])) i += 1;

 const valueStart = i;

 // Walk the value — track string/comment/nesting depth until we find the
 // top-level comma or hit the body end.
 while (i < bodyEnd) {
 const c = src[i];
 if (c === '"' || c === "'" || c === '`') {
 const quote = c;
 i += 1;
 while (i < bodyEnd) {
 const cc = src[i];
 if (cc === '\\') { i += 2; continue; }
 if (quote === '`' && cc === '$' && src[i + 1] === '{') {
 const close = findMatchingBrace(src, i + 1);
 if (close === -1) return null;
 i = close + 1;
 continue;
 }
 if (cc === quote) { i += 1; break; }
 i += 1;
 }
 continue;
 }
 if (c === '/' && src[i + 1] === '/') {
 const nl = src.indexOf('\n', i + 2);
 i = nl === -1 ? bodyEnd : nl;
 continue;
 }
 if (c === '/' && src[i + 1] === '*') {
 const end = src.indexOf('*/', i + 2);
 if (end === -1) return null;
 i = end + 2;
 continue;
 }
 if (c === '{' || c === '[' || c === '(') {
 const close = c === '{' ? findMatchingBrace(src, i) : findMatchingBracket(src, i, c);
 if (close === -1) return null;
 i = close + 1;
 continue;
 }
 if (c === ',') break;
 i += 1;
 }

 // Trim trailing whitespace off the value span.
 let valueEnd = i;
 while (valueEnd > valueStart && /\s/.test(src[valueEnd - 1])) valueEnd -= 1;

 if (keyName === key) {
 return { start: valueStart, end: valueEnd };
 }

 // Advance past the comma (if any) for the next entry.
 if (src[i] === ',') i += 1;
 }
 return null;
}

/**
 * findMatchingBrace, but for `(` or `[`. Same string/comment-aware scan, so
 * nested function calls or arrays inside a value don't fool us.
 *
 * @param {string} src
 * @param {number} openIdx
 * @param {'[' | '('} open
 * @returns {number}
 */
function findMatchingBracket(src, openIdx, open) {
 const close = open === '[' ? ']' : ')';
 let depth = 0;
 let i = openIdx;
 const n = src.length;
 while (i < n) {
 const c = src[i];
 if (c === '"' || c === "'" || c === '`') {
 const quote = c;
 i += 1;
 while (i < n) {
 const cc = src[i];
 if (cc === '\\') { i += 2; continue; }
 if (quote === '`' && cc === '$' && src[i + 1] === '{') {
 const cb = findMatchingBrace(src, i + 1);
 if (cb === -1) return -1;
 i = cb + 1;
 continue;
 }
 if (cc === quote) { i += 1; break; }
 i += 1;
 }
 continue;
 }
 if (c === '/' && src[i + 1] === '/') {
 const nl = src.indexOf('\n', i + 2);
 i = nl === -1 ? n : nl;
 continue;
 }
 if (c === '/' && src[i + 1] === '*') {
 const end = src.indexOf('*/', i + 2);
 if (end === -1) return -1;
 i = end + 2;
 continue;
 }
 if (c === '{') {
 const cb = findMatchingBrace(src, i);
 if (cb === -1) return -1;
 i = cb + 1;
 continue;
 }
 if (c === open) depth += 1;
 else if (c === close) {
 depth -= 1;
 if (depth === 0) return i;
 }
 i += 1;
 }
 return -1;
}

/**
 * Locate the meta declaration in the source. Returns the position of the
 * opening `{` and the position of its matching `}` (both inclusive), the
 * absolute span of the declaration (from `export` to the closing `}` and
 * optional trailing `;`), and the `let`/`const`/`var` keyword found.
 *
 * Returns `null` when no `export const meta = {…}` style declaration is
 * present (or when the right-hand side is not an object literal).
 *
 * @param {string} src
 * @returns {{
 * keyword: 'const' | 'let' | 'var',
 * declStart: number, // index of `export`
 * declEnd: number, // index after the closing `}` (and trailing `;` if any)
 * braceOpen: number, // index of the `{`
 * braceClose: number, // index of the `}`
 * } | null}
 */
export function findMetaDeclaration(src) {
 // Match `export <const|let|var> meta = {` at the start of a line (allowing
 // leading whitespace). The `m` flag anchors `^` to line starts. We require
 // a `{` to follow the `=` — anything else (a function call, an identifier,
 // a spread expression, …) is not an object literal and we bail.
 const re = /^[ \t]*export\s+(const|let|var)\s+meta\s*=\s*\{/m;
 const match = re.exec(src);
 if (!match) return null;

 const keyword = /** @type {'const'|'let'|'var'} */ (match[1]);
 const declStart = match.index;
 // The `{` is the last char of the match (the regex ends on it).
 const braceOpen = match.index + match[0].length - 1;

 const braceClose = findMatchingBrace(src, braceOpen);
 if (braceClose === -1) return null;

 // Include an optional trailing semicolon (and any whitespace before it on
 // the same line) so the rewriter can emit a fresh terminator cleanly.
 let declEnd = braceClose + 1;
 // Skip trailing whitespace on the closing line, then a semicolon if present.
 let lookahead = declEnd;
 while (lookahead < src.length && (src[lookahead] === ' ' || src[lookahead] === '\t')) lookahead += 1;
 if (src[lookahead] === ';') declEnd = lookahead + 1;

 return { keyword, declStart, declEnd, braceOpen, braceClose };
}

/**
 * Serialize a string value using double quotes, with the minimum number of
 * JSON-style escapes. Returns the quoted string including the surrounding `"`.
 *
 * @param {string} s
 * @returns {string}
 */
function serializeString(s) {
 // Use JSON.stringify — it handles all the edge cases (backslashes, control
 // chars, unicode escapes). The double quotes that result are what we want.
 return JSON.stringify(s);
}

/**
 * Serialize a (non-empty) array of strings inline. We don't break arrays
 * across multiple lines for the editor's path because tags are short.
 *
 * @param {string[]} arr
 * @returns {string}
 */
function serializeStringArray(arr) {
 if (arr.length === 0) return '[]';
 return `[${arr.map(serializeString).join(', ')}]`;
}

/**
 * Serialize the `dimensions` sub-object. Always inline; only includes the
 * `width` / `height` that are positive finite numbers — anything else is
 * omitted (matches the parser's "default to undefined" behavior in core's
 * `parseMeta` / `toDimension`).
 *
 * @param {{ width?: unknown, height?: unknown } | undefined | null} d
 * @returns {string}
 */
function serializeDimensions(d) {
 if (!d || typeof d !== 'object') return '{}';
 const w = d.width;
 const h = d.height;
 const parts = [];
 if (typeof w === 'number' && Number.isFinite(w) && w > 0) parts.push(`width: ${w}`);
 if (typeof h === 'number' && Number.isFinite(h) && h > 0) parts.push(`height: ${h}`);
 return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

/**
 * Indent every line of a block of text by `n` spaces. Used to inject the
 * carried-through `propsSchema` source under the right indentation level.
 *
 * @param {string} text
 * @param {number} n
 * @returns {string}
 */
function indentBlock(text, n) {
 const pad = ' '.repeat(n);
 return text
 .split('\n')
 .map((line, idx) => (idx === 0 ? line : (line.length > 0 ? pad + line : line)))
 .join('\n');
}

/**
 * Locate the `meta` declaration in `source` and return its rewritten form so
 * the well-known top-level keys (`dimensions`, `label`, `tags`) carry the
 * editor's new values. The `propsSchema` key, if present in the original,
 * is preserved VERBATIM (we copy its source span unchanged).
 *
 * Returns `{ ok: false, reason }` for any source the safe rewriter cannot
 * handle — e.g., no `export const meta` found, the meta value is a function
 * call or an identifier (not an object literal), or the source has no
 * matching `}`. On `ok: false` the caller surfaces the "open the file in
 * your editor" guidance.
 *
 * @param {string} source The full source text of the asset file.
 * @param {NextMeta} nextMeta
 * The next-meta value the editor wants to write. Keys not present here are
 * omitted from the rewritten object (e.g. `label === undefined` drops the
 * key). `propsSchema` in `nextMeta` is IGNORED — the editor doesn't edit it
 * in this story; the source span is used instead.
 * @returns {RewriteResult}
 */
export function rewriteMetaExport(source, nextMeta) {
 if (typeof source !== 'string') {
 return { ok: false, reason: 'source must be a string' };
 }
 if (!nextMeta || typeof nextMeta !== 'object' || Array.isArray(nextMeta)) {
 return { ok: false, reason: 'nextMeta must be an object' };
 }

 const decl = findMetaDeclaration(source);
 if (!decl) {
 return {
 ok: false,
 reason: 'no `export const meta = { ... }` declaration found, or the value is not an object literal',
 };
 }

 // The body of the meta object literal — between the `{` and `}` (exclusive
 // of both). We use this to find `propsSchema` and carry it through.
 const bodyStart = decl.braceOpen + 1;
 const bodyEnd = decl.braceClose;

 const propsSchemaSpan = findKeySpan(source, bodyStart, bodyEnd, 'propsSchema');
 /** @type {string | null} */
 let propsSchemaSource = null;
 if (propsSchemaSpan) {
 propsSchemaSource = source.slice(propsSchemaSpan.start, propsSchemaSpan.end);
 }

 // Build the new object literal. Two-space indent, keys ordered.
 const lines = ['{'];

 for (const key of META_KEY_ORDER) {
 if (key === 'propsSchema') {
 if (propsSchemaSource !== null) {
 // Carry through verbatim. Re-indent the FIRST line under our 2-space
 // base. Continuation lines are re-indented relative to the original
 // surrounding context by adding 2 spaces. The user's internal shape
 // is preserved.
 const reindented = indentBlock(propsSchemaSource, 2);
 lines.push(` propsSchema: ${reindented},`);
 }
 continue;
 }

 if (key === 'dimensions') {
 // Always emit `dimensions` so the user sees the field even when they
 // cleared both axes — an empty object is still valid (and core's
 // parser returns defaults). When `nextMeta.dimensions` is missing
 // entirely (the editor didn't include it), skip the key.
 if (Object.prototype.hasOwnProperty.call(nextMeta, 'dimensions')) {
 lines.push(` dimensions: ${serializeDimensions(nextMeta.dimensions)},`);
 }
 continue;
 }

 if (key === 'label') {
 const label = nextMeta.label;
 if (typeof label === 'string' && label.trim().length > 0) {
 lines.push(` label: ${serializeString(label.trim())},`);
 }
 continue;
 }

 if (key === 'tags') {
 const tags = Array.isArray(nextMeta.tags)
 ? nextMeta.tags.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim())
 : null;
 if (tags && tags.length > 0) {
 lines.push(` tags: ${serializeStringArray(tags)},`);
 }
 continue;
 }
 }

 lines.push('}');
 // Replace the meta block with the rewritten one. The new declaration carries
 // the same keyword (const/let/var) and ends with the same trailing `;` shape
 // — we always emit a `;` so the rewritten file has a clean terminator even
 // if the original didn't.
 const newBlock = `export ${decl.keyword} meta = ${lines.join('\n')};`;

 const out = source.slice(0, decl.declStart) + newBlock + source.slice(decl.declEnd);
 return { ok: true, source: out };
}
