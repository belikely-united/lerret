// Tests for the `create-lerret` scaffolder.
//
// Covers:
//   - Successful scaffold to a temp directory (files match template exactly)
//   - Missing <name> arg → usage message + non-zero exit
//   - Invalid project names ('.', '..', 'foo/bar', empty) → clear error + non-zero exit
//   - `--no-samples` flag: creates only .lerret/config.json (no _fonts/, no social/)
//   - `--no-samples` works in any position relative to the project name
//   - Default (no flag) still copies the full sample template (regression)
//   - Unknown flag triggers a usage message + non-zero exit
//   - Success output message format
//   Existing-target and filesystem error conditions:
//   - Non-empty target dir → refusal, exit 1, original files untouched
//   - Empty target dir → proceeds to populate (choice A)
//   - Target is an existing file → refusal, exit 1
//   - Parent dir doesn't exist → clear error, exit 1
//   - Unwritable parent (mocked EACCES) → clear error, exit 1
//   - Mid-copy failure (mocked fsp.cp) → cleanup, exit 1, dest removed

import { promises as fsp } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Used in tests that need to peek at fs internals without real chmod.
import * as nodeFs from 'node:fs';

import { main } from './create-lerret.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATE_LERRET = join(PACKAGE_ROOT, 'template', '.lerret');

/**
 * Collect all file paths under a directory, relative to that directory.
 * Returns a sorted array of forward-slash strings.
 *
 * @param {string} dir  Absolute path to the root to walk.
 * @param {string} [prefix]  Internal recursion prefix; leave empty on first call.
 * @returns {Promise<string[]>}
 */
async function collectRelativePaths(dir, prefix = '') {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  /** @type {string[]} */
  const paths = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await collectRelativePaths(join(dir, entry.name), rel);
      paths.push(...children);
    } else {
      paths.push(rel);
    }
  }
  return paths.sort();
}

/**
 * Run `main(argv)` with process.stdout / process.stderr captured.
 *
 * @param {string[]} argv
 * @param {{ cwd?: string }} [opts]  Override process.cwd() for the call.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runMain(argv, { cwd } = {}) {
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
  const cwdSpy = cwd
    ? vi.spyOn(process, 'cwd').mockReturnValue(cwd)
    : null;
  try {
    const code = await main(argv);
    return { code, stdout, stderr };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    cwdSpy?.mockRestore();
  }
}

// ---------------------------------------------------------------------------
// Test state — a fresh temp directory per test
// ---------------------------------------------------------------------------

let tmpDir = '';

beforeEach(async () => {
  tmpDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-scaffold-test-'));
});

afterEach(async () => {
  await fsp.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Successful scaffold
// ---------------------------------------------------------------------------

describe('successful scaffold', () => {
  it('creates the project directory and .lerret/ under it', async () => {
    const { code } = await runMain(['my-project'], { cwd: tmpDir });
    expect(code).toBe(0);

    const projectDir = join(tmpDir, 'my-project');
    const lerretDir = join(projectDir, '.lerret');

    // Both directories must now exist.
    const stat = await fsp.stat(lerretDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('copies template files verbatim — destination matches template exactly', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const dest = join(tmpDir, 'my-project', '.lerret');
    const [templateFiles, copiedFiles] = await Promise.all([
      collectRelativePaths(TEMPLATE_LERRET),
      collectRelativePaths(dest),
    ]);

    // Same set of relative paths.
    expect(copiedFiles).toEqual(templateFiles);

    // Same file content for each path.
    for (const relPath of templateFiles) {
      const [templateBytes, copiedBytes] = await Promise.all([
        fsp.readFile(join(TEMPLATE_LERRET, relPath)),
        fsp.readFile(join(dest, relPath)),
      ]);
      expect(Buffer.compare(templateBytes, copiedBytes)).toBe(0);
    }
  });

  it('prints the success message containing the project name and next steps', async () => {
    const { stdout } = await runMain(['cool-brand'], { cwd: tmpDir });

    expect(stdout).toMatch(/cool-brand\/.lerret\//);
    expect(stdout).toMatch(/cd cool-brand/);
    expect(stdout).toMatch(/npx @lerret\/cli dev/);
  });

  it('success message contains the checkmark prefix', async () => {
    const { stdout } = await runMain(['alpha'], { cwd: tmpDir });
    // The success line starts with the Unicode check mark.
    expect(stdout).toMatch(/^✓/m);
  });
});

// ---------------------------------------------------------------------------
// Missing <name> argument
// ---------------------------------------------------------------------------

describe('missing <name> argument', () => {
  it('exits with code 1 when no argument is supplied', async () => {
    const { code } = await runMain([], { cwd: tmpDir });
    expect(code).toBe(1);
  });

  it('prints a usage banner to stderr when no argument is supplied', async () => {
    const { stderr, stdout } = await runMain([], { cwd: tmpDir });
    // Usage text should appear somewhere (stderr or stdout).
    const combined = stderr + stdout;
    expect(combined).toMatch(/create-lerret <name>/);
  });

  it('includes a "missing" or usage hint in the error output', async () => {
    const { stderr } = await runMain([], { cwd: tmpDir });
    expect(stderr).toMatch(/missing/i);
  });
});

// ---------------------------------------------------------------------------
// Invalid project names
// ---------------------------------------------------------------------------

describe('invalid project name', () => {
  const invalidCases = [
    { name: '..', label: 'double-dot' },
    { name: '.', label: 'single-dot' },
    { name: 'foo/bar', label: 'forward slash in name' },
    { name: 'foo\\bar', label: 'backslash in name' },
    // Characters illegal on Windows or generally problematic.
    { name: 'my project', label: 'space in name' },
    { name: 'my*project', label: 'asterisk in name' },
  ];

  for (const { name, label } of invalidCases) {
    it(`exits non-zero for "${label}" (${name})`, async () => {
      const { code } = await runMain([name], { cwd: tmpDir });
      expect(code).toBe(1);
    });

    it(`prints a clear error for "${label}" — not a crash`, async () => {
      const { stderr } = await runMain([name], { cwd: tmpDir });
      // Should mention the invalid name or give meaningful context.
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toMatch(/create-lerret:/);
    });
  }

  it('does not create any directory on an invalid name', async () => {
    await runMain(['foo/bar'], { cwd: tmpDir });
    const entries = await fsp.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// --no-samples flag
// ---------------------------------------------------------------------------

describe('--no-samples flag', () => {
  it('exits 0 and creates only .lerret/config.json — no _fonts/, no social/', async () => {
    const { code, stderr } = await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    expect(stderr).not.toMatch(/unknown option/i);
    expect(code).toBe(0);

    const lerretDir = join(tmpDir, 'my-project', '.lerret');
    const files = await collectRelativePaths(lerretDir);
    // Exactly one file — config.json — and nothing else.
    expect(files).toEqual(['config.json']);
  });

  it('config.json is valid JSON with a "vars" object', async () => {
    await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    const configPath = join(tmpDir, 'my-project', '.lerret', 'config.json');
    const raw = await fsp.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('vars');
    expect(typeof parsed.vars).toBe('object');
  });

  it('config.json ends with a trailing newline', async () => {
    await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    const configPath = join(tmpDir, 'my-project', '.lerret', 'config.json');
    const raw = await fsp.readFile(configPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('does not create _fonts/ directory', async () => {
    await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    const projectDir = join(tmpDir, 'my-project', '.lerret');
    const entries = await fsp.readdir(projectDir);
    expect(entries).not.toContain('_fonts');
  });

  it('does not create social/ directory', async () => {
    await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    const projectDir = join(tmpDir, 'my-project', '.lerret');
    const entries = await fsp.readdir(projectDir);
    expect(entries).not.toContain('social');
  });

  it('success message mentions the empty-project nature', async () => {
    const { stdout } = await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    expect(stdout).toMatch(/empty project/i);
  });

  it('success message contains the checkmark prefix and project name', async () => {
    const { stdout } = await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    expect(stdout).toMatch(/^✓/m);
    expect(stdout).toMatch(/my-project\/.lerret\//);
  });

  it('success message includes next-step commands', async () => {
    const { stdout } = await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    expect(stdout).toMatch(/cd my-project/);
    expect(stdout).toMatch(/npx @lerret\/cli dev/);
  });

  it('flag works after the name argument: create-lerret my-project --no-samples', async () => {
    const { code } = await runMain(['my-project-a', '--no-samples'], { cwd: tmpDir });
    expect(code).toBe(0);
    const files = await collectRelativePaths(join(tmpDir, 'my-project-a', '.lerret'));
    expect(files).toEqual(['config.json']);
  });

  it('flag works before the name argument: create-lerret --no-samples my-project', async () => {
    const { code } = await runMain(['--no-samples', 'my-project-b'], { cwd: tmpDir });
    expect(code).toBe(0);
    const files = await collectRelativePaths(join(tmpDir, 'my-project-b', '.lerret'));
    expect(files).toEqual(['config.json']);
  });
});

// ---------------------------------------------------------------------------
// Default behavior regression — full template still copied without --no-samples
// ---------------------------------------------------------------------------

describe('default (no --no-samples flag) regression', () => {
  it('copies the full template tree including social/ and _fonts/', async () => {
    const { code } = await runMain(['full-project'], { cwd: tmpDir });
    expect(code).toBe(0);

    const dest = join(tmpDir, 'full-project', '.lerret');
    const [templateFiles, copiedFiles] = await Promise.all([
      collectRelativePaths(TEMPLATE_LERRET),
      collectRelativePaths(dest),
    ]);
    expect(copiedFiles).toEqual(templateFiles);
  });

  it('full-template success message mentions sample assets (not empty project)', async () => {
    const { stdout } = await runMain(['full-project'], { cwd: tmpDir });
    expect(stdout).toMatch(/sample assets/i);
    expect(stdout).not.toMatch(/empty project/i);
  });
});

// ---------------------------------------------------------------------------
// Unknown / unrecognized flag
// ---------------------------------------------------------------------------

describe('unknown flag', () => {
  it('exits with code 1 on an unrecognized flag', async () => {
    const { code } = await runMain(['my-project', '--unknown-flag'], { cwd: tmpDir });
    expect(code).toBe(1);
  });

  it('prints a usage banner to stderr on an unrecognized flag', async () => {
    const { stderr, stdout } = await runMain(['my-project', '--unknown-flag'], { cwd: tmpDir });
    const combined = stderr + stdout;
    expect(combined).toMatch(/create-lerret <name>/);
  });
});

// ---------------------------------------------------------------------------
// --help flag
// ---------------------------------------------------------------------------

describe('--help flag', () => {
  it('exits 0 and prints usage', async () => {
    const { code, stdout } = await runMain(['--help'], { cwd: tmpDir });
    expect(code).toBe(0);
    expect(stdout).toMatch(/create-lerret <name>/);
  });
});

// ---------------------------------------------------------------------------
// Existing-target and filesystem error conditions
// ---------------------------------------------------------------------------

describe('existing-target safety', () => {
  // ── Non-empty target dir ────────────────────────────────────────────────

  describe('non-empty target directory', () => {
    it('exits 1 and refuses to write', async () => {
      // Pre-create the target with a file in it.
      const targetDir = join(tmpDir, 'existing-project');
      await fsp.mkdir(targetDir);
      await fsp.writeFile(join(targetDir, 'important.txt'), 'keep me\n', 'utf8');

      const { code } = await runMain(['existing-project'], { cwd: tmpDir });
      expect(code).toBe(1);
    });

    it('prints the refusal message mentioning the dir name', async () => {
      const targetDir = join(tmpDir, 'existing-project');
      await fsp.mkdir(targetDir);
      await fsp.writeFile(join(targetDir, 'important.txt'), 'keep me\n', 'utf8');

      const { stderr } = await runMain(['existing-project'], { cwd: tmpDir });
      expect(stderr).toMatch(/existing-project/);
      expect(stderr).toMatch(/already exists and is not empty/i);
    });

    it('leaves the original file untouched', async () => {
      const targetDir = join(tmpDir, 'existing-project');
      await fsp.mkdir(targetDir);
      await fsp.writeFile(join(targetDir, 'important.txt'), 'keep me\n', 'utf8');

      await runMain(['existing-project'], { cwd: tmpDir });

      const content = await fsp.readFile(join(targetDir, 'important.txt'), 'utf8');
      expect(content).toBe('keep me\n');
    });

    it('does not create .lerret/ inside an existing non-empty dir', async () => {
      const targetDir = join(tmpDir, 'existing-project');
      await fsp.mkdir(targetDir);
      await fsp.writeFile(join(targetDir, 'important.txt'), 'keep me\n', 'utf8');

      await runMain(['existing-project'], { cwd: tmpDir });

      const entries = await fsp.readdir(targetDir);
      expect(entries).not.toContain('.lerret');
    });

    it('also refuses for --no-samples when dir is non-empty', async () => {
      const targetDir = join(tmpDir, 'existing-project');
      await fsp.mkdir(targetDir);
      await fsp.writeFile(join(targetDir, 'file.txt'), 'data\n', 'utf8');

      const { code } = await runMain(['existing-project', '--no-samples'], { cwd: tmpDir });
      expect(code).toBe(1);
    });
  });

  // ── Empty target directory — choice A: proceed ──────────────────────────

  describe('empty target directory', () => {
    it('exits 0 and populates the empty dir (choice A: proceed)', async () => {
      // Pre-create an empty dir — simulating a user who `mkdir`-ed first.
      const targetDir = join(tmpDir, 'pre-created');
      await fsp.mkdir(targetDir);

      const { code } = await runMain(['pre-created'], { cwd: tmpDir });
      expect(code).toBe(0);
    });

    it('creates .lerret/ inside the pre-created empty dir', async () => {
      const targetDir = join(tmpDir, 'pre-created');
      await fsp.mkdir(targetDir);

      await runMain(['pre-created'], { cwd: tmpDir });

      const lerretDir = join(targetDir, '.lerret');
      const stat = await fsp.stat(lerretDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('--no-samples also proceeds into an empty dir', async () => {
      const targetDir = join(tmpDir, 'pre-created');
      await fsp.mkdir(targetDir);

      const { code } = await runMain(['pre-created', '--no-samples'], { cwd: tmpDir });
      expect(code).toBe(0);

      const files = await collectRelativePaths(join(targetDir, '.lerret'));
      expect(files).toEqual(['config.json']);
    });
  });

  // ── Target is an existing file ──────────────────────────────────────────

  describe('target path is an existing file', () => {
    it('exits 1 when the target is a file not a directory', async () => {
      // Create a plain file where the project dir would go.
      await fsp.writeFile(join(tmpDir, 'my-file'), 'i am a file\n', 'utf8');

      const { code } = await runMain(['my-file'], { cwd: tmpDir });
      expect(code).toBe(1);
    });

    it('prints a message mentioning "file, not a directory"', async () => {
      await fsp.writeFile(join(tmpDir, 'my-file'), 'i am a file\n', 'utf8');

      const { stderr } = await runMain(['my-file'], { cwd: tmpDir });
      expect(stderr).toMatch(/file, not a directory/i);
    });

    it('does not modify the existing file', async () => {
      await fsp.writeFile(join(tmpDir, 'my-file'), 'i am a file\n', 'utf8');

      await runMain(['my-file'], { cwd: tmpDir });

      const content = await fsp.readFile(join(tmpDir, 'my-file'), 'utf8');
      expect(content).toBe('i am a file\n');
    });
  });

  // ── Parent directory does not exist ────────────────────────────────────

  describe('parent directory does not exist', () => {
    it('exits 1 when cwd is a non-existent directory', async () => {
      // Point cwd at a dir that does not exist so the parent check fires.
      const missingParent = join(tmpDir, 'no-such-dir');

      const { code } = await runMain(['my-project'], { cwd: missingParent });
      expect(code).toBe(1);
    });

    it('prints a message mentioning the missing parent', async () => {
      const missingParent = join(tmpDir, 'no-such-dir');

      const { stderr } = await runMain(['my-project'], { cwd: missingParent });
      // Should mention the parent path in the error message.
      expect(stderr).toMatch(/does not exist/i);
    });
  });

  // ── Unwritable parent (mocked) ──────────────────────────────────────────

  describe('unwritable parent directory', () => {
    it('exits 1 when fsp.access throws EACCES', async () => {
      // Mock `fsp.access` on the `nodeFs` module's `promises` property
      // so the scaffolder's import sees the mock.
      const accessSpy = vi
        .spyOn(nodeFs.promises, 'access')
        .mockImplementation(async (_path, _mode) => {
          const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
          throw err;
        });

      try {
        const { code } = await runMain(['new-project'], { cwd: tmpDir });
        expect(code).toBe(1);
      } finally {
        accessSpy.mockRestore();
      }
    });

    it('prints a message mentioning permission denied', async () => {
      const accessSpy = vi
        .spyOn(nodeFs.promises, 'access')
        .mockImplementation(async (_path, _mode) => {
          const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
          throw err;
        });

      try {
        const { stderr } = await runMain(['new-project'], { cwd: tmpDir });
        expect(stderr).toMatch(/permission denied/i);
      } finally {
        accessSpy.mockRestore();
      }
    });
  });

  // ── Mid-copy failure cleanup ────────────────────────────────────────────

  describe('mid-copy failure', () => {
    it('exits 1 when fsp.cp throws partway through', async () => {
      const cpSpy = vi
        .spyOn(nodeFs.promises, 'cp')
        .mockImplementation(async () => {
          throw new Error('ENOSPC: no space left on device');
        });

      try {
        const { code } = await runMain(['new-project'], { cwd: tmpDir });
        expect(code).toBe(1);
      } finally {
        cpSpy.mockRestore();
      }
    });

    it('cleans up the created dest dir after mid-copy failure', async () => {
      const cpSpy = vi
        .spyOn(nodeFs.promises, 'cp')
        .mockImplementation(async () => {
          throw new Error('ENOSPC: no space left on device');
        });

      try {
        await runMain(['new-project'], { cwd: tmpDir });
      } finally {
        cpSpy.mockRestore();
      }

      // destDir should be gone — no partial project left behind.
      const destDir = join(tmpDir, 'new-project');
      let exists = false;
      try {
        await fsp.stat(destDir);
        exists = true;
      } catch {
        // ENOENT — correct: the dir was cleaned up.
      }
      expect(exists).toBe(false);
    });

    it('prints a message containing the error cause', async () => {
      const cpSpy = vi
        .spyOn(nodeFs.promises, 'cp')
        .mockImplementation(async () => {
          throw new Error('ENOSPC: no space left on device');
        });

      try {
        const { stderr } = await runMain(['new-project'], { cwd: tmpDir });
        expect(stderr).toMatch(/ENOSPC|no space left/i);
      } finally {
        cpSpy.mockRestore();
      }
    });

    it('cleans up only .lerret/ when dest dir already existed (empty-dir case)', async () => {
      // Pre-create empty destDir — simulates the empty-dir proceed path.
      const targetDir = join(tmpDir, 'pre-created');
      await fsp.mkdir(targetDir);

      const cpSpy = vi
        .spyOn(nodeFs.promises, 'cp')
        .mockImplementation(async () => {
          throw new Error('ENOSPC: no space left on device');
        });

      try {
        await runMain(['pre-created'], { cwd: tmpDir });
      } finally {
        cpSpy.mockRestore();
      }

      // destDir (empty) must still exist — we should not have deleted the user's dir.
      const dirStat = await fsp.stat(targetDir);
      expect(dirStat.isDirectory()).toBe(true);

      // .lerret/ inside it must be gone.
      const lerretDir = join(targetDir, '.lerret');
      let lerretExists = false;
      try {
        await fsp.stat(lerretDir);
        lerretExists = true;
      } catch {
        // ENOENT — correct.
      }
      expect(lerretExists).toBe(false);
    });
  });
});
