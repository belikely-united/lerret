// Root Vitest config — runs tests across every workspace package.
//
// Tests are co-located next to their source as `*.test.js(x)` (the Vitest
// convention adopted project-wide). Each package can add its own
// `vitest.config.js` for environment-specific needs (e.g. the studio uses a
// DOM environment); this root config discovers them via `projects`.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
