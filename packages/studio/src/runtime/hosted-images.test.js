// hosted-images.test.js — registering a hosted project's images with the SW.

import { describe, it, expect, vi } from 'vitest';

import { createMemoryBackend } from '../fs/memory-backend.js';
import { registerProjectImages, imageMime, onSwMessage } from './hosted-images.js';

describe('imageMime', () => {
  it('maps the known image extensions (case-insensitive)', () => {
    expect(imageMime('logo.png')).toBe('image/png');
    expect(imageMime('A.JPG')).toBe('image/jpeg');
    expect(imageMime('a.jpeg')).toBe('image/jpeg');
    expect(imageMime('a.svg')).toBe('image/svg+xml');
    expect(imageMime('a.webp')).toBe('image/webp');
    expect(imageMime('a.gif')).toBe('image/gif');
    expect(imageMime('a.avif')).toBe('image/avif');
  });

  it('returns null for non-images', () => {
    expect(imageMime('Card.jsx')).toBeNull();
    expect(imageMime('Card.data.json')).toBeNull();
    expect(imageMime('noext')).toBeNull();
    expect(imageMime(null)).toBeNull();
  });
});

describe('registerProjectImages (on demand)', () => {
  // A fake navigator.serviceWorker that captures the page's message listener.
  const installSwContainer = () => {
    const listeners = [];
    vi.stubGlobal('navigator', { serviceWorker: { addEventListener: (_t, fn) => listeners.push(fn), controller: null } });
    return listeners;
  };
  const ask = async (keys) => {
    const source = { postMessage: vi.fn() };
    await onSwMessage({ data: { type: 'NEED_BINARY', id: 7, keys }, source });
    return source.postMessage.mock.calls.map((c) => c[0]);
  };

  it('reads nothing up front and turns on-demand images on', async () => {
    const listeners = installSwContainer();
    const backend = createMemoryBackend({ '.lerret/_assets/logo.png': new Uint8Array([1, 2, 3]) });
    const sw = { postMessage: vi.fn() };
    expect(await registerProjectImages(backend, sw)).toBe(0);
    expect(sw.postMessage.mock.calls.map((c) => c[0])).toEqual([{ type: 'ENABLE_IMAGES' }]);
    expect(listeners.length).toBeLessThanOrEqual(1); // installed once per page
  });

  it('answers a request with the first candidate that is a project image', async () => {
    installSwContainer();
    await registerProjectImages(createMemoryBackend({
      '.lerret/_library/ash/face.png': new Uint8Array([9, 8]),
    }), { postMessage: vi.fn() });
    const msgs = await ask(['@lerret-project/_library/ash/face.png', '_library/ash/face.png']);
    expect(msgs[0]).toMatchObject({ type: 'REGISTER_BINARY', key: '_library/ash/face.png', contentType: 'image/png' });
    expect(Array.from(msgs[0].bytes)).toEqual([9, 8]);
    expect(msgs[1]).toEqual({ type: 'BINARY_RESULT', id: 7, key: '_library/ash/face.png' });
  });

  it('replies "none" for missing files, non-images and ../ paths', async () => {
    installSwContainer();
    await registerProjectImages(createMemoryBackend({ '.lerret/a.jsx': 'x' }), { postMessage: vi.fn() });
    expect(await ask(['nope.png', 'a.jsx', '../secret.png'])).toEqual([{ type: 'BINARY_RESULT', id: 7, key: null }]);
  });

  it('is a no-op without a usable fs or sw', async () => {
    expect(await registerProjectImages(null, { postMessage: () => {} })).toBe(0);
    expect(await registerProjectImages(createMemoryBackend(), null)).toBe(0);
    expect(await registerProjectImages(createMemoryBackend(), {})).toBe(0);
  });
});
