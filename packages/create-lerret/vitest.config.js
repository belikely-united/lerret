// Vitest project config for create-lerret.
// The scaffolder is Node-only, so tests run in the Node environment.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'create-lerret',
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
});
