// brand-store.test.js — loading, saving, and mirroring into config vars.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => new Map());
vi.mock('../../runtime/write-client.js', () => ({
  listProjectDir: vi.fn(async (dir) => ({
    ok: true,
    entries: [...files.keys()]
      .filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
      .map((p) => ({ name: p.slice(dir.length + 1), isFile: true, isDirectory: false })),
  })),
  readProjectFile: vi.fn(async (p) => (files.has(p) ? { ok: true, content: files.get(p) } : { ok: false })),
  writeProjectFile: vi.fn(async (p, c) => {
    files.set(p, c);
    return { ok: true };
  }),
}));

const store = await import('./brand-store.js');

const ROOT = '/p/.lerret';
const cfg = () => JSON.parse(files.get(`${ROOT}/config.json`));

beforeEach(() => {
  files.clear();
  store.__resetBrandStore();
});

describe('brand store', () => {
  it('starts empty for a project without a library, and offers the setup wizard', async () => {
    await store.loadBrand(ROOT, '/@lerret-project');
    expect(store.getBrandState()).toMatchObject({ loaded: true, setupOpen: true, exists: false, brand: { colors: [], textStyles: [], logos: [] } });
  });

  it('does not offer setup again once it was finished or skipped', async () => {
    files.set(`${ROOT}/_brand/brand.json`, JSON.stringify({ version: 2, setup: 'skipped', colors: [] }));
    await store.loadBrand(ROOT);
    expect(store.getBrandState().setupOpen).toBe(false);
  });

  it('saves brand.json and mirrors colours/fonts into root vars, keeping other vars', async () => {
    files.set(`${ROOT}/config.json`, JSON.stringify({ presentation: { background: '#fff' }, vars: { accent: '#f00', 'brand-stale': '#000' } }));
    await store.loadBrand(ROOT);
    await store.addColor({ name: 'Primary', value: '#2F5BFF' });
    await store.addTextStyle({ name: 'Heading', family: 'Poppins', size: 64, weight: 700 });

    expect(JSON.parse(files.get(`${ROOT}/_brand/brand.json`))).toMatchObject({
      colors: [{ id: 'primary', name: 'Primary', value: '#2F5BFF' }],
      textStyles: [{ id: 'heading', name: 'Heading', family: 'Poppins', size: 64, weight: 700, lineHeight: 1.3, letterSpacing: '0em' }],
    });
    expect(cfg()).toEqual({
      presentation: { background: '#fff' },
      vars: {
        accent: '#f00',
        'brand-primary': '#2F5BFF',
        'brand-text-heading-font': 'Poppins, sans-serif',
        'brand-text-heading-size': 64,
        'brand-text-heading-weight': 700,
        'brand-text-heading-line': 1.3,
        'brand-text-heading-tracking': '0em',
      },
    });
  });

  it('editing a colour updates its var; removing it drops the var', async () => {
    await store.loadBrand(ROOT);
    await store.addColor({ name: 'Primary', value: '#2F5BFF' });
    await store.updateColor('primary', { value: '#111111' });
    expect(cfg().vars['brand-primary']).toBe('#111111');
    await store.removeColor('primary');
    expect(cfg().vars).toBeUndefined();
  });

  it('loads an existing library', async () => {
    files.set(`${ROOT}/_brand/brand.json`, JSON.stringify({ colors: [{ id: 'ink', name: 'Ink', value: '#000' }] }));
    await store.loadBrand(ROOT);
    expect(store.getBrandState().brand.colors).toEqual([{ id: 'ink', name: 'Ink', value: '#000' }]);
  });

  it('builds logo URLs under the served project base, cache-busted', async () => {
    await store.loadBrand(ROOT, '/@lerret-project');
    expect(store.logoUrl('my logo.png')).toBe('/@lerret-project/_brand/my%20logo.png?v=0');
  });
});
