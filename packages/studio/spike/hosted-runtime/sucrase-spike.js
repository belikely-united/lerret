// SPIKE — throwaway prototype. Excluded from vite build.
// Superseded by the real hosted runtime. Do not import from production code.
//
// sucrase-spike.js — in-browser Sucrase JSX/TSX transform for the spike.
//
// Uses Sucrase's browser-compatible transform to convert JSX/TSX source into
// plain ES-module JavaScript targeting React 19's automatic JSX runtime
// (`react/jsx-runtime`). Transform options chosen for the spike:
//
// transforms: ['jsx', 'typescript'] — cover .jsx and .tsx files
// jsxRuntime: 'automatic' — React 19 automatic runtime (no React import needed)
// production: false — keep displayName etc. for dev
//
// Sucrase is chosen over Babel (heavy, WASM) and swc (WASM) because it is a
// pure-JS implementation that works in a service worker context without WASM
// or worker threads.
//
// The result is an ES-module source string suitable for wrapping in a Blob URL
// (data: or blob:) and serving as a module from the service worker.

import { transform } from 'sucrase';

// ---------------------------------------------------------------------------
// Transform options (validated by the spike)
// ---------------------------------------------------------------------------

/**
 * Sucrase transform options for the spike.
 * These are the options the real runtime should adopt (or tune).
 *
 * @type {import('sucrase').Options}
 */
export const SPIKE_TRANSFORM_OPTIONS = {
 transforms: ['jsx', 'typescript'],
 jsxRuntime: 'automatic',
 production: false, // dev mode — keep names for debugging
 disableESTransforms: true, // keep ES modules intact; SW handles module graph
};

/**
 * Transform JSX/TSX source → plain ES-module JavaScript.
 *
 * @param {string} source Raw JSX or TSX source text.
 * @param {string} filePath File path (for error messages only).
 * @returns {{ code: string, timeMs: number }}
 * `code` is the transformed JavaScript; `timeMs` is the transform wall time.
 * @throws {Error} if Sucrase fails (syntax error in source).
 */
export function transformJsx(source, filePath) {
 const t0 = performance.now();
 const result = transform(source, SPIKE_TRANSFORM_OPTIONS);
 const timeMs = performance.now() - t0;
 if (!result || !result.code) {
 throw new Error(`[sucrase-spike] transform returned empty output for: ${filePath}`);
 }
 return { code: result.code, timeMs };
}

/**
 * Transform and inject the Sucrase-output code into the page as a module
 * via a Blob URL. Used by the spike canvas to bootstrap the asset module
 * outside the service-worker path (fallback / direct test).
 *
 * Because Sucrase's `automatic` JSX runtime emits `import { jsx as _jsx }
 * from "react/jsx-runtime"`, bare `react/jsx-runtime` must be resolvable.
 * The spike uses an import map (see spike-canvas.html) to redirect it to
 * the studio's bundled copy.
 *
 * @param {string} source JSX source.
 * @param {string} filePath Diagnostic label.
 * @returns {Promise<{ module: any, code: string, transformMs: number }>}
 */
export async function loadAsInlineModule(source, filePath) {
 const { code, timeMs } = transformJsx(source, filePath);
 const blob = new Blob([code], { type: 'text/javascript' });
 const url = URL.createObjectURL(blob);
 try {
 const mod = await import(/* @vite-ignore */ url);
 return { module: mod, code, transformMs: timeMs };
 } finally {
 URL.revokeObjectURL(url);
 }
}
