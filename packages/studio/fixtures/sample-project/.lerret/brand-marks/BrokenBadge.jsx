// Fixture asset — a component that DELIBERATELY THROWS AT RENDER TIME.
//
// This exists to exercise per-asset error containment. When
// the canvas renders this component it throws; `AssetErrorBoundary` (from the
// asset-runtime interface) catches it, so this one artboard fails inside its
// own card while every other asset on the canvas renders normally. The point
// here is only that the failure is CONTAINED, not that it crashes the runtime
// or blanks the canvas.

export default function BrokenBadge() {
 // A real render-time fault — reading a property off `undefined`, the most
 // common way a user asset breaks.
 const data = undefined;
 return <div>{data.value.label}</div>;
}
