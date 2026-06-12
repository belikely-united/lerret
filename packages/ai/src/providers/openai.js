// OpenAI provider — speaks the native OpenAI Chat Completions API.
//
// Endpoint: POST https://api.openai.com/v1/chat/completions
// Auth: Authorization: Bearer <apiKey>
// Streaming: Server-Sent Events (`data: {...}\n` frames; `data: [DONE]\n`
// sentinel).
//
// Error mapping (architecture-epic-8.md §Provider Abstraction; Story 8.1 AC-3):
//   HTTP 401         → InvalidKey
//   HTTP 429         → RateLimited
//   HTTP 400 + body  → BadModel (if model-related error code)
//                    → ContentBlocked (if content-policy error code)
//   HTTP 404 + body  → BadModel (if "model not found")
//   HTTP 5xx         → Unreachable (reason: 'server')
//   network error    → Unreachable (reason: 'network')
//   abort            → throws AbortError unchanged (not a ProviderError)
//   anything else    → Unknown
//
// Tool calling (Epic 9 / Story 9.2): `completeWithTools` is a NON-streaming
// POST per loop iteration (tool-call arguments are never streamed in v1 —
// ADR-006 §Decision 5). Tools go out as `{type:'function', function:{...}}`
// and are re-sent on EVERY request (the wire is stateless); calls come back
// in `message.tool_calls` with JSON-STRING `arguments`, parsed exactly once
// at this boundary; results return as N `{role:'tool', tool_call_id}`
// messages.
//
// SECURITY: the API key flows through `configure({apiKey})` once per turn,
// lives only in this instance's private field, and is dropped at turn end.
// MUST NOT be logged. The no-key-leak CI grep (Story 8.1 Task 5) enforces.

import { AIProvider } from './interface.js';
import {
    InvalidKey,
    RateLimited,
    BadModel,
    ContentBlocked,
    Unreachable,
    Unknown,
    ProviderError,
} from './errors.js';
import { modelSupportsVision as matrixModelSupportsVision } from './capabilities.js';
import { parseSSE } from './streaming.js';
import { assertVendorOrigin } from './url-guard.js';

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o';

/**
 * Translate provider-NEUTRAL multipart content (interface.js TextBlock /
 * ImageBlock) into OpenAI's wire shape. String content and text blocks pass
 * through verbatim (already wire-compatible); neutral image blocks become
 * `{ type: 'image_url', image_url: { url } }` parts — the dataUrl when
 * present, else composed from mimeType + base64. Payload-less image blocks
 * are dropped (defensive — the Planner never emits them).
 *
 * @param {Array<import('./interface.js').Message>} messages
 * @returns {Array<object>}
 */
function toWireMessages(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map((msg) => {
        if (!msg || !Array.isArray(msg.content)) return msg;
        const parts = [];
        for (const block of msg.content) {
            if (!block || typeof block !== 'object') continue;
            if (block.type === 'image') {
                const url =
                    typeof block.dataUrl === 'string' && block.dataUrl.length > 0
                        ? block.dataUrl
                        : typeof block.base64 === 'string' && block.base64.length > 0
                          ? `data:${block.mimeType || 'image/png'};base64,${block.base64}`
                          : null;
                if (url) parts.push({ type: 'image_url', image_url: { url } });
                continue;
            }
            parts.push(block);
        }
        return { ...msg, content: parts };
    });
}

/**
 * Translate neutral ToolDefs (interface.js) into the OpenAI function wire
 * shape: `{type:'function', function:{name, description, parameters}}`.
 * The wire is stateless — `completeWithTools` re-sends these on EVERY
 * request.
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
 * into OpenAI wire messages:
 *
 *   - assistant + toolCalls → one assistant message with `tool_calls`
 *     (`arguments` JSON-stringified; empty text → content null)
 *   - role:'tool' results → N `{role:'tool', tool_call_id, content}`
 *     messages, one per result, order preserved; `isError` results carry
 *     an 'ERROR: ' content prefix (the wire has no error flag)
 *   - everything else flows through `toWireMessages` so multipart user
 *     vision blocks get the same translation as complete()
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
                    tool_call_id: r.callId,
                    content: r.isError ? `ERROR: ${r.content}` : r.content,
                });
            }
            continue;
        }
        if (msg.role === 'assistant' && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
            const text = typeof msg.content === 'string' ? msg.content : '';
            wire.push({
                role: 'assistant',
                content: text.length > 0 ? text : null,
                tool_calls: msg.toolCalls.map((c) => ({
                    id: c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
            });
            continue;
        }
        wire.push(msg);
    }
    return toWireMessages(wire);
}

/**
 * Parse a vendor `function.arguments` value into a plain object — the ONE
 * place the JSON-string boundary is crossed (architecture-epic-9.md §4:
 * parse once, never substring-match). Empty / unparseable / non-object
 * arguments degrade to `{}` so a malformed call still surfaces as a
 * well-shaped ToolCall the loop can answer with an isError result.
 *
 * @param {unknown} args
 * @returns {object}
 */
function parseToolArgs(args) {
    // Defensive: some OpenRouter-routed vendors already emit objects.
    if (args && typeof args === 'object' && !Array.isArray(args)) return args;
    if (typeof args !== 'string' || args.trim().length === 0) return {};
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export class OpenAIProvider extends AIProvider {
    constructor() {
        super();
        /** @private */ this._apiKey = null;
        /** @private */ this._baseUrl = DEFAULT_BASE_URL;
        /** @private */ this._model = DEFAULT_MODEL;
    }

    get name() {
        return 'openai';
    }

    get variant() {
        return 'cloud-byok';
    }

    get baseUrl() {
        return this._baseUrl;
    }

    configure({ apiKey, baseUrl, model } = {}) {
        if (apiKey !== undefined) this._apiKey = apiKey;
        if (baseUrl !== undefined) {
            // SECURITY: pin egress to the OpenAI vendor host. A non-vendor
            // baseUrl is rejected before any key-bearing request is built —
            // there is no legitimate custom-endpoint path for BYOK cloud
            // providers in v1 (the setup UI offers no base-URL field).
            this._baseUrl = assertVendorOrigin(baseUrl, DEFAULT_BASE_URL);
        }
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('openai', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/v1/chat/completions',
            { model: model || this._model, messages: toWireMessages(messages), stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { content };
    }

    /**
     * One tool-loop iteration — non-streaming POST (tool-call arguments are
     * never streamed in v1; ADR-006 §Decision 5). Tools are re-sent on every
     * request. Errors flow through the same `_post` → `_mapError` plumbing
     * as `complete()`.
     *
     * @param {{ messages: Array<object>, tools: Array<object>, signal: AbortSignal, model?: string }} args
     * @returns {Promise<import('./interface.js').CompleteWithToolsResult>}
     */
    async completeWithTools({ messages, tools, signal, model } = {}) {
        const res = await this._post(
            '/v1/chat/completions',
            {
                model: model || this._model,
                messages: toToolWireMessages(messages),
                tools: toWireTools(tools),
                stream: false,
            },
            signal,
        );
        const json = await res.json();
        const choice = json?.choices?.[0];
        const message = choice?.message;
        const text = typeof message?.content === 'string' ? message.content : '';
        const toolCalls = (Array.isArray(message?.tool_calls) ? message.tool_calls : []).map(
            (c) => ({
                id: c?.id,
                name: c?.function?.name,
                // `arguments` is a JSON STRING on this wire — parsed here,
                // exactly once.
                args: parseToolArgs(c?.function?.arguments),
            }),
        );
        const usage = {
            inputTokens: typeof json?.usage?.prompt_tokens === 'number' ? json.usage.prompt_tokens : 0,
            outputTokens: typeof json?.usage?.completion_tokens === 'number' ? json.usage.completion_tokens : 0,
        };
        const result = { text, toolCalls, usage };
        if (typeof choice?.finish_reason === 'string') result.stopReason = choice.finish_reason;
        return result;
    }

    async *stream({ messages, signal, model } = {}) {
        const res = await this._post(
            '/v1/chat/completions',
            { model: model || this._model, messages: toWireMessages(messages), stream: true },
            signal,
        );
        if (!res.body) {
            // Some test mocks return a Response without a streaming body —
            // fall back to a single text-delta from the JSON form.
            const json = await res.json();
            const content = json?.choices?.[0]?.message?.content ?? '';
            if (content) yield { type: 'text-delta', text: content };
            return;
        }
        for await (const frame of parseSSE(res.body)) {
            if (!frame.data) continue;
            let parsed;
            try {
                parsed = JSON.parse(frame.data);
            } catch {
                continue;
            }
            const text = parsed?.choices?.[0]?.delta?.content;
            if (typeof text === 'string' && text.length > 0) {
                yield { type: 'text-delta', text };
            }
        }
    }

    async probe() {
        if (!this._apiKey) {
            return { ok: false, reason: 'invalid-key', detail: 'no api key configured' };
        }
        try {
            const res = await fetch(`${this._baseUrl}/v1/models`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${this._apiKey}` },
            });
            if (res.ok) return { ok: true };
            if (res.status === 401 || res.status === 403) {
                return { ok: false, reason: 'invalid-key' };
            }
            return { ok: false, reason: 'other', detail: `HTTP ${res.status}` };
        } catch (err) {
            return {
                ok: false,
                reason: 'unreachable',
                detail: err instanceof Error ? err.message : String(err),
            };
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
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this._apiKey}`,
                },
                body: JSON.stringify(body),
                signal,
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw new Unreachable({
                message: 'OpenAI request failed (network)',
                vendor: 'openai',
                reason: 'network',
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
            // bodyText already captured; bodyJson stays null
        }
        const errObj = bodyJson?.error || {};
        const vendorMsg = errObj.message || bodyText || `HTTP ${res.status}`;
        const code = errObj.code || errObj.type || '';
        const base = {
            vendor: 'openai',
            statusCode: res.status,
            originalMessage: vendorMsg,
        };
        if (res.status === 401 || res.status === 403) {
            return new InvalidKey({ message: 'OpenAI rejected the API key', ...base });
        }
        if (res.status === 429) {
            return new RateLimited({ message: 'OpenAI rate limit exceeded', ...base });
        }
        if (res.status === 404 || /model/i.test(code) || /model/i.test(vendorMsg)) {
            return new BadModel({ message: 'OpenAI rejected the model', ...base });
        }
        if (/content[_-]?policy|safety/i.test(code) || /content[_-]?policy|safety/i.test(vendorMsg)) {
            return new ContentBlocked({ message: 'OpenAI content policy blocked the request', ...base });
        }
        if (res.status >= 500) {
            return new Unreachable({
                message: 'OpenAI server error',
                ...base,
                reason: 'server',
            });
        }
        return new Unknown({ message: 'OpenAI returned an unexpected error', ...base });
    }
}
