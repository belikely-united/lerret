// Public re-exports for the generation-workflow layer (Story 8.8). The home
// for workflow-shape decomposition logic: the deterministic recognizer the
// Planner consults BEFORE its LLM call, plus the per-shape planners that turn
// a recognized shape into `WorkerStep[]` for the existing Worker → sandbox →
// snapshot → watcher → re-render chain.
//
// Future workflow shapes (W1 onboarding, W4 selection-scoped edit, W5 inspect
// — from the 2026-05-27 brainstorm) add sibling modules here following the
// same `plan<Workflow>(...) → Promise<WorkerStep[]>` signature.
//
// Reached from outside @lerret/ai as `ai.workflows.X` (mirroring the
// `snapshot` / `providers` / `vault` / `memory` namespace pattern in
// src/index.js).

export { recognizeWorkflow, KNOWN_PLATFORMS } from './recognize.js';
export { planLaunchKit } from './launch-kit.js';
export { planSocialVariants } from './social-variants.js';
