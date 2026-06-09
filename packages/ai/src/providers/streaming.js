// Tiny reusable streaming parsers — SSE (Server-Sent Events) and NDJSON
// (newline-delimited JSON).
//
// The four cloud providers emit SSE; Ollama emits NDJSON. Both are
// line-oriented, both are trivial enough that a parser library would be
// gratuitous (the architecture forbids new HTTP / streaming deps). These
// two functions are the only shared parsing surface inside `providers/`.
//
// Each helper accepts a `ReadableStream<Uint8Array>` (the body of a `fetch`
// response with `body` set) and yields parsed records as an async iterable.
// `AbortSignal` cancellation is handled by the caller — the reader is
// released cleanly in the `finally` block so an aborted fetch does not
// leak the connection.

/**
 * Yield the `data:` payloads of a Server-Sent Events stream.
 *
 * Frame format (per the SSE spec + every vendor's actual output):
 *   `data: <payload>\n`
 *   `<empty line>` (event boundary, sometimes omitted by vendors)
 *
 * The `[DONE]` sentinel (an OpenAI-ism that Anthropic and OpenRouter also
 * use) is filtered out — callers see only real payload strings.
 *
 * Anthropic also emits `event: ` lines (event type names like
 * `content_block_delta`). Those are yielded as a separate channel so
 * callers can branch on them; if the caller does not care about events,
 * they can simply ignore the records where `event` is set and `data` is
 * undefined.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {AsyncGenerator<{ data?: string, event?: string }>}
 */
export async function* parseSSE(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Split on \n; keep the trailing partial line in the buffer.
            let nl;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl).replace(/\r$/, '');
                buffer = buffer.slice(nl + 1);
                if (line.length === 0) continue; // empty line = event boundary
                if (line.startsWith('data:')) {
                    const data = line.slice(5).trimStart();
                    if (data === '[DONE]') return;
                    yield { data };
                } else if (line.startsWith('event:')) {
                    const event = line.slice(6).trimStart();
                    yield { event };
                }
                // Other field names (id:, retry:) ignored.
            }
        }
        // Drain any trailing line that did not end in \n.
        const tail = buffer.replace(/\r$/, '');
        if (tail.startsWith('data:')) {
            const data = tail.slice(5).trimStart();
            if (data !== '[DONE]') yield { data };
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Reader may already be released if the stream errored.
        }
    }
}

/**
 * Yield JSON records from a newline-delimited JSON stream (Ollama's
 * streaming format).
 *
 * Frame format:
 *   `<JSON object>\n`
 *   `<JSON object>\n`
 *   ...
 *
 * Malformed lines throw `SyntaxError` from `JSON.parse` — the caller
 * (Ollama provider) decides whether to surface them as an `Unknown`
 * ProviderError.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {AsyncGenerator<unknown>}
 */
export async function* parseNDJSON(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, nl).replace(/\r$/, '');
                buffer = buffer.slice(nl + 1);
                if (line.length === 0) continue;
                yield JSON.parse(line);
            }
        }
        const tail = buffer.replace(/\r$/, '');
        if (tail.length > 0) yield JSON.parse(tail);
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // Reader may already be released.
        }
    }
}
