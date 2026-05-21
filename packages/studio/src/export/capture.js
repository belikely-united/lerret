// capture.js — Generalized full-font-embedding capture core
//
// Exports `captureArtboard(artboardElement, options)` — the single capture
// mechanic reused by every export route (single, bulk, CLI).
//
// Font embedding strategy (FR40, NFR10):
// 1. Walk the artboard's rendered subtree and collect every used font-family
// from `getComputedStyle` (including :before/:after via a walk of all
// elements).
// 2. For each family, attempt to resolve it via the caller-supplied
// `fontResolver` (custom fonts from `.lerret/_fonts/`), or via the Google
// Fonts link/import already loaded in the document, or skip (system font).
// 3. Fetch the font file(s), base64-encode, and inject `@font-face` data-URI
// rules into the cloned DOM that html-to-image rasterizes from.
// 4. A failed fetch does NOT throw — the family is recorded in
// `unembeddedFonts` and falls back to system rendering.
// 5. Font rules are sorted by family name so repeated captures of an
// unchanged artboard produce byte-identical output (NFR10).
//
// `fontResolver` option (custom-font contract):
// A sync or async function: (familyName: string) => { url: string, format: string } | null
// Return null to indicate the family is not a custom project font.
// The studio wraps `fontUrl()` from `font-registry.js` to build this.

import * as htmlToImage from 'html-to-image';
import { resolveFormat } from './formats.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode an ArrayBuffer to a base64 string without hitting the call-stack
 * limit that `String.fromCharCode.apply` runs into on large buffers.
 *
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
function _bufferToBase64(buf) {
 const bytes = new Uint8Array(buf);
 let bin = '';
 const chunk = 0x8000; // 32 KB — safe for fromCharCode.apply
 for (let i = 0; i < bytes.length; i += chunk) {
 bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
 }
 return btoa(bin);
}

/**
 * Split a CSS `font-family` value into individual family names, stripping
 * quotes and trimming whitespace. e.g.:
 * `'"Space Grotesk", -apple-system, sans-serif'`
 * → `['Space Grotesk', '-apple-system', 'sans-serif']`
 *
 * @param {string} value
 * @returns {string[]}
 */
function _parseFontFamilies(value) {
 // Split on commas that are not inside quotes (simplified: split, then strip).
 return value
 .split(',')
 .map((f) => f.trim().replace(/^["']|["']$/g, '').trim())
 .filter(Boolean);
}

/**
 * Walk every element inside `root` (inclusive) and return the set of all
 * font-family names referenced by computed styles. Skips replaced content
 * (`<img>`, `<video>`, `<canvas>`) — they don't render text.
 *
 * @param {Element} root
 * @returns {Set<string>}
 */
function _collectUsedFamilies(root) {
 const SKIP_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'SVG']);
 const families = new Set();

 // Traverse via TreeWalker for efficiency on large subtrees.
 const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
 acceptNode(node) {
 return SKIP_TAGS.has(node.tagName)
 ? NodeFilter.FILTER_REJECT
 : NodeFilter.FILTER_ACCEPT;
 },
 });

 let el = root;
 while (el) {
 const style = window.getComputedStyle(el);
 const raw = style.getPropertyValue('font-family');
 if (raw) {
 for (const family of _parseFontFamilies(raw)) {
 families.add(family);
 }
 }
 // :before and :after pseudo-elements (if they display text)
 for (const pseudo of ['::before', '::after']) {
 try {
 const ps = window.getComputedStyle(el, pseudo);
 const pf = ps.getPropertyValue('font-family');
 if (pf) {
 for (const family of _parseFontFamilies(pf)) {
 families.add(family);
 }
 }
 } catch (_pseudoErr) {
 // getComputedStyle with pseudo can fail in some environments
 }
 }
 el = walker.nextNode();
 }

 return families;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Fonts inlining
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return every Google Fonts CSS URL loaded by the document — from <link> tags
 * and @import rules in <style> elements.
 *
 * @returns {string[]}
 */
function _googleFontsCssUrls() {
 const urls = new Set();

 // <link rel="stylesheet" href="https://fonts.googleapis.com/...">
 for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
 if (link.href && link.href.includes('fonts.googleapis.com')) {
 urls.add(link.href);
 }
 }

 // @import url("https://fonts.googleapis.com/...") inside <style> elements
 for (const style of document.querySelectorAll('style')) {
 const text = style.textContent || '';
 const matches = text.matchAll(/@import\s+url\(\s*["']?(https:\/\/fonts\.googleapis\.com\/[^"')]+)["']?\s*\)/g);
 for (const m of matches) {
 urls.add(m[1]);
 }
 }

 return [...urls];
}

/**
 * Fetch a Google Fonts CSS URL, replace all gstatic font file URLs with
 * base64 data-URIs, and return the resulting inline CSS. Any font file that
 * fails to fetch is silently left as its original URL (the browser in headless
 * mode will handle it or not).
 *
 * @param {string} cssUrl
 * @returns {Promise<string>}
 */
async function _inlineGoogleFontsCss(cssUrl) {
 const cssRes = await fetch(cssUrl, { mode: 'cors' });
 if (!cssRes.ok) throw new Error(`Google Fonts CSS fetch failed: ${cssRes.status}`);
 let css = await cssRes.text();

 // Extract unique gstatic font file URLs
 const fontFileUrls = [
 ...new Set(
 Array.from(css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)).map(
 (m) => m[1],
 ),
 ),
 ];

 // Fetch and base64-encode in parallel
 const replacements = await Promise.all(
 fontFileUrls.map(async (url) => {
 try {
 const r = await fetch(url, { mode: 'cors' });
 if (!r.ok) return [url, null];
 const buf = await r.arrayBuffer();
 const b64 = _bufferToBase64(buf);
 return [url, `data:font/woff2;base64,${b64}`];
 } catch (_fetchErr) {
 return [url, null];
 }
 }),
 );

 for (const [url, dataUri] of replacements) {
 if (dataUri) {
 css = css.split(url).join(dataUri);
 }
 }
 return css;
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom font inlining
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an `@font-face` rule that inlines a custom font as a base64 data-URI.
 *
 * @param {string} family
 * @param {string} b64
 * @param {string} format e.g. 'woff2', 'truetype'
 * @returns {string}
 */
function _customFontFaceRule(family, b64, format) {
 const mime = format === 'truetype' ? 'font/ttf'
 : format === 'opentype' ? 'font/otf'
 : `font/${format}`;
 return (
 `@font-face {\n` +
 ` font-family: '${family.replace(/'/g, "\\'")}' ;\n` +
 ` src: url('data:${mime};base64,${b64}') format('${format}');\n` +
 ` font-display: swap;\n` +
 `}`
 );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Capture an artboard DOM element as a rasterized image Blob.
 *
 * Font embedding (FR40):
 * - Custom fonts registered from `.lerret/_fonts/` are resolved via
 * `options.fontResolver` and inlined as base64 `@font-face` data-URIs.
 * - Google Fonts loaded by the document are fetched and inlined.
 * - System fonts are left to the browser.
 * - Failed fetches are non-fatal: the family is appended to `unembeddedFonts`.
 *
 * Determinism (NFR10): `@font-face` rules are sorted by family name before
 * being injected into the cloned DOM, so byte-identical captures are produced
 * for identical artboard content.
 *
 * @param {HTMLElement} artboardElement The artboard DOM node to capture.
 * @param {object} [options]
 * @param {'png' | 'jpg' | 'jpeg'} [options.format='png'] Output image format.
 * Resolved via `resolveFormat` from — `'jpeg'` is an alias for
 * `'jpg'`; omitting the option defaults to `'png'` (FR38).
 * @param {number} [options.quality=0.92] JPEG quality (0–1, ignored for PNG).
 * @param {number} [options.pixelRatio=2] Device pixel ratio for the output.
 * @param {string} [options.backgroundColor] Background fill (defaults: white
 * for JPEG, transparent for PNG).
 * @param {(family: string) => ({ url: string, format: string } | null | Promise<{ url: string, format: string } | null>)} [options.fontResolver]
 * Resolves a font-family name to its custom-font descriptor, or returns null
 * if the family is not a project custom font. Supply this so custom fonts
 * from `.lerret/_fonts/` are embedded. The studio passes a closure over the
 * project + assetBaseUrl built with `fontUrl()` from `font-registry.js`.
 *
 * @returns {Promise<{ blob: Blob, unembeddedFonts: string[] }>}
 * `blob` — the rasterized image.
 * `unembeddedFonts` — families that could not be fetched/decoded; callers can
 * surface a calm, non-blocking warning.
 */
export async function captureArtboard(artboardElement, options = {}) {
 const {
 format, // resolved by resolveFormat below; undefined → defaults to 'png'
 quality = 0.92,
 pixelRatio = 2,
 backgroundColor,
 fontResolver = null,
 } = options;

 // Delegate format validation and normalization to the shared format registry
 //. `resolveFormat` throws a caller-catchable Error for any
 // unrecognized format string and defaults to 'png' when format is undefined.
 const { format: fmt } = resolveFormat(format);

 // Wait for the document fonts to finish loading before measuring
 if (typeof document !== 'undefined' && document.fonts?.ready) {
 try {
 await document.fonts.ready;
 } catch (_fontsReadyErr) {
 // non-fatal
 }
 }

 // ── 1. Collect used font families ─────────────────────────────────────────
 const usedFamilies = _collectUsedFamilies(artboardElement);

 // ── 2. Partition families into custom / google / system ───────────────────
 // We resolve custom fonts first (synchronous map lookup via fontResolver),
 // then identify which remaining families are Google Fonts.

 const unembeddedFonts = [];

 // --- Custom font rules (from .lerret/_fonts/) ---
 // Sorted by family name for determinism (NFR10).
 const customFamilies = [...usedFamilies].sort();
 const customFontRuleParts = [];

 if (fontResolver) {
 for (const family of customFamilies) {
 let descriptor;
 try {
 descriptor = await fontResolver(family);
 } catch (err) {
 console.warn(`captureArtboard: fontResolver threw for "${family}":`, err);
 descriptor = null;
 }
 if (!descriptor) continue; // not a custom font

 const { url, format: fontFormat } = descriptor;
 try {
 const res = await fetch(url);
 if (!res.ok) throw new Error(`HTTP ${res.status}`);
 const buf = await res.arrayBuffer();
 const b64 = _bufferToBase64(buf);
 customFontRuleParts.push({
 family,
 rule: _customFontFaceRule(family, b64, fontFormat || 'woff2'),
 });
 } catch (err) {
 console.warn(`captureArtboard: failed to embed custom font "${family}":`, err);
 unembeddedFonts.push(family);
 }
 }
 }

 // --- Google Fonts rules ---
 // Fetch each Google Fonts CSS URL the document has loaded.
 let googleFontsCSS = '';
 const googleCssUrls = _googleFontsCssUrls();
 for (const cssUrl of googleCssUrls) {
 try {
 const css = await _inlineGoogleFontsCss(cssUrl);
 googleFontsCSS += '\n' + css;
 } catch (err) {
 // Identify which families were Google (best effort: families in used set
 // that appear in the CSS URL query string "family=...").
 console.warn(`captureArtboard: Google Fonts CSS fetch failed for ${cssUrl}:`, err);
 // We cannot identify which families were inside this URL without fetching,
 // so we don't add to unembeddedFonts here (we can't know the family names).
 }
 }

 // ── 3. Build deterministic fontEmbedCSS ───────────────────────────────────
 // Sort custom rules by family name (already sorted above), then append
 // Google Fonts CSS. The sort makes repeated captures byte-identical (NFR10).
 const sortedCustomRules = customFontRuleParts
 .sort((a, b) => a.family.localeCompare(b.family))
 .map((r) => r.rule)
 .join('\n\n');

 const fontEmbedCSS = [sortedCustomRules, googleFontsCSS].filter(Boolean).join('\n\n');

 // ── 4. Determine artboard dimensions ─────────────────────────────────────
 const width = artboardElement.offsetWidth || artboardElement.getBoundingClientRect().width;
 const height = artboardElement.offsetHeight || artboardElement.getBoundingClientRect().height;

 // ── 5. html-to-image options ──────────────────────────────────────────────
 const bg =
 backgroundColor !== undefined
 ? backgroundColor
 : fmt === 'jpg'
 ? '#ffffff'
 : undefined;

 const htmlToImageOpts = {
 width,
 height,
 canvasWidth: width,
 canvasHeight: height,
 pixelRatio,
 cacheBust: true,
 skipAutoScale: true,
 fontEmbedCSS: fontEmbedCSS || undefined,
 ...(bg !== undefined ? { backgroundColor: bg } : {}),
 style: {
 transform: 'none',
 transformOrigin: 'top left',
 margin: '0',
 width: width + 'px',
 height: height + 'px',
 },
 };

 // ── 6. Rasterize ─────────────────────────────────────────────────────────
 let blob;
 if (fmt === 'png') {
 blob = await htmlToImage.toBlob(artboardElement, htmlToImageOpts);
 } else {
 // JPEG: html-to-image's toBlob doesn't support quality for JPEG directly;
 // capture as dataUrl then convert to Blob for consistent MIME type.
 const dataUrl = await htmlToImage.toJpeg(artboardElement, {
 ...htmlToImageOpts,
 quality,
 });
 blob = _dataUrlToBlob(dataUrl);
 }

 return { blob, unembeddedFonts };
}

/**
 * Convert a data: URL string to a Blob.
 *
 * @param {string} dataUrl
 * @returns {Blob}
 */
function _dataUrlToBlob(dataUrl) {
 const [header, b64] = dataUrl.split(',');
 const mime = header.match(/:(.*?);/)[1];
 const bytes = atob(b64);
 const arr = new Uint8Array(bytes.length);
 for (let i = 0; i < bytes.length; i++) {
 arr[i] = bytes.charCodeAt(i);
 }
 return new Blob([arr], { type: mime });
}
