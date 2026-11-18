// mcp.test.js — `@lerret/cli mcp` helpers: the path guard, the project walk,
// paging under the host's tool-result cap, and the change signature.

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesPage, PAGE_CHARS, projectVersion, safePath, walkProject } from './mcp.js';

let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lerret-mcp-test-'));
  await mkdir(join(root, '.lerret', 'social'), { recursive: true });
  await writeFile(join(root, '.lerret', 'social', 'Card.jsx'), 'export default () => null;');
  await writeFile(join(root, '.lerret', '.DS_Store'), 'x');
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Read every page and join slices back, as the app does. */
async function readAll() {
  const text = {};
  const bin = {};
  let cursor = 0;
  let pages = 0;
  do {
    const page = await filesPage(root, cursor);
    expect(JSON.stringify(page).length).toBeLessThan(150_000); // Claude's cap
    for (const f of page.files) {
      if (f.text != null) text[f.path] = (text[f.path] ?? '') + f.text;
      else bin[f.path] = (bin[f.path] ?? '') + f.base64;
    }
    cursor = page.next;
    pages++;
  } while (cursor != null);
  return { text, bin, pages };
}

describe('safePath', () => {
  it('accepts paths with or without the .lerret/ prefix', () => {
    expect(safePath(root, '.lerret/social/Card.jsx').rel).toBe('.lerret/social/Card.jsx');
    expect(safePath(root, 'social/Card.jsx').rel).toBe('.lerret/social/Card.jsx');
  });
  it('refuses anything outside .lerret/', () => {
    expect(() => safePath(root, '../etc/passwd')).toThrow(/outside/);
    expect(() => safePath(root, '.lerret/../package.json')).toThrow(/outside/);
  });
});

describe('walkProject', () => {
  it('lists project files and skips dot-files', async () => {
    const files = (await walkProject(root)).map((f) => f.rel);
    expect(files).toEqual(['.lerret/social/Card.jsx']);
  });
});

describe('filesPage', () => {
  it('pages big text and binary files under the cap and they join back intact', async () => {
    const bigText = 'a'.repeat(200_000);
    const bigBin = Buffer.alloc(300_000, 7);
    await writeFile(join(root, '.lerret', 'social', 'big.obj'), bigText);
    await writeFile(join(root, '.lerret', 'social', 'big.glb'), bigBin);
    const { text, bin, pages } = await readAll();
    expect(pages).toBeGreaterThan(3);
    expect(text['.lerret/social/big.obj']).toBe(bigText);
    expect(Buffer.from(bin['.lerret/social/big.glb'], 'base64').equals(bigBin)).toBe(true);
    expect(text['.lerret/social/Card.jsx']).toBe('export default () => null;');
    expect(PAGE_CHARS).toBeLessThan(150_000);
  });
});

describe('projectVersion', () => {
  it('changes when a file is added', async () => {
    const before = await projectVersion(root);
    await writeFile(join(root, '.lerret', 'social', 'notes.md'), '# hi');
    expect(await projectVersion(root)).not.toBe(before);
  });
});
