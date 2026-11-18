// inline-loader.js — run asset modules inside an MCP Apps iframe
// (plan-mcp-app-studio.md, Phase 0 findings).
//
// Chat hosts (Claude, ChatGPT) draw the app in a sandboxed iframe whose CSP is
// `script-src 'self' 'unsafe-inline' <declared domains>`: no service worker, no
// `blob:` / `data:` scripts, no `eval`. The hosted runtime normally serves
// Sucrase-transformed asset modules from a service worker; here it is handed a
// fake one (`createModuleStore`) and this loader instead:
//
//   1. turns each stored ES module into CommonJS (Sucrase `imports`),
//   2. wraps it as `__lerretDefine(url, function (require, module, exports) {…})`,
//   3. injects that as an INLINE <script> (allowed by 'unsafe-inline'),
//   4. calls the factory with a `require` that maps bare specifiers to the
//      studio's own React / Mermaid and relative files to stored modules,
//      images (data URLs) and CSS.
//
// Module instances are cached by URL, and the runtime's URLs carry a content
// hash, so an unchanged file is evaluated once and an edited one fresh — the
// same semantics as the service-worker path.

import { transform } from 'sucrase';
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';

import { HOSTED_ASSET_URL_PREFIX } from '../runtime/sucrase-runtime.js';
import { imageMime } from '../runtime/hosted-images.js';
import { bytesToDataUrl } from '../runtime/diagram-theme.js';

/**
 * An ES namespace as a CommonJS module Sucrase's interop understands:
 * `import X from 'm'` reads `.default`, `import * as X` keeps the names.
 */
const asCjs = (ns) => ({ ...ns, default: ns.default ?? ns, __esModule: true });

/** Bare specifiers assets may import, resolved to the studio's own copies. */
const BUILTINS = {
  react: asCjs(React),
  'react/jsx-runtime': asCjs(JsxRuntime),
  'react/jsx-dev-runtime': asCjs(JsxRuntime),
  'react-dom': asCjs(ReactDOM),
  'react-dom/client': asCjs(ReactDOMClient),
};

/** `require('…')` calls in Sucrase's CommonJS output. */
const REQUIRE_RE = /\brequire\(\s*(['"])([^'"\n]+)\1\s*\)/g;

/**
 * A stand-in for the module service worker: the hosted runtime posts
 * `REGISTER_MODULE` messages to it, and the loader reads the code back.
 *
 * @returns {{ postMessage: (msg: object) => void, get: (url: string) => string | undefined }}
 */
export function createModuleStore() {
  const code = new Map();
  return {
    postMessage(msg) {
      if (!msg) return;
      if (msg.type === 'REGISTER_MODULE') code.set(msg.url, msg.code);
      else if (msg.type === 'INVALIDATE') code.delete(msg.url);
      else if (msg.type === 'INVALIDATE_PREFIX') {
        for (const url of code.keys()) if (url.startsWith(msg.prefix)) code.delete(url);
      }
    },
    get: (url) => code.get(url),
  };
}

/** Default executor: an inline classic <script> (the one thing strict CSP allows). */
function injectScript(source) {
  const el = document.createElement('script');
  el.textContent = source;
  document.head.appendChild(el);
  el.remove();
}

/** Posix join of a file's folder and a relative specifier. */
function resolveRelative(fromPath, spec) {
  const parts = fromPath.split('/');
  parts.pop();
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Create the `importModule(url)` the hosted runtime calls.
 *
 * @param {object} opts
 * @param {{ get: (url: string) => string | undefined }} opts.store  From createModuleStore().
 * @param {{ readFile: Function }} opts.fs  The project filesystem (images, CSS).
 * @param {() => string} opts.projectRoot  The scanned `.lerret` root path.
 * @param {() => Promise<object>} [opts.loadMermaid]  Lazily loads the `mermaid` module.
 * @param {(source: string) => void} [opts.execute]  Injected by tests.
 * @returns {(url: string) => Promise<object>}
 */
export function createInlineImporter({ store, fs, projectRoot, loadMermaid, execute = injectScript }) {
  const prepared = new Map(); // url → { factory deps } (async work done)
  const instances = new Map(); // url → module.exports
  const extras = new Map(); // spec key → value (images, css, mermaid)
  const g = globalThis;
  g.__lerretFactories ??= new Map();
  g.__lerretDefine ??= (id, fn) => g.__lerretFactories.set(id, fn);

  /** The project path a stored module URL stands for. */
  const pathOf = (url) => {
    const rel = decodeURIComponent(url.slice(HOSTED_ASSET_URL_PREFIX.length).split('?')[0]);
    const root = projectRoot();
    return root ? `${root}/${rel}` : rel;
  };

  /** Turn one stored module into a factory, and load what it requires. */
  async function prepare(url, seen) {
    if (prepared.has(url) || seen.has(url)) return;
    seen.add(url);
    const esm = store.get(url);
    if (typeof esm !== 'string') throw new Error(`Module not found: ${url}`);
    const { code } = transform(esm, { transforms: ['imports'], filePath: url });
    const deps = [...new Set([...code.matchAll(REQUIRE_RE)].map((m) => m[2]))];
    const from = pathOf(url);
    for (const spec of deps) {
      if (BUILTINS[spec] || extras.has(spec) || extras.has(`${from}::${spec}`)) continue;
      if (spec === 'mermaid') {
        if (!loadMermaid) throw new Error('"mermaid" is not available here.');
        extras.set('mermaid', asCjs(await loadMermaid()));
      } else if (spec.startsWith(HOSTED_ASSET_URL_PREFIX)) {
        await prepare(spec, seen);
      } else if (spec.startsWith('.')) {
        const path = resolveRelative(from, spec.split('?')[0]);
        const mime = imageMime(path);
        if (mime) {
          const bytes = await fs.readFile(path, { encoding: 'binary' });
          extras.set(`${from}::${spec}`, { default: bytesToDataUrl(bytes, mime), __esModule: true });
        } else if (/\.css$/i.test(path)) {
          const css = await fs.readFile(path);
          extras.set(`${from}::${spec}`, { css: String(css) });
        }
        // anything else: require() throws a clear "not found" when called
      }
    }
    // Compile now so syntax errors surface as load errors with a message.
    let syntaxError = null;
    const onError = (e) => { syntaxError = e.error || new Error(e.message); e.preventDefault?.(); };
    g.addEventListener?.('error', onError);
    try {
      execute(`__lerretDefine(${JSON.stringify(url)}, function (require, module, exports) {\n${code}\n});\n//# sourceURL=lerret://${from}`);
    } finally {
      g.removeEventListener?.('error', onError);
    }
    if (!g.__lerretFactories.has(url)) throw syntaxError || new Error(`Could not compile ${from}`);
    prepared.set(url, from);
  }

  /** Synchronous CommonJS evaluation of a prepared module. */
  function evaluate(url) {
    if (instances.has(url)) return instances.get(url);
    const factory = g.__lerretFactories.get(url);
    const from = prepared.get(url);
    const module = { exports: {} };
    instances.set(url, module.exports); // cycles see the partial exports
    const require = (spec) => {
      if (BUILTINS[spec]) return BUILTINS[spec];
      if (spec === 'mermaid') return extras.get('mermaid');
      if (spec.startsWith(HOSTED_ASSET_URL_PREFIX)) return evaluate(spec);
      const extra = extras.get(`${from}::${spec}`);
      if (extra && 'css' in extra) {
        const style = document.createElement('style');
        style.textContent = extra.css;
        document.head.appendChild(style);
        return {};
      }
      if (extra) return extra;
      throw new Error(`Cannot import "${spec}" in the chat app.`);
    };
    try {
      factory(require, module, module.exports);
    } catch (err) {
      instances.delete(url);
      throw err;
    }
    instances.set(url, module.exports);
    return module.exports;
  }

  return async function importModule(url) {
    await prepare(url, new Set());
    return evaluate(url);
  };
}
