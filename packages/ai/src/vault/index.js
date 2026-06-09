// Public surface of the per-folder encrypted vault subsystem.
//
// Re-exports the three concerns (crypto primitives, session-key lifecycle,
// IndexedDB store) under a single import root so the orchestrator and the
// studio AI-glue can consume the vault as `ai.vault.X` after the top-level
// `packages/ai/src/index.js` adds `export * as vault from './vault/index.js'`.
//
// ─── Plaintext rules (architecture invariant) ────────────────────────────────
//
// The decrypted plaintext key NEVER appears outside `vault/crypto.js`'s
// `decrypt()` return value's call frame. Consumers (provider modules) call
// `decrypt(getKey(...), getSessionKey(folderId))` synchronously inside the
// `Authorization` header construction, then drop the local reference. No
// reference is ever stored on a long-lived object or logged.
//
// See `no-key-leak.test.js` for the CI grep guard.

// Crypto primitives — derive / encrypt / decrypt + typed error.
export {
    deriveFolderKey,
    encrypt,
    decrypt,
    VaultDecryptError,
    VAULT_NAMESPACE,
    PBKDF2_ITERATIONS,
} from './crypto.js';

// Session-key lifecycle — per-page memoization + auto-clear on
// `pagehide` / `beforeunload` / 5-min idle.
export { getSessionKey, clearSessionKey, IDLE_MS } from './session.js';

// IndexedDB CRUD for the three new stores: `ai_provider_config`, `ai_keys`,
// `ai_disclosure_ack`. Migration helper `applyMigrationsV1ToV2` is also
// exported so `packages/studio/src/state/persistence.js` can use it directly
// (the migration body is byte-equivalent across both files).
export {
    applyMigrationsV1ToV2,
    STORE_PROVIDER_CONFIG,
    STORE_KEYS,
    STORE_DISCLOSURE_ACK,
    putProviderConfig,
    setProviderConfig,
    getProviderConfig,
    listProviderConfigs,
    clearProviderConfig,
    putKey,
    setEncryptedKey,
    getKey,
    getEncryptedKey,
    clearKey,
    clearEncryptedKey,
    putDisclosureAck,
    recordDisclosureAck,
    getDisclosureAck,
    isDisclosureAcked,
} from './store.js';
