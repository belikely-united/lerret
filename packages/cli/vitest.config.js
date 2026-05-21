// Vitest project config for @lerret/cli.
// The CLI is Node-only, so tests run in the Node environment.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'cli',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
