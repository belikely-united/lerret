// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    __setIndexedDBForTests,
    applyMigrationsV1ToV2,
    STORE_PROVIDER_CONFIG,
    STORE_KEYS,
    STORE_DISCLOSURE_ACK,
    putProviderConfig,
    getProviderConfig,
    listProviderConfigs,
    clearProviderConfig,
    putKey,
    getKey,
    clearKey,
    putDisclosureAck,
    getDisclosureAck,
    isDisclosureAcked,
} from './store.js';
import { createInMemoryIDB } from './__test-helpers__/in-memory-idb.js';

describe('vault/store — IndexedDB CRUD against the three new stores', () => {
    /** @type {ReturnType<typeof createInMemoryIDB>} */
    let idb;

    beforeEach(() => {
        idb = createInMemoryIDB();
        __setIndexedDBForTests(idb);
    });
    afterEach(() => {
        __setIndexedDBForTests(null);
    });

    describe('schema migration (v0 → v2 cold start)', () => {
        it('creates exactly the 3 new AI stores + the 2 v1 stores on first open', async () => {
            // Triggering a CRUD call forces the first open + migration.
            await putProviderConfig({
                folderId: 'folder:bootstrap',
                providerName: 'openai',
                config: { active: true, model: 'gpt-4o', configuredAt: '2026-06-08T00:00:00Z' },
            });
            const stores = idb.__stores;
            expect(Object.keys(stores).sort()).toEqual(
                [
                    'ai_disclosure_ack',
                    'ai_keys',
                    'ai_provider_config',
                    'handles',
                    'trust',
                ].sort(),
            );
        });
    });

    describe('applyMigrationsV1ToV2 (additive migration helper)', () => {
        it('on v1 → v2, creates the 3 new stores WITHOUT touching trust/handles', () => {
            // Set up a fake IDBDatabase with the v1 stores already present
            // and pre-existing data inside them.
            const stores = {
                trust: { keyPath: 'folderId', records: new Map([['x', { folderId: 'x' }]]) },
                handles: { keyPath: 'folderId', records: new Map([['y', { folderId: 'y' }]]) },
            };
            const created = [];
            const db = {
                objectStoreNames: {
                    contains: (n) => Object.prototype.hasOwnProperty.call(stores, n),
                },
                createObjectStore(name, opts) {
                    created.push({ name, opts });
                    stores[name] = { keyPath: opts.keyPath, records: new Map() };
                },
            };
            applyMigrationsV1ToV2(db, 1);
            expect(created.map((c) => c.name).sort()).toEqual([
                'ai_disclosure_ack',
                'ai_keys',
                'ai_provider_config',
            ]);
            // Compound key shape on every new store.
            for (const c of created) {
                expect(c.opts.keyPath).toEqual(['folderId', 'providerName']);
            }
            // Existing data still present.
            expect(stores.trust.records.size).toBe(1);
            expect(stores.handles.records.size).toBe(1);
        });

        it('on v0 → v2, creates ALL FIVE stores (cold-start path)', () => {
            const stores = {};
            const created = [];
            const db = {
                objectStoreNames: {
                    contains: (n) => Object.prototype.hasOwnProperty.call(stores, n),
                },
                createObjectStore(name, opts) {
                    created.push({ name, opts });
                    stores[name] = { keyPath: opts.keyPath, records: new Map() };
                },
            };
            applyMigrationsV1ToV2(db, 0);
            expect(created.map((c) => c.name).sort()).toEqual([
                'ai_disclosure_ack',
                'ai_keys',
                'ai_provider_config',
                'handles',
                'trust',
            ]);
        });

        it('on v2 → v2, creates nothing (idempotent re-open)', () => {
            const stores = {
                trust: { keyPath: 'folderId', records: new Map() },
                handles: { keyPath: 'folderId', records: new Map() },
                ai_provider_config: { keyPath: ['folderId', 'providerName'], records: new Map() },
                ai_keys: { keyPath: ['folderId', 'providerName'], records: new Map() },
                ai_disclosure_ack: { keyPath: ['folderId', 'providerName'], records: new Map() },
            };
            const created = [];
            const db = {
                objectStoreNames: {
                    contains: (n) => Object.prototype.hasOwnProperty.call(stores, n),
                },
                createObjectStore(name, opts) {
                    created.push({ name, opts });
                },
            };
            applyMigrationsV1ToV2(db, 2);
            expect(created).toEqual([]);
        });
    });

    describe('ai_provider_config CRUD', () => {
        const folderId = 'folder:cfg:1';

        it('putProviderConfig + getProviderConfig round-trips', async () => {
            await putProviderConfig({
                folderId,
                providerName: 'openai',
                config: {
                    active: true,
                    model: 'gpt-4o',
                    configuredAt: '2026-06-08T12:00:00.000Z',
                },
            });
            const v = await getProviderConfig({ folderId, providerName: 'openai' });
            expect(v).toEqual({
                folderId,
                providerName: 'openai',
                active: true,
                model: 'gpt-4o',
                configuredAt: '2026-06-08T12:00:00.000Z',
            });
        });

        it('getProviderConfig returns null when the entry is absent', async () => {
            const v = await getProviderConfig({ folderId, providerName: 'anthropic' });
            expect(v).toBeNull();
        });

        it('configuredAt defaults to now() when omitted', async () => {
            const before = Date.now();
            await putProviderConfig({
                folderId,
                providerName: 'ollama',
                config: { active: true, baseUrl: 'http://localhost:11434' },
            });
            const v = await getProviderConfig({ folderId, providerName: 'ollama' });
            expect(v?.configuredAt).toEqual(expect.any(String));
            const ts = Date.parse(v.configuredAt);
            expect(ts).toBeGreaterThanOrEqual(before);
        });

        it('listProviderConfigs returns only the rows for the requested folder', async () => {
            await putProviderConfig({
                folderId,
                providerName: 'openai',
                config: { active: true, model: 'gpt-4o' },
            });
            await putProviderConfig({
                folderId,
                providerName: 'anthropic',
                config: { active: false, model: 'claude-sonnet-4-6' },
            });
            // A DIFFERENT folder's entry must NOT show up.
            await putProviderConfig({
                folderId: 'folder:other:2',
                providerName: 'openai',
                config: { active: true, model: 'gpt-4o' },
            });
            const list = await listProviderConfigs({ folderId });
            expect(list).toHaveLength(2);
            expect(list.map((r) => r.providerName).sort()).toEqual(['anthropic', 'openai']);
        });

        it('clearProviderConfig deletes a single (folder, provider) row', async () => {
            await putProviderConfig({
                folderId,
                providerName: 'openai',
                config: { active: true, model: 'gpt-4o' },
            });
            await clearProviderConfig({ folderId, providerName: 'openai' });
            const v = await getProviderConfig({ folderId, providerName: 'openai' });
            expect(v).toBeNull();
        });

        it('rejects empty folderId / providerName with TypeError', async () => {
            await expect(
                putProviderConfig({ folderId: '', providerName: 'openai', config: { active: true } }),
            ).rejects.toBeInstanceOf(TypeError);
            await expect(
                putProviderConfig({ folderId, providerName: '', config: { active: true } }),
            ).rejects.toBeInstanceOf(TypeError);
        });
    });

    describe('ai_keys CRUD', () => {
        const folderId = 'folder:keys:1';

        it('putKey + getKey round-trips the {iv, ciphertext} payload byte-exact', async () => {
            const payload = {
                iv: 'AAAAAAAAAAAAAAAA',
                ciphertext: 'ZW5jcnlwdGVkLWtleS1ibG9iLWJhc2U2NA==',
            };
            await putKey({ folderId, providerName: 'openai', payload });
            const v = await getKey({ folderId, providerName: 'openai' });
            expect(v).toEqual(payload);
        });

        it('getKey returns null when the entry is absent', async () => {
            const v = await getKey({ folderId, providerName: 'anthropic' });
            expect(v).toBeNull();
        });

        it('clearKey deletes one (folder, provider) entry without touching others', async () => {
            const p1 = { iv: 'AAAA', ciphertext: 'AAAAAA' };
            const p2 = { iv: 'BBBB', ciphertext: 'BBBBBB' };
            const pOther = { iv: 'CCCC', ciphertext: 'CCCCCC' };
            await putKey({ folderId, providerName: 'openai', payload: p1 });
            await putKey({ folderId, providerName: 'anthropic', payload: p2 });
            await putKey({ folderId: 'folder:other:2', providerName: 'openai', payload: pOther });

            await clearKey({ folderId, providerName: 'openai' });

            expect(await getKey({ folderId, providerName: 'openai' })).toBeNull();
            // Same folder, different provider — untouched.
            expect(await getKey({ folderId, providerName: 'anthropic' })).toEqual(p2);
            // Different folder, same provider — untouched.
            expect(await getKey({ folderId: 'folder:other:2', providerName: 'openai' })).toEqual(pOther);
        });

        it('rejects malformed payloads with TypeError', async () => {
            // @ts-expect-error — intentional misuse.
            await expect(
                putKey({ folderId, providerName: 'openai', payload: { iv: 'x' } }),
            ).rejects.toBeInstanceOf(TypeError);
            // @ts-expect-error
            await expect(
                putKey({ folderId, providerName: 'openai', payload: null }),
            ).rejects.toBeInstanceOf(TypeError);
        });
    });

    describe('ai_disclosure_ack CRUD', () => {
        const folderId = 'folder:ack:1';

        it('putDisclosureAck + getDisclosureAck round-trips with an explicit timestamp', async () => {
            await putDisclosureAck({
                folderId,
                providerName: 'openai',
                acknowledgedAt: '2026-06-08T10:00:00.000Z',
            });
            const v = await getDisclosureAck({ folderId, providerName: 'openai' });
            expect(v).toEqual({
                folderId,
                providerName: 'openai',
                acknowledgedAt: '2026-06-08T10:00:00.000Z',
            });
        });

        it('acknowledgedAt defaults to now() when omitted', async () => {
            const before = Date.now();
            await putDisclosureAck({ folderId, providerName: 'anthropic' });
            const v = await getDisclosureAck({ folderId, providerName: 'anthropic' });
            expect(v?.acknowledgedAt).toEqual(expect.any(String));
            expect(Date.parse(v.acknowledgedAt)).toBeGreaterThanOrEqual(before);
        });

        it('isDisclosureAcked: true when an entry exists, false otherwise', async () => {
            expect(await isDisclosureAcked({ folderId, providerName: 'openai' })).toBe(false);
            await putDisclosureAck({ folderId, providerName: 'openai' });
            expect(await isDisclosureAcked({ folderId, providerName: 'openai' })).toBe(true);
            // Different provider in the same folder — independent.
            expect(await isDisclosureAcked({ folderId, providerName: 'anthropic' })).toBe(false);
        });

        it('ack persists across reads — the entry is not consumed by getDisclosureAck', async () => {
            await putDisclosureAck({ folderId, providerName: 'openrouter' });
            const v1 = await getDisclosureAck({ folderId, providerName: 'openrouter' });
            const v2 = await getDisclosureAck({ folderId, providerName: 'openrouter' });
            expect(v1).not.toBeNull();
            expect(v2).toEqual(v1);
        });
    });

    describe('cross-store invariants', () => {
        it('store names are exported as the architecture-mandated string constants', () => {
            expect(STORE_PROVIDER_CONFIG).toBe('ai_provider_config');
            expect(STORE_KEYS).toBe('ai_keys');
            expect(STORE_DISCLOSURE_ACK).toBe('ai_disclosure_ack');
        });

        it('clearing a provider config leaves the key entry intact (caller orchestrates both)', async () => {
            // The store layer does NOT cascade — callers (settings panel)
            // must call BOTH clearKey + clearProviderConfig per AC-22.
            // This test pins the no-cascade behavior so an accidental
            // "be helpful" refactor would be caught.
            const folderId = 'folder:cascade:1';
            await putKey({
                folderId,
                providerName: 'openai',
                payload: { iv: 'x', ciphertext: 'y' },
            });
            await putProviderConfig({
                folderId,
                providerName: 'openai',
                config: { active: true, model: 'gpt-4o' },
            });

            await clearProviderConfig({ folderId, providerName: 'openai' });

            // Config gone — but key entry still there (callers cascade).
            expect(await getProviderConfig({ folderId, providerName: 'openai' })).toBeNull();
            expect(await getKey({ folderId, providerName: 'openai' })).toEqual({
                iv: 'x',
                ciphertext: 'y',
            });
        });
    });
});
