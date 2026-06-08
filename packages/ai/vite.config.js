// Vite library-mode build for the @lerret/ai bundle spike (Story 8.0).
//
// Bundles EVERY dependency into a single ESM chunk so the measurement reflects
// what a user's browser actually loads when the studio dynamic-imports
// @lerret/ai. Vite library-mode externalizes deps by default — we explicitly
// override that with `rollupOptions.external: []` and `inlineDynamicImports`.
//
// The rollup-plugin-visualizer call MUST sit LAST in the plugins array, per the
// plugin's docs (last-position is required for accurate measurements after
// esbuild minification).

import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    build: {
        lib: {
            entry: fileURLToPath(new URL('src/index.js', import.meta.url)),
            formats: ['es'],
            fileName: () => 'index.js',
        },
        outDir: 'dist',
        sourcemap: true,
        // Vite 8 switched to Oxc/Rolldown by default. minify:true uses the
        // built-in (oxc-minify); no separate esbuild install needed.
        minify: true,
        target: 'es2022',
        rollupOptions: {
            external: [], // bundle EVERYTHING — the spike's whole point
        },
        // Disable Vite's CSS code-splitting warning; we have no CSS
        cssCodeSplit: false,
    },
    plugins: [
        // MUST be the last plugin — accurate measurements depend on running
        // after every other transform (esbuild minify in particular).
        visualizer({
            template: 'raw-data',
            filename: 'dist/bundle-stats.json',
            gzipSize: true,
            brotliSize: false,
            sourcemap: true,
            // Don't auto-open in a browser when the build runs in CI / scripts.
            open: false,
        }),
    ],
});
