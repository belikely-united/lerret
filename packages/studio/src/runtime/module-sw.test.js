// module-sw.test.js — test the service worker by loading its source into a
// faked SW global scope and dispatching synthetic events. The SW file
// (`module-sw.js`) is normally loaded by the browser via
// `navigator.serviceWorker.register()`; for testing it's a plain ESM that
// references `self`, `clients`, and a few SW globals. We provide a sandbox
// that satisfies those references, evaluate the file, then exercise the
// `install` / `activate` / `message` / `fetch` handlers.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Path to the SW source — read as text so we can evaluate it inside our
// faked SW global. We don't `import()` it because importing would attempt
// to evaluate it against the test's `globalThis` (which lacks `clients`,
// `skipWaiting`, etc.).
//
// Resolve via `import.meta.url` when available; fall back to a fixed
// path under cwd for environments where `import.meta.url` is not a real
// file URL (vitest's jsdom env can synthesize a non-`file://` URL).
function resolveSwSourcePath() {
 try {
 return fileURLToPath(new URL('./module-sw.js', import.meta.url));
 } catch {
 // Vitest may synthesize a non-file:// import.meta.url. Try to derive the
 // path from the URL string before falling back to a cwd-relative guess
 // (which differs between per-package and workspace test runs).
 const here = import.meta.url;
 if (typeof here === 'string' && here.startsWith('file://')) {
 return resolve(fileURLToPath(here), '../module-sw.js');
 }
 const cwd = process.cwd();
 if (cwd.endsWith('/packages/studio')) {
 return resolve(cwd, 'src/runtime/module-sw.js');
 }
 return resolve(cwd, 'packages/studio/src/runtime/module-sw.js');
 }
}
const SW_SOURCE_PATH = resolveSwSourcePath();

/**
 * Create a faked service-worker global scope plus the handlers the SW
 * registers. Evaluating the SW source against this scope makes the SW's
 * `self.addEventListener('install', ...)` / etc. register handlers we
 * can dispatch to.
 */
function loadSwIntoSandbox() {
 /** @type {{ install: Function[], activate: Function[], message: Function[], fetch: Function[] }} */
 const handlers = { install: [], activate: [], message: [], fetch: [] };

 const fakeSelf = {
 addEventListener(type, handler) {
 if (handlers[type]) handlers[type].push(handler);
 },
 skipWaiting: async () => {},
 };

 const fakeClients = {
 claim: async () => {},
 };

 const src = readFileSync(SW_SOURCE_PATH, 'utf-8');
 // Evaluate the SW source as a Function bound to our fake globals. The
 // SW uses `self` (not `globalThis`), so we pass `self` and `clients` as
 // arguments. `import` is replaced with a noop reference — the SW source
 // has no static imports.
 const factory = new Function('self', 'clients', 'Response', 'Date', 'URL', src);
 factory(fakeSelf, fakeClients, Response, Date, URL);

 return { handlers, fakeSelf, fakeClients };
}

/** Dispatch a synthetic install / activate event with a `waitUntil` recorder. */
function dispatchLifecycle(handler) {
 const waited = [];
 handler({
 waitUntil(p) {
 waited.push(p);
 },
 });
 return waited;
}

/** Dispatch a message event. */
function dispatchMessage(handler, data, source = null) {
 handler({ data, source });
}

/** Dispatch a fetch event with a synthetic Request, capturing respondWith. */
function dispatchFetch(handler, url) {
 let response = null;
 handler({
 request: { url },
 respondWith(r) { response = r; },
 });
 return response;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('module-sw lifecycle', () => {
 let sw;
 beforeEach(() => {
 sw = loadSwIntoSandbox();
 });

 it('registers install / activate / message / fetch listeners', () => {
 expect(sw.handlers.install.length).toBe(1);
 expect(sw.handlers.activate.length).toBe(1);
 expect(sw.handlers.message.length).toBe(1);
 expect(sw.handlers.fetch.length).toBe(1);
 });

 it('install calls skipWaiting (via waitUntil)', async () => {
 const waited = dispatchLifecycle(sw.handlers.install[0]);
 expect(waited.length).toBe(1);
 await expect(waited[0]).resolves.toBeUndefined();
 });

 it('activate calls clients.claim() (via waitUntil)', async () => {
 const waited = dispatchLifecycle(sw.handlers.activate[0]);
 expect(waited.length).toBe(1);
 await expect(waited[0]).resolves.toBeUndefined();
 });
});

// ---------------------------------------------------------------------------
// Pre-register protocol — message handler
// ---------------------------------------------------------------------------

describe('module-sw pre-register protocol', () => {
 let sw;
 beforeEach(() => {
 sw = loadSwIntoSandbox();
 });

 it('REGISTER_MODULE stores source for later fetch interception', async () => {
 const url = '/__lerret/asset/ui/Card.jsx?h=abc';
 const code = 'export default 42;';
 dispatchMessage(sw.handlers.message[0], { type: 'REGISTER_MODULE', url, code });

 const response = dispatchFetch(sw.handlers.fetch[0], `https://example.com${url}`);
 expect(response).toBeInstanceOf(Promise);
 const resolved = await response;
 expect(resolved.status).toBe(200);
 expect(resolved.headers.get('Content-Type')).toBe('text/javascript');
 expect(await resolved.text()).toBe(code);
 });

 it('REGISTER_MODULE accepts a custom contentType', async () => {
 const url = '/__lerret/asset/style.css?h=abc';
 const code = '.x{color:red}';
 dispatchMessage(sw.handlers.message[0], {
 type: 'REGISTER_MODULE', url, code, contentType: 'text/css',
 });

 const resolved = await dispatchFetch(sw.handlers.fetch[0], `https://example.com${url}`);
 expect(resolved.headers.get('Content-Type')).toBe('text/css');
 });

 it('REGISTER_BINARY serves image bytes with its MIME, tolerant of the <img> ../ depth', async () => {
 dispatchMessage(sw.handlers.message[0], {
 type: 'REGISTER_BINARY',
 key: '_assets/logo.png',
 bytes: new Uint8Array([137, 80, 78, 71]),
 contentType: 'image/png',
 });
 // Canonical path under /__lerret/asset/ …
 const a = await dispatchFetch(sw.handlers.fetch[0], 'https://x.com/__lerret/asset/_assets/logo.png');
 expect(a.status).toBe(200);
 expect(a.headers.get('Content-Type')).toBe('image/png');
 expect(Array.from(new Uint8Array(await a.arrayBuffer()))).toEqual([137, 80, 78, 71]);
 // … and the URL an `<img src="../../_assets/logo.png">` escapes to resolves to
 // the SAME registered image (path-tolerant tail lookup).
 const b = await dispatchFetch(sw.handlers.fetch[0], 'https://x.com/__lerret/_assets/logo.png');
 expect(b.status).toBe(200);
 expect(Array.from(new Uint8Array(await b.arrayBuffer()))).toEqual([137, 80, 78, 71]);
 });

 it('a fetch for an unregistered URL serves a 404 stub that throws on evaluation', async () => {
 const url = '/__lerret/asset/missing.jsx?h=xyz';
 const resolved = await dispatchFetch(sw.handlers.fetch[0], `https://example.com${url}`);
 expect(resolved.status).toBe(404);
 expect(resolved.headers.get('Content-Type')).toBe('text/javascript');
 const body = await resolved.text();
 expect(body).toMatch(/throw new Error/);
 expect(body).toMatch(/no module registered/);
 });

 it('INVALIDATE drops a single URL', async () => {
 const url = '/__lerret/asset/ui/Card.jsx?h=abc';
 dispatchMessage(sw.handlers.message[0], { type: 'REGISTER_MODULE', url, code: 'export default 1;' });
 dispatchMessage(sw.handlers.message[0], { type: 'INVALIDATE', url });
 const resolved = await dispatchFetch(sw.handlers.fetch[0], `https://example.com${url}`);
 expect(resolved.status).toBe(404);
 });

 it('INVALIDATE_PREFIX drops every URL under the prefix', async () => {
 dispatchMessage(sw.handlers.message[0], {
 type: 'REGISTER_MODULE', url: '/__lerret/asset/a.jsx?h=1', code: 'export default 1;',
 });
 dispatchMessage(sw.handlers.message[0], {
 type: 'REGISTER_MODULE', url: '/__lerret/asset/b.jsx?h=2', code: 'export default 2;',
 });
 dispatchMessage(sw.handlers.message[0], { type: 'INVALIDATE_PREFIX', prefix: '/__lerret/asset/' });

 const r1 = await dispatchFetch(sw.handlers.fetch[0], 'https://example.com/__lerret/asset/a.jsx?h=1');
 const r2 = await dispatchFetch(sw.handlers.fetch[0], 'https://example.com/__lerret/asset/b.jsx?h=2');
 expect(r1.status).toBe(404);
 expect(r2.status).toBe(404);
 });

 it('PING replies PONG to the event source', () => {
 const messages = [];
 const source = { postMessage(m) { messages.push(m); } };
 dispatchMessage(sw.handlers.message[0], { type: 'PING', id: 7 }, source);
 expect(messages).toEqual([{ type: 'PONG', id: 7 }]);
 });

 it('ignores malformed messages without throwing', () => {
 expect(() => dispatchMessage(sw.handlers.message[0], null)).not.toThrow();
 expect(() => dispatchMessage(sw.handlers.message[0], { type: 'NOPE' })).not.toThrow();
 expect(() => dispatchMessage(sw.handlers.message[0], { type: 'REGISTER_MODULE' })).not.toThrow();
 });

 it('fetch handler ignores URLs outside the asset prefix', () => {
 // No respondWith called — the runtime returns undefined.
 const response = dispatchFetch(sw.handlers.fetch[0], 'https://example.com/some/other/url.js');
 expect(response).toBeNull();
 });

 it('replacing a URL\'s registration serves the new code', async () => {
 const url = '/__lerret/asset/ui/Card.jsx?h=abc';
 dispatchMessage(sw.handlers.message[0], { type: 'REGISTER_MODULE', url, code: 'export default 1;' });
 dispatchMessage(sw.handlers.message[0], { type: 'REGISTER_MODULE', url, code: 'export default 2;' });
 const resolved = await dispatchFetch(sw.handlers.fetch[0], `https://example.com${url}`);
 expect(await resolved.text()).toBe('export default 2;');
 });
});
