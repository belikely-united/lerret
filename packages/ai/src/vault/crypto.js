// Web Crypto AES-256-GCM wrappers for the per-folder encrypted key vault.
//
// Implements the cryptographic primitives mandated by ADR-005 §Decision 5 and
// architecture-epic-8.md §Encrypted Key Vault:
//
//   - PBKDF2 with 100_000 iterations over a versioned namespace constant
//     concatenated with the folder identity, SHA-256 hash, deriving a
//     non-extractable AES-256-GCM CryptoKey.
//   - AES-GCM encryption with a fresh 12-byte IV per call (per AES-GCM
//     convention from NIST SP 800-38D §8.2.1).
//   - AES-GCM decryption that surfaces a typed `VaultDecryptError` on
//     auth-tag failure (tamper / wrong key / wrong IV).
//
// ─── THREAT MODEL — read before assuming this is "encryption at rest" ────────
//
// Be honest about what this protects against. The PBKDF2 derivation has NO
// SECRET INPUT: the only input is the folder identity (`folder:<name>:<uuid>`),
// which is stored IN PLAINTEXT in the same IndexedDB database. An attacker who
// can READ IndexedDB (local malware, a malicious browser extension, a
// same-origin XSS that reaches `indexedDB`, a shared machine, a forensic disk
// image) can re-derive the identical key and decrypt the stored ciphertext.
// PBKDF2's 100k iterations buy NOTHING against such an attacker because there
// is no secret to brute-force.
//
// What this vault DOES provide:
//   1. The derived key is a NON-EXTRACTABLE CryptoKey — same-origin script
//      cannot read its raw bytes (no `exportKey('raw')`, no leak via
//      `JSON.stringify`). So a script that can call `encrypt`/`decrypt` still
//      cannot exfiltrate the key MATERIAL itself, only use it transiently.
//   2. Per-folder keys prevent cross-folder ciphertext reuse / rainbow tables.
//   3. AES-GCM authenticated encryption detects tampering of the stored blob.
//
// What it explicitly does NOT provide: confidentiality of the API key against
// an actor with IndexedDB read access. For that, the KDF would need a real
// secret input (a user passphrase, or a WebAuthn/PRF-derived secret) — a
// product decision deferred past Epic 8 v1 (see ADR-005 §Decision 5). Do not
// describe this as "the key cannot be recovered from disk."
//
// ─── Plaintext rules (architecture invariant) ────────────────────────────────
//
// The decrypted API key NEVER leaves this module's call frame. The only place
// an unwrapped key briefly exists at runtime is the moment a provider builds
// the Authorization header inside its own request-construction code; the
// caller decrypts it there and discards the local reference immediately. No
// `console.log` / `console.error` / `console.warn` / `console.debug`
// invocation in this file (or anywhere in packages/ai/src/) references a
// variable literally named `apiKey`, `key`, `secret`, `token`, or `password`.
// The CI grep guard at `packages/ai/src/vault/no-key-leak.test.js` enforces
// this on every test run.
//
// ─── Dependencies ────────────────────────────────────────────────────────────
//
// Zero npm dependencies. `crypto.subtle` is a Web Platform global available
// in every modern browser AND in Node ≥19 (Node's `globalThis.crypto`).
// `TextEncoder` / `TextDecoder` are likewise global. `btoa` / `atob` are
// global in browsers and global in Node ≥16.
//
// ─── At-rest format ──────────────────────────────────────────────────────────
//
// The `{iv, ciphertext}` payload returned by `encrypt` is base64-encoded. The
// choice is deliberate: IndexedDB CAN structured-clone Uint8Array values, but
// base64 strings serialize one-to-one across the IDB ⇄ wire ⇄ devtools-export
// boundary with no surprises. Store size overhead is ≈ 4/3× — negligible for
// the ≤512-byte payloads we ever encrypt (an API key plus its AES-GCM 16-byte
// auth tag).

/**
 * Namespace constant for PBKDF2 derivations. Versioned so a future iteration-
 * count or algorithm change can mass-rekey without ambiguity — the v1 vault
 * derives against `lerret.ai.vault.v1`, a hypothetical v2 vault would derive
 * against `lerret.ai.vault.v2`, and the IDB record schema can carry a version
 * tag if/when that becomes necessary.
 *
 * @type {string}
 */
export const VAULT_NAMESPACE = 'lerret.ai.vault.v1';

/**
 * PBKDF2 iteration count. Per ADR-005 §Decision 5: 100_000 is the starting
 * point and may be tuned in dogfood. Do NOT drop below 100_000 without an
 * explicit ADR amendment — the value is part of the security contract.
 *
 * @type {number}
 */
export const PBKDF2_ITERATIONS = 100_000;

/**
 * AES-GCM IV byte length. Per NIST SP 800-38D §8.2.1, 96 bits (12 bytes) is
 * the recommended IV length for AES-GCM; using a 12-byte IV lets AES-GCM
 * use the IV directly without an extra GHASH round.
 *
 * @type {number}
 */
const IV_BYTES = 12;

/**
 * Derive a per-folder AES-256-GCM key.
 *
 * Steps:
 *   1. Import the raw byte string `"${VAULT_NAMESPACE}|${folderIdentity}"`
 *      as a PBKDF2 base key (non-extractable, derive-key usage only).
 *   2. Derive a 256-bit AES-GCM key via PBKDF2-SHA256 with 100_000 iterations
 *      against the salt `"${VAULT_NAMESPACE}.salt.${folderIdentity}"`.
 *   3. Return the resulting `CryptoKey` — non-extractable, usable only for
 *      `encrypt` / `decrypt`. Web Crypto guarantees this key cannot be read
 *      as raw bytes via `subtle.exportKey('raw', …)` — defense in depth
 *      against accidental exfiltration through `JSON.stringify` or similar.
 *
 * The PBKDF2 salt is NOT a secret in this design — it is a uniqueness
 * primitive that prevents cross-folder rainbow-table reuse. The salt's secret-
 * ish input is the folder identity itself, which is locally unique by
 * construction (see persistence.js `generateFolderId()` for the scheme).
 *
 * @param {string} folderIdentity — opaque folder identity string (e.g. `"folder:my-project:abc-uuid"`).
 * @returns {Promise<CryptoKey>}
 */
export async function deriveFolderKey(folderIdentity) {
    if (typeof folderIdentity !== 'string' || folderIdentity.length === 0) {
        throw new TypeError('deriveFolderKey: folderIdentity must be a non-empty string');
    }
    const encoder = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(`${VAULT_NAMESPACE}|${folderIdentity}`),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    const salt = encoder.encode(`${VAULT_NAMESPACE}.salt.${folderIdentity}`);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false, // non-extractable
        ['encrypt', 'decrypt'],
    );
}

/**
 * Encrypt a UTF-8 plaintext string with AES-256-GCM.
 *
 * Returns a `{iv, ciphertext}` payload with both fields base64-encoded for
 * structured-clone-safe IndexedDB storage. The IV is freshly generated from
 * `crypto.getRandomValues` on every call — never reuse across plaintexts.
 *
 * Note: the AES-GCM ciphertext includes a trailing 16-byte authentication tag
 * appended by Web Crypto; the `ciphertext` field carries `ciphertext || tag`
 * as a single base64 blob. `decrypt` re-splits via Web Crypto's own logic.
 *
 * @param {string} plaintext
 * @param {CryptoKey} key — must be an AES-GCM key from `deriveFolderKey()`.
 * @returns {Promise<{iv: string, ciphertext: string}>}
 */
export async function encrypt(plaintext, key) {
    if (typeof plaintext !== 'string') {
        throw new TypeError('encrypt: plaintext must be a string');
    }
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertextBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(plaintext),
    );
    return {
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(ciphertextBuf)),
    };
}

/**
 * Decrypt a `{iv, ciphertext}` payload.
 *
 * Throws `VaultDecryptError` on AES-GCM authentication-tag failure (tamper,
 * wrong key, or wrong IV). The caller is expected to surface this as a
 * normalized "key vault unavailable — re-enter your key" UX path. The
 * original error is preserved on `.cause` for diagnostic logging, but the
 * thrown error's message NEVER contains key material (the caller cannot
 * accidentally log the plaintext).
 *
 * @param {{iv: string, ciphertext: string}} payload
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 * @throws {VaultDecryptError}
 */
export async function decrypt(payload, key) {
    if (!payload || typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
        throw new VaultDecryptError(new TypeError('decrypt: payload must be {iv, ciphertext} (both base64 strings)'));
    }
    try {
        const ivBuf = base64ToBytes(payload.iv);
        const ciphertextBuf = base64ToBytes(payload.ciphertext);
        const plainBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBuf },
            key,
            ciphertextBuf,
        );
        return new TextDecoder().decode(plainBuf);
    } catch (err) {
        throw new VaultDecryptError(err);
    }
}

/**
 * Typed error thrown by `decrypt` on any failure path.
 *
 * The constructor message is deliberately key-free: `"vault decrypt failed"`.
 * The original error (if any) is preserved on `.cause` for diagnostic
 * purposes, but tracebacks from this path NEVER contain plaintext key
 * material because the plaintext is recovered only inside `subtle.decrypt`
 * and is discarded by Web Crypto on auth-tag failure.
 */
export class VaultDecryptError extends Error {
    /**
     * @param {unknown} [cause]
     */
    constructor(cause) {
        super('vault decrypt failed');
        this.name = 'VaultDecryptError';
        if (cause !== undefined) this.cause = cause;
    }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Encode a `Uint8Array` to base64 without leaking the bytes via debug logs.
 * Uses `String.fromCharCode` + `btoa` — same idiom as `packages/studio/src/`
 * blob-encoding paths.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
    // Chunked conversion so we don't blow the call-stack on large inputs.
    // (Our payloads are ≤512 bytes, but the helper is general.)
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Decode a base64 string back to a `Uint8Array`. Inverse of `bytesToBase64`.
 *
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}
