// hosted-images.test.js — registering a hosted project's images with the SW.

import { describe, it, expect, vi } from 'vitest';

import { createMemoryBackend } from '../fs/memory-backend.js';
import { registerProjectImages, imageMime } from './hosted-images.js';

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

describe('registerProjectImages', () => {
  it('walks .lerret/ and registers each image (binary) keyed by its relative path', async () => {
    const backend = createMemoryBackend({
      '.lerret/welcome/Welcome.jsx': 'export default () => null',
      '.lerret/welcome/Welcome.data.json': '{}',
      '.lerret/_assets/logo.png': new Uint8Array([1, 2, 3]),
      '.lerret/social/card-logo.png': new Uint8Array([9, 8]),
    });
    const sw = { postMessage: vi.fn() };
    const count = await registerProjectImages(backend, sw);
    expect(count).toBe(2);
    const msgs = sw.postMessage.mock.calls.map((c) => c[0]);
    expect(msgs.every((m) => m.type === 'REGISTER_BINARY')).toBe(true);
    const byKey = Object.fromEntries(msgs.map((m) => [m.key, m]));
    // Keyed by the path RELATIVE to .lerret/ (so the SW can match the <img> tail).
    expect(byKey['_assets/logo.png'].contentType).toBe('image/png');
    expect(Array.from(byKey['_assets/logo.png'].bytes)).toEqual([1, 2, 3]);
    expect(byKey['social/card-logo.png']).toBeTruthy();
    // The .jsx / .data.json are NOT registered as binary.
    expect(msgs.every((m) => m.key.endsWith('.png'))).toBe(true);
  });

  it('skips the .state snapshot sidecar', async () => {
    const backend = createMemoryBackend({
      '.lerret/_assets/logo.png': new Uint8Array([1]),
      '.lerret/.state/history/blob.png': new Uint8Array([2]),
    });
    const sw = { postMessage: vi.fn() };
    const count = await registerProjectImages(backend, sw);
    expect(count).toBe(1);
    expect(sw.postMessage.mock.calls[0][0].key).toBe('_assets/logo.png');
  });

  it('is a no-op without a usable fs or sw', async () => {
    expect(await registerProjectImages(null, { postMessage: () => {} })).toBe(0);
    expect(await registerProjectImages(createMemoryBackend(), null)).toBe(0);
    expect(await registerProjectImages(createMemoryBackend(), {})).toBe(0);
  });
});
