// Tests for hosted-recents.js (Epic 10 / H7) — recent-project persistence,
// exercised through an injected in-memory store (no IndexedDB needed).

import { describe, it, expect, beforeEach } from 'vitest';

import { setRecentsStore, listRecents, rememberRecent, forgetRecent } from './hosted-recents.js';

function memoryStore() {
  const map = new Map();
  return {
    async getAll() { return [...map.values()]; },
    async put(e) { map.set(e.id, e); },
    async remove(id) { map.delete(id); },
  };
}

describe('hosted-recents (Epic 10 / H7)', () => {
  beforeEach(() => setRecentsStore(memoryStore()));

  it('remembers a project and lists it back', async () => {
    const handle = { name: 'proj-a' };
    await rememberRecent('proj-a', handle);
    const recents = await listRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ id: 'proj-a', name: 'proj-a', handle });
    expect(typeof recents[0].lastOpened).toBe('number');
  });

  it('sorts most-recently-opened first', async () => {
    await rememberRecent('old', {});
    await new Promise((r) => setTimeout(r, 5));
    await rememberRecent('new', {});
    expect((await listRecents()).map((r) => r.name)).toEqual(['new', 'old']);
  });

  it('re-remembering the same name updates it (no duplicate)', async () => {
    await rememberRecent('proj', { v: 1 });
    await rememberRecent('proj', { v: 2 });
    const recents = await listRecents();
    expect(recents).toHaveLength(1);
    expect(recents[0].handle).toEqual({ v: 2 });
  });

  it('forgets a project', async () => {
    await rememberRecent('a', {});
    await rememberRecent('b', {});
    await forgetRecent('a');
    expect((await listRecents()).map((r) => r.name)).toEqual(['b']);
  });

  it('returns [] when the store throws (best-effort, never breaks the screen)', async () => {
    setRecentsStore({
      getAll: async () => { throw new Error('idb gone'); },
      put: async () => {},
      remove: async () => {},
    });
    expect(await listRecents()).toEqual([]);
  });
});
