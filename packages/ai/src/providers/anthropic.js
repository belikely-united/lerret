// Anthropic provider — speaks the native Anthropic Messages API.
//
// Endpoint: POST https://api.anthropic.com/v1/messages
// Auth: x-api-key: <apiKey>
// Required header: anthropic-version: 2023-06-01
// Streaming: Server-Sent Events with Anthropic-specific event types
//            (`message_start`, `content_block_delta`, `message_delta`,
//            `message_stop`).
//
// CRITICAL: Anthropic is NOT an OpenAI-compatible shortcut. Two differences
// the provider MUST handle correctly:
//
//   1. System prompt placement. Anthropic's request shape is
//      `{ model, max_tokens, system?, messages: [...] }` — the `system`
//      field is a TOP-LEVEL string, NOT a `{role: 'system'}` entry in
//      `messages`. If the orchestrator passes a `role: 'system'` message,
//      this provider extracts it and moves it to the top-level `system`
//      field. The `messages` array then contains only user / assistant
//      entries.
//
//   2. Streaming event shape. Each SSE frame's `data` is a JSON object
//      with a `type` field — we only care about `content_block_delta`
//      events whose `delta.type` is `text_delta`. Other event types
//      (`message_start`, `message_delta`, `message_stop`, `ping`) are
//      yielded by the SSE parser but ignored here.
//
// Error mapping:
//   HTTP 401              → InvalidKey
//   HTTP 429              → RateLimited
//   HTTP 400 + body type  → BadModel / ContentBlocked (per body.error.type)
//   HTTP 404              → BadModel
//   HTTP 5xx              → Unreachable (reason: 'server')
//   network               → Unreachable (reason: 'network')
//
// Reference: https://docs.anthropic.com/en/api/messages ; ADR-005 §Decision
// 4 (NOT an OpenAI-compatible shortcut).

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

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Translate provider-NEUTRAL multipart content (interface.js TextBlock /
 * ImageBlock) into Anthropic's wire shape. Text blocks pass through verbatim
 * (already wire-compatible); neutral image blocks become
 * `{ type: 'image', source: { type: 'base64', media_type, data } }` — the
 * bare base64 when present, else extracted from the dataUrl. Payload-less
 * image blocks are dropped (defensive — the Planner never emits them).
 *
 * @param {string|Array<object>} content
 * @returns {string|Array<object>}
 */
function toWireContent(content) {
    if (!Array.isArray(content)) return content;
    const parts = [];
    for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'image') {
            let data =
                typeof block.base64 === 'string' && block.base64.length > 0
                    ? block.base64
                    : null;
            let mediaType =
                typeof block.mimeType === 'string' && block.mimeType.length > 0
                    ? block.mimeType
                    : null;
            if (!data && typeof block.dataUrl === 'string') {
                const m = /^data:([^;,]+);base64,(.+)$/.exec(block.dataUrl);
                if (m) {
                    mediaType = mediaType || m[1];
                    data = m[2];
                }
            }
            if (data) {
                parts.push({
                    type: 'image',
                    source: { type: 'base64', media_type: mediaType || 'image/png', data },
                });
            }
            continue;
        }
        parts.push(block);
    }
    return parts;
}

export class AnthropicProvider extends AIProvider {
    constructor() {
        super();
        /** @private */ this._apiKey = null;
        /** @private */ this._baseUrl = DEFAULT_BASE_URL;
        /** @private */ this._model = DEFAULT_MODEL;
    }

    get name() {
        return 'anthropic';
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
            // SECURITY: pin egress to the Anthropic vendor host (see openai.js).
            this._baseUrl = assertVendorOrigin(baseUrl, DEFAULT_BASE_URL);
        }
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('anthropic', model || this._model);
    }

    async complete({ messages, signal, model, maxTokens } = {}) {
        const body = this._buildBody(messages, model, maxTokens, false);
        const res = await this._post('/v1/messages', body, signal);
        const json = await res.json();
        // Anthropic returns `content: [{type:'text', text: '...'}, ...]`.
        const blocks = Array.isArray(json?.content) ? json.content : [];
        const content = blocks
            .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('');
        return { content };
    }

    async *stream({ messages, signal, model, maxTokens } = {}) {
        const body = this._buildBody(messages, model, maxTokens, true);
        const res = await this._post('/v1/messages', body, signal);
        if (!res.body) {
            const json = await res.json();
            const blocks = Array.isArray(json?.content) ? json.content : [];
            for (const b of blocks) {
                if (b?.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
                    yield { type: 'text-delta', text: b.text };
                }
            }
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
            // Anthropic's text deltas arrive on `content_block_delta` with
            // `delta.type === 'text_delta'`.
            if (parsed?.type === 'content_block_delta' && parsed?.delta?.type === 'text_delta') {
                const text = parsed.delta.text;
                if (typeof text === 'string' && text.length > 0) {
                    yield { type: 'text-delta', text };
                }
            }
        }
    }

    async probe() {
        if (!this._apiKey) {
            return { ok: false, reason: 'invalid-key', detail: 'no api key configured' };
        }
        // Anthropic does not expose a cheap /models endpoint that accepts
        // GET without an API call. The cheapest valid call is a 1-token
        // messages request — but that costs the user a request. We instead
        // do a minimal POST with max_tokens: 1 against the configured
        // model; auth failures surface as 401.
        try {
            const res = await fetch(`${this._baseUrl}/v1/messages`, {
                method: 'POST',
                headers: this._headers(),
                body: JSON.stringify({
                    model: this._model,
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'ping' }],
                }),
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
     * Build the Anthropic request body. Extracts the `system` message (if
     * any) from `messages[]` and moves it to the top-level `system` field.
     *
     * @private
     */
    _buildBody(messages, model, maxTokens, stream) {
        let system;
        const filtered = [];
        for (const msg of messages || []) {
            if (!msg) continue;
            if (msg.role === 'system') {
                // First system message becomes top-level. Additional system
                // messages are concatenated (rare but defined behavior).
                const text = typeof msg.content === 'string'
                    ? msg.content
                    : (Array.isArray(msg.content)
                        ? msg.content
                            .filter((c) => c?.type === 'text')
                            .map((c) => c.text)
                            .join('')
                        : '');
                system = system ? `${system}\n\n${text}` : text;
            } else {
                // Multipart (neutral-block) content is translated to the
                // Anthropic wire shape here; string content passes verbatim.
                filtered.push(
                    Array.isArray(msg.content)
                        ? { ...msg, content: toWireContent(msg.content) }
                        : msg,
                );
            }
        }
        /** @type {Record<string, unknown>} */
        const body = {
            model: model || this._model,
            max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
            messages: filtered,
        };
        if (system !== undefined) body.system = system;
        if (stream) body.stream = true;
        return body;
    }

    /**
     * @private
     */
    _headers() {
        return {
            'Content-Type': 'application/json',
            'x-api-key': this._apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            // Anthropic's documented opt-in for browser-direct requests: the
            // API only serves CORS to browser origins when this header is
            // present. Lerret's BYOK model is exactly that case — the USER'S
            // key, entered by the user, calling out from the user's own
            // browser (ADR-005 §Decision 4; no Lerret proxy). Without it every
            // in-studio Anthropic call dies at the CORS preflight as a network
            // TypeError (found by the Epic 8 close browser smoke).
            'anthropic-dangerous-direct-browser-access': 'true',
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
                message: 'Anthropic request failed (network)',
                vendor: 'anthropic',
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
        const errType = errObj.type || '';
        const base = {
            vendor: 'anthropic',
            statusCode: res.status,
            originalMessage: vendorMsg,
        };
        if (res.status === 401 || res.status === 403 || errType === 'authentication_error') {
            return new InvalidKey({ message: 'Anthropic rejected the API key', ...base });
        }
        if (res.status === 429 || errType === 'rate_limit_error' || errType === 'overloaded_error') {
            return new RateLimited({ message: 'Anthropic rate limit exceeded', ...base });
        }
        if (res.status === 404 || /model/i.test(errType) || /model/i.test(vendorMsg)) {
            return new BadModel({ message: 'Anthropic rejected the model', ...base });
        }
        if (/content|policy|safety|blocked/i.test(errType) || /content|policy|safety|blocked/i.test(vendorMsg)) {
            return new ContentBlocked({ message: 'Anthropic blocked the request', ...base });
        }
        if (res.status >= 500) {
            return new Unreachable({
                message: 'Anthropic server error',
                ...base,
                reason: 'server',
            });
        }
        return new Unknown({ message: 'Anthropic returned an unexpected error', ...base });
    }
}
