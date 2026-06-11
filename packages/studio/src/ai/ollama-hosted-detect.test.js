// @vitest-environment node
//
// Tests for the Story 8.10 hosted-mode probe classifier + mode gate.
//
// Pure-logic module — node environment (no DOM). The mode flags are stubbed
// directly on globalThis and restored after every spec so no other suite sees
// them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { classifyOllamaProbe, shouldRunHostedProbe } from './ollama-hosted-detect.js';

function clearModeFlags() {
    delete globalThis.__LERRET_HOSTED_MODE__;
    delete globalThis.__LERRET_CLI_MODE__;
}

beforeEach(clearModeFlags);
afterEach(clearModeFlags);

// ── classifyOllamaProbe — the routing table (AC-2) ───────────────────────────

describe('classifyOllamaProbe', () => {
    it("routes {ok: true} to 'ok' (proceed to the disclosure)", () => {
        expect(classifyOllamaProbe({ ok: true })).toBe('ok');
    });

    it("routes {ok: false, reason: 'cors'} to 'cors' (summon the guide)", () => {
        expect(classifyOllamaProbe({ ok: false, reason: 'cors', detail: 'Failed to fetch' })).toBe(
            'cors',
        );
    });

    it("routes every non-CORS failure to 'unreachable' (fail-safe — never the guide)", () => {
        expect(classifyOllamaProbe({ ok: false, reason: 'unreachable' })).toBe('unreachable');
        expect(classifyOllamaProbe({ ok: false, reason: 'other', detail: 'HTTP 500' })).toBe(
            'unreachable',
        );
        expect(classifyOllamaProbe({ ok: false, reason: 'unavailable' })).toBe('unreachable');
        expect(classifyOllamaProbe({ ok: false })).toBe('unreachable');
        // Broken/missing results (a throwing path upstream) also fail safe.
        expect(classifyOllamaProbe(null)).toBe('unreachable');
        expect(classifyOllamaProbe(undefined)).toBe('unreachable');
        expect(classifyOllamaProbe({})).toBe('unreachable');
    });

    it("does NOT route a cors reason to the guide when ok is not strictly false", () => {
        // ok must be === false for the cors route — a malformed {reason:'cors'}
        // without the ok field fails safe to 'unreachable'.
        expect(classifyOllamaProbe({ reason: 'cors' })).toBe('unreachable');
    });
});

// ── shouldRunHostedProbe — mode gating (AC-10) ───────────────────────────────

describe('shouldRunHostedProbe', () => {
    it('is true ONLY in hosted mode (hosted flag set, CLI flag not)', () => {
        globalThis.__LERRET_HOSTED_MODE__ = true;
        expect(shouldRunHostedProbe()).toBe(true);
    });

    it('is false with no flags set (the studio fixture / dev-harness mode)', () => {
        expect(shouldRunHostedProbe()).toBe(false);
    });

    it('is false in CLI mode, even if the hosted flag is also (incorrectly) set', () => {
        globalThis.__LERRET_CLI_MODE__ = true;
        expect(shouldRunHostedProbe()).toBe(false);
        globalThis.__LERRET_HOSTED_MODE__ = true;
        expect(shouldRunHostedProbe()).toBe(false);
    });

    it('requires the hosted flag to be strictly true', () => {
        globalThis.__LERRET_HOSTED_MODE__ = 'yes';
        expect(shouldRunHostedProbe()).toBe(false);
    });
});
