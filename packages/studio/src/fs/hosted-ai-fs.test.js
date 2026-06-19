// hosted-ai-fs.test.js — the hosted-mode AI filesystem bridge (Epic 10 follow-up).
//
// Covers the path translation (virtual `/hosted` root ↔ `.lerret/…`-relative
// backend), the ENOENT discipline the snapshot store relies on, binary
// round-trips, the registry, and an end-to-end pass through the real
// `createSandbox` (proving the virtual projectRoot satisfies its arg checks and
// the sandbox's `.lerret/` containment still holds).

import { describe, it, expect, afterEach } from 'vitest';
import { createSandbox } from '@lerret/core';

import { createMemoryBackend } from './memory-backend.js';
import {
  createHostedAiFs,
  HOSTED_AI_PROJECT_ROOT,
  setHostedAiFs,
  getHostedAiFs,
} from './hosted-ai-fs.js';

const ROOT = HOSTED_AI_PROJECT_ROOT; // '/hosted'

describe('createHostedAiFs — construction', () => {
  it('throws without a backend', () => {
    expect(() => createHostedAiFs(null)).toThrow(/backend is required/);
    expect(() => createHostedAiFs({})).toThrow(/backend is required/);
  });

  it('satisfies the FilesystemAccess contract (accepted by createSandbox)', () => {
    const fs = createHostedAiFs(createMemoryBackend());
    // createSandbox runs assertFilesystemContract on fs; no throw ⇒ contract met.
    expect(() => createSandbox({ projectRoot: ROOT, fs })).not.toThrow();
  });
});

describe('createHostedAiFs — path translation', () => {
  it('writes a virtual-absolute path to the backend-relative path', async () => {
    const backend = createMemoryBackend();
    const fs = createHostedAiFs(backend);
    await fs.writeFile(`${ROOT}/.lerret/page/Card.jsx`, 'export default 1');
    // On disk it lands at the `.lerret/…`-relative path (no `/hosted` prefix).
    expect(await backend.readFile('.lerret/page/Card.jsx')).toBe('export default 1');
  });

  it('reads back a seeded file by its virtual-absolute path', async () => {
    const backend = createMemoryBackend({ '.lerret/welcome/Welcome.jsx': 'hi' });
    const fs = createHostedAiFs(backend);
    expect(await fs.readFile(`${ROOT}/.lerret/welcome/Welcome.jsx`)).toBe('hi');
  });

  it('rejects a path outside the virtual project root with an ENOENT-shaped error', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    await expect(fs.readFile('/elsewhere/x.jsx')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('createHostedAiFs — readDir', () => {
  it('returns entries with virtual-absolute paths', async () => {
    const backend = createMemoryBackend({
      '.lerret/welcome/Welcome.jsx': 'a',
      '.lerret/welcome/Card.jsx': 'b',
    });
    const fs = createHostedAiFs(backend);
    const entries = await fs.readDir(`${ROOT}/.lerret/welcome`);
    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['Welcome.jsx'].path).toBe(`${ROOT}/.lerret/welcome/Welcome.jsx`);
    expect(byName['Welcome.jsx'].isFile).toBe(true);
    expect(byName['Welcome.jsx'].kind).toBe('file');
  });

  it('returns [] for a directory that does not exist yet (history bootstrap)', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    expect(await fs.readDir(`${ROOT}/.lerret/.state/history/manifests`)).toEqual([]);
  });
});

describe('createHostedAiFs — binary round-trip', () => {
  it('writes and reads back raw bytes (no base64 hop)', async () => {
    const backend = createMemoryBackend();
    const fs = createHostedAiFs(backend);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await fs.writeFile(`${ROOT}/.lerret/logo.png`, bytes);
    const back = await fs.readFile(`${ROOT}/.lerret/logo.png`, { encoding: 'binary' });
    expect(back).toBeInstanceOf(Uint8Array);
    expect(Array.from(back)).toEqual([0, 1, 2, 250, 255]);
  });
});

describe('createHostedAiFs — ENOENT discipline', () => {
  it('readFile of a missing file throws code ENOENT', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    await expect(fs.readFile(`${ROOT}/.lerret/missing.jsx`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('deleteFile of a missing file is a no-op success', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    await expect(fs.deleteFile(`${ROOT}/.lerret/missing.jsx`)).resolves.toBeUndefined();
  });

  it('removeDir of a missing dir is a no-op success', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    await expect(fs.removeDir(`${ROOT}/.lerret/missing`)).resolves.toBeUndefined();
  });

  it('exists reports false for a missing target (never throws)', async () => {
    const fs = createHostedAiFs(createMemoryBackend());
    expect(await fs.exists(`${ROOT}/.lerret/missing.jsx`)).toBe(false);
  });
});

describe('createHostedAiFs — mkdir / exists / delete happy paths', () => {
  it('mkdir then exists, write, delete', async () => {
    const backend = createMemoryBackend();
    const fs = createHostedAiFs(backend);
    await fs.mkdir(`${ROOT}/.lerret/social`);
    expect(await fs.exists(`${ROOT}/.lerret/social`)).toBe(true);
    await fs.writeFile(`${ROOT}/.lerret/social/Banner.jsx`, 'x');
    expect(await fs.exists(`${ROOT}/.lerret/social/Banner.jsx`)).toBe(true);
    await fs.deleteFile(`${ROOT}/.lerret/social/Banner.jsx`);
    expect(await fs.exists(`${ROOT}/.lerret/social/Banner.jsx`)).toBe(false);
  });
});

describe('createHostedAiFs — through createSandbox (containment still enforced)', () => {
  it('allows writes under .lerret/ and reaches the backend', async () => {
    const backend = createMemoryBackend({ '.lerret/config.json': '{}' });
    const sandbox = createSandbox({ projectRoot: ROOT, fs: createHostedAiFs(backend) });
    // A relative path is normalized against the virtual projectRoot.
    await sandbox.writeFile('.lerret/page/Card.jsx', 'export default 2');
    expect(await backend.readFile('.lerret/page/Card.jsx')).toBe('export default 2');
  });

  it('blocks writes outside .lerret/ (SandboxViolationError, backend untouched)', async () => {
    const backend = createMemoryBackend();
    const sandbox = createSandbox({ projectRoot: ROOT, fs: createHostedAiFs(backend) });
    await expect(sandbox.writeFile(`${ROOT}/evil.js`, 'x')).rejects.toMatchObject({
      name: 'SandboxViolationError',
    });
  });

  it('lists a page directory through the sandbox', async () => {
    const backend = createMemoryBackend({ '.lerret/welcome/Welcome.jsx': 'a' });
    const sandbox = createSandbox({ projectRoot: ROOT, fs: createHostedAiFs(backend) });
    const entries = await sandbox.listDir('.lerret/welcome');
    expect(entries.map((e) => e.name)).toContain('Welcome.jsx');
  });
});

describe('hosted AI fs registry', () => {
  afterEach(() => setHostedAiFs(null));

  it('defaults to null', () => {
    expect(getHostedAiFs()).toBeNull();
  });

  it('round-trips a registered adapter and clears on null', () => {
    const fs = createHostedAiFs(createMemoryBackend());
    setHostedAiFs(fs);
    expect(getHostedAiFs()).toBe(fs);
    setHostedAiFs(null);
    expect(getHostedAiFs()).toBeNull();
  });
});
