// Tests for the AI context provider.
//
// Coverage:
//   - PROVIDER_NAMES contains the four canonical names in canonical order.
//   - PROVIDER_LABELS maps each canonical name to a display label.
//   - PROVIDER_VARIANTS classifies cloud vs local-keyless correctly.
//   - useAiContext returns the default idle value when no provider wraps the consumer.
//
// The provider itself exercises async vault writes which are integration-tested
// at Story 8.2's close (the browser smoke). Here we cover the shape of the
// context and the constants surface that downstream UI components depend on.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';

import {
    PROVIDER_NAMES,
    PROVIDER_LABELS,
    PROVIDER_VARIANTS,
    OLLAMA_DEFAULT_BASE_URL,
    useAiContext,
    useActiveProvider,
} from './ai-context.jsx';

describe('PROVIDER_NAMES', () => {
    it('lists the four canonical names in canonical order', () => {
        expect(PROVIDER_NAMES).toEqual(['openai', 'anthropic', 'openrouter', 'ollama']);
    });

    it('is frozen (the canonical list cannot be mutated)', () => {
        expect(Object.isFrozen(PROVIDER_NAMES)).toBe(true);
    });
});

describe('PROVIDER_LABELS', () => {
    it('maps each canonical name to its display label', () => {
        expect(PROVIDER_LABELS.openai).toBe('OpenAI');
        expect(PROVIDER_LABELS.anthropic).toBe('Anthropic');
        expect(PROVIDER_LABELS.openrouter).toBe('OpenRouter');
        expect(PROVIDER_LABELS.ollama).toBe('Ollama');
    });
});

describe('PROVIDER_VARIANTS', () => {
    it('classifies the three cloud providers as cloud-byok', () => {
        expect(PROVIDER_VARIANTS.openai).toBe('cloud-byok');
        expect(PROVIDER_VARIANTS.anthropic).toBe('cloud-byok');
        expect(PROVIDER_VARIANTS.openrouter).toBe('cloud-byok');
    });

    it('classifies Ollama as local-keyless', () => {
        expect(PROVIDER_VARIANTS.ollama).toBe('local-keyless');
    });
});

describe('OLLAMA_DEFAULT_BASE_URL', () => {
    it('matches the upstream Ollama default port', () => {
        expect(OLLAMA_DEFAULT_BASE_URL).toBe('http://localhost:11434');
    });
});

describe('useAiContext', () => {
    it('returns the default idle value when no provider wraps the consumer', () => {
        let captured;
        function Probe() {
            captured = useAiContext();
            return null;
        }
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<Probe />);
        });
        expect(captured.aiAvailable).toBe(false);
        expect(captured.folderId).toBeNull();
        expect(captured.activeProvider).toBeNull();
        expect(Array.isArray(captured.providerConfigs)).toBe(true);
        expect(captured.providerConfigs).toHaveLength(0);
        expect(typeof captured.refresh).toBe('function');
        expect(typeof captured.configureProvider).toBe('function');
        expect(typeof captured.makeActive).toBe('function');
        expect(typeof captured.clearProvider).toBe('function');
        expect(typeof captured.recordAck).toBe('function');
        expect(typeof captured.testConnection).toBe('function');
        act(() => root.unmount());
        container.remove();
    });
});

describe('useActiveProvider', () => {
    it('returns null in the idle default context', () => {
        let captured;
        function Probe() {
            captured = useActiveProvider();
            return null;
        }
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        act(() => {
            root.render(<Probe />);
        });
        expect(captured).toBeNull();
        act(() => root.unmount());
        container.remove();
    });
});
