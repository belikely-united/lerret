// Vitest project config for @lerret/core.
// core is environment-agnostic, so tests run in the default Node environment.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
