// font-registry.js — custom-font auto-registration from `_fonts/`.
//
// The `core` loader records every font file dropped into the reserved
// `.lerret/_fonts/` folder onto `project.fonts` — a `FontFile[]` carrying each
// font's family name, served-file path, and `@font-face` `format()` hint
// (FR12). This module is the studio half: it turns those records into real CSS
// `@font-face` rules and injects them into the document so any asset — and the
// artboard previews on the canvas — can use a custom font *by its family name*,
// with the user having written no `@font-face` and no import.
//
// ── Why a generated `<style>` and not the FontFace JS API ──────────────────
// A generated `@font-face` rule in a `<style>` element is the simplest thing
// that works everywhere the studio renders: the rule lands in the same
// document the canvas renders into, so the browser resolves `font-family:
// 'MyBrandFont'` for every artboard with zero per-component wiring. It is also
// trivially inspectable (a DOM check / a screenshot proves registration), and
// removable on dispose. The `FontFace` constructor API would work too, but a
// stylesheet keeps registration declarative and matches how the rest of the
// studio's styles are delivered.
//
// ── Split: pure rule generation vs. the DOM injector ───────────────────────
// - `fontFaceRule` / `fontFacesCss` are PURE — `FontFile` (+ a resolved URL)
// → a CSS string. They have no DOM dependency and are unit-tested directly.
// - `registerProjectFonts` is the thin DOM side: it resolves each font's
// served URL, builds the CSS, and mounts a single `<style>` element. It
// returns a disposer so a project switch / studio unmount cleans up.
//
// ── How the font file is located ───────────────────────────────────────────
// A `FontFile.path` is the font's full `.lerret/` path as the filesystem
// backend reported it. The Vite dev server serves the project's files under a
// base URL (the dev-harness fixture alias today, the real `@lerret/cli dev` server
// ). `fontUrl` rebases the font path onto that base URL exactly
// like the asset runtime's `assetModuleUrl` does for asset modules — so a font
// in `_fonts/` resolves to a real, fetchable URL.

/**
 * @typedef {import('@lerret/core').FontFile} FontFile
 * @typedef {import('@lerret/core').ProjectNode} ProjectNode
 */

// ---------------------------------------------------------------------------
// Font-file URL resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link FontFile} to the URL the Vite dev server serves it from.
 *
 * Mirrors the asset runtime's `assetModuleUrl`: the font's project-model path
 * is rebased onto `assetBaseUrl` relative to the `.lerret/` project root, so a
 * font at `.lerret/_fonts/MyFont.woff2` becomes `<base>/_fonts/MyFont.woff2`.
 * With no base URL the path is used as-is (an already-absolute server URL).
 *
 * @param {FontFile} font The font file to locate.
 * @param {ProjectNode} project The project model — its `path` is the
 * `.lerret/` root the font path is relative to.
 * @param {string} [assetBaseUrl] Base URL the project's files are served
 * under (no trailing slash), or unset for an already-absolute font path.
 * @returns {string} A URL string suitable for a CSS `src: url(...)`.
 */
export function fontUrl(font, project, assetBaseUrl) {
 if (!assetBaseUrl) {
 // No base URL: the font path is itself the URL the server serves.
 return font.path;
 }
 const root = (project && project.path) || '';
 let rel = font.path;
 if (root && rel.startsWith(root)) {
 rel = rel.slice(root.length);
 }
 rel = rel.replace(/^\/+/, '');
 return assetBaseUrl.replace(/\/+$/, '') + '/' + rel;
}

// ---------------------------------------------------------------------------
// Pure `@font-face` rule generation
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe inclusion inside a CSS single-quoted string — used
 * for the `font-family` name and the `src` URL. Backslashes and single quotes
 * are escaped so a font file named `O'Brien.woff2` cannot break the rule (or
 * inject CSS). Forward slashes and ordinary URL characters are left intact.
 *
 * @param {string} value
 * @returns {string}
 */
function cssQuoteSafe(value) {
 return String(value).replace(/[\\']/g, '\\$&');
}

/**
 * Generate the CSS `@font-face` rule that registers one {@link FontFile} under
 * its family name (FR12).
 *
 * The rule names the family from `font.family`, points `src` at the resolved
 * `url`, and emits the `format()` hint from `font.format`. `font-display:
 * swap` keeps text visible while the font loads (no invisible-text flash).
 *
 * Pure: `FontFile` + a resolved URL string → a CSS string. No DOM access.
 *
 * @param {FontFile} font The font file to register.
 * @param {string} url The font's resolved, fetchable URL (see {@link fontUrl}).
 * @returns {string} A single `@font-face { ... }` CSS rule.
 */
export function fontFaceRule(font, url) {
 const family = cssQuoteSafe(font.family);
 const src = cssQuoteSafe(url);
 const format = cssQuoteSafe(font.format);
 return (
 `@font-face {\n` +
 ` font-family: '${family}';\n` +
 ` src: url('${src}') format('${format}');\n` +
 ` font-display: swap;\n` +
 `}`
 );
}

/**
 * Generate the combined CSS for every custom font of a project — one
 * `@font-face` rule per {@link FontFile}, joined by blank lines.
 *
 * Pure: the project's fonts + a URL resolver → a CSS string. Returns `''` when
 * the project has no custom fonts, so an absent or empty `_fonts/` folder
 * yields no stylesheet content and no error.
 *
 * @param {ProjectNode} project The scanned project model (its `fonts`).
 * @param {(font: FontFile) => string} resolveUrl
 * Resolves each font to its served URL — typically `fontUrl` bound to the
 * project + base URL. Injectable so this stays pure and unit-testable.
 * @returns {string} Concatenated `@font-face` rules, or `''` if there are none.
 */
export function fontFacesCss(project, resolveUrl) {
 const fonts = (project && project.fonts) || [];
 if (fonts.length === 0) {
 return '';
 }
 return fonts.map((font) => fontFaceRule(font, resolveUrl(font))).join('\n\n');
}

// ---------------------------------------------------------------------------
// DOM injection
// ---------------------------------------------------------------------------

/**
 * The `id` of the single `<style>` element this module manages — stable so a
 * re-registration replaces rather than duplicates it, and so a DOM check /
 * test can find the registered rules.
 *
 * @type {string}
 */
export const FONT_REGISTRY_STYLE_ID = 'lerret-font-registry';

/**
 * Register every custom font of a project by injecting an `@font-face`
 * stylesheet into the document (FR12).
 *
 * Resolves each {@link FontFile} of `project.fonts` to its served URL, builds
 * one `@font-face` rule per font ({@link fontFacesCss}), and mounts them in a
 * single `<style id="lerret-font-registry">` element in `<head>`. From then on
 * the browser resolves `font-family: '<family>'` for every asset and artboard
 * preview in the document — the user wrote no `@font-face`, no import.
 *
 * Idempotent and tolerant:
 * - a project with no custom fonts (no `_fonts/`, empty `_fonts/`, or only
 * unsupported files) injects nothing and still returns a valid disposer —
 * loading proceeds normally, no error;
 * - called again, it replaces the previous stylesheet's contents rather than
 * stacking duplicate `<style>` elements;
 * - with no DOM available (e.g. a non-browser context) it is a safe no-op.
 *
 * @param {ProjectNode} project The scanned project model.
 * @param {object} [options]
 * @param {string} [options.assetBaseUrl]
 * Base URL the project's files are served under by the Vite dev server — the
 * same base URL the asset runtime is given. Omit if font paths are already
 * absolute server URLs.
 * @param {Document} [options.doc]
 * The document to inject into — defaults to the global `document`. Injectable
 * for tests.
 * @returns {{ css: string, dispose: () => void }}
 * `css` is the generated stylesheet text (`''` when there are no fonts);
 * `dispose` removes the injected `<style>` element (idempotent) — call it on
 * a project switch or studio unmount.
 */
export function registerProjectFonts(project, options = {}) {
 const assetBaseUrl = options.assetBaseUrl;
 const doc =
 options.doc || (typeof document !== 'undefined' ? document : undefined);

 const css = fontFacesCss(project, (font) =>
 fontUrl(font, project, assetBaseUrl),
 );

 // No DOM, or nothing to register — return a valid no-op disposer either way.
 if (doc === undefined) {
 return { css, dispose() {} };
 }

 let style = doc.getElementById(FONT_REGISTRY_STYLE_ID);
 if (css === '') {
 // No custom fonts: ensure no stale stylesheet lingers, then no-op.
 if (style && style.parentNode) {
 style.parentNode.removeChild(style);
 }
 return { css, dispose() {} };
 }

 if (!style) {
 style = doc.createElement('style');
 style.id = FONT_REGISTRY_STYLE_ID;
 style.setAttribute('data-lerret', 'font-registry');
 (doc.head || doc.documentElement).appendChild(style);
 }
 // Replace contents wholesale — a re-registration never stacks duplicates.
 style.textContent = css;

 return {
 css,
 dispose() {
 const el = doc.getElementById(FONT_REGISTRY_STYLE_ID);
 if (el && el.parentNode) {
 el.parentNode.removeChild(el);
 }
 },
 };
}
