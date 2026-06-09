// run-turn.js — the public orchestrator entry.
//
//   runTurn({ prompt, scope, signal, providerOverride? }) → AsyncIterable<TurnEvent>
//
// This is the ONE function the dock (Story 8.2), the vision UI (Story 8.7),
// the workflows (Story 8.8), and the inspector (Story 8.9) all consume. It:
//   1. resolves the active provider handle (or `providerOverride` for the
//      whole turn) — decrypting the key inside this frame, never logging it,
//   2. constructs the sandbox from the injected FilesystemAccess backend,
//   3. creates + writes the turn manifest BEFORE any Worker mutation (AC-9),
//   4. drives the LangGraph turn graph, translating node progress into
//      TurnEvents via an out-of-band async queue (tight yield timing),
//   5. handles the vision-fallback decision (emit event → await resolver →
//      route the single call through an override or error VisionUnavailable),
//   6. on abort: finalizes 'stopped-mid-turn' + yields `stopped`,
//   7. on error: finalizes 'error' + yields `error` (snapshot intact — NO
//      auto-revert),
//   8. on clean completion: finalizes 'applied' + yields `done`,
//   9. ALWAYS (finally): runs snapshot cleanup synchronously (AC-11).
//
// The Plan-A decision (LangGraph.js) traces to the Story 8.0 bundle-spike gate
// — see ../../../docs/architecture/bundle-spike-2026-06-07.md.
//
// Out-of-band event queue: the graph driver (`graph.invoke`) runs concurrently
// with the drain loop; nodes `emit(event)` synchronously as they execute and
// the drain loop yields those events to the consumer immediately, without the
// node having to return first.
//
// Provider-resolution is injectable via the optional `resolver` param so the
// integration suite can drive mock providers; production omits it and the
// vault-backed resolver is used.

import { createSandbox } from '@lerret/core';

import * as snapshot from '../snapshot/index.js';
import * as providers from '../providers/index.js';
import * as vault from '../vault/index.js';
import * as events from './events.js';
import { createTurnGraph } from './graph.js';
import { VisionUnavailable } from './errors.js';
import { createAsyncQueue } from './async-queue.js';

const PROVIDER_CLASSES = Object.freeze({
    openai: providers.OpenAIProvider,
    anthropic: providers.AnthropicProvider,
    openrouter: providers.OpenRouterProvider,
    ollama: providers.OllamaProvider,
});

/**
 * Wrap a configured provider INSTANCE in the small handle shape the nodes
 * use: `{ name, model, modelSupportsVision, complete, stream }`. Keeps the
 * private `_apiKey` field encapsulated on the instance — the handle never
 * exposes it.
 *
 * @param {object} instance
 * @param {string} model
 */
function makeHandle(instance, model) {
    return {
        name: instance.name,
        model,
        modelSupportsVision: (m) => instance.modelSupportsVision(m ?? model),
        complete: (args) => instance.complete(args),
        stream: (args) => instance.stream(args),
    };
}

/**
 * The default vault-backed provider resolver. Constructs a provider instance
 * from the stored config, decrypts the key for cloud providers (the decrypted
 * key lives only inside this frame — attached to the instance via `configure`,
 * never logged, never returned).
 *
 * @param {{ folderId: string }} ctx
 */
function createVaultResolver({ folderId }) {
    async function resolveByName(providerName, model, baseUrl) {
        const Cls = PROVIDER_CLASSES[providerName];
        if (!Cls) throw new Error(`unknown provider '${providerName}'`);
        const instance = new Cls();
        let apiKey;
        if (instance.variant === 'cloud-byok') {
            const enc = await vault.getEncryptedKey({ folderId, providerName });
            if (enc) {
                const sessionKey = await vault.getSessionKey(folderId);
                apiKey = await vault.decrypt(enc, sessionKey);
            }
        }
        instance.configure({ apiKey, model, baseUrl });
        return makeHandle(instance, model);
    }

    return {
        async resolveActive({ providerOverride }) {
            const configs = await vault.listProviderConfigs({ folderId });
            const target = providerOverride
                ? configs.find((c) => c.providerName === providerOverride)
                : configs.find((c) => c.active);
            if (!target) {
                throw new Error(
                    providerOverride
                        ? `provider override '${providerOverride}' is not configured`
                        : 'no active AI provider configured',
                );
            }
            const handle = await resolveByName(target.providerName, target.model, target.baseUrl);
            return { handle, name: target.providerName, model: target.model ?? handle.model };
        },
        async enumerateVision({ exclude }) {
            const configs = await vault.listProviderConfigs({ folderId });
            return configs
                .filter((c) => c.providerName !== exclude)
                .filter((c) => c.providerName !== 'ollama') // cloud vision only (FR56)
                .filter((c) => providers.modelSupportsVision(c.providerName, c.model))
                .map((c) => ({ name: c.providerName, model: c.model }));
        },
        async resolveOverride(providerName) {
            const configs = await vault.listProviderConfigs({ folderId });
            const cfg = configs.find((c) => c.providerName === providerName);
            if (!cfg) throw new Error(`override provider '${providerName}' is not configured`);
            return resolveByName(cfg.providerName, cfg.model, cfg.baseUrl);
        },
    };
}

/**
 * The public turn entry. An async generator IS the `AsyncIterable<TurnEvent>`.
 *
 * @param {{
 *   prompt: string,
 *   scope?: { type: 'project' | 'selection', selectionLabel?: string },
 *   signal?: AbortSignal,
 *   providerOverride?: string,
 *   onVisionDecision?: (ev: object) => Promise<{ accept: boolean, providerOverride?: string }>,
 *   attachments?: Array<{ type: string }>,
 *   mode?: 'ask' | 'inspect',
 *   folderId?: string,
 *   projectRoot?: string,
 *   fs?: object,
 *   resolver?: object,   // injectable for tests; defaults to the vault resolver
 * }} options
 * @returns {AsyncGenerator<import('./events.js').TurnEvent>}
 */
export async function* runTurn({
    prompt,
    scope = { type: 'project' },
    signal,
    providerOverride,
    onVisionDecision,
    attachments,
    mode,
    folderId,
    projectRoot,
    fs,
    resolver,
}) {
    const queue = createAsyncQueue();
    const emit = (ev) => queue.push(ev);
    const activeResolver = resolver ?? createVaultResolver({ folderId });

    // Internal abort controller, OR-ed with the caller's signal. The graph +
    // every provider call read THIS signal. The caller's `signal` aborting it
    // is the normal Stop path; aborting it ourselves on generator teardown
    // (the consumer broke the `for await` early — Stop-via-break, unmount, or a
    // thrown consumer body) lets the graph halt at the next safe point instead
    // of running the whole turn to completion after the caller is gone.
    const internalAbort = new AbortController();
    const onCallerAbort = () => internalAbort.abort();
    if (signal) {
        if (signal.aborted) internalAbort.abort();
        else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const effectiveSignal = internalAbort.signal;

    // 1. Resolve the active provider handle (or the whole-turn override).
    let providerHandle;
    let activeProviderName;
    let activeModel;
    try {
        const resolved = await activeResolver.resolveActive({ providerOverride });
        providerHandle = resolved.handle;
        activeProviderName = resolved.name;
        activeModel = resolved.model;
    } catch (err) {
        yield events.error(err);
        return;
    }

    // 2. Construct the sandbox + create + write the manifest BEFORE any
    //    Worker mutation (AC-9).
    const sandbox = createSandbox({ projectRoot, fs });
    const turnId =
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `turn-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    let manifest = snapshot.createManifest({
        id: turnId,
        prompt,
        provider: activeProviderName,
        model: activeModel,
        scope,
    });
    try {
        await snapshot.writeManifest({ sandbox, manifest });
    } catch (err) {
        yield events.error(err);
        return;
    }

    // 3. Vision-fallback decision bridge (FR56 — logic only; UI is Story 8.7).
    const requestVisionDecision = async () => {
        const eligible = await activeResolver.enumerateVision({ exclude: activeProviderName });
        // AC-17: the no-eligible-provider case (State A) is error-only — do NOT
        // emit `needs-vision-fallback` (which is State B's "offer an override"
        // signal) when there is nothing to offer.
        if (eligible.length === 0) {
            throw new VisionUnavailable({
                activeProvider: activeProviderName,
                activeModel,
                reason: 'no cloud vision-capable provider is configured',
            });
        }
        emit(events.needsVisionFallback(eligible));
        const decision = onVisionDecision
            ? await onVisionDecision(events.needsVisionFallback(eligible))
            : null;
        if (!decision || !decision.accept) {
            throw new VisionUnavailable({
                activeProvider: activeProviderName,
                activeModel,
                reason: 'vision fallback declined',
            });
        }
        const overrideName = decision.providerOverride ?? eligible[0].name;
        return activeResolver.resolveOverride(overrideName);
    };

    // 4. Drive the graph concurrently; drain events to the consumer.
    const graph = createTurnGraph({
        providerHandle,
        sandbox,
        fs,
        projectRoot,
        emit,
        snapshot,
        requestVisionDecision,
    });

    let graphError;
    let finalState;
    const driver = (async () => {
        try {
            // `effectiveSignal` is threaded into STATE (nodes check it
            // cooperatively) — NOT into LangGraph's abort config, so an
            // in-flight Worker write finishes before the next pre-check halts
            // (NFR18, AC-13).
            finalState = await graph.invoke({
                prompt,
                scope,
                mode,
                attachments,
                providerHandle,
                signal: effectiveSignal,
                manifest,
            });
        } catch (err) {
            graphError = err;
        } finally {
            queue.close();
        }
    })();

    // Idempotent finalization: writes the FINAL in-memory manifest (with the
    // Worker's accumulated file entries + blob keys) at its terminal status,
    // then runs cleanup. Called from BOTH the normal-completion path and the
    // teardown finally, so a consumer that breaks the `for await` early still
    // finalizes the manifest + runs cleanup (AC-11 "ALWAYS finally").
    let finalized = false;
    let finalStatus;
    const finalize = async () => {
        if (finalized) return finalStatus;
        finalized = true;
        finalStatus = graphError
            ? 'error'
            : effectiveSignal.aborted
              ? 'stopped-mid-turn'
              : 'applied';
        const finalManifest = finalState?.manifest ?? manifest;
        try {
            const fin = snapshot.finalizeManifest(finalManifest, { status: finalStatus });
            await snapshot.writeManifest({ sandbox, manifest: fin });
        } catch {
            // Best-effort — a manifest-write failure does not block cleanup.
        }
        try {
            await snapshot.runCleanup({ projectRoot, fs, sandbox });
        } catch {
            // Cleanup is best-effort.
        }
        return finalStatus;
    };

    try {
        // 4. Drain the out-of-band event queue to the consumer.
        for await (const ev of queue) {
            yield ev;
        }
        // 5. Normal completion: the graph has finished (queue closed by the
        //    driver). Capture finalState/graphError, finalize, yield terminal.
        await driver;
        const status = await finalize();
        if (status === 'error') {
            // Snapshot stays intact — NO auto-revert (the user decides).
            yield events.error(graphError);
        } else if (status === 'stopped-mid-turn') {
            yield events.stopped();
        } else {
            yield events.done(finalState?.writtenFiles ?? []);
        }
    } finally {
        // 6. ALWAYS — including on consumer `.return()` (early break) or a
        //    thrown consumer body. Abort the graph so it halts at the next
        //    safe point rather than running to completion after the caller is
        //    gone, wait for it to settle, then finalize (idempotent — a no-op
        //    if the normal path already finalized).
        internalAbort.abort();
        try {
            await driver;
        } catch {
            // driver never rejects (it catches into graphError), but guard anyway.
        }
        await finalize();
        if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
}
