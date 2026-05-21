// Sample test for @lerret/core — confirms Vitest runs across the workspace
// and the core entry point is importable.

import { describe, it, expect } from 'vitest';
import { version, CORE_PACKAGE } from './index.js';

describe('@lerret/core', () => {
  it('exposes a version string', () => {
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('identifies itself as the core package', () => {
    expect(CORE_PACKAGE).toBe('@lerret/core');
  });
});
