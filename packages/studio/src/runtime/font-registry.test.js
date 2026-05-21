// Tests for the custom-font registry (`font-registry.js`, ).
//
// Two layers are covered:
// • the PURE rule generation — `fontUrl` / `fontFaceRule` / `fontFacesCss`:
// a `FontFile` (+ a resolved URL) → an `@font-face` CSS string;
// • the DOM injector — `registerProjectFonts`: that it mounts a single
// `<style>` element with the generated rules, replaces rather than stacks
// on re-registration, cleans up on `dispose`, and is a calm no-op when the
// project has no custom fonts (`_fonts/` absent / empty / unsupported only).
//
// The suite drives `core`'s real `createProjectNode` / `createFontFile` so the
// font records under test are exactly the shapes the loader produces.

import { describe, it, expect, beforeEach } from 'vitest';

import { createProjectNode, createFontFile } from '@lerret/core';

import {
 fontUrl,
 fontFaceRule,
 fontFacesCss,
 registerProjectFonts,
 FONT_REGISTRY_STYLE_ID,
} from './font-registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A project model rooted at a synthetic `.lerret/` path, with given fonts. */
function projectWithFonts(fileNames) {
 return createProjectNode({
 name: 'demo',
 path: '/proj/.lerret',
 fonts: fileNames
 .map((fileName) =>
 createFontFile({ fileName, path: `/proj/.lerret/_fonts/${fileName}` }),
 )
 .filter((f) => f !== null),
 });
}

// ---------------------------------------------------------------------------
// fontUrl
// ---------------------------------------------------------------------------

describe('fontUrl', () => {
 const project = projectWithFonts(['Brand.woff2']);
 const [font] = project.fonts;

 it('rebases the font path onto the base URL, relative to the .lerret root', () => {
 expect(fontUrl(font, project, '/@fixture-lerret')).toBe(
 '/@fixture-lerret/_fonts/Brand.woff2',
 );
 });

 it('tolerates a trailing slash on the base URL', () => {
 expect(fontUrl(font, project, '/@fixture-lerret/')).toBe(
 '/@fixture-lerret/_fonts/Brand.woff2',
 );
 });

 it('uses the font path as-is when no base URL is given', () => {
 expect(fontUrl(font, project)).toBe('/proj/.lerret/_fonts/Brand.woff2');
 });
});

// ---------------------------------------------------------------------------
// fontFaceRule — pure @font-face generation
// ---------------------------------------------------------------------------

describe('fontFaceRule', () => {
 it('generates an @font-face rule naming the family, src, and format', () => {
 const [font] = projectWithFonts(['MyBrandFont.woff2']).fonts;
 const rule = fontFaceRule(font, '/base/_fonts/MyBrandFont.woff2');

 expect(rule).toContain("font-family: 'MyBrandFont'");
 expect(rule).toContain("src: url('/base/_fonts/MyBrandFont.woff2')");
 expect(rule).toContain("format('woff2')");
 expect(rule).toMatch(/^@font-face \{/);
 expect(rule.trim()).toMatch(/\}$/);
 });

 it('emits the correct format hint per font type', () => {
 const [woff] = projectWithFonts(['A.woff']).fonts;
 const [ttf] = projectWithFonts(['B.ttf']).fonts;
 const [otf] = projectWithFonts(['C.otf']).fonts;
 expect(fontFaceRule(woff, 'u')).toContain("format('woff')");
 expect(fontFaceRule(ttf, 'u')).toContain("format('truetype')");
 expect(fontFaceRule(otf, 'u')).toContain("format('opentype')");
 });

 it('includes font-display: swap so text stays visible while loading', () => {
 const [font] = projectWithFonts(['Brand.woff2']).fonts;
 expect(fontFaceRule(font, 'u')).toContain('font-display: swap');
 });

 it('escapes single quotes in the family name so the rule cannot be broken', () => {
 const font = createFontFile({
 fileName: "O'Brien.woff2",
 path: "/proj/.lerret/_fonts/O'Brien.woff2",
 });
 const rule = fontFaceRule(font, "/base/_fonts/O'Brien.woff2");
 // The quote inside the family name is backslash-escaped.
 expect(rule).toContain("font-family: 'O\\'Brien'");
 expect(rule).toContain("url('/base/_fonts/O\\'Brien.woff2')");
 });
});

// ---------------------------------------------------------------------------
// fontFacesCss — combined stylesheet
// ---------------------------------------------------------------------------

describe('fontFacesCss', () => {
 it('joins one @font-face rule per font in the project', () => {
 const project = projectWithFonts(['Alpha.woff2', 'Beta.ttf']);
 const css = fontFacesCss(project, (f) => `/base/_fonts/${f.fileName}`);

 expect(css.match(/@font-face/g)).toHaveLength(2);
 expect(css).toContain("font-family: 'Alpha'");
 expect(css).toContain("font-family: 'Beta'");
 });

 it('returns an empty string for a project with no custom fonts', () => {
 const project = projectWithFonts([]);
 expect(fontFacesCss(project, () => 'unused')).toBe('');
 });

 it('is safe on a project missing the fonts array entirely', () => {
 expect(fontFacesCss({ kind: 'project', pages: [] }, () => 'unused')).toBe('');
 });
});

// ---------------------------------------------------------------------------
// registerProjectFonts — DOM injection
// ---------------------------------------------------------------------------

describe('registerProjectFonts', () => {
 // Each test starts from a clean document — no leftover registry stylesheet.
 beforeEach(() => {
 const stale = document.getElementById(FONT_REGISTRY_STYLE_ID);
 if (stale) stale.remove();
 });

 it('injects a single <style> element carrying the @font-face rules', () => {
 const project = projectWithFonts(['MyBrandFont.woff2']);
 const registration = registerProjectFonts(project, {
 assetBaseUrl: '/@fixture-lerret',
 });

 const style = document.getElementById(FONT_REGISTRY_STYLE_ID);
 expect(style).not.toBeNull();
 expect(style.tagName).toBe('STYLE');
 // The rule registers the family and points at the rebased font URL.
 expect(style.textContent).toContain("font-family: 'MyBrandFont'");
 expect(style.textContent).toContain(
 "url('/@fixture-lerret/_fonts/MyBrandFont.woff2')",
 );
 // The returned css mirrors the injected stylesheet text.
 expect(registration.css).toBe(style.textContent);

 registration.dispose();
 });

 it('registers every font of the project, by family name', () => {
 const project = projectWithFonts(['Alpha.woff2', 'Beta.ttf', 'Gamma.otf']);
 const registration = registerProjectFonts(project, { assetBaseUrl: '/base' });

 const style = document.getElementById(FONT_REGISTRY_STYLE_ID);
 for (const family of ['Alpha', 'Beta', 'Gamma']) {
 expect(style.textContent).toContain(`font-family: '${family}'`);
 }
 expect(style.textContent.match(/@font-face/g)).toHaveLength(3);

 registration.dispose();
 });

 it('replaces, never stacks, the stylesheet on re-registration', () => {
 const first = registerProjectFonts(projectWithFonts(['Alpha.woff2']), {
 assetBaseUrl: '/base',
 });
 const second = registerProjectFonts(projectWithFonts(['Beta.woff2']), {
 assetBaseUrl: '/base',
 });

 // Exactly one registry <style> element exists — the second call updated
 // it in place rather than appending a duplicate.
 const all = document.querySelectorAll(`#${FONT_REGISTRY_STYLE_ID}`);
 expect(all).toHaveLength(1);
 expect(all[0].textContent).toContain("font-family: 'Beta'");
 expect(all[0].textContent).not.toContain("font-family: 'Alpha'");

 first.dispose();
 second.dispose();
 });

 it('dispose removes the injected stylesheet, and is idempotent', () => {
 const registration = registerProjectFonts(projectWithFonts(['Brand.woff2']), {
 assetBaseUrl: '/base',
 });
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).not.toBeNull();

 registration.dispose();
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).toBeNull();
 // A second dispose must not throw.
 expect(() => registration.dispose()).not.toThrow();
 });

 it('injects nothing for a project with no _fonts/ fonts — no error', () => {
 const registration = registerProjectFonts(projectWithFonts([]), {
 assetBaseUrl: '/base',
 });
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).toBeNull();
 expect(registration.css).toBe('');
 // The disposer is still valid.
 expect(() => registration.dispose()).not.toThrow();
 });

 it('injects nothing when _fonts/ held only unsupported files (no fonts)', () => {
 // The loader filters non-font files out — so the project arrives with an
 // empty `fonts` array, exactly like an empty `_fonts/` folder.
 const project = projectWithFonts(['OFL.txt', 'README.md']);
 expect(project.fonts).toEqual([]);

 const registration = registerProjectFonts(project, { assetBaseUrl: '/base' });
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).toBeNull();
 expect(registration.css).toBe('');
 });

 it('removes a stale registry stylesheet when re-registering a fontless project', () => {
 // First a project with a font (stylesheet injected) ...
 const withFont = registerProjectFonts(projectWithFonts(['Brand.woff2']), {
 assetBaseUrl: '/base',
 });
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).not.toBeNull();

 // ... then re-register a project with no fonts: the stale stylesheet goes.
 registerProjectFonts(projectWithFonts([]), { assetBaseUrl: '/base' });
 expect(document.getElementById(FONT_REGISTRY_STYLE_ID)).toBeNull();

 withFont.dispose();
 });
});
