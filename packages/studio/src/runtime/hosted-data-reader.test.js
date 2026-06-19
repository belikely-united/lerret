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

  it('skips a .data.js candidate (json-only here) → null, so the loader falls through', async () => {
    const backend = createMemoryBackend({ '.lerret/x.data.js': 'export default { a: 1 }' });
    expect(await createHostedDataReader(backend)('.lerret/x.data.js')).toBeNull();
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
