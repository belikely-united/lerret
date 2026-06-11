// Tests for the Ollama provider — local-keyless variant, NDJSON streaming,
// CORS-aware error mapping.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OllamaProvider } from './ollama.js';
import { BadModel, Unreachable, Unknown } from './errors.js';
import { jsonResponse, ndjsonResponse, errorResponse } from './__test-helpers__/mock-fetch.js';

describe('OllamaProvider', () => {
    let fetchSpy;

    beforeEach(() => {
        fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;
    });

    it('reports variant: local-keyless + default baseUrl http://localhost:11434', () => {
        const p = new OllamaProvider();
        expect(p.variant).toBe('local-keyless');
        expect(p.baseUrl).toBe('http://localhost:11434');
    });

    it('configure() accepts baseUrl + model + silently ignores apiKey', () => {
        const p = new OllamaProvider();
        p.configure({ baseUrl: 'http://192.168.1.5:11434', model: 'llama3.2', apiKey: 'ignored' });
        expect(p.baseUrl).toBe('http://192.168.1.5:11434');
    });

    it('complete() POSTs to {baseUrl}/api/chat with NO auth header', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ message: { role: 'assistant', content: 'hello from llama' }, done: true }),
        );
        const p = new OllamaProvider();
        p.configure({ model: 'llama3.2' });
        const result = await p.complete({
            messages: [{ role: 'user', content: 'hi' }],
            signal: new AbortController().signal,
        });
        expect(result.content).toBe('hello from llama');
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('http://localhost:11434/api/chat');
        // No auth headers
        expect(init.headers.Authorization).toBeUndefined();
        expect(init.headers['x-api-key']).toBeUndefined();
    });

    it('complete() flattens a multipart message into string content + message-level images', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ message: { role: 'assistant', content: 'seen' }, done: true }),
        );
        const p = new OllamaProvider();
        p.configure({ model: 'llava' });
        await p.complete({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'describe this' },
                        { type: 'image', mimeType: 'image/png', base64: 'QUJD' },
                        { type: 'image', dataUrl: 'data:image/jpeg;base64,REVG' }, // base64 extracted from dataUrl
                    ],
                },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        // Ollama has no content-block array form: text joins into the string
        // content; image payloads ride the message-level images array.
        expect(body.messages[0]).toEqual({
            role: 'user',
            content: 'describe this',
            images: ['QUJD', 'REVG'],
        });
    });

    it('complete() leaves plain string messages untouched (no images key)', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({ message: { role: 'assistant', content: 'ok' }, done: true }),
        );
        const p = new OllamaProvider();
        p.configure({ model: 'llama3.2' });
        await p.complete({
            messages: [{ role: 'user', content: 'plain' }],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.messages[0]).toEqual({ role: 'user', content: 'plain' });
        expect(body.messages[0]).not.toHaveProperty('images');
    });

    it('stream() yields text-delta chunks from NDJSON body', async () => {
        const body =
            '{"model":"llama3.2","message":{"role":"assistant","content":"Hel"},"done":false}\n' +
            '{"model":"llama3.2","message":{"role":"assistant","content":"lo"},"done":false}\n' +
            '{"model":"llama3.2","done":true,"total_duration":12345}\n';
        fetchSpy.mockResolvedValueOnce(ndjsonResponse(body));
        const p = new OllamaProvider();
        p.configure({ model: 'llama3.2' });
        const chunks = [];
        for await (const c of p.stream({ messages: [], signal: new AbortController().signal })) {
            chunks.push(c);
        }
        expect(chunks).toEqual([
            { type: 'text-delta', text: 'Hel' },
            { type: 'text-delta', text: 'lo' },
        ]);
    });

    it('stream() request body has stream: true', async () => {
        fetchSpy.mockResolvedValueOnce(
            ndjsonResponse('{"model":"l","done":true}\n'),
        );
        const p = new OllamaProvider();
        p.configure({ model: 'l' });
        // eslint-disable-next-line no-unused-vars
        for await (const _ of p.stream({ messages: [], signal: new AbortController().signal })) {
            // drain
        }
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });

    it('maps HTTP 404 (model not found) → BadModel', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(404, { error: 'model "llama99" not found, try pulling it first' }));
        const p = new OllamaProvider();
        p.configure({ model: 'llama99' });
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(BadModel);
    });

    it('maps HTTP 5xx → Unreachable (server)', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(500, { error: 'internal' }));
        const p = new OllamaProvider();
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('server');
    });

    it('maps fetch rejection (TypeError) → Unreachable with cors reason', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const p = new OllamaProvider();
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('cors');
    });

    it('maps fetch rejection (non-TypeError) → Unreachable with network reason', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const p = new OllamaProvider();
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('network');
    });

    it('passes AbortSignal through to fetch', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ message: { content: 'x' }, done: true }));
        const p = new OllamaProvider();
        const ctrl = new AbortController();
        await p.complete({ messages: [], signal: ctrl.signal });
        expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
    });

    it('probe() calls GET /api/tags and returns ok:true on 200', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ models: [] }));
        const p = new OllamaProvider();
        const result = await p.probe();
        expect(result).toEqual({ ok: true });
        expect(fetchSpy.mock.calls[0][0]).toBe('http://localhost:11434/api/tags');
        expect(fetchSpy.mock.calls[0][1].method).toBe('GET');
    });

    it('probe() returns cors reason on TypeError from fetch', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const p = new OllamaProvider();
        const result = await p.probe();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('cors');
    });

    it('probe() returns unreachable reason on non-TypeError rejection', async () => {
        fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const p = new OllamaProvider();
        const result = await p.probe();
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('unreachable');
    });

    it('modelSupportsVision via matrix for known models', () => {
        const p = new OllamaProvider();
        p.configure({ model: 'llava' });
        expect(p.modelSupportsVision('llava')).toBe(true);
        expect(p.modelSupportsVision('codellama')).toBe(false);
    });
});
