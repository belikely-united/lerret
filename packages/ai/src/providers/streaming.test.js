// Tests for the SSE / NDJSON streaming parsers.

import { describe, it, expect } from 'vitest';
import { parseSSE, parseNDJSON } from './streaming.js';
import { makeBodyStream, makeChunkedBodyStream } from './__test-helpers__/mock-fetch.js';

async function collect(iter) {
    const out = [];
    for await (const x of iter) out.push(x);
    return out;
}

describe('parseSSE', () => {
    it('parses simple data frames', async () => {
        const body = 'data: {"a":1}\n\ndata: {"a":2}\n\n';
        const frames = await collect(parseSSE(makeBodyStream(body)));
        expect(frames).toEqual([{ data: '{"a":1}' }, { data: '{"a":2}' }]);
    });

    it('terminates at [DONE]', async () => {
        const body = 'data: {"a":1}\n\ndata: [DONE]\n\ndata: {"a":2}\n\n';
        const frames = await collect(parseSSE(makeBodyStream(body)));
        expect(frames).toEqual([{ data: '{"a":1}' }]);
    });

    it('yields event: lines as event frames', async () => {
        const body = 'event: content_block_delta\ndata: {"x":1}\n\n';
        const frames = await collect(parseSSE(makeBodyStream(body)));
        expect(frames).toContainEqual({ event: 'content_block_delta' });
        expect(frames).toContainEqual({ data: '{"x":1}' });
    });

    it('handles chunked data crossing packet boundaries', async () => {
        const chunks = ['data: {"a":', '1}\n\ndata: {"b":2}\n', '\n'];
        const frames = await collect(parseSSE(makeChunkedBodyStream(chunks)));
        expect(frames).toEqual([{ data: '{"a":1}' }, { data: '{"b":2}' }]);
    });

    it('handles CRLF line endings', async () => {
        const body = 'data: hello\r\n\r\ndata: world\r\n\r\n';
        const frames = await collect(parseSSE(makeBodyStream(body)));
        expect(frames).toEqual([{ data: 'hello' }, { data: 'world' }]);
    });
});

describe('parseNDJSON', () => {
    it('parses simple newline-delimited JSON objects', async () => {
        const body = '{"a":1}\n{"a":2}\n{"a":3}\n';
        const frames = await collect(parseNDJSON(makeBodyStream(body)));
        expect(frames).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    });

    it('handles chunked NDJSON crossing packet boundaries', async () => {
        const chunks = ['{"a":', '1}\n{"a":', '2}\n'];
        const frames = await collect(parseNDJSON(makeChunkedBodyStream(chunks)));
        expect(frames).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('yields a trailing line without final newline', async () => {
        const body = '{"a":1}\n{"a":2}';
        const frames = await collect(parseNDJSON(makeBodyStream(body)));
        expect(frames).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('throws SyntaxError on malformed JSON line', async () => {
        const body = '{"a":1}\nnot-json\n';
        await expect(collect(parseNDJSON(makeBodyStream(body)))).rejects.toThrow(SyntaxError);
    });
});
