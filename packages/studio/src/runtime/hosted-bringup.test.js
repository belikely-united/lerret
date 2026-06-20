// Tests for hosted-bringup.js (Epic 10 / Story H1.2) — pins the cold-start
// orchestration: order of steps + fs/sw wiring + error propagation. Uses the
// in-memory backend for a real model load; fakes the browser-coupled deps.

import { describe, it, expect, vi } from 'vitest';

import { createMemoryBackend } from '../fs/memory-backend.js';
import { loadHostedProject } from './hosted-loader.js';
import { bringUpHostedStudio } from './hosted-bringup.js';

/** Build a deps object whose browser-coupled pieces are fakes, with a real
 *  in-memory-backed loadProject so the model genuinely loads. */
function makeDeps(overrides = {}) {
  const backend = createMemoryBackend({
    '.lerret/config.json': JSON.stringify({ vars: { brand: '#B85B33' } }),
    '.lerret/marketing/Hero.jsx': 'export default () => null;',
  });
  const sw = { postMessage: vi.fn() };
  const runtime = { loadAsset: vi.fn(), dispose: vi.fn(), __tag: 'runtime' };
  const calls = [];
  const deps = {
    createBackend: vi.fn(() => { calls.push('createBackend'); return backend; }),
    registerServiceWorker: vi.fn(async () => { calls.push('registerServiceWorker'); return sw; }),
    applyReactImportMap: vi.fn(() => { calls.push('applyReactImportMap'); }),
    reactImportMapUrls: vi.fn(() => ({ react: '/r.js', jsxRuntime: '/j.js' })),
    loadProject: vi.fn(async (b) => { calls.push('loadProject'); return loadHostedProject(b); }),
    createRuntime: vi.fn((project, options) => { calls.push('createRuntime'); return { ...runtime, project, options }; }),
    ...overrides,
  };
  return { deps, backend, sw, calls };
}

describe('bringUpHostedStudio', () => {
  it('composes backend → SW → import-map → load → runtime and returns them', async () => {
    const { deps, backend, sw } = makeDeps();
    const result = await bringUpHostedStudio({ name: 'proj' }, deps);

    expect(deps.createBackend).toHaveBeenCalledWith({ name: 'proj' });
    expect(result.backend).toBe(backend);
    expect(result.sw).toBe(sw);
    // Runtime is bound to the SAME backend (fs) and SW bridge (sw).
    expect(deps.createRuntime).toHaveBeenCalledWith(result.project, { fs: backend, sw });
    expect(result.runtime.__tag).toBe('runtime');
    // The model actually loaded through the in-memory backend.
    expect(result.project.pages.map((p) => p.name)).toEqual(['marketing']);
    expect(result.cascadeEntries.find(([p]) => p === '.lerret/marketing')[1].vars.brand).toBe('#B85B33');
  });

  it('installs the React import map BEFORE loading any asset (order contract)', async () => {
    const { deps, calls } = makeDeps();
    await bringUpHostedStudio({}, deps);
    expect(calls).toEqual([
      'createBackend',
      'registerServiceWorker',
      'applyReactImportMap',
      'loadProject',
      'createRuntime',
    ]);
    expect(deps.applyReactImportMap).toHaveBeenCalledWith({ react: '/r.js', jsxRuntime: '/j.js' });
  });

  it('registers project images with the SW AFTER the runtime is built (when provided)', async () => {
    const order = [];
    const { deps, backend, sw } = makeDeps({
      createRuntime: vi.fn((project, options) => { order.push('createRuntime'); return { project, options }; }),
      registerImages: vi.fn(async () => { order.push('registerImages'); }),
    });
    await bringUpHostedStudio({}, deps);
    expect(deps.registerImages).toHaveBeenCalledWith(backend, sw);
    // Only after the runtime exists, so the SW is ready to serve them.
    expect(order).toEqual(['createRuntime', 'registerImages']);
  });

  it('propagates a service-worker registration failure (no runtime built)', async () => {
    const { deps } = makeDeps({
      registerServiceWorker: vi.fn(async () => { throw new Error('SW unsupported'); }),
    });
    await expect(bringUpHostedStudio({}, deps)).rejects.toThrow('SW unsupported');
    expect(deps.loadProject).not.toHaveBeenCalled();
    expect(deps.createRuntime).not.toHaveBeenCalled();
  });

  it('propagates a load failure (e.g. permission denied) without building a runtime', async () => {
    const { deps } = makeDeps({
      loadProject: vi.fn(async () => { throw new Error('Permission denied'); }),
    });
    await expect(bringUpHostedStudio({}, deps)).rejects.toThrow('Permission denied');
    expect(deps.createRuntime).not.toHaveBeenCalled();
  });
});
