import { describe, it, expect } from 'vitest';

import { DEMO_FILES } from './opfs-demo.js';

// `DEMO_FILES` is the manifest "Try a demo" writes into OPFS. It is assembled
// at build time from the raw files under `demo-project/files/**` via
// `import.meta.glob`, so these assertions also prove the glob picked the
// project up — without needing an OPFS-capable environment.
describe('opfs-demo DEMO_FILES manifest', () => {
  const paths = Object.keys(DEMO_FILES);
  const GROUPS = ['brand', 'social', 'live', 'launch', 'slides', 'site'];

  it('seeds a root config + a folder-level README', () => {
    expect(paths).toContain('config.json');
    expect(paths).toContain('README.md');
  });

  it('puts every design on the single showcase page', () => {
    const assetPaths = paths
      .filter((p) => p.endsWith('.jsx') || p.endsWith('.md'))
      .filter((p) => p !== 'README.md');
    expect(assetPaths.length).toBeGreaterThan(0);
    expect(assetPaths.every((p) => p.startsWith('showcase/'))).toBe(true);
  });

  it('organizes the assets into tinted, documented groups', () => {
    for (const group of GROUPS) {
      expect(
        paths.some((p) => p.startsWith(`showcase/${group}/`) && p.endsWith('.jsx')),
      ).toBe(true); // at least one design
      expect(paths).toContain(`showcase/${group}/config.json`); // a section tint
      expect(paths).toContain(`showcase/${group}/about.md`); // a note
    }
  });

  it('every group config carries a presentation background tint', () => {
    for (const group of GROUPS) {
      const cfg = JSON.parse(DEMO_FILES[`showcase/${group}/config.json`]);
      expect(cfg.presentation.background).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('includes the capability-showcase assets + the canvas intro doc', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        '_assets/lerret-mark.svg',
        'showcase/Welcome.jsx',
        'showcase/overview.md',
        'showcase/brand/logo.jsx',
        'showcase/brand/color-tokens.jsx',
        'showcase/brand/business-card.jsx',
        'showcase/brand/business-card.data.json', // data-driven props
        'showcase/social/instagram-square.jsx',
        'showcase/live/Clock.jsx',
        'showcase/live/Clock.config.json', // auto-refresh sidecar
        'showcase/launch/gallery-slide.jsx',
        'showcase/slides/title-slide.jsx',
        'showcase/slides/section-divider.data.json', // multi-variant data
        'showcase/site/og-image.jsx',
      ]),
    );
  });

  it('every entry is non-empty file text', () => {
    for (const [path, content] of Object.entries(DEMO_FILES)) {
      expect(typeof content, path).toBe('string');
      expect(content.length, path).toBeGreaterThan(0);
    }
  });

  it('the root config defines the unified Lerret brand vars', () => {
    const config = JSON.parse(DEMO_FILES['config.json']);
    expect(config.vars.brand).toBe('Lerret');
    expect(config.vars.brandColor).toBeTruthy();
    expect(config.vars.neutralLight).toBeTruthy();
  });

  it('the auto-refresh sidecars carry a numeric interval', () => {
    expect(JSON.parse(DEMO_FILES['showcase/live/Clock.config.json']).autoRefresh).toBe(1000);
    expect(JSON.parse(DEMO_FILES['showcase/live/Counter.config.json']).autoRefresh).toBe(100);
  });
});
