// Vitest project config for @lerret/animation.
// Tests cover the encoder interface, the boundary invariant (no static imports
// of @lerret/animation from sibling packages), and (later, per-encoder) the
// frame-capture loop. The boundary test is environment-agnostic so we run in
// Node; encoder-specific tests that need DOM/Canvas APIs declare their own env
// via `// @vitest-environment jsdom` headers when needed.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'animation',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
