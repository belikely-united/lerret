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

import { thinking, clarifyingNote } from '../events.js';
import { isVisionRequired } from '../../vision/router.js';
import { recognizeWorkflow } from '../workflows/recognize.js';
import { planLaunchKit } from '../workflows/launch-kit.js';
import { planSocialVariants } from '../workflows/social-variants.js';
import { readScopedFile, elementPinpoint, toProjectRelativeLerretPath } from './scoped-file.js';

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

// Selection-scoped file reading + element pinpoint live in ./scoped-file.js —
// SHARED with the Inspector (both provider-calling agents fold the selected
// asset into their prompts; live user-testing finding, 2026-06-12).

/**
 * Build the messages array for the planning call. Injects the Memory context
 * + brand tokens so the plan respects the user's brand. When `imageBlocks`
 * are supplied (vision turn on a vision-capable handle), the user message is
 * the provider-NEUTRAL multipart form `[{type:'text',…}, {type:'image',…}…]`
 * — each provider translates that to its vendor wire shape in its own
 * body-builder (providers/interface.js documents the contract). When
 * `scopedFile` is supplied (the dock selection chip), its current content is
 * folded in so edits rewrite the REAL file at its REAL path.
 *
 * @param {object} state
 * @param {Array<object>} [imageBlocks]
 * @param {{ path: string, content: string } | null} [scopedFile]
 * @returns {Array<{ role: string, content: string | Array<object> }>}
 */
function buildPlanningMessages(state, imageBlocks = [], scopedFile = null) {
    const brand = state.brandTokens && Object.keys(state.brandTokens).length
        ? `\n\nBrand tokens (authoritative): ${JSON.stringify(state.brandTokens)}`
        : '';
    const context = state.context ? `\n\nProject context:\n${state.context}` : '';
    // Element pinpoint (the dock chip's `scope.element`): the exact node the
    // user clicked inside the artboard — the request targets IT, not the
    // whole asset.
    const pinpoint = elementPinpoint(state.scope)
        ? `${elementPinpoint(state.scope)} Leave the rest of the file unchanged.`
        : '';
    const scoped = scopedFile
        ? `\n\nThe user has SELECTED this asset; the request applies to it. To edit it, ` +
          `emit ONE write step at exactly this path with the COMPLETE updated file. ` +
          `This selection takes precedence over every project-wide rule — including the ` +
          `_design-system.md rewrite — UNLESS the request explicitly says it applies to ` +
          `all assets / everything / the whole project, in which case honor the request's ` +
          `explicit project-wide intent instead.${pinpoint}\n` +
          `--- ${scopedFile.path} (current content) ---\n${scopedFile.content}\n--- end ---`
        : '';
    // Page / multi-artboard scopes carry no single file to fold in, but the
    // model must still know the request is anchored there rather than
    // project-wide (UX §4.1 chip semantics).
    const scopeKind = state.scope && typeof state.scope === 'object' ? state.scope.kind : null;
    const scopeLabel =
        !scopedFile && (scopeKind === 'page' || scopeKind === 'artboards') && state.scope.label
            ? `\n\nThe user has scoped this request to: ${String(state.scope.label).slice(0, 80)}. ` +
              `Keep new/edited files within that scope; do not retheme the whole project.`
            : '';
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
                'All paths MUST be under .lerret/.\n\n' +
                // The Lerret asset contract — without this the model produces
                // plausible-but-unloadable files (.html pages, bare snippets);
                // found by the Epic 8 close live-model session.
                'Lerret renders each .jsx file in a page folder as an artboard. Every asset ' +
                'you write MUST be a self-contained React component file at ' +
                '.lerret/<page>/<asset-name>.jsx with exactly this shape:\n' +
                '  export const meta = { dimensions: { width: <px>, height: <px> }, label: "<Title>" };\n' +
                '  export default function AssetName() { return ( <div style={{...}}>...</div> ); }\n' +
                'Rules: inline style objects only (no <style> tags, no CSS files, no className); ' +
                'no imports of any kind; no <html>/<head>/<body>; the root <div> fills the full ' +
                'meta dimensions. Edit an existing asset by rewriting its .jsx in place. Never ' +
                'write .html files. Markdown (.md) is allowed only when the user asks for notes/docs ' +
                '— with ONE exception: .lerret/_design-system.md is the project\'s brand authority ' +
                '(the colors/typography/voice tokens every asset reads; when present, its text ' +
                'appears in the project context below). ONLY when no asset is selected (no ' +
                'selected-asset block below) and the request asks for a PROJECT-WIDE look change ' +
                '(change the brand color, switch the typography, retheme everything), emit ONE ' +
                'write step rewriting .lerret/_design-system.md in place with the COMPLETE updated ' +
                'content — keep its existing structure and change only the values the request ' +
                'targets.\n' +
                'If you cannot produce a correct plan (for example the request targets one ' +
                'specific asset whose content you cannot see), respond ' +
                '{"steps":[],"note":"<one short sentence telling the user what to do — e.g. ' +
                'select that asset on the canvas and resend>"}.' +
                brand +
                context +
                scopeLabel +
                scoped,
        },
        { role: 'user', content: userContent },
    ];
}

/** Cap on the model's empty-plan `note` surfaced into the thread. */
const PLAN_NOTE_CHAR_CAP = 240;

/**
 * Parse the provider's planning response into `{ steps, note }`. Tolerant of
 * a fenced ```json block or a bare JSON object. `steps` is [] on unparseable
 * output (the turn then completes with no writes rather than crashing);
 * `note` carries the model's `{"steps":[],"note":"…"}` explanation — the
 * escape hatch the system prompt offers when it cannot produce a correct
 * plan — so an empty plan can be EXPLAINED in the thread instead of ending
 * as a silent "No files changed." (live user-testing finding, 2026-06-12).
 *
 * @param {string} content
 * @returns {{ steps: Array<import('./worker.js').WorkerStep>, note: string }}
 */
export function parsePlanResult(content) {
    const empty = { steps: [], note: '' };
    if (typeof content !== 'string') return empty;
    const text = content.trim();
    const tryParse = (t) => {
        try {
            return JSON.parse(t);
        } catch {
            return undefined;
        }
    };
    // Parse the RAW text first. The fence-unwrap must only ever be a
    // fallback: a plan whose file CONTENT embeds a fenced block (the
    // design-system's ```lerret-tokens``` — so every brand rewrite) would
    // otherwise have its JSON "unwrapped" down to the text between the
    // embedded fences and silently parse to nothing (live user-testing
    // finding, 2026-06-12).
    let parsed = tryParse(text);
    if (parsed === undefined) {
        const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
        if (fence) parsed = tryParse(fence[1].trim());
    }
    if (parsed === undefined) {
        // Real models often wrap the JSON in prose ("Here is the plan: {…}.")
        // — found by the Epic 8 close live-model session, where a whole edit
        // turn silently became "no files changed". Salvage the outermost
        // {...} block (of the raw text) before giving up.
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first === -1 || last <= first) return empty;
        parsed = tryParse(text.slice(first, last + 1));
        if (parsed === undefined) return empty;
    }
    const note =
        !Array.isArray(parsed) && typeof parsed?.note === 'string'
            ? parsed.note.trim().slice(0, PLAN_NOTE_CHAR_CAP)
            : '';
    const steps = Array.isArray(parsed) ? parsed : parsed?.steps;
    if (!Array.isArray(steps)) return { steps: [], note };
    // Whitelist the op so a typo'd/unknown op surfaces as a visibly-empty plan
    // (a no-op `done`) rather than silently being skipped step-by-step in the
    // Worker. Path validity is enforced by the sandbox at write time.
    const ALLOWED_OPS = new Set(['write', 'delete', 'mkdir']);
    return {
        steps: steps.filter(
            (s) => s && typeof s.op === 'string' && ALLOWED_OPS.has(s.op) && typeof s.path === 'string',
        ),
        note,
    };
}

/**
 * Back-compat steps-only view of {@link parsePlanResult}.
 *
 * @param {string} content
 * @returns {Array<import('./worker.js').WorkerStep>}
 */
export function parsePlan(content) {
    return parsePlanResult(content).steps;
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
        // flow through the LLM decomposition below, unchanged. The selection
        // chip's file serves as W3's reference when the prompt has a variant
        // cue but names no path ("make 3 variants of this") — the artifacts
        // never specified W3's reference selection; the chip is the natural
        // answer (gap closed 2026-06-12).
        const scopePath =
            state.scope && typeof state.scope === 'object' && state.scope.kind === 'file'
                ? toProjectRelativeLerretPath(state.scope.filePath)
                : undefined;
        const shape = recognizeWorkflow(state.prompt, { scopePath });
        if (shape.kind === 'launch-kit' && sandbox) {
            const plan = await planLaunchKit({
                prompt: state.prompt,
                platforms: shape.platforms,
                brandTokens: state.brandTokens,
                fs: sandbox,
            });
            // A workflow that plans nothing must explain itself, same as the
            // LLM branch — silent "No files changed." reads as broken.
            if (plan.length === 0) {
                emit(clarifyingNote('The launch-kit workflow planned nothing for this request — try naming the platforms (e.g. "launch kit for Twitter and LinkedIn").'));
            }
            return { plan };
        }
        if (shape.kind === 'social-variants' && sandbox) {
            const plan = await planSocialVariants({
                prompt: state.prompt,
                reference: shape.reference,
                brandTokens: state.brandTokens,
                fs: sandbox,
            });
            if (plan.length === 0) {
                emit(clarifyingNote(`Variants need an existing reference asset — couldn't find ${shape.reference?.path ?? 'one'}. Select the asset on the canvas (or name its file) and resend.`));
            }
            return { plan };
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

        // Selection-scoped file context: when the dock chip targets a single
        // asset, fold its CURRENT content into the planning prompt so an edit
        // rewrites the real file at its real path (FR50's "follow-ups stay
        // scoped" only means something if the planner can see the file).
        const scopedFile = await readScopedFile(state.scope, sandbox);

        // Re-check the signal immediately before the (expensive) LLM call — a
        // stop that landed between the entry guard and here should not pay for
        // the planning round-trip.
        if (state?.signal?.aborted) return { plan: [] };
        const result = await handle.complete({
            messages: buildPlanningMessages(state, imageBlocks, scopedFile),
            signal: state.signal,
        });
        const { steps, note } = parsePlanResult(result?.content ?? '');
        // An empty plan must never end as a SILENT "No files changed." —
        // surface the model's own note (the system prompt's escape hatch) or
        // a fixed pointer at the selection chip (live user-testing finding).
        if (steps.length === 0 && !state?.signal?.aborted) {
            emit(
                clarifyingNote(
                    note ||
                        'The model didn\'t return an actionable plan — try selecting the ' +
                            'target asset on the canvas, or name the file in your request.',
                ),
            );
        }
        return { plan: steps };
    };
}
