// Tests for the CLI-mode chokidar watcher — `watcher.js`.
//
// These are integration-flavored: chokidar drives real `fs.watch` against a
// temporary directory on disk and we assert the watcher emits the
// normalized `{ type, path }` shape for add / change / remove. The events
// arrive asynchronously, so the suite polls (`waitFor`) with a generous
// overall timeout — never a fixed-time sleep — so the same test stays
// stable whether the runner is idle or under concurrent load.

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  it,
  expect,
} from 'vitest';

import { startWatcher } from './watcher.js';

/** A fresh scratch directory per test, removed afterwards. @type {string} */
let workDir;

beforeEach(async () => {
  workDir = await fsp.mkdtemp(join(tmpdir(), 'lerret-watcher-test-'));
});

afterEach(async () => {
  await fsp.rm(workDir, { recursive: true, force: true });
});

/** Convert an OS path to the forward-slash form the contract emits. */
function asLerretPath(p) {
  return p.replaceAll('\\', '/');
}

/**
 * Poll `predicate` until it returns truthy or `timeoutMs` elapses. Used in
 * place of a fixed `setTimeout` so the assertion succeeds the moment the
 * watcher delivers — fast on an idle machine, patient under load.
 *
 * @param {() => unknown} predicate
 * @param {{ timeoutMs?: number, intervalMs?: number, label?: string }} [opts]
 * @returns {Promise<void>}
 */
async function waitFor(predicate, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const intervalMs = opts.intervalMs ?? 30;
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitFor: condition${opts.label ? ` "${opts.label}"` : ''} not met within ${timeoutMs}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe('startWatcher (chokidar-backed)', () => {
  it('emits an add event when a new file appears under the watched root', async () => {
    /** @type {import('@lerret/core').WatchEvent[]} */
    const events = [];
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: (e) => events.push(e),
    });

    try {
      await handle.ready;
      // macOS FSEvents needs a brief settle window after chokidar's `ready`
      // before it reliably reports new entries; otherwise the first action
      // can race the watcher's underlying kqueue/FSEvents subscription.
      await new Promise((r) => setTimeout(r, 200));
      const target = join(workDir, 'Hero.jsx');
      await fsp.writeFile(target, 'export default () => null;');
      await waitFor(
        () => events.some((e) => e.type === 'add' && e.path === asLerretPath(target)),
        { label: 'add Hero.jsx', timeoutMs: 15000 },
      );
      const add = events.find((e) => e.type === 'add');
      expect(add).toMatchObject({ type: 'add', path: asLerretPath(target) });
      expect(add.path).not.toContain('\\');
      // The kind rides the event so the loader's classifier never guesses from
      // the extension — a file add is flagged isDirectory:false.
      expect(add.isDirectory).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('emits a change event when an existing file is modified', async () => {
    const target = join(workDir, 'watched.txt');
    await fsp.writeFile(target, 'v1');

    /** @type {import('@lerret/core').WatchEvent[]} */
    const events = [];
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: (e) => events.push(e),
      // Shorten the awaitWriteFinish debounce so the test does not block on
      // the default stability window longer than it has to.
      options: { awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 } },
    });

    try {
      await handle.ready;
      await fsp.writeFile(target, 'v2');
      await waitFor(
        () => events.some((e) => e.type === 'change' && e.path === asLerretPath(target)),
        { label: 'change watched.txt', timeoutMs: 15000 },
      );
      const change = events.find((e) => e.type === 'change');
      expect(change).toMatchObject({ type: 'change', path: asLerretPath(target) });
    } finally {
      await handle.close();
    }
  });

  it('emits a remove event when a file is unlinked', async () => {
    const target = join(workDir, 'doomed.jsx');
    await fsp.writeFile(target, 'export default () => null;');

    /** @type {import('@lerret/core').WatchEvent[]} */
    const events = [];
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: (e) => events.push(e),
    });

    try {
      await handle.ready;
      await fsp.rm(target);
      await waitFor(
        () => events.some((e) => e.type === 'remove' && e.path === asLerretPath(target)),
        { label: 'remove doomed.jsx', timeoutMs: 15000 },
      );
    } finally {
      await handle.close();
    }
  });

  it('emits an add event for a newly created subdirectory', async () => {
    /** @type {import('@lerret/core').WatchEvent[]} */
    const events = [];
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: (e) => events.push(e),
    });

    try {
      await handle.ready;
      await new Promise((r) => setTimeout(r, 200));
      const newGroup = join(workDir, 'cards');
      await fsp.mkdir(newGroup);
      await waitFor(
        () => events.some((e) => e.type === 'add' && e.path === asLerretPath(newGroup)),
        { label: 'add cards/', timeoutMs: 15000 },
      );
      // A directory add is flagged isDirectory:true (chokidar's addDir) — the
      // signal the classifier needs to tell a folder from a dotted file name.
      const dirAdd = events.find((e) => e.type === 'add' && e.path === asLerretPath(newGroup));
      expect(dirAdd.isDirectory).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it('tags a non-asset companion file (Name.config.json) as a file, not a folder', async () => {
    /** @type {import('@lerret/core').WatchEvent[]} */
    const events = [];
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: (e) => events.push(e),
    });

    try {
      await handle.ready;
      await new Promise((r) => setTimeout(r, 200));
      const cfg = join(workDir, 'Clock.config.json');
      await fsp.writeFile(cfg, '{ "autoRefresh": 1000 }');
      await waitFor(
        () => events.some((e) => e.type === 'add' && e.path === asLerretPath(cfg)),
        { label: 'add Clock.config.json', timeoutMs: 15000 },
      );
      const add = events.find((e) => e.type === 'add' && e.path === asLerretPath(cfg));
      // Crux of the phantom-group fix: a `.json` companion must be flagged a
      // file so `applyWatchEvent` treats it as 'irrelevant', not a new group.
      expect(add.isDirectory).toBe(false);
    } finally {
      await handle.close();
    }
  });

  it('close() is idempotent — calling twice is safe', async () => {
    const handle = startWatcher({
      root: asLerretPath(workDir),
      onEvent: () => {},
    });
    await handle.ready;
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('rejects on a malformed argument bag', () => {
    expect(() => startWatcher({ root: '', onEvent: () => {} })).toThrow(/root/);
    expect(() =>
      startWatcher({ root: asLerretPath(workDir), onEvent: /** @type {any} */ (null) }),
    ).toThrow(/onEvent/);
  });
});
