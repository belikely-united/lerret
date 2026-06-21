// hosted-data-reader.test.js — the hosted-mode .data.json reader (Epic 10 follow-up).

import { describe, it, expect, afterEach } from 'vitest';

import { createMemoryBackend } from '../fs/memory-backend.js';
import {
  createHostedDataReader,
  setHostedDataReader,
  getHostedDataReader,
} from './hosted-data-reader.js';

describe('createHostedDataReader', () => {
  it('throws without a backend', () => {
    expect(() => createHostedDataReader(null)).toThrow(/backend is required/);
    expect(() => createHostedDataReader({})).toThrow(/backend is required/);
  });

  it('reads + parses a .data.json through the backend', async () => {
    const backend = createMemoryBackend({ '.lerret/social/card.data.json': '{"title":"Hi"}' });
    const read = createHostedDataReader(backend);
    expect(await read('.lerret/social/card.data.json')).toEqual({ title: 'Hi' });
  });

  it('returns null for a missing file (falls through to propsSchema defaults)', async () => {
    const read = createHostedDataReader(createMemoryBackend());
    expect(await read('.lerret/social/card.data.json')).toBeNull();
  });

  it('returns null for malformed JSON', async () => {
    const backend = createMemoryBackend({ '.lerret/x.data.json': '{ not json' });
    expect(await createHostedDataReader(backend)('.lerret/x.data.json')).toBeNull();
  });

  it('returns null for non-object JSON so defaults still apply', async () => {
    const backend = createMemoryBackend({ '.lerret/x.data.json': '42' });
    expect(await createHostedDataReader(backend)('.lerret/x.data.json')).toBeNull();
  });

  it('skips a .data.js candidate when no module loader is wired → null', async () => {
    const backend = createMemoryBackend({ '.lerret/x.data.js': 'export default { a: 1 }' });
    // No loadDataModule → a .data.js reads as null and the loader falls through.
    expect(await createHostedDataReader(backend)('.lerret/x.data.js')).toBeNull();
  });

  it('routes a .data.js / .data.ts candidate to loadDataModule and returns its value', async () => {
    const calls = [];
    const loadDataModule = async (path, opts) => {
      calls.push([path, opts]);
      return { live: 42 };
    };
    const read = createHostedDataReader(createMemoryBackend(), { loadDataModule });
    expect(await read('.lerret/live/Ticker.data.js', { bust: 7 })).toEqual({ live: 42 });
    expect(await read('.lerret/live/Ticker.data.ts')).toEqual({ live: 42 });
    // The candidate path + the bust opts are forwarded to the module loader.
    expect(calls[0]).toEqual(['.lerret/live/Ticker.data.js', { bust: 7 }]);
    // A .data.json is still read + parsed by the backend, not the module loader.
    const both = createHostedDataReader(
      createMemoryBackend({ '.lerret/a.data.json': '{"k":1}' }),
      { loadDataModule },
    );
    expect(await both('.lerret/a.data.json')).toEqual({ k: 1 });
  });

  it('degrades to null when loadDataModule throws or returns null (falls through)', async () => {
    const thrower = createHostedDataReader(createMemoryBackend(), {
      loadDataModule: async () => { throw new Error('boom'); },
    });
    expect(await thrower('.lerret/x.data.js')).toBeNull();
    const nuller = createHostedDataReader(createMemoryBackend(), {
      loadDataModule: async () => null,
    });
    expect(await nuller('.lerret/x.data.js')).toBeNull();
  });
});

describe('hosted data reader registry', () => {
  afterEach(() => setHostedDataReader(null));

  it('defaults to null', () => {
    expect(getHostedDataReader()).toBeNull();
  });

  it('round-trips a registered reader and clears on a non-function', () => {
    const fn = async () => ({});
    setHostedDataReader(fn);
    expect(getHostedDataReader()).toBe(fn);
    setHostedDataReader(null);
    expect(getHostedDataReader()).toBeNull();
  });
});
