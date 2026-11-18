// Vite config for the studio's MCP App build (plan-mcp-app-studio.md).
//
// Output: ONE self-contained `dist-embed/lerret-app.html`. Chat hosts serve an
// MCP App as an HTML string in a sandbox whose CSP allows only inline scripts
// (no relative chunks, no blob:, no eval), so every chunk, the CSS and small
// assets are inlined. `@lerret/cli mcp` serves this file as its ui:// resource.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createSourceStampPlugin } from '@lerret/core/source-edit';

import { virtualLerretProjectShim } from './vite.config.js';

const studioDir = dirname(fileURLToPath(import.meta.url));

/** `</script` inside inlined code would end the tag early. */
const safeScript = (code) => code.replace(/<\/(script)/gi, '<\\/$1');

/** Fold the single JS chunk and the CSS into the HTML, then drop them. */
function inlineIntoHtml() {
  return {
    name: 'lerret:inline-embed',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName.endsWith('.html'));
      if (!html) return;
      let out = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          out = out.replace(
            new RegExp(`<script[^>]*src="[^"]*${file.fileName.split('/').pop()}"[^>]*></script>`),
            // With code splitting off Vite leaves its preload-list placeholder unset.
            () => `<script type="module">${safeScript(file.code.replaceAll('__VITE_PRELOAD__', 'void 0'))}</script>`,
          );
          delete bundle[name];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          out = out.replace(
            new RegExp(`<link[^>]*href="[^"]*${file.fileName.split('/').pop()}"[^>]*>`),
            () => `<style>${String(file.source)}</style>`,
          );
          delete bundle[name];
        }
      }
      html.source = out;
    },
  };
}

export default defineConfig({
  root: studioDir,
  base: './',
  publicDir: false,
  plugins: [react(), createSourceStampPlugin(), virtualLerretProjectShim(), inlineIntoHtml()],
  resolve: {
    // The chat's model is the designer here: drop the studio's own AI (~0.9 MB).
    alias: [{ find: /^@lerret\/ai$/, replacement: resolve(studioDir, 'src/embed/no-ai.js') }],
  },
  build: {
    outDir: 'dist-embed',
    emptyOutDir: true,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    // One file, no chunks: there is nothing to preload (and the helper's
    // placeholder is left undefined when code splitting is off).
    modulePreload: false,
    rollupOptions: {
      input: resolve(studioDir, 'embed.html'),
      output: { codeSplitting: false },
    },
  },
});
