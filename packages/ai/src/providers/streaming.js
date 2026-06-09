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
// On any early termination — the caller `break`s out of the `for await`, an
// `[DONE]` sentinel returns, or an error throws — the `finally` block calls
// `reader.cancel()` (which tears down the underlying fetch body so the TCP
// connection is released) and then `releaseLock()`. Releasing the lock alone
// would leave the body un-cancelled and the connection potentially hanging,
// so cancellation is the load-bearing cleanup here.

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
        // Flush any bytes the streaming decoder held back (an incomplete
        // multi-byte UTF-8 sequence at the final chunk boundary) before
        // draining the tail, so the last character is never dropped.
        buffer += decoder.decode();
        // Drain any trailing line that did not end in \n.
        const tail = buffer.replace(/\r$/, '');
        if (tail.startsWith('data:')) {
            const data = tail.slice(5).trimStart();
            // A truncated final frame (connection cut mid-frame) can be
            // invalid JSON; the provider's own try/catch skips it, so emitting
            // it here is safe and lets a clean final frame through.
            if (data !== '[DONE]') yield { data };
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // cancel() can reject if the stream already errored — ignore.
        }
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
 * Malformed / partial lines are SKIPPED (not thrown). Ollama streams can
 * carry blank keep-alive lines, and a connection cut mid-frame leaves a
 * partial trailing line; a single un-parseable frame must not abort the
 * whole stream and discard the valid deltas that preceded it. This mirrors
 * the SSE providers' skip-and-continue resilience.
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
                const parsed = tryParseJson(line);
                if (parsed !== undefined) yield parsed;
            }
        }
        // Flush held-back multi-byte UTF-8 bytes before draining the tail.
        buffer += decoder.decode();
        const tail = buffer.replace(/\r$/, '');
        if (tail.length > 0) {
            const parsed = tryParseJson(tail);
            if (parsed !== undefined) yield parsed;
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            // cancel() can reject if the stream already errored — ignore.
        }
        try {
            reader.releaseLock();
        } catch {
            // Reader may already be released.
        }
    }
}

/**
 * Parse a JSON line, returning `undefined` on failure instead of throwing.
 * Used by parseNDJSON to skip malformed/partial frames.
 *
 * @param {string} line
 * @returns {unknown | undefined}
 */
function tryParseJson(line) {
    try {
        return JSON.parse(line);
    } catch {
        return undefined;
    }
}
