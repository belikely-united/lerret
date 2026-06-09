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

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

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
        if (baseUrl !== undefined) this._baseUrl = baseUrl;
        if (model !== undefined) this._model = model;
    }

    modelSupportsVision(model) {
        return matrixModelSupportsVision('ollama', model || this._model);
    }

    async complete({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/chat',
            { model: model || this._model, messages, stream: false },
            signal,
        );
        const json = await res.json();
        const content = json?.message?.content ?? '';
        return { content };
    }

    async *stream({ messages, signal, model } = {}) {
        const res = await this._post(
            '/api/chat',
            { model: model || this._model, messages, stream: true },
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
