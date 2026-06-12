// Agent Executor — the Ask lane's node (Epic 9, ADR-006).
//
// Replaces the Planner→Worker hand-off in the graph with ONE node that runs
// the bounded agentic tool loop: the model iteratively lists, reads, writes,
// and deletes inside `.lerret/` until the request is satisfied (or a cap /
// stop lands). The graph drops from six nodes to five; the Worker survives
// as the MUTATION MODULE — every `write_file`/`delete_file` tool execution
// is a `createWorkerNode` single-step run, so snapshot pre-capture, NFR18
// finish-the-write semantics, `writing`/`deleting` events, and the
// single-mutator guarantee are inherited verbatim, not re-implemented.
//
// Three branches, in cost order (mirrors the Epic 8 planner exactly where it
// can):
//   1. W2/W3 recognized workflows — deterministic plans, ZERO provider calls
//      (chip-as-reference included). Executed through the Worker.
//   2. Tool-capable model — the agentic loop (`tools/loop.js`) with executors
//      INJECTED here: reads go straight to the sandbox, mutations go through
//      the Worker. The loop itself imports neither (the inspect lane reuses
//      it read-only — keeping mutation OUT of loop.js is what makes that
//      guarantee structural).
//   3. Tool-incapable model — graceful degradation to the Epic 8 single-shot
//      planner (FR64) + a clarifying note naming the limitation.
//
// CRITICAL: like the Worker, this file must not import `node:*` or call a
// provider directly — the handle and the sandbox are passed in.

import { clarifyingNote } from '../events.js';
import { runAgentLoop } from '../tools/loop.js';
import {
    ALL_TOOLS,
    LIST_DIR_MAX_ENTRIES,
    formatListing,
    capFileContent,
} from '../tools/definitions.js';
import { supportsTools } from '../../providers/tool-support.js';
import { createWorkerNode } from './worker.js';
import { createPlannerNode, imageBlocksFromAttachments } from './planner.js';
import { readScopedFile, elementPinpoint, toProjectRelativeLerretPath } from './scoped-file.js';
import { isVisionRequired } from '../../vision/router.js';
import { recognizeWorkflow } from '../workflows/recognize.js';
import { planLaunchKit } from '../workflows/launch-kit.js';
import { planSocialVariants } from '../workflows/social-variants.js';

/** Default per-turn iteration cap (ADR-006 §3; OpenRouter/Claude Code norm). */
export const DEFAULT_MAX_TURNS = 10;

/**
 * Canonicalize a model-supplied path to the sandbox's `.lerret/<rel>` form.
 * The model is TOLD to use project-relative paths, but real models send
 * `.lerret/`-prefixed and absolute shapes too — normalize at the seam (Epic 8
 * retro addendum-5 lesson), never trust the shape.
 *
 * @param {unknown} p
 * @returns {string | null}
 */
function canonPath(p) {
    if (typeof p !== 'string' || p.trim().length === 0) return null;
    const trimmed = p.trim();
    if (trimmed === '.lerret' || trimmed === '.lerret/') return '.lerret/';
    const rel = toProjectRelativeLerretPath(trimmed);
    return rel ? `.lerret/${rel.replace(/^\/+/, '')}` : null;
}

/**
 * The loop-flavored system prompt. Carries the SAME load-bearing fragments as
 * the Epic 8 planner prompt (asset contract, design-system brand authority,
 * selection precedence) — a sync test pins both so they cannot drift — plus
 * the tool guidance that replaces the JSON-plan instruction.
 *
 * @param {object} state
 * @param {{ path: string, content: string } | null} scopedFile
 * @returns {string}
 */
export function buildLoopSystemPrompt(state, scopedFile = null) {
    const brand =
        state.brandTokens && Object.keys(state.brandTokens).length
            ? `\n\nBrand tokens (authoritative): ${JSON.stringify(state.brandTokens)}`
            : '';
    const context = state.context ? `\n\nProject context:\n${state.context}` : '';
    const pinpoint = elementPinpoint(state.scope)
        ? `${elementPinpoint(state.scope)} Leave the rest of the file unchanged.`
        : '';
    const scoped = scopedFile
        ? `\n\nThe user has SELECTED this asset; the request applies to it. Edit it by ` +
          `writing the COMPLETE updated file at exactly this path. ` +
          `This selection takes precedence over every project-wide rule — including the ` +
          `_design-system.md rewrite — UNLESS the request explicitly says it applies to ` +
          `all assets / everything / the whole project.${pinpoint}\n` +
          `--- ${scopedFile.path} (current content) ---\n${scopedFile.content}\n--- end ---`
        : '';
    const scopeKind = state.scope && typeof state.scope === 'object' ? state.scope.kind : null;
    const scopeLabel =
        !scopedFile && (scopeKind === 'page' || scopeKind === 'artboards') && state.scope.label
            ? `\n\nThe user has scoped this request to: ${String(state.scope.label).slice(0, 80)}. ` +
              `Keep new/edited files within that scope; do not retheme the whole project.`
            : '';
    return (
        'You are Lerret\'s in-studio design agent. You work INSIDE the user\'s project ' +
        'using the provided tools (list_dir, read_file, write_file, delete_file). All ' +
        'paths MUST be under .lerret/.\n\n' +
        'How to work: if you do not know the project structure, start with ' +
        'list_dir(".lerret/"). ALWAYS read_file before rewriting an existing file. ' +
        'Complete the ENTIRE request — including multi-step requests — then finish ' +
        'WITHOUT tool calls, replying with a short summary (1–3 sentences) of what you ' +
        'did. If the request is impossible or unclear, finish with one sentence saying ' +
        'what you need. Never ask a question you can answer with a tool.\n\n' +
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
        '(the colors/typography/voice tokens every asset reads). ONLY when no asset is ' +
        'selected (no selected-asset block below) and the request asks for a PROJECT-WIDE ' +
        'look change (change the brand color, switch the typography, retheme everything), ' +
        'rewrite .lerret/_design-system.md in place with the COMPLETE updated content — ' +
        'keep its existing structure and change only the values the request targets.' +
        brand +
        context +
        scopeLabel +
        scoped
    );
}

/**
 * Build the four tool executors. Reads hit the sandbox directly; mutations
 * run through a single-step Worker plan so snapshot/NFR18/event semantics are
 * the Worker's, not ours. The Worker emits `writing`/`deleting` itself, so
 * mutation results carry NO meta (the loop only emits for read/list metas —
 * no double events). Executor failures RETURN isError results; they never
 * throw (the loop feeds errors back to the model — self-correction, not a
 * dead turn).
 *
 * @param {{
 *   sandbox: object,
 *   workerNode: (state: object) => Promise<{ manifest: object, writtenFiles: Array<object> }>,
 *   manifestRef: { current: object },
 *   writtenFiles: Array<{ path: string, op: string }>,
 *   signal: AbortSignal | undefined,
 * }} deps
 */
export function buildExecutors({ sandbox, workerNode, manifestRef, writtenFiles, signal }) {
    const badPath = (p) => ({
        content: `Invalid path "${String(p)}" — paths must be inside .lerret/ (e.g. "social/card.jsx").`,
        isError: true,
    });
    return {
        list_dir: async (args) => {
            const p = canonPath(args?.path ?? '.lerret/');
            if (!p) return badPath(args?.path);
            try {
                const entries = await sandbox.listDir(p);
                return { content: formatListing(entries), meta: { op: 'list', file: p } };
            } catch (err) {
                return { content: `Could not list ${p}: ${err?.message ?? err}`, isError: true };
            }
        },
        read_file: async (args) => {
            const p = canonPath(args?.path);
            if (!p || p === '.lerret/') return badPath(args?.path);
            try {
                const raw = await sandbox.readFile(p, { encoding: 'utf-8' });
                const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
                return { content: capFileContent(text), meta: { op: 'read', file: p } };
            } catch (err) {
                return { content: `Could not read ${p}: ${err?.message ?? err}`, isError: true };
            }
        },
        write_file: async (args) => {
            const p = canonPath(args?.path);
            if (!p || p === '.lerret/') return badPath(args?.path);
            if (typeof args?.content !== 'string') {
                return { content: 'write_file requires string `content` (the COMPLETE file).', isError: true };
            }
            try {
                // Parent folders auto-create (the tool contract) — a single-step
                // mkdir ahead of the write; idempotent on existing dirs.
                const parent = p.split('/').slice(0, -1).join('/');
                const plan = [
                    ...(parent && parent !== '.lerret' ? [{ op: 'mkdir', path: parent }] : []),
                    { op: 'write', path: p, content: args.content },
                ];
                const res = await workerNode({ manifest: manifestRef.current, signal, plan });
                manifestRef.current = res.manifest;
                writtenFiles.push(...res.writtenFiles);
                if (res.writtenFiles.length === 0) {
                    return { content: `Write of ${p} was not applied (turn stopping).`, isError: true };
                }
                return { content: `Wrote ${p} (${res.writtenFiles[0].op}).` };
            } catch (err) {
                return { content: `Could not write ${p}: ${err?.message ?? err}`, isError: true };
            }
        },
        delete_file: async (args) => {
            const p = canonPath(args?.path);
            if (!p || p === '.lerret/') return badPath(args?.path);
            try {
                const res = await workerNode({
                    manifest: manifestRef.current,
                    signal,
                    plan: [{ op: 'delete', path: p }],
                });
                manifestRef.current = res.manifest;
                writtenFiles.push(...res.writtenFiles);
                if (res.writtenFiles.length === 0) {
                    return { content: `Delete of ${p} was not applied (turn stopping).`, isError: true };
                }
                return { content: `Deleted ${p}.` };
            } catch (err) {
                return { content: `Could not delete ${p}: ${err?.message ?? err}`, isError: true };
            }
        },
    };
}

/**
 * Create the Agent Executor node.
 *
 * @param {{
 *   providerHandle: object,
 *   emit: (ev: unknown) => void,
 *   requestVisionDecision: () => Promise<object>,
 *   onContinueDecision?: (info: { turnsUsed: number, spentTokens: number }) => Promise<boolean>,
 *   sandbox: object,
 *   fs: object,
 *   projectRoot: string,
 *   snapshot: object,
 *   maxTurns?: number,
 * }} deps
 * @returns {(state: object) => Promise<{ manifest?: object, writtenFiles: Array<object>, answer: string, plan: Array<object> }>}
 */
export function createAgentExecutorNode({
    providerHandle,
    emit,
    requestVisionDecision,
    onContinueDecision,
    sandbox,
    fs,
    projectRoot,
    snapshot,
    maxTurns = DEFAULT_MAX_TURNS,
}) {
    const workerNode = createWorkerNode({ sandbox, fs, projectRoot, emit, snapshot });
    // The Epic 8 single-shot planner — branch 3's graceful degradation (FR64).
    const plannerNode = createPlannerNode({ providerHandle, emit, requestVisionDecision, sandbox });

    return async function agentExecutorNode(state) {
        if (state?.signal?.aborted) return { writtenFiles: [], answer: '', plan: [] };

        // ── Branch 1: W2/W3 deterministic workflows (zero provider calls) ──
        const scopePath =
            state.scope && typeof state.scope === 'object' && state.scope.kind === 'file'
                ? toProjectRelativeLerretPath(state.scope.filePath)
                : undefined;
        const shape = recognizeWorkflow(state.prompt, { scopePath });
        if (shape.kind === 'launch-kit' || shape.kind === 'social-variants') {
            const plan =
                shape.kind === 'launch-kit'
                    ? await planLaunchKit({
                          prompt: state.prompt,
                          platforms: shape.platforms,
                          brandTokens: state.brandTokens,
                          fs: sandbox,
                      })
                    : await planSocialVariants({
                          prompt: state.prompt,
                          reference: shape.reference,
                          brandTokens: state.brandTokens,
                          fs: sandbox,
                      });
            if (plan.length === 0) {
                emit(
                    clarifyingNote(
                        shape.kind === 'launch-kit'
                            ? 'The launch-kit workflow planned nothing for this request — try naming the platforms (e.g. "launch kit for Twitter and LinkedIn").'
                            : `Variants need an existing reference asset — couldn't find ${shape.reference?.path ?? 'one'}. Select the asset on the canvas (or name its file) and resend.`,
                    ),
                );
                return { writtenFiles: [], answer: '', plan: [] };
            }
            const res = await workerNode({ manifest: state.manifest, signal: state.signal, plan });
            return { manifest: res.manifest, writtenFiles: res.writtenFiles, answer: '', plan };
        }

        // ── Branch 3 (checked before 2's cost): tool-incapable path ───────
        // Two ways in: the MODEL lacks tool calling (FR64 — say so with a
        // clarifying note), or the HANDLE lacks completeWithTools (a custom
        // resolver/test double — degrade silently; there is nothing useful
        // to tell the user about their own injected handle).
        const modelToolCapable = supportsTools(providerHandle.name, providerHandle.model);
        const handleToolCapable = typeof providerHandle.completeWithTools === 'function';
        if (!modelToolCapable || !handleToolCapable) {
            if (!modelToolCapable) {
                emit(
                    clarifyingNote(
                        `${providerHandle.model ?? providerHandle.name} doesn't support tool use — ran in single-step mode. Multi-step requests work best with a tool-capable model.`,
                    ),
                );
            }
            const planned = await plannerNode(state);
            const plan = Array.isArray(planned?.plan) ? planned.plan : [];
            const res = await workerNode({ manifest: state.manifest, signal: state.signal, plan });
            return { manifest: res.manifest, writtenFiles: res.writtenFiles, answer: '', plan };
        }

        // ── Branch 2: the agentic loop ─────────────────────────────────────
        // Vision routes exactly as the Epic 8 planner did: an image on a
        // vision-less active model asks the user for a one-off override; the
        // override handle then drives the WHOLE loop (the image lives in the
        // history every iteration reads).
        const needsVision = isVisionRequired(state.prompt, state.attachments);
        let handle = providerHandle;
        if (needsVision && !providerHandle.modelSupportsVision(providerHandle.model)) {
            handle = await requestVisionDecision();
        }
        const imageBlocks =
            needsVision && handle.modelSupportsVision(handle.model)
                ? imageBlocksFromAttachments(state.attachments)
                : [];
        const scopedFile = await readScopedFile(state.scope, sandbox);
        const promptText = String(state.prompt ?? '');
        const messages = [
            { role: 'system', content: buildLoopSystemPrompt(state, scopedFile) },
            {
                role: 'user',
                content:
                    imageBlocks.length > 0
                        ? [{ type: 'text', text: promptText }, ...imageBlocks]
                        : promptText,
            },
        ];

        const manifestRef = { current: state.manifest };
        /** @type {Array<{ path: string, op: string }>} */
        const writtenFiles = [];
        const executors = buildExecutors({
            sandbox,
            workerNode,
            manifestRef,
            writtenFiles,
            signal: state.signal,
        });

        if (state?.signal?.aborted) return { writtenFiles, answer: '', plan: [] };
        const result = await runAgentLoop({
            providerHandle: handle,
            tools: ALL_TOOLS,
            executors,
            messages,
            signal: state.signal,
            emit,
            maxTurns,
            onContinueDecision,
        });

        const answer =
            result.status === 'cap-stopped' && !result.text
                ? 'Stopped at the step cap.'
                : (result.text ?? '');
        return { manifest: manifestRef.current, writtenFiles, answer, plan: [] };
    };
}

// Re-exported so the cap constant is visible to tests without magic numbers.
export { LIST_DIR_MAX_ENTRIES };
