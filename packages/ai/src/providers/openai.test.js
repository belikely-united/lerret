// Tests for the OpenAI provider — happy path complete + stream + error
// mapping for each normalized ProviderError subclass.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './openai.js';
import {
    InvalidKey,
    RateLimited,
    BadModel,
    ContentBlocked,
    Unreachable,
    Unknown,
} from './errors.js';
import { jsonResponse, sseResponse, errorResponse } from './__test-helpers__/mock-fetch.js';

describe('OpenAIProvider', () => {
    let fetchSpy;

    beforeEach(() => {
        fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;
    });

    it('complete() POSTs to /v1/chat/completions with Bearer auth + parses content', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                choices: [{ message: { content: 'hello world' } }],
            }),
        );
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk-test', model: 'gpt-4o' });
        const result = await p.complete({
            messages: [{ role: 'user', content: 'hi' }],
            signal: new AbortController().signal,
        });
        expect(result.content).toBe('hello world');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer sk-test');
        const body = JSON.parse(init.body);
        expect(body.model).toBe('gpt-4o');
        expect(body.stream).toBe(false);
        expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('stream() yields text-delta chunks from SSE body', async () => {
        const sseBody =
            'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
            'data: [DONE]\n\n';
        fetchSpy.mockResolvedValueOnce(sseResponse(sseBody));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk', model: 'gpt-4o' });
        const chunks = [];
        for await (const c of p.stream({ messages: [], signal: new AbortController().signal })) {
            chunks.push(c);
        }
        expect(chunks).toEqual([
            { type: 'text-delta', text: 'Hel' },
            { type: 'text-delta', text: 'lo' },
        ]);
    });

    it('complete() translates neutral image blocks into image_url parts (multipart vision message)', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk', model: 'gpt-4o' });
        await p.complete({
            messages: [
                { role: 'system', content: 'sys' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'match this' },
                        {
                            type: 'image',
                            mimeType: 'image/png',
                            base64: 'QUJD',
                            dataUrl: 'data:image/png;base64,QUJD',
                        },
                    ],
                },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        // String content passes through verbatim; the multipart user turn is
        // translated to OpenAI's wire shape (text part + image_url part).
        expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
        expect(body.messages[1]).toEqual({
            role: 'user',
            content: [
                { type: 'text', text: 'match this' },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
            ],
        });
    });

    it('complete() composes the data URL from mimeType + base64 when no dataUrl is present', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk', model: 'gpt-4o' });
        await p.complete({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 't' },
                        { type: 'image', mimeType: 'image/jpeg', base64: 'QUJD' },
                    ],
                },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.messages[0].content[1]).toEqual({
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,QUJD' },
        });
    });

    it('stream() request body has stream: true', async () => {
        fetchSpy.mockResolvedValueOnce(sseResponse('data: [DONE]\n\n'));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk', model: 'gpt-4o' });
        // eslint-disable-next-line no-unused-vars
        for await (const _ of p.stream({ messages: [], signal: new AbortController().signal })) {
            // drain
        }
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });

    it('maps HTTP 401 → InvalidKey', async () => {
        fetchSpy.mockResolvedValueOnce(
            errorResponse(401, { error: { message: 'Incorrect API key', type: 'invalid_request_error' } }),
        );
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'wrong' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(InvalidKey);
    });

    it('maps HTTP 429 → RateLimited', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(429, { error: { message: 'rate limited' } }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(RateLimited);
    });

    it('maps HTTP 404 (model not found) → BadModel', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(404, { error: { message: 'The model gpt-99 does not exist' } }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk', model: 'gpt-99' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(BadModel);
    });

    it('maps content_policy errors → ContentBlocked', async () => {
        fetchSpy.mockResolvedValueOnce(
            errorResponse(400, { error: { code: 'content_policy_violation', message: 'blocked' } }),
        );
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(ContentBlocked);
    });

    it('maps HTTP 5xx → Unreachable (reason: server)', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(503, { error: { message: 'down' } }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const err = await p
            .complete({ messages: [], signal: new AbortController().signal })
            .then(() => null, (e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('server');
    });

    it('maps fetch rejection → Unreachable (reason: network)', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const err = await p
            .complete({ messages: [], signal: new AbortController().signal })
            .then(() => null, (e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('network');
    });

    it('maps generic 400 → Unknown', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(400, { error: { message: 'bad' } }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(Unknown);
    });

    it('passes AbortSignal through to fetch', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const ctrl = new AbortController();
        await p.complete({ messages: [], signal: ctrl.signal });
        expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
    });

    it('probe() returns ok:true on 200 from /v1/models', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const result = await p.probe();
        expect(result).toEqual({ ok: true });
    });

    it('probe() returns invalid-key on 401', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(401, { error: { message: 'bad' } }));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const result = await p.probe();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('invalid-key');
    });

    it('probe() returns unreachable on fetch rejection', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('network'));
        const p = new OpenAIProvider();
        p.configure({ apiKey: 'sk' });
        const result = await p.probe();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unreachable');
    });

    it('probe() with no apiKey configured reports invalid-key', async () => {
        const p = new OpenAIProvider();
        const result = await p.probe();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('invalid-key');
    });
});
