// Tests for `computeCascadedConfig`.
//
// All tests use an in-memory `FilesystemAccess` fake — no `node:fs`, no DOM
// APIs — satisfying the core-purity invariant (AR2).
//
// Coverage:
//   1. Project-root `config.json` is the outermost tier; page inherits it.
//   2. Deep merge: parent + child both define overlapping nested config keys —
//      child's value wins at the leaf; parent-only sibling keys are preserved.
//   3. Array replacement: child's array replaces parent's wholesale (no
//      element-merging).
//   4. Folder with no `config.json` transparently inherits the parent's
//      effective config (no error, no warning).
//   5. Malformed `config.json` (invalid JSON) — skipped, falls back to parent,
//      `console.warn` called with the file path + error.
//   6. Top-level `config.json` value that is not a plain object — skipped,
//      falls back to parent, `console.warn` called.
//   7. Nested groups inherit through the full chain.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { createGroupNode, createPageNode, createProjectNode } from '../loader/model.js';
import { computeCascadedConfig } from './cascade.js';

// ---------------------------------------------------------------------------
// In-memory FilesystemAccess fake
// ---------------------------------------------------------------------------

/**
 * Build an in-memory `FilesystemAccess` from a flat map of path → content.
 *
 * Only `readFile` and `readDir` are exercised by the cascade; `writeFile` and
 * `watch` are present as stubs so the object structurally satisfies the
 * `FilesystemAccess` contract.
 *
 * `readDir` is not called by the cascade (it reads configs via readFile), but
 * is required by the contract — returns an empty array for any path.
 *
 * @param {Record<string, string>} files
 *   A flat map of absolute forward-slash path → file content (string).
 * @returns {import('../fs/filesystem.js').FilesystemAccess}
 */
function makeMemoryFs(files) {
  return {
    async readDir(_dirPath) {
      return [];
    },
    async readFile(filePath, _options) {
      const content = files[filePath];
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file: ${filePath}`);
        // @ts-ignore
        err.code = 'ENOENT';
        throw err;
      }
      return content;
    },
    async writeFile() {
      throw new Error('writeFile is not used by the cascade');
    },
    watch() {
      return { close() {} };
    },
    async deleteFile() {
      throw new Error('deleteFile is not used by the cascade');
    },
    async mkdir() {
      throw new Error('mkdir is not used by the cascade');
    },
    async exists() {
      return false;
    },
    capabilities: { canWrite: false, canWatch: false, canReveal: false },
  };
}

// ---------------------------------------------------------------------------
// Helper to build minimal ProjectNode fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `ProjectNode` at the given root path with the provided pages.
 *
 * @param {string} rootPath
 * @param {import('../loader/model.js').PageNode[]} pages
 * @returns {import('../loader/model.js').ProjectNode}
 */
function makeProject(rootPath, pages) {
  return createProjectNode({ name: 'test-project', path: rootPath, pages });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeCascadedConfig', () => {
  // -------------------------------------------------------------------------
  // 1. Project-root config is the outermost tier
  // -------------------------------------------------------------------------

  it('makes the project-root config.json the outermost tier', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/home`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ theme: 'light', vars: { brandColor: '#fff' } }),
    });

    const model = makeProject(root, [
      createPageNode({ name: 'home', path: pagePath }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    expect(result.get(pagePath)).toEqual({ theme: 'light', vars: { brandColor: '#fff' } });
  });

  // -------------------------------------------------------------------------
  // 2. Deep merge — child leaf wins; parent-only siblings are preserved
  // -------------------------------------------------------------------------

  it('deep-merges child config over parent: child leaf wins, parent siblings preserved', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/marketing`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({
        vars: {
          brandColor: '#aabbcc',
          fontSize: 16,
        },
        layout: 'centered',
      }),
      [`${pagePath}/config.json`]: JSON.stringify({
        vars: {
          brandColor: '#ff0000',
          // fontSize is NOT set in child → must be inherited from parent
        },
        // layout is NOT set in child → must be inherited
      }),
    });

    const model = makeProject(root, [
      createPageNode({ name: 'marketing', path: pagePath }),
    ]);

    const result = await computeCascadedConfig(model, backend);
    const effective = result.get(pagePath);

    // Child overrides brandColor at the leaf.
    expect(effective?.vars).toEqual({ brandColor: '#ff0000', fontSize: 16 });
    // Parent-only sibling key inherited.
    expect(effective?.layout).toBe('centered');
  });

  // -------------------------------------------------------------------------
  // 3. Array replacement — child's array replaces parent's wholesale
  // -------------------------------------------------------------------------

  it('replaces parent array wholesale — arrays are NOT element-merged', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/docs`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({
        vars: { tags: ['alpha', 'beta', 'gamma'] },
      }),
      [`${pagePath}/config.json`]: JSON.stringify({
        vars: { tags: ['delta'] },
      }),
    });

    const model = makeProject(root, [
      createPageNode({ name: 'docs', path: pagePath }),
    ]);

    const result = await computeCascadedConfig(model, backend);
    const effective = result.get(pagePath);

    // Child's array wins wholesale — parent's ['alpha','beta','gamma'] is gone.
    expect(effective?.vars).toEqual({ tags: ['delta'] });
  });

  // -------------------------------------------------------------------------
  // 4. No config.json → transparently inherits parent config (no error, no warn)
  // -------------------------------------------------------------------------

  it('folder with no config.json transparently inherits the parent effective config', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/about`;
    const groupPath = `${pagePath}/section`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ vars: { color: 'blue' } }),
      // Neither the page nor the group has a config.json.
    });

    const warnSpy = vi.spyOn(console, 'warn');

    const model = makeProject(root, [
      createPageNode({
        name: 'about',
        path: pagePath,
        groups: [createGroupNode({ name: 'section', path: groupPath })],
      }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    // Both page and group inherit root config unchanged.
    expect(result.get(pagePath)).toEqual({ vars: { color: 'blue' } });
    expect(result.get(groupPath)).toEqual({ vars: { color: 'blue' } });

    // No warning emitted for absent files.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Malformed JSON → skipped, fallback to parent, console.warn
  // -------------------------------------------------------------------------

  it('skips a config.json with invalid JSON, falls back to parent, emits console.warn', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/broken`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ safe: true }),
      [`${pagePath}/config.json`]: 'this is { NOT: valid JSON',
    });

    const warnSpy = vi.spyOn(console, 'warn');

    const model = makeProject(root, [
      createPageNode({ name: 'broken', path: pagePath }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    // Falls back to parent config (root config).
    expect(result.get(pagePath)).toEqual({ safe: true });

    // console.warn was called and mentions the file path.
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnArg = warnSpy.mock.calls[0][0];
    expect(typeof warnArg).toBe('string');
    expect(warnArg).toContain(`${pagePath}/config.json`);
  });

  // -------------------------------------------------------------------------
  // 6. Top-level value not a plain object → skipped, fallback, console.warn
  // -------------------------------------------------------------------------

  it('skips config.json whose top-level is not a plain object, falls back to parent, emits console.warn', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/array-root`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ base: 'value' }),
      // Top-level is an array — not a valid config.json.
      [`${pagePath}/config.json`]: JSON.stringify(['unexpected', 'array']),
    });

    const warnSpy = vi.spyOn(console, 'warn');

    const model = makeProject(root, [
      createPageNode({ name: 'array-root', path: pagePath }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    expect(result.get(pagePath)).toEqual({ base: 'value' });
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnArg = warnSpy.mock.calls[0][0];
    expect(warnArg).toContain(`${pagePath}/config.json`);
  });

  // -------------------------------------------------------------------------
  // 7. Multi-level cascade: root → page → group (full chain)
  // -------------------------------------------------------------------------

  it('cascades through root → page → group, each level accumulating overrides', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/brand`;
    const groupPath = `${pagePath}/hero`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({
        vars: { color: 'red', size: 12 },
        spacing: 8,
      }),
      [`${pagePath}/config.json`]: JSON.stringify({
        vars: { color: 'blue' },
        // size is NOT overridden → inherits 12 from root
        // spacing is NOT overridden → inherits 8 from root
      }),
      [`${groupPath}/config.json`]: JSON.stringify({
        vars: { size: 24 },
        // color is NOT overridden → inherits 'blue' from page
        // spacing is NOT overridden → inherits 8 from root
      }),
    });

    const model = makeProject(root, [
      createPageNode({
        name: 'brand',
        path: pagePath,
        groups: [createGroupNode({ name: 'hero', path: groupPath })],
      }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    // Page: root merged with page's own config.
    expect(result.get(pagePath)).toEqual({
      vars: { color: 'blue', size: 12 },
      spacing: 8,
    });

    // Group: page effective merged with group's own config.
    expect(result.get(groupPath)).toEqual({
      vars: { color: 'blue', size: 24 },
      spacing: 8,
    });
  });

  // -------------------------------------------------------------------------
  // 8. Multiple pages — each page gets its own independent effective config
  // -------------------------------------------------------------------------

  it('computes independent effective configs for multiple sibling pages', async () => {
    const root = '/project/.lerret';
    const pageA = `${root}/pageA`;
    const pageB = `${root}/pageB`;

    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ shared: 'root' }),
      [`${pageA}/config.json`]: JSON.stringify({ own: 'a' }),
      [`${pageB}/config.json`]: JSON.stringify({ own: 'b' }),
    });

    const model = makeProject(root, [
      createPageNode({ name: 'pageA', path: pageA }),
      createPageNode({ name: 'pageB', path: pageB }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    expect(result.get(pageA)).toEqual({ shared: 'root', own: 'a' });
    expect(result.get(pageB)).toEqual({ shared: 'root', own: 'b' });
  });

  // -------------------------------------------------------------------------
  // 9. Empty project (no pages) — result is an empty Map
  // -------------------------------------------------------------------------

  it('returns an empty Map for a project with no pages', async () => {
    const root = '/project/.lerret';
    const backend = makeMemoryFs({
      [`${root}/config.json`]: JSON.stringify({ unused: true }),
    });

    const model = makeProject(root, []);
    const result = await computeCascadedConfig(model, backend);

    expect(result.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. No configs anywhere — every folder maps to an empty object
  // -------------------------------------------------------------------------

  it('maps every folder to {} when there are no config.json files anywhere', async () => {
    const root = '/project/.lerret';
    const pagePath = `${root}/empty`;
    const groupPath = `${pagePath}/sub`;

    const backend = makeMemoryFs({}); // no files at all

    const model = makeProject(root, [
      createPageNode({
        name: 'empty',
        path: pagePath,
        groups: [createGroupNode({ name: 'sub', path: groupPath })],
      }),
    ]);

    const result = await computeCascadedConfig(model, backend);

    expect(result.get(pagePath)).toEqual({});
    expect(result.get(groupPath)).toEqual({});
  });
});
