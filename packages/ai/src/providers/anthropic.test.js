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

    // ────────────────────────────────────────────────────────────────────
    // completeWithTools — Story 9.2 AC-2 (wire shape pinned both ways)
    // ────────────────────────────────────────────────────────────────────
    describe('completeWithTools', () => {
        const TOOLS = [
            {
                name: 'list_dir',
                description: 'List a directory',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
            {
                name: 'read_file',
                description: 'Read a file',
                parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
        ];

        function toolResponse(overrides = {}) {
            return jsonResponse({
                content: [{ type: 'text', text: 'ok' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 10, output_tokens: 5 },
                ...overrides,
            });
        }

        it('POSTs a NON-streaming /v1/messages body: plain input_schema tools, cache_control on the LAST SYSTEM block', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk-ant-test', model: 'claude-sonnet-4-6' });
            await p.completeWithTools({
                messages: [
                    { role: 'system', content: 'You build assets.' },
                    { role: 'user', content: 'go' },
                ],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const [url, init] = fetchSpy.mock.calls[0];
            expect(url).toBe('https://api.anthropic.com/v1/messages');
            expect(init.method).toBe('POST');
            // Same headers as complete() — incl. the browser-direct opt-in.
            expect(init.headers['x-api-key']).toBe('sk-ant-test');
            expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
            const body = JSON.parse(init.body);
            // Non-streaming POST (tool args are never streamed in v1).
            expect(body.stream).toBeUndefined();
            // System rides as a block array carrying the turn's ONE
            // cache breakpoint — tools render before system, so this caches
            // the tools+system prefix together (a breakpoint on the tiny
            // tools alone is below the minimum cacheable prefix — a no-op;
            // review finding M2, 2026-06-13).
            expect(body.system).toEqual([
                {
                    type: 'text',
                    text: 'You build assets.',
                    cache_control: { type: 'ephemeral' },
                },
            ]);
            expect(typeof body.max_tokens).toBe('number');
            // Tools: plain defs — no strict (model-gated; a legacy model
            // would 400 before the FR64 fallback could help), no per-tool
            // cache_control.
            expect(body.tools).toEqual([
                {
                    name: 'list_dir',
                    description: 'List a directory',
                    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
                },
                {
                    name: 'read_file',
                    description: 'Read a file',
                    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
                },
            ]);
        });

        it('sums cache_creation/read tokens into inputTokens — the spend line reports the WHOLE prompt', async () => {
            fetchSpy.mockResolvedValueOnce(
                toolResponse({
                    usage: {
                        input_tokens: 12,
                        cache_creation_input_tokens: 900,
                        cache_read_input_tokens: 2100,
                        output_tokens: 40,
                    },
                }),
            );
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
            const res = await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
            });
            expect(res.usage).toEqual({ inputTokens: 3012, outputTokens: 40 });
        });

        it('maps loop history: assistant toolCalls → text + tool_use blocks; tool results → ONE user message of tool_result blocks', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk', model: 'claude-sonnet-4-6' });
            await p.completeWithTools({
                messages: [
                    { role: 'user', content: 'retheme the banner' },
                    {
                        role: 'assistant',
                        content: 'Let me look around.',
                        toolCalls: [
                            { id: 'toolu_1', name: 'list_dir', args: { path: '.lerret' } },
                            { id: 'toolu_2', name: 'read_file', args: { path: '.lerret/banner.jsx' } },
                        ],
                    },
                    {
                        role: 'tool',
                        results: [
                            { callId: 'toolu_1', name: 'list_dir', content: 'banner.jsx · file · 120' },
                            { callId: 'toolu_2', name: 'read_file', content: 'nope', isError: true },
                        ],
                    },
                ],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(body.messages).toEqual([
                { role: 'user', content: 'retheme the banner' },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Let me look around.' },
                        { type: 'tool_use', id: 'toolu_1', name: 'list_dir', input: { path: '.lerret' } },
                        { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: '.lerret/banner.jsx' } },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'banner.jsx · file · 120' },
                        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'nope', is_error: true },
                    ],
                },
            ]);
        });

        it('omits the text block when the assistant turn had no text', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            await p.completeWithTools({
                messages: [
                    { role: 'user', content: 'go' },
                    {
                        role: 'assistant',
                        content: '',
                        toolCalls: [{ id: 'toolu_1', name: 'list_dir', args: {} }],
                    },
                ],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(body.messages[1].content).toEqual([
                { type: 'tool_use', id: 'toolu_1', name: 'list_dir', input: {} },
            ]);
        });

        it('translates multipart user vision blocks with the same builder as complete()', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            await p.completeWithTools({
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'match this' },
                            { type: 'image', mimeType: 'image/png', base64: 'QUJD' },
                        ],
                    },
                ],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(body.messages[0].content).toEqual([
                { type: 'text', text: 'match this' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
            ]);
        });

        it('parses tool_use blocks → toolCalls with object args; concatenates text blocks; maps usage + stop_reason', async () => {
            fetchSpy.mockResolvedValueOnce(
                jsonResponse({
                    content: [
                        { type: 'text', text: 'I will ' },
                        { type: 'text', text: 'read it.' },
                        { type: 'tool_use', id: 'toolu_9', name: 'read_file', input: { path: 'a.jsx' } },
                    ],
                    stop_reason: 'tool_use',
                    usage: { input_tokens: 321, output_tokens: 42 },
                }),
            );
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            const result = await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            expect(result).toEqual({
                text: 'I will read it.',
                toolCalls: [{ id: 'toolu_9', name: 'read_file', args: { path: 'a.jsx' } }],
                usage: { inputTokens: 321, outputTokens: 42 },
                stopReason: 'tool_use',
            });
        });

        it('returns empty text, empty toolCalls, and zero usage when the vendor omits them', async () => {
            fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [] }));
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            const result = await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            expect(result.text).toBe('');
            expect(result.toolCalls).toEqual([]);
            expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
            expect(result.stopReason).toBeUndefined();
        });

        it('normalizes errors through the same classes as complete() (HTTP 400 model error → BadModel)', async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(400, { error: { type: 'invalid_request_error', message: 'model: not supported' } }),
            );
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            await expect(
                p.completeWithTools({
                    messages: [{ role: 'user', content: 'go' }],
                    tools: TOOLS,
                    signal: new AbortController().signal,
                }),
            ).rejects.toBeInstanceOf(BadModel);
        });

        it('passes AbortSignal through to fetch', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new AnthropicProvider();
            p.configure({ apiKey: 'sk' });
            const ctrl = new AbortController();
            await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: ctrl.signal,
            });
            expect(fetchSpy.mock.calls[0][1].signal).toBe(ctrl.signal);
        });
    });
});
