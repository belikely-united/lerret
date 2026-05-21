// Tests for the `@lerret/cli dev` Vite plugin — `vite-plugin-lerret-project.js`.
//
// These tests verify the plugin's CONTRACT (the virtual module's shape, the
// asset base URL, the HMR change event payload) without booting a full Vite
// dev server. The end-to-end smoke test covers the live server integration.

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELETE_ENDPOINT,
  DUPLICATE_ENDPOINT,
  HMR_CHANGE_EVENT,
  PROJECT_ASSET_BASE_URL,
  RENAME_ENDPOINT,
  REVEAL_ENDPOINT,
  VIRTUAL_MODULE_ID,
  WRITE_ENDPOINT,
  buildChangeEvent,
  checkWritePath,
  createDeleteMiddleware,
  createDuplicateMiddleware,
  createRenameMiddleware,
  createRevealMiddleware,
  createWriteMiddleware,
  lerretProjectPlugin,
} from './vite-plugin-lerret-project.js';
import { LERRET_DIR_NAME } from './resolve-project.js';

let workDir;

beforeEach(async () => {
  workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-plugin-test-'));
});

afterEach(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

/** Convert an OS path to forward-slash form. */
function asLerretPath(p) {
  return p.replaceAll('\\', '/');
}

/**
 * Make a fake Vite dev server with the surface the plugin touches:
 *   - `hot.send(eventName, payload)` — the HMR custom-event channel.
 *   - `middlewares.use(path, handler)` — the write endpoint hook.
 * Records every send / middleware install so tests can assert what happened.
 */
function makeFakeServer() {
  /** @type {{ event: string, payload: unknown }[]} */
  const sends = [];
  /** @type {{ path: string, handler: Function }[]} */
  const middlewares = [];
  return {
    hot: {
      send(event, payload) {
        sends.push({ event, payload });
      },
    },
    middlewares: {
      use(path, handler) {
        middlewares.push({ path, handler });
      },
    },
    sends,
    middlewares_installed: middlewares,
  };
}

describe('virtual module — resolveId / load', () => {
  it('exposes virtual:lerret-project with the expected exports', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    const resolved = plugin.resolveId(VIRTUAL_MODULE_ID);
    expect(typeof resolved).toBe('string');
    expect(resolved).toMatch(/^\0?virtual:lerret-project$/);

    const code = plugin.load(resolved);
    expect(typeof code).toBe('string');

    // The module should export each contract field, plus a default aggregate.
    // (Initial `project` is null until configureServer scans.)
    expect(code).toContain('export const project = null;');
    expect(code).toContain(`export const assetBaseUrl = "${PROJECT_ASSET_BASE_URL}";`);
    expect(code).toContain(`export const projectRoot = ${JSON.stringify(projectRoot)};`);
    expect(code).toContain(`export const lerretDir = ${JSON.stringify(lerretDir)};`);
    expect(code).toContain(`export const mode = 'cli';`);
    expect(code).toContain('export default');
  });

  it('exposes the no-project shape when invoked without a project', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    const resolved = plugin.resolveId(VIRTUAL_MODULE_ID);
    const code = plugin.load(resolved);

    expect(code).toContain('export const project = null;');
    expect(code).toContain('export const assetBaseUrl = null;');
    expect(code).toContain('export const projectRoot = null;');
    expect(code).toContain('export const lerretDir = null;');
    expect(code).toContain(`export const mode = 'cli';`);
  });

  it('ignores unrelated ids', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    expect(plugin.resolveId('react')).toBeNull();
    expect(plugin.load('react')).toBeNull();
  });
});

describe('config() — server.fs.allow and alias', () => {
  it('adds the project root to fs.allow and aliases the asset base URL to .lerret/', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    const config = plugin.config();
    // fs.allow is the *project* root (we may need to serve files outside
    // `.lerret/` — e.g. a `../assets/logo.png` import from an asset).
    expect(config.server.fs.allow).toContain(projectRoot);
    // The alias rebases the asset base URL onto the scan root (`.lerret/`).
    // The asset-runtime's `assetModuleUrl` strips `project.path`
    // (= scan root) from each asset path, so the relative URL it emits is
    // resolved through this alias to the real file on disk.
    expect(config.resolve.alias[PROJECT_ASSET_BASE_URL]).toBe(lerretDir);
  });

  it('merges into an existing fs.allow rather than overwriting it', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    // Simulate dev.js's inline config: `dev.js` sets fs.allow itself, then
    // each plugin's `config()` hook is invoked with the merged user config.
    // The plugin must extend, not replace, that list.
    const config = plugin.config({
      server: { fs: { allow: ['/dev-js-set-this'] } },
    });
    expect(config.server.fs.allow).toEqual(['/dev-js-set-this', projectRoot]);
  });

  it('returns no extra config in no-project mode', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    expect(plugin.config()).toEqual({});
  });
});

describe('configureServer — initial scan + watcher → HMR forwarding', () => {
  it('scans the project and broadcasts lerret:change on a file edit', async () => {
    // Build a real on-disk fixture: one page, one .jsx asset.
    const lerretAbs = join(workDir, LERRET_DIR_NAME);
    const pageAbs = join(lerretAbs, 'cards');
    await fsp.mkdir(pageAbs, { recursive: true });
    await fsp.writeFile(
      join(pageAbs, 'Hero.jsx'),
      'export default () => null;',
    );

    const projectRoot = asLerretPath(workDir);
    const lerretDir = asLerretPath(lerretAbs);
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    const server = makeFakeServer();

    try {
      await plugin.configureServer(server);

      // The initial scan should have produced the project model; the
      // virtual module's now-loaded source should serialize it.
      const resolved = plugin.resolveId(VIRTUAL_MODULE_ID);
      const code = plugin.load(resolved);
      expect(code).toContain('"name":'); // some scanned project shape
      expect(code).toContain('"path":');

      // Edit the asset → expect a lerret:change broadcast.
      await fsp.writeFile(
        join(pageAbs, 'Hero.jsx'),
        'export default () => null; // edited',
      );

      // Wait for the watcher event with a generous polling window.
      await waitFor(
        () => server.sends.some((s) => s.event === HMR_CHANGE_EVENT),
        { label: 'lerret:change broadcast', timeoutMs: 6000 },
      );

      const change = server.sends.find((s) => s.event === HMR_CHANGE_EVENT);
      expect(change).toBeDefined();
      expect(change.payload).toMatchObject({
        event: { type: 'change' },
        // The payload carries the full new project snapshot — null only
        // when the initial scan failed.
        project: expect.any(Object),
      });
      expect(typeof change.payload.event.path).toBe('string');
      expect(change.payload.event.path).toContain('Hero.jsx');
    } finally {
      // Tear down the watcher chokidar started.
      await plugin.closeBundle();
    }
  });

  it('is a no-op in no-project mode (no scan, no watcher, no send)', async () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    const server = makeFakeServer();
    await plugin.configureServer(server);
    expect(server.sends).toEqual([]);
    // closeBundle is also a no-op here.
    await expect(plugin.closeBundle()).resolves.toBeUndefined();
  });
});

describe('transformIndexHtml — CLI-mode flag injection', () => {
  it('injects the __LERRET_CLI_MODE__ flag in project mode', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    const tags = plugin.transformIndexHtml();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
    const scriptTag = tags.find((t) => t.tag === 'script');
    expect(scriptTag).toBeDefined();
    expect(scriptTag.children).toContain('__LERRET_CLI_MODE__');
    expect(scriptTag.injectTo).toBe('head-prepend');
  });

  it('injects the flag in no-project mode too (studio still mounts CLI source)', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    const tags = plugin.transformIndexHtml();
    const scriptTag = tags.find((t) => t.tag === 'script');
    expect(scriptTag.children).toContain('__LERRET_CLI_MODE__');
  });
});

describe('buildChangeEvent — exported helper passes through to core', () => {
  it('emits the validated WatchEvent shape', () => {
    const e = buildChangeEvent('add', '/some/.lerret/page/Foo.jsx');
    expect(e).toEqual({ type: 'add', path: '/some/.lerret/page/Foo.jsx' });
  });

  it('rejects an unknown type', () => {
    expect(() => buildChangeEvent('bogus', '/x')).toThrow();
  });
});

// Silence vitest's "imported but unused" lint for `vi` in case future test
// additions need it — leaving the import in place avoids re-ordering later.
void vi;

/**
 * Tiny polling helper, same shape as the watcher test's. Used here so a
 * slow CI machine doesn't time out the chokidar `awaitWriteFinish` window.
 */
async function waitFor(predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const intervalMs = opts.intervalMs ?? 40;
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor: condition${opts.label ? ` "${opts.label}"` : ''} not met within ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ─── Write endpoint (path safety + middleware) ────────────────────────────

describe('checkWritePath — path-safety gate', () => {
  it('rejects when no project is loaded', () => {
    expect(checkWritePath('/x/.lerret/y.json', null)).toEqual({
      ok: false,
      error: expect.stringContaining('no project'),
    });
  });

  it('rejects empty / non-string paths', () => {
    expect(checkWritePath('', '/p/.lerret').ok).toBe(false);
    expect(checkWritePath(null, '/p/.lerret').ok).toBe(false);
    expect(checkWritePath(undefined, '/p/.lerret').ok).toBe(false);
  });

  it('rejects paths with NUL bytes', () => {
    const r = checkWritePath('/p/.lerret/foo\0.json', '/p/.lerret');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('NUL');
  });

  it('rejects paths containing a `..` segment', () => {
    const r = checkWritePath('/p/.lerret/../etc/passwd', '/p/.lerret');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('..');
  });

  it('rejects paths outside the .lerret/ tree', () => {
    const r = checkWritePath('/p/other.json', '/p/.lerret');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('outside the project');
  });

  it('rejects a path that equals the .lerret directory itself', () => {
    expect(checkWritePath('/p/.lerret', '/p/.lerret').ok).toBe(false);
  });

  it('accepts a path inside the .lerret/ tree and returns the normalized form', () => {
    const r = checkWritePath('/p/.lerret/ui/Foo.data.json', '/p/.lerret');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('/p/.lerret/ui/Foo.data.json');
  });

  it('normalizes backslashes (Windows-style input) to forward slashes', () => {
    const r = checkWritePath('/p/.lerret\\foo\\Bar.data.json', '/p/.lerret');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('/p/.lerret/foo/Bar.data.json');
  });
});

describe('createWriteMiddleware — server-side write endpoint', () => {
  let lerretAbs;

  beforeEach(async () => {
    lerretAbs = join(workDir, LERRET_DIR_NAME);
    await fsp.mkdir(lerretAbs, { recursive: true });
  });

  /**
   * Fake `req`/`res` pair driving the middleware directly. Calls the
   * supplied handler with the JSON body and returns the captured response.
   *
   * The body is fed through `req`'s EventEmitter on the next tick — the
   * middleware registers its `data` / `end` listeners synchronously inside
   * `readRequestBody(req)`, so we must emit AFTER those listeners are wired.
   */
  async function callMiddleware(middleware, { method = 'POST', body = '' } = {}) {
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter();
    req.method = method;
    req.destroy = () => {};

    /** @type {{ status?: number, body?: any, headers: Record<string, string>, done?: boolean }} */
    const captured = { headers: {} };
    const res = {
      get statusCode() { return captured.status; },
      set statusCode(v) { captured.status = v; },
      setHeader(name, value) { captured.headers[name] = value; },
      end(payload) {
        captured.body = payload;
        captured.done = true;
      },
    };

    const next = () => {};
    middleware(req, res, next);

    // Yield once so the middleware's promise chain wires its `data` / `end`
    // listeners before we emit.
    await new Promise((r) => setImmediate(r));
    if (body) req.emit('data', Buffer.from(body, 'utf-8'));
    req.emit('end');

    // Wait for the response — the middleware does real disk I/O via the
    // Node backend's safe-write (temp+fsync+rename) so we may need to give
    // the event loop plenty of room.
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    return {
      status: captured.status,
      body: captured.body ? JSON.parse(captured.body) : null,
      headers: captured.headers,
    };
  }

  it('writes a safe path and returns ok:true', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });

    const target = `${lerretDir}/Foo.data.json`;
    const payload = '{ "headline": "Hello" }\n';

    const result = await callMiddleware(middleware, {
      body: JSON.stringify({ path: target, content: payload }),
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });

    // Verify the file is actually on disk with the same content.
    const written = await fsp.readFile(join(lerretAbs, 'Foo.data.json'), 'utf-8');
    expect(written).toBe(payload);
  });

  it('rejects POST with an outside-tree path with a calm JSON 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });

    const result = await callMiddleware(middleware, {
      body: JSON.stringify({ path: '/etc/passwd', content: 'hax' }),
    });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toContain('outside the project');
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('rejects traversal segments (..) before reaching the filesystem', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });

    const result = await callMiddleware(middleware, {
      body: JSON.stringify({
        path: `${lerretDir}/../escape.json`,
        content: '{}',
      }),
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('..');
  });

  it('rejects non-POST methods with 405', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });
    const result = await callMiddleware(middleware, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.body.ok).toBe(false);
  });

  it('rejects an invalid JSON body with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });
    const result = await callMiddleware(middleware, { body: 'not json' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('invalid JSON');
  });

  it('rejects when content is missing or non-string', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const middleware = createWriteMiddleware({ lerretDir });
    const result = await callMiddleware(middleware, {
      body: JSON.stringify({ path: `${lerretDir}/x.json`, content: 42 }),
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('content');
  });

  it('exposes WRITE_ENDPOINT as the stable URL the studio targets', () => {
    expect(WRITE_ENDPOINT).toBe('/__lerret/write');
  });
});

// ─── Lifecycle endpoint tests ─────────────────────────────────────────────────

describe('createRenameMiddleware', () => {
  let lerretAbs;
  beforeEach(async () => {
    lerretAbs = join(workDir, LERRET_DIR_NAME);
    await fsp.mkdir(lerretAbs, { recursive: true });
  });

  async function call(middleware, body, method = 'POST') {
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter();
    req.method = method;
    req.destroy = () => {};
    const captured = { headers: {} };
    const res = {
      get statusCode() { return captured.status; },
      set statusCode(v) { captured.status = v; },
      setHeader(name, value) { captured.headers[name] = value; },
      end(payload) { captured.body = payload; captured.done = true; },
    };
    middleware(req, res, () => {});
    await new Promise((r) => setImmediate(r));
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8'));
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('renames a file when both paths are inside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), '/* foo */');
    const result = await call(mw, { from: `${lerretDir}/Foo.jsx`, to: `${lerretDir}/Bar.jsx` });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(await fsp.readFile(join(lerretAbs, 'Bar.jsx'), 'utf-8')).toBe('/* foo */');
  });

  it('rejects rename when `from` is outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    const result = await call(mw, { from: '/etc/passwd', to: `${lerretDir}/x.jsx` });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });

  it('rejects rename when `to` is outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), '/* foo */');
    const result = await call(mw, { from: `${lerretDir}/Foo.jsx`, to: '/tmp/escape.jsx' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });

  it('rejects rename when destination already exists', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), '');
    await fsp.writeFile(join(lerretAbs, 'Bar.jsx'), '');
    const result = await call(mw, { from: `${lerretDir}/Foo.jsx`, to: `${lerretDir}/Bar.jsx` });
    expect(result.status).toBe(500);
    expect(result.body.error).toContain('destination already exists');
  });

  it('rejects rename when `..` is used in the path', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    const result = await call(mw, { from: `${lerretDir}/../escape.jsx`, to: `${lerretDir}/x.jsx` });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('..');
  });

  it('rejects non-POST methods', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRenameMiddleware({ lerretDir });
    const result = await call(mw, undefined, 'GET');
    expect(result.status).toBe(405);
  });
});

describe('createDuplicateMiddleware', () => {
  let lerretAbs;
  beforeEach(async () => {
    lerretAbs = join(workDir, LERRET_DIR_NAME);
    await fsp.mkdir(lerretAbs, { recursive: true });
  });

  async function call(middleware, body) {
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter();
    req.method = 'POST';
    req.destroy = () => {};
    const captured = { headers: {} };
    const res = {
      get statusCode() { return captured.status; },
      set statusCode(v) { captured.status = v; },
      setHeader(name, value) { captured.headers[name] = value; },
      end(payload) { captured.body = payload; captured.done = true; },
    };
    middleware(req, res, () => {});
    await new Promise((r) => setImmediate(r));
    req.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('duplicates a file and returns the new path with a (copy) suffix', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDuplicateMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), '/* hello */');
    const result = await call(mw, { path: `${lerretDir}/Foo.jsx` });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.path).toBe(`${lerretDir}/Foo (copy).jsx`);
    expect(await fsp.readFile(join(lerretAbs, 'Foo (copy).jsx'), 'utf-8')).toBe('/* hello */');
  });

  it('increments the copy suffix when the previous name is taken', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDuplicateMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), 'A');
    await fsp.writeFile(join(lerretAbs, 'Foo (copy).jsx'), 'B');
    const result = await call(mw, { path: `${lerretDir}/Foo.jsx` });
    expect(result.body.path).toBe(`${lerretDir}/Foo (copy 2).jsx`);
  });

  it('duplicates a folder recursively', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDuplicateMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'buttons'), { recursive: true });
    await fsp.writeFile(join(lerretAbs, 'buttons', 'Primary.jsx'), '/* prim */');
    const result = await call(mw, { path: `${lerretDir}/buttons` });
    expect(result.body.ok).toBe(true);
    expect(result.body.path).toBe(`${lerretDir}/buttons (copy)`);
    expect(await fsp.readFile(join(lerretAbs, 'buttons (copy)', 'Primary.jsx'), 'utf-8')).toBe('/* prim */');
  });

  it('rejects when the path is outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDuplicateMiddleware({ lerretDir });
    const result = await call(mw, { path: '/etc/passwd' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });
});

describe('createDeleteMiddleware', () => {
  let lerretAbs;
  beforeEach(async () => {
    lerretAbs = join(workDir, LERRET_DIR_NAME);
    await fsp.mkdir(lerretAbs, { recursive: true });
  });

  async function call(middleware, body) {
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter();
    req.method = 'POST';
    req.destroy = () => {};
    const captured = { headers: {} };
    const res = {
      get statusCode() { return captured.status; },
      set statusCode(v) { captured.status = v; },
      setHeader(name, value) { captured.headers[name] = value; },
      end(payload) { captured.body = payload; captured.done = true; },
    };
    middleware(req, res, () => {});
    await new Promise((r) => setImmediate(r));
    req.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('deletes a file', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDeleteMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'Foo.jsx'), '');
    const result = await call(mw, { path: `${lerretDir}/Foo.jsx` });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    await expect(fsp.access(join(lerretAbs, 'Foo.jsx'))).rejects.toThrow();
  });

  it('recursively deletes a folder', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDeleteMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'buttons'), { recursive: true });
    await fsp.writeFile(join(lerretAbs, 'buttons', 'Primary.jsx'), '');
    const result = await call(mw, { path: `${lerretDir}/buttons` });
    expect(result.body.ok).toBe(true);
    await expect(fsp.access(join(lerretAbs, 'buttons'))).rejects.toThrow();
  });

  it('treats a missing target as a successful no-op', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDeleteMiddleware({ lerretDir });
    const result = await call(mw, { path: `${lerretDir}/never-existed.jsx` });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
  });

  it('rejects a path outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDeleteMiddleware({ lerretDir });
    const result = await call(mw, { path: '/etc/passwd' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });

  it('rejects `..` in the path', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createDeleteMiddleware({ lerretDir });
    const result = await call(mw, { path: `${lerretDir}/../escape.jsx` });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('..');
  });
});

describe('createRevealMiddleware', () => {
  let lerretAbs;
  beforeEach(async () => {
    lerretAbs = join(workDir, LERRET_DIR_NAME);
    await fsp.mkdir(lerretAbs, { recursive: true });
  });

  async function call(middleware, body) {
    const { EventEmitter } = await import('node:events');
    const req = new EventEmitter();
    req.method = 'POST';
    req.destroy = () => {};
    const captured = { headers: {} };
    const res = {
      get statusCode() { return captured.status; },
      set statusCode(v) { captured.status = v; },
      setHeader(name, value) { captured.headers[name] = value; },
      end(payload) { captured.body = payload; captured.done = true; },
    };
    middleware(req, res, () => {});
    await new Promise((r) => setImmediate(r));
    req.emit('data', Buffer.from(JSON.stringify(body), 'utf-8'));
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('rejects missing path', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRevealMiddleware({ lerretDir });
    const result = await call(mw, { target: 'finder' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('path');
  });

  it('rejects an unknown target', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRevealMiddleware({ lerretDir });
    const result = await call(mw, { path: `${lerretDir}/x.jsx`, target: 'bogus' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('editor');
  });

  it('rejects a path outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createRevealMiddleware({ lerretDir });
    const result = await call(mw, { path: '/etc/passwd', target: 'finder' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });

  it('exposes stable endpoint URLs', () => {
    expect(RENAME_ENDPOINT).toBe('/__lerret/rename');
    expect(DUPLICATE_ENDPOINT).toBe('/__lerret/duplicate');
    expect(DELETE_ENDPOINT).toBe('/__lerret/delete');
    expect(REVEAL_ENDPOINT).toBe('/__lerret/reveal');
  });
});
