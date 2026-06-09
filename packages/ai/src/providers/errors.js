// Normalized provider error set.
//
// Every concrete provider (OpenAI, Anthropic, OpenRouter, Ollama) maps its
// vendor-specific HTTP status codes and error bodies into one of the six
// subclasses below. The orchestrator (Story 8.3) branches on the class
// rather than reading vendor-specific JSON, and the dock thread surface
// renders the carrier `vendor` + `statusCode` + `originalMessage` for the
// user.
//
// Mapping rules (applied consistently across providers):
//   HTTP 401 / 403 with auth-failure body  → InvalidKey
//   HTTP 429                                → RateLimited
//   HTTP 400 / 404 with "model not found"   → BadModel
//   HTTP 5xx, network error, timeout        → Unreachable
//   Vendor "content policy" / "safety" body → ContentBlocked
//   Anything else                           → Unknown
//
// Reference: architecture-epic-8.md §Provider Abstraction; Story 8.1 AC-3.

/**
 * Base class. All six normalized errors extend this one — callers may catch
 * `ProviderError` to handle "any provider problem" without enumerating the
 * subclasses, then branch on the `name` field.
 *
 * SECURITY: never embed an API key in `message` or `originalMessage`. The
 * no-key-leak CI grep (Story 8.1 Task 5) scans for that pattern.
 */
export class ProviderError extends Error {
    /**
     * @param {{
     *   message: string,
     *   vendor: 'openai'|'anthropic'|'openrouter'|'ollama',
     *   statusCode?: number,
     *   originalMessage?: string,
     * }} init
     */
    constructor({ message, vendor, statusCode, originalMessage }) {
        super(message);
        this.name = 'ProviderError';
        this.vendor = vendor;
        if (statusCode !== undefined) this.statusCode = statusCode;
        if (originalMessage !== undefined) this.originalMessage = originalMessage;
    }
}

/**
 * The provider rejected the request because of a rate limit. The caller
 * may surface a "slow down" message and retry after backoff.
 */
export class RateLimited extends ProviderError {
    constructor(init) {
        super(init);
        this.name = 'RateLimited';
    }
}

/**
 * The supplied API key is invalid or has been revoked. The settings panel
 * surfaces this prominently — the user needs to re-enter their key.
 */
export class InvalidKey extends ProviderError {
    constructor(init) {
        super(init);
        this.name = 'InvalidKey';
    }
}

/**
 * The provider endpoint could not be reached. Covers network errors,
 * timeouts, 5xx responses, and (for Ollama on a hosted page) CORS denials.
 * Carries `reason` so the settings panel can branch on `'cors'` to
 * auto-summon the Story 8.10 guide.
 */
export class Unreachable extends ProviderError {
    /**
     * @param {{
     *   message: string,
     *   vendor: 'openai'|'anthropic'|'openrouter'|'ollama',
     *   statusCode?: number,
     *   originalMessage?: string,
     *   reason?: 'cors'|'network'|'timeout'|'server',
     * }} init
     */
    constructor(init) {
        super(init);
        this.name = 'Unreachable';
        if (init.reason !== undefined) this.reason = init.reason;
    }
}

/**
 * The selected model is unknown to the provider or unsupported for this
 * call (e.g. a chat-completion call against a non-chat model). The settings
 * panel suggests the user pick another model.
 */
export class BadModel extends ProviderError {
    constructor(init) {
        super(init);
        this.name = 'BadModel';
    }
}

/**
 * The provider's content-policy filter blocked the request. Distinct from
 * `InvalidKey` (auth) and `Unreachable` (transport): the call succeeded,
 * the vendor refused the content.
 */
export class ContentBlocked extends ProviderError {
    constructor(init) {
        super(init);
        this.name = 'ContentBlocked';
    }
}

/**
 * Catch-all for any vendor response that does not match the other five
 * subclasses. Should be rare; if a particular vendor body shape becomes
 * common, add a new subclass + update each provider's `mapError`.
 */
export class Unknown extends ProviderError {
    constructor(init) {
        super(init);
        this.name = 'Unknown';
    }
}
