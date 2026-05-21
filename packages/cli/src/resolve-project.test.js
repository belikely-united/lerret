// Tests for `resolveProject` — project detection / `.lerret/` designation.
//
// Coverage:
//   - a `.lerret/` directly in the start directory,
//   - a `.lerret/` several levels up the ancestry,
//   - no `.lerret/` anywhere (returns a clean not-found result),
//   - the walk stopping at the filesystem root without error.
//
// Fixtures are real on-disk temp directories. Test files are exempt from the
// `fs`-import ban (they stand up fixtures, not shipped subsystems), so this
// file may use `node:fs` directly.

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { resolveProject, LERRET_DIR_NAME } from './resolve-project.js';

/** A fresh scratch directory per test, removed afterwards. @type {string} */
let workDir;

beforeEach(async () => {
  workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-rp-test-'));
});

afterEach(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

/** Convert an OS path to the forward-slash form `resolveProject` returns. */
function asLerretPath(p) {
  return p.replaceAll('\\', '/');
}

describe('resolveProject — `.lerret/` directly in the start directory', () => {
  it('designates the start directory itself as the project root', async () => {
    await fsp.mkdir(join(workDir, LERRET_DIR_NAME));

    const result = await resolveProject(workDir);

    expect(result.found).toBe(true);
    expect(result.projectRoot).toBe(asLerretPath(workDir));
    expect(result.lerretDir).toBe(
      `${asLerretPath(workDir)}/${LERRET_DIR_NAME}`,
    );
  });

  it('returns absolute, forward-slash paths in the success result', async () => {
    await fsp.mkdir(join(workDir, LERRET_DIR_NAME));

    const result = await resolveProject(workDir);

    expect(result.found).toBe(true);
    expect(parse(result.projectRoot).root).not.toBe('');
    expect(result.projectRoot).not.toContain('\\');
    expect(result.lerretDir).not.toContain('\\');
  });
});

describe('resolveProject — `.lerret/` several levels up', () => {
  it('walks up and returns the nearest ancestor that owns `.lerret/`', async () => {
    // Project root has `.lerret/`; start detection three levels deeper.
    await fsp.mkdir(join(workDir, LERRET_DIR_NAME));
    const deep = join(workDir, 'pages', 'marketing', 'hero');
    await fsp.mkdir(deep, { recursive: true });

    const result = await resolveProject(deep);

    expect(result.found).toBe(true);
    expect(result.projectRoot).toBe(asLerretPath(workDir));
    expect(result.lerretDir).toBe(
      `${asLerretPath(workDir)}/${LERRET_DIR_NAME}`,
    );
  });

  it('returns the NEAREST `.lerret/` when ancestors are nested projects', async () => {
    // An outer project and an inner project; detection starts inside the
    // inner one and must stop at the inner — the first match walking up.
    await fsp.mkdir(join(workDir, LERRET_DIR_NAME));
    const inner = join(workDir, 'sub', 'inner-project');
    await fsp.mkdir(join(inner, LERRET_DIR_NAME), { recursive: true });
    const start = join(inner, 'pages', 'home');
    await fsp.mkdir(start, { recursive: true });

    const result = await resolveProject(start);

    expect(result.found).toBe(true);
    expect(result.projectRoot).toBe(asLerretPath(inner));
  });
});

describe('resolveProject — no `.lerret/` anywhere', () => {
  it('reports not-found when no ancestor contains `.lerret/`', async () => {
    // `workDir` lives under the OS temp dir; none of it has a `.lerret/`.
    const start = join(workDir, 'nothing', 'here');
    await fsp.mkdir(start, { recursive: true });

    const result = await resolveProject(start);

    expect(result.found).toBe(false);
    expect(result.startDir).toBe(asLerretPath(start));
    // A not-found result carries no project paths.
    expect(result).not.toHaveProperty('projectRoot');
    expect(result).not.toHaveProperty('lerretDir');
  });

  it('a plain file named `.lerret` does NOT designate a project', async () => {
    // The marker must be a *directory*. A regular file of the same name is
    // not a Lerret project (FR1).
    await fsp.writeFile(join(workDir, LERRET_DIR_NAME), 'not a directory');

    const result = await resolveProject(workDir);

    expect(result.found).toBe(false);
  });
});

describe('resolveProject — the walk stops at the filesystem root', () => {
  it('terminates cleanly at the root without error or infinite loop', async () => {
    // Start the walk AT the filesystem root. The root has no `.lerret/`, so
    // detection must climb to `dirname(root) === root`, stop, and return
    // not-found — never hang, never throw.
    const fsRoot = parse(workDir).root;

    const result = await resolveProject(fsRoot);

    expect(result.found).toBe(false);
    expect(result.startDir).toBe(asLerretPath(fsRoot));
  });

  it('does not throw when an ancestor directory is unreadable mid-walk', async () => {
    // A backend whose readDir always rejects (e.g. permission denied)
    // simulates an unreadable ancestor. Detection must absorb the rejection,
    // keep walking, and finish at the root with a not-found result.
    const rejectingBackend = {
      readDir: async () => {
        throw new Error('EACCES: permission denied');
      },
      readFile: async () => '',
      writeFile: async () => {},
      watch: () => ({ close() {} }),
      capabilities: { canWrite: false, canWatch: false, canReveal: false },
    };

    const result = await resolveProject(workDir, rejectingBackend);

    expect(result.found).toBe(false);
    expect(result.startDir).toBe(asLerretPath(workDir));
  });
});

describe('resolveProject — argument handling', () => {
  it('resolves a relative start directory to an absolute path', async () => {
    await fsp.mkdir(join(workDir, LERRET_DIR_NAME));

    const originalCwd = process.cwd();
    try {
      process.chdir(workDir);
      // A relative `.` start must be resolved before the walk begins.
      const result = await resolveProject('.');
      expect(result.found).toBe(true);
      expect(parse(result.projectRoot).root).not.toBe('');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('detects through an explicitly injected filesystem backend', async () => {
    // The injected-backend path: a hand-built backend whose readDir reports a
    // `.lerret/` directory for exactly one path. Detection must use it
    // instead of touching the real disk.
    const projectRoot = asLerretPath(join(workDir, 'virtual'));
    const fakeBackend = {
      readDir: async (dirPath) => {
        if (dirPath === projectRoot) {
          return [
            {
              name: LERRET_DIR_NAME,
              path: `${projectRoot}/${LERRET_DIR_NAME}`,
              kind: 'directory',
              isFile: false,
              isDirectory: true,
            },
          ];
        }
        return [];
      },
      readFile: async () => '',
      writeFile: async () => {},
      watch: () => ({ close() {} }),
      capabilities: { canWrite: false, canWatch: false, canReveal: false },
    };

    const result = await resolveProject(
      join(workDir, 'virtual', 'pages'),
      fakeBackend,
    );

    expect(result.found).toBe(true);
    expect(result.projectRoot).toBe(projectRoot);
    expect(result.lerretDir).toBe(`${projectRoot}/${LERRET_DIR_NAME}`);
  });
});
