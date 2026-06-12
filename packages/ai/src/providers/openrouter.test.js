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

    it('complete() translates neutral image blocks into image_url parts (OpenAI-compatible wire)', async () => {
        fetchSpy.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
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
        expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' }); // strings pass verbatim
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
        const p = new OpenRouterProvider();
        p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
        await p.complete({
            messages: [
                { role: 'user', content: [{ type: 'image', mimeType: 'image/jpeg', base64: 'QUJD' }] },
            ],
            signal: new AbortController().signal,
        });
        const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
        expect(body.messages[0].content).toEqual([
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
        ]);
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

    // ────────────────────────────────────────────────────────────────────
    // completeWithTools — Story 9.2 AC-3 (OpenAI-shape, OpenRouter fixture)
    // ────────────────────────────────────────────────────────────────────
    describe('completeWithTools', () => {
        const TOOLS = [
            {
                name: 'write_file',
                description: 'Write a file',
                parameters: {
                    type: 'object',
                    properties: { path: { type: 'string' }, content: { type: 'string' } },
                },
            },
        ];

        function toolResponse(overrides = {}) {
            return jsonResponse({
                choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
                ...overrides,
            });
        }

        it('POSTs a NON-streaming body with function-shaped tools + app-attribution headers', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or-test', model: 'openai/gpt-4o' });
            await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const [url, init] = fetchSpy.mock.calls[0];
            expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
            expect(init.headers.Authorization).toBe('Bearer or-test');
            expect(init.headers['HTTP-Referer']).toBe('https://lerret.belikely.com');
            expect(init.headers['X-Title']).toBe('Lerret');
            const body = JSON.parse(init.body);
            expect(body.stream).toBe(false);
            expect(body.tools).toEqual([
                {
                    type: 'function',
                    function: {
                        name: 'write_file',
                        description: 'Write a file',
                        parameters: {
                            type: 'object',
                            properties: { path: { type: 'string' }, content: { type: 'string' } },
                        },
                    },
                },
            ]);
        });

        it('re-sends tools on EVERY request (OpenRouter is stateless)', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse()).mockResolvedValueOnce(toolResponse());
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
            const args = {
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            };
            await p.completeWithTools(args);
            await p.completeWithTools(args);
            expect(fetchSpy).toHaveBeenCalledTimes(2);
            for (const call of fetchSpy.mock.calls) {
                expect(JSON.parse(call[1].body).tools).toHaveLength(1);
            }
        });

        it('maps loop history: assistant toolCalls → tool_calls with STRINGIFIED arguments; results → N role:tool messages', async () => {
            fetchSpy.mockResolvedValueOnce(toolResponse());
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
            await p.completeWithTools({
                messages: [
                    { role: 'user', content: 'go' },
                    {
                        role: 'assistant',
                        content: '',
                        toolCalls: [{ id: 'call_a', name: 'write_file', args: { path: 'a.jsx', content: 'x' } }],
                    },
                    {
                        role: 'tool',
                        results: [
                            { callId: 'call_a', name: 'write_file', content: 'permission denied', isError: true },
                        ],
                    },
                ],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
            expect(body.messages).toEqual([
                { role: 'user', content: 'go' },
                {
                    role: 'assistant',
                    content: null, // empty text → null
                    tool_calls: [
                        {
                            id: 'call_a',
                            type: 'function',
                            function: { name: 'write_file', arguments: '{"path":"a.jsx","content":"x"}' },
                        },
                    ],
                },
                { role: 'tool', tool_call_id: 'call_a', content: 'ERROR: permission denied' },
            ]);
        });

        it('parses tool_calls: JSON-STRING arguments → object args; maps usage + finish_reason', async () => {
            fetchSpy.mockResolvedValueOnce(
                jsonResponse({
                    choices: [
                        {
                            message: {
                                content: 'Writing now.',
                                tool_calls: [
                                    {
                                        id: 'call_or_1',
                                        type: 'function',
                                        function: { name: 'write_file', arguments: '{"path":"b.jsx","content":"y"}' },
                                    },
                                ],
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                    usage: { prompt_tokens: 100, completion_tokens: 20 },
                }),
            );
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or', model: 'openai/gpt-4o' });
            const result = await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            expect(result).toEqual({
                text: 'Writing now.',
                toolCalls: [{ id: 'call_or_1', name: 'write_file', args: { path: 'b.jsx', content: 'y' } }],
                usage: { inputTokens: 100, outputTokens: 20 },
                stopReason: 'tool_calls',
            });
        });

        it('degrades unparseable arguments to {} and zero usage when the vendor omits it', async () => {
            fetchSpy.mockResolvedValueOnce(
                jsonResponse({
                    choices: [
                        {
                            message: {
                                content: null,
                                tool_calls: [
                                    { id: 'c1', type: 'function', function: { name: 'write_file', arguments: 'not-json' } },
                                ],
                            },
                            finish_reason: 'tool_calls',
                        },
                    ],
                }),
            );
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or' });
            const result = await p.completeWithTools({
                messages: [{ role: 'user', content: 'go' }],
                tools: TOOLS,
                signal: new AbortController().signal,
            });
            expect(result.text).toBe('');
            expect(result.toolCalls).toEqual([{ id: 'c1', name: 'write_file', args: {} }]);
            expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
        });

        it('normalizes errors through the same classes as complete() (HTTP 400 model error → BadModel)', async () => {
            fetchSpy.mockResolvedValueOnce(
                errorResponse(400, { error: { code: 'model_not_found', message: 'no such model' } }),
            );
            const p = new OpenRouterProvider();
            p.configure({ apiKey: 'or' });
            await expect(
                p.completeWithTools({
                    messages: [{ role: 'user', content: 'go' }],
                    tools: TOOLS,
                    signal: new AbortController().signal,
                }),
            ).rejects.toBeInstanceOf(BadModel);
        });
    });
});
