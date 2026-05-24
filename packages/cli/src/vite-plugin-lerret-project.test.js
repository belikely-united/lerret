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
  CREATE_ENDPOINT,
  DELETE_ENDPOINT,
  DUPLICATE_ENDPOINT,
  HMR_CHANGE_EVENT,
  MOVE_ENDPOINT,
  PROJECT_ASSET_BASE_URL,
  RENAME_ENDPOINT,
  REVEAL_ENDPOINT,
  VIRTUAL_MODULE_ID,
  WRITE_ENDPOINT,
  buildChangeEvent,
  checkWritePath,
  classifySwitchFolder,
  createCreateMiddleware,
  createDeleteMiddleware,
  createDuplicateMiddleware,
  createMoveMiddleware,
  createProjectAssetMiddleware,
  createReadConfigMiddleware,
  createRecentProjectsMiddleware,
  createRenameMiddleware,
  createRevealMiddleware,
  createSwitchFolderMiddleware,
  createWriteMiddleware,
  lerretProjectPlugin,
  readRecentProjects,
  recordRecentProject,
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

/**
 * Drive a Connect-style middleware with a fake req/res, returning the captured
 * `{ status, body }`. Module-level twin of the write-describe's `callMiddleware`
 * so the switch/recents suites can share it. Emits the body AFTER the
 * middleware wires its listeners (matching `readRequestBody`'s timing).
 */
async function callJsonMiddleware(middleware, { method = 'POST', body = '' } = {}) {
  const { EventEmitter } = await import('node:events');
  const req = new EventEmitter();
  req.method = method;
  req.destroy = () => {};

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

  middleware(req, res, () => {});
  await new Promise((r) => setImmediate(r));
  if (body) req.emit('data', Buffer.from(body, 'utf-8'));
  req.emit('end');

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

describe('config() — dynamic asset resolution + fs', () => {
  it('relaxes server.fs.strict (switch targets are unknown at boot) and sets no static alias', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    const config = plugin.config();
    // The static `/@lerret-project` alias is GONE — resolution is now dynamic
    // (see the resolveId block below) so it can follow runtime folder switches.
    // A static alias could only ever point at the boot-time folder.
    expect(config.resolve).toBeUndefined();
    // fs.strict is disabled: the studio can be pointed at any folder at runtime,
    // and this is a local tool serving the user's own files.
    expect(config.server.fs.strict).toBe(false);
  });

  it('relaxes fs even in no-project mode so a folder can be connected later', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    expect(plugin.config().server.fs.strict).toBe(false);
  });
});

describe('resolveId — dynamic /@lerret-project rebasing', () => {
  it('rebases the asset base URL onto the connected .lerret/, preserving sub-path + query', () => {
    const projectRoot = asLerretPath(workDir);
    const lerretDir = `${projectRoot}/${LERRET_DIR_NAME}`;
    const plugin = lerretProjectPlugin({ projectRoot, lerretDir });

    expect(plugin.resolveId(`${PROJECT_ASSET_BASE_URL}/brand/card.jsx`)).toBe(
      `${lerretDir}/brand/card.jsx`,
    );
    // The query suffix (live-reload `?t=`, switch-epoch `?v=`, markdown `?raw`)
    // must survive so Vite re-transforms / serves-raw correctly.
    expect(plugin.resolveId(`${PROJECT_ASSET_BASE_URL}/notes.md?raw`)).toBe(
      `${lerretDir}/notes.md?raw`,
    );
    expect(plugin.resolveId(`${PROJECT_ASSET_BASE_URL}/a.jsx?v=3`)).toBe(
      `${lerretDir}/a.jsx?v=3`,
    );
  });

  it('does not rebase when no project is connected', () => {
    const plugin = lerretProjectPlugin({ projectRoot: null, lerretDir: null });
    expect(plugin.resolveId(`${PROJECT_ASSET_BASE_URL}/x.jsx`)).toBeNull();
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
    expect(MOVE_ENDPOINT).toBe('/__lerret/move');
  });
});

describe('createMoveMiddleware', () => {
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
    if (body !== undefined) {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8'));
    }
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('moves a file across folders and returns 200 with newPath and rewroteLiveRefresh', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'social'));
    await fsp.mkdir(join(lerretAbs, 'landing'));
    await fsp.writeFile(join(lerretAbs, 'social', 'og-card.jsx'), '/* og */');

    const result = await call(mw, {
      fromPath: `${lerretDir}/social/og-card.jsx`,
      toFolderPath: `${lerretDir}/landing`,
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      newPath: `${lerretDir}/landing/og-card.jsx`,
      rewroteLiveRefresh: 'none',
    });
    expect(await fsp.readFile(join(lerretAbs, 'landing', 'og-card.jsx'), 'utf-8')).toBe('/* og */');
  });

  it('returns 400 on cycle (folder into itself)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'social'));

    const result = await call(mw, {
      fromPath: `${lerretDir}/social`,
      toFolderPath: `${lerretDir}/social`,
    });

    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toMatch(/same folder/);
  });

  it('returns 400 on cycle (folder into its descendant)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'social', 'sub'), { recursive: true });

    const result = await call(mw, {
      fromPath: `${lerretDir}/social`,
      toFolderPath: `${lerretDir}/social/sub`,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/descendant/);
  });

  it('returns 400 when the source path does not exist', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'landing'));

    const result = await call(mw, {
      fromPath: `${lerretDir}/ghost.jsx`,
      toFolderPath: `${lerretDir}/landing`,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/does not exist/);
  });

  it('returns 400 when the destination folder does not exist', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'a.jsx'), 'A');

    const result = await call(mw, {
      fromPath: `${lerretDir}/a.jsx`,
      toFolderPath: `${lerretDir}/ghost-folder`,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/destination folder does not exist/);
  });

  it('returns 409 on destination collision (no auto-suffix on move)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'social'));
    await fsp.mkdir(join(lerretAbs, 'landing'));
    await fsp.writeFile(join(lerretAbs, 'social', 'og-card.jsx'), 'NEW');
    await fsp.writeFile(join(lerretAbs, 'landing', 'og-card.jsx'), 'OLD');

    const result = await call(mw, {
      fromPath: `${lerretDir}/social/og-card.jsx`,
      toFolderPath: `${lerretDir}/landing`,
    });

    expect(result.status).toBe(409);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toContain('og-card.jsx');

    // Neither file was disturbed.
    expect(await fsp.readFile(join(lerretAbs, 'social', 'og-card.jsx'), 'utf-8')).toBe('NEW');
    expect(await fsp.readFile(join(lerretAbs, 'landing', 'og-card.jsx'), 'utf-8')).toBe('OLD');
  });

  it('returns 400 when fromPath is outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, {
      fromPath: '/etc/passwd',
      toFolderPath: `${lerretDir}/landing`,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('outside the project');
  });

  it('returns 400 when toFolderPath is outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.writeFile(join(lerretAbs, 'a.jsx'), 'A');
    const result = await call(mw, {
      fromPath: `${lerretDir}/a.jsx`,
      toFolderPath: '/tmp/escape',
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('inside .lerret/');
  });

  it('allows moving into the .lerret root itself (top-level page placement)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'parent'));
    await fsp.mkdir(join(lerretAbs, 'parent', 'social'), { recursive: true });
    await fsp.writeFile(join(lerretAbs, 'parent', 'social', 'a.jsx'), 'A');

    const result = await call(mw, {
      fromPath: `${lerretDir}/parent/social`,
      toFolderPath: lerretDir,
    });

    expect(result.status).toBe(200);
    expect(result.body.newPath).toBe(`${lerretDir}/social`);
    expect(await fsp.readFile(join(lerretAbs, 'social', 'a.jsx'), 'utf-8')).toBe('A');
  });

  it('returns 400 on `..` traversal in fromPath', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, {
      fromPath: `${lerretDir}/../escape.jsx`,
      toFolderPath: `${lerretDir}/landing`,
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('..');
  });

  it('rejects when fromPath is missing or not a string', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, { toFolderPath: `${lerretDir}/x` });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('fromPath');
  });

  it('rejects when toFolderPath is missing or not a string', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, { fromPath: `${lerretDir}/x.jsx` });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('toFolderPath');
  });

  it('rejects when carryLiveRefresh is non-boolean', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, {
      fromPath: `${lerretDir}/x.jsx`,
      toFolderPath: `${lerretDir}/y`,
      carryLiveRefresh: 'sure',
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('carryLiveRefresh');
  });

  it('rejects non-POST methods with 405', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, undefined, 'GET');
    expect(result.status).toBe(405);
  });

  it('rejects invalid JSON body with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    const result = await call(mw, 'not json');
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('invalid JSON');
  });

  it('strips liveRefresh on a happy-path move and returns the tag in the response', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'live'));
    await fsp.mkdir(join(lerretAbs, 'static'));
    await fsp.writeFile(join(lerretAbs, 'live', 'clock.jsx'), 'C');
    await fsp.writeFile(
      join(lerretAbs, 'live', 'config.json'),
      JSON.stringify({ liveRefresh: { clock: 1000 } }) + '\n',
    );

    const result = await call(mw, {
      fromPath: `${lerretDir}/live/clock.jsx`,
      toFolderPath: `${lerretDir}/static`,
    });

    expect(result.status).toBe(200);
    expect(result.body.rewroteLiveRefresh).toBe('stripped');
    const srcConfig = JSON.parse(
      await fsp.readFile(join(lerretAbs, 'live', 'config.json'), 'utf-8'),
    );
    expect(srcConfig.liveRefresh).toBeUndefined();
  });

  it('carries liveRefresh over when carryLiveRefresh=true', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'live'));
    await fsp.mkdir(join(lerretAbs, 'static'));
    await fsp.writeFile(join(lerretAbs, 'live', 'clock.jsx'), 'C');
    await fsp.writeFile(
      join(lerretAbs, 'live', 'config.json'),
      JSON.stringify({ liveRefresh: { clock: 1000 } }) + '\n',
    );

    const result = await call(mw, {
      fromPath: `${lerretDir}/live/clock.jsx`,
      toFolderPath: `${lerretDir}/static`,
      carryLiveRefresh: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.rewroteLiveRefresh).toBe('carried-over');
    const destConfig = JSON.parse(
      await fsp.readFile(join(lerretAbs, 'static', 'config.json'), 'utf-8'),
    );
    expect(destConfig.liveRefresh).toEqual({ clock: 1000 });
  });

  it('returns 400 when carryLiveRefresh=true and dest config is malformed', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createMoveMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'live'));
    await fsp.mkdir(join(lerretAbs, 'static'));
    await fsp.writeFile(join(lerretAbs, 'live', 'clock.jsx'), 'C');
    await fsp.writeFile(
      join(lerretAbs, 'live', 'config.json'),
      JSON.stringify({ liveRefresh: { clock: 1000 } }) + '\n',
    );
    await fsp.writeFile(join(lerretAbs, 'static', 'config.json'), '{ broken');

    const result = await call(mw, {
      fromPath: `${lerretDir}/live/clock.jsx`,
      toFolderPath: `${lerretDir}/static`,
      carryLiveRefresh: true,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toContain('malformed');
    // The clock asset never moved.
    expect(await fsp.readFile(join(lerretAbs, 'live', 'clock.jsx'), 'utf-8')).toBe('C');
  });
});

describe('createCreateMiddleware', () => {
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
    if (body !== undefined) {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8'));
    }
    req.emit('end');
    const deadline = Date.now() + 5000;
    while (!captured.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    return { status: captured.status, body: captured.body ? JSON.parse(captured.body) : null };
  }

  it('exposes the create endpoint URL', () => {
    expect(CREATE_ENDPOINT).toBe('/__lerret/create');
  });

  it('creates a page directly under the .lerret/ root (200 + path)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, { parentPath: lerretDir, name: 'landing', kind: 'folder' });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, path: `${lerretDir}/landing` });
    expect((await fsp.stat(join(lerretAbs, 'landing'))).isDirectory()).toBe(true);
  });

  it('creates a group inside a page', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'landing'));

    const result = await call(mw, {
      parentPath: `${lerretDir}/landing`,
      name: 'social',
      kind: 'folder',
    });

    expect(result.status).toBe(200);
    expect(result.body.path).toBe(`${lerretDir}/landing/social`);
  });

  it('creates a component asset with starter content', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'landing'));

    const result = await call(mw, {
      parentPath: `${lerretDir}/landing`,
      name: 'hero',
      kind: 'asset',
      assetKind: 'component',
    });

    expect(result.status).toBe(200);
    expect(result.body.path).toBe(`${lerretDir}/landing/hero.jsx`);
    expect(await fsp.readFile(join(lerretAbs, 'landing', 'hero.jsx'), 'utf-8')).toContain(
      'export default function Hero()',
    );
  });

  it('rejects a reserved page name (leading underscore) with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, { parentPath: lerretDir, name: '_secret', kind: 'folder' });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/underscore/);
  });

  it('rejects an illegal-character name with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, { parentPath: lerretDir, name: 'a/b', kind: 'folder' });

    expect(result.status).toBe(400);
  });

  it('returns 409 on a case-insensitive collision', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'landing'));

    const result = await call(mw, { parentPath: lerretDir, name: 'Landing', kind: 'folder' });

    expect(result.status).toBe(409);
    expect(result.body.error).toMatch(/already exists/);
  });

  it('rejects a parent outside .lerret/ with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, {
      parentPath: asLerretPath(workDir),
      name: 'x',
      kind: 'folder',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/parentPath/);
  });

  it('rejects an unknown kind with 400', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, { parentPath: lerretDir, name: 'x', kind: 'bogus' });

    expect(result.status).toBe(400);
  });

  it('rejects non-POST with 405', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createCreateMiddleware({ lerretDir });

    const result = await call(mw, undefined, 'GET');

    expect(result.status).toBe(405);
  });
});

describe('createReadConfigMiddleware', () => {
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

  it('returns the parsed config for an existing config.json', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createReadConfigMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'brand'), { recursive: true });
    await fsp.writeFile(
      join(lerretAbs, 'brand', 'config.json'),
      JSON.stringify({ presentation: { background: '#000' } }),
    );
    const result = await call(mw, { path: `${lerretDir}/brand/config.json` });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, value: { presentation: { background: '#000' } } });
  });

  it('reports missing for a folder with no config.json (the real bug)', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createReadConfigMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'empty'), { recursive: true });
    const result = await call(mw, { path: `${lerretDir}/empty/config.json` });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, missing: true, value: {} });
  });

  it('reports an error for malformed config.json', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createReadConfigMiddleware({ lerretDir });
    await fsp.mkdir(join(lerretAbs, 'bad'), { recursive: true });
    await fsp.writeFile(join(lerretAbs, 'bad', 'config.json'), '{ not json');
    const result = await call(mw, { path: `${lerretDir}/bad/config.json` });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.error).toMatch(/valid JSON/i);
  });

  it('rejects a path outside .lerret/', async () => {
    const lerretDir = asLerretPath(lerretAbs);
    const mw = createReadConfigMiddleware({ lerretDir });
    const result = await call(mw, { path: '/etc/passwd' });
    expect(result.status).toBe(400);
  });
});

// ── Runtime folder switching ──────────────────────────────────────────────────

describe('classifySwitchFolder — switch-intent parsing', () => {
  it('treats null / undefined / empty string as "close"', () => {
    expect(classifySwitchFolder(null).kind).toBe('close');
    expect(classifySwitchFolder(undefined).kind).toBe('close');
    expect(classifySwitchFolder('').kind).toBe('close');
  });

  it('treats a string path as "connect"', () => {
    expect(classifySwitchFolder('/some/folder')).toEqual({ kind: 'connect', folder: '/some/folder' });
  });

  it('treats a non-string, non-null value as "error"', () => {
    expect(classifySwitchFolder(42).kind).toBe('error');
    expect(classifySwitchFolder({}).kind).toBe('error');
  });
});

describe('recent-projects — persistence + endpoint', () => {
  let configDir;
  let prevEnv;

  beforeEach(async () => {
    configDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-cfg-'));
    prevEnv = process.env.LERRET_CONFIG_DIR;
    // Redirect the recents file to a tmp dir so tests never touch the real home.
    process.env.LERRET_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.LERRET_CONFIG_DIR;
    else process.env.LERRET_CONFIG_DIR = prevEnv;
    await fsp.rm(configDir, { recursive: true, force: true });
  });

  it('returns [] when no recents file exists yet', async () => {
    expect(await readRecentProjects()).toEqual([]);
  });

  it('records projects most-recent-first, de-duplicated', async () => {
    await recordRecentProject('/p/alpha');
    await recordRecentProject('/p/beta');
    await recordRecentProject('/p/alpha'); // re-record → moves to front, no dupe
    const list = await readRecentProjects();
    expect(list.map((e) => e.path)).toEqual(['/p/alpha', '/p/beta']);
    expect(list[0]).toEqual({ path: '/p/alpha', name: 'alpha' });
  });

  it('GET endpoint returns the list; a non-GET method → 405', async () => {
    await recordRecentProject('/p/gamma');
    const mw = createRecentProjectsMiddleware();

    const ok = await callJsonMiddleware(mw, { method: 'GET' });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.recent.map((e) => e.path)).toContain('/p/gamma');

    const bad = await callJsonMiddleware(mw, { method: 'POST', body: '{}' });
    expect(bad.status).toBe(405);
  });
});

describe('createSwitchFolderMiddleware — runtime folder switch', () => {
  let configDir;
  let prevEnv;
  let projectDir;

  beforeEach(async () => {
    configDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-cfg-'));
    prevEnv = process.env.LERRET_CONFIG_DIR;
    process.env.LERRET_CONFIG_DIR = configDir;
    projectDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-proj-'));
    await fsp.mkdir(join(projectDir, LERRET_DIR_NAME), { recursive: true });
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.LERRET_CONFIG_DIR;
    else process.env.LERRET_CONFIG_DIR = prevEnv;
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(projectDir, { recursive: true, force: true });
  });

  function makeDeps(state) {
    const calls = { rescan: 0, restartWatcher: 0, broadcasts: [] };
    const deps = {
      state,
      rescan: async () => { calls.rescan += 1; },
      restartWatcher: async () => { calls.restartWatcher += 1; },
      broadcast: (ev) => calls.broadcasts.push(ev),
    };
    return { deps, calls };
  }

  it('connects a real project: re-points state, rescans, restarts watcher, broadcasts, bumps epoch, records recent', async () => {
    const state = { projectRoot: null, lerretDir: null, epoch: 0 };
    const { deps, calls } = makeDeps(state);
    const mw = createSwitchFolderMiddleware(deps);

    const res = await callJsonMiddleware(mw, { body: JSON.stringify({ folder: projectDir }) });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.lerretDir).toBe(`${asLerretPath(projectDir)}/${LERRET_DIR_NAME}`);
    expect(state.lerretDir).toBe(`${asLerretPath(projectDir)}/${LERRET_DIR_NAME}`);
    expect(state.epoch).toBe(1);
    expect(calls.rescan).toBe(1);
    expect(calls.restartWatcher).toBe(1);
    expect(calls.broadcasts).toHaveLength(1);
    expect(calls.broadcasts[0].type).toBe('switch');
    expect((await readRecentProjects()).map((e) => e.path)).toContain(asLerretPath(projectDir));
  });

  it('rejects a folder with no .lerret/ (400) and leaves state untouched', async () => {
    const noLerret = await fsp.mkdtemp(join(tmpdir(), 'lerret-none-'));
    const state = { projectRoot: null, lerretDir: null, epoch: 0 };
    const { deps, calls } = makeDeps(state);
    const mw = createSwitchFolderMiddleware(deps);

    const res = await callJsonMiddleware(mw, { body: JSON.stringify({ folder: noLerret }) });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('no .lerret/');
    expect(state.lerretDir).toBeNull();
    expect(calls.rescan).toBe(0);
    expect(calls.restartWatcher).toBe(0);

    await fsp.rm(noLerret, { recursive: true, force: true });
  });

  it('closes the project on folder:null (state cleared, epoch bumped)', async () => {
    const state = { projectRoot: '/old', lerretDir: '/old/.lerret', epoch: 5 };
    const { deps, calls } = makeDeps(state);
    const mw = createSwitchFolderMiddleware(deps);

    const res = await callJsonMiddleware(mw, { body: JSON.stringify({ folder: null }) });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, projectRoot: null, lerretDir: null });
    expect(state.lerretDir).toBeNull();
    expect(state.projectRoot).toBeNull();
    expect(state.epoch).toBe(6);
    expect(calls.rescan).toBe(1);
    expect(calls.restartWatcher).toBe(1);
  });

  it('rejects a non-string, non-null folder with 400', async () => {
    const state = { projectRoot: null, lerretDir: null, epoch: 0 };
    const { deps } = makeDeps(state);
    const mw = createSwitchFolderMiddleware(deps);

    const res = await callJsonMiddleware(mw, { body: JSON.stringify({ folder: 42 }) });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('must be a string');
  });
});

describe('live getLerretDir — lifecycle middlewares follow a runtime switch', () => {
  it('a write middleware built with getLerretDir gates against the CURRENT folder', async () => {
    const a = await fsp.mkdtemp(join(tmpdir(), 'lerret-a-'));
    const b = await fsp.mkdtemp(join(tmpdir(), 'lerret-b-'));
    await fsp.mkdir(join(a, LERRET_DIR_NAME), { recursive: true });
    await fsp.mkdir(join(b, LERRET_DIR_NAME), { recursive: true });

    let current = `${asLerretPath(a)}/${LERRET_DIR_NAME}`;
    const mw = createWriteMiddleware({ getLerretDir: () => current });

    // Write under A → ok.
    const r1 = await callJsonMiddleware(mw, {
      body: JSON.stringify({ path: `${current}/x.json`, content: '1' }),
    });
    expect(r1.status).toBe(200);

    // "Switch" the live getter to B. The SAME middleware instance must now
    // treat an A-path as outside-tree and accept a B-path.
    const aDir = `${asLerretPath(a)}/${LERRET_DIR_NAME}`;
    current = `${asLerretPath(b)}/${LERRET_DIR_NAME}`;

    const r2 = await callJsonMiddleware(mw, {
      body: JSON.stringify({ path: `${aDir}/y.json`, content: '2' }),
    });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toContain('outside the project');

    const r3 = await callJsonMiddleware(mw, {
      body: JSON.stringify({ path: `${current}/z.json`, content: '3' }),
    });
    expect(r3.status).toBe(200);

    await fsp.rm(a, { recursive: true, force: true });
    await fsp.rm(b, { recursive: true, force: true });
  });
});

describe('createProjectAssetMiddleware — dynamic /@lerret-project serving', () => {
  function run(getLerretDir, url) {
    const mw = createProjectAssetMiddleware({ getLerretDir });
    const req = { url };
    let nexted = false;
    mw(req, {}, () => { nexted = true; });
    return { url: req.url, nexted };
  }

  it('rewrites a /@lerret-project asset GET to Vite /@fs of the current folder', () => {
    const out = run(() => '/p/.lerret', `${PROJECT_ASSET_BASE_URL}/_fonts/x.woff2`);
    expect(out.url).toBe('/@fs/p/.lerret/_fonts/x.woff2');
    expect(out.nexted).toBe(true);
  });

  it('preserves the query string (epoch / reload / raw)', () => {
    const out = run(() => '/p/.lerret', `${PROJECT_ASSET_BASE_URL}/brand/card.jsx?v=2&t=9`);
    expect(out.url).toBe('/@fs/p/.lerret/brand/card.jsx?v=2&t=9');
  });

  it('follows a runtime folder switch (reads the getter each request)', () => {
    let dir = '/a/.lerret';
    const mw = createProjectAssetMiddleware({ getLerretDir: () => dir });
    const r1 = { url: `${PROJECT_ASSET_BASE_URL}/f.woff2` };
    mw(r1, {}, () => {});
    expect(r1.url).toBe('/@fs/a/.lerret/f.woff2');
    dir = '/b/.lerret';
    const r2 = { url: `${PROJECT_ASSET_BASE_URL}/f.woff2` };
    mw(r2, {}, () => {});
    expect(r2.url).toBe('/@fs/b/.lerret/f.woff2');
  });

  it('passes through unrelated URLs untouched', () => {
    const out = run(() => '/p/.lerret', '/node_modules/.vite/deps/react.js');
    expect(out.url).toBe('/node_modules/.vite/deps/react.js');
    expect(out.nexted).toBe(true);
  });

  it('passes through (no rewrite) when no project is connected', () => {
    const out = run(() => null, `${PROJECT_ASSET_BASE_URL}/_fonts/x.woff2`);
    expect(out.url).toBe(`${PROJECT_ASSET_BASE_URL}/_fonts/x.woff2`);
    expect(out.nexted).toBe(true);
  });
});
