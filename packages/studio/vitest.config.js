// Vitest project config for @lerret/studio.
//
// The studio is browser-only, so tests run in a jsdom DOM environment. Story
// 1.1 ships no studio unit tests (the migration is verified by a successful
// `vite build` + dev-server boot); this config is the seat later UX-spec
// component stories will fill with `*.test.jsx` files.

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
 plugins: [react()],
 resolve: {
 alias: {
 // During tests, point fflate at the local stub so Vite can resolve the
 // import before the real package is installed by the orchestrator.
 // This alias is only active in test/dev; the production build uses the
 // real fflate once `pnpm install` has run.
 fflate: resolve(__dirname, '__mocks__/fflate.js'),
 },
 },
 test: {
 name: 'studio',
 environment: 'jsdom',
 include: ['src/**/*.{test,spec}.{js,jsx}'],
 },
});
