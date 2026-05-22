// Tests for `@lerret/cli clear`.
//
// Coverage:
//   (a) parseClearArgs — flag types, mutual exclusion of --all with positionals,
//       unknown flags, help short-circuit.
//   (b) resolvePositionalTarget — relative + absolute paths, containment check
//       (must be inside `.lerret/`), protected-path refusal (config.json,
//       _fonts/), refusal to delete `.lerret/` itself, missing target.
//   (c) resolveAllTargets — enumerates non-protected children of `.lerret/`.
//   (d) runClear orchestration — happy paths via dependency injection
//       (no real fs writes), cancellation, dry-run, --yes bypass, error paths.
//
// Real-fs test projects use `tmpdir()` + `realpathSync()` so macOS `/tmp` →
// `/private/tmp` doesn't poison the containment check.

import { promises as fsp, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  parseClearArgs,
  promptYesNo,
  resolveAllTargets,
  resolvePositionalTarget,
  runClear,
} from './clear.js';
import { createNodeBackend } from './fs/node-backend.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a temp project with `.lerret/<children>`. Returns the canonical
 * project root + lerret dir + a cleanup hook.
 *
 * `children` is a record of names → contents. A string value writes a file;
 * an object value creates a directory and recurses.
 */
async function makeProject(children = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lerret-clear-test-')));
  const lerretDir = join(root, '.lerret');
  await fsp.mkdir(lerretDir, { recursive: true });
  await materialize(lerretDir, children);
  return {
    projectRoot: root.replaceAll('\\', '/'),
    lerretDir: lerretDir.replaceAll('\\', '/'),
    cleanup: () => fsp.rm(root, { recursive: true, force: true }),
  };
}

async function materialize(dirPath, children) {
  for (const [name, value] of Object.entries(children)) {
    const full = join(dirPath, name);
    if (typeof value === 'string') {
      await fsp.writeFile(full, value);
    } else {
      await fsp.mkdir(full, { recursive: true });
      await materialize(full, value);
    }
  }
}

/**
 * Capture stdout/stderr writes for one runClear call. Takes a thunk (not a
 * promise) so the spies are installed BEFORE runClear starts — passing a
 * pre-started promise would let the synchronous portion (e.g. `printUsage`)
 * write to the real streams before any interception.
 *
 * @param {() => Promise<number>} thunk
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function captureRun(thunk) {
  let stdout = '';
  let stderr = '';
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    stdout += String(s);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderr += String(s);
    return true;
  });
  try {
    const code = await thunk();
    return { code, stdout, stderr };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) parseClearArgs
// ─────────────────────────────────────────────────────────────────────────────

describe('parseClearArgs', () => {
  it('returns empty-paths + all defaults false on no input', () => {
    const { flags, error } = parseClearArgs([]);
    expect(error).toBeNull();
    expect(flags).toEqual({
      paths: [],
      all: false,
      yes: false,
      dryRun: false,
      help: false,
    });
  });

  it('parses positional paths', () => {
    const { flags, error } = parseClearArgs(['social', 'brand/Logo.jsx']);
    expect(error).toBeNull();
    expect(flags.paths).toEqual(['social', 'brand/Logo.jsx']);
  });

  it('parses --all', () => {
    expect(parseClearArgs(['--all']).flags.all).toBe(true);
  });

  it('parses --yes and --dry-run as booleans', () => {
    const { flags } = parseClearArgs(['--all', '--yes', '--dry-run']);
    expect(flags.yes).toBe(true);
    expect(flags.dryRun).toBe(true);
  });

  it('parses -h / --help', () => {
    expect(parseClearArgs(['-h']).flags.help).toBe(true);
    expect(parseClearArgs(['--help']).flags.help).toBe(true);
  });

  it('rejects --all combined with positional paths (mutually exclusive)', () => {
    const { flags, error } = parseClearArgs(['--all', 'social']);
    expect(flags).toBeNull();
    expect(error).toMatch(/mutually exclusive/);
  });

  it('rejects unknown flags', () => {
    const { flags, error } = parseClearArgs(['--bogus']);
    expect(flags).toBeNull();
    expect(error).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) resolvePositionalTarget
// ─────────────────────────────────────────────────────────────────────────────

describe('resolvePositionalTarget', () => {
  let ctx;
  beforeEach(async () => {
    ctx = await makeProject({
      'config.json': '{ "vars": {} }',
      _fonts: { 'Sample.woff2': 'binary' },
      social: {
        'twitter-banner.jsx': 'export default function B() {}',
        'twitter-banner.data.json': '{}',
      },
      brand: { 'Logo.jsx': 'export default function L() {}' },
    });
  });
  afterEach(async () => { await ctx.cleanup(); });

  it('accepts a relative path that resolves inside .lerret/', () => {
    const res = resolvePositionalTarget('social', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(true);
    expect(res.target.displayPath).toBe('social');
    expect(res.target.kind).toBe('directory');
  });

  it('accepts a path with .lerret/ prefix', () => {
    const res = resolvePositionalTarget('.lerret/brand', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(true);
    expect(res.target.displayPath).toBe('brand');
  });

  it('accepts an absolute path inside .lerret/', () => {
    const res = resolvePositionalTarget(join(ctx.lerretDir, 'social'), {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(true);
    expect(res.target.displayPath).toBe('social');
  });

  it('classifies files by extension heuristic', () => {
    const res = resolvePositionalTarget('social/twitter-banner.jsx', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(true);
    expect(res.target.kind).toBe('file');
  });

  it('rejects a path outside .lerret/', () => {
    const res = resolvePositionalTarget('../other', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/outside/);
  });

  it('rejects the .lerret/ directory itself (via .lerret/ prefix or absolute)', () => {
    // `.lerret/` is the explicit-relative form — resolves to the project's
    // .lerret/. Bare `.lerret` would be treated as a child of .lerret/ which
    // is a separate (defensive) "does not exist" path.
    const res = resolvePositionalTarget('.lerret/', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/refusing to remove the project root/);

    const absRes = resolvePositionalTarget(ctx.lerretDir, {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(absRes.ok).toBe(false);
    expect(absRes.error).toMatch(/refusing to remove the project root/);
  });

  it('rejects .lerret/config.json (protected)', () => {
    const res = resolvePositionalTarget('.lerret/config.json', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/protected/);
  });

  it('rejects .lerret/_fonts/ (protected)', () => {
    const res = resolvePositionalTarget('.lerret/_fonts', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/protected/);
  });

  it('rejects a path inside _fonts/ recursively (protected)', () => {
    const res = resolvePositionalTarget('.lerret/_fonts/Sample.woff2', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/protected/);
  });

  it('rejects a non-existent target', () => {
    const res = resolvePositionalTarget('does-not-exist', {
      cwd: ctx.projectRoot,
      lerretDir: ctx.lerretDir,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not exist/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) resolveAllTargets
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveAllTargets', () => {
  it('returns every immediate child of .lerret/ except config.json and _fonts/', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      _fonts: { 'Sample.woff2': 'b' },
      social: { 'a.jsx': 'export default () => null' },
      brand: { 'Logo.jsx': 'export default () => null' },
      'README.md': '# notes',
    });
    try {
      const targets = await resolveAllTargets({
        fs: createNodeBackend(),
        lerretDir: ctx.lerretDir,
      });
      const names = targets.map((t) => t.displayPath).sort();
      expect(names).toEqual(['README.md', 'brand', 'social']);
      const readme = targets.find((t) => t.displayPath === 'README.md');
      expect(readme.kind).toBe('file');
      const social = targets.find((t) => t.displayPath === 'social');
      expect(social.kind).toBe('directory');
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns an empty list when .lerret/ has only protected children', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      _fonts: { 'F.woff2': 'b' },
    });
    try {
      const targets = await resolveAllTargets({
        fs: createNodeBackend(),
        lerretDir: ctx.lerretDir,
      });
      expect(targets).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) runClear orchestration
// ─────────────────────────────────────────────────────────────────────────────

describe('runClear', () => {
  it('exits 0 on --help and prints usage', async () => {
    const { code, stdout } = await captureRun(() => runClear(['--help']));
    expect(code).toBe(0);
    expect(stdout).toMatch(/@lerret\/cli clear/);
  });

  it('exits 1 when no paths and no --all', async () => {
    const ctx = await makeProject({ 'config.json': '{}', social: {} });
    try {
      const { code, stderr } = await captureRun(() =>
        runClear([], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/pass one or more paths to remove, or --all/);
    } finally { await ctx.cleanup(); }
  });

  it('exits 1 when no project found', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'lerret-clear-noproj-')));
    try {
      const { code, stderr } = await captureRun(() =>
        runClear(['--all'], { getCwd: () => empty }),
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/no `\.lerret\/` project found/);
    } finally { await fsp.rm(empty, { recursive: true, force: true }); }
  });

  it('removes a positional target with --yes (no prompt)', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      social: { 'a.jsx': 'export default () => null' },
    });
    try {
      const { code, stdout } = await captureRun(() =>
        runClear(['social', '--yes'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/removed 1 item/);
      // social/ is gone; config.json survives.
      await expect(fsp.access(join(ctx.lerretDir, 'social'))).rejects.toBeTruthy();
      await expect(fsp.access(join(ctx.lerretDir, 'config.json'))).resolves.toBeUndefined();
    } finally { await ctx.cleanup(); }
  });

  it('--all removes everything except config.json and _fonts/', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      _fonts: { 'F.woff2': 'b' },
      social: { 'a.jsx': 'x' },
      brand: { 'b.jsx': 'x' },
      'README.md': '# notes',
    });
    try {
      const { code, stdout } = await captureRun(() =>
        runClear(['--all', '--yes'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/removed 3 items/);
      const remaining = (await fsp.readdir(ctx.lerretDir)).sort();
      expect(remaining).toEqual(['_fonts', 'config.json']);
    } finally { await ctx.cleanup(); }
  });

  it('--dry-run prints plan and removes nothing', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      social: { 'a.jsx': 'x' },
    });
    try {
      const { code, stdout } = await captureRun(() =>
        runClear(['--all', '--dry-run'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/dry run/);
      expect(stdout).toMatch(/social/);
      // social/ untouched.
      await expect(fsp.access(join(ctx.lerretDir, 'social'))).resolves.toBeUndefined();
    } finally { await ctx.cleanup(); }
  });

  it('cancels and exits 1 when the user answers no (confirm injected)', async () => {
    const ctx = await makeProject({ 'config.json': '{}', social: { 'a.jsx': 'x' } });
    try {
      const { code, stdout } = await captureRun(() =>
        runClear(['social'], {
          getCwd: () => ctx.projectRoot,
          confirm: async () => false,
        }),
      );
      expect(code).toBe(1);
      expect(stdout).toMatch(/cancelled/);
      // social/ untouched.
      await expect(fsp.access(join(ctx.lerretDir, 'social'))).resolves.toBeUndefined();
    } finally { await ctx.cleanup(); }
  });

  it('exits 1 when a positional path is outside .lerret/', async () => {
    const ctx = await makeProject({ 'config.json': '{}' });
    try {
      const { code, stderr } = await captureRun(() =>
        runClear(['../escape', '--yes'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/outside/);
    } finally { await ctx.cleanup(); }
  });

  it('exits 1 when a positional path hits a protected leaf', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      _fonts: { 'F.woff2': 'b' },
    });
    try {
      const { code, stderr } = await captureRun(() =>
        runClear(['.lerret/_fonts', '--yes'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/protected/);
      // _fonts/ untouched.
      await expect(fsp.access(join(ctx.lerretDir, '_fonts'))).resolves.toBeUndefined();
    } finally { await ctx.cleanup(); }
  });

  it('exits 1 when removal throws (deps.remove injected to fail)', async () => {
    const ctx = await makeProject({ 'config.json': '{}', social: { 'a.jsx': 'x' } });
    try {
      const { code, stderr } = await captureRun(() =>
        runClear(['social', '--yes'], {
          getCwd: () => ctx.projectRoot,
          remove: async () => { throw new Error('boom'); },
        }),
      );
      expect(code).toBe(1);
      expect(stderr).toMatch(/failed to remove/);
      expect(stderr).toMatch(/boom/);
    } finally { await ctx.cleanup(); }
  });

  it('exits 0 with "nothing to remove" when --all and only protected children remain', async () => {
    const ctx = await makeProject({
      'config.json': '{}',
      _fonts: { 'F.woff2': 'b' },
    });
    try {
      const { code, stdout } = await captureRun(() =>
        runClear(['--all', '--yes'], { getCwd: () => ctx.projectRoot }),
      );
      expect(code).toBe(0);
      expect(stdout).toMatch(/nothing to remove/);
    } finally { await ctx.cleanup(); }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// promptYesNo — non-TTY path
// ─────────────────────────────────────────────────────────────────────────────

describe('promptYesNo', () => {
  it('returns false (and explains) when stdin is not a TTY', async () => {
    let captured = '';
    const fakeOut = { write: (s) => { captured += s; return true; } };
    const result = await promptYesNo('Proceed?', {
      input: process.stdin,
      output: fakeOut,
      isTty: false,
    });
    expect(result).toBe(false);
    expect(captured).toMatch(/Cannot prompt in a non-TTY/);
    expect(captured).toMatch(/--yes to proceed/);
  });
});
