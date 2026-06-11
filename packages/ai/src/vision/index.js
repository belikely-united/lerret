// Public re-exports for the vision-on-demand router (Story 8.7, FR56).
// Consumed by:
//
//   - The Planner agent (orchestrator/agents/planner.js): `isVisionRequired`
//     decides whether the turn needs the vision-fallback decision point.
//   - The studio vision gate (packages/studio/src/ai/use-vision-gate.js):
//     `isVisionRequired` + `supportsVision` + `eligibleVisionProviders`
//     drive the State A (blocked) / State B (one-off prompt) branch BEFORE
//     a turn starts.
//   - The studio attach affordance (vision-attach-button.jsx): `supportsVision`
//     backs the reactive disabled-with-reason pattern.
//
// External callers reach this through `await import('@lerret/ai')` then
// `ai.vision.X`; the wrapping namespace is added in `packages/ai/src/index.js`
// (`export * as vision from './vision/index.js';`).
//
// The needs-vision-fallback TurnEvent + the resolver-callback decision
// mechanism are documented in ./router.js (and implemented by
// orchestrator/run-turn.js + orchestrator/events.js).

export {
    isVisionRequired,
    eligibleVisionProviders,
    shouldFallback,
    supportsVision,
    resolveEffectiveModel,
    DEFAULT_MODELS,
    DEFAULT_VISION_MODELS,
} from './router.js';
