// Tests for the vision/contextWindow capability matrix wrapper.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    getCapability,
    modelSupportsVision,
    getContextWindow,
    _internal,
} from './capabilities.js';

describe('capabilities matrix', () => {
    it('returns vision: true for known vision-capable OpenAI models', () => {
        expect(modelSupportsVision('openai', 'gpt-4o')).toBe(true);
        expect(modelSupportsVision('openai', 'gpt-4o-mini')).toBe(true);
        expect(modelSupportsVision('openai', 'gpt-4-turbo')).toBe(true);
    });

    it('returns vision: false for known non-vision OpenAI models', () => {
        expect(modelSupportsVision('openai', 'gpt-3.5-turbo')).toBe(false);
    });

    it('returns vision: true for Anthropic Claude 4.x models', () => {
        expect(modelSupportsVision('anthropic', 'claude-opus-4-7')).toBe(true);
        expect(modelSupportsVision('anthropic', 'claude-sonnet-4-6')).toBe(true);
        expect(modelSupportsVision('anthropic', 'claude-haiku-4-5')).toBe(true);
    });

    it('returns vision: true for known Ollama vision models', () => {
        expect(modelSupportsVision('ollama', 'llava')).toBe(true);
        expect(modelSupportsVision('ollama', 'llava:13b')).toBe(true);
        expect(modelSupportsVision('ollama', 'bakllava')).toBe(true);
        expect(modelSupportsVision('ollama', 'llama3.2-vision')).toBe(true);
    });

    it('returns vision: false for known non-vision Ollama models', () => {
        expect(modelSupportsVision('ollama', 'codellama')).toBe(false);
        expect(modelSupportsVision('ollama', 'qwen2.5-coder')).toBe(false);
        expect(modelSupportsVision('ollama', 'llama3.2')).toBe(false);
        expect(modelSupportsVision('ollama', 'mistral')).toBe(false);
        expect(modelSupportsVision('ollama', 'phi3.5')).toBe(false);
    });

    it('returns vision: true for OpenRouter curated vision models', () => {
        expect(modelSupportsVision('openrouter', 'openai/gpt-4o')).toBe(true);
        expect(modelSupportsVision('openrouter', 'anthropic/claude-3.5-sonnet')).toBe(true);
        expect(modelSupportsVision('openrouter', 'google/gemini-pro-1.5')).toBe(true);
    });

    it('defaults to vision: false for unknown (provider, model)', () => {
        expect(modelSupportsVision('openai', 'gpt-99-future-model')).toBe(false);
        expect(modelSupportsVision('madeup-vendor', 'madeup-model')).toBe(false);
        expect(modelSupportsVision('anthropic', 'claude-99')).toBe(false);
    });

    it('defaults to vision: false for null / undefined / non-string inputs', () => {
        expect(modelSupportsVision(null, null)).toBe(false);
        expect(modelSupportsVision(undefined, undefined)).toBe(false);
        expect(modelSupportsVision(42, true)).toBe(false);
    });

    it('returns the right contextWindow for known models', () => {
        expect(getContextWindow('openai', 'gpt-4o')).toBe(128000);
        expect(getContextWindow('anthropic', 'claude-opus-4-7')).toBe(200000);
        expect(getContextWindow('ollama', 'llava')).toBe(4096);
    });

    it('defaults contextWindow to 8192 for unknown models', () => {
        expect(getContextWindow('openai', 'gpt-99')).toBe(8192);
        expect(getContextWindow('madeup', 'madeup')).toBe(8192);
    });

    it('getCapability returns a frozen record', () => {
        const cap = getCapability('openai', 'gpt-4o');
        expect(cap).toMatchObject({ vision: true, contextWindow: 128000 });
        expect(Object.isFrozen(cap)).toBe(true);
    });

    it('exposes the underlying matrix on _internal for inspection', () => {
        expect(_internal.matrix.openai).toBeDefined();
        expect(_internal.matrix.anthropic).toBeDefined();
        expect(_internal.matrix.openrouter).toBeDefined();
        expect(_internal.matrix.ollama).toBeDefined();
    });

    it('matrix contains all four required providers', () => {
        const required = ['openai', 'anthropic', 'openrouter', 'ollama'];
        for (const name of required) {
            expect(_internal.matrix[name], `missing provider ${name}`).toBeDefined();
        }
    });

    it('OpenRouter matrix has at least 10 curated models per AC-6', () => {
        const count = Object.keys(_internal.matrix.openrouter).length;
        expect(count).toBeGreaterThanOrEqual(10);
    });

    it('JS matrix is byte-equivalent to capabilities.json (source-of-truth parity)', () => {
        const jsonUrl = new URL('./capabilities.json', import.meta.url);
        const json = JSON.parse(readFileSync(fileURLToPath(jsonUrl), 'utf8'));
        // Deep-equal comparison — sort key order is irrelevant.
        for (const provider of Object.keys(json)) {
            for (const model of Object.keys(json[provider])) {
                expect(_internal.matrix[provider]?.[model], `mismatch for ${provider}/${model}`)
                    .toEqual(json[provider][model]);
            }
        }
        // Inverse direction — every JS entry exists in JSON.
        for (const provider of Object.keys(_internal.matrix)) {
            for (const model of Object.keys(_internal.matrix[provider])) {
                expect(json[provider]?.[model], `JS has ${provider}/${model} but JSON does not`)
                    .toEqual(_internal.matrix[provider][model]);
            }
        }
    });
});
