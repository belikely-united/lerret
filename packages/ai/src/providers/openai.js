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

const DEFAULT_BASE_URL = 'https://api.openai.com';
const DEFAULT_MODEL = 'gpt-4o';

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
        if (baseUrl !== undefined) this._baseUrl = baseUrl;
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('openai', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/v1/chat/completions',
            { model: model || this._model, messages, stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { content };
    }

    async *stream({ messages, signal, model } = {}) {
        const res = await this._post(
            '/v1/chat/completions',
            { model: model || this._model, messages, stream: true },
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
