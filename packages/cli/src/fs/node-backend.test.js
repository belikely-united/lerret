// Tests for the Node `fs` filesystem backend — `readDir`, `readFile`, and the
// safe-write (temp-file-then-atomic-rename) guarantee, including a simulated
// interrupted write that must leave the original file fully intact (NFR9).

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isFilesystemAccess } from '@lerret/core';
import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from 'vitest';

import { createNodeBackend, realpathOrSelf } from './node-backend.js';

/** A fresh scratch directory per test, removed afterwards. @type {string} */
let workDir;

beforeEach(async () => {
  workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-nb-test-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fsp.rm(workDir, { recursive: true, force: true });
});

/** Convert an OS path to the forward-slash form the contract expects. */
function asLerretPath(p) {
  return p.replaceAll('\\', '/');
}

describe('createNodeBackend', () => {
  it('produces an object that satisfies the FilesystemAccess contract', () => {
    expect(isFilesystemAccess(createNodeBackend())).toBe(true);
  });

  it('declares Node-environment capabilities (write, watch, reveal)', () => {
    const { capabilities } = createNodeBackend();
    expect(capabilities).toEqual({
      canWrite: true,
      canWatch: true,
      canReveal: true,
    });
  });
});

describe('readDir', () => {
  it('distinguishes files from subdirectories', async () => {
    await fsp.writeFile(join(workDir, 'Button.jsx'), 'export default 1;');
    await fsp.mkdir(join(workDir, 'components'));

    const backend = createNodeBackend();
    const entries = await backend.readDir(asLerretPath(workDir));
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

    expect(byName['Button.jsx'].isFile).toBe(true);
    expect(byName['Button.jsx'].isDirectory).toBe(false);
    expect(byName['Button.jsx'].kind).toBe('file');

    expect(byName.components.isDirectory).toBe(true);
    expect(byName.components.isFile).toBe(false);
    expect(byName.components.kind).toBe('directory');
  });

  it('returns each entry with a name and a full forward-slash path', async () => {
    await fsp.writeFile(join(workDir, 'a.txt'), 'x');

    const backend = createNodeBackend();
    const [entry] = await backend.readDir(asLerretPath(workDir));

    expect(entry.name).toBe('a.txt');
    expect(entry.path).toBe(`${asLerretPath(workDir)}/a.txt`);
    expect(entry.path).not.toContain('\\');
  });

  it('rejects when the directory does not exist', async () => {
    const backend = createNodeBackend();
    await expect(
      backend.readDir(asLerretPath(join(workDir, 'nope'))),
    ).rejects.toThrow();
  });
});

describe('readFile', () => {
  it('reads UTF-8 text by default', async () => {
    await fsp.writeFile(join(workDir, 'note.md'), '# Héllo', 'utf-8');

    const backend = createNodeBackend();
    const text = await backend.readFile(asLerretPath(join(workDir, 'note.md')));

    expect(text).toBe('# Héllo');
    expect(typeof text).toBe('string');
  });

  it('reads raw bytes as a Uint8Array with encoding "binary"', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await fsp.writeFile(join(workDir, 'logo.png'), bytes);

    const backend = createNodeBackend();
    const out = await backend.readFile(
      asLerretPath(join(workDir, 'logo.png')),
      { encoding: 'binary' },
    );

    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('rejects when the file does not exist', async () => {
    const backend = createNodeBackend();
    await expect(
      backend.readFile(asLerretPath(join(workDir, 'missing.txt'))),
    ).rejects.toThrow();
  });
});

describe('writeFile — safe write', () => {
  it('writes new UTF-8 content, creating the file', async () => {
    const backend = createNodeBackend();
    const target = join(workDir, 'created.txt');

    await backend.writeFile(asLerretPath(target), 'fresh content');

    expect(await fsp.readFile(target, 'utf-8')).toBe('fresh content');
  });

  it('replaces existing content', async () => {
    const target = join(workDir, 'existing.txt');
    await fsp.writeFile(target, 'OLD CONTENT');

    const backend = createNodeBackend();
    await backend.writeFile(asLerretPath(target), 'NEW CONTENT');

    expect(await fsp.readFile(target, 'utf-8')).toBe('NEW CONTENT');
  });

  it('writes binary content from a Uint8Array', async () => {
    const backend = createNodeBackend();
    const target = join(workDir, 'out.bin');
    const bytes = new Uint8Array([1, 2, 3, 250, 0]);

    await backend.writeFile(asLerretPath(target), bytes, {
      encoding: 'binary',
    });

    const written = await fsp.readFile(target);
    expect(Array.from(written)).toEqual(Array.from(bytes));
  });

  it('round-trips binary through writeFile + readFile', async () => {
    const backend = createNodeBackend();
    const target = asLerretPath(join(workDir, 'roundtrip.bin'));
    const bytes = new Uint8Array([0, 127, 128, 255, 64]);

    await backend.writeFile(target, bytes, { encoding: 'binary' });
    const back = await backend.readFile(target, { encoding: 'binary' });

    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('does not leave temp artifacts inside the project directory', async () => {
    const backend = createNodeBackend();
    const target = join(workDir, 'clean.json');

    await backend.writeFile(asLerretPath(target), '{}');

    // Only the target file — no stray temp file beside it.
    const entries = await fsp.readdir(workDir);
    expect(entries).toEqual(['clean.json']);
  });

  // --- The NFR9 atomicity guarantee ----------------------------------------

  it('leaves the original file fully intact when the write is interrupted', async () => {
    const target = join(workDir, 'precious.json');
    const original = '{\n  "important": "do not lose me"\n}\n';
    await fsp.writeFile(target, original);

    // Simulate an interrupted/failed write: the atomic rename (the publish
    // step) throws, mimicking a crash or I/O error after the temp file is
    // written but before it is swapped into place.
    const renameSpy = vi
      .spyOn(fsp, 'rename')
      .mockRejectedValueOnce(new Error('simulated interrupt during rename'));

    const backend = createNodeBackend();
    await expect(
      backend.writeFile(asLerretPath(target), 'CORRUPTED PARTIAL DATA'),
    ).rejects.toThrow('simulated interrupt during rename');

    renameSpy.mockRestore();

    // The crux: the original content survives byte-for-byte — never
    // truncated, never half-written, never the new partial data.
    expect(await fsp.readFile(target, 'utf-8')).toBe(original);
  });

  it('cleans up the temp file when an interrupted write fails', async () => {
    const target = join(workDir, 'doc.txt');
    await fsp.writeFile(target, 'safe');

    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('boom'));

    const backend = createNodeBackend();
    await expect(
      backend.writeFile(asLerretPath(target), 'new'),
    ).rejects.toThrow('boom');

    // Failed write must not strand a temp file in the project directory.
    expect(await fsp.readdir(workDir)).toEqual(['doc.txt']);
  });

  it('a failed write on a brand-new path creates no file at all', async () => {
    const target = join(workDir, 'never-created.txt');

    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('interrupt'));

    const backend = createNodeBackend();
    await expect(
      backend.writeFile(asLerretPath(target), 'data'),
    ).rejects.toThrow('interrupt');

    // The destination was never partially created.
    await expect(fsp.access(target)).rejects.toThrow();
  });
});

describe('writeJson convenience', () => {
  it('writes canonical JSON with a trailing newline', async () => {
    const backend = createNodeBackend();
    const target = join(workDir, 'config.json');

    await backend.writeJson(asLerretPath(target), { liveRefresh: true });

    const text = await fsp.readFile(target, 'utf-8');
    expect(text).toBe('{\n  "liveRefresh": true\n}\n');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('writes JSON atomically — interrupted writeJson keeps the old file', async () => {
    const target = join(workDir, 'data.json');
    const original = '{\n  "version": 1\n}\n';
    await fsp.writeFile(target, original);

    vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('crash'));

    const backend = createNodeBackend();
    await expect(
      backend.writeJson(asLerretPath(target), { version: 2 }),
    ).rejects.toThrow('crash');

    expect(await fsp.readFile(target, 'utf-8')).toBe(original);
  });
});

describe('watch', () => {
  it('returns a closable Watcher handle with an idempotent close()', () => {
    const backend = createNodeBackend();
    const watcher = backend.watch(asLerretPath(workDir), () => {});

    expect(typeof watcher.close).toBe('function');
    // Idempotent — calling close() repeatedly must not throw.
    expect(() => {
      watcher.close();
      watcher.close();
    }).not.toThrow();
  });

  it('emits a raw change event when a watched file changes', async () => {
    // ── Why this test was flaky, and how the polling version below fixes it ──
    // The original assertion paused a fixed 150 ms after writing `v2` and then
    // checked that any event had been delivered. `fs.watch` on macOS is
    // particularly bursty: at idle, the event arrives in well under 150 ms; on
    // a loaded runner (e.g. the full workspace test suite running in
    // parallel) the OS sometimes coalesces or simply delays delivery past
    // 150 ms, and the test would intermittently fail. Polling on the
    // condition (with a generous OVERALL timeout) makes the assertion succeed
    // the moment the event lands — fast on idle, patient under load — and
    // removes the timing race that produced the flake.
    const target = join(workDir, 'watched.txt');
    await fsp.writeFile(target, 'v1');

    const backend = createNodeBackend();
    const events = [];
    const watcher = backend.watch(asLerretPath(workDir), (e) => {
      events.push(e);
    });

    try {
      // Write the change AFTER attaching the listener so the event is
      // guaranteed to be observable. (`fs.watch` does not buffer past events.)
      await fsp.writeFile(target, 'v2');

      // Re-issue the write a few times if no event has arrived yet. Some
      // editors / atomic-rename sequences land as a single rename that
      // `fs.watch` delivers immediately; a plain truncate-and-write under a
      // loaded runner sometimes takes longer to surface. Retrying the write
      // costs nothing on the happy path and keeps the test honest on slow
      // hosts without crossing into "ten-second test".
      const start = Date.now();
      const timeoutMs = 4000;
      const pollMs = 25;
      let retried = false;
      while (events.length === 0) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `watch test: no event delivered within ${timeoutMs} ms (events: ${events.length})`,
          );
        }
        if (!retried && Date.now() - start > 200) {
          retried = true;
          await fsp.writeFile(target, 'v3');
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      expect(events.length).toBeGreaterThan(0);
      expect(['rename', 'change']).toContain(events[0].kind);
    } finally {
      watcher.close();
    }
  });
});

describe('realpathOrSelf — CLI-internal helper for `lerret dev` fs.allow', () => {
  it('resolves a real on-disk path through any symlinks in its chain', async () => {
    // Create a target dir + a symlink to it; resolving the symlink path
    // must yield the target's real path. We compute the expected target
    // through `realpathOrSelf` itself so the assertion is robust to
    // platform-level symlinks above `workDir` (e.g. macOS's
    // `/var` -> `/private/var`).
    const target = join(workDir, 'real-dir');
    const link = join(workDir, 'linked-dir');
    await fsp.mkdir(target);
    await fsp.symlink(target, link);

    const expected = realpathOrSelf(target);
    expect(realpathOrSelf(link)).toBe(expected);
  });

  it('returns the input unchanged when the path does not exist', () => {
    // A path that does not exist on disk is not a `realpath` operation we
    // can complete — but the helper must NOT throw on ENOENT
    // (`dev.js` calls it before checking the project exists, and even when
    // the project is missing the dev server should still boot in no-folder
    // mode). The original string is returned so the caller can present a
    // useful diagnostic.
    const ghost = join(workDir, 'never-existed');
    expect(realpathOrSelf(ghost)).toBe(ghost);
  });
});
