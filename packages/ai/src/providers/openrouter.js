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

const DEFAULT_BASE_URL = 'https://openrouter.ai';
const DEFAULT_MODEL = 'openai/gpt-4o';
const APP_REFERER = 'https://lerret.belikely.com';
const APP_TITLE = 'Lerret';

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
        if (baseUrl !== undefined) this._baseUrl = baseUrl;
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('openrouter', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/v1/chat/completions',
            { model: model || this._model, messages, stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content ?? '';
        return { content };
    }

    async *stream({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/v1/chat/completions',
            { model: model || this._model, messages, stream: true },
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
