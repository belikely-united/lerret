// Visual Edit mode — the source-edit engine (spec-visual-edit-mode.md).
//
// Three pure functions over a `.jsx` source string:
//
//   stampSourceLocations(code, relPath)  → code with `data-lerret-src="rel:offset"`
//                                          on every DOM (lowercase) JSX tag
//   inspectElement(code, offset)         → what is editable on that element
//   applyEdit(code, offset, change)      → { ok, code } | { ok:false, reason }
//
// `offset` is the index of the element's `<` in the ORIGINAL file (what the
// stamp records). Edits splice only the changed characters, so every byte we
// don't touch stays identical — same philosophy as `meta-source-rewriter.js`.
// Anything that is code rather than a literal is reported, never rewritten.
//
// Exposed as the `@lerret/core/source-edit` subpath (not the barrel) so the
// parser is only loaded by consumers that actually edit/stamp.

import { parse } from '@babel/parser';

/** Attribute name carrying `relPath:offset` on every stamped DOM element. */
export const SRC_ATTR = 'data-lerret-src';

// ---------------------------------------------------------------------------
// Parsing + walking
// ---------------------------------------------------------------------------

function parseSource(code, relPath = '') {
  const plugins = /\.tsx?$/.test(relPath) ? ['jsx', 'typescript'] : ['jsx'];
  return parse(code, { sourceType: 'module', plugins });
}

/** Depth-first walk over every AST node; `visit` returning false stops descent. */
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walk(c, visit, node);
    else if (child && typeof child.type === 'string') walk(child, visit, node);
  }
}

function isDomTag(opening) {
  const n = opening.name;
  return n.type === 'JSXIdentifier' && /^[a-z]/.test(n.name);
}

function findElement(ast, offset) {
  return findElementWithParent(ast, offset).el;
}

function findElementWithParent(ast, offset) {
  let el = null;
  let parent = null;
  walk(ast.program, (node, p) => {
    if (el) return false;
    if (node.type === 'JSXElement' && node.start === offset) {
      el = node;
      parent = p;
    }
  });
  return { el, parent };
}

function attrName(attr) {
  return attr.type === 'JSXAttribute' && attr.name.type === 'JSXIdentifier' ? attr.name.name : null;
}

function findAttr(opening, name) {
  return opening.attributes.find((a) => attrName(a) === name) || null;
}

/** Identifier names referenced by an expression (member properties excluded). */
function identifiersIn(node) {
  const names = new Set();
  walk(node, (n) => {
    if (n.type === 'Identifier') names.add(n.name);
    if (n.type === 'MemberExpression' && !n.computed) {
      walk(n.object, (m) => {
        if (m.type === 'Identifier') names.add(m.name);
      });
      return false;
    }
  });
  return [...names];
}

/** Classify a value node: literal (editable), identifier, or expression. */
function describeValue(node, code) {
  if (!node) return { kind: 'literal', value: true }; // bare `<input disabled>`
  if (node.type === 'StringLiteral') return { kind: 'literal', value: node.value };
  if (node.type === 'NumericLiteral') return { kind: 'literal', value: node.value };
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'NumericLiteral') {
    return { kind: 'literal', value: -node.argument.value };
  }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { kind: 'literal', value: node.quasis[0].value.cooked };
  }
  if (node.type === 'Identifier') return { kind: 'identifier', name: node.name };
  return { kind: 'expression', text: code.slice(node.start, node.end), identifiers: identifiersIn(node) };
}

function propKey(prop) {
  if (prop.type !== 'ObjectProperty' || prop.computed) return null;
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

function styleObject(opening) {
  const attr = findAttr(opening, 'style');
  if (!attr) return { attr: null, obj: null };
  const expr = attr.value && attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  return { attr, obj: expr && expr.type === 'ObjectExpression' ? expr : null };
}

/** Children that matter (whitespace-only JSXText is layout noise). */
function meaningfulChildren(el) {
  return el.children.filter((c) => !(c.type === 'JSXText' && !c.value.trim()));
}

function describeText(el, code) {
  if (el.openingElement.selfClosing) return { kind: 'none' };
  const kids = meaningfulChildren(el);
  if (kids.length === 0) return { kind: 'literal', value: '' };
  if (kids.length === 1) {
    const k = kids[0];
    if (k.type === 'JSXText') return { kind: 'literal', value: k.value.trim().replace(/\s+/g, ' ') };
    if (k.type === 'JSXExpressionContainer') {
      const v = describeValue(k.expression, code);
      if (v.kind !== 'expression' || v.identifiers.length) return v;
    }
  }
  return { kind: 'mixed' };
}

/**
 * The exported top-level component enclosing `offset` and its destructured
 * props (`function Hero({ headline = 'Hi' })` → `{ headline: {kind:'literal',
 * value:'Hi'} }`). These props are what the asset's `.data.json` feeds, so an
 * `{headline}` child can be edited through the data file instead of the code.
 * Returns null for helper (non-exported) components — their props come from a
 * parent, not the data file.
 */
function enclosingComponent(ast, offset, code) {
  const exportsByLocal = new Map();
  for (const s of ast.program.body) {
    if (s.type === 'ExportDefaultDeclaration' && s.declaration.type === 'Identifier') {
      exportsByLocal.set(s.declaration.name, 'default');
    }
    if (s.type === 'ExportNamedDeclaration' && !s.declaration) {
      for (const sp of s.specifiers) {
        if (sp.local) exportsByLocal.set(sp.local.name, sp.exported.name ?? sp.exported.value);
      }
    }
  }
  const within = (n) => n && n.start <= offset && offset < n.end;
  for (const s of ast.program.body) {
    if (!within(s)) continue;
    const exported = s.type === 'ExportDefaultDeclaration' ? 'default'
      : s.type === 'ExportNamedDeclaration' ? 'named' : null;
    const decl = exported ? s.declaration : s;
    let fn = null;
    let local = null;
    if (decl && /Function/.test(decl.type)) {
      fn = decl;
      local = decl.id ? decl.id.name : null;
    } else if (decl && decl.type === 'VariableDeclaration') {
      const d = decl.declarations.find((x) => within(x));
      if (d && d.init && /Function/.test(d.init.type)) {
        fn = d.init;
        local = d.id.name;
      }
    }
    if (!fn) return null;
    const exportName = exported === 'default' ? 'default'
      : exported === 'named' ? local : exportsByLocal.get(local);
    if (!exportName) return null;
    const props = {};
    const p = fn.params[0];
    if (p && p.type === 'ObjectPattern') {
      for (const prop of p.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed || prop.key.type !== 'Identifier') continue;
        props[prop.key.name] = prop.value.type === 'AssignmentPattern'
          ? describeValue(prop.value.right, code)
          : null;
      }
    }
    return { exportName, props };
  }
  return null;
}

// ---------------------------------------------------------------------------
// stampSourceLocations
// ---------------------------------------------------------------------------

/**
 * Add `data-lerret-src="relPath:offset"` to every DOM JSX opening tag.
 * Returns the input unchanged when it can't be parsed (the compiler will then
 * report the real syntax error) or when the path can't be safely embedded.
 *
 * @param {string} code
 * @param {string} relPath  Project-relative path, e.g. `ui/Hero.jsx`.
 * @returns {string}
 */
export function stampSourceLocations(code, relPath) {
  if (!code.includes('<') || relPath.includes('"')) return code;
  let ast;
  try {
    ast = parseSource(code, relPath);
  } catch {
    return code;
  }
  const inserts = [];
  walk(ast.program, (node) => {
    if (node.type !== 'JSXElement') return;
    const op = node.openingElement;
    if (isDomTag(op) && !findAttr(op, SRC_ATTR)) {
      inserts.push({ at: op.name.end, text: ` ${SRC_ATTR}="${relPath}:${node.start}"` });
    }
  });
  if (!inserts.length) return code;
  let out = '';
  let last = 0;
  for (const { at, text } of inserts.sort((a, b) => a.at - b.at)) {
    out += code.slice(last, at) + text;
    last = at;
  }
  return out + code.slice(last);
}

/**
 * Vite plugin (plain object — core stays free of a Vite import) that stamps
 * every `.jsx`/`.tsx` under a `.lerret/` folder before Vite compiles it.
 * Used by `@lerret/cli dev` and the studio's fixture dev server. The stamp
 * path is the module's absolute file path — the same path the studio's
 * read/write helpers take.
 */
export function createSourceStampPlugin() {
  return {
    name: 'lerret:source-stamp',
    enforce: 'pre',
    transform(code, id) {
      const [file, query = ''] = id.split('?');
      if (/(^|&)(raw|url|inline|worker)\b/.test(query)) return null;
      const path = file.replaceAll('\\', '/');
      if (!/\/\.lerret\//.test(path) || !/\.[jt]sx$/.test(path) || path.includes('/node_modules/')) return null;
      const out = stampSourceLocations(code, path);
      return out === code ? null : { code: out, map: null };
    },
  };
}

/**
 * Parse a stamp value (`"ui/Hero.jsx:1834"`) into `{ path, offset }`.
 * @param {string|null|undefined} value
 */
export function parseSourceStamp(value) {
  const m = /^(.*):(\d+)$/.exec(value || '');
  return m ? { path: m[1], offset: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// inspectElement
// ---------------------------------------------------------------------------

/**
 * Describe what's editable on the element whose `<` sits at `offset`.
 * Every value is `{kind:'literal', value}` (editable), `{kind:'identifier',
 * name}` (maybe a prop), or `{kind:'expression', text, identifiers}` (code).
 *
 * @returns {{ ok: true, tag: string, text: object, style: object|null,
 *   styleEditable: boolean, attrs: Record<string, object>, hasSpread: boolean }
 *   | { ok: false, reason: string }}
 */
export function inspectElement(code, offset, relPath = '') {
  let ast;
  try {
    ast = parseSource(code, relPath);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  const el = findElement(ast, offset);
  if (!el) return { ok: false, reason: 'not-found' };
  const op = el.openingElement;

  const { attr: styleAttr, obj } = styleObject(op);
  let style = {};
  if (obj) {
    for (const p of obj.properties) {
      const key = propKey(p);
      if (key) style[key] = describeValue(p.value, code);
    }
  } else if (styleAttr) {
    style = null; // `style={styles.x}` — the whole thing is code
  }

  const attrs = {};
  for (const a of op.attributes) {
    const name = attrName(a);
    if (!name || name === 'style' || name === SRC_ATTR) continue;
    const v = a.value && a.value.type === 'JSXExpressionContainer' ? a.value.expression : a.value;
    attrs[name] = describeValue(v, code);
  }

  return {
    ok: true,
    tag: op.name.name ?? code.slice(op.name.start, op.name.end),
    text: describeText(el, code),
    style,
    styleEditable: style !== null,
    attrs,
    // `{ exportName, props }` — props an `{identifier}` may be bound to.
    component: enclosingComponent(ast, offset, code),
    hasSpread: op.attributes.some((a) => a.type === 'JSXSpreadAttribute'),
  };
}

// ---------------------------------------------------------------------------
// applyEdit
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z_$][\w$]*$/;

function quoteFor(code, obj) {
  const s = obj && obj.properties.find((p) => p.value && p.value.type === 'StringLiteral');
  if (s) return code[s.value.start];
  return code.includes("'") || !code.includes('"') ? "'" : '"';
}

function jsString(value, q) {
  const esc = String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').split(q).join('\\' + q);
  return q + esc + q;
}

function jsValue(value, q) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : jsString(value, q);
}

function splice(code, start, end, text) {
  return { ok: true, code: code.slice(0, start) + text + code.slice(end) };
}

function editText(code, el, value) {
  if (el.openingElement.selfClosing) return { ok: false, reason: 'self-closing' };
  const kids = meaningfulChildren(el);
  const safe = !/[{}<>]/.test(value);
  if (kids.length === 0) {
    const at = el.openingElement.end;
    return splice(code, at, at, safe ? value : `{${JSON.stringify(value)}}`);
  }
  if (kids.length !== 1) return { ok: false, reason: 'text-is-code' };
  const k = kids[0];
  if (k.type === 'JSXText') {
    const lead = k.value.length - k.value.trimStart().length;
    const trail = k.value.length - k.value.trimEnd().length;
    return splice(code, k.start + lead, k.end - trail, safe ? value : `{${JSON.stringify(value)}}`);
  }
  if (k.type === 'JSXExpressionContainer' && describeValue(k.expression, code).kind === 'literal'
      && k.expression.type !== 'NumericLiteral') {
    const q = code[k.expression.start] === '"' ? '"' : "'";
    return splice(code, k.expression.start, k.expression.end, jsString(value, q));
  }
  return { ok: false, reason: 'text-is-code' };
}

function lineIndent(code, pos) {
  const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))[0];
}

function editStyle(code, op, key, value) {
  const { attr, obj } = styleObject(op);
  if (attr && !obj) return { ok: false, reason: 'style-is-code' };
  const q = quoteFor(code, obj);
  const keyText = IDENT.test(key) ? key : jsString(key, q);

  if (!attr) {
    if (value === undefined) return { ok: true, code };
    const at = op.attributes.length ? op.attributes[op.attributes.length - 1].end : op.name.end;
    return splice(code, at, at, ` style={{ ${keyText}: ${jsValue(value, q)} }}`);
  }

  const props = obj.properties;
  const idx = props.findIndex((p) => propKey(p) === key);
  const prop = props[idx];

  if (prop) {
    if (describeValue(prop.value, code).kind !== 'literal') return { ok: false, reason: 'value-is-code' };
    if (value !== undefined) return splice(code, prop.value.start, prop.value.end, jsValue(value, q));
    // Remove the property together with one adjoining separator.
    if (props.length === 1) return splice(code, obj.start + 1, obj.end - 1, '');
    if (idx < props.length - 1) return splice(code, prop.start, props[idx + 1].start, '');
    return splice(code, props[idx - 1].end, prop.end, '');
  }

  if (value === undefined) return { ok: true, code };
  const entry = `${keyText}: ${jsValue(value, q)}`;
  if (!props.length) return splice(code, obj.start + 1, obj.end - 1, ` ${entry} `);
  const last = props[props.length - 1];
  const after = code.slice(last.end, obj.end - 1);
  const trailingComma = /^\s*,/.test(after);
  const multiline = code.slice(obj.start, obj.end).includes('\n');
  if (multiline) {
    const indent = lineIndent(code, last.start);
    if (trailingComma) {
      const at = last.end + after.indexOf(',') + 1;
      return splice(code, at, at, `\n${indent}${entry},`);
    }
    return splice(code, last.end, last.end, `,\n${indent}${entry}`);
  }
  return splice(code, last.end, last.end, `, ${entry}`);
}

function editAttr(code, op, name, value) {
  if (!/^[A-Za-z_][\w:-]*$/.test(name) || name === 'style' || name === SRC_ATTR) {
    return { ok: false, reason: 'bad-attr' };
  }
  const attr = findAttr(op, name);
  const text = value === undefined ? '' : /["{}]/.test(String(value))
    ? `{${JSON.stringify(String(value))}}`
    : `"${value}"`;
  if (!attr) {
    if (value === undefined) return { ok: true, code };
    const at = op.attributes.length ? op.attributes[op.attributes.length - 1].end : op.name.end;
    return splice(code, at, at, ` ${name}=${text}`);
  }
  const v = attr.value && attr.value.type === 'JSXExpressionContainer' ? attr.value.expression : attr.value;
  if (v && describeValue(v, code).kind !== 'literal') return { ok: false, reason: 'value-is-code' };
  if (value === undefined) {
    let start = attr.start;
    while (start > 0 && /\s/.test(code[start - 1])) start--;
    return splice(code, start, attr.end, '');
  }
  if (!attr.value) return splice(code, attr.end, attr.end, `=${text}`);
  return splice(code, attr.value.start, attr.value.end, text);
}

/**
 * Duplicate / remove an element. Only for a plain JSX child (its parent is a
 * JSX element or fragment) — never `{cond && <x/>}`, a `.map()` body or a
 * `return <x/>`, where splicing would break the code.
 */
function editStructure(code, el, parent, type) {
  if (!parent || (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')) {
    return { ok: false, reason: 'structure-is-code' };
  }
  const lineStart = code.lastIndexOf('\n', el.start - 1) + 1;
  const ownLine = /^[ \t]*$/.test(code.slice(lineStart, el.start));
  const lineEnd = code.indexOf('\n', el.end);
  const endsLine = /^[ \t]*$/.test(code.slice(el.end, lineEnd === -1 ? code.length : lineEnd));
  const source = code.slice(el.start, el.end);
  if (type === 'duplicate') {
    const copy = ownLine ? `\n${code.slice(lineStart, el.start)}${source}` : source;
    return splice(code, el.end, el.end, copy);
  }
  // remove: take the whole line when the element sits on its own line(s)
  if (ownLine && endsLine && lineEnd !== -1) return splice(code, lineStart, lineEnd + 1, '');
  return splice(code, el.start, el.end, '');
}

/**
 * Apply one change to the element at `offset`.
 *
 * change:
 *   { type: 'text',  value }            replace literal text children
 *   { type: 'style', key, value }       set a style key (value undefined = remove)
 *   { type: 'attr',  name, value }      set a string attribute (undefined = remove)
 *   { type: 'duplicate' } / { type: 'remove' }   copy / delete the element
 *   + optional `expectTag` — refuse with 'changed' when the tag differs
 *     (the file moved under us since the element was selected).
 *
 * @returns {{ ok: true, code: string } | { ok: false, reason: string }}
 */
export function applyEdit(code, offset, change, relPath = '') {
  let ast;
  try {
    ast = parseSource(code, relPath);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  const { el, parent } = findElementWithParent(ast, offset);
  if (!el) return { ok: false, reason: 'changed' };
  const op = el.openingElement;
  if (change.expectTag && op.name.name !== change.expectTag) return { ok: false, reason: 'changed' };
  if (change.type === 'duplicate' || change.type === 'remove') return editStructure(code, el, parent, change.type);
  if (change.type === 'text') return editText(code, el, String(change.value ?? ''));
  if (change.type === 'style') return editStyle(code, op, change.key, change.value);
  if (change.type === 'attr') return editAttr(code, op, change.name, change.value);
  return { ok: false, reason: 'unknown-change' };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/** A variant name must be a PascalCase JS identifier (it becomes an export). */
export const VARIANT_NAME = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * The asset's exports: `[{ name, local }]` where `local` is the binding a new
 * variant can point at (null for an anonymous default / non-binding export).
 */
function listExports(ast) {
  const out = [];
  for (const s of ast.program.body) {
    if (s.type === 'ExportDefaultDeclaration') {
      const d = s.declaration;
      out.push({ name: 'default', local: d.type === 'Identifier' ? d.name : d.id ? d.id.name : null });
    } else if (s.type === 'ExportNamedDeclaration') {
      const d = s.declaration;
      if (d && d.id) out.push({ name: d.id.name, local: d.id.name });
      if (d && d.type === 'VariableDeclaration') {
        for (const v of d.declarations) if (v.id.type === 'Identifier') out.push({ name: v.id.name, local: v.id.name });
      }
      for (const sp of s.specifiers || []) {
        const name = sp.exported.name ?? sp.exported.value;
        out.push({ name, local: s.source ? null : sp.local.name });
      }
    }
  }
  return out;
}

/** Export names of an asset source (for the "New variant" name check). */
export function listExportNames(code, relPath = '') {
  try {
    return listExports(parseSource(code, relPath)).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Add a variant: `export const <name> = <component behind \`from\`>;` at the
 * end of the file. Same component, new artboard — its content comes from the
 * data file's `<name>` slot.
 *
 * @returns {{ ok: true, code: string, exports: string[] } | { ok: false, reason: string }}
 */
export function addVariantExport(code, name, from = 'default', relPath = '') {
  if (!VARIANT_NAME.test(name) || name === 'Meta') return { ok: false, reason: 'variant-name' };
  let ast;
  try {
    ast = parseSource(code, relPath);
  } catch {
    return { ok: false, reason: 'parse-error' };
  }
  const exps = listExports(ast);
  if (exps.some((e) => e.name === name)) return { ok: false, reason: 'variant-exists' };
  const source = exps.find((e) => e.name === from) || exps.find((e) => e.name === 'default');
  if (!source || !source.local) return { ok: false, reason: 'variant-anonymous' };
  const sep = code.endsWith('\n') ? '' : '\n';
  return {
    ok: true,
    code: `${code}${sep}export const ${name} = ${source.local};\n`,
    exports: [...exps.map((e) => e.name), name],
  };
}

/** Human-readable reasons for `{ ok:false }` results — shown in the Inspector. */
export const EDIT_REASONS = {
  'parse-error': 'This file has a syntax error — fix it in code first.',
  'not-found': 'Couldn’t find this element in the source.',
  changed: 'This file changed — click the element again.',
  'self-closing': 'This element has no text.',
  'text-is-code': 'This text is set by code.',
  'style-is-code': 'Styles here are set by code.',
  'value-is-code': 'This value is set by code.',
  'bad-attr': 'That attribute can’t be edited here.',
  'variant-name': 'Use a name like Dark or Holiday (starts with a capital letter, letters and numbers only).',
  'variant-exists': 'A variant with that name already exists.',
  'variant-anonymous': 'The main component has no name — give it one (export default function Card…) to add variants.',
  'structure-is-code': 'This element is placed by code (a condition, list or return) — edit the file.',
  'unknown-change': 'Unsupported change.',
};
