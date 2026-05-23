// Tests for the `create-lerret` scaffolder.
//
// Covers:
//   - Successful scaffold to a temp directory (files match template exactly)
//   - Missing <name> arg → usage message + non-zero exit
//   - Invalid project names ('.', '..', 'foo/bar', empty) → clear error + non-zero exit
//   - `--no-samples` flag: creates only .lerret/config.json (no _fonts/, no samples/)
//   - `--no-samples` works in any position relative to the project name
//   - Default (no flag) still copies the full sample template (regression)
//   - Unknown flag triggers a usage message + non-zero exit
//   - Success output message format
//   AI-tool surfaces (Story 6.11):
//   - Default scaffold ships .claude/, .cursor/, .github/copilot-instructions.md, AGENTS.md
//   - `--no-ai-rules` skips ALL AI-tool surfaces but .lerret/ still ships
//   - `--ai-tools=claude,cursor` scopes to the named tools only
//   - `--ai-tools=copilot` scopes to copilot only
//   - `--ai-tools=agents` scopes to AGENTS.md only
//   - Post-scaffold output enumerates every AI-tool file written
//   - Mechanical @lerret/cli form check: no emitted file uses the bare
//     `lerret <command>` form (ADR-002 enforcement)
//   - `--ai-tools=unknown` exits 1 with a clear error
//   - `--no-ai-rules` + `--ai-tools=...` exits 1 with mutual-exclusion error
//   - pnpm pack includes every new AI-tool file
//   Existing-target and filesystem error conditions:
//   - Non-empty target dir → refusal, exit 1, original files untouched
//   - Empty target dir → proceeds to populate (choice A)
//   - Target is an existing file → refusal, exit 1
//   - Parent dir doesn't exist → clear error, exit 1
//   - Unwritable parent (mocked EACCES) → clear error, exit 1
//   - Mid-copy failure (mocked fsp.cp) → cleanup, exit 1, dest removed

import { promises as fsp } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Used in tests that need to peek at fs internals without real chmod.
import * as nodeFs from 'node:fs';

import { main } from './create-lerret.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATE_LERRET = join(PACKAGE_ROOT, 'template', '.lerret');

// Minimal YAML frontmatter parser — extracts the `name` and `description`
// fields from a markdown file's leading `---` block.  We avoid pulling in a
// real YAML dependency for two assertions: the package is dependency-free on
// purpose.  Returns `null` if the file has no frontmatter block.
//
// Supports values on the same line as the key (`name: foo`) and values
// continued on the next line (`description:\n  Foo bar.`) — basic but
// sufficient for the SKILL.md / command files we ship.
//
// @param {string} markdown
// @returns {Record<string, string> | null}
function parseSkillFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return null;
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = markdown.slice(4, end);
  /** @type {Record<string, string>} */
  const out = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    // Folded next-line continuation when value is empty.
    if (value === '' && i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
      value = lines[i + 1].trim();
    }
    // Strip surrounding quotes if any.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

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

  it('copies template .lerret/ files verbatim — destination matches template exactly', async () => {
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
    expect(stdout).toMatch(/npx @lerret\/cli@latest dev/);
  });

  it('success message contains the checkmark prefix', async () => {
    const { stdout } = await runMain(['alpha'], { cwd: tmpDir });
    // The success line starts with the Unicode check mark.
    expect(stdout).toMatch(/^✓/m);
  });
});

// ---------------------------------------------------------------------------
// Bundled AI-tool surfaces (Story 6.11)
// ---------------------------------------------------------------------------
//
// All four surfaces are rendered at scaffold time from the shared
// `ai-content.js` module so the Lerret-authoring prose stays single-sourced.

describe('AI-tool surfaces (default — all four)', () => {
  it('default scaffold ships the lerret-author SKILL.md', async () => {
    const { code } = await runMain(['my-project'], { cwd: tmpDir });
    expect(code).toBe(0);

    const skillPath = join(
      tmpDir,
      'my-project',
      '.claude',
      'skills',
      'lerret-author',
      'SKILL.md',
    );
    const stat = await fsp.stat(skillPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('default scaffold ships the /lerret-edit command', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const cmdPath = join(
      tmpDir,
      'my-project',
      '.claude',
      'commands',
      'lerret-edit.md',
    );
    const stat = await fsp.stat(cmdPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('default scaffold ships the Cursor MDC rule', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const cursorPath = join(tmpDir, 'my-project', '.cursor', 'rules', 'lerret.mdc');
    const stat = await fsp.stat(cursorPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('default scaffold ships the Copilot instructions', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const copilotPath = join(tmpDir, 'my-project', '.github', 'copilot-instructions.md');
    const stat = await fsp.stat(copilotPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('default scaffold ships AGENTS.md at the project root', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const agentsPath = join(tmpDir, 'my-project', 'AGENTS.md');
    const stat = await fsp.stat(agentsPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it('SKILL.md parses to valid frontmatter with name and description', async () => {
    await runMain(['my-project'], { cwd: tmpDir });
    const skillPath = join(
      tmpDir,
      'my-project',
      '.claude',
      'skills',
      'lerret-author',
      'SKILL.md',
    );
    const raw = await fsp.readFile(skillPath, 'utf8');
    const frontmatter = parseSkillFrontmatter(raw);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter).toHaveProperty('name');
    expect(frontmatter).toHaveProperty('description');
    expect(frontmatter?.name).toBe('lerret-author');
    expect((frontmatter?.description ?? '').length).toBeGreaterThan(40);
  });

  it('Cursor MDC parses to valid frontmatter with description, globs, alwaysApply', async () => {
    await runMain(['my-project'], { cwd: tmpDir });
    const cursorPath = join(tmpDir, 'my-project', '.cursor', 'rules', 'lerret.mdc');
    const raw = await fsp.readFile(cursorPath, 'utf8');
    const frontmatter = parseSkillFrontmatter(raw);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter).toHaveProperty('description');
    expect(raw).toMatch(/^globs:/m);
    expect(raw).toMatch(/^alwaysApply: true/m);
  });

  it('/lerret-edit command file forwards $ARGUMENTS verbatim', async () => {
    await runMain(['my-project'], { cwd: tmpDir });
    const cmdPath = join(
      tmpDir,
      'my-project',
      '.claude',
      'commands',
      'lerret-edit.md',
    );
    const raw = await fsp.readFile(cmdPath, 'utf8');
    expect(raw).toMatch(/\$ARGUMENTS/);
    // It must also name the skill so the matcher fires it on dispatch.
    expect(raw).toMatch(/lerret-author/);
  });

  it('AGENTS.md opens with a Lerret-project overview', async () => {
    await runMain(['my-project'], { cwd: tmpDir });
    const agentsPath = join(tmpDir, 'my-project', 'AGENTS.md');
    const raw = await fsp.readFile(agentsPath, 'utf8');
    expect(raw).toMatch(/^# AGENTS\.md/);
    expect(raw).toMatch(/Lerret project/);
    expect(raw).toMatch(/\.lerret\//);
  });

  it('--no-samples scaffold also ships all four AI-tool surfaces', async () => {
    // The minimal project has no sample assets to learn from — the surfaces are
    // *more* important there, not less.
    const { code } = await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    for (const rel of [
      '.claude/skills/lerret-author/SKILL.md',
      '.claude/commands/lerret-edit.md',
      '.cursor/rules/lerret.mdc',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ]) {
      const stat = await fsp.stat(join(projectRoot, rel));
      expect(stat.isFile()).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// --no-ai-rules flag (Story 6.11)
// ---------------------------------------------------------------------------

describe('--no-ai-rules flag', () => {
  it('exits 0 and ships zero AI-tool files; .lerret/ still ships', async () => {
    const { code } = await runMain(['my-project', '--no-ai-rules'], { cwd: tmpDir });
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    // .lerret/ still ships.
    const lerretStat = await fsp.stat(join(projectRoot, '.lerret'));
    expect(lerretStat.isDirectory()).toBe(true);

    // None of the AI-tool surfaces should exist.
    for (const rel of [
      '.claude',
      '.cursor',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ]) {
      let exists = true;
      try {
        await fsp.stat(join(projectRoot, rel));
      } catch (err) {
        if (err && err.code === 'ENOENT') exists = false;
      }
      expect(exists).toBe(false);
    }
  });

  it('--no-ai-rules combined with --no-samples scaffolds only .lerret/config.json', async () => {
    const { code } = await runMain(
      ['my-project', '--no-samples', '--no-ai-rules'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    const entries = await fsp.readdir(projectRoot);
    // Only .lerret/ at the project root.
    expect(entries).toEqual(['.lerret']);

    const lerretEntries = await fsp.readdir(join(projectRoot, '.lerret'));
    expect(lerretEntries).toEqual(['config.json']);
  });

  it('success message notes that no AI-tool files were created', async () => {
    const { stdout } = await runMain(['my-project', '--no-ai-rules'], { cwd: tmpDir });
    expect(stdout).toMatch(/no AI-tool files created/i);
    expect(stdout).toMatch(/--no-ai-rules/);
  });
});

// ---------------------------------------------------------------------------
// --ai-tools=... flag (Story 6.11)
// ---------------------------------------------------------------------------

describe('--ai-tools flag', () => {
  it('--ai-tools=claude,cursor ships only those two surfaces', async () => {
    const { code } = await runMain(
      ['my-project', '--ai-tools=claude,cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    // Should exist:
    expect((await fsp.stat(join(projectRoot, '.claude'))).isDirectory()).toBe(true);
    expect((await fsp.stat(join(projectRoot, '.cursor'))).isDirectory()).toBe(true);

    // Should NOT exist:
    for (const rel of ['.github/copilot-instructions.md', 'AGENTS.md']) {
      let exists = true;
      try {
        await fsp.stat(join(projectRoot, rel));
      } catch (err) {
        if (err && err.code === 'ENOENT') exists = false;
      }
      expect(exists).toBe(false);
    }
  });

  it('--ai-tools=copilot ships only copilot-instructions.md', async () => {
    const { code } = await runMain(
      ['my-project', '--ai-tools=copilot'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    expect(
      (await fsp.stat(join(projectRoot, '.github', 'copilot-instructions.md'))).isFile(),
    ).toBe(true);

    for (const rel of ['.claude', '.cursor', 'AGENTS.md']) {
      let exists = true;
      try {
        await fsp.stat(join(projectRoot, rel));
      } catch (err) {
        if (err && err.code === 'ENOENT') exists = false;
      }
      expect(exists).toBe(false);
    }
  });

  it('--ai-tools=agents ships only AGENTS.md', async () => {
    const { code } = await runMain(
      ['my-project', '--ai-tools=agents'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);

    const projectRoot = join(tmpDir, 'my-project');
    expect((await fsp.stat(join(projectRoot, 'AGENTS.md'))).isFile()).toBe(true);

    for (const rel of ['.claude', '.cursor', '.github']) {
      let exists = true;
      try {
        await fsp.stat(join(projectRoot, rel));
      } catch (err) {
        if (err && err.code === 'ENOENT') exists = false;
      }
      expect(exists).toBe(false);
    }
  });

  it('--ai-tools=unknown exits 1 with a clear error naming the unknown value', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--ai-tools=unknown'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown/i);
    expect(stderr).toMatch(/"unknown"/);
    // Should list the valid options.
    expect(stderr).toMatch(/claude/);
    expect(stderr).toMatch(/cursor/);
    expect(stderr).toMatch(/copilot/);
    expect(stderr).toMatch(/agents/);
  });

  it('--ai-tools=claude,unknown exits 1 with a clear error', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--ai-tools=claude,unknown'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/"unknown"/);
  });

  it('tolerates whitespace and case in the comma-separated list', async () => {
    const { code } = await runMain(
      ['my-project', '--ai-tools=Claude, Cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
    const projectRoot = join(tmpDir, 'my-project');
    expect((await fsp.stat(join(projectRoot, '.claude'))).isDirectory()).toBe(true);
    expect((await fsp.stat(join(projectRoot, '.cursor'))).isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// --ai-tools repeat-flag rejection
// ---------------------------------------------------------------------------
//
// `parseArgs` silently keeps the last value of a repeated string-typed option,
// which would mask user error (e.g. `--ai-tools=claude --ai-tools=cursor`
// would silently drop `claude`). Detect the repeat before parseArgs runs.

describe('--ai-tools repeat-flag rejection', () => {
  it('exits 1 when --ai-tools=... is passed twice (=value form)', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--ai-tools=claude', '--ai-tools=cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--ai-tools/);
    expect(stderr).toMatch(/multiple times/i);
    expect(stderr).toMatch(/comma-separated list/i);
  });

  it('exits 1 when --ai-tools value is passed twice (space form)', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--ai-tools', 'claude', '--ai-tools', 'cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/multiple times/i);
  });

  it('exits 1 when the two forms are mixed', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--ai-tools=claude', '--ai-tools', 'cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/multiple times/i);
  });

  it('does not create any project directory when the flag is repeated', async () => {
    await runMain(
      ['my-project', '--ai-tools=claude', '--ai-tools=cursor'],
      { cwd: tmpDir },
    );
    const entries = await fsp.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it('still accepts a single --ai-tools with a comma-separated list', async () => {
    const { code } = await runMain(
      ['my-project', '--ai-tools=claude,cursor'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// --no-ai-rules and --ai-tools mutual exclusion (Story 6.11)
// ---------------------------------------------------------------------------

describe('--no-ai-rules + --ai-tools mutual exclusion', () => {
  it('exits 1 when both flags are passed', async () => {
    const { code, stderr } = await runMain(
      ['my-project', '--no-ai-rules', '--ai-tools=claude'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/cannot be used together/i);
    expect(stderr).toMatch(/--no-ai-rules/);
    expect(stderr).toMatch(/--ai-tools/);
  });

  it('does not create any project directory when flags conflict', async () => {
    await runMain(
      ['my-project', '--no-ai-rules', '--ai-tools=claude'],
      { cwd: tmpDir },
    );
    const entries = await fsp.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Post-scaffold disclosure summary (Story 6.11)
// ---------------------------------------------------------------------------

describe('post-scaffold disclosure summary', () => {
  it('default scaffold lists every AI-tool file written', async () => {
    const { stdout } = await runMain(['my-project'], { cwd: tmpDir });
    expect(stdout).toMatch(/AI-tool integrations created:/);
    expect(stdout).toMatch(/\.claude\/skills\/lerret-author\/SKILL\.md/);
    expect(stdout).toMatch(/\.claude\/commands\/lerret-edit\.md/);
    expect(stdout).toMatch(/\.cursor\/rules\/lerret\.mdc/);
    expect(stdout).toMatch(/\.github\/copilot-instructions\.md/);
    expect(stdout).toMatch(/AGENTS\.md/);
  });

  it('--ai-tools=claude lists only the two Claude files', async () => {
    const { stdout } = await runMain(
      ['my-project', '--ai-tools=claude'],
      { cwd: tmpDir },
    );
    expect(stdout).toMatch(/\.claude\/skills\/lerret-author\/SKILL\.md/);
    expect(stdout).toMatch(/\.claude\/commands\/lerret-edit\.md/);
    expect(stdout).not.toMatch(/lerret\.mdc/);
    expect(stdout).not.toMatch(/copilot-instructions/);
    // AGENTS.md must NOT appear in the disclosure list.
    // Note: 'AGENTS.md' could appear elsewhere in the message in future; check
    // it's not in a context that implies emission.
    expect(stdout.split('\n').filter((line) => /^\s+AGENTS\.md/.test(line))).toHaveLength(0);
  });

  it('--no-ai-rules disclosure notes the opt-out', async () => {
    const { stdout } = await runMain(['my-project', '--no-ai-rules'], { cwd: tmpDir });
    expect(stdout).toMatch(/no AI-tool files created/i);
  });

  it('preserves the next-step instructions (cd + dev) verbatim', async () => {
    const { stdout: defaultOut } = await runMain(['my-project'], { cwd: tmpDir });
    expect(defaultOut).toMatch(/cd my-project/);
    expect(defaultOut).toMatch(/npx @lerret\/cli@latest dev/);

    const { stdout: noAiOut } = await runMain(['my-project-2', '--no-ai-rules'], { cwd: tmpDir });
    expect(noAiOut).toMatch(/cd my-project-2/);
    expect(noAiOut).toMatch(/npx @lerret\/cli@latest dev/);
  });
});

// ---------------------------------------------------------------------------
// Mechanical @lerret/cli-form check (ADR-002, Story 6.11)
// ---------------------------------------------------------------------------
//
// ZERO bare `lerret <command>` references may appear in any emitted file.
// The canonical form is `@lerret/cli <command>`. Bare `lerret <cmd>` resolves
// to a deprecated unrelated npm package.
//
// Pattern: negative-lookbehind that excludes any character that, when followed
// by `lerret`, indicates a legitimate non-bare context: `/` (e.g. `@lerret/cli`
// or path prefixes), `@` (scoped package boundary), word chars (`\w` covers
// digits, letters, `_` — so `slerret`/`_lerret`/`5lerret` won't match), and
// `-` (e.g. inside `--lerret` or `pkg-lerret`).

const FORBIDDEN_CLI_FORM_RE = /(?<![/@\w-])lerret (dev|export|clear|init|build|preview)\b/m;

/**
 * Scan a directory recursively for files containing bare `lerret <cmd>`
 * references. Returns an array of { file, line, snippet } so failure messages
 * can name the exact location.
 *
 * @param {string} root  Absolute path to scan.
 * @returns {Promise<Array<{ file: string, lineNumber: number, line: string }>>}
 */
async function findForbiddenCliReferences(root) {
  /** @type {Array<{ file: string, lineNumber: number, line: string }>} */
  const violations = [];
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      const childViolations = await findForbiddenCliReferences(fullPath);
      violations.push(...childViolations);
    } else if (entry.isFile() && /\.(md|mdc|mdx|txt|json)$/.test(entry.name)) {
      const content = await fsp.readFile(fullPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (FORBIDDEN_CLI_FORM_RE.test(line)) {
          violations.push({ file: fullPath, lineNumber: i + 1, line });
        }
      }
    }
  }
  return violations;
}

describe('mechanical @lerret/cli-form check (ADR-002)', () => {
  // Unit table for FORBIDDEN_CLI_FORM_RE. Captures the precise contexts that
  // must or must not trip the regex, so future tweaks can't silently regress.

  describe('FORBIDDEN_CLI_FORM_RE — unit table', () => {
    const forbiddenRows = [
      ['lerret dev', 'bare'],
      ['(lerret dev)', 'paren prefix'],
      ['"lerret dev"', 'double-quote prefix'],
      ["'lerret dev'", 'single-quote prefix'],
      [',lerret dev', 'comma prefix'],
      [';lerret dev', 'semicolon prefix'],
      ['>lerret dev', 'gt prefix (JSX/HTML close)'],
      [' lerret export', 'space prefix'],
      ['lerret init', 'bare init'],
    ];

    const validRows = [
      ['@lerret/cli dev', 'scoped'],
      ['npx @lerret/cli@latest dev', 'scoped + @latest'],
      ['belikely-united/lerret dev', 'path prefix (slash excludes)'],
      ['slerret dev', 'word prefix (run-on word)'],
      ['-lerret dev', 'dash prefix (inside --lerret)'],
      ['_lerret dev', 'underscore prefix (variable name)'],
    ];

    it.each(forbiddenRows)('matches forbidden form: %s (%s)', (input) => {
      // Reset .lastIndex isn't needed here — the constant uses /m, not /g.
      expect(FORBIDDEN_CLI_FORM_RE.test(input)).toBe(true);
    });

    it.each(validRows)('does NOT match valid form: %s (%s)', (input) => {
      expect(FORBIDDEN_CLI_FORM_RE.test(input)).toBe(false);
    });
  });

  it('emitted files contain ZERO bare `lerret <cmd>` references (default scaffold)', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const projectRoot = join(tmpDir, 'my-project');
    const aiTargets = [
      join(projectRoot, '.claude'),
      join(projectRoot, '.cursor'),
      join(projectRoot, '.github'),
    ];

    /** @type {Array<{ file: string, lineNumber: number, line: string }>} */
    const allViolations = [];
    for (const target of aiTargets) {
      // Skip targets that don't exist (e.g. some flag combinations).
      try {
        await fsp.stat(target);
      } catch {
        continue;
      }
      const v = await findForbiddenCliReferences(target);
      allViolations.push(...v);
    }

    // AGENTS.md is a single file at the root; check it directly.
    const agentsPath = join(projectRoot, 'AGENTS.md');
    try {
      const content = await fsp.readFile(agentsPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (FORBIDDEN_CLI_FORM_RE.test(lines[i])) {
          allViolations.push({ file: agentsPath, lineNumber: i + 1, line: lines[i] });
        }
      }
    } catch {
      // missing — handled by other tests.
    }

    if (allViolations.length > 0) {
      const detail = allViolations
        .map((v) => `  ${v.file}:${v.lineNumber}: ${v.line.trim()}`)
        .join('\n');
      throw new Error(
        `Found ${allViolations.length} bare \`lerret <cmd>\` reference(s) in emitted AI-tool files. ` +
          `Canonical form is \`@lerret/cli <cmd>\` (ADR-002). Offending lines:\n${detail}`,
      );
    }
    expect(allViolations).toEqual([]);
  });

  it('every emitted file uses @lerret/cli at least once (sanity check)', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const projectRoot = join(tmpDir, 'my-project');
    const filesToCheck = [
      '.claude/skills/lerret-author/SKILL.md',
      '.claude/commands/lerret-edit.md',
      '.cursor/rules/lerret.mdc',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ];

    for (const rel of filesToCheck) {
      const content = await fsp.readFile(join(projectRoot, rel), 'utf8');
      // The /lerret-edit command is intentionally short and may not mention
      // the CLI directly; everything else must.
      if (rel === '.claude/commands/lerret-edit.md') continue;
      expect(content, `${rel} should reference @lerret/cli`).toMatch(/@lerret\/cli/);
    }
  });
});

// ---------------------------------------------------------------------------
// Install-command canonical form — every zero-install invocation is pinned
// to `@latest` (precedent: Next.js, Vite, Astro all do this)
// ---------------------------------------------------------------------------
//
// `npx <pkg>` can resolve a stale cached version if the user ran it before;
// `npx <pkg>@latest` forces fresh resolution every time. Every emitted
// AI-tool file must use the `@latest`-pinned form across every package
// runner — `npx`, `pnpm dlx`, `yarn dlx`, `bunx`.
//
// Pattern: `(npx|pnpm dlx|yarn dlx|bunx) (create-lerret|@lerret/cli)\b(?!@)`.
// The negative lookahead `(?!@)` skips lines that already have a version
// specifier (e.g. an intentional pin like `@0.1.3` or `@latest`).

const MISSING_LATEST_TAG_RE = /(npx|pnpm dlx|yarn dlx|bunx) (create-lerret|@lerret\/cli)\b(?!@)/g;

/**
 * Scan a single file for `(npx|pnpm dlx|yarn dlx|bunx) <pkg>` invocations
 * that lack a `@<version>` tag. Returns `{ lineNumber, line }` per offender.
 *
 * @param {string} filePath  Absolute path to the file to scan.
 * @returns {Promise<Array<{ lineNumber: number, line: string }>>}
 */
async function findUnpinnedInvocations(filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  const lines = content.split('\n');
  /** @type {Array<{ lineNumber: number, line: string }>} */
  const offenders = [];
  for (let i = 0; i < lines.length; i += 1) {
    MISSING_LATEST_TAG_RE.lastIndex = 0;
    if (MISSING_LATEST_TAG_RE.test(lines[i])) {
      offenders.push({ lineNumber: i + 1, line: lines[i] });
    }
  }
  return offenders;
}

describe('install-command canonical form (@latest pin)', () => {
  it('every emitted AI-tool file pins every zero-install invocation to @latest', async () => {
    await runMain(['my-project'], { cwd: tmpDir });

    const projectRoot = join(tmpDir, 'my-project');
    const emittedFiles = [
      '.claude/skills/lerret-author/SKILL.md',
      '.claude/commands/lerret-edit.md',
      '.cursor/rules/lerret.mdc',
      '.github/copilot-instructions.md',
      'AGENTS.md',
    ];

    /** @type {Array<{ file: string, lineNumber: number, line: string }>} */
    const allViolations = [];
    for (const rel of emittedFiles) {
      const fullPath = join(projectRoot, rel);
      const offenders = await findUnpinnedInvocations(fullPath);
      for (const off of offenders) {
        allViolations.push({ file: fullPath, lineNumber: off.lineNumber, line: off.line });
      }
    }

    if (allViolations.length > 0) {
      const detail = allViolations
        .map((v) => `  ${v.file}:${v.lineNumber}: ${v.line.trim()}`)
        .join('\n');
      throw new Error(
        `Found ${allViolations.length} zero-install invocation(s) missing an \`@latest\` tag ` +
          `in emitted AI-tool files. Canonical form is \`npx @lerret/cli@latest <cmd>\` ` +
          `(and equivalents for pnpm dlx / yarn dlx / bunx). Offending lines:\n${detail}`,
      );
    }
    expect(allViolations).toEqual([]);
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
  it('exits 0 and creates only .lerret/config.json — no _fonts/, no samples/', async () => {
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

  it('does not create samples/ directory', async () => {
    await runMain(['my-project', '--no-samples'], { cwd: tmpDir });
    const projectDir = join(tmpDir, 'my-project', '.lerret');
    const entries = await fsp.readdir(projectDir);
    expect(entries).not.toContain('samples');
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
    expect(stdout).toMatch(/npx @lerret\/cli@latest dev/);
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
  it('copies the full template .lerret/ tree including samples/ and _fonts/', async () => {
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

  it('usage banner mentions --no-ai-rules and --ai-tools', async () => {
    const { stdout } = await runMain(['--help'], { cwd: tmpDir });
    expect(stdout).toMatch(/--no-ai-rules/);
    expect(stdout).toMatch(/--ai-tools/);
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

    it('cleans up only .lerret/ and AI surfaces when dest dir already existed (empty-dir case)', async () => {
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

      // .lerret/ inside it must be gone, as must any AI-tool surfaces we'd have written.
      for (const sub of ['.lerret', '.claude', '.cursor', '.github', 'AGENTS.md']) {
        let exists = false;
        try {
          await fsp.stat(join(targetDir, sub));
          exists = true;
        } catch {
          // ENOENT — correct.
        }
        expect(exists).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// pnpm pack — every new file ships in the tarball (Story 6.11)
// ---------------------------------------------------------------------------
//
// Since the AI-tool files are rendered at scaffold time (not shipped as
// static template files), the tarball must include the renderer modules
// (`ai-content.js` + `create-lerret.js`) plus the `template/.lerret/` dir.
// This test packs the package into a fresh temp dir, extracts the tarball,
// and asserts the expected entry list.

describe('pnpm pack — published tarball contains the right files', () => {
  it('tarball includes ai-content.js, create-lerret.js, and template/.lerret/ (no .claude template)', async () => {
    // Pack the package into the per-test tmp dir to keep the workspace clean.
    const packResult = await execFileAsync(
      'pnpm',
      ['pack', '--pack-destination', tmpDir],
      { cwd: PACKAGE_ROOT, maxBuffer: 16 * 1024 * 1024 },
    );

    // Find the .tgz we just produced.
    const entries = await fsp.readdir(tmpDir);
    const tgz = entries.find((f) => f.startsWith('create-lerret-') && f.endsWith('.tgz'));
    expect(tgz, `pnpm pack output was:\n${packResult.stdout}\n${packResult.stderr}`).toBeDefined();
    if (!tgz) throw new Error('no .tgz produced by pnpm pack');

    // List tarball contents with `tar -tzf`.
    const tarResult = await execFileAsync('tar', ['-tzf', join(tmpDir, tgz)], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const tarballFiles = tarResult.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // npm tars prefix entries with `package/`; strip it for assertions.
    const relFiles = tarballFiles.map((f) => f.replace(/^package\//, ''));

    // The renderer modules must ship.
    expect(relFiles).toContain('src/create-lerret.js');
    expect(relFiles).toContain('src/ai-content.js');

    // The .lerret/ template must ship. The default teaching preset (Story 7.1)
    // has a project-root config + README plus five page folders:
    // intro/, landing/, social/, brand/, live/.
    expect(relFiles).toContain('template/.lerret/config.json');
    expect(relFiles).toContain('template/.lerret/README.md');

    // intro/ — Markdown-only tour page; excludeFromExport via its config.json.
    expect(relFiles).toContain('template/.lerret/intro/config.json');
    expect(relFiles).toContain('template/.lerret/intro/welcome.md');

    // landing/ — cascading vars demo.
    expect(relFiles).toContain('template/.lerret/landing/landing-hero.jsx');
    expect(relFiles).toContain('template/.lerret/landing/about-vars.md');

    // social/ — variants + co-located data files demo.
    expect(relFiles).toContain('template/.lerret/social/tw-banner.jsx');
    expect(relFiles).toContain('template/.lerret/social/tw-banner.data.json');
    expect(relFiles).toContain('template/.lerret/social/og-card.jsx');
    expect(relFiles).toContain('template/.lerret/social/og-card.data.json');
    expect(relFiles).toContain('template/.lerret/social/about-data-files.md');

    // brand/ — propsSchema validation badge demo.
    expect(relFiles).toContain('template/.lerret/brand/business-card.jsx');
    expect(relFiles).toContain('template/.lerret/brand/business-card.data.json');
    expect(relFiles).toContain('template/.lerret/brand/about-validation.md');

    // live/ — liveRefresh demo.
    expect(relFiles).toContain('template/.lerret/live/config.json');
    expect(relFiles).toContain('template/.lerret/live/clock.jsx');
    expect(relFiles).toContain('template/.lerret/live/counter.jsx');
    expect(relFiles).toContain('template/.lerret/live/about-live-refresh.md');

    // The .claude template must NOT ship (Story 6.11 moved this to runtime
    // rendering — no static AI-tool files in the template).
    expect(relFiles.filter((f) => f.startsWith('template/.claude/'))).toEqual([]);

    // Tests must not ship.
    expect(relFiles.filter((f) => /\.test\.(js|jsx)$/.test(f))).toEqual([]);

    // package.json must ship.
    expect(relFiles).toContain('package.json');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Story 7.4 — --preset <name> CLI flag
// ---------------------------------------------------------------------------

describe('--preset flag (Story 7.4)', () => {
  it('scaffolds a named preset (--preset producthunt)', async () => {
    const { code, stdout } = await runMain(
      ['my-ph', '--preset', 'producthunt', '--no-ai-rules'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
    expect(stdout).toContain('Product Hunt');
    const projectRoot = join(tmpDir, 'my-ph');
    const exists = await fsp
      .access(join(projectRoot, '.lerret', 'config.json'))
      .then(() => true, () => false);
    expect(exists).toBe(true);
    // Confirm the preset marker landed in the scaffolded config.
    const cfg = JSON.parse(
      await fsp.readFile(join(projectRoot, '.lerret', 'config.json'), 'utf-8'),
    );
    expect(cfg._meta?.preset).toBe('producthunt-v1');
  });

  it('rejects an unknown preset with a clear error listing valid options', async () => {
    const { code, stderr } = await runMain(
      ['proj', '--preset', 'invalid', '--no-ai-rules'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown preset "invalid"/);
    expect(stderr).toMatch(/appstore/);
    expect(stderr).toMatch(/producthunt/);
  });

  it('--preset and --no-samples together is a clear error', async () => {
    const { code, stderr } = await runMain(
      ['proj', '--preset', 'producthunt', '--no-samples'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--preset and --no-samples/);
  });

  it('--preset and --demo together is a clear error', async () => {
    const { code, stderr } = await runMain(
      ['proj', '--preset', 'producthunt', '--demo'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--demo and --preset/);
  });

  it('each registered preset name scaffolds with the expected _meta.preset marker', async () => {
    const names = ['appstore', 'producthunt', 'social-media', 'talks', 'personal', 'live'];
    for (const name of names) {
      const projDir = `proj-${name}`;
      const { code } = await runMain(
        [projDir, '--preset', name, '--no-ai-rules'],
        { cwd: tmpDir },
      );
      expect(code).toBe(0);
      const cfg = JSON.parse(
        await fsp.readFile(join(tmpDir, projDir, '.lerret', 'config.json'), 'utf-8'),
      );
      expect(cfg._meta?.preset).toBe(`${name}-v1`);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Story 7.10 — --demo flag (writes first-run marker; does not auto-spawn in tests)
// ---------------------------------------------------------------------------

describe('--demo flag (Story 7.10)', () => {
  it('writes the first-run.json marker into .lerret/.state/', async () => {
    const { code } = await runMain(
      ['my-demo', '--demo', '--no-ai-rules'],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
    const markerPath = join(tmpDir, 'my-demo', '.lerret', '.state', 'first-run.json');
    const raw = await fsp.readFile(markerPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.demo).toBe(true);
    expect(typeof parsed.createdAt).toBe('string');
  });

  it('--demo and --no-samples together is a clear error', async () => {
    const { code, stderr } = await runMain(
      ['proj', '--demo', '--no-samples'],
      { cwd: tmpDir },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--demo and --no-samples/);
  });
});
