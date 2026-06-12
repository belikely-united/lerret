// Agent loop — the bounded, provider-agnostic tool loop at the heart of
// Epic 9 (ADR-006; architecture-epic-9 §2 is the normative algorithm). One
// loop turn = one `completeWithTools` provider call; the model keeps
// requesting tools until it answers with zero tool calls (done), the user
// aborts (stopped), or the turn cap intervenes (cap-stopped — surfaced as an
// explicit user-facing Continue? decision, never a silent stop; NFR-E9-3).
//
// CRITICAL: this file MUST NOT import the Worker, a sandbox, or any
// fs/node:* module. Tool EXECUTORS ARE INJECTED — the caller decides what
// each tool name may touch. That injection is what makes the Inspect lane's
// read-only guarantee STRUCTURAL (ADR-006 §4): the Inspector simply never
// registers a write executor, and the inspect-no-worker guard (Story 9.5)
// scans this module to keep mutation out of the loop itself.
//
// Failure philosophy: tool failures are CONVERSATION, not exceptions. A
// guarded repeat, an unknown tool name, and a throwing executor all become
// `isError: true` ToolResults the model reads and self-corrects from — the
// loop never throws out of tool execution. Provider errors and a throwing
// `onContinueDecision` DO propagate: run-turn.js owns turn-level error
// classification (Epic 8 semantics, unchanged).

import {
    thinking,
    toolCall,
    reading,
    writing,
    deleting,
    turnProgress,
    needsContinue,
} from '../events.js';

/** @typedef {import('./definitions.js').ToolDef} ToolDef */
/** @typedef {import('./definitions.js').ToolCall} ToolCall */
/** @typedef {import('./definitions.js').ToolResult} ToolResult */

// The repetition guard's synthetic feedback — the model asked for the exact
// action it just performed, so we coach it forward instead of re-executing
// (ADR-006 §3: the guard is how a confused model escapes its own rut).
const REPEAT_GUARD_CONTENT =
    'You already performed this exact action. Choose a different action or finish with a summary.';

/** Per-iteration output ceiling passed to every provider call — write_file
 * carries complete file contents, so vendor defaults (4096) are too small. */
export const LOOP_MAX_OUTPUT_TOKENS = 16384;

/** Vendor stop reasons that mean "output truncated mid-thought" — Anthropic
 * 'max_tokens', OpenAI-shape 'length' (OpenAI/OpenRouter/Ollama compat). */
const TRUNCATION_STOP_REASONS = new Set(['max_tokens', 'length']);

/**
 * Identity key for the repetition guard: name + canonical args JSON.
 * Circular args (a malformed translator output) degrade to String() rather
 * than throwing — the guard must never be the thing that kills a turn.
 *
 * @param {ToolCall} call
 * @returns {string}
 */
function callKey(call) {
    // Keys are sorted recursively so `{path,content}` and `{content,path}`
    // (key order rides through JSON.parse from the model's wire output) hash
    // identically (review finding L1, 2026-06-13).
    const sortKeys = (v) => {
        if (Array.isArray(v)) return v.map(sortKeys);
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
            return out;
        }
        return v;
    };
    let argsKey;
    try {
        argsKey = JSON.stringify(sortKeys(call.args));
    } catch {
        argsKey = String(call.args);
    }
    return `${call.name}\u0000${argsKey}`;
}

/**
 * Coerce one usage counter to a finite number; anything malformed counts 0 —
 * spend accounting must stay additive even when a provider omits `usage`.
 *
 * @param {unknown} value
 * @returns {number}
 */
function coerceCount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Run the bounded agent loop (architecture-epic-9 §2, verbatim semantics).
 *
 * `messages` is the live, caller-owned history: the loop appends neutral
 * `{role:'assistant', content, toolCalls}` and `{role:'tool', results}` turns
 * in place, which is exactly what makes a Continue-at-the-cap resume "the
 * same conversation" — nothing is rebuilt. Message `content` may be a string
 * or multipart blocks; the loop treats it as OPAQUE and never inspects it
 * (the provider translators own that shape).
 *
 * Per processed call the loop emits `tool-call{name}`, then — keyed off the
 * executor result's `meta` — `reading`/`writing`/`deleting`. The executor
 * controls `meta`, so an executor that doesn't want a file event (e.g. a
 * failed write) simply omits it.
 *
 * @param {{
 *   providerHandle: { completeWithTools: (req: { messages: Array<object>, tools: ToolDef[], signal?: AbortSignal }) => Promise<{ text: string, toolCalls: ToolCall[], usage?: { inputTokens?: number, outputTokens?: number } }> },
 *   tools: ToolDef[],
 *   executors: { [toolName: string]: (args: object) => Promise<{ content: string, isError?: boolean, meta?: { op: 'list'|'read'|'write'|'delete', file?: string } }> },
 *   messages: Array<{ role: string, content?: unknown }>,
 *   signal?: { aborted: boolean },
 *   emit?: (event: object) => void,
 *   maxTurns?: number,
 *   onContinueDecision?: (info: { turnsUsed: number, spentTokens: number }) => Promise<boolean> | boolean,
 * }} opts
 * @returns {Promise<{
 *   status: 'done'|'stopped'|'cap-stopped',
 *   text: string,
 *   usage: { inputTokens: number, outputTokens: number, calls: number },
 *   steps: Array<{ name: string, args: object, isError: boolean }>,
 * }>}
 */
export async function runAgentLoop({
    providerHandle,
    tools,
    executors = {},
    messages,
    signal,
    emit,
    maxTurns = 10,
    onContinueDecision,
} = {}) {
    if (!providerHandle || typeof providerHandle.completeWithTools !== 'function') {
        throw new Error('runAgentLoop: providerHandle must expose a completeWithTools() method');
    }
    if (!Array.isArray(messages)) {
        throw new Error('runAgentLoop: messages must be the initial history array');
    }
    const send = typeof emit === 'function' ? emit : () => {};
    const capStep =
        Number.isFinite(Number(maxTurns)) && Number(maxTurns) > 0
            ? Math.floor(Number(maxTurns))
            : 10;

    const usage = { inputTokens: 0, outputTokens: 0, calls: 0 };
    const steps = [];
    let effectiveMax = capStep;
    let turnNumber = 0;
    let lastText = '';
    let lastExecutedKey = null;

    const finish = (status) => ({ status, text: lastText, usage, steps });

    for (;;) {
        // Abort is re-checked before EVERY provider call (NFR-E9-2).
        if (signal?.aborted) return finish('stopped');

        turnNumber += 1;
        send(thinking());
        const response = await providerHandle.completeWithTools({
            messages,
            tools,
            signal,
            // write_file carries COMPLETE file contents as tool-input JSON —
            // vendor default output ceilings (Anthropic: 4096) truncate real
            // asset rewrites (review finding M3, 2026-06-13).
            maxTokens: LOOP_MAX_OUTPUT_TOKENS,
        });

        usage.inputTokens += coerceCount(response?.usage?.inputTokens);
        usage.outputTokens += coerceCount(response?.usage?.outputTokens);
        usage.calls += 1;
        lastText = typeof response?.text === 'string' ? response.text : '';

        const requestedCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
        if (requestedCalls.length === 0) {
            // A truncation that produced NO parseable tool call is not a
            // clean finish — the "summary" would be a cut-off fragment.
            // Nudge the model to resume instead of silently shipping it
            // (review finding M3, 2026-06-13); maxTurns still bounds us.
            const truncated =
                typeof response?.stopReason === 'string' &&
                TRUNCATION_STOP_REASONS.has(response.stopReason);
            if (truncated && turnNumber < effectiveMax) {
                messages.push({ role: 'assistant', content: lastText });
                messages.push({
                    role: 'user',
                    content:
                        'Your reply was cut off by the output-token limit. Continue: issue ' +
                        'the next tool call (keep any file write in ONE complete call), or ' +
                        'give the short closing summary.',
                });
                send(turnProgress(turnNumber, effectiveMax, usage.inputTokens + usage.outputTokens));
                continue;
            }
            // Zero tool calls → DONE: the response text IS the turn summary.
            send(turnProgress(turnNumber, effectiveMax, usage.inputTokens + usage.outputTokens));
            return finish('done');
        }

        // Append the assistant turn verbatim, then execute SEQUENTIALLY —
        // writes are order-dependent (architecture §2).
        messages.push({ role: 'assistant', content: lastText, toolCalls: requestedCalls });

        const results = [];
        for (const call of requestedCalls) {
            // ... and before EVERY tool execution (NFR-E9-2).
            if (signal?.aborted) return finish('stopped');

            send(toolCall(call.name));
            const key = callKey(call);
            let outcome;
            // hasOwnProperty guard: a model-supplied name like "constructor"
            // must hit the unknown-tool branch, never Object.prototype.
            const executor = Object.prototype.hasOwnProperty.call(executors, call.name)
                ? executors[call.name]
                : undefined;
            if (key === lastExecutedKey) {
                outcome = { content: REPEAT_GUARD_CONTENT, isError: true };
            } else if (typeof executor !== 'function') {
                outcome = {
                    content: `Unknown tool "${call.name}". Valid tools: ${Object.keys(executors).join(', ')}.`,
                    isError: true,
                };
            } else {
                // An invoked executor counts as "executed" for the guard even
                // when it throws: retrying identical args against the same
                // sandbox rejection would fail identically.
                lastExecutedKey = key;
                try {
                    outcome = (await executor(call.args)) ?? {};
                } catch (err) {
                    outcome = { content: String(err?.message ?? err), isError: true };
                }
            }

            const content =
                typeof outcome.content === 'string' ? outcome.content : String(outcome.content ?? '');
            const isError = outcome.isError === true;

            const meta = outcome.meta;
            if (meta && typeof meta === 'object' && typeof meta.file === 'string' && meta.file) {
                if (meta.op === 'read' || meta.op === 'list') send(reading(meta.file));
                else if (meta.op === 'write') send(writing(meta.file));
                else if (meta.op === 'delete') send(deleting(meta.file));
            }

            /** @type {ToolResult} */
            const result = { callId: call.id, name: call.name, content };
            if (isError) result.isError = true;
            results.push(result);
            steps.push({ name: call.name, args: call.args, isError });
        }

        // One combined tool message per provider response, results in call
        // order — the translators (Story 9.2) fan it out per vendor.
        messages.push({ role: 'tool', results });
        send(turnProgress(turnNumber, effectiveMax, usage.inputTokens + usage.outputTokens));

        if (turnNumber >= effectiveMax) {
            // Cap reached with the model still wanting tools. Headless (no
            // resolver) → cap-stop immediately rather than ask nobody; with a
            // resolver, the user decides (mirrors onVisionDecision).
            if (typeof onContinueDecision !== 'function') return finish('cap-stopped');
            const spentTokens = usage.inputTokens + usage.outputTokens;
            send(needsContinue(turnNumber, spentTokens));
            const goOn = await onContinueDecision({ turnsUsed: turnNumber, spentTokens });
            if (goOn !== true) return finish('cap-stopped');
            effectiveMax += capStep; // continue on the SAME history
        }
    }
}
