// OpenRouter provider — speaks OpenRouter's OpenAI-compatible API.
//
// Endpoint: POST https://openrouter.ai/api/v1/chat/completions
// Auth: Authorization: Bearer <apiKey>
// Required headers (OpenRouter best practice for app attribution):
//   HTTP-Referer: https://lerret.belikely.com
//   X-Title: Lerret
//
// OpenRouter happens to be OpenAI-compatible at the wire level; we still
// keep it as its own provider module (per ADR-005 §Decision 4) rather than
// subclassing OpenAIProvider — that coupling would lock the architecture
// to OpenAI's wire choices forever. The duplication is intentional.
//
// Models endpoint: GET /api/v1/models — listModels() exposes this for the
// settings panel's model picker. The capabilities matrix carries the top
// 10 curated models with their vision flags; the model picker shows the
// live list but only the curated subset has known vision support.
//
// Error mapping mirrors OpenAI's (same wire format).
//
// Tool calling (Epic 9 / Story 9.2): `completeWithTools` mirrors openai.js
// (same OpenAI-compatible wire — function-shaped tools, JSON-STRING
// `arguments` parsed once at the boundary, N `{role:'tool'}` result
// messages). OpenRouter is STATELESS: tools are re-sent on every request.
// Non-streaming POST per loop iteration (ADR-006 §Decision 5).

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

const DEFAULT_BASE_URL = 'https://openrouter.ai';
const DEFAULT_MODEL = 'openai/gpt-4o';
const APP_REFERER = 'https://lerret.belikely.com';
const APP_TITLE = 'Lerret';

/**
 * Translate provider-NEUTRAL multipart content (interface.js TextBlock /
 * ImageBlock) into OpenRouter's (OpenAI-compatible) wire shape: neutral image
 * blocks become `{ type: 'image_url', image_url: { url } }` parts. Duplicated
 * from openai.js deliberately (this module never subclasses OpenAIProvider —
 * see the header).
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
 * Translate neutral ToolDefs (interface.js) into the OpenAI-compatible
 * function wire shape. Duplicated from openai.js deliberately (see the
 * header). OpenRouter is stateless per request — `completeWithTools`
 * re-sends these on EVERY request.
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
 * into OpenAI-compatible wire messages — assistant toolCalls become
 * `tool_calls` with JSON-stringified `arguments` (empty text → content
 * null); role:'tool' results become N `{role:'tool', tool_call_id}`
 * messages (isError → 'ERROR: ' content prefix); everything else flows
 * through `toWireMessages`. Duplicated from openai.js deliberately.
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
 * Parse a vendor `function.arguments` value into a plain object — parsed
 * exactly once at this boundary. OpenRouter routes to many vendors, so the
 * defensive object pass-through matters more here than on openai.js (some
 * routed vendors already emit objects). Empty / unparseable / non-object
 * arguments degrade to `{}`.
 *
 * @param {unknown} args
 * @returns {object}
 */
function parseToolArgs(args) {
    if (args && typeof args === 'object' && !Array.isArray(args)) return args;
    if (typeof args !== 'string' || args.trim().length === 0) return {};
    try {
        const parsed = JSON.parse(args);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

export class OpenRouterProvider extends AIProvider {
    constructor() {
        super();
        /** @private */ this._apiKey = null;
        /** @private */ this._baseUrl = DEFAULT_BASE_URL;
        /** @private */ this._model = DEFAULT_MODEL;
    }

    get name() {
        return 'openrouter';
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
            // SECURITY: pin egress to the OpenRouter vendor host (see openai.js).
            this._baseUrl = assertVendorOrigin(baseUrl, DEFAULT_BASE_URL);
        }
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('openrouter', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/v1/chat/completions',
            { model: model || this._model, messages: toWireMessages(messages), stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { content };
    }

    /**
     * One tool-loop iteration — non-streaming POST (tool-call arguments are
     * never streamed in v1; ADR-006 §Decision 5). Tools are re-sent on
     * EVERY request — OpenRouter is stateless and forgets them otherwise.
     * Errors flow through the same `_post` → `_mapError` plumbing as
     * `complete()`.
     *
     * @param {{ messages: Array<object>, tools: Array<object>, signal: AbortSignal, model?: string }} args
     * @returns {Promise<import('./interface.js').CompleteWithToolsResult>}
     */
    async completeWithTools({ messages, tools, signal, model } = {}) {
        const res = await this._post(
            '/api/v1/chat/completions',
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
            '/api/v1/chat/completions',
            { model: model || this._model, messages: toWireMessages(messages), stream: true },
            signal,
        );
        if (!res.body) {
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

    /**
     * List models from OpenRouter — consumed by the settings panel's model
     * picker. Returns a normalized array of `{id, name, contextWindow}`.
     *
     * @param {AbortSignal} [signal]
     * @returns {Promise<Array<{id: string, name: string, contextWindow?: number}>>}
     */
    async listModels(signal) {
        let res;
        try {
            res = await fetch(`${this._baseUrl}/api/v1/models`, {
                method: 'GET',
                headers: this._headers(),
                signal,
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw new Unreachable({
                message: 'OpenRouter models request failed',
                vendor: 'openrouter',
                reason: 'network',
                originalMessage: err instanceof Error ? err.message : String(err),
            });
        }
        if (!res.ok) throw await this._mapError(res);
        const json = await res.json();
        const data = Array.isArray(json?.data) ? json.data : [];
        return data.map((m) => ({
            id: String(m?.id || ''),
            name: String(m?.name || m?.id || ''),
            contextWindow: typeof m?.context_length === 'number' ? m.context_length : undefined,
        }));
    }

    async probe() {
        if (!this._apiKey) {
            return { ok: false, reason: 'invalid-key', detail: 'no api key configured' };
        }
        try {
            const res = await fetch(`${this._baseUrl}/api/v1/models`, {
                method: 'GET',
                headers: this._headers(),
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
    _headers() {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this._apiKey}`,
            'HTTP-Referer': APP_REFERER,
            'X-Title': APP_TITLE,
        };
    }

    /**
     * @private
     */
    async _post(path, body, signal) {
        let res;
        try {
            res = await fetch(`${this._baseUrl}${path}`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify(body),
                signal,
            });
        } catch (err) {
            if (err && err.name === 'AbortError') throw err;
            throw new Unreachable({
                message: 'OpenRouter request failed (network)',
                vendor: 'openrouter',
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
            // ignore
        }
        const errObj = bodyJson?.error || {};
        const vendorMsg = errObj.message || bodyText || `HTTP ${res.status}`;
        const code = errObj.code || errObj.type || '';
        const base = {
            vendor: 'openrouter',
            statusCode: res.status,
            originalMessage: vendorMsg,
        };
        if (res.status === 401 || res.status === 403) {
            return new InvalidKey({ message: 'OpenRouter rejected the API key', ...base });
        }
        if (res.status === 429) {
            return new RateLimited({ message: 'OpenRouter rate limit exceeded', ...base });
        }
        if (res.status === 404 || /model/i.test(code) || /model/i.test(vendorMsg)) {
            return new BadModel({ message: 'OpenRouter rejected the model', ...base });
        }
        if (/content[_-]?policy|safety/i.test(code) || /content[_-]?policy|safety/i.test(vendorMsg)) {
            return new ContentBlocked({ message: 'OpenRouter content policy blocked the request', ...base });
        }
        if (res.status >= 500) {
            return new Unreachable({
                message: 'OpenRouter server error',
                ...base,
                reason: 'server',
            });
        }
        return new Unknown({ message: 'OpenRouter returned an unexpected error', ...base });
    }
}
