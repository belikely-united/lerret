import { describe, it, expect, vi, beforeEach } from 'vitest';

// An in-memory "disk" behind the write-client.
const disk = new Map();
vi.mock('../../runtime/write-client.js', () => ({
  readProjectFile: vi.fn(async (p) => (disk.has(p) ? { ok: true, content: disk.get(p) } : { ok: false, missing: true })),
  writeProjectFile: vi.fn(async (p, c) => {
    disk.set(p, c);
    return { ok: true };
  }),
  deleteProjectFile: vi.fn(async (p) => {
    disk.delete(p);
    return { ok: true };
  }),
  inCliMode: () => true,
  hostedWritesEnabled: () => false,
}));
vi.mock('../editors/meta-editor.jsx', () => ({
  defaultReadAssetSource: async () => ({ ok: false, error: 'no dev server' }),
}));
let dataMap;
vi.mock('../../runtime/asset-data-registry.js', () => ({
  getAssetDataPath: (p) => (dataMap ? dataMap.get(p) ?? null : undefined),
}));

const {
  saveSourceEdit,
  saveDataEdit,
  createVariant,
  undo,
  redo,
  getEditState,
  withDataValue,
  __resetEditSession,
} = await import('./edit-session.js');

const CARD = '/p/.lerret/card.jsx';
const DATA = '/p/.lerret/card.data.json';
const SRC = `export default function Card({ name }) {
  return <div style={{ fontSize: 12 }}><h1>{name}</h1><p>Hello</p></div>;
}
`;
const at = (needle) => SRC.indexOf(needle);

beforeEach(() => {
  disk.clear();
  disk.set(CARD, SRC);
  dataMap = undefined;
  __resetEditSession();
});

describe('saveSourceEdit', () => {
  it('writes the surgically edited source and marks it saved', async () => {
    const res = await saveSourceEdit(CARD, at('<div'), { type: 'style', key: 'fontSize', value: 20, expectTag: 'div' });
    expect(res.ok).toBe(true);
    expect(disk.get(CARD)).toBe(SRC.replace('fontSize: 12', 'fontSize: 20'));
    expect(getEditState()).toMatchObject({ status: 'saved', canUndo: true, revision: 1 });
  });

  it('refuses code-driven values with a readable reason and does not write', async () => {
    const res = await saveSourceEdit(CARD, at('<h1>'), { type: 'text', value: 'x' });
    expect(res).toEqual({ ok: false, error: 'This text is set by code.' });
    expect(disk.get(CARD)).toBe(SRC);
    expect(getEditState().status).toBe('error');
  });

  it('runs saves one at a time so rapid edits both land', async () => {
    await Promise.all([
      saveSourceEdit(CARD, at('<p>'), { type: 'text', value: 'Hi' }),
      saveSourceEdit(CARD, at('<div'), { type: 'style', key: 'color', value: 'red' }),
    ]);
    expect(disk.get(CARD)).toContain('<p>Hi</p>');
    expect(disk.get(CARD)).toContain("color: 'red'");
  });
});

describe('undo / redo', () => {
  it('restores and re-applies the previous content', async () => {
    await saveSourceEdit(CARD, at('<p>'), { type: 'text', value: 'Hi' });
    const edited = disk.get(CARD);
    await undo();
    expect(disk.get(CARD)).toBe(SRC);
    expect(getEditState()).toMatchObject({ canUndo: false, canRedo: true });
    await redo();
    expect(disk.get(CARD)).toBe(edited);
  });

  it('undoing a data file that did not exist deletes it', async () => {
    await saveDataEdit(CARD, 'default', 'name', 'Ada');
    expect(JSON.parse(disk.get(DATA))).toEqual({ name: 'Ada' });
    await undo();
    expect(disk.has(DATA)).toBe(false);
  });
});

describe('saveDataEdit', () => {
  it('writes into the variant slot of a keyed data file', async () => {
    disk.set(DATA, JSON.stringify({ default: { name: 'A' }, Dark: { name: 'B' } }));
    dataMap = new Map([[CARD, DATA]]);
    await saveDataEdit(CARD, 'Dark', 'name', 'C');
    expect(JSON.parse(disk.get(DATA))).toEqual({ default: { name: 'A' }, Dark: { name: 'C' } });
  });

  it('never probes when the server says there is no data file', async () => {
    dataMap = new Map();
    const { readProjectFile } = await import('../../runtime/write-client.js');
    readProjectFile.mockClear();
    await saveDataEdit(CARD, 'default', 'name', 'Ada');
    expect(readProjectFile).not.toHaveBeenCalled();
    expect(disk.has(DATA)).toBe(true);
  });

  it('treats a .data.js file as read-only', async () => {
    dataMap = new Map([[CARD, '/p/.lerret/card.data.js']]);
    const res = await saveDataEdit(CARD, 'default', 'name', 'Ada');
    expect(res.ok).toBe(false);
  });

  it('withDataValue writes flat files flat', () => {
    expect(withDataValue({ name: 'A' }, 'default', 'name', 'B')).toEqual({ name: 'B' });
  });
});

describe('createVariant', () => {
  const SRC2 = `function Card({ name }) { return <h1>{name}</h1>; }
export default Card;
export const Complete = Card;
`;
  beforeEach(() => disk.set(CARD, SRC2));

  it('adds the export and a keyed data slot copied from the source variant', async () => {
    disk.set(DATA, JSON.stringify({ default: { name: 'A' }, Complete: { name: 'B' } }));
    dataMap = new Map([[CARD, DATA]]);
    const res = await createVariant(CARD, 'Dark', 'Complete');
    expect(res.ok).toBe(true);
    expect(disk.get(CARD)).toContain('export const Dark = Complete;');
    expect(JSON.parse(disk.get(DATA)).Dark).toEqual({ name: 'B' });
  });

  it('turns a flat data file into keyed slots so every variant keeps its content', async () => {
    disk.set(DATA, JSON.stringify({ name: 'Shared' }));
    dataMap = new Map([[CARD, DATA]]);
    await createVariant(CARD, 'Dark');
    expect(JSON.parse(disk.get(DATA))).toEqual({
      default: { name: 'Shared' }, Complete: { name: 'Shared' }, Dark: { name: 'Shared' },
    });
  });

  it('undoes as one step (source + data file)', async () => {
    dataMap = new Map();
    await createVariant(CARD, 'Dark');
    expect(disk.has(DATA)).toBe(true);
    await undo();
    expect(disk.get(CARD)).toBe(SRC2);
    expect(disk.has(DATA)).toBe(false);
    expect(getEditState().canUndo).toBe(false);
  });

  it('refuses a duplicate name without writing', async () => {
    const res = await createVariant(CARD, 'Complete');
    expect(res.ok).toBe(false);
    expect(disk.get(CARD)).toBe(SRC2);
  });
});
