// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getSessionKey,
    clearSessionKey,
    __resetForTests,
    IDLE_MS,
} from './session.js';
import { encrypt, decrypt } from './crypto.js';

// 'node' env: `window` and `document` are undefined, so the listener
// installation is a no-op. The cache-memoization + clearSessionKey semantics
// are exercised directly via the exported functions.

describe('vault/session — in-memory session-key lifecycle', () => {
    beforeEach(() => {
        __resetForTests();
    });

    it('exports the 5-minute idle constant verbatim', () => {
        // ADR-005 §Decision 5: 5 minutes is part of the security contract.
        expect(IDLE_MS).toBe(5 * 60 * 1000);
    });

    it('getSessionKey memoizes the derived key for the same folderId', async () => {
        const k1 = await getSessionKey('folder:memo:A');
        const k2 = await getSessionKey('folder:memo:A');
        // Identity check — same CryptoKey reference.
        expect(k1).toBe(k2);
    });

    it('getSessionKey re-derives for a new folderId (cross-folder isolation)', async () => {
        const k1 = await getSessionKey('folder:cross:A');
        const k2 = await getSessionKey('folder:cross:B');
        // Different CryptoKey objects — switching folders evicts the
        // previous folder's cache entry.
        expect(k1).not.toBe(k2);
    });

    it('clearSessionKey wipes the cache so the next call re-derives', async () => {
        const k1 = await getSessionKey('folder:clear:1');
        clearSessionKey();
        const k2 = await getSessionKey('folder:clear:1');
        // Different CryptoKey objects — a fresh derivation ran.
        expect(k1).not.toBe(k2);
    });

    it('concurrent getSessionKey calls for the same folder share one derivation', async () => {
        // Kick off two derivations in the same tick — both should resolve to
        // the same key without running PBKDF2 twice.
        const [a, b] = await Promise.all([
            getSessionKey('folder:concurrent:1'),
            getSessionKey('folder:concurrent:1'),
        ]);
        expect(a).toBe(b);
    });

    it('a session key can be used to encrypt + decrypt round-trip', async () => {
        // Cross-check that the session-cached key is a fully-functional
        // AES-GCM CryptoKey, not a half-initialized object.
        const key = await getSessionKey('folder:functional:1');
        const payload = await encrypt('sk-session-roundtrip-test', key);
        const plain = await decrypt(payload, key);
        expect(plain).toBe('sk-session-roundtrip-test');
    });

    it('getSessionKey rejects empty / non-string folderId', async () => {
        await expect(getSessionKey('')).rejects.toBeInstanceOf(TypeError);
        // @ts-expect-error — intentional misuse.
        await expect(getSessionKey(null)).rejects.toBeInstanceOf(TypeError);
    });

    it('clearSessionKey is idempotent (multiple calls are safe)', async () => {
        await getSessionKey('folder:idempotent:1');
        clearSessionKey();
        clearSessionKey();
        clearSessionKey();
        // Next call still works — does not throw.
        const k = await getSessionKey('folder:idempotent:1');
        expect(k).toBeDefined();
    });
});
