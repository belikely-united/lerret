// Fixture asset — a module that DELIBERATELY THROWS AT MODULE-EVALUATION TIME.
//
// Unlike `BrokenBadge.jsx` (which throws while React renders it), this throws
// the instant Vite evaluates the module's top-level code — before any
// component exists. The vite-runtime's dynamic `import()` rejects, and
// `loadAsset` resolves to an `'error'` entry (phase `'evaluate'`) instead of
// rejecting. Together the two broken fixtures cover both error phases:
// a module-evaluation throw and a render throw.

throw new Error('BrokenOnLoad: this asset fails at module evaluation (fixture)');

// eslint-disable-next-line no-unreachable
export default function BrokenOnLoad() {
 return <div>unreachable</div>;
}
