// @vitest-environment node
//
// Unit tests for the Memory node — reads the reserved `.lerret/` context files
// and assembles the `context` string. Pins the graceful-absence contract
// Story 8.6 must not break: a missing file contributes nothing (never an
// error), an existing-but-unreadable file is skipped, an empty file emits no
// `reading` event, and present files are joined in RESERVED_CONTEXT_PATHS order.

import { describe, it, expect, vi } from 'vitest';

import {
  createMemoryNode,
  createMemoryAgent,
  brandAssetType,
  deriveTargetScope,
  RESERVED_CONTEXT_PATHS,
  BRAND_DIR,
} from './memory.js';
import { DESIGN_SYSTEM_PATH, CONTEXT_PATH, MEMORY_PATH } from '../../memory/paths.js';

const DS = '.lerret/_design-system.md';
const CTX = '.lerret/_context.md';
const MEM = '.lerret/_memory.md';

/** Sandbox over a relPath→contents map; absent path → exists:false + read throws. */
function makeSandbox(files = {}) {
  return {
    exists: vi.fn(async (p) => Object.prototype.hasOwnProperty.call(files, p)),
    readFile: vi.fn(async (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error(`ENOENT ${p}`);
      return files[p];
    }),
  };
}

describe('Memory node — reserved paths', () => {
  it('exports the three reserved paths in injection order + the brand dir', () => {
    expect(RESERVED_CONTEXT_PATHS).toEqual([DS, CTX, MEM]);
    expect(BRAND_DIR).toBe('.lerret/_brand');
  });
});

describe('createMemoryNode — graceful absence', () => {
  it('no files → empty context, no reading events, no throw', async () => {
    const emit = vi.fn();
    const out = await createMemoryNode({ sandbox: makeSandbox({}), emit })({});
    expect(out).toEqual({ context: '' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('a file that exists but fails to read is skipped (non-fatal)', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({ [DS]: 'design', [CTX]: 'context' });
    // Make the design-system read throw despite exists() being true.
    sandbox.readFile = vi.fn(async (p) => {
      if (p === DS) throw new Error('EIO');
      return 'context body';
    });
    const out = await createMemoryNode({ sandbox, emit })({});
    expect(out.context).toBe(`# ${CTX}\n\ncontext body`);
    expect(emit.mock.calls.map((c) => c[0].file)).toEqual([CTX]);
  });

  it('an empty / whitespace-only file emits no reading event and adds no section', async () => {
    const emit = vi.fn();
    const out = await createMemoryNode({
      sandbox: makeSandbox({ [DS]: '   \n\t ' }),
      emit,
    })({});
    expect(out).toEqual({ context: '' });
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('createMemoryNode — assembly', () => {
  it('joins present files in reserved order, headered + separated, emitting one reading each', async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({ [MEM]: 'M body', [DS]: 'D body' }); // insertion order shuffled
    const out = await createMemoryNode({ sandbox, emit })({});
    // Output order follows RESERVED_CONTEXT_PATHS (DS before MEM), not map order.
    expect(out.context).toBe(`# ${DS}\n\nD body\n\n---\n\n# ${MEM}\n\nM body`);
    expect(emit.mock.calls.map((c) => c[0].file)).toEqual([DS, MEM]);
    expect(emit.mock.calls.every((c) => c[0].type === 'reading')).toBe(true);
  });

  it('trims surrounding whitespace from each section body', async () => {
    const out = await createMemoryNode({
      sandbox: makeSandbox({ [DS]: '\n\n  hello  \n\n' }),
      emit: vi.fn(),
    })({});
    expect(out.context).toBe(`# ${DS}\n\nhello`);
  });

  it('aborted signal short-circuits to empty context without touching the sandbox', async () => {
    const sandbox = makeSandbox({ [DS]: 'x' });
    const controller = new AbortController();
    controller.abort();
    const out = await createMemoryNode({ sandbox, emit: vi.fn() })({
      signal: controller.signal,
    });
    expect(out).toEqual({ context: '' });
    expect(sandbox.exists).not.toHaveBeenCalled();
  });
});

describe('deriveTargetScope — real runTurn scope shapes', () => {
  it('passes a string scope through as-is', () => {
    expect(deriveTargetScope('social-media/')).toBe('social-media/');
    expect(deriveTargetScope('social-media')).toBe('social-media');
  });

  it("derives the parent folder from the dock's file scope object", () => {
    expect(
      deriveTargetScope({ kind: 'file', filePath: 'social-media/twitter/card.jsx', label: 'card.jsx' }),
    ).toBe('social-media/twitter/');
    expect(deriveTargetScope({ kind: 'file', filePath: 'social-media/post.jsx' })).toBe(
      'social-media/',
    );
  });

  it('a bare filename (no folder) derives the empty scope', () => {
    expect(deriveTargetScope({ kind: 'file', filePath: 'card.jsx' })).toBe('');
  });

  it("a page scope derives label + '/'", () => {
    expect(deriveTargetScope({ kind: 'page', label: 'social-media' })).toBe(
      'social-media/',
    );
  });

  it('everything else degrades to the empty (global-only) scope', () => {
    expect(deriveTargetScope({ type: 'project' })).toBe('');
    expect(deriveTargetScope({ kind: 'artboards', count: 3, label: '3 artboards' })).toBe('');
    expect(deriveTargetScope(null)).toBe('');
    expect(deriveTargetScope(undefined)).toBe('');
    expect(deriveTargetScope(42)).toBe('');
  });
});

describe('createMemoryNode — object-scope anchoring (the real graph path)', () => {
  const SCOPED_DS = 'DS global\n<!-- scope: social-media/ -->\nDS social';

  it("the dock's file-scope OBJECT activates scoped anchoring", async () => {
    const emit = vi.fn();
    const sandbox = makeSandbox({ [DS]: SCOPED_DS });
    const out = await createMemoryNode({ sandbox, emit })({
      scope: { kind: 'file', filePath: 'social-media/twitter/card.jsx', label: 'card.jsx' },
    });
    // Anchored composition: global + the matching scoped section, NOT the
    // headered raw concatenation.
    expect(out.context).toContain('DS global');
    expect(out.context).toContain('DS social');
    expect(out.context).not.toContain(`# ${DS}`);
    expect(out.context).not.toContain('<!-- scope:');
  });

  it('a project / unknown object scope falls back to the headered concatenation', async () => {
    const sandbox = makeSandbox({ [DS]: SCOPED_DS });
    const out = await createMemoryNode({ sandbox, emit: vi.fn() })({
      scope: { type: 'project' },
    });
    expect(out.context).toBe(`# ${DS}\n\n${SCOPED_DS}`);
  });
});

// ─── Story 8.6 additions ─────────────────────────────────────────────────────

const ROOT = '/proj';

/**
 * A read-only `fs` stand-in over an ABSOLUTE-path → content map. Mirrors the v1
 * FilesystemAccess: `readFile` throws ENOENT on absence; `readDir` lists direct
 * children. Records every `readFile` arg so tests can assert no image-byte read.
 */
function makeReadFs(files = {}) {
  return {
    readFile: vi.fn(async (p) => {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const err = new Error(`ENOENT ${p}`);
        err.code = 'ENOENT';
        throw err;
      }
      return files[p];
    }),
    readDir: vi.fn(async (dir) => {
      const prefix = dir.replace(/\/$/, '') + '/';
      const seen = new Map();
      for (const path of Object.keys(files)) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const top = rest.split('/')[0];
        const isDir = rest.includes('/');
        if (!seen.has(top)) {
          seen.set(top, {
            name: top,
            path: prefix + top,
            isFile: !isDir,
            isDirectory: isDir,
          });
        }
      }
      return [...seen.values()];
    }),
  };
}

describe('brandAssetType', () => {
  it('classifies SVGs as logo vs vector by stem, rasters as image, else asset', () => {
    expect(brandAssetType('logo.svg')).toBe('logo');
    expect(brandAssetType('logo-mark.svg')).toBe('logo');
    expect(brandAssetType('wordmark.svg')).toBe('logo');
    // A swatch is a vector even when its name mentions the brand.
    expect(brandAssetType('swatch-brand.svg')).toBe('vector');
    expect(brandAssetType('swatch-accent.svg')).toBe('vector');
    expect(brandAssetType('photo.png')).toBe('image');
    expect(brandAssetType('shot.JPG')).toBe('image');
    expect(brandAssetType('palette.txt')).toBe('asset');
  });
});

describe('createMemoryAgent — readMemory (graceful absence + absolute paths)', () => {
  it('reads the three reserved files via ABSOLUTE paths', async () => {
    const fs = makeReadFs({
      [`${ROOT}/${DESIGN_SYSTEM_PATH}`]: 'DS body',
      [`${ROOT}/${CONTEXT_PATH}`]: 'CTX body',
      [`${ROOT}/${MEMORY_PATH}`]: 'MEM body',
    });
    const agent = createMemoryAgent({ projectRoot: ROOT, fs });
    const mem = await agent.readMemory();
    expect(mem).toEqual({
      designSystem: 'DS body',
      context: 'CTX body',
      memory: 'MEM body',
    });
    // Confirms absolute-path threading (relative would ENOENT against the map).
    expect(fs.readFile).toHaveBeenCalledWith(`${ROOT}/${DESIGN_SYSTEM_PATH}`, {
      encoding: 'utf-8',
    });
  });

  it('a missing reserved file is silently the empty string, never a throw', async () => {
    const fs = makeReadFs({ [`${ROOT}/${CONTEXT_PATH}`]: 'only context' });
    const mem = await createMemoryAgent({ projectRoot: ROOT, fs }).readMemory();
    expect(mem).toEqual({ designSystem: '', context: 'only context', memory: '' });
  });

  it('a fresh project with NO reserved files yields three empty strings', async () => {
    const mem = await createMemoryAgent({
      projectRoot: ROOT,
      fs: makeReadFs({}),
    }).readMemory();
    expect(mem).toEqual({ designSystem: '', context: '', memory: '' });
  });
});

describe('createMemoryAgent — indexBrandFolder (filename + type, NO byte reads)', () => {
  it('indexes _brand/ entries as { name, type, path } and NEVER reads image bytes', async () => {
    const fs = makeReadFs({
      [`${ROOT}/.lerret/_brand/logo.svg`]: '<svg/>',
      [`${ROOT}/.lerret/_brand/swatch-brand.svg`]: '<svg/>',
      [`${ROOT}/.lerret/_brand/hero.png`]: new Uint8Array([1, 2, 3]),
    });
    const index = await createMemoryAgent({ projectRoot: ROOT, fs }).indexBrandFolder();
    const byName = Object.fromEntries(index.map((e) => [e.name, e.type]));
    expect(byName).toEqual({
      'logo.svg': 'logo',
      'swatch-brand.svg': 'vector',
      'hero.png': 'image',
    });
    // Guardrail #5: indexing reads filenames + extensions ONLY — no bytes.
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('path is ALWAYS the project-relative `.lerret/_brand/<name>` — never the backend-absolute entry path', async () => {
    // makeReadFs's readDir reports backend-ABSOLUTE entry paths (like the real
    // Node backend); the index must still emit the relative WorkerStep form.
    const fs = makeReadFs({ [`${ROOT}/.lerret/_brand/logo.svg`]: '<svg/>' });
    const index = await createMemoryAgent({ projectRoot: ROOT, fs }).indexBrandFolder();
    expect(index).toEqual([
      { name: 'logo.svg', type: 'logo', path: '.lerret/_brand/logo.svg' },
    ]);
  });

  it('a missing _brand/ directory returns an empty index (graceful absence)', async () => {
    const index = await createMemoryAgent({
      projectRoot: ROOT,
      fs: makeReadFs({}),
    }).indexBrandFolder();
    expect(index).toEqual([]);
  });
});

describe('createMemoryAgent — assembleContext (scope anchoring + filesRead)', () => {
  it('injects global + closest-scope content and lists the files read', () => {
    const agent = createMemoryAgent({ projectRoot: ROOT, fs: makeReadFs({}) });
    const memory = {
      designSystem: 'DS global\n<!-- scope: social-media/ -->\nDS social',
      context: 'CTX global',
      memory: '',
    };
    const out = agent.assembleContext({ memory, targetScope: 'social-media/' });
    expect(out.promptFragment).toContain('DS global');
    expect(out.promptFragment).toContain('DS social');
    expect(out.promptFragment).toContain('CTX global');
    // filesRead lists only the non-empty reserved paths (feeds "Read N files").
    expect(out.filesRead).toEqual([DESIGN_SYSTEM_PATH, CONTEXT_PATH]);
  });

  it('a turn targeting an unrelated scope excludes the scoped section', () => {
    const agent = createMemoryAgent({ projectRoot: ROOT, fs: makeReadFs({}) });
    const memory = {
      designSystem: 'DS global\n<!-- scope: social-media/ -->\nDS social',
      context: '',
      memory: '',
    };
    const out = agent.assembleContext({ memory, targetScope: 'appstore/' });
    expect(out.promptFragment).toContain('DS global');
    expect(out.promptFragment).not.toContain('DS social');
  });
});

describe('createMemoryAgent — readBrandAsset (text read for the Worker copy)', () => {
  it('reads a brand SVG by name (graceful absence → "")', async () => {
    const fs = makeReadFs({ [`${ROOT}/.lerret/_brand/logo.svg`]: '<svg>logo</svg>' });
    const agent = createMemoryAgent({ projectRoot: ROOT, fs });
    expect(await agent.readBrandAsset('logo.svg')).toBe('<svg>logo</svg>');
    expect(await agent.readBrandAsset('missing.svg')).toBe('');
  });

  it('rejects any name that is not a single plain path segment (no _brand/ escape)', async () => {
    const fs = makeReadFs({
      [`${ROOT}/.lerret/_brand/logo.svg`]: '<svg>logo</svg>',
      [`${ROOT}/.lerret/config.json`]: '{"secret":true}',
      [`${ROOT}/.lerret/_brand/sub/inner.svg`]: '<svg>inner</svg>',
    });
    const agent = createMemoryAgent({ projectRoot: ROOT, fs });
    // Traversal + separators + dot-segments + empties all return '' without a read.
    expect(await agent.readBrandAsset('../config.json')).toBe('');
    expect(await agent.readBrandAsset('../../etc/passwd')).toBe('');
    expect(await agent.readBrandAsset('sub/inner.svg')).toBe('');
    expect(await agent.readBrandAsset('sub\\inner.svg')).toBe('');
    expect(await agent.readBrandAsset('.')).toBe('');
    expect(await agent.readBrandAsset('..')).toBe('');
    expect(await agent.readBrandAsset('')).toBe('');
    expect(await agent.readBrandAsset(undefined)).toBe('');
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});

describe('createMemoryAgent — projectRoot validation (mirrors createMockSandbox)', () => {
  it('throws TypeError unless projectRoot is an absolute path string', () => {
    const fs = makeReadFs({});
    expect(() => createMemoryAgent({ projectRoot: 'proj', fs })).toThrow(TypeError);
    expect(() => createMemoryAgent({ projectRoot: 'proj', fs })).toThrow(/projectRoot/);
    expect(() => createMemoryAgent({ projectRoot: '', fs })).toThrow(/projectRoot/);
    expect(() => createMemoryAgent({ projectRoot: 42, fs })).toThrow(/projectRoot/);
    expect(() => createMemoryAgent({ projectRoot: '/abs', fs })).not.toThrow();
  });
});
