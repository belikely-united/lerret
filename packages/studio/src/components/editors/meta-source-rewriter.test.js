// Tests for the meta source-surgery rewriter.
//
// Coverage:
// - typical `meta = { ... }` block updated cleanly
// - comments outside the meta block preserved verbatim
// - `propsSchema` carried through verbatim (we don't touch it)
// - no-meta-export source returns `{ ok: false }`
// - non-object-literal meta returns `{ ok: false }`
// - the rest of the file is byte-stable except for the meta span
// - keyword preserved (const / let / var)
// - single-line declarations
// - rewrite is idempotent: rewriting a freshly-rewritten file with the same
// value yields the same source

import { describe, it, expect } from 'vitest';
import { rewriteMetaExport, findMetaDeclaration } from './meta-source-rewriter.js';

// ── findMetaDeclaration (private but exported for unit testing) ───────────────

describe('findMetaDeclaration', () => {
 it('locates a conventional declaration and its braces', () => {
 const src = [
 '// header comment',
 'export const meta = {',
 ' label: "x",',
 '};',
 'export default function X() {}',
 '',
 ].join('\n');
 const decl = findMetaDeclaration(src);
 expect(decl).not.toBeNull();
 expect(decl.keyword).toBe('const');
 expect(src.slice(decl.braceOpen, decl.braceClose + 1)).toBe('{\n label: "x",\n}');
 // declEnd includes the trailing `;` and the position is at the newline after it.
 expect(src[decl.declEnd - 1]).toBe(';');
 });

 it('handles `export let meta` and `export var meta`', () => {
 expect(findMetaDeclaration('export let meta = {};').keyword).toBe('let');
 expect(findMetaDeclaration('export var meta = {};').keyword).toBe('var');
 });

 it('returns null when the value is not an object literal', () => {
 expect(findMetaDeclaration('export const meta = buildMeta();')).toBeNull();
 expect(findMetaDeclaration('export const meta = ENVELOPE;')).toBeNull();
 expect(findMetaDeclaration('export const meta = [];')).toBeNull();
 });

 it('returns null when there is no meta export', () => {
 expect(findMetaDeclaration('export default function X() {}')).toBeNull();
 expect(findMetaDeclaration('const meta = {};')).toBeNull();
 });

 it('returns null when the braces are unbalanced', () => {
 expect(findMetaDeclaration('export const meta = { unclosed:')).toBeNull();
 });

 it('survives a string with embedded braces', () => {
 const src = 'export const meta = { label: "name } with brace" };';
 const decl = findMetaDeclaration(src);
 expect(decl).not.toBeNull();
 // The closing `}` should be the OUTER one, not the one inside the string.
 expect(src[decl.braceClose]).toBe('}');
 expect(src.slice(decl.braceOpen, decl.braceClose + 1)).toBe(
 '{ label: "name } with brace" }',
 );
 });
});

// ── rewriteMetaExport ─────────────────────────────────────────────────────────

describe('rewriteMetaExport — typical update', () => {
 it('rewrites a conventional meta block cleanly', () => {
 const src = [
 'import React from "react";',
 '',
 'export const meta = {',
 ' dimensions: { width: 320, height: 200 },',
 " label: 'Primary button',",
 " tags: ['button', 'cta'],",
 '};',
 '',
 'export default function Button() {',
 ' return <button>Click</button>;',
 '}',
 '',
 ].join('\n');

 const result = rewriteMetaExport(src, {
 dimensions: { width: 480, height: 240 },
 label: 'Big button',
 tags: ['button', 'big', 'cta'],
 });

 expect(result.ok).toBe(true);
 if (!result.ok) return;
 expect(result.source).toContain('export const meta = {');
 expect(result.source).toContain('dimensions: { width: 480, height: 240 }');
 expect(result.source).toContain('label: "Big button"');
 expect(result.source).toContain('tags: ["button", "big", "cta"]');
 // The component code and the import are preserved.
 expect(result.source).toContain('import React from "react";');
 expect(result.source).toContain('export default function Button() {');
 expect(result.source).toContain(' return <button>Click</button>;');
 expect(result.source.endsWith('}\n')).toBe(true);
 });

 it('preserves comments OUTSIDE the meta block verbatim', () => {
 const src = [
 '// Top-level header comment',
 '// Multiple lines.',
 'import x from "y";',
 '',
 '/**',
 ' * JSDoc above the meta block.',
 ' */',
 'export const meta = {',
 ' label: "old",',
 '};',
 '',
 '// Comment between meta and the component.',
 'export default function Foo() { return null; }',
 '',
 ].join('\n');

 const result = rewriteMetaExport(src, { label: 'new', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 expect(result.source).toContain('// Top-level header comment');
 expect(result.source).toContain('// Multiple lines.');
 expect(result.source).toContain(' * JSDoc above the meta block.');
 expect(result.source).toContain('// Comment between meta and the component.');
 expect(result.source).toContain('label: "new"');
 // The old `label: "old"` is replaced, not duplicated.
 expect(result.source).not.toContain('label: "old"');
 });

 it('the rest of the file is byte-stable except for the meta span', () => {
 const src = [
 'import { f } from "./x.js";',
 '',
 'export const meta = {',
 ' label: "a",',
 '};',
 '',
 'export const helper = 42;',
 '',
 'export default function C() {',
 ' return f();',
 '}',
 '',
 ].join('\n');

 const decl = findMetaDeclaration(src);
 const before = src.slice(0, decl.declStart);
 const after = src.slice(decl.declEnd);

 const result = rewriteMetaExport(src, { label: 'b', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 // Everything before `export const meta` is unchanged byte-for-byte.
 expect(result.source.startsWith(before)).toBe(true);
 // Everything after the meta declaration is also unchanged byte-for-byte.
 expect(result.source.endsWith(after)).toBe(true);
 });
});

describe('rewriteMetaExport — propsSchema preservation', () => {
 it('preserves a propsSchema sub-object verbatim', () => {
 const src = [
 'export const meta = {',
 ' dimensions: { width: 320, height: 200 },',
 ' label: "x",',
 ' tags: ["a"],',
 ' propsSchema: {',
 ' headline: {',
 ' type: "string",',
 ' default: "Hi",',
 ' description: "Top-line",',
 ' },',
 ' tone: {',
 ' type: "select",',
 ' options: ["warm", "cool"],',
 ' },',
 ' },',
 '};',
 '',
 ].join('\n');

 const result = rewriteMetaExport(src, {
 dimensions: { width: 640, height: 400 },
 label: 'y',
 tags: ['b'],
 });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 // The user-edited keys are updated…
 expect(result.source).toContain('dimensions: { width: 640, height: 400 }');
 expect(result.source).toContain('label: "y"');
 expect(result.source).toContain('tags: ["b"]');
 // …while the propsSchema's nested keys live on, byte-for-byte.
 expect(result.source).toContain('headline: {');
 expect(result.source).toContain('type: "string"');
 expect(result.source).toContain('default: "Hi"');
 expect(result.source).toContain('description: "Top-line"');
 expect(result.source).toContain('options: ["warm", "cool"]');
 });

 it('omits propsSchema when the original had none', () => {
 const src = 'export const meta = { label: "x" };\n';
 const result = rewriteMetaExport(src, { label: 'y', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 expect(result.source).not.toContain('propsSchema');
 });
});

describe('rewriteMetaExport — keyword + format', () => {
 it('preserves `let` and `var` keywords', () => {
 expect(
 rewriteMetaExport('export let meta = { label: "x" };\n', { label: 'y', tags: [] }).source,
 ).toContain('export let meta = {');
 expect(
 rewriteMetaExport('export var meta = { label: "x" };\n', { label: 'y', tags: [] }).source,
 ).toContain('export var meta = {');
 });

 it('handles single-line declarations', () => {
 const src = 'export const meta = { label: "x" };\n';
 const result = rewriteMetaExport(src, { label: 'y', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 expect(result.source).toContain('label: "y"');
 expect(result.source).toContain('export const meta = {');
 });

 it('handles missing trailing semicolon', () => {
 const src = 'export const meta = { label: "x" }\nexport default 1;\n';
 const result = rewriteMetaExport(src, { label: 'y', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 // Emits a trailing semicolon for a clean terminator.
 expect(result.source).toContain('};\nexport default 1;');
 });

 it('omits `label` when the editor cleared it (empty string)', () => {
 const src = 'export const meta = { label: "x" };\n';
 const result = rewriteMetaExport(src, { label: '', tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 // The label key is gone — the parser will fall back to the file-name label.
 expect(result.source).not.toContain('label:');
 });

 it('emits an empty dimensions when both axes are missing', () => {
 const src = 'export const meta = { dimensions: { width: 320, height: 200 } };\n';
 const result = rewriteMetaExport(src, { dimensions: {}, tags: [] });
 expect(result.ok).toBe(true);
 if (!result.ok) return;
 expect(result.source).toContain('dimensions: {}');
 });
});

describe('rewriteMetaExport — rejection paths', () => {
 it('returns ok:false when there is no meta export', () => {
 const r = rewriteMetaExport('export default function X() {}\n', { label: 'y', tags: [] });
 expect(r.ok).toBe(false);
 if (r.ok) return;
 expect(r.reason).toMatch(/no `export const meta/);
 });

 it('returns ok:false when meta is not an object literal', () => {
 const r = rewriteMetaExport('export const meta = buildMeta();\n', { label: 'y', tags: [] });
 expect(r.ok).toBe(false);
 });

 it('returns ok:false when meta value is an array', () => {
 const r = rewriteMetaExport('export const meta = [];\n', { label: 'y', tags: [] });
 expect(r.ok).toBe(false);
 });

 it('returns ok:false when the source is not a string', () => {
 const r = rewriteMetaExport(null, { label: 'y', tags: [] });
 expect(r.ok).toBe(false);
 });

 it('returns ok:false when nextMeta is not a plain object', () => {
 expect(rewriteMetaExport('export const meta = {};', null).ok).toBe(false);
 expect(rewriteMetaExport('export const meta = {};', []).ok).toBe(false);
 });
});

describe('rewriteMetaExport — idempotence', () => {
 it('re-running the rewriter with the same value yields the same source', () => {
 const src = [
 'export const meta = {',
 ' dimensions: { width: 640, height: 280 },',
 ' label: "Hero",',
 ' tags: ["hero", "marketing"],',
 '};',
 '',
 'export default function X() { return null; }',
 '',
 ].join('\n');

 const next = {
 dimensions: { width: 800, height: 320 },
 label: 'Hero 2',
 tags: ['hero'],
 };
 const r1 = rewriteMetaExport(src, next);
 expect(r1.ok).toBe(true);
 if (!r1.ok) return;
 const r2 = rewriteMetaExport(r1.source, next);
 expect(r2.ok).toBe(true);
 if (!r2.ok) return;
 expect(r2.source).toBe(r1.source);
 });
});
