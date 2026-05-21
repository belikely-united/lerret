// Tests for `@lerret/cli export`.
//
// Coverage breakdown:
//   (a) Argument parsing — flag types, defaults, unknown flags, positional
//       arity, format normalization, --flat / --out interaction.
//       Override flags: --data / --config flag parsing.
//   (b) Scope resolution — `pathArg` omitted / project root / page / group /
//       outside-`.lerret/` / no project found. Uses on-disk temp fixtures with
//       a minimal `.lerret/` so `scan` actually returns a usable model.
//   (c) Output-path construction — structured layout, flat layout, flat-mode
//       collision disambiguation, illegal-character sanitization.
//   (d) Variant expansion — components with `meta.variants` produce one
//       record per variant; primary-only assets produce one record.
//   (e) Orchestration shape — `runExport` drives Vite, Playwright, capture,
//       and the writer through the dependency-injection seam (no real
//       browser, no real fs writes) and isolates per-artboard failures.
//   (f) Override-file loading — successful JSON load, missing file
//       → non-zero exit with named-file error, malformed JSON → non-zero exit
//       with parse error, .js module load, and the config-override deep-merge
//       semantics via applyConfigOverrideToCascade.
//   (g) runExport override integration — loadOverrides injected via deps;
//       confirms the override is forwarded to bootServer; confirms failure
//       exits 1 before Vite boots.
//
// We deliberately do NOT exercise the actual Playwright launch or the inner
// `page.evaluate` body in unit tests — that requires a real Chromium and is
// the "stretch goal" smoke test elsewhere.

import { promises as fsp, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ARTBOARD_SELECTORS,
  buildBaseFilename,
  buildOutputPath,
  DEFAULT_FORMAT,
  DEFAULT_OUT_DIR,
  expandArtboardVariants,
  findModelNode,
  loadOverrideFile,
  loadOverrideFiles,
  parseExportArgs,
  resolveScope,
  runExport,
} from './export.js';
import { LERRET_DIR_NAME } from './resolve-project.js';

// ─────────────────────────────────────────────────────────────────────────────
// (a) parseExportArgs — argument parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parseExportArgs', () => {
  it('returns sensible defaults when no flags are passed', () => {
    const { flags, error } = parseExportArgs([]);
    expect(error).toBeNull();
    expect(flags).toEqual({
      pathArg: undefined,
      format: DEFAULT_FORMAT,
      out: DEFAULT_OUT_DIR,
      flat: false,
      help: false,
    });
  });

  it('parses an optional positional path', () => {
    const { flags, error } = parseExportArgs(['./my-project']);
    expect(error).toBeNull();
    expect(flags.pathArg).toBe('./my-project');
  });

  it('parses --format png and --format jpg', () => {
    expect(parseExportArgs(['--format', 'png']).flags.format).toBe('png');
    expect(parseExportArgs(['--format', 'jpg']).flags.format).toBe('jpg');
  });

  it('normalizes --format jpeg to jpg (alias)', () => {
    const { flags, error } = parseExportArgs(['--format', 'jpeg']);
    expect(error).toBeNull();
    expect(flags.format).toBe('jpg');
  });

  it('rejects an unsupported --format value', () => {
    const { flags, error } = parseExportArgs(['--format', 'webp']);
    expect(flags).toBeNull();
    expect(error).toMatch(/--format/);
    expect(error).toMatch(/webp/);
  });

  it('parses --out to a directory string', () => {
    const { flags, error } = parseExportArgs(['--out', '/tmp/out']);
    expect(error).toBeNull();
    expect(flags.out).toBe('/tmp/out');
  });

  it('parses --flat as a boolean toggle', () => {
    expect(parseExportArgs(['--flat']).flags.flat).toBe(true);
    expect(parseExportArgs([]).flags.flat).toBe(false);
  });

  it('combines positional + flags in any order', () => {
    const { flags, error } = parseExportArgs([
      '--flat',
      './path',
      '--format', 'jpg',
      '--out', '/tmp/out',
    ]);
    expect(error).toBeNull();
    expect(flags).toEqual({
      pathArg: './path',
      format: 'jpg',
      out: '/tmp/out',
      flat: true,
      help: false,
    });
  });

  it('rejects an unknown flag', () => {
    const { flags, error } = parseExportArgs(['--bogus']);
    expect(flags).toBeNull();
    expect(error).toBeTruthy();
  });

  it('rejects a second positional argument', () => {
    const { flags, error } = parseExportArgs(['./one', './two']);
    expect(flags).toBeNull();
    expect(error).toMatch(/extra/);
  });

  it('sets help when -h is passed', () => {
    expect(parseExportArgs(['-h']).flags.help).toBe(true);
    expect(parseExportArgs(['--help']).flags.help).toBe(true);
  });

  // --data and --config flag parsing
  it('parses --data to a path string', () => {
    const { flags, error } = parseExportArgs(['--data', './overrides/data.json']);
    expect(error).toBeNull();
    expect(flags.data).toBe('./overrides/data.json');
  });

  it('parses --config to a path string', () => {
    const { flags, error } = parseExportArgs(['--config', './overrides/config.json']);
    expect(error).toBeNull();
    expect(flags.config).toBe('./overrides/config.json');
  });

  it('leaves data and config undefined when flags are omitted', () => {
    const { flags, error } = parseExportArgs([]);
    expect(error).toBeNull();
    expect(flags.data).toBeUndefined();
    expect(flags.config).toBeUndefined();
  });

  it('combines --data and --config with other flags', () => {
    const { flags, error } = parseExportArgs([
      '--data', './d.json',
      '--config', './c.json',
      '--format', 'jpg',
    ]);
    expect(error).toBeNull();
    expect(flags.data).toBe('./d.json');
    expect(flags.config).toBe('./c.json');
    expect(flags.format).toBe('jpg');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) resolveScope — project / page / group / not-found classification
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveScope', () => {
  let workDir;
  let projectRoot;
  let lerretDir;
  let pageDir;
  let groupDir;

  // We canonicalize (`realpathSync`) up front so the test's expectations
  // match what `resolveScope` returns — macOS's `/tmp` → `/private/tmp` and
  // similar symlinks would otherwise foil equality checks.
  let canonicalProjectRoot;
  let canonicalLerretDir;
  let canonicalPageDir;
  let canonicalGroupDir;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-export-test-'));
    projectRoot = workDir;
    lerretDir = join(projectRoot, LERRET_DIR_NAME);
    pageDir = join(lerretDir, 'ui');
    groupDir = join(pageDir, 'buttons');
    // Minimal project tree: one page, one group, one asset inside the
    // group. The loader needs at least an asset for the scope to be
    // meaningful — `scan` recognizes `.jsx` files as component assets.
    await fsp.mkdir(groupDir, { recursive: true });
    await fsp.writeFile(
      join(groupDir, 'Primary.jsx'),
      "export default function Primary() { return null; }\n",
      'utf-8',
    );
    canonicalProjectRoot = realpathSync(projectRoot).replaceAll('\\', '/');
    canonicalLerretDir = realpathSync(lerretDir).replaceAll('\\', '/');
    canonicalPageDir = realpathSync(pageDir).replaceAll('\\', '/');
    canonicalGroupDir = realpathSync(groupDir).replaceAll('\\', '/');
    void canonicalLerretDir;
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('walks up from cwd when no pathArg is given and resolves project scope', async () => {
    const scope = await resolveScope({ pathArg: undefined, cwd: groupDir });
    expect(scope.found).toBe(true);
    expect(scope.scopeKind).toBe('project');
    expect(scope.scopePath).toBeNull();
    expect(scope.projectRoot).toBe(canonicalProjectRoot);
  });

  it('classifies the project root path as the whole project', async () => {
    const scope = await resolveScope({ pathArg: projectRoot, cwd: workDir });
    expect(scope.found).toBe(true);
    expect(scope.scopeKind).toBe('project');
    expect(scope.scopePath).toBeNull();
  });

  it('classifies a page folder inside `.lerret/` as scope=page', async () => {
    const scope = await resolveScope({ pathArg: pageDir, cwd: workDir });
    expect(scope.found).toBe(true);
    expect(scope.scopeKind).toBe('page');
    expect(scope.scopePath).toBe(canonicalPageDir);
  });

  it('classifies a group folder inside `.lerret/` as scope=group', async () => {
    const scope = await resolveScope({ pathArg: groupDir, cwd: workDir });
    expect(scope.found).toBe(true);
    expect(scope.scopeKind).toBe('group');
    expect(scope.scopePath).toBe(canonicalGroupDir);
  });

  it('returns a clear error when no project is in scope', async () => {
    const empty = join(workDir, '..');
    // The parent of our temp workdir is `/tmp` (or similar) — no `.lerret/`
    // anywhere up to the filesystem root.
    const fsParent = await fsp.mkdtemp(join(tmpdir(), 'lerret-export-noproj-'));
    try {
      const scope = await resolveScope({ pathArg: undefined, cwd: fsParent });
      expect(scope.found).toBe(false);
      expect(scope.error).toMatch(/no `\.lerret\/` project found/);
    } finally {
      await fsp.rm(fsParent, { recursive: true, force: true });
      // Silence unused-var warning.
      void empty;
    }
  });

  it('rejects a path inside the project but outside `.lerret/`', async () => {
    const outside = join(projectRoot, 'docs');
    await fsp.mkdir(outside, { recursive: true });
    const scope = await resolveScope({ pathArg: outside, cwd: workDir });
    expect(scope.found).toBe(false);
    expect(scope.error).toMatch(/not the project root nor inside/);
  });

  it('rejects a folder name that is not a page or group in the model', async () => {
    // A folder inside `.lerret/` that the loader excludes (its name starts
    // with `_`, like `_fonts/`) is not a valid scope.
    const excluded = join(lerretDir, '_fonts');
    await fsp.mkdir(excluded, { recursive: true });
    const scope = await resolveScope({ pathArg: excluded, cwd: workDir });
    expect(scope.found).toBe(false);
    expect(scope.error).toMatch(/does not match any page or group/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) buildBaseFilename / buildOutputPath — naming + layout
// ─────────────────────────────────────────────────────────────────────────────

describe('buildBaseFilename', () => {
  it('builds <name>.<ext> for a primary artboard', () => {
    const artboard = { asset: { name: 'HeroBanner' } };
    expect(buildBaseFilename(artboard, 'png')).toBe('HeroBanner.png');
  });

  it('appends -<variant> for a non-primary variant', () => {
    const artboard = { asset: { name: 'BadgeVariants' }, variantName: 'Ghost' };
    expect(buildBaseFilename(artboard, 'png')).toBe('BadgeVariants-Ghost.png');
  });

  it('omits the variant suffix when the variant is "default"', () => {
    const artboard = { asset: { name: 'Card' }, variantName: 'default' };
    expect(buildBaseFilename(artboard, 'jpg')).toBe('Card.jpg');
  });

  it('strips illegal filesystem characters', () => {
    const artboard = { asset: { name: 'Bad/Name:With*Stars' } };
    expect(buildBaseFilename(artboard, 'png')).toBe('BadNameWithStars.png');
  });
});

describe('buildOutputPath', () => {
  const outDir = '/tmp/export';

  it('writes top-level assets directly under outDir (structured)', () => {
    const artboard = { locationSegments: [] };
    expect(buildOutputPath({ outDir, artboard, filename: 'A.png', flat: false }))
      .toBe('/tmp/export/A.png');
  });

  it('mirrors location segments as nested folders (structured)', () => {
    const artboard = { locationSegments: ['ui', 'buttons'] };
    expect(buildOutputPath({ outDir, artboard, filename: 'Primary.png', flat: false }))
      .toBe('/tmp/export/ui/buttons/Primary.png');
  });

  it('writes everything to outDir when flat=true (no collision)', () => {
    const artboard = { locationSegments: ['ui', 'buttons'] };
    expect(buildOutputPath({
      outDir, artboard, filename: 'Primary.png', flat: true, nameCount: 1,
    })).toBe('/tmp/export/Primary.png');
  });

  it('prefixes location segments with `-` on flat-mode name collisions', () => {
    const artboard = { locationSegments: ['ui', 'buttons'] };
    expect(buildOutputPath({
      outDir, artboard, filename: 'Primary.png', flat: true, nameCount: 2,
    })).toBe('/tmp/export/ui-buttons-Primary.png');
  });

  it('flat-mode top-level asset uses bare filename even on collisions', () => {
    const artboard = { locationSegments: [] };
    expect(buildOutputPath({
      outDir, artboard, filename: 'Primary.png', flat: true, nameCount: 5,
    })).toBe('/tmp/export/Primary.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) findModelNode + expandArtboardVariants
// ─────────────────────────────────────────────────────────────────────────────

describe('findModelNode', () => {
  const model = {
    pages: [
      {
        path: '/proj/.lerret/page-a',
        groups: [
          {
            path: '/proj/.lerret/page-a/g1',
            groups: [{ path: '/proj/.lerret/page-a/g1/g2', groups: [], assets: [] }],
            assets: [],
          },
        ],
        assets: [],
      },
    ],
  };

  it('finds a page by path', () => {
    expect(findModelNode(model, '/proj/.lerret/page-a')).toEqual({ kind: 'page' });
  });

  it('finds a top-level group by path', () => {
    expect(findModelNode(model, '/proj/.lerret/page-a/g1')).toEqual({ kind: 'group' });
  });

  it('finds a nested group by path', () => {
    expect(findModelNode(model, '/proj/.lerret/page-a/g1/g2')).toEqual({ kind: 'group' });
  });

  it('returns null for a non-existent path', () => {
    expect(findModelNode(model, '/proj/.lerret/page-b')).toBeNull();
  });
});

describe('expandArtboardVariants', () => {
  function asset(name, variants) {
    return {
      asset: {
        path: `/proj/.lerret/page/${name}.jsx`,
        name,
        meta: variants ? { variants } : undefined,
      },
      locationSegments: [],
    };
  }

  it('emits one record for an asset with no variants', () => {
    const out = expandArtboardVariants([asset('Hero')]);
    expect(out).toHaveLength(1);
    expect(out[0].domId).toBe('/proj/.lerret/page/Hero.jsx');
    expect(out[0].variantName).toBeUndefined();
  });

  it('emits one record for an asset whose only variant is "default"', () => {
    const out = expandArtboardVariants([asset('Hero', ['default'])]);
    expect(out).toHaveLength(1);
    expect(out[0].domId).toBe('/proj/.lerret/page/Hero.jsx');
    expect(out[0].variantName).toBeUndefined();
  });

  it('emits one record per variant for multi-variant assets', () => {
    const out = expandArtboardVariants([asset('Badge', ['default', 'Ghost', 'Solid'])]);
    expect(out).toHaveLength(3);
    expect(out[0].domId).toBe('/proj/.lerret/page/Badge.jsx');
    expect(out[0].variantName).toBeUndefined();
    expect(out[1].domId).toBe('/proj/.lerret/page/Badge.jsx#Ghost');
    expect(out[1].variantName).toBe('Ghost');
    expect(out[2].domId).toBe('/proj/.lerret/page/Badge.jsx#Solid');
    expect(out[2].variantName).toBe('Solid');
  });

  it('accepts variants given as `{ name }` objects', () => {
    const out = expandArtboardVariants([asset('Badge', [{ name: 'Ghost' }, { name: 'Solid' }])]);
    expect(out.map((r) => r.domId)).toEqual([
      '/proj/.lerret/page/Badge.jsx#Ghost',
      '/proj/.lerret/page/Badge.jsx#Solid',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ARTBOARD_SELECTORS — the contract with the studio's DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('ARTBOARD_SELECTORS', () => {
  it('builds a quoted attribute selector for the data-dc-slot id', () => {
    expect(ARTBOARD_SELECTORS.slotByDataAttr('/proj/Hero.jsx'))
      .toBe('[data-dc-slot="/proj/Hero.jsx"]');
  });

  it('escapes a hash in a variant id', () => {
    // JSON.stringify keeps the hash; the selector quoting is handled by
    // wrapping in `"…"` which is valid CSS3 attribute-value syntax.
    expect(ARTBOARD_SELECTORS.slotByDataAttr('/proj/Hero.jsx#Ghost'))
      .toBe('[data-dc-slot="/proj/Hero.jsx#Ghost"]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) loadOverrideFile / loadOverrideFiles
// ─────────────────────────────────────────────────────────────────────────────

describe('loadOverrideFile', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-override-test-'));
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('loads a valid JSON file and returns its object', async () => {
    const filePath = join(workDir, 'data.json');
    await fsp.writeFile(filePath, JSON.stringify({ title: 'Override', count: 5 }), 'utf-8');
    const result = await loadOverrideFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ title: 'Override', count: 5 });
  });

  it('fails with a clear message when the JSON file does not exist', async () => {
    const filePath = join(workDir, 'missing.json');
    const result = await loadOverrideFile(filePath);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing\.json/);
    expect(result.error).toMatch(/not found or unreadable/);
  });

  it('fails with a clear parse-error message for malformed JSON', async () => {
    const filePath = join(workDir, 'bad.json');
    await fsp.writeFile(filePath, '{ broken json', 'utf-8');
    const result = await loadOverrideFile(filePath);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bad\.json/);
    expect(result.error).toMatch(/invalid JSON/);
  });

  it('fails when the JSON top-level is an array (not an object)', async () => {
    const filePath = join(workDir, 'array.json');
    await fsp.writeFile(filePath, JSON.stringify([1, 2, 3]), 'utf-8');
    const result = await loadOverrideFile(filePath);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/array\.json/);
    expect(result.error).toMatch(/plain object/);
  });

  it('loads a .js module file via dynamic import (default export)', async () => {
    const filePath = join(workDir, 'override.mjs');
    // Write a valid ES module with a default export object.
    await fsp.writeFile(
      filePath,
      'export default { brand: "Lerret", version: 2 };\n',
      'utf-8',
    );
    const result = await loadOverrideFile(filePath);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ brand: 'Lerret', version: 2 });
  });
});

describe('loadOverrideFiles', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-override-files-test-'));
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('returns empty overrides when neither flag is supplied', async () => {
    const result = await loadOverrideFiles({ dataPath: undefined, configPath: undefined, cwd: workDir });
    expect(result.ok).toBe(true);
    expect(result.overrides.dataOverride).toBeUndefined();
    expect(result.overrides.configOverride).toBeUndefined();
  });

  it('loads --data and --config independently', async () => {
    const dataFile = join(workDir, 'data.json');
    const cfgFile = join(workDir, 'config.json');
    await fsp.writeFile(dataFile, JSON.stringify({ label: 'Test' }), 'utf-8');
    await fsp.writeFile(cfgFile, JSON.stringify({ theme: 'dark' }), 'utf-8');

    const result = await loadOverrideFiles({
      dataPath: 'data.json',
      configPath: 'config.json',
      cwd: workDir,
    });
    expect(result.ok).toBe(true);
    expect(result.overrides.dataOverride).toEqual({ label: 'Test' });
    expect(result.overrides.configOverride).toEqual({ theme: 'dark' });
  });

  it('fails fast on the first bad file (missing --data)', async () => {
    const result = await loadOverrideFiles({
      dataPath: 'nonexistent.json',
      configPath: undefined,
      cwd: workDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nonexistent\.json/);
  });

  it('fails fast on the first bad file (malformed --config)', async () => {
    const cfgFile = join(workDir, 'bad-cfg.json');
    await fsp.writeFile(cfgFile, 'not json', 'utf-8');
    const result = await loadOverrideFiles({
      dataPath: undefined,
      configPath: 'bad-cfg.json',
      cwd: workDir,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/bad-cfg\.json/);
    expect(result.error).toMatch(/invalid JSON/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) runExport — orchestration with all deps mocked
// ─────────────────────────────────────────────────────────────────────────────

describe('runExport — orchestration', () => {
  let workDir;
  let projectRoot;
  let lerretDir;
  let outDir;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-export-orch-'));
    projectRoot = workDir;
    lerretDir = join(projectRoot, LERRET_DIR_NAME);
    outDir = join(workDir, 'out');
    // Two assets across two groups so the orchestration loop runs ≥ 2x
    // and so we can check structured-vs-flat naming.
    const pageDir = join(lerretDir, 'ui');
    const g1 = join(pageDir, 'buttons');
    const g2 = join(pageDir, 'cards');
    await fsp.mkdir(g1, { recursive: true });
    await fsp.mkdir(g2, { recursive: true });
    await fsp.writeFile(
      join(g1, 'Primary.jsx'),
      "export default function Primary() { return null; }\n",
      'utf-8',
    );
    await fsp.writeFile(
      join(g2, 'Card.jsx'),
      "export default function Card() { return null; }\n",
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  /**
   * Build a dep-bundle that simulates a successful headless run end-to-end
   * without ever touching Vite or Playwright. The `captureInPage` mock can
   * be customized per test to inject failures.
   */
  function makeDeps({ capture, writeBinary } = {}) {
    /** @type {Array<{ path: string, bytes: Uint8Array }>} */
    const written = [];
    return {
      written,
      deps: {
        getCwd: () => projectRoot,
        bootServer: vi.fn(async () => ({
          server: { close: vi.fn(async () => {}) },
          url: 'http://127.0.0.1:0',
        })),
        launchBrowser: vi.fn(async () => ({
          browser: {
            newContext: async () => ({
              newPage: async () => ({
                goto: vi.fn(async () => {}),
                waitForSelector: vi.fn(async () => {}),
              }),
            }),
            close: vi.fn(async () => {}),
          },
          launchedVia: 'mock browser',
        })),
        captureInPage: capture
          || vi.fn(async (_page, _domId, _format) => ({
            ok: true,
            // Two-byte "PNG signature-ish" placeholder; the writer never
            // interprets the bytes — it just persists them.
            bytesB64: Buffer.from([0x89, 0x50]).toString('base64'),
            unembeddedFonts: [],
          })),
        writeBinary: writeBinary
          || vi.fn(async (path, bytes) => {
            written.push({ path, bytes });
          }),
        ensureDir: vi.fn(async () => {}),
      },
    };
  }

  it('writes one file per artboard on a happy path and exits 0', async () => {
    const { deps, written } = makeDeps();
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let code;
    try {
      code = await runExport(['--out', outDir], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(written).toHaveLength(2);
    // Structured layout: nested folders. The two assets live in `ui/buttons/`
    // and `ui/cards/` respectively.
    const paths = written.map((w) => w.path).sort();
    expect(paths[0]).toMatch(/\/out\/buttons\/Primary\.png$/);
    expect(paths[1]).toMatch(/\/out\/cards\/Card\.png$/);
  });

  it('writes a flat layout when --flat is passed', async () => {
    const { deps, written } = makeDeps();
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let code;
    try {
      code = await runExport(['--out', outDir, '--flat'], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    const paths = written.map((w) => w.path).sort();
    // Flat: both files directly under outDir, with distinct base names so no
    // disambiguation prefix.
    expect(paths[0]).toMatch(/\/out\/Card\.png$/);
    expect(paths[1]).toMatch(/\/out\/Primary\.png$/);
  });

  it('continues past a per-artboard capture failure and reports it', async () => {
    let call = 0;
    const capture = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: false, error: 'simulated capture crash' };
      return {
        ok: true,
        bytesB64: Buffer.from([0x89]).toString('base64'),
        unembeddedFonts: [],
      };
    });
    const { deps, written } = makeDeps({ capture });

    const errChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errChunks.push(String(s));
      return true;
    });

    let code;
    try {
      code = await runExport(['--out', outDir], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    // 0 because one artboard still wrote (failure isolation, NFR8 / AC).
    expect(code).toBe(0);
    expect(written).toHaveLength(1);
    expect(errChunks.join('')).toMatch(/simulated capture crash/);
  });

  it('exits 1 when no project is found', async () => {
    const fsParent = await fsp.mkdtemp(join(tmpdir(), 'lerret-export-noproj-'));
    try {
      const { deps } = makeDeps();
      // Override cwd to a directory without any `.lerret/` ancestor.
      deps.getCwd = () => fsParent;

      const errChunks = [];
      const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
        errChunks.push(String(s));
        return true;
      });

      let code;
      try {
        code = await runExport(['--out', outDir], deps);
      } finally {
        outSpy.mockRestore();
        errSpy.mockRestore();
      }

      expect(code).toBe(1);
      expect(errChunks.join('')).toMatch(/no `\.lerret\/` project found/);
    } finally {
      await fsp.rm(fsParent, { recursive: true, force: true });
    }
  });

  it('exits 1 and refuses when --out is inside `.lerret/` (NFR13)', async () => {
    const { deps } = makeDeps();
    const errChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errChunks.push(String(s));
      return true;
    });

    let code;
    try {
      code = await runExport(['--out', join(lerretDir, 'export-here')], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(1);
    expect(errChunks.join('')).toMatch(/refusing to write into the project's `\.lerret\/`/);
  });

  it('exits 1 when the browser cannot be launched', async () => {
    const { deps } = makeDeps();
    deps.launchBrowser = vi.fn(async () => {
      throw new Error('Could not launch a headless Chromium for the export run.');
    });

    const errChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errChunks.push(String(s));
      return true;
    });

    let code;
    try {
      code = await runExport(['--out', outDir], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(1);
    expect(errChunks.join('')).toMatch(/Could not launch a headless Chromium/);
  });

  it('reports --help and exits 0 without booting anything', async () => {
    const outChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      outChunks.push(String(s));
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const bootServer = vi.fn();
    const launchBrowser = vi.fn();

    let code;
    try {
      code = await runExport(['--help'], { bootServer, launchBrowser, getCwd: () => projectRoot });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(bootServer).not.toHaveBeenCalled();
    expect(launchBrowser).not.toHaveBeenCalled();
    expect(outChunks.join('')).toMatch(/@lerret\/cli export/);
    expect(outChunks.join('')).toMatch(/--format/);
    expect(outChunks.join('')).toMatch(/--out/);
    expect(outChunks.join('')).toMatch(/--flat/);
  });

  it('exits 1 on an unknown flag', async () => {
    const errChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errChunks.push(String(s));
      return true;
    });

    let code;
    try {
      code = await runExport(['--bogus'], { getCwd: () => projectRoot });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(1);
    expect(errChunks.join('')).toMatch(/@lerret\/cli export/);
  });

  // ── Override integration tests ─────────────────────────────────────────────

  it('forwards dataOverride and configOverride to bootServer when both are supplied', async () => {
    const dataOverride = { hero: 'CI Release' };
    const configOverride = { theme: 'dark' };

    // Inject a loadOverrides stub that returns our fixtures without touching disk.
    const loadOverrides = vi.fn(async () => ({
      ok: true,
      overrides: { dataOverride, configOverride },
    }));

    const { deps } = makeDeps();
    const bootServerSpy = vi.fn(async () => ({
      server: { close: vi.fn(async () => {}) },
      url: 'http://127.0.0.1:0',
    }));
    deps.bootServer = bootServerSpy;
    deps.loadOverrides = loadOverrides;

    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let code;
    try {
      code = await runExport(['--out', outDir, '--data', 'd.json', '--config', 'c.json'], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(loadOverrides).toHaveBeenCalledWith(
      expect.objectContaining({ dataPath: 'd.json', configPath: 'c.json' }),
    );
    // Confirm overrides were forwarded to bootServer.
    expect(bootServerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dataOverride, configOverride }),
    );
  });

  it('(4.8-g) exits 1 before booting Vite when override loading fails', async () => {
    const loadOverrides = vi.fn(async () => ({
      ok: false,
      error: 'override file "/path/bad.json" not found or unreadable: ENOENT',
    }));

    const { deps } = makeDeps();
    const bootServerSpy = vi.fn();
    deps.bootServer = bootServerSpy;
    deps.loadOverrides = loadOverrides;

    const errChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
      errChunks.push(String(s));
      return true;
    });

    let code;
    try {
      code = await runExport(['--out', outDir, '--data', 'bad.json'], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(1);
    expect(bootServerSpy).not.toHaveBeenCalled(); // Vite never started
    expect(errChunks.join('')).toMatch(/bad\.json/);
  });

  it('(4.8-g) exports normally when neither --data nor --config is supplied (no regression)', async () => {
    const loadOverrides = vi.fn(async () => ({
      ok: true,
      overrides: { dataOverride: undefined, configOverride: undefined },
    }));

    const { deps, written } = makeDeps();
    deps.loadOverrides = loadOverrides;

    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let code;
    try {
      code = await runExport(['--out', outDir], deps);
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    expect(written).toHaveLength(2);
  });

  it('(4.8-g) --help mentions --data and --config in usage output', async () => {
    const outChunks = [];
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      outChunks.push(String(s));
      return true;
    });
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    let code;
    try {
      code = await runExport(['--help'], { getCwd: () => projectRoot });
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
    }

    expect(code).toBe(0);
    const helpText = outChunks.join('');
    expect(helpText).toMatch(/--data/);
    expect(helpText).toMatch(/--config/);
  });
});
