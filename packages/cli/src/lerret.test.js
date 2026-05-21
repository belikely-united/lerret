// Tests for the top-level `lerret` CLI entry — subcommand dispatch, usage
// banner, unknown-command exit code.
//
// The `main()` entry is intentionally a thin dispatcher: each subcommand
// owns its own flag parsing and lifecycle. These tests verify the
// dispatcher's contract — they do NOT boot Vite.

import { describe, expect, it, vi } from 'vitest';

import { main } from './lerret.js';

/**
 * Capture process.stdout / process.stderr writes for one main() call and
 * return what was written + the exit code.
 *
 * @param {string[]} argv
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runMain(argv) {
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
    const code = await main(argv);
    return { code, stdout, stderr };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe('main() — top-level dispatcher', () => {
  it('prints usage and exits 0 when called with no arguments', async () => {
    const { code, stdout } = await runMain([]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Usage: lerret/);
    // The banner enumerates the available commands.
    expect(stdout).toMatch(/\bdev\b/);
  });

  it('prints usage and exits 0 when called with --help', async () => {
    const { code, stdout } = await runMain(['--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Usage: lerret/);
  });

  it('prints usage and exits 0 when called with -h', async () => {
    const { code, stdout } = await runMain(['-h']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Usage: lerret/);
  });

  it('exits non-zero on an unknown command and prints usage to stderr', async () => {
    const { code, stderr, stdout } = await runMain(['bogus-command']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/unknown command "bogus-command"/);
    // The full usage banner is printed (to stderr's pre-banner OR stdout)
    // so the user can self-correct.
    expect(`${stderr}${stdout}`).toMatch(/Usage: lerret/);
  });

  it('dispatches `dev --help` without booting a server (exits 0)', async () => {
    // `runDev` short-circuits on --help and prints its own usage; no Vite
    // is touched.
    const { code, stdout } = await runMain(['dev', '--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/lerret dev/);
    expect(stdout).toMatch(/--port/);
    expect(stdout).toMatch(/--folder/);
    expect(stdout).toMatch(/--open/);
  });

  it('exits non-zero when `dev` is passed an unknown flag', async () => {
    const { code, stderr } = await runMain(['dev', '--bogus']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/lerret dev/);
  });

  it('lists `export` in the top-level usage banner', async () => {
    const { code, stdout } = await runMain([]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/\bexport\b/);
  });

  it('dispatches `export --help` without booting Vite or Playwright (exits 0)', async () => {
    // `runExport` short-circuits on --help — no Vite, no Chromium.
    const { code, stdout } = await runMain(['export', '--help']);
    expect(code).toBe(0);
    expect(stdout).toMatch(/lerret export/);
    expect(stdout).toMatch(/--format/);
    expect(stdout).toMatch(/--out/);
    expect(stdout).toMatch(/--flat/);
  });

  it('exits non-zero when `export` is passed an unknown flag', async () => {
    const { code, stderr } = await runMain(['export', '--bogus']);
    expect(code).toBe(1);
    expect(stderr).toMatch(/lerret export/);
  });
});
