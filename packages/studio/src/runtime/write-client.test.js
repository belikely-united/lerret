// Tests for the studio→CLI write client.
//
// The client is the single browser-side wrapper around the CLI plugin's
// `POST /__lerret/write` endpoint. These tests verify the contract: the
// request shape, the response handling, and the standalone-mode no-op path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
 CREATE_ENDPOINT,
 DELETE_ENDPOINT,
 DUPLICATE_ENDPOINT,
 MOVE_ENDPOINT,
 RECENT_PROJECTS_ENDPOINT,
 RENAME_ENDPOINT,
 REVEAL_ENDPOINT,
 SWITCH_FOLDER_ENDPOINT,
 WRITE_ENDPOINT,
 createProjectEntry,
 deleteProjectFile,
 duplicateProjectFile,
 fetchRecentProjects,
 inCliMode,
 moveProjectFile,
 renameProjectFile,
 revealProjectFile,
 switchProject,
 writeProjectFile,
} from './write-client.js';

describe('writeProjectFile — contract', () => {
 beforeEach(() => {
 // Default: pretend we're in CLI mode so the helper actually fetches.
 globalThis.__LERRET_CLI_MODE__ = true;
 });

 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts the right JSON body to the WRITE_ENDPOINT', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true,
 status: 200,
 json: async () => ({ ok: true }),
 });

 const result = await writeProjectFile('/abs/.lerret/foo.data.json', '{"a":1}', {
 fetch: fetchMock,
 });

 expect(result).toEqual({ ok: true });
 expect(fetchMock).toHaveBeenCalledOnce();
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(WRITE_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(init.headers['Content-Type']).toBe('application/json');
 expect(JSON.parse(init.body)).toEqual({
 path: '/abs/.lerret/foo.data.json',
 content: '{"a":1}',
 });
 });

 it('returns ok:false with the server-supplied error on a server rejection', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false,
 status: 400,
 json: async () => ({ ok: false, error: 'path is outside the project .lerret/ tree' }),
 });

 const result = await writeProjectFile('/etc/passwd', 'hax', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('outside the project');
 });

 it('returns ok:false with a network-error message on fetch throw', async () => {
 const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
 const result = await writeProjectFile('/x/.lerret/y.json', '{}', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('connection refused');
 });

 it('returns ok:false when the server returns a non-JSON body', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true,
 status: 200,
 json: async () => { throw new SyntaxError('Unexpected token <'); },
 });
 const result = await writeProjectFile('/x/.lerret/y.json', '{}', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('non-JSON');
 });

 it('validates input — empty path is rejected before any fetch', async () => {
 const fetchMock = vi.fn();
 const result = await writeProjectFile('', '{}', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('validates input — non-string content is rejected before any fetch', async () => {
 const fetchMock = vi.fn();
 // @ts-expect-error testing runtime validation
 const result = await writeProjectFile('/x/.lerret/y.json', { obj: true }, { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

describe('writeProjectFile — standalone (no CLI) mode', () => {
 beforeEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 });

 it('returns a calm "writes disabled" error without calling fetch', async () => {
 const fetchMock = vi.fn();
 const result = await writeProjectFile('/x/.lerret/y.json', '{}', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('standalone');
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

// ── — lifecycle helper tests ───────────────────────────────────────

describe('renameProjectFile', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { from, to } to the rename endpoint', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200, json: async () => ({ ok: true }),
 });
 const result = await renameProjectFile('/x/.lerret/A.jsx', '/x/.lerret/B.jsx', { fetch: fetchMock });
 expect(result).toEqual({ ok: true });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(RENAME_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(JSON.parse(init.body)).toEqual({ from: '/x/.lerret/A.jsx', to: '/x/.lerret/B.jsx' });
 });

 it('returns ok:false on a server rejection', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 400,
 json: async () => ({ ok: false, error: 'to: path is outside the project .lerret/ tree' }),
 });
 const result = await renameProjectFile('/x/.lerret/A.jsx', '/etc/passwd', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('outside the project');
 });

 it('validates inputs before fetching', async () => {
 const fetchMock = vi.fn();
 expect((await renameProjectFile('', '/y/.lerret/A.jsx', { fetch: fetchMock })).ok).toBe(false);
 expect((await renameProjectFile('/x/.lerret/A.jsx', '', { fetch: fetchMock })).ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('returns an error in standalone mode without fetching', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const fetchMock = vi.fn();
 const result = await renameProjectFile('/x/.lerret/A.jsx', '/x/.lerret/B.jsx', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('standalone');
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

describe('duplicateProjectFile', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { path } to the duplicate endpoint and returns the new path', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, path: '/x/.lerret/A (copy).jsx' }),
 });
 const result = await duplicateProjectFile('/x/.lerret/A.jsx', { fetch: fetchMock });
 expect(result).toEqual({ ok: true, path: '/x/.lerret/A (copy).jsx' });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(DUPLICATE_ENDPOINT);
 expect(JSON.parse(init.body)).toEqual({ path: '/x/.lerret/A.jsx' });
 });

 it('returns ok:false on a server rejection', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 500,
 json: async () => ({ ok: false, error: 'duplicate failed' }),
 });
 const result = await duplicateProjectFile('/x/.lerret/A.jsx', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('duplicate failed');
 });
});

describe('moveProjectFile', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { fromPath, toFolderPath } to the move endpoint and returns newPath', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, newPath: '/x/.lerret/landing/og-card.jsx' }),
 });
 const result = await moveProjectFile('/x/.lerret/social/og-card.jsx', '/x/.lerret/landing', { fetch: fetchMock });
 expect(result).toEqual({
 ok: true,
 newPath: '/x/.lerret/landing/og-card.jsx',
 });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(MOVE_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(init.headers['Content-Type']).toBe('application/json');
 expect(JSON.parse(init.body)).toEqual({
 fromPath: '/x/.lerret/social/og-card.jsx',
 toFolderPath: '/x/.lerret/landing',
 });
 });

 it('returns ok:false with the server-supplied error on cycle refusal (400)', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 400,
 json: async () => ({ ok: false, error: 'cannot move folder into its own descendant' }),
 });
 const result = await moveProjectFile('/x/.lerret/social', '/x/.lerret/social/sub', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('descendant');
 });

 it('returns ok:false on collision (409)', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 409,
 json: async () => ({ ok: false, error: 'destination already has an asset named og-card.jsx' }),
 });
 const result = await moveProjectFile('/x/.lerret/social/og-card.jsx', '/x/.lerret/landing', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('already has an asset');
 });

 it('validates inputs before fetching', async () => {
 const fetchMock = vi.fn();
 expect((await moveProjectFile('', '/x/.lerret/landing', { fetch: fetchMock })).ok).toBe(false);
 expect((await moveProjectFile('/x/.lerret/A.jsx', '', { fetch: fetchMock })).ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('returns standalone-mode error without calling fetch', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const fetchMock = vi.fn();
 const result = await moveProjectFile('/x/.lerret/A.jsx', '/x/.lerret/B', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('standalone');
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('returns ok:false on network error', async () => {
 const fetchMock = vi.fn().mockRejectedValue(new Error('econnrefused'));
 const result = await moveProjectFile('/x/.lerret/A.jsx', '/x/.lerret/B', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('econnrefused');
 });
});

describe('deleteProjectFile', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { path } to the delete endpoint', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200, json: async () => ({ ok: true }),
 });
 const result = await deleteProjectFile('/x/.lerret/A.jsx', { fetch: fetchMock });
 expect(result).toEqual({ ok: true });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(DELETE_ENDPOINT);
 expect(JSON.parse(init.body)).toEqual({ path: '/x/.lerret/A.jsx' });
 });

 it('rejects empty path before fetching', async () => {
 const fetchMock = vi.fn();
 const result = await deleteProjectFile('', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

describe('revealProjectFile', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { path, target } to the reveal endpoint', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200, json: async () => ({ ok: true }),
 });
 const result = await revealProjectFile('/x/.lerret/A.jsx', 'editor', { fetch: fetchMock });
 expect(result).toEqual({ ok: true });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(REVEAL_ENDPOINT);
 expect(JSON.parse(init.body)).toEqual({ path: '/x/.lerret/A.jsx', target: 'editor' });
 });

 it('rejects an unknown target', async () => {
 const fetchMock = vi.fn();
 const result = await revealProjectFile('/x/.lerret/A.jsx', 'browser', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('editor');
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('returns standalone-mode error when CLI mode is off', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const fetchMock = vi.fn();
 const result = await revealProjectFile('/x/.lerret/A.jsx', 'finder', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('standalone');
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

describe('inCliMode', () => {
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 });

 it('reports true when the CLI mode flag is set', () => {
 globalThis.__LERRET_CLI_MODE__ = true;
 expect(inCliMode()).toBe(true);
 });

 it('reports false when the CLI mode flag is absent', () => {
 delete globalThis.__LERRET_CLI_MODE__;
 expect(inCliMode()).toBe(false);
 });
});

describe('createProjectEntry', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { parentPath, name, kind } for a folder and returns the path', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, path: '/x/.lerret/landing' }),
 });
 const result = await createProjectEntry('/x/.lerret', 'landing', 'folder', { fetch: fetchMock });
 expect(result).toEqual({ ok: true, path: '/x/.lerret/landing' });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(CREATE_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(JSON.parse(init.body)).toEqual({ parentPath: '/x/.lerret', name: 'landing', kind: 'folder' });
 });

 it('includes assetKind for an asset (defaulting to component)', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, path: '/x/.lerret/landing/hero.jsx' }),
 });
 await createProjectEntry('/x/.lerret/landing', 'hero', 'asset', { fetch: fetchMock });
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
 parentPath: '/x/.lerret/landing',
 name: 'hero',
 kind: 'asset',
 assetKind: 'component',
 });
 });

 it('passes assetKind: markdown through', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, path: '/x/.lerret/landing/notes.md' }),
 });
 await createProjectEntry('/x/.lerret/landing', 'notes', 'asset', {
 fetch: fetchMock,
 assetKind: 'markdown',
 });
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).assetKind).toBe('markdown');
 });

 it('surfaces a server error without throwing', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 409,
 json: async () => ({ ok: false, error: '"landing" already exists here' }),
 });
 const result = await createProjectEntry('/x/.lerret', 'landing', 'folder', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toMatch(/already exists/);
 });

 it('validates inputs before any fetch', async () => {
 const fetchMock = vi.fn();
 expect((await createProjectEntry('', 'x', 'folder', { fetch: fetchMock })).ok).toBe(false);
 expect((await createProjectEntry('/x/.lerret', '', 'folder', { fetch: fetchMock })).ok).toBe(false);
 expect((await createProjectEntry('/x/.lerret', 'x', 'bogus', { fetch: fetchMock })).ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('no-ops with a clear error outside CLI mode', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const result = await createProjectEntry('/x/.lerret', 'landing', 'folder');
 expect(result.ok).toBe(false);
 expect(result.error).toMatch(/standalone/);
 });
});

describe('switchProject', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('posts { folder } and returns the server payload (project metadata)', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, projectRoot: '/p/two', lerretDir: '/p/two/.lerret', epoch: 4 }),
 });
 const result = await switchProject('/p/two', { fetch: fetchMock });
 expect(result).toMatchObject({ ok: true, projectRoot: '/p/two', epoch: 4 });
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(SWITCH_FOLDER_ENDPOINT);
 expect(init.method).toBe('POST');
 expect(JSON.parse(init.body)).toEqual({ folder: '/p/two' });
 });

 it('posts { folder: null } to close the project', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200,
 json: async () => ({ ok: true, projectRoot: null, lerretDir: null, epoch: 5 }),
 });
 const result = await switchProject(null, { fetch: fetchMock });
 expect(result.ok).toBe(true);
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ folder: null });
 });

 it('surfaces a server rejection (no .lerret/ at target)', async () => {
 const fetchMock = vi.fn().mockResolvedValue({
 ok: false, status: 400,
 json: async () => ({ ok: false, error: 'no .lerret/ project found at or above "/tmp"' }),
 });
 const result = await switchProject('/tmp', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(result.error).toContain('no .lerret/');
 });

 it('rejects an empty-string folder before fetching', async () => {
 const fetchMock = vi.fn();
 const result = await switchProject('', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });

 it('is a no-op in standalone mode', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const fetchMock = vi.fn();
 const result = await switchProject('/p/two', { fetch: fetchMock });
 expect(result.ok).toBe(false);
 expect(fetchMock).not.toHaveBeenCalled();
 });
});

describe('fetchRecentProjects', () => {
 beforeEach(() => {
 globalThis.__LERRET_CLI_MODE__ = true;
 });
 afterEach(() => {
 delete globalThis.__LERRET_CLI_MODE__;
 vi.restoreAllMocks();
 });

 it('GETs the recents endpoint and returns the list', async () => {
 const recent = [{ path: '/p/one', name: 'one' }, { path: '/p/two', name: 'two' }];
 const fetchMock = vi.fn().mockResolvedValue({
 ok: true, status: 200, json: async () => ({ ok: true, recent }),
 });
 const result = await fetchRecentProjects({ fetch: fetchMock });
 expect(result).toEqual(recent);
 const [url, init] = fetchMock.mock.calls[0];
 expect(url).toBe(RECENT_PROJECTS_ENDPOINT);
 expect(init.method).toBe('GET');
 });

 it('returns [] on a network error (never throws)', async () => {
 const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
 expect(await fetchRecentProjects({ fetch: fetchMock })).toEqual([]);
 });

 it('returns [] in standalone mode without fetching', async () => {
 delete globalThis.__LERRET_CLI_MODE__;
 const fetchMock = vi.fn();
 expect(await fetchRecentProjects({ fetch: fetchMock })).toEqual([]);
 expect(fetchMock).not.toHaveBeenCalled();
 });
});
