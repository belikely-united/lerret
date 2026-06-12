// Tests for the tool-calling support matrix — the full truth table per
// Story 9.2 AC-1 (effective-model resolved by the caller; fail-closed for
// unknown providers and unlisted Ollama families).

import { describe, it, expect } from 'vitest';
import { supportsTools, OLLAMA_TOOL_FAMILIES } from './tool-support.js';

describe('supportsTools', () => {
    it('anthropic → true regardless of model', () => {
        expect(supportsTools('anthropic', 'claude-sonnet-4-6')).toBe(true);
        expect(supportsTools('anthropic', 'claude-haiku-4-5')).toBe(true);
        expect(supportsTools('anthropic', 'some-future-model')).toBe(true);
    });

    it('openai → true regardless of model', () => {
        expect(supportsTools('openai', 'gpt-4o')).toBe(true);
        expect(supportsTools('openai', 'gpt-4o-mini')).toBe(true);
    });

    it('openrouter → true (optimistic — the router validates per routed model)', () => {
        expect(supportsTools('openrouter', 'openai/gpt-4o')).toBe(true);
        expect(supportsTools('openrouter', 'meta-llama/llama-3.1-70b-instruct')).toBe(true);
        expect(supportsTools('openrouter', 'whatever/unknown-model')).toBe(true);
    });

    it('unknown provider → false (fail-closed)', () => {
        expect(supportsTools('gemini', 'gemini-pro')).toBe(false);
        expect(supportsTools('', 'gpt-4o')).toBe(false);
        expect(supportsTools(undefined, 'gpt-4o')).toBe(false);
    });

    describe('ollama family matrix', () => {
        it('every listed family matches as its own bare model name', () => {
            for (const family of OLLAMA_TOOL_FAMILIES) {
                expect(supportsTools('ollama', family)).toBe(true);
            }
        });

        it('matches with a :tag suffix (tag stripped before the prefix check)', () => {
            expect(supportsTools('ollama', 'llama3.1:8b')).toBe(true);
            expect(supportsTools('ollama', 'qwen2.5:14b-instruct-q4_K_M')).toBe(true);
            expect(supportsTools('ollama', 'mistral-nemo:latest')).toBe(true);
        });

        it('matches family-prefixed variants (e.g. coder builds)', () => {
            expect(supportsTools('ollama', 'qwen2.5-coder')).toBe(true);
            expect(supportsTools('ollama', 'qwen2.5-coder:7b')).toBe(true);
            expect(supportsTools('ollama', 'command-r-plus')).toBe(true);
        });

        it('matching is case-insensitive', () => {
            expect(supportsTools('ollama', 'Llama3.1:8B')).toBe(true);
            expect(supportsTools('ollama', 'GPT-OSS:20b')).toBe(true);
        });

        it('unlisted families → false (fail-closed)', () => {
            expect(supportsTools('ollama', 'llava')).toBe(false);
            expect(supportsTools('ollama', 'codellama')).toBe(false);
            expect(supportsTools('ollama', 'phi3.5')).toBe(false);
            expect(supportsTools('ollama', 'mistral')).toBe(false); // bare mistral ≠ mistral-nemo/-small
            expect(supportsTools('ollama', 'llama3')).toBe(false); // llama3 (3.0) predates tool support
        });

        it('non-string / empty model → false (fail-closed)', () => {
            expect(supportsTools('ollama', undefined)).toBe(false);
            expect(supportsTools('ollama', '')).toBe(false);
            expect(supportsTools('ollama', 42)).toBe(false);
        });

        it('a :tag never matches a family on its own (prefix is pre-tag only)', () => {
            // 'foo:llama3.1' must NOT match — the family check applies to the
            // name BEFORE the tag.
            expect(supportsTools('ollama', 'foo:llama3.1')).toBe(false);
        });
    });

    it('OLLAMA_TOOL_FAMILIES is exported, frozen, and lowercase', () => {
        expect(Object.isFrozen(OLLAMA_TOOL_FAMILIES)).toBe(true);
        for (const family of OLLAMA_TOOL_FAMILIES) {
            expect(family).toBe(family.toLowerCase());
        }
    });
});
