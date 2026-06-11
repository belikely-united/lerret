// Vision-on-demand router (Story 8.7, FR56) — the capability-matrix gate.
//
// A small, PURE subsystem that answers three questions per turn:
//   1. `isVisionRequired(prompt, attachments)`  — does this turn need vision?
//   2. `eligibleVisionProviders(configs, caps)` — which configured providers
//      could serve a vision turn?
//   3. `shouldFallback(provider, model, req)`   — must this turn fall back?
//
// The Story 8.1 capability matrix (`../providers/capabilities.js`) is the ONLY
// source of vision truth (architecture-epic-8.md §Vision-Capability Router;
// ADR-005 §Decision 4): no provider probes per turn, no inline capability
// overrides, no hard-coded vision claims of its own. Unknown (provider, model)
// pairs inherit the matrix's fail-closed default (`vision: false`), so an
// unrecognized model routes to the disable/fallback path rather than silently
// sending an image. The module performs NO IO — no `fetch`, no vault reads;
// every input arrives via arguments (DI), asserted by `router.test.js`.
//
// ─── Vision-fallback decision mechanism (the documented contract) ────────────
//
// The decision-return mechanism is the RESOLVER CALLBACK already implemented by
// `../orchestrator/run-turn.js` + documented in `../orchestrator/events.js`:
//
//   runTurn({ ..., attachments, onVisionDecision })
//   // onVisionDecision(event) => Promise<VisionFallbackDecision>
//   // event: { type: 'needs-vision-fallback', requiredCapability: 'vision',
//   //          eligibleProviders: Array<{ name, model }> }
//   // decision: { accept: boolean, providerOverride?: string  /* provider name */ }
//
// The studio's `use-vision-gate.js` supplies that callback (it renders the
// Story 8.7 inline prompt and resolves on the user's choice). Declining (or
// omitting the callback) makes the orchestrator raise `VisionUnavailable`.
//
// The studio-side PRE-GATE (use-vision-gate's `evaluate`) is the UX-primary
// path: it decides State A (block, no turn) / State B (one-off prompt) BEFORE
// `runTurn` is called, and on State-B-accept passes
// `runTurn({ providerOverride: handle.providerName })` so the single turn runs
// against the chosen cloud provider WITHOUT changing the persisted active
// provider (AC-13; ADR-005 §Limitations "single active provider per turn
// (except the vision fallback)"). The orchestrator's `needs-vision-fallback`
// event is the mid-turn mirror of the same decision for turns that reach the
// Planner without the pre-gate.

import { modelSupportsVision, getCapability } from '../providers/capabilities.js';

/**
 * Display labels for the four providers, re-declared here so the router does
 * not depend on @lerret/studio (the studio's `ai-context.jsx` owns the
 * UI-canonical copy; UI components prefer their own). Deliberate tiny-constant
 * duplication over cross-package coupling — the Story 8.1 IDB-migration
 * precedent.
 *
 * @type {Readonly<Record<string, string>>}
 */
const PROVIDER_LABELS = Object.freeze({
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    openrouter: 'OpenRouter',
    ollama: 'Ollama',
});

/**
 * Variant per provider — `cloud-byok` egresses to a vendor endpoint with the
 * user's key; `local-keyless` (Ollama) stays on the user's machine.
 *
 * @type {Readonly<Record<string, 'cloud-byok' | 'local-keyless'>>}
 */
const PROVIDER_VARIANTS = Object.freeze({
    openai: 'cloud-byok',
    anthropic: 'cloud-byok',
    openrouter: 'cloud-byok',
    ollama: 'local-keyless',
});

/**
 * The model each provider CLASS runs when a config carries no explicit
 * `model` — mirrors (and must stay in lockstep with) the `DEFAULT_MODEL`
 * constants in `../providers/{openai,anthropic,openrouter,ollama}.js`. A
 * config row with `model: undefined` is NOT "no model": the provider instance
 * substitutes these at call time, so capability questions about a configured
 * provider must be asked against this effective model, not against
 * `undefined` (which the matrix fails closed to non-vision).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_MODELS = Object.freeze({
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'openai/gpt-4o',
    ollama: 'llama3.2',
});

/**
 * Per-provider default VISION model offered when the configured model lacks
 * vision but the provider family has a vision-capable model (the AC-2 family
 * rule). This is a UX default — a suggestion of which model the fallback
 * would use — NOT a capability claim: every candidate is still validated
 * against the matrix before a handle is emitted, so the matrix remains the
 * single source of capability truth.
 *
 * CLOUD providers only, deliberately: a cloud vendor always serves its
 * flagship vision model, but a LOCAL Ollama install only has the models the
 * user pulled — we cannot assume `llava` is present, so Ollama is eligible
 * ONLY when its configured/effective model is itself vision-capable
 * (AC-22: an Ollama-only folder on `llama3.2` yields no eligible providers).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULT_VISION_MODELS = Object.freeze({
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'openai/gpt-4o',
});

/** The default matrix accessor — injectable for tests via the `caps` params. */
const DEFAULT_CAPS = Object.freeze({ modelSupportsVision, getCapability });

/**
 * @typedef {Object} ProviderHandle
 * @property {'openai'|'anthropic'|'openrouter'|'ollama'|string} providerName
 * @property {string} label    Display label ('OpenAI' | 'Anthropic' | 'OpenRouter' | 'Ollama').
 * @property {string} model    A vision-capable model id for this provider.
 * @property {'cloud-byok'|'local-keyless'} variant
 * @property {'configured'|'default'} source
 *   'configured' — `model` is the model this provider is configured to run
 *   (explicit config or the provider-class default) and it is itself
 *   vision-capable, so the built orchestrator (`runTurn`'s `providerOverride`
 *   / `resolveOverride`) can serve the vision turn against it as-is.
 *   'default' — the configured model lacks vision; `model` is the family's
 *   default vision model (a UX suggestion that would require a model switch —
 *   v1's one-off override path does not consume these; see use-vision-gate).
 */

/**
 * @typedef {Object} Attachment
 * @property {string} [kind]      'image' triggers vision (Story 8.7 shape).
 * @property {string} [type]      'image' triggers vision (orchestrator/Story 8.3 shape).
 * @property {string} [mimeType]  'image/png', 'image/jpeg', … also triggers vision.
 */

/**
 * @typedef {Object} NeedsVisionFallbackEvent
 * @property {'needs-vision-fallback'} type
 * @property {'vision'} requiredCapability
 * @property {Array<{ name: string, model: string }>} eligibleProviders
 *   Emitted by `runTurn` (orchestrator/events.js `needsVisionFallback`).
 */

/**
 * The decision the UI returns for a needs-vision-fallback event (the
 * resolver-callback mechanism — see the module header).
 *
 * @typedef {Object} VisionFallbackDecision
 * @property {boolean} accept
 * @property {string} [providerOverride]  Provider NAME, present iff accept.
 */

/**
 * Is an attachment an image? Accepts the three shapes in circulation:
 * `{ kind: 'image' }` (Story 8.7 studio attachments), `{ type: 'image' }`
 * (the Story 8.3 orchestrator/test shape), and `{ mimeType: 'image/…' }`
 * (file-picker output). Anything else — including null/undefined entries —
 * is not an image.
 *
 * @param {Attachment | null | undefined} a
 * @returns {boolean}
 */
function isImageAttachment(a) {
    if (!a || typeof a !== 'object') return false;
    if (a.kind === 'image' || a.type === 'image') return true;
    return typeof a.mimeType === 'string' && a.mimeType.toLowerCase().startsWith('image/');
}

/**
 * Does this turn require vision? v1 heuristic: at least one attached image.
 * The `prompt` argument is accepted for forward-compatibility (a future
 * heuristic could parse explicit vision requests out of the prompt text) but
 * is deliberately unused in v1 — prompt text alone never triggers vision.
 * Tolerates `undefined` / `null` args (fail-safe to `false`).
 *
 * @param {string} [prompt]  Reserved for future heuristics; unused in v1.
 * @param {Array<Attachment>} [attachments]
 * @returns {boolean}
 */
export function isVisionRequired(prompt, attachments) {
    if (!Array.isArray(attachments)) return false;
    return attachments.some(isImageAttachment);
}

/**
 * Resolve the EFFECTIVE model a configured provider would run: the explicit
 * config model when present, else the provider-class default (see
 * {@link DEFAULT_MODELS}). Returns `undefined` for unknown providers — the
 * caller's matrix lookup then fails closed.
 *
 * @param {string} providerName
 * @param {string} [model]
 * @returns {string | undefined}
 */
export function resolveEffectiveModel(providerName, model) {
    if (typeof model === 'string' && model.length > 0) return model;
    return DEFAULT_MODELS[providerName];
}

/**
 * Does the provider's EFFECTIVE model (configured, or the provider-class
 * default when unconfigured) support vision per the matrix? Fail-closed:
 * unknown providers/models → `false`.
 *
 * @param {string} providerName
 * @param {string} [model]
 * @param {{ modelSupportsVision: (p: string, m: string) => boolean }} [caps]
 * @returns {boolean}
 */
export function supportsVision(providerName, model, caps = DEFAULT_CAPS) {
    const effective = resolveEffectiveModel(providerName, model);
    if (typeof providerName !== 'string' || typeof effective !== 'string') return false;
    return caps.modelSupportsVision(providerName, effective) === true;
}

/**
 * Must this turn fall back? `true` iff vision is required AND the active
 * (provider, effective-model) pair is NOT vision-capable per the matrix.
 * Unknown pairs fail closed to non-vision, so an unrecognized active model
 * routes to the fallback/disable path when vision is required.
 *
 * @param {string} activeProvider
 * @param {string} [activeModel]
 * @param {boolean} isRequired
 * @param {{ modelSupportsVision: (p: string, m: string) => boolean }} [caps]
 * @returns {boolean}
 */
export function shouldFallback(activeProvider, activeModel, isRequired, caps = DEFAULT_CAPS) {
    return Boolean(isRequired) && !supportsVision(activeProvider, activeModel, caps);
}

/**
 * Most-recently-configured first; deterministic providerName tiebreak so two
 * configs written in the same millisecond still order stably (AC-11's lead-
 * provider precedence).
 */
function byRecency(a, b) {
    return (
        String(b.configuredAt ?? '').localeCompare(String(a.configuredAt ?? '')) ||
        String(a.providerName).localeCompare(String(b.providerName))
    );
}

/**
 * Filter the folder's configured providers to those that can serve a vision
 * turn, returning a {@link ProviderHandle} per eligible provider, ordered by
 * the AC-11 precedence (most-recently-configured first).
 *
 * Eligibility per configured provider:
 *   1. Its EFFECTIVE model (config model, else the provider-class default) is
 *      vision-capable per the matrix → eligible with that model
 *      (`source: 'configured'`).
 *   2. Otherwise, a CLOUD provider whose family has a default vision model
 *      that the matrix confirms → eligible with that model
 *      (`source: 'default'`, the AC-2 family rule). Ollama gets no family
 *      default — see {@link DEFAULT_VISION_MODELS} for why.
 *   3. The ACTIVE provider is skipped when its effective model already
 *      supports vision (no fallback is needed at all — AC-2).
 *
 * @param {Array<{ providerName: string, active?: boolean, model?: string, baseUrl?: string, configuredAt?: string }>} configuredProviders
 *   The folder's `providerConfigs` array (ai-context.jsx shape).
 * @param {{ modelSupportsVision: (p: string, m: string) => boolean }} [caps]
 *   Injectable matrix accessor (defaults to capabilities.js) for testability.
 * @returns {Array<ProviderHandle>}
 */
export function eligibleVisionProviders(configuredProviders, caps = DEFAULT_CAPS) {
    if (!Array.isArray(configuredProviders)) return [];
    const ordered = configuredProviders
        .filter((c) => c && typeof c.providerName === 'string')
        .sort(byRecency);

    /** @type {Array<ProviderHandle>} */
    const out = [];
    for (const cfg of ordered) {
        const name = cfg.providerName;
        const effective = resolveEffectiveModel(name, cfg.model);
        const effectiveSeesImages =
            typeof effective === 'string' && caps.modelSupportsVision(name, effective) === true;

        // AC-2: when the ACTIVE provider's model already supports vision there
        // is no fallback to offer against it (the turn just runs normally).
        if (cfg.active === true && effectiveSeesImages) continue;

        if (effectiveSeesImages) {
            out.push(makeProviderHandle(name, effective, 'configured'));
            continue;
        }

        const familyDefault = DEFAULT_VISION_MODELS[name];
        if (
            typeof familyDefault === 'string' &&
            caps.modelSupportsVision(name, familyDefault) === true
        ) {
            out.push(makeProviderHandle(name, familyDefault, 'default'));
        }
    }
    return out;
}

/**
 * @param {string} providerName
 * @param {string} model
 * @param {'configured'|'default'} source
 * @returns {ProviderHandle}
 */
function makeProviderHandle(providerName, model, source) {
    return Object.freeze({
        providerName,
        label: PROVIDER_LABELS[providerName] ?? providerName,
        model,
        variant: PROVIDER_VARIANTS[providerName] ?? 'cloud-byok',
        source,
    });
}
