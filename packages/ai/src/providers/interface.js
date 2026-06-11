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
