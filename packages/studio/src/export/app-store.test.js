// app-store.test.js — App Store size matching and the ZIP layout.

import { afterEach, describe, expect, it, vi } from 'vitest';

// fflate is stubbed in tests (vitest.config.js) — record what gets zipped.
const zipped = vi.hoisted(() => ({ files: null }));
vi.mock('fflate', () => ({
  zipSync: (files) => {
    zipped.files = files;
    return new Uint8Array([0]);
  },
}));

import { appStoreDeviceFor, collectAppStoreDesigns, buildAppStoreZip, deviceFolder } from './app-store.js';

afterEach(() => {
  document.body.innerHTML = '';
});

function design(label, w, h) {
  return `<div data-dc-slot="${label}" data-dc-label="${label}" data-dc-w="${w}" data-dc-h="${h}"><div class="dc-card"></div></div>`;
}

describe('appStoreDeviceFor', () => {
  it('matches accepted sizes in either orientation', () => {
    expect(appStoreDeviceFor(1320, 2868)).toBe('iPhone 6.9″');
    expect(appStoreDeviceFor(2868, 1320)).toBe('iPhone 6.9″');
    expect(appStoreDeviceFor(2064, 2752)).toBe('iPad 13″');
    expect(appStoreDeviceFor(1080, 1080)).toBeNull();
    expect(deviceFolder('iPhone 6.9″')).toBe('iPhone 6.9-inch');
  });
});

describe('collectAppStoreDesigns + buildAppStoreZip', () => {
  it('exports matching designs at exact size into device folders and lists the rest', async () => {
    document.body.innerHTML = `<section>${design('Launch', 1320, 2868)}${design('Feature', 1320, 2868)}${design('Square', 1080, 1080)}${design('Tablet', 2048, 2732)}</section>`;
    const found = collectAppStoreDesigns(document.body);
    expect(found.ready.map((d) => d.label)).toEqual(['Launch', 'Feature', 'Tablet']);
    expect(found.skipped).toEqual([{ label: 'Square', width: 1080, height: 1080 }]);

    const capture = vi.fn(async () => ({ blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) }));
    const { blob, failed } = await buildAppStoreZip(found.ready, { capture });
    expect(failed).toEqual([]);
    expect(blob.type).toBe('application/zip');
    expect(capture).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ format: 'jpg', pixelRatio: 1 }));
    const entries = Object.keys(zipped.files).sort();
    expect(entries).toEqual(['iPad 13-inch/01 Tablet.jpg', 'iPhone 6.9-inch/01 Launch.jpg', 'iPhone 6.9-inch/02 Feature.jpg']);
  });

  it('reports a design whose capture fails, and keeps going', async () => {
    document.body.innerHTML = design('A', 1320, 2868) + design('B', 1320, 2868);
    const { ready } = collectAppStoreDesigns(document.body);
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ blob: new Blob([new Uint8Array([1])]) });
    const { failed } = await buildAppStoreZip(ready, { capture });
    expect(failed).toEqual(['A']);
  });
});
