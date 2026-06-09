// Vision + context-window capability matrix wrapper.
//
// A thin layer over the model-capability data so consumers (the
// orchestrator, the settings panel) can call
// `modelSupportsVision('openai', 'gpt-4o')` without thinking about the
// underlying format. Unknown (provider, model) pairs return safe defaults
// — vision: false, contextWindow: 8192 — i.e. the fail-closed behavior
// mandated by Story 8.1 AC-7.
//
// The canonical source of the matrix is `capabilities.json`, kept beside
// this file for diff readability. The JS copy below MUST stay in lockstep
// with the JSON; `capabilities.test.js` asserts byte-equivalence. Why
// duplicate? Importing JSON in pure ESM still needs import attributes
// (`with {type:'json'}`) which not every bundler / test runner handles
// cleanly. The JS-form copy is what the bundle ships; the JSON file is
// the human-readable source-of-truth and update target.
//
// To update: edit BOTH `capabilities.json` and the `matrix` object below.
// Run `pnpm --filter @lerret/ai test capabilities` to verify parity.

/**
 * The capability matrix — must remain byte-equivalent to
 * `capabilities.json` (verified by `capabilities.test.js`).
 *
 * @type {Readonly<Record<string, Record<string, {vision: boolean, contextWindow: number}>>>}
 */
const matrix = Object.freeze({
    openai: Object.freeze({
        'gpt-4o': Object.freeze({ vision: true, contextWindow: 128000 }),
        'gpt-4o-mini': Object.freeze({ vision: true, contextWindow: 128000 }),
        'gpt-4-turbo': Object.freeze({ vision: true, contextWindow: 128000 }),
        'gpt-4': Object.freeze({ vision: false, contextWindow: 8192 }),
        'gpt-3.5-turbo': Object.freeze({ vision: false, contextWindow: 16385 }),
    }),
    anthropic: Object.freeze({
        'claude-opus-4-7': Object.freeze({ vision: true, contextWindow: 200000 }),
        'claude-sonnet-4-6': Object.freeze({ vision: true, contextWindow: 200000 }),
        'claude-haiku-4-5': Object.freeze({ vision: true, contextWindow: 200000 }),
        'claude-3-5-haiku-latest': Object.freeze({ vision: false, contextWindow: 200000 }),
    }),
    openrouter: Object.freeze({
        'openai/gpt-4o': Object.freeze({ vision: true, contextWindow: 128000 }),
        'openai/gpt-4o-mini': Object.freeze({ vision: true, contextWindow: 128000 }),
        'anthropic/claude-3.5-sonnet': Object.freeze({ vision: true, contextWindow: 200000 }),
        'anthropic/claude-3-opus': Object.freeze({ vision: true, contextWindow: 200000 }),
        'google/gemini-pro-1.5': Object.freeze({ vision: true, contextWindow: 1000000 }),
        'google/gemini-flash-1.5': Object.freeze({ vision: true, contextWindow: 1000000 }),
        'meta-llama/llama-3.1-405b-instruct': Object.freeze({ vision: false, contextWindow: 131072 }),
        'meta-llama/llama-3.1-70b-instruct': Object.freeze({ vision: false, contextWindow: 131072 }),
        'mistralai/mistral-large': Object.freeze({ vision: false, contextWindow: 128000 }),
        'deepseek/deepseek-chat': Object.freeze({ vision: false, contextWindow: 64000 }),
    }),
    ollama: Object.freeze({
        llava: Object.freeze({ vision: true, contextWindow: 4096 }),
        'llava:13b': Object.freeze({ vision: true, contextWindow: 4096 }),
        'llava:34b': Object.freeze({ vision: true, contextWindow: 4096 }),
        bakllava: Object.freeze({ vision: true, contextWindow: 4096 }),
        'llama3.2-vision': Object.freeze({ vision: true, contextWindow: 128000 }),
        codellama: Object.freeze({ vision: false, contextWindow: 16384 }),
        'qwen2.5-coder': Object.freeze({ vision: false, contextWindow: 32768 }),
        'llama3.2': Object.freeze({ vision: false, contextWindow: 128000 }),
        'llama3.1': Object.freeze({ vision: false, contextWindow: 128000 }),
        mistral: Object.freeze({ vision: false, contextWindow: 32768 }),
        'phi3.5': Object.freeze({ vision: false, contextWindow: 128000 }),
    }),
});

const DEFAULT_CAPABILITY = Object.freeze({
    vision: false,
    contextWindow: 8192,
});

/**
 * @typedef {Object} ModelCapability
 * @property {boolean} vision
 * @property {number} contextWindow
 */

/**
 * Look up the full capability record for `(provider, model)`. Returns the
 * fail-closed default if the pair is unknown.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {ModelCapability}
 */
export function getCapability(provider, model) {
    if (typeof provider !== 'string' || typeof model !== 'string') {
        return DEFAULT_CAPABILITY;
    }
    const perProvider = matrix[provider];
    if (!perProvider) return DEFAULT_CAPABILITY;
    const entry = resolveEntry(perProvider, model);
    if (!entry) return DEFAULT_CAPABILITY;
    return Object.freeze({
        vision: Boolean(entry.vision),
        contextWindow: Number(entry.contextWindow) || DEFAULT_CAPABILITY.contextWindow,
    });
}

/**
 * Resolve a matrix entry for a model id, tolerating the real-world id forms
 * vendors emit that the canonical matrix keys do not list verbatim:
 *   - dated snapshots:      `gpt-4o-2024-08-06`, `claude-sonnet-4-6-20250101`
 *   - tag suffixes:         `anthropic/claude-3.5-sonnet:beta`, `gpt-4o:free`
 *   - both combined.
 *
 * Strategy: exact match (fast path) → strip a trailing dated-snapshot and/or
 * `:tag` suffix and retry exact → longest-prefix match against the matrix
 * keys. A model that matches no known family still falls through to the
 * fail-closed default (the caller treats `undefined` as DEFAULT_CAPABILITY).
 *
 * Note: exact match runs FIRST, so Ollama's meaningful `:tag` variants that
 * ARE listed (e.g. `llava:13b`) resolve to their own entry; the tag-strip
 * fallback only fires for unlisted tags.
 *
 * @param {Record<string, {vision: boolean, contextWindow: number}>} perProvider
 * @param {string} model
 * @returns {{vision: boolean, contextWindow: number} | undefined}
 */
function resolveEntry(perProvider, model) {
    // 1. Exact match.
    if (perProvider[model]) return perProvider[model];

    // 2. Strip a trailing dated-snapshot suffix (-YYYY-MM-DD or -YYYYMMDD)
    //    and/or a `:tag` suffix, then retry exact match.
    const candidates = new Set();
    const noTag = model.includes(':') ? model.slice(0, model.lastIndexOf(':')) : model;
    candidates.add(noTag);
    for (const base of [model, noTag]) {
        const undated = base
            .replace(/-\d{4}-\d{2}-\d{2}$/, '')
            .replace(/-\d{8}$/, '');
        candidates.add(undated);
    }
    for (const c of candidates) {
        if (c !== model && perProvider[c]) return perProvider[c];
    }

    // 3. Longest-prefix match: a matrix key K is a prefix of `model` at a
    //    natural boundary (`-`, `:`, or `@`). Pick the longest such K so
    //    `gpt-4o-mini-2024-...` matches `gpt-4o-mini`, not `gpt-4o`.
    let best;
    for (const key of Object.keys(perProvider)) {
        if (
            model === key ||
            model.startsWith(`${key}-`) ||
            model.startsWith(`${key}:`) ||
            model.startsWith(`${key}@`)
        ) {
            if (!best || key.length > best.length) best = key;
        }
    }
    return best ? perProvider[best] : undefined;
}

/**
 * Does the (provider, model) pair support vision input? Convenience wrapper
 * over `getCapability` consumed by both `provider.modelSupportsVision()`
 * overrides and the settings-panel "Attach screenshot" affordance.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {boolean}
 */
export function modelSupportsVision(provider, model) {
    return getCapability(provider, model).vision;
}

/**
 * Get the context window (in tokens) for the (provider, model) pair.
 * Returns the fail-closed default 8192 for unknown pairs — callers that
 * care about a tight budget should validate this matches their
 * expectations.
 *
 * @param {string} provider
 * @param {string} model
 * @returns {number}
 */
export function getContextWindow(provider, model) {
    return getCapability(provider, model).contextWindow;
}

/**
 * Test-only access to the underlying matrix and defaults. Lets the test
 * file branch on the matrix structure without re-declaring it.
 */
export const _internal = { matrix, DEFAULT_CAPABILITY };
