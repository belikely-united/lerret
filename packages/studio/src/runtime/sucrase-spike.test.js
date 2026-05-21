// sucrase-spike.test.js — Minimal unit test for the spike's
// Sucrase transform. The spike's value is the FINDINGS, not test coverage;
// this test just confirms the chosen transform options produce valid JS.
//
// AC: "a single unit test that the Sucrase transform produces valid JS is enough"
// (, constraint E).
//
// Note: This test lives in src/ (picked up by vitest) but imports sucrase
// directly (not from the spike dir) so vitest can resolve it in the Node env.
// The spike directory itself is browser-only and not imported from production.

import { describe, it, expect } from 'vitest';
import { transform } from 'sucrase';

// ---------------------------------------------------------------------------
// Sucrase transform options (same as spike/hosted-runtime/sucrase-spike.js)
// ---------------------------------------------------------------------------

const TRANSFORM_OPTIONS = {
 transforms: ['jsx', 'typescript'],
 jsxRuntime: 'automatic',
 production: false,
 disableESTransforms: true,
};

/**
 * Transform JSX source and return the resulting code string.
 * Throws if Sucrase fails (surfaces syntax errors as test failures).
 */
function transformJsx(source) {
 const result = transform(source, TRANSFORM_OPTIONS);
 if (!result || !result.code) throw new Error('Sucrase returned empty output');
 return result.code;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sucrase spike transform', () => {
 it('transforms a plain JSX component to valid JavaScript', () => {
 const source = `
 export default function Hello() {
 return <div className="hello">Hello world</div>;
 }
 `;
 const code = transformJsx(source);

 // Must be a non-empty string
 expect(typeof code).toBe('string');
 expect(code.length).toBeGreaterThan(0);

 // Automatic JSX runtime: no `React.createElement`.
 // Sucrase in dev mode (production: false) emits jsx-dev-runtime; in
 // production mode it emits jsx-runtime. Both are the automatic runtime.
 // We check for the common "jsx" import prefix that covers both.
 const usesAutomaticRuntime =
 code.includes('jsx-runtime') || code.includes('jsx-dev-runtime');
 expect(usesAutomaticRuntime).toBe(true);
 expect(code).not.toContain('React.createElement');

 // The `export default function` should survive (disableESTransforms: true)
 expect(code).toContain('export default function Hello');
 });

 it('handles TypeScript syntax (tsx strip) without errors', () => {
 const source = `
 interface Props { label: string; }
 export default function Label({ label }: Props) {
 return <span>{label}</span>;
 }
 `;
 const code = transformJsx(source);

 // TypeScript interface should be stripped
 expect(code).not.toContain('interface Props');
 expect(code).toContain('export default function Label');
 });

 it('rewrites JSX fragment shorthand correctly', () => {
 const source = `
 export default function Frag() {
 return <><div /><span /></>;
 }
 `;
 const code = transformJsx(source);
 // Fragment should reference the automatic runtime (jsx-runtime or jsx-dev-runtime)
 const usesAutomaticRuntime =
 code.includes('jsx-runtime') || code.includes('jsx-dev-runtime');
 expect(usesAutomaticRuntime).toBe(true);
 expect(typeof code).toBe('string');
 });

 it('preserves import/export statements (disableESTransforms: true)', () => {
 const source = `
 import { useState } from 'react';
 export default function Counter() {
 const [n, setN] = useState(0);
 return <button onClick={() => setN(n + 1)}>{n}</button>;
 }
 `;
 const code = transformJsx(source);
 // ES module imports/exports must survive for the SW module graph to work
 expect(code).toContain("import { useState } from 'react'");
 expect(code).toContain('export default function Counter');
 });

 it('throws on syntax-invalid JSX (propagates Sucrase parse error)', () => {
 const badSource = `export default function Bad() { return <div unclosed; }`;
 expect(() => transformJsx(badSource)).toThrow();
 });

 it('transform completes in under 200ms for a small component (NFR2 proxy)', () => {
 const source = `
 export default function PerfCard() {
 return (
 <div style={{ padding: 24, background: '#6366f1', color: '#fff', borderRadius: 8 }}>
 <h2>Performance test</h2>
 <p>Checking Sucrase transform speed</p>
 </div>
 );
 }
 `;
 const t0 = performance.now();
 transformJsx(source);
 const elapsed = performance.now() - t0;
 // 200ms is generous; in practice Sucrase < 5ms on warm JIT.
 // This test flags gross regressions (e.g. accidentally pulling in Babel).
 expect(elapsed).toBeLessThan(200);
 });
});
