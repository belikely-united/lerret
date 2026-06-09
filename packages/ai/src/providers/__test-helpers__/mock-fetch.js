// Tiny test helpers — build a `Response` (or `Response`-like) object for
// vi.spyOn(globalThis, 'fetch') mocks, and build a `ReadableStream` body
// from a string of pre-canned bytes.
//
// Co-located under `__test-helpers__/` so it's excluded from the package
// publish (the `files` glob in package.json excludes the directory).

/**
 * Build a `ReadableStream<Uint8Array>` that emits the given string as a
 * single chunk then closes. Used to feed fixed SSE / NDJSON bodies into
 * the provider's stream parser.
 *
 * @param {string} body
 * @returns {ReadableStream<Uint8Array>}
 */
export function makeBodyStream(body) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(body));
            controller.close();
        },
    });
}

/**
 * Build a chunked `ReadableStream<Uint8Array>` — each string in `chunks`
 * is emitted as a separate `enqueue` so SSE parsing across packet
 * boundaries can be exercised.
 *
 * @param {string[]} chunks
 * @returns {ReadableStream<Uint8Array>}
 */
export function makeChunkedBodyStream(chunks) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
        },
    });
}

/**
 * Build a fake `Response` for a JSON body (non-streaming completion).
 *
 * @param {unknown} json
 * @param {{ status?: number, ok?: boolean }} [init]
 * @returns {Response}
 */
export function jsonResponse(json, init = {}) {
    const status = init.status ?? 200;
    return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Build a fake streaming `Response` whose `body` emits the given string.
 *
 * @param {string} body
 * @returns {Response}
 */
export function sseResponse(body) {
    return new Response(makeBodyStream(body), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

/**
 * Build a fake NDJSON streaming `Response`.
 *
 * @param {string} body
 * @returns {Response}
 */
export function ndjsonResponse(body) {
    return new Response(makeBodyStream(body), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
    });
}

/**
 * Build a fake error `Response` for vendor-error mapping tests.
 *
 * @param {number} status
 * @param {unknown} body
 * @returns {Response}
 */
export function errorResponse(status, body) {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
