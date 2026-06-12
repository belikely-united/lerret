// Ollama provider — speaks the local Ollama HTTP API.
//
// Endpoint: POST {baseUrl}/api/chat   (default baseUrl: http://localhost:11434)
// Auth: none (variant 'local-keyless')
// Streaming: newline-delimited JSON. Each frame is a JSON object:
//   { "model": "...", "message": { "role": "assistant", "content": "..." }, "done": false }
//   ...
//   { "model": "...", "done": true, "total_duration": ... }
//
// Probe calls GET /api/tags — the lightweight model-list endpoint. On a
// hosted page (lerret.belikely.com) the browser blocks the call unless the
// user has set OLLAMA_ORIGINS to include the studio's origin. The probe
// surfaces `{ok: false, reason: 'cors'}` in that case; Story 8.10 owns the
// "summon the OLLAMA_ORIGINS guide" branch.
//
// Error mapping:
//   network error  → Unreachable (reason: 'network' or 'cors' if TypeError + CORS smell)
//   HTTP 404 + body "model not found" → BadModel
//   HTTP 5xx       → Unreachable (reason: 'server')
//   anything else  → Unknown
//
// Tool calling (Epic 9 / Story 9.2): `completeWithTools` speaks the NATIVE
// `/api/chat` endpoint ONLY — the `/v1` OpenAI-compat layer is banned for
// tool calls (it drops them when streaming; ollama/ollama#12557, ADR-006
// §Decision 1). Non-streaming POST per loop iteration; `arguments` is an
// object on this wire (no JSON parse); missing call ids are synthesized.
//
// Reference: https://github.com/ollama/ollama/blob/main/docs/api.md

import { AIProvider } from './interface.js';
import {
    BadModel,
    Unreachable,
    Unknown,
    ProviderError,
} from './errors.js';
import { modelSupportsVision as matrixModelSupportsVision } from './capabilities.js';
import { parseNDJSON } from './streaming.js';
import { assertLocalOrigin } from './url-guard.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

/**
 * Translate a provider-NEUTRAL multipart message (interface.js TextBlock /
 * ImageBlock) into Ollama's wire shape: string `content` (text blocks joined)
 * plus a message-level `images: [<base64>, …]` array — Ollama has no
 * content-block array form. String content passes through verbatim. Note
 * Ollama is outside the v1 vision-fallback eligibility (FR56 is cloud-only),
 * but a vision-capable LOCAL model (e.g. llava) configured as the ACTIVE
 * provider can still receive image turns, so the translation lives here too.
 *
 * @param {import('./interface.js').Message} msg
 * @returns {object}
 */
function toWireMessage(msg) {
    if (!msg || !Array.isArray(msg.content)) return msg;
    const texts = [];
    const images = [];
    for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
            texts.push(block.text);
            continue;
        }
        if (block.type === 'image') {
            let data =
                typeof block.base64 === 'string' && block.base64.length > 0
                    ? block.base64
                    : null;
            if (!data && typeof block.dataUrl === 'string') {
                const m = /^data:[^;,]*;base64,(.+)$/.exec(block.dataUrl);
                if (m) data = m[1];
            }
            if (data) images.push(data);
        }
    }
    const out = { ...msg, content: texts.join('\n') };
    if (images.length > 0) out.images = images;
    return out;
}

/** @param {Array<import('./interface.js').Message>} messages */
function toWireMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(toWireMessage);
}

/**
 * Translate neutral ToolDefs (interface.js) into the OpenAI function shape
 * Ollama's NATIVE `/api/chat` accepts:
 * `{type:'function', function:{name, description, parameters}}`.
 *
 * @param {Array<import('./interface.js').ToolDef>} tools
 * @returns {Array<object>}
 */
function toWireTools(tools) {
    return (Array.isArray(tools) ? tools : []).map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

/**
 * Translate the neutral tool-loop history (interface.js ToolLoopMessage)
 * into Ollama wire messages:
 *
 *   - assistant + toolCalls → `tool_calls: [{function:{name, arguments}}]`
 *     with OBJECT arguments and NO ids (Ollama's wire carries none)
 *   - role:'tool' results → N `{role:'tool', content, tool_name}` messages,
 *     one per result, order preserved; `isError` results carry an
 *     'ERROR: ' content prefix (the wire has no error flag)
 *   - everything else flows through `toWireMessage` so multipart user
 *     vision blocks get the same content + images flattening as complete()
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function toToolWireMessages(messages) {
    const wire = [];
    for (const msg of messages || []) {
        if (!msg) continue;
        if (msg.role === 'tool') {
            const results = Array.isArray(msg.results) ? msg.results : [];
            for (const r of results) {
                wire.push({
                    role: 'tool',
                    content: r.isError ? `ERROR: ${r.content}` : r.content,
                    tool_name: r.name,
                });
            }
            continue;
        }
        if (msg.role === 'assistant' && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
            wire.push({
                role: 'assistant',
                content: typeof msg.content === 'string' ? msg.content : '',
                tool_calls: msg.toolCalls.map((c) => ({
                    function: { name: c.name, arguments: c.args },
                })),
            });
            continue;
        }
        wire.push(toWireMessage(msg));
    }
    return wire;
}

export class OllamaProvider extends AIProvider {
    constructor() {
        super();
        /** @private */ this._baseUrl = DEFAULT_BASE_URL;
        /** @private */ this._model = DEFAULT_MODEL;
    }

    get name() {
        return 'ollama';
    }

    get variant() {
        return 'local-keyless';
    }

    get baseUrl() {
        return this._baseUrl;
    }

    configure({ baseUrl, model } = {}) {
        // apiKey is silently ignored — Ollama has no auth.
        if (baseUrl !== undefined) {
            // SECURITY: Ollama legitimately runs on a custom host, but only on
            // the local machine or LAN. assertLocalOrigin rejects public hosts
            // and the 169.254/16 link-local (cloud-metadata) range to block
            // SSRF, and normalizes to the origin (scheme://host:port) so the
            // `${baseUrl}/api/chat` concatenation is well-formed.
            this._baseUrl = assertLocalOrigin(baseUrl);
        }
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('ollama', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/chat',
            { model: model || this._model, messages: toWireMessages(messages), stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.message?.content ?? '';
        return { content };
    }

    /**
     * One tool-loop iteration — NATIVE `/api/chat` ONLY, `stream: false`.
     * The `/v1` OpenAI-compat layer is BANNED for tool calls: it drops
     * streamed tool calls (github.com/ollama/ollama/issues/12557; ADR-006
     * §Decision 1). Native quirks normalized here: `arguments` arrives as
     * an OBJECT (used as-is, no JSON parse), and calls may lack ids —
     * synthesized as `call_1`, `call_2`, … per response. Errors flow
     * through the same `_post` → `_mapError` plumbing as `complete()`.
     *
     * @param {{ messages: Array<object>, tools: Array<object>, signal: AbortSignal, model?: string }} args
     * @returns {Promise<import('./interface.js').CompleteWithToolsResult>}
     */
    async completeWithTools({ messages, tools, signal, model, maxTokens } = {}) {
        const res = await this._post(
            '/api/chat',
            {
                model: model || this._model,
                messages: toToolWireMessages(messages),
                tools: toWireTools(tools),
                stream: false,
                // num_predict is Ollama's output ceiling (review finding M3).
                ...(typeof maxTokens === 'number' ? { options: { num_predict: maxTokens } } : {}),
            },
            signal,
        );
        const json = await res.json();
        const message = json?.message;
        const text = typeof message?.content === 'string' ? message.content : '';
        const toolCalls = (Array.isArray(message?.tool_calls) ? message.tool_calls : []).map(
            (c, i) => ({
                id: typeof c?.id === 'string' && c.id.length > 0 ? c.id : `call_${i + 1}`,
                name: c?.function?.name,
                // Ollama's native wire delivers `arguments` as an object
                // already — used as-is; anything else degrades to {}.
                args:
                    c?.function?.arguments && typeof c.function.arguments === 'object'
                        ? c.function.arguments
                        : {},
            }),
        );
        const usage = {
            inputTokens: typeof json?.prompt_eval_count === 'number' ? json.prompt_eval_count : 0,
            outputTokens: typeof json?.eval_count === 'number' ? json.eval_count : 0,
        };
        const result = { text, toolCalls, usage };
        if (typeof json?.done_reason === 'string') result.stopReason = json.done_reason;
        return result;
    }

    async *stream({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/chat',
            { model: model || this._model, messages: toWireMessages(messages), stream: true },
            signal,
        );
        if (!res.body) {
            const json = await res.json();
            const content = json?.message?.content ?? '';
            if (content) yield { type: 'text-delta', text: content };
            return;
        }
        try {
            for await (const frame of parseNDJSON(res.body)) {
                if (!frame || typeof frame !== 'object') continue;
                if (frame.done === true) return;
                const text = frame?.message?.content;
                if (typeof text === 'string' && text.length > 0) {
                    yield { type: 'text-delta', text };
                }
            }
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw new Unknown({
                message: 'Ollama stream parse error',
                vendor: 'ollama',
                originalMessage: err instanceof Error ? err.message : String(err),
            });
        }
    }

    async probe() {
        try {
            const res = await fetch(`${this._baseUrl}/api/tags`, { method: 'GET' });
            if (res.ok) return { ok: true };
            return { ok: false, reason: 'other', detail: `HTTP ${res.status}` };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // Browser CORS denials surface as TypeError with body matching
            // /CORS|cross-origin|fetch.*failed/i depending on the engine.
            // We classify any browser-side TypeError on the local-host
            // endpoint as a likely CORS denial — Story 8.10 distinguishes
            // CORS from a truly-down server via a follow-up probe.
            const reason = isLikelyCorsError(err) ? 'cors' : 'unreachable';
            return { ok: false, reason, detail: msg };
        }
    }

    /**
     * @private
     */
    async _post(path, body, signal) {
        let res;
        try {
            res = await fetch(`${this._baseUrl}${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal,
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            const reason = isLikelyCorsError(err) ? 'cors' : 'network';
            throw new Unreachable({
                message:
                    reason === 'cors'
                        ? 'Ollama unreachable (likely CORS — set OLLAMA_ORIGINS)'
                        : 'Ollama unreachable (network)',
                vendor: 'ollama',
                reason,
                originalMessage: err instanceof Error ? err.message : String(err),
            });
        }
        if (!res.ok) {
            throw await this._mapError(res);
        }
        return res;
    }

    /**
     * @private
     * @param {Response} res
     * @returns {Promise<ProviderError>}
     */
    async _mapError(res) {
        let bodyText = '';
        let bodyJson = null;
        try {
            bodyText = await res.text();
            bodyJson = bodyText ? JSON.parse(bodyText) : null;
        } catch {
            // ignore
        }
        const vendorMsg = bodyJson?.error || bodyText || `HTTP ${res.status}`;
        const base = {
            vendor: 'ollama',
            statusCode: res.status,
            originalMessage: typeof vendorMsg === 'string' ? vendorMsg : JSON.stringify(vendorMsg),
        };
        if (res.status === 404 || /model.*not.*found|pull.*model/i.test(String(vendorMsg))) {
            return new BadModel({ message: 'Ollama could not find the model (run `ollama pull <model>`)', ...base });
        }
        if (res.status >= 500) {
            return new Unreachable({
                message: 'Ollama server error',
                ...base,
                reason: 'server',
            });
        }
        return new Unknown({ message: 'Ollama returned an unexpected error', ...base });
    }
}

/**
 * Heuristic — does this fetch-rejection look like a CORS denial?
 *
 * Browsers do not give us a structured "this was CORS" signal — we only
 * see a TypeError. The message tends to mention "fetch", "CORS", or
 * "cross-origin"; in Chromium it is `TypeError: Failed to fetch`. We
 * conservatively return true for any TypeError when the baseUrl is a
 * local-host endpoint — the Story 8.10 follow-up probe disambiguates.
 */
function isLikelyCorsError(err) {
    if (!err) return false;
    if (err.name !== 'TypeError') return false;
    const msg = String(err.message || '');
    return /cors|cross-origin|fetch/i.test(msg);
}
