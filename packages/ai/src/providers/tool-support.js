// Tool-calling support matrix — `supportsTools(providerName, model)`.
//
// HONESTY: this is a heuristic FLOOR, not a registry. There is no reliable,
// queryable "does this model do tool calls?" API across the four providers,
// so the matrix encodes the cheapest defensible answer per provider:
//
//   - anthropic / openai → true. Every model either vendor currently serves
//     through the chat endpoints Lerret uses speaks tool calls.
//   - openrouter → true, OPTIMISTICALLY. OpenRouter fronts hundreds of
//     models with wildly varying capabilities; the router itself validates
//     tool support per routed model and returns a normal vendor error for
//     a model that lacks it — which flows through the provider's existing
//     error normalization. Failing closed here would wrongly demote the
//     majority of curated models to the single-shot fallback.
//   - ollama → family-prefix match against OLLAMA_TOOL_FAMILIES below.
//     Local models genuinely split on tool support and a tool request to a
//     non-tool model degrades silently (the model emits prose instead of
//     calls), so Ollama is the one provider where a real matrix earns its
//     keep. Unlisted families fail closed (→ Epic 8 single-shot fallback).
//   - unknown provider → false (fail-closed, mirrors capabilities.js).
//
// The CALLER resolves the effective model (router/vision indirection) and
// passes the final model string in — this module deliberately imports
// nothing from the router or vision layers (ADR-006 §Decision 7).
//
// Reference: architecture-epic-9.md §4; ADR-006 §Decision 7 (graceful
// degradation); epics-epic-9.md Story 9.2 AC-1.

/**
 * Ollama model families known to speak native tool calls on `/api/chat`.
 * Matched as a lowercase prefix of the model name with its `:tag` stripped
 * (`llama3.1:8b-instruct-q4` → `llama3.1`). Exported for the truth-table
 * test. Extend when a new tool-capable family lands — additions are cheap,
 * false positives are not (silent degradation, see header).
 *
 * @type {ReadonlyArray<string>}
 */
export const OLLAMA_TOOL_FAMILIES = Object.freeze([
    'llama3.1',
    'llama3.2',
    'llama3.3',
    'llama4',
    'qwen2.5',
    'qwen3',
    'mistral-nemo',
    'mistral-small',
    'mixtral',
    'command-r',
    'firefunction',
    'granite3',
    'hermes3',
    'devstral',
    'gpt-oss',
]);

/**
 * Does `(providerName, model)` support tool calling (`completeWithTools`)?
 *
 * `model` must be the EFFECTIVE model — resolved by the caller; this module
 * does no router/vision indirection of its own. Unknown providers return
 * false (fail-closed → the orchestrator's Epic 8 single-shot fallback).
 *
 * @param {string} providerName  One of interface.js PROVIDER_NAMES.
 * @param {string} model         Effective model id, e.g. 'llama3.1:8b'.
 * @returns {boolean}
 */
export function supportsTools(providerName, model) {
    switch (providerName) {
        case 'anthropic':
        case 'openai':
        case 'openrouter':
            return true;
        case 'ollama': {
            if (typeof model !== 'string' || model.length === 0) return false;
            const family = model.toLowerCase().split(':', 1)[0];
            return OLLAMA_TOOL_FAMILIES.some((f) => family.startsWith(f));
        }
        default:
            return false;
    }
}
