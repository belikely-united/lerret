// Planner agent — decomposes a high-level prompt into a sequence of concrete
// file-target WorkerStep objects by calling the active provider.
//
// The Planner is the only agent (besides the Inspector) that calls the
// provider — and it does so ONLY through the provider-handle passed in, never
// by constructing its own fetch. It also owns the vision-fallback DECISION
// point: if the turn carries an image attachment and the active model lacks
// vision, it requests a fallback decision via the bridge supplied by
// run-turn.js (which enumerates eligible providers, emits the
// `needs-vision-fallback` event, and either returns a configured override
// handle or throws VisionUnavailable).
//
// Story 8.3 ships the generic decomposition path. Story 8.8 extends with
// preset-aware W2/W3 planning — extend, do not rewrite.

import { thinking } from '../events.js';
import { isVisionRequired } from '../../vision/router.js';
import { recognizeWorkflow } from '../workflows/recognize.js';
import { planLaunchKit } from '../workflows/launch-kit.js';
import { planSocialVariants } from '../workflows/social-variants.js';

/**
 * Collect provider-NEUTRAL image blocks (providers/interface.js ImageBlock)
 * from the turn's attachments. Only payload-bearing image attachments
 * qualify: an image attachment without `base64`/`dataUrl` (a legacy
 * routing-only shape) is skipped, so the planning message degrades to
 * text-only rather than crashing (FR56).
 *
 * @param {Array<object>|undefined} attachments
 * @returns {Array<{ type: 'image', mimeType?: string, base64?: string, dataUrl?: string }>}
 */
function imageBlocksFromAttachments(attachments) {
    if (!Array.isArray(attachments)) return [];
    const blocks = [];
    for (const a of attachments) {
        if (!a || typeof a !== 'object') continue;
        // The three image-attachment shapes in circulation — mirrors the
        // vision router's isImageAttachment recognition (vision/router.js).
        const isImage =
            a.kind === 'image' ||
            a.type === 'image' ||
            (typeof a.mimeType === 'string' && a.mimeType.toLowerCase().startsWith('image/'));
        if (!isImage) continue;
        const base64 = typeof a.base64 === 'string' && a.base64.length > 0 ? a.base64 : undefined;
        const dataUrl = typeof a.dataUrl === 'string' && a.dataUrl.length > 0 ? a.dataUrl : undefined;
        if (!base64 && !dataUrl) continue; // payload-less — text-only fallback
        const block = { type: 'image' };
        if (typeof a.mimeType === 'string' && a.mimeType.length > 0) block.mimeType = a.mimeType;
        if (base64) block.base64 = base64;
        if (dataUrl) block.dataUrl = dataUrl;
        blocks.push(block);
    }
    return blocks;
}

/**
 * Build the messages array for the planning call. Injects the Memory context
 * + brand tokens so the plan respects the user's brand. When `imageBlocks`
 * are supplied (vision turn on a vision-capable handle), the user message is
 * the provider-NEUTRAL multipart form `[{type:'text',…}, {type:'image',…}…]`
 * — each provider translates that to its vendor wire shape in its own
 * body-builder (providers/interface.js documents the contract).
 *
 * @param {object} state
 * @param {Array<object>} [imageBlocks]
 * @returns {Array<{ role: string, content: string | Array<object> }>}
 */
function buildPlanningMessages(state, imageBlocks = []) {
    const brand = state.brandTokens && Object.keys(state.brandTokens).length
        ? `\n\nBrand tokens (authoritative): ${JSON.stringify(state.brandTokens)}`
        : '';
    const context = state.context ? `\n\nProject context:\n${state.context}` : '';
    const promptText = String(state.prompt ?? '');
    const userContent =
        imageBlocks.length > 0
            ? [{ type: 'text', text: promptText }, ...imageBlocks]
            : promptText;
    return [
        {
            role: 'system',
            content:
                'You are Lerret\'s asset planner. Decompose the user\'s request into a JSON ' +
                'array of file operations. Respond with ONLY a JSON object of the form ' +
                '{"steps":[{"op":"write"|"delete"|"mkdir","path":"...","content":"..."}]}. ' +
                'All paths MUST be under .lerret/.' +
                brand +
                context,
        },
        { role: 'user', content: userContent },
    ];
}

/**
 * Parse the provider's planning response into a WorkerStep array. Tolerant of
 * a fenced ```json block or a bare JSON object. Returns [] on unparseable
 * output (the turn then completes with no writes rather than crashing).
 *
 * @param {string} content
 * @returns {Array<import('./worker.js').WorkerStep>}
 */
export function parsePlan(content) {
    if (typeof content !== 'string') return [];
    let text = content.trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    if (fence) text = fence[1].trim();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return [];
    }
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps;
    if (!Array.isArray(steps)) return [];
    // Whitelist the op so a typo'd/unknown op surfaces as a visibly-empty plan
    // (a no-op `done`) rather than silently being skipped step-by-step in the
    // Worker. Path validity is enforced by the sandbox at write time.
    const ALLOWED_OPS = new Set(['write', 'delete', 'mkdir']);
    return steps.filter(
        (s) => s && typeof s.op === 'string' && ALLOWED_OPS.has(s.op) && typeof s.path === 'string',
    );
}

/**
 * Create the Planner node.
 *
 * @param {{
 *   providerHandle: import('./types.js').ProviderHandle,
 *   emit: (ev: unknown) => void,
 *   requestVisionDecision: () => Promise<import('./types.js').ProviderHandle>,
 *   sandbox?: object,
 * }} deps  `sandbox` (read-only use: exists/readFile) serves the Story 8.8
 *   workflow planners' fs needs; optional so planner-only unit tests need not
 *   supply one (recognized workflow shapes then fall back gracefully).
 * @returns {(state: object) => Promise<{ plan: Array<object> }>}
 */
export function createPlannerNode({ providerHandle, emit, requestVisionDecision, sandbox }) {
    return async function plannerNode(state) {
        if (state?.signal?.aborted) return { plan: [] };
        emit(thinking());

        // ── Recognized generation workflows (Story 8.8, FR54) ──────────────
        // W2 (launch kit) and W3 (social variants) decompose DETERMINISTICALLY
        // — no provider round-trip. Unrecognized shapes ('edit' / 'generic')
        // flow through the LLM decomposition below, unchanged.
        const shape = recognizeWorkflow(state.prompt);
        if (shape.kind === 'launch-kit' && sandbox) {
            return {
                plan: await planLaunchKit({
                    prompt: state.prompt,
                    platforms: shape.platforms,
                    brandTokens: state.brandTokens,
                    fs: sandbox,
                }),
            };
        }
        if (shape.kind === 'social-variants' && sandbox) {
            return {
                plan: await planSocialVariants({
                    prompt: state.prompt,
                    reference: shape.reference,
                    brandTokens: state.brandTokens,
                    fs: sandbox,
                }),
            };
        }

        // Vision-fallback decision (FR56). Recognition comes from the Story
        // 8.7 vision router: any attached image (`kind`/`type` of 'image' or
        // an image/* mimeType) triggers vision-required; prompt text alone
        // never does (v1).
        const needsVision = isVisionRequired(state.prompt, state.attachments);
        let handle = providerHandle;
        if (needsVision && !providerHandle.modelSupportsVision(providerHandle.model)) {
            // requestVisionDecision (from run-turn) returns a configured
            // override handle on accept, or throws VisionUnavailable on
            // decline / no-eligible-provider. The override routes JUST this
            // vision call; the turn continues with the active handle for
            // non-vision steps (there are none after planning in this story).
            handle = await requestVisionDecision();
        }

        // FR56 image DELIVERY (not just routing): when the turn needs vision
        // AND the resolved handle's model supports it, attach the image
        // payloads as provider-neutral blocks — the providers translate them
        // to their vendor wire shapes. Attachments without a base64/dataUrl
        // payload yield no blocks, so the message falls back to text-only.
        const imageBlocks =
            needsVision && handle.modelSupportsVision(handle.model)
                ? imageBlocksFromAttachments(state.attachments)
                : [];

        // Re-check the signal immediately before the (expensive) LLM call — a
        // stop that landed between the entry guard and here should not pay for
        // the planning round-trip.
        if (state?.signal?.aborted) return { plan: [] };
        const result = await handle.complete({
            messages: buildPlanningMessages(state, imageBlocks),
            signal: state.signal,
        });
        const plan = parsePlan(result?.content ?? '');
        return { plan };
    };
}
