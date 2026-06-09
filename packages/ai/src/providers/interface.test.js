// Tests for the AIProvider abstract base class.
//
// The base methods MUST throw 'not implemented' so a subclass that
// forgets to override blows up loudly. Story 8.1 AC-25 demands an
// assertion-style test for this.

import { describe, it, expect } from 'vitest';
import { AIProvider, PROVIDER_NAMES, PROVIDER_VARIANTS } from './interface.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenRouterProvider } from './openrouter.js';
import { OllamaProvider } from './ollama.js';

describe('AIProvider abstract base class', () => {
    it('throws on every abstract method', () => {
        const p = new AIProvider();
        expect(() => p.name).toThrow(/not implemented/);
        expect(() => p.variant).toThrow(/not implemented/);
        expect(() => p.baseUrl).toThrow(/not implemented/);
        expect(() => p.configure({})).toThrow(/not implemented/);
        expect(() => p.modelSupportsVision('x')).toThrow(/not implemented/);
    });

    it('throws on async abstract methods', async () => {
        const p = new AIProvider();
        await expect(p.complete({ messages: [], signal: new AbortController().signal })).rejects.toThrow(/not implemented/);
        await expect(p.probe()).rejects.toThrow(/not implemented/);
    });

    it('throws on stream() async generator', async () => {
        const p = new AIProvider();
        const iter = p.stream({ messages: [], signal: new AbortController().signal });
        await expect(iter.next()).rejects.toThrow(/not implemented/);
    });

    it('exposes PROVIDER_NAMES frozen array with the four canonical names', () => {
        expect(PROVIDER_NAMES).toEqual(['openai', 'anthropic', 'openrouter', 'ollama']);
        expect(Object.isFrozen(PROVIDER_NAMES)).toBe(true);
    });

    it('exposes PROVIDER_VARIANTS frozen array', () => {
        expect(PROVIDER_VARIANTS).toEqual(['cloud-byok', 'local-keyless']);
        expect(Object.isFrozen(PROVIDER_VARIANTS)).toBe(true);
    });
});

describe('concrete provider subclasses each implement every abstract method', () => {
    const cases = [
        { name: 'openai', Cls: OpenAIProvider, variant: 'cloud-byok' },
        { name: 'anthropic', Cls: AnthropicProvider, variant: 'cloud-byok' },
        { name: 'openrouter', Cls: OpenRouterProvider, variant: 'cloud-byok' },
        { name: 'ollama', Cls: OllamaProvider, variant: 'local-keyless' },
    ];

    for (const { name, Cls, variant } of cases) {
        describe(name, () => {
            it('reports the expected name + variant + baseUrl', () => {
                const p = new Cls();
                expect(p.name).toBe(name);
                expect(p.variant).toBe(variant);
                expect(typeof p.baseUrl).toBe('string');
                expect(p.baseUrl.length).toBeGreaterThan(0);
            });

            it('configure() does not throw and accepts undefined fields', () => {
                const p = new Cls();
                expect(() => p.configure({})).not.toThrow();
                expect(() => p.configure({ apiKey: 'k' })).not.toThrow();
                expect(() => p.configure({ model: 'm' })).not.toThrow();
                expect(() => p.configure({ baseUrl: 'http://x' })).not.toThrow();
            });

            it('modelSupportsVision delegates to the capability matrix', () => {
                const p = new Cls();
                // Unknown model → false (fail-closed)
                expect(p.modelSupportsVision('some-unknown-model-xyz')).toBe(false);
            });
        });
    }
});
