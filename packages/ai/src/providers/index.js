// Public re-exports for the providers subsystem. Consumed by:
//
//   - Story 8.3 orchestrator: imports the concrete provider class for the
//     active provider, calls `configure({apiKey, model})` and threads
//     `complete` / `stream` through its turn loop.
//   - Story 8.2 studio AI glue: imports `capabilities` to grey out the
//     vision toggle for non-vision models in the dock attach affordance.
//   - Story 8.1 settings panel: imports the provider classes to call
//     `probe()` for the Test Connection button, and `errors` to render
//     the normalized error-class label.
//
// External callers reach this through `await import('@lerret/ai')` then
// `ai.providers.X`; the wrapping namespace is added in
// `packages/ai/src/index.js` by Story 8.1 Task 10.

export { AIProvider, PROVIDER_NAMES, PROVIDER_VARIANTS } from './interface.js';
export { OpenAIProvider } from './openai.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenRouterProvider } from './openrouter.js';
export { OllamaProvider } from './ollama.js';

export {
    ProviderError,
    RateLimited,
    InvalidKey,
    Unreachable,
    BadModel,
    ContentBlocked,
    Unknown,
} from './errors.js';

export {
    getCapability,
    modelSupportsVision,
    getContextWindow,
} from './capabilities.js';
