/**
 * use-vision-gate.js — the dock's vision submit-gate hook (Story 8.7, FR56;
 * UX-delta §4.7 States A + B).
 *
 * The dock submit handler calls `evaluate({ prompt, attachments })` BEFORE
 * running a turn and acts on the returned decision — the hook returns
 * decisions, it never owns the submit:
 *
 *   { action: 'run' }
 *       Vision not required, or the active model already sees images
 *       (or @lerret/ai / ai.vision is unavailable — fail-safe: the turn
 *       proceeds and the orchestrator's own VisionUnavailable backstop
 *       applies). Run the turn normally.
 *
 *   { action: 'blocked-state-a' }
 *       Vision required, active model can't see images, and NO cloud
 *       provider is available for a one-off fallback. The turn must NOT run
 *       — the submission is consumed (AC-9: no modal, no overlay). The hook
 *       arms the calm feedback itself: `stateANote` becomes the verbatim
 *       inline note (sticky until the next evaluate / clearStateA) and
 *       `pillFlash` goes true for 1500ms (VISION_PILL_MS) so the cluster's
 *       status pill can flash `Vision unavailable` (Stone).
 *
 *   { action: 'prompt', eligibleProviders }
 *       Vision required, active model can't see images, and ≥1 cloud
 *       provider can serve the turn (State B). The host renders
 *       <VisionFallbackPrompt eligibleProviders={...}> above the dock input;
 *       on accept it runs the ORIGINAL submission with
 *       `runTurn({ ..., providerOverride: handle.providerName })` — one turn
 *       only, the persisted active provider NEVER changes (AC-13; no
 *       makeActive, no vault write); on cancel it discards the submission and
 *       refocuses the input (AC-14). The acknowledgement is NEVER remembered
 *       (AC-15) — the next vision-requiring submit prompts afresh.
 *
 * State B candidates are filtered to handles that the BUILT orchestrator can
 * honor end-to-end: cloud variant (`cloud-byok` — the UX copy directs users
 * to a CLOUD provider; local Ollama can't be assumed to have a vision model
 * pulled), NOT the active provider (UX-delta: "cloud configured but not
 * active"; mirrors run-turn's enumerateVision exclusion), and
 * `source: 'configured'` (the provider's own configured/default model is
 * itself vision-capable, so `runTurn`'s `providerOverride` — which resolves
 * the CONFIGURED model — genuinely serves the vision turn). Family-default
 * handles (`source: 'default'`) are excluded in v1: accepting one would run
 * the override turn on the provider's configured NON-vision model and error.
 *
 * ── Orchestrator mirror (`onVisionDecision`) ────────────────────────────────
 * The hook also returns `onVisionDecision`, shaped exactly for
 * `runTurn({ ..., onVisionDecision })`: the orchestrator-side mirror of the
 * State B branch for a turn that reaches the Planner needing vision (the
 * `needs-vision-fallback` TurnEvent path). It renders the SAME prompt via the
 * injected `requestDecision` and resolves `{ accept, providerOverride }`
 * (provider NAME, per orchestrator/events.js). Without an injected
 * `requestDecision` it declines — the orchestrator then raises
 * VisionUnavailable and the turn ends as a calm error.
 *
 * All @lerret/ai access goes through `getAi()` (lazy.js) — never a static
 * import (no-static-imports invariant).
 */

import React from 'react';

import { getAi } from './lazy.js';
import { useAiContext } from './ai-context.jsx';

/**
 * The verbatim State A inline note (AC-8) — the user-facing contract. Do not
 * paraphrase. (Deliberately distinct from the attach button's
 * VISION_ATTACH_DISABLED_TOOLTIP — "This model…" vs "Active model…".)
 *
 * @type {string}
 */
export const VISION_STATE_A_NOTE =
    "This model can't see images. Configure a cloud provider in settings to enable vision.";

/**
 * The State A transient status-pill label (AC-7) — Stone token color.
 *
 * @type {string}
 */
export const VISION_PILL_LABEL = 'Vision unavailable';

/**
 * How long the State A pill flash lasts (AC-7).
 *
 * @type {number}
 */
export const VISION_PILL_MS = 1500;

/**
 * @typedef {{ action: 'run' }
 *   | { action: 'blocked-state-a' }
 *   | { action: 'prompt', eligibleProviders: Array<object> }
 * } VisionGateDecision
 */

/**
 * The vision submit gate.
 *
 * @param {object} [deps]
 * @param {(eligibleProviders: Array<object>) => Promise<{ accept: boolean, handle?: object }>} [deps.requestDecision]
 *   Host-supplied prompt machinery: render <VisionFallbackPrompt> for the
 *   given providers and resolve with the user's choice. Used by
 *   `onVisionDecision` (the mid-turn event mirror). Optional — without it the
 *   mid-turn path declines.
 * @returns {{
 *   evaluate: (turn: { prompt?: string, attachments?: Array<object> }) => Promise<VisionGateDecision>,
 *   onVisionDecision: (event: object) => Promise<{ accept: boolean, providerOverride?: string }>,
 *   stateANote: string | null,
 *   pillFlash: boolean,
 *   clearStateA: () => void,
 * }}
 */
export function useVisionGate({ requestDecision } = {}) {
    const { providerConfigs, activeProvider } = useAiContext();

    const [stateANote, setStateANote] = React.useState(/** @type {string | null} */ (null));
    const [pillFlash, setPillFlash] = React.useState(false);
    const pillTimerRef = React.useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));

    React.useEffect(
        () => () => {
            if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
        },
        [],
    );

    const clearStateA = React.useCallback(() => {
        setStateANote(null);
        setPillFlash(false);
        if (pillTimerRef.current) {
            clearTimeout(pillTimerRef.current);
            pillTimerRef.current = null;
        }
    }, []);

    const armStateA = React.useCallback(() => {
        setStateANote(VISION_STATE_A_NOTE);
        setPillFlash(true);
        if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
        pillTimerRef.current = setTimeout(() => {
            setPillFlash(false);
            pillTimerRef.current = null;
        }, VISION_PILL_MS);
    }, []);

    const activeModel = React.useMemo(
        () => providerConfigs.find((c) => c.providerName === activeProvider)?.model,
        [providerConfigs, activeProvider],
    );

    const evaluate = React.useCallback(
        async ({ prompt, attachments } = {}) => {
            // A fresh submission clears the previous State A feedback.
            clearStateA();

            const ai = await getAi();
            const vision = ai?.vision;
            // Fail-safe: without the vision namespace the gate cannot
            // adjudicate — let the turn run; the orchestrator's
            // VisionUnavailable backstop still protects the egress.
            if (
                !vision ||
                typeof vision.isVisionRequired !== 'function' ||
                typeof vision.supportsVision !== 'function' ||
                typeof vision.eligibleVisionProviders !== 'function'
            ) {
                return { action: 'run' };
            }

            if (!vision.isVisionRequired(prompt, attachments)) return { action: 'run' };

            // Vision required + the active model already sees images → run.
            if (activeProvider && vision.supportsVision(activeProvider, activeModel)) {
                return { action: 'run' };
            }

            // Vision required + active model can't see images → A or B.
            const handles = vision.eligibleVisionProviders(providerConfigs) ?? [];
            const eligible = handles.filter(
                (h) =>
                    h &&
                    h.variant === 'cloud-byok' &&
                    h.providerName !== activeProvider &&
                    h.source === 'configured',
            );

            if (eligible.length === 0) {
                armStateA();
                return { action: 'blocked-state-a' };
            }
            return { action: 'prompt', eligibleProviders: eligible };
        },
        [providerConfigs, activeProvider, activeModel, clearStateA, armStateA],
    );

    const onVisionDecision = React.useCallback(
        async (event) => {
            if (typeof requestDecision !== 'function') return { accept: false };
            const eligible = Array.isArray(event?.eligibleProviders) ? event.eligibleProviders : [];
            if (eligible.length === 0) return { accept: false };
            const res = await requestDecision(eligible);
            if (!res || res.accept !== true) return { accept: false };
            const handle = res.handle ?? eligible[0];
            return { accept: true, providerOverride: handle.providerName ?? handle.name };
        },
        [requestDecision],
    );

    return { evaluate, onVisionDecision, stateANote, pillFlash, clearStateA };
}

export default useVisionGate;
