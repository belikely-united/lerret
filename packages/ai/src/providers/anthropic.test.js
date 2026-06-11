// Tests for the Anthropic provider — including the critical system-prompt
// placement check (top-level `system` field, NOT a message in messages[]).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import {
    InvalidKey,
    RateLimited,
    BadModel,
    ContentBlocked,
    Unreachable,
    Unknown,
} from './errors.js';
import { jsonResponse, sseResponse, errorResponse } from './__test-helpers__/mock-fetch.js';

describe('AnthropicProvider', () => {
    let fetchSpy;

    beforeEach(() => {
        fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;
    });

    it('complete() POSTs to /v1/messages with x-api-key + anthropic-version', async () => {
        fetchSpy.mockResolvedValueOnce(
            jsonResponse({
                content: [{ type: 'text', text: 'hello from claude' }],
            }),
        );
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });
        const result = await p.complete({
            messages: [{ role: 'user', content: 'hi' }],
            signal: new AbortController().signal,
        });
        expect(result.content).toBe('hello from claude');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(init.method).toBe('POST');
        expect(init.headers['x-api-key']).toBe('sk-ant-test');
        expect(init.headers['anthropic-version']).toBe('2023-06-01');
        // Browser-direct BYOK opt-in: without this header Anthropic's API
        // refuses CORS to browser origins and every in-studio call fails as a
        // network TypeError (Epic 8 close browser-smoke finding).
        expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    });

    // ────────────────────────────────────────────────────────────────────
    // CRITICAL: system-prompt placement (AC-4 verification)
    // ────────────────────────────────────────────────────────────────────
    it('system message becomes top-level `system` field, NOT a message in messages[]', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
        await p.complete({
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'hi' },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        // Top-level system field carries the system content
        expect(body.system).toBe('You are a helpful assistant.');
        // messages[] does NOT contain any role: 'system' entry
        expect(body.messages).toBeDefined();
        for (const m of body.messages) {
            expect(m.role).not.toBe('system');
        }
        expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('concatenates multiple system messages with blank-line separator', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await p.complete({
            messages: [
                { role: 'system', content: 'First instruction.' },
                { role: 'system', content: 'Second instruction.' },
                { role: 'user', content: 'hi' },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.system).toBe('First instruction.\n\nSecond instruction.');
    });

    it('no system message → no top-level system field present', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await p.complete({
            messages: [{ role: 'user', content: 'hi' }],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.system).toBeUndefined();
    });

    it('complete() translates neutral image blocks into base64 source parts (NOT image_url)', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
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
        // The system extraction still applies to multipart turns…
        expect(body.system).toBe('sys');
        // …and the neutral image block lands as Anthropic's base64 source.
        expect(body.messages).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'match this' },
                    {
                        type: 'image',
                        source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
                    },
                ],
            },
        ]);
    });

    it('complete() extracts base64 + media type from a dataUrl-only image block', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
        await p.complete({
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 't' },
                        { type: 'image', dataUrl: 'data:image/jpeg;base64,QUJD' },
                    ],
                },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.messages[0].content[1]).toEqual({
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
        });
    });

    it('request body includes max_tokens (Anthropic requires it)', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await p.complete({ messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(typeof body.max_tokens).toBe('number');
        expect(body.max_tokens).toBeGreaterThan(0);
    });

    it('stream() parses Anthropic content_block_delta events', async () => {
        // Anthropic SSE: `event:` + `data:` pairs
        const sseBody =
            'event: message_start\ndata: {"type":"message_start","message":{}}\n\n' +
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n' +
            'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n' +
            'event: message_stop\ndata: {"type":"message_stop"}\n\n';
        fetchSpy.mockResolvedValueOnce(sseResponse(sseBody));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
        const chunks = [];
        for await (const c of p.stream({ messages: [], signal: new AbortController().signal })) {
            chunks.push(c);
        }
        expect(chunks).toEqual([
            { type: 'text-delta', text: 'Hel' },
            { type: 'text-delta', text: 'lo' },
        ]);
    });

    it('maps HTTP 401 → InvalidKey', async () => {
        fetchSpy.mockResolvedValueOnce(
            errorResponse(401, { error: { type: 'authentication_error', message: 'bad key' } }),
        );
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(InvalidKey);
    });

    it('maps HTTP 429 → RateLimited', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(429, { error: { type: 'rate_limit_error', message: 'slow' } }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(RateLimited);
    });

    it('maps overloaded_error → RateLimited', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(529, { error: { type: 'overloaded_error', message: 'overloaded' } }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(RateLimited);
    });

    it('maps HTTP 404 (model not found) → BadModel', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(404, { error: { message: 'model not found' } }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(BadModel);
    });

    it('maps content blocked → ContentBlocked', async () => {
        fetchSpy.mockResolvedValueOnce(
            errorResponse(400, { error: { type: 'content_policy', message: 'blocked' } }),
        );
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toBeInstanceOf(ContentBlocked);
    });

    it('maps HTTP 5xx → Unreachable (reason: server)', async () => {
        fetchSpy.mockResolvedValueOnce(errorResponse(500, { error: { message: 'internal' } }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('server');
    });

    it('maps fetch rejection → Unreachable (reason: network)', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        const err = await p.complete({ messages: [], signal: new AbortController().signal }).catch((e) => e);
        expect(err).toBeInstanceOf(Unreachable);
        expect(err.reason).toBe('network');
    });

    it('passes AbortSignal through to fetch', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
        const p = new AnthropicProvider();
        p.configure({ apiKey: 'sk' });
        const ctrl = new AbortController();
        await p.complete({ messages: [], signal: ctrl.signal });
        expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
    });
});
