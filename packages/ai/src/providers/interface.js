// Provider abstraction — abstract base class every concrete provider extends.
//
// One interface, four implementations: OpenAI, Anthropic, OpenRouter, Ollama.
// Each concrete provider speaks its vendor's native HTTP API via `fetch`
// only (no third-party HTTP client) and translates wire-format quirks (SSE
// for the three cloud vendors, NDJSON for Ollama; Anthropic's top-level
// `system` field; OpenRouter's HTTP-Referer / X-Title headers) into the
// single normalized shape the orchestrator consumes.
//
// The orchestrator (Story 8.3) holds one configured provider per turn,
// passes its `AbortController.signal` into every async method, and consumes
// `complete` or `stream` to produce token deltas. Errors thrown from any of
// these methods MUST be one of the normalized `ProviderError` subclasses
// defined in `./errors.js`.
//
// Reference: architecture-epic-8.md §Provider Abstraction; ADR-005 §Decision
// 4 (single AIProvider interface; four concrete implementations; Anthropic
// is NOT an OpenAI-compatible shortcut).

/**
 * The canonical list of provider names. Other modules (capabilities, the
 * vault store, the setup screen) import this constant so the names stay
 * spelled the same way everywhere.
 */
export const PROVIDER_NAMES = Object.freeze([
    'openai',
    'anthropic',
    'openrouter',
    'ollama',
]);

/**
 * Variant types — describe how the provider is reached.
 *  - `cloud-byok`  the user supplies an API key; the provider is reached
 *                  over the network at a vendor-owned endpoint.
 *  - `local-keyless` the provider is reached at a user-owned endpoint
 *                  (Ollama, default http://localhost:11434); no key.
 */
export const PROVIDER_VARIANTS = Object.freeze(['cloud-byok', 'local-keyless']);

/**
 * @typedef {Object} TextBlock
 * @property {'text'} type
 * @property {string} text
 */

/**
 * Provider-NEUTRAL image content block (FR56 image delivery). The Planner is
 * the only producer of this shape; EACH concrete provider translates it into
 * its vendor wire form inside its own request-body builder:
 *
 *   - OpenAI / OpenRouter → `{ type: 'image_url', image_url: { url: <dataUrl> } }`
 *   - Anthropic           → `{ type: 'image', source: { type: 'base64', media_type, data } }`
 *   - Ollama              → message-level `images: [<base64>, …]` + string `content`
 *
 * At least one of `base64` / `dataUrl` is present (the Planner skips
 * payload-less attachments); a missing `mimeType` defaults to `image/png`.
 *
 * @typedef {Object} ImageBlock
 * @property {'image'} type
 * @property {string} [mimeType]  e.g. 'image/png'.
 * @property {string} [base64]    Bare base64 payload (no `data:` prefix).
 * @property {string} [dataUrl]   `data:<mime>;base64,<payload>` form.
 */

/**
 * @typedef {Object} Message
 * @property {'system'|'user'|'assistant'|'tool'} role
 * @property {string|Array<TextBlock|ImageBlock>} content
 *   String for plain text (passes through every provider verbatim); array of
 *   provider-neutral blocks for multipart content (text + image) — each
 *   provider's body-builder owns the vendor translation.
 */

// ─────────────────────────────────────────────────────────────────────────
// Agentic tool-calling contract (Epic 9, Story 9.2 — ADR-006)
//
// `completeWithTools` joins `complete` / `stream` on the provider surface.
// The orchestrator's tool loop (Story 9.1) speaks ONE internal shape; each
// concrete provider translates it to its vendor wire format, mirroring the
// ImageBlock vision-translation pattern above:
//
//   - Anthropic    → `tools[{name,description,input_schema,strict}]`;
//                    calls arrive as `tool_use` content blocks; results go
//                    back as `tool_result` blocks inside ONE user message;
//                    `cache_control` breakpoint rides the last tool def.
//   - OpenAI /     → `tools[{type:'function', function:{...}}]`; calls
//     OpenRouter     arrive as `message.tool_calls` with JSON-STRING
//                    `arguments` (parsed once at the provider boundary);
//                    results go back as N `{role:'tool', tool_call_id}`
//                    messages. Tools are re-sent on EVERY request.
//   - Ollama       → OpenAI function shape on NATIVE `/api/chat` only (the
//                    `/v1` compat layer is banned — it drops streamed tool
//                    calls); `arguments` is already an object; call ids may
//                    be absent and are synthesized (`call_1`, `call_2`, …);
//                    results go back as `{role:'tool', content, tool_name}`.
//
// Tool-call arguments are NEVER streamed in v1 — `completeWithTools` is a
// non-streaming POST per loop iteration; existing text streaming via
// `stream()` is untouched (ADR-006 §Decision 5).
// ─────────────────────────────────────────────────────────────────────────

/**
 * A tool definition offered to the model. `parameters` is a JSON Schema
 * object; each provider translates it to its vendor field (`input_schema`
 * for Anthropic, `function.parameters` for the OpenAI shape).
 *
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} description
 * @property {object} parameters  JSON Schema for the tool's arguments.
 */

/**
 * One tool invocation requested by the model. `args` is ALWAYS a parsed
 * plain object — never a JSON string; the provider boundary owns the parse
 * (and degrades unparseable vendor arguments to `{}`).
 *
 * @typedef {Object} ToolCall
 * @property {string} id    Vendor call id, or synthesized for Ollama.
 * @property {string} name
 * @property {object} args
 */

/**
 * One executed-tool result, addressed to a preceding assistant turn's
 * ToolCall by `callId`. `isError: true` marks a failed execution — the
 * loop feeds it back so the model can self-correct (never a thrown turn).
 *
 * @typedef {Object} ToolResult
 * @property {string} callId   The ToolCall `id` this result answers.
 * @property {string} name     The tool name (Ollama's wire needs it).
 * @property {string} content
 * @property {boolean} [isError]
 */

/**
 * Neutral message shapes accepted by `completeWithTools` — the vision-era
 * `Message` shapes plus two loop-history forms:
 *
 *   - `{role:'system', content: string}`
 *   - `{role:'user', content: string | Array<TextBlock|ImageBlock>}`
 *   - `{role:'assistant', content: string, toolCalls?: Array<ToolCall>}`
 *     — a previous loop turn, replayed verbatim.
 *   - `{role:'tool', results: Array<ToolResult>}`
 *     — the results for the PRECEDING assistant turn's toolCalls.
 *
 * @typedef {Message | {role:'assistant', content: string, toolCalls?: Array<ToolCall>} | {role:'tool', results: Array<ToolResult>}} ToolLoopMessage
 */

/**
 * Normalized `completeWithTools` response envelope.
 *
 * @typedef {Object} CompleteWithToolsResult
 * @property {string} text  Concatenated text parts ('' if none).
 * @property {Array<ToolCall>} toolCalls  [] when the model made no calls.
 * @property {{inputTokens: number, outputTokens: number}} usage
 *   Numbers; 0 when the vendor omits a count.
 * @property {string} [stopReason]  Vendor stop value, passthrough for
 *   debugging (`tool_use`, `tool_calls`, `stop`, …).
 */

/**
 * @typedef {Object} TextDelta
 * @property {'text-delta'} type
 * @property {string} text
 */

/**
 * @typedef {Object} ProbeResult
 * @property {boolean} ok
 * @property {'cors'|'unreachable'|'invalid-key'|'other'} [reason]
 * @property {string} [detail]
 */

/**
 * Abstract base class for every concrete provider. Subclasses MUST override
 * every method below (the base throws so a missing override blows up loudly
 * the first time it is invoked).
 *
 * The class is intentionally a thin contract — the base does NOT hold the
 * `apiKey` field, the `baseUrl`, or the `model`; each subclass declares its
 * own backing state via `configure({apiKey?, baseUrl?, model?})`. This
 * keeps the base class agnostic to vendor differences (Ollama has no API
 * key; OpenRouter requires extra headers).
 *
 * Per the key-vault locality invariant (architecture-epic-8.md §Pattern
 * Extensions / New Invariants #3), the orchestrator unwraps the encrypted
 * key from IndexedDB, derives the session key, calls `configure({apiKey})`
 * on the provider for the duration of one turn, then the key is dropped
 * (zeroed) at turn end. Subclasses MUST NOT persist the key to any
 * non-volatile storage and MUST NOT log it.
 */
export class AIProvider {
    /**
     * Canonical provider name; one of `PROVIDER_NAMES`.
     *
     * @returns {'openai'|'anthropic'|'openrouter'|'ollama'}
     */
    get name() {
        throw new Error('AIProvider.name: not implemented');
    }

    /**
     * @returns {'cloud-byok'|'local-keyless'}
     */
    get variant() {
        throw new Error('AIProvider.variant: not implemented');
    }

    /**
     * Endpoint base URL. Cloud providers return a vendor-owned URL (e.g.
     * `https://api.openai.com`); Ollama returns the user-configured local
     * URL (default `http://localhost:11434`).
     *
     * @returns {string}
     */
    get baseUrl() {
        throw new Error('AIProvider.baseUrl: not implemented');
    }

    /**
     * Set credentials + model + (Ollama only) baseUrl. Cloud providers
     * require an `apiKey`; Ollama requires a `baseUrl` (or accepts the
     * default) and a `model`.
     *
     * @param {{ apiKey?: string, baseUrl?: string, model?: string }} cfg
     */
    // eslint-disable-next-line no-unused-vars
    configure(cfg) {
        throw new Error('AIProvider.configure: not implemented');
    }

    /**
     * Send a chat completion in one shot (non-streaming). The orchestrator
     * uses this for short, low-latency calls (e.g. brand-memory rewrites);
     * full turns go via `stream()`.
     *
     * The returned shape is a normalized assistant message envelope:
     * `{ content: string }`. Tool calls (Story 8.3) layer on top of this
     * via a richer return type that this story does not yet need.
     *
     * @param {{ messages: Array<Message>, signal: AbortSignal, model?: string }} args
     * @returns {Promise<{ content: string }>}
     */
    // eslint-disable-next-line no-unused-vars
    async complete(args) {
        throw new Error('AIProvider.complete: not implemented');
    }

    /**
     * Send one tool-loop iteration (non-streaming). The orchestrator's
     * agent loop (Story 9.1) calls this once per turn with the full neutral
     * history (`ToolLoopMessage[]`) and the tool definitions (`ToolDef[]`),
     * and consumes the normalized `CompleteWithToolsResult` — zero
     * `toolCalls` terminates the loop.
     *
     * Errors MUST flow through the same normalized `ProviderError`
     * subclasses as `complete()` (the concrete providers reuse their
     * `_post` / `_mapError` plumbing). Tool definitions MUST be re-sent on
     * every call — the wire is stateless (especially OpenRouter).
     *
     * @param {{ messages: Array<ToolLoopMessage>, tools: Array<ToolDef>, signal: AbortSignal, model?: string }} args
     * @returns {Promise<CompleteWithToolsResult>}
     */
    // eslint-disable-next-line no-unused-vars
    async completeWithTools(args) {
        throw new Error('AIProvider.completeWithTools: not implemented');
    }

    /**
     * Stream a chat completion as an async iterable of token deltas. The
     * orchestrator consumes each `{type:'text-delta', text}` chunk and
     * forwards it into the dock thread surface.
     *
     * The streaming wire format differs per vendor (SSE for OpenAI /
     * Anthropic / OpenRouter; NDJSON for Ollama); the subclass is
     * responsible for translating those wire formats into the single
     * normalized chunk shape.
     *
     * @param {{ messages: Array<Message>, signal: AbortSignal, model?: string }} args
     * @returns {AsyncGenerator<TextDelta>}
     */
    // eslint-disable-next-line no-unused-vars, require-yield
    async *stream(args) {
        throw new Error('AIProvider.stream: not implemented');
    }

    /**
     * Whether the given model supports vision input (image content blocks
     * in the `user` message). Consumed by the orchestrator to decide
     * whether to attach screenshots to a turn, and by the settings panel
     * to grey out the vision toggle for non-vision models.
     *
     * Default behavior is to consult the `capabilities.json` matrix via
     * `./capabilities.js` — concrete providers may override this only if
     * they have provider-specific logic beyond the static matrix.
     *
     * @param {string} model
     * @returns {boolean}
     */
    // eslint-disable-next-line no-unused-vars
    modelSupportsVision(model) {
        throw new Error('AIProvider.modelSupportsVision: not implemented');
    }

    /**
     * Liveness check — verifies the provider is reachable and the API key
     * (if any) is valid. The Test Connection button in the settings panel
     * (UX-delta §4.3) calls this method.
     *
     * MUST NOT throw — returns a structured result. For Ollama on a hosted
     * page, expect `{ok: false, reason: 'cors'}` (Story 8.10 detects this
     * specifically and surfaces the OLLAMA_ORIGINS guide).
     *
     * @returns {Promise<ProbeResult>}
     */
    async probe() {
        throw new Error('AIProvider.probe: not implemented');
    }
}
