// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
    deriveFolderKey,
    encrypt,
    decrypt,
    VaultDecryptError,
    VAULT_NAMESPACE,
    PBKDF2_ITERATIONS,
} from './crypto.js';

// Vitest runs these in the 'node' environment; Node ≥19 provides
// `globalThis.crypto.subtle` natively. We do NOT depend on jsdom here.

describe('vault/crypto — PBKDF2 + AES-256-GCM primitives', () => {
    it('exports the v1 namespace and 100_000 iteration count verbatim', () => {
        // ADR-005 §Decision 5: 100_000 is the floor — guard against accidental
        // downward tuning.
        expect(VAULT_NAMESPACE).toBe('lerret.ai.vault.v1');
        expect(PBKDF2_ITERATIONS).toBe(100_000);
    });

    it('deriveFolderKey returns a non-extractable AES-GCM CryptoKey', async () => {
        const k = await deriveFolderKey('folder:test:uuid-1');
        // CryptoKey type-check
        expect(k).toBeDefined();
        expect(k.algorithm.name).toBe('AES-GCM');
        expect(k.algorithm.length).toBe(256);
        expect(k.extractable).toBe(false);
        expect(k.usages).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
    });

    it('PBKDF2 derives the SAME key bytes for the same (namespace, folderId)', async () => {
        // CryptoKey identity isn't comparable directly (non-extractable), so
        // we verify determinism by encrypting + decrypting CROSS-derivations:
        // key2 must successfully decrypt a payload produced under key1.
        const folderId = 'folder:deterministic:abc-123';
        const k1 = await deriveFolderKey(folderId);
        const k2 = await deriveFolderKey(folderId);
        const payload = await encrypt('sk-test-determinism', k1);
        const round = await decrypt(payload, k2);
        expect(round).toBe('sk-test-determinism');
    });

    it('PBKDF2 derives DIFFERENT keys for different folder identities', async () => {
        const kA = await deriveFolderKey('folder:isolation:A');
        const kB = await deriveFolderKey('folder:isolation:B');
        const payload = await encrypt('sk-cross-folder-secret', kA);
        // kB must NOT decrypt a payload produced under kA — this is the
        // cross-folder isolation guarantee.
        await expect(decrypt(payload, kB)).rejects.toBeInstanceOf(VaultDecryptError);
    });

    it('encrypt/decrypt round-trips a >32-char UTF-8 plaintext byte-exact', async () => {
        const folderId = 'folder:roundtrip:1';
        const key = await deriveFolderKey(folderId);
        // 64 chars including a multi-byte UTF-8 sequence so the byte-exactness
        // covers TextEncoder/TextDecoder fidelity.
        const plain = 'sk-test-abcdef1234567890-utf8-🦄-multi-byte-x-128-chars-pad';
        const payload = await encrypt(plain, key);
        expect(payload.iv).toEqual(expect.any(String));
        expect(payload.ciphertext).toEqual(expect.any(String));
        // base64 sanity
        expect(payload.iv.length).toBeGreaterThan(0);
        expect(payload.ciphertext.length).toBeGreaterThan(0);
        const round = await decrypt(payload, key);
        expect(round).toBe(plain);
    });

    it('encrypt uses a fresh IV per call (no IV reuse across two encrypts of the same plaintext)', async () => {
        const key = await deriveFolderKey('folder:fresh-iv');
        const plain = 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const p1 = await encrypt(plain, key);
        const p2 = await encrypt(plain, key);
        // IV reuse on AES-GCM is catastrophic — guard against any
        // accidental refactor that hoists the IV out of the per-call frame.
        expect(p1.iv).not.toBe(p2.iv);
        // Ciphertexts ALSO differ — same plaintext + different IV → different
        // ciphertext under AES-GCM.
        expect(p1.ciphertext).not.toBe(p2.ciphertext);
    });

    it('decrypt throws VaultDecryptError when the ciphertext is tampered (one-byte flip)', async () => {
        const key = await deriveFolderKey('folder:tamper');
        const payload = await encrypt('sk-original-untampered-secret', key);
        // Flip one bit of ciphertext base64 → AES-GCM auth tag will fail.
        const tampered = {
            iv: payload.iv,
            ciphertext: flipFirstBase64Char(payload.ciphertext),
        };
        await expect(decrypt(tampered, key)).rejects.toBeInstanceOf(VaultDecryptError);
    });

    it('decrypt throws VaultDecryptError when the IV is tampered', async () => {
        const key = await deriveFolderKey('folder:tamper-iv');
        const payload = await encrypt('sk-iv-tamper-test', key);
        const tampered = {
            iv: flipFirstBase64Char(payload.iv),
            ciphertext: payload.ciphertext,
        };
        await expect(decrypt(tampered, key)).rejects.toBeInstanceOf(VaultDecryptError);
    });

    it('decrypt rejects malformed payloads with a typed error (not a TypeError leak)', async () => {
        const key = await deriveFolderKey('folder:malformed');
        // Missing fields
        await expect(decrypt({}, key)).rejects.toBeInstanceOf(VaultDecryptError);
        await expect(decrypt(null, key)).rejects.toBeInstanceOf(VaultDecryptError);
        await expect(
            decrypt({ iv: 'AAAA', ciphertext: 'BBBB' }, key),
        ).rejects.toBeInstanceOf(VaultDecryptError);
    });

    it('encrypt throws TypeError on non-string plaintext', async () => {
        const key = await deriveFolderKey('folder:type-guard');
        // @ts-expect-error — intentional misuse to verify the runtime guard.
        await expect(encrypt(123, key)).rejects.toBeInstanceOf(TypeError);
    });

    it('deriveFolderKey throws TypeError on empty/non-string folder identity', async () => {
        await expect(deriveFolderKey('')).rejects.toBeInstanceOf(TypeError);
        // @ts-expect-error — intentional misuse.
        await expect(deriveFolderKey(null)).rejects.toBeInstanceOf(TypeError);
    });

    it('VaultDecryptError exposes a non-leaky message and preserves the cause', async () => {
        const key = await deriveFolderKey('folder:err-shape');
        const payload = await encrypt('this-string-must-not-appear', key);
        const tampered = { iv: payload.iv, ciphertext: flipFirstBase64Char(payload.ciphertext) };
        try {
            await decrypt(tampered, key);
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(VaultDecryptError);
            expect(err.name).toBe('VaultDecryptError');
            // The thrown error's message must NEVER contain key material —
            // the plaintext is recovered only inside subtle.decrypt and is
            // discarded by Web Crypto on auth-tag failure.
            expect(err.message).toBe('vault decrypt failed');
            expect(err.message).not.toContain('this-string-must-not-appear');
            // The cause is preserved for diagnostics.
            expect(err.cause).toBeDefined();
        }
    });
});

/**
 * Flip the first base64 character to its neighbor — guaranteed to change
 * the decoded byte string without producing invalid base64.
 */
function flipFirstBase64Char(b64) {
    if (b64.length === 0) return b64;
    const first = b64[0];
    // Pick a different alphanumeric base64 char.
    const alt = first === 'A' ? 'B' : 'A';
    return alt + b64.slice(1);
}
