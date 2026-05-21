// sucrase-transform.test.js — pure-transform tests for the hosted-mode
// Sucrase wrapper. Verifies the production options the spike's
// findings recommend (`production: true`, `disableESTransforms: true`,
// `jsxRuntime: 'automatic'`), the content-hash transform cache, and the
// extension predicate.

import { describe, it, expect, vi } from 'vitest';

import {
 HOSTED_TRANSFORM_OPTIONS,
 createTransformCache,
 hashSource,
 transformJsx,
 fileExtensionIsTransformable,
} from './sucrase-transform.js';

// ---------------------------------------------------------------------------
// HOSTED_TRANSFORM_OPTIONS — the production-mode options
// ---------------------------------------------------------------------------

describe('HOSTED_TRANSFORM_OPTIONS', () => {
 it('targets the React 19 automatic JSX runtime in production mode', () => {
 expect(HOSTED_TRANSFORM_OPTIONS).toMatchObject({
 transforms: ['jsx', 'typescript'],
 jsxRuntime: 'automatic',
 production: true,
 disableESTransforms: true,
 });
 });

 it('is frozen so callers cannot mutate the shipped options', () => {
 expect(Object.isFrozen(HOSTED_TRANSFORM_OPTIONS)).toBe(true);
 });
});

// ---------------------------------------------------------------------------
// transformJsx — production-mode transform output
// ---------------------------------------------------------------------------

describe('transformJsx (production)', () => {
 it('transforms a JSX component using the production jsx-runtime (NOT jsx-dev-runtime)', async () => {
 const source = `
 export default function Card() {
 return <div className="card">Hello</div>;
 }
 `;
 const { code } = await transformJsx(source, 'Card.jsx');

 expect(typeof code).toBe('string');
 expect(code.length).toBeGreaterThan(0);
 // Production mode emits `react/jsx-runtime`, NOT `-dev`.
 expect(code).toContain('react/jsx-runtime');
 expect(code).not.toContain('react/jsx-dev-runtime');
 // No classic-runtime `React.createElement` calls.
 expect(code).not.toContain('React.createElement');
 // ES module structure is preserved (disableESTransforms: true).
 expect(code).toContain('export default function Card');
 });

 it('transforms TSX, stripping interfaces', async () => {
 const source = `
 interface Props { label: string }
 export default function Label({ label }: Props) {
 return <span>{label}</span>;
 }
 `;
 const { code } = await transformJsx(source, 'Label.tsx');

 expect(code).not.toContain('interface Props');
 expect(code).toContain('export default function Label');
 // Still production mode for the JSX side.
 expect(code).toContain('react/jsx-runtime');
 expect(code).not.toContain('react/jsx-dev-runtime');
 });

 it('preserves `import`/`export` statements verbatim (disableESTransforms)', async () => {
 // NOTE: Sucrase's TypeScript transform runs alongside JSX and strips
 // type-only imports (it can't tell which JS imports are used purely as
 // types). We reference every imported value below so nothing is elided.
 const source = `
 import { useState } from 'react';
 import Logo from './logo.png';
 export { default as Card } from './Card.jsx';
 export default function Counter() {
 const [n, setN] = useState(0);
 return <button onClick={() => setN(n + 1)} title={Logo}>{n}</button>;
 }
 `;
 const { code } = await transformJsx(source, 'Counter.jsx');

 // The SW serves real ES modules; every `import`/`export` must survive
 // for the browser's module graph to be intact.
 expect(code).toContain("import { useState } from 'react'");
 expect(code).toContain("import Logo from './logo.png'");
 expect(code).toContain("export { default as Card } from './Card.jsx'");
 expect(code).toContain('export default function Counter');
 });

 it('throws on a syntax error and propagates the underlying message', async () => {
 const badSource = `export default function Bad() { return <div unclosed; }`;
 await expect(transformJsx(badSource, 'Bad.jsx')).rejects.toThrow();
 });

 it('rejects on non-string source with a TypeError', async () => {
 await expect(transformJsx(/** @type {any} */ (42), 'x.jsx')).rejects.toBeInstanceOf(TypeError);
 });
});

// ---------------------------------------------------------------------------
// Content-hash transform cache (spike mitigation)
// ---------------------------------------------------------------------------

describe('hashSource', () => {
 it('returns the same hash for the same source', async () => {
 const a = await hashSource('export default 1;');
 const b = await hashSource('export default 1;');
 expect(a).toBe(b);
 });

 it('returns different hashes for different sources', async () => {
 const a = await hashSource('export default 1;');
 const b = await hashSource('export default 2;');
 expect(a).not.toBe(b);
 });

 it('returns a hex string', async () => {
 const h = await hashSource('hello');
 expect(h).toMatch(/^[0-9a-f]+$/);
 });
});

describe('transformJsx + cache', () => {
 it('caches the transform output by content hash — a repeated call is a hit', async () => {
 const source = 'export default function A() { return <i/>; }';
 const cache = createTransformCache();

 const first = await transformJsx(source, 'A.jsx', { cache });
 expect(first.cached).toBe(false);
 expect(cache.size()).toBe(1);

 const second = await transformJsx(source, 'A.jsx', { cache });
 expect(second.cached).toBe(true);
 expect(second.code).toBe(first.code);
 expect(second.hash).toBe(first.hash);
 expect(cache.size()).toBe(1);
 });

 it('different sources produce different cache entries', async () => {
 const cache = createTransformCache();
 const a = await transformJsx('export default function A() { return <a/>; }', 'A.jsx', { cache });
 const b = await transformJsx('export default function B() { return <b/>; }', 'B.jsx', { cache });
 expect(cache.size()).toBe(2);
 expect(a.hash).not.toBe(b.hash);
 expect(a.code).not.toBe(b.code);
 });

 it('clearing the cache forces a re-transform', async () => {
 const source = 'export default function A() { return <a/>; }';
 const cache = createTransformCache();
 const first = await transformJsx(source, 'A.jsx', { cache });
 cache.clear();
 const second = await transformJsx(source, 'A.jsx', { cache });
 expect(first.cached).toBe(false);
 expect(second.cached).toBe(false);
 expect(second.code).toBe(first.code); // same source → same code
 });

 it('does NOT cache a failed transform — the next attempt re-runs Sucrase', async () => {
 const cache = createTransformCache();
 const bad = 'export default function Bad() { return <div unclosed;';
 await expect(transformJsx(bad, 'Bad.jsx', { cache })).rejects.toThrow();
 expect(cache.size()).toBe(0);
 // A second attempt with the same source must throw again (no silent miss).
 await expect(transformJsx(bad, 'Bad.jsx', { cache })).rejects.toThrow();
 });
});

// ---------------------------------------------------------------------------
// fileExtensionIsTransformable
// ---------------------------------------------------------------------------

describe('fileExtensionIsTransformable', () => {
 it.each([
 ['Card.jsx', true],
 ['Card.tsx', true],
 ['Card.JSX', true],
 ['Card.ts', true],
 ['Card.js', false], // bare .js is NOT transformed
 ['Card.css', false],
 ['logo.png', false],
 ['', false],
 [42, false],
 ])('classifies %j as transformable=%s', (input, expected) => {
 expect(fileExtensionIsTransformable(/** @type {any} */ (input))).toBe(expected);
 });
});

// ---------------------------------------------------------------------------
// Performance sanity check (NFR2 proxy)
// ---------------------------------------------------------------------------

describe('transformJsx performance (NFR2 proxy)', () => {
 it('a small component transforms in well under 200ms', async () => {
 const source = `
 export default function Perf() {
 return (
 <div style={{ padding: 24, background: '#6366f1', color: '#fff' }}>
 <h2>Performance</h2>
 <p>Sucrase transform speed</p>
 </div>
 );
 }
 `;
 const t0 = performance.now();
 await transformJsx(source, 'Perf.jsx');
 const elapsed = performance.now() - t0;
 expect(elapsed).toBeLessThan(200);
 });

 // Make sure we still exercise vi to keep linting happy on imports that
 // would otherwise dead-code.
 it('vi is reachable for future fixtures', () => {
 expect(typeof vi).toBe('object');
 });
});
