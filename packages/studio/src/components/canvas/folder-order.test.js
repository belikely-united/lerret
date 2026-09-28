import { describe, it, expect } from 'vitest';

import { sortByFolderOrder } from './project-canvas.jsx';

const names = (list) => list.map((x) => x.n);
const byName = (x) => x.n;
const items = ['a.jsx', 'b.jsx', 'Group', 'c.md'].map((n) => ({ n }));

describe('sortByFolderOrder (config.json `order`)', () => {
  it('puts listed children first, in the saved order', () => {
    expect(names(sortByFolderOrder(items, { order: ['c.md', 'Group'] }, byName))).toEqual(['c.md', 'Group', 'a.jsx', 'b.jsx']);
  });

  it('keeps unlisted (new) children in their existing order after the listed ones', () => {
    expect(names(sortByFolderOrder(items, { order: ['b.jsx'] }, byName))).toEqual(['b.jsx', 'a.jsx', 'Group', 'c.md']);
  });

  it('ignores stale names and a missing or malformed order', () => {
    expect(names(sortByFolderOrder(items, { order: ['gone.jsx', 'c.md'] }, byName))).toEqual(['c.md', 'a.jsx', 'b.jsx', 'Group']);
    expect(sortByFolderOrder(items, {}, byName)).toBe(items);
    expect(sortByFolderOrder(items, { order: 'nope' }, byName)).toBe(items);
  });

  it('keeps a file\'s variants together and in their own order', () => {
    const entries = [{ n: 'a.jsx', v: 1 }, { n: 'a.jsx', v: 2 }, { n: 'b.jsx', v: 1 }];
    const out = sortByFolderOrder(entries, { order: ['b.jsx', 'a.jsx'] }, byName);
    expect(out.map((e) => `${e.n}#${e.v}`)).toEqual(['b.jsx#1', 'a.jsx#1', 'a.jsx#2']);
  });
});
