// @vitest-environment node
//
// Unit tests for the vision-on-demand router (Story 8.7, FR56). Pure logic —
// every input arrives via arguments; the suite asserts the router performs NO
// network IO (no fetch / no probe) and that the Story 8.1 capability matrix is
// the only capability truth (unknown pairs fail closed to non-vision).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isVisionRequired,
    eligibleVisionProviders,
    shouldFallback,
    supportsVision,
    resolveEffectiveModel,
    DEFAULT_MODELS,
    DEFAULT_VISION_MODELS,
} from './router.js';

afterEach(() => {
    vi.restoreAllMocks();
});

// ─── isVisionRequired ─────────────────────────────────────────────────────────

describe('isVisionRequired', () => {
    it('returns true when at least one image attachment is present (all three shapes)', () => {
        expect(isVisionRequired('p', [{ kind: 'image' }])).toBe(true);
        expect(isVisionRequired('p', [{ type: 'image' }])).toBe(true);
        expect(isVisionRequired('p', [{ mimeType: 'image/png' }])).toBe(true);
        // Mixed list: one image among non-images still triggers.
        expect(isVisionRequired('p', [{ kind: 'doc' }, null, { mimeType: 'image/jpeg' }])).toBe(true);
    });

    it('returns false for an empty or text-only attachment list', () => {
        expect(isVisionRequired('p', [])).toBe(false);
        expect(
            isVisionRequired('p', [{ kind: 'doc' }, { type: 'file' }, { mimeType: 'text/plain' }]),
        ).toBe(false);
    });

    it('is tolerant of undefined / null args (fail-safe to false)', () => {
        expect(isVisionRequired(undefined, undefined)).toBe(false);
        expect(isVisionRequired(null, null)).toBe(false);
        expect(isVisionRequired('p', 'not-an-array')).toBe(false);
        expect(isVisionRequired('p', [null, undefined, 42, 'x'])).toBe(false);
    });

    it('prompt text alone never triggers vision in v1 (prompt arg is reserved)', () => {
        expect(isVisionRequired('look at this image and match the screenshot', [])).toBe(false);
        expect(isVisionRequired('look at this image', undefined)).toBe(false);
    });
});

// ─── resolveEffectiveModel / supportsVision ──────────────────────────────────

describe('resolveEffectiveModel', () => {
    it('returns the explicit model when present', () => {
        expect(resolveEffectiveModel('openai', 'gpt-4')).toBe('gpt-4');
    });

    it('falls back to the provider-class default when the config carries no model', () => {
        expect(resolveEffectiveModel('openai', undefined)).toBe(DEFAULT_MODELS.openai);
        expect(resolveEffectiveModel('anthropic', '')).toBe(DEFAULT_MODELS.anthropic);
        expect(resolveEffectiveModel('ollama', undefined)).toBe('llama3.2');
    });

    it('returns undefined for an unknown provider with no model (fail-closed downstream)', () => {
        expect(resolveEffectiveModel('mystery', undefined)).toBeUndefined();
    });
});

describe('supportsVision', () => {
    it('consults the matrix against the EFFECTIVE model (provider default when unconfigured)', () => {
        // openai's class default gpt-4o is vision-capable → undefined model sees images.
        expect(supportsVision('openai', undefined)).toBe(true);
        // ollama's class default llama3.2 is NOT vision-capable.
        expect(supportsVision('ollama', undefined)).toBe(false);
        // Explicit models override the default.
        expect(supportsVision('openai', 'gpt-4')).toBe(false);
        expect(supportsVision('ollama', 'llava')).toBe(true);
    });

    it('fails closed for unknown providers / models', () => {
        expect(supportsVision('mystery', 'whatever')).toBe(false);
        expect(supportsVision('openai', 'totally-unknown-model-x9')).toBe(false);
        expect(supportsVision(undefined, undefined)).toBe(false);
    });
});

// ─── shouldFallback ───────────────────────────────────────────────────────────

describe('shouldFallback', () => {
    it('true for (required + non-vision active model)', () => {
        expect(shouldFallback('ollama', 'llama3.2', true)).toBe(true);
        expect(shouldFallback('openai', 'gpt-4', true)).toBe(true);
    });

    it('false for (required + vision-capable active model) — the turn runs normally', () => {
        expect(shouldFallback('anthropic', 'claude-sonnet-4-6', true)).toBe(false);
        expect(shouldFallback('openai', 'gpt-4o', true)).toBe(false);
    });

    it('false when vision is not required, regardless of the active model', () => {
        expect(shouldFallback('ollama', 'llama3.2', false)).toBe(false);
        expect(shouldFallback('openai', 'gpt-4o', false)).toBe(false);
        expect(shouldFallback('openai', 'gpt-4o', undefined)).toBe(false);
    });

    it('unknown active model fails closed to non-vision → true when required', () => {
        expect(shouldFallback('anthropic', 'claude-imaginary-99', true)).toBe(true);
        expect(shouldFallback('unknown-provider', 'unknown-model', true)).toBe(true);
    });
});

// ─── eligibleVisionProviders ──────────────────────────────────────────────────

/** Config-row helper matching the ai-context providerConfigs shape. */
function cfg(providerName, { active = false, model, configuredAt = '2026-06-01T00:00:00.000Z' } = {}) {
    return { providerName, active, model, configuredAt };
}

describe('eligibleVisionProviders', () => {
    it('returns an empty array for no configs, a non-array, or undefined', () => {
        expect(eligibleVisionProviders([])).toEqual([]);
        expect(eligibleVisionProviders(undefined)).toEqual([]);
        expect(eligibleVisionProviders('nope')).toEqual([]);
    });

    it('an Ollama-only folder on a non-vision model returns empty (no llava assumption)', () => {
        expect(eligibleVisionProviders([cfg('ollama', { active: true, model: 'llama3.2' })])).toEqual(
            [],
        );
    });

    it('an Ollama folder WITH llava configured is eligible (local-keyless handle)', () => {
        const out = eligibleVisionProviders([cfg('ollama', { model: 'llava' })]);
        expect(out).toEqual([
            {
                providerName: 'ollama',
                label: 'Ollama',
                model: 'llava',
                variant: 'local-keyless',
                source: 'configured',
            },
        ]);
    });

    it('a vision-capable configured model is used as-is (source: configured)', () => {
        const out = eligibleVisionProviders([cfg('anthropic', { model: 'claude-sonnet-4-6' })]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            providerName: 'anthropic',
            label: 'Anthropic',
            model: 'claude-sonnet-4-6',
            variant: 'cloud-byok',
            source: 'configured',
        });
    });

    it('a cloud provider configured WITHOUT a model is eligible via the provider-class default', () => {
        // openai's class default gpt-4o is what the instance would actually run.
        const out = eligibleVisionProviders([cfg('openai', {})]);
        expect(out).toEqual([
            {
                providerName: 'openai',
                label: 'OpenAI',
                model: 'gpt-4o',
                variant: 'cloud-byok',
                source: 'configured',
            },
        ]);
    });

    it('a cloud provider on a NON-vision model is still eligible via the family default (source: default)', () => {
        const out = eligibleVisionProviders([cfg('openai', { model: 'gpt-4' })]);
        expect(out).toEqual([
            {
                providerName: 'openai',
                label: 'OpenAI',
                model: DEFAULT_VISION_MODELS.openai,
                variant: 'cloud-byok',
                source: 'default',
            },
        ]);
    });

    it('mixed configs: only vision-serviceable providers come back, each with the right model', () => {
        const out = eligibleVisionProviders([
            cfg('openai', { model: 'gpt-4', configuredAt: '2026-06-03T00:00:00.000Z' }), // family default
            cfg('anthropic', { model: 'claude-sonnet-4-6', configuredAt: '2026-06-02T00:00:00.000Z' }),
            cfg('ollama', { active: true, model: 'llama3.2', configuredAt: '2026-06-01T00:00:00.000Z' }), // never eligible
        ]);
        expect(out.map((h) => [h.providerName, h.model, h.source])).toEqual([
            ['openai', 'gpt-4o', 'default'],
            ['anthropic', 'claude-sonnet-4-6', 'configured'],
        ]);
    });

    it('excludes the ACTIVE provider when its model already supports vision (no fallback needed)', () => {
        const out = eligibleVisionProviders([
            cfg('anthropic', { active: true, model: 'claude-sonnet-4-6' }),
            cfg('openai', { model: 'gpt-4o' }),
        ]);
        expect(out.map((h) => h.providerName)).toEqual(['openai']);
    });

    it('orders by most-recently-configured first (deterministic lead-provider precedence)', () => {
        const out = eligibleVisionProviders([
            cfg('openai', { model: 'gpt-4o', configuredAt: '2026-06-01T00:00:00.000Z' }),
            cfg('anthropic', { model: 'claude-sonnet-4-6', configuredAt: '2026-06-05T00:00:00.000Z' }),
        ]);
        expect(out.map((h) => h.providerName)).toEqual(['anthropic', 'openai']);
    });

    it('honors an injected capability accessor (DI) instead of the real matrix', () => {
        const caps = { modelSupportsVision: vi.fn(() => false) };
        const out = eligibleVisionProviders([cfg('anthropic', { model: 'claude-sonnet-4-6' })], caps);
        expect(out).toEqual([]); // injected matrix says nothing sees images
        expect(caps.modelSupportsVision).toHaveBeenCalledWith('anthropic', 'claude-sonnet-4-6');
    });

    it('skips malformed entries and unknown providers (fail-closed)', () => {
        const out = eligibleVisionProviders([
            null,
            {},
            { providerName: 42 },
            cfg('mystery-llm', { model: 'who-knows' }),
            cfg('openai', { model: 'gpt-4o' }),
        ]);
        expect(out.map((h) => h.providerName)).toEqual(['openai']);
    });
});

// ─── DEFAULT_MODELS lockstep with the provider classes ───────────────────────

describe('DEFAULT_MODELS lockstep (router mirror === provider-class constant)', () => {
    // The router's DEFAULT_MODELS mirrors each provider module's private
    // `DEFAULT_MODEL` constant (the model the instance substitutes when a
    // config carries none). The constant is module-private (not exported), so
    // the pin regex-reads each provider source — a drifted default in EITHER
    // file fails here instead of silently mis-answering capability questions.
    const providersDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'providers');

    it.each(Object.keys(DEFAULT_MODELS))(
        "DEFAULT_MODELS.%s === providers/<p>.js DEFAULT_MODEL",
        (provider) => {
            const source = readFileSync(join(providersDir, `${provider}.js`), 'utf8');
            const m = /^const DEFAULT_MODEL = '([^']+)';$/m.exec(source);
            expect(m, `providers/${provider}.js must declare a DEFAULT_MODEL constant`).not.toBeNull();
            expect(DEFAULT_MODELS[provider]).toBe(m[1]);
        },
    );

    it('covers every provider that declares a class default (no silent omissions)', () => {
        expect(Object.keys(DEFAULT_MODELS).sort()).toEqual([
            'anthropic',
            'ollama',
            'openai',
            'openrouter',
        ]);
    });
});

// ─── Purity: no network IO ────────────────────────────────────────────────────

describe('router purity (no probes per turn)', () => {
    it('never calls fetch across all router entry points', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        isVisionRequired('match this screenshot', [{ kind: 'image' }]);
        supportsVision('openai', 'gpt-4o');
        shouldFallback('ollama', 'llama3.2', true);
        eligibleVisionProviders([
            cfg('openai', { model: 'gpt-4' }),
            cfg('anthropic', { model: 'claude-sonnet-4-6' }),
            cfg('ollama', { model: 'llava' }),
        ]);

        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
