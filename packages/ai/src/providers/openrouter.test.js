// Tests for the OpenRouter provider — OpenAI-compatible wire format with
// the OpenRouter-specific HTTP-Referer + X-Title headers.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenRouterProvider } from './openrouter.js';
import {
    InvalidKey,
    RateLimited,
    BadModel,
    Unreachable,
    Unknown,
} from './errors.js';
import { jsonResponse, sseResponse, errorResponse } from './__test-helpers__/mock-fetch.js';

describe('OpenRouterProvider', () => {
    let fetchSpy;

    beforeEach(() => {
        fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;
    });

    it('complete() POSTs to /api/v1/chat/completions with required app-attribution headers', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ choices: [{ message: { content: 'router says hi' } }] }),
        );
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or-test', model: 'openai/gpt-4o' });
        const result = await p.complete({
            messages: [{ role: 'user', content: 'hi' }],
            signal: new AbortController().signal,
        });
        expect(result.content).toBe('router says hi');
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(init.headers.Authorization).toBe('Bearer or-test');
        expect(init.headers['HTTP-Referer']).toBe('https://lerret.belikely.com');
        expect(init.headers['X-Title']).toBe('Lerret');
    });

    it('stream() yields text-delta chunks from OpenAI-compatible SSE body', async () => {
        const sseBody =
            'data: {"choices":[{"delta":{"content":"Foo"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"Bar"}}]}\n\n' +
            'data: [DONE]\n\n';
        fetchSpy.mockResolvedValueOnce(sseResponse(sseBody));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
        const chunks = [];
        for await (const c of p.stream({ messages: [], signal: new AbortController().signal })) {
            chunks.push(c);
        }
        expect(chunks).toEqual([
            { type: 'text-delta', text: 'Foo' },
            { type: 'text-delta', text: 'Bar' },
        ]);
    });

    it('maps 401 → InvalidKey', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(401, { error: { message: 'unauthorized' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(InvalidKey);
    });

    it('maps 429 → RateLimited', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(429, { error: { message: 'too many' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(RateLimited);
    });

    it('maps 404 → BadModel', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(404, { error: { message: 'model not found' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or', model: 'foo/bar' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(BadModel);
    });

    it('maps 500 → Unreachable (server)', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(500, { error: { message: 'down' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('server');
    });

    it('maps generic 400 → Unknown', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(400, { error: { message: 'bad' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(Unknown);
    });

    it('passes AbortSignal through to fetch', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'x' } }] }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        const ctrl = new AbortController();
        await p.complete({ messages: [], signal: ctrl.signal });
        expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
    });

    it('listModels() returns normalized model records from /api/v1/models', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                data: [
                    { id: 'openai/gpt-4o', name: 'GPT-4o', context_length: 128000 },
                    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', context_length: 200000 },
                ],
            }),
        );
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        const models = await p.listModels();
        expect(models).toEqual([
            { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
        ]);
    });

    it('probe() returns ok:true on 200 from /api/v1/models', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        const result = await p.probe();
        expect(result).toEqual({ ok: true });
    });

    it('probe() returns invalid-key on 401', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(401, { error: { message: 'unauth' } }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or' });
        const result = await p.probe();
        expect(result).toMatchObject({ ok: false, reason: 'invalid-key' });
    });
});
