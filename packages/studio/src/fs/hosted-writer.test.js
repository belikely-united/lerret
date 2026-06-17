// Tests for hosted-writer.js (Epic 10 / H2) — the hosted-mode writer over a
// FilesystemAccess backend. Uses the in-memory backend so the write surface is
// exercised without a real FSA handle.

import { describe, it, expect } from 'vitest';

import { createMemoryBackend } from './memory-backend.js';
import { createHostedWriter } from './hosted-writer.js';

describe('createHostedWriter — writeFile', () => {
  it('overwrites a file and returns { ok: true }', async () => {
    const backend = createMemoryBackend({ '.lerret/page/A.data.json': '{"old":1}' });
    const writer = createHostedWriter(backend);
    const res = await writer.writeFile('.lerret/page/A.data.json', '{"new":2}');
    expect(res).toEqual({ ok: true });
    expect(await backend.readFile('.lerret/page/A.data.json')).toBe('{"new":2}');
  });

  it('creates a new file (and parent dirs) when absent', async () => {
    const backend = createMemoryBackend({ '.lerret/config.json': '{}' });
    const writer = createHostedWriter(backend);
    const res = await writer.writeFile('.lerret/new/Deep.data.json', '{"x":1}');
    expect(res.ok).toBe(true);
    expect(await backend.exists('.lerret/new/Deep.data.json')).toBe(true);
  });

  it('decodes base64 content for binary writes', async () => {
    const backend = createMemoryBackend();
    const writer = createHostedWriter(backend);
    const res = await writer.writeFile('.lerret/p/img.bin', btoa('hello-bytes'), { encoding: 'base64' });
    expect(res.ok).toBe(true);
    const bytes = await backend.readFile('.lerret/p/img.bin', { encoding: 'binary' });
    expect(new TextDecoder().decode(bytes)).toBe('hello-bytes');
  });

  it('returns { ok: false, error } when the backend write throws (never throws)', async () => {
    const backend = createMemoryBackend();
    backend.writeFile = async () => { throw new Error('disk full'); };
    const writer = createHostedWriter(backend);
    const res = await writer.writeFile('.lerret/x.json', '{}');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disk full/);
  });
});

describe('createHostedWriter — folder lifecycle (H3)', () => {
  function project() {
    return createMemoryBackend({
      '.lerret/config.json': '{}',
      '.lerret/marketing/Hero.jsx': 'export default () => null;',
      '.lerret/marketing/Hero.data.json': '{"t":1}',
      '.lerret/marketing/sub/Nested.jsx': 'x',
    });
  }

  it('createEntry(folder) makes a page folder and returns its path', async () => {
    const b = createMemoryBackend({ '.lerret/config.json': '{}' });
    const res = await createHostedWriter(b).createEntry('.lerret', 'landing', 'folder');
    expect(res.ok).toBe(true);
    expect(res.path).toBe('.lerret/landing');
    expect(await b.exists('.lerret/landing')).toBe(true);
  });

  it('createEntry(folder) rejects a duplicate name', async () => {
    const b = createMemoryBackend({ '.lerret/landing/A.jsx': 'x' });
    const res = await createHostedWriter(b).createEntry('.lerret', 'landing', 'folder');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });

  it('renameEntry on a folder recursively moves the whole tree (companions ride along)', async () => {
    const b = project();
    const res = await createHostedWriter(b).renameEntry('.lerret/marketing', '.lerret/campaigns');
    expect(res.ok).toBe(true);
    expect(await b.exists('.lerret/marketing')).toBe(false);
    expect(await b.readFile('.lerret/campaigns/Hero.jsx')).toBe('export default () => null;');
    expect(await b.readFile('.lerret/campaigns/Hero.data.json')).toBe('{"t":1}');
    expect(await b.exists('.lerret/campaigns/sub/Nested.jsx')).toBe(true);
  });

  it('renameEntry rejects when the destination already exists', async () => {
    const b = createMemoryBackend({ '.lerret/a/x.jsx': '1', '.lerret/b/y.jsx': '2' });
    const res = await createHostedWriter(b).renameEntry('.lerret/a', '.lerret/b');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already exists/i);
  });

  it('deleteEntry on a folder removes the whole tree', async () => {
    const b = project();
    const res = await createHostedWriter(b).deleteEntry('.lerret/marketing');
    expect(res.ok).toBe(true);
    expect(await b.exists('.lerret/marketing')).toBe(false);
    expect(await b.exists('.lerret/marketing/Hero.jsx')).toBe(false);
  });

  it('deleteEntry on a missing path is a success no-op', async () => {
    const b = createMemoryBackend({ '.lerret/config.json': '{}' });
    expect(await createHostedWriter(b).deleteEntry('.lerret/ghost')).toEqual({ ok: true });
  });

});

describe('createHostedWriter — asset lifecycle + companions (H4)', () => {
  function assetProject() {
    return createMemoryBackend({
      '.lerret/config.json': '{}',
      '.lerret/marketing/Hero.jsx': 'export default () => null;',
      '.lerret/marketing/Hero.data.json': '{"t":1}',
      '.lerret/marketing/Hero.config.json': '{"autoRefresh":1000}',
      '.lerret/marketing/hero-logo.png': 'IMG',
      '.lerret/marketing/Unrelated.jsx': 'x',
      '.lerret/archive/.keep': '',
    });
  }

  it('createEntry(asset, component) writes a starter .jsx', async () => {
    const b = createMemoryBackend({ '.lerret/page/.keep': '' });
    const res = await createHostedWriter(b).createEntry('.lerret/page', 'Banner', 'asset', { assetKind: 'component' });
    expect(res.ok).toBe(true);
    expect(res.path).toBe('.lerret/page/Banner.jsx');
    expect(await b.readFile('.lerret/page/Banner.jsx')).toMatch(/export default function/);
  });

  it('createEntry(asset, markdown) writes a starter .md', async () => {
    const b = createMemoryBackend({ '.lerret/page/.keep': '' });
    const res = await createHostedWriter(b).createEntry('.lerret/page', 'Notes', 'asset', { assetKind: 'markdown' });
    expect(res.path).toBe('.lerret/page/Notes.md');
    expect(await b.readFile('.lerret/page/Notes.md')).toMatch(/^# Notes/);
  });

  it('renameEntry on an asset renames the file AND its companions', async () => {
    const b = assetProject();
    const res = await createHostedWriter(b).renameEntry('.lerret/marketing/Hero.jsx', '.lerret/marketing/Banner.jsx');
    expect(res.ok).toBe(true);
    expect(await b.exists('.lerret/marketing/Hero.jsx')).toBe(false);
    expect(await b.exists('.lerret/marketing/Hero.data.json')).toBe(false);
    expect(await b.exists('.lerret/marketing/hero-logo.png')).toBe(false);
    expect(await b.exists('.lerret/marketing/Banner.jsx')).toBe(true);
    expect(await b.readFile('.lerret/marketing/Banner.data.json')).toBe('{"t":1}');
    expect(await b.exists('.lerret/marketing/Banner.config.json')).toBe(true);
    expect(await b.exists('.lerret/marketing/Banner-logo.png')).toBe(true);
    expect(await b.exists('.lerret/marketing/Unrelated.jsx')).toBe(true);
  });

  it('deleteEntry on an asset removes the file + companions but not siblings', async () => {
    const b = assetProject();
    expect((await createHostedWriter(b).deleteEntry('.lerret/marketing/Hero.jsx')).ok).toBe(true);
    expect(await b.exists('.lerret/marketing/Hero.jsx')).toBe(false);
    expect(await b.exists('.lerret/marketing/Hero.data.json')).toBe(false);
    expect(await b.exists('.lerret/marketing/hero-logo.png')).toBe(false);
    expect(await b.exists('.lerret/marketing/Unrelated.jsx')).toBe(true);
  });

  it('moveEntry relocates an asset + companions to another folder', async () => {
    const b = assetProject();
    const res = await createHostedWriter(b).moveEntry('.lerret/marketing/Hero.jsx', '.lerret/archive');
    expect(res).toMatchObject({ ok: true, newPath: '.lerret/archive/Hero.jsx' });
    expect(await b.exists('.lerret/marketing/Hero.jsx')).toBe(false);
    expect(await b.exists('.lerret/archive/Hero.jsx')).toBe(true);
    expect(await b.exists('.lerret/archive/Hero.data.json')).toBe(true);
    expect(await b.exists('.lerret/archive/hero-logo.png')).toBe(true);
  });

  it('duplicateEntry copies an asset to "(copy)" with its companions', async () => {
    const b = assetProject();
    const res = await createHostedWriter(b).duplicateEntry('.lerret/marketing/Hero.jsx');
    expect(res).toMatchObject({ ok: true, path: '.lerret/marketing/Hero (copy).jsx' });
    expect(await b.exists('.lerret/marketing/Hero.jsx')).toBe(true);
    expect(await b.readFile('.lerret/marketing/Hero (copy).data.json')).toBe('{"t":1}');
    expect(await b.exists('.lerret/marketing/Hero (copy)-logo.png')).toBe(true);
  });
});
