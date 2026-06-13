// run-turn.js — the public orchestrator entry.
//
//   runTurn({ prompt, scope, signal, mode?, providerOverride? }) → AsyncIterable<TurnEvent>
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
// ── Inspect mode (Story 8.9, FR58) ───────────────────────────────────────────
// `mode: 'inspect'` routes the graph's read-only branch (Orchestrator →
// Memory → Inspector → END — the Worker node is never visited) and changes
// the turn's SNAPSHOT semantics: an inspect turn mutates NOTHING, so it
// creates NO manifest, writes NO blobs, and skips finalization + cleanup
// entirely (the revert timeline must not grow — there is nothing to revert).
// Its terminal `done` carries `files: []` and NO `turnId`; an aborted inspect
// turn yields `stopped` with NO `turnId`. Everything else — provider
// resolution, the abort plumbing, the out-of-band event queue — is shared
// with ask mode unchanged.
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
import { supportsVision, resolveEffectiveModel } from '../vision/router.js';
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
        // Epic 9 — the agentic loop's provider surface. Providers without the
        // method (a custom test double) surface as tool-incapable upstream,
        // so the executor's FR64 fallback handles it before this is reached.
        completeWithTools: (args) => instance.completeWithTools(args),
    };
}

/**
 * The default vault-backed provider resolver. Constructs a provider instance
 * from the stored config, decrypts the key for cloud providers (the decrypted
 * key lives only inside this frame — attached to the instance via `configure`,
 * never logged, never returned).
 *
 * Exported for the integration suite (which drives `enumerateVision` against
 * the real vault store); production reaches it only as `runTurn`'s default
 * resolver — it is NOT re-exported by the orchestrator barrel.
 *
 * @param {{ folderId: string }} ctx
 */
export function createVaultResolver({ folderId }) {
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
        // The handle carries the EFFECTIVE model: a key-only config (no model
        // set — the normal setup-screen shape) resolves to the provider's
        // family default, so capability checks (`modelSupportsVision`) and the
        // turn manifest record what actually runs, never `undefined`.
        return makeHandle(instance, resolveEffectiveModel(providerName, model));
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
                // Eligibility — and the model the event offers — are asked
                // against the EFFECTIVE model via the vision router (config
                // model, else the provider-class default), in lockstep with
                // the studio pre-gate. Asking the raw config model would fail
                // closed on `undefined` and silently hide every key-only
                // (model-less) cloud config from the mid-turn fallback list.
                .filter((c) => supportsVision(c.providerName, c.model))
                .map((c) => ({
                    name: c.providerName,
                    model: resolveEffectiveModel(c.providerName, c.model),
                }));
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
 * `scope` is PERMISSIVE — the real shapes runTurn receives today:
 *   - the dock's selection-scope object (Story 8.2):
 *     `{ kind: 'file' | 'artboards' | 'page' | null, filePath?: string,
 *        count?: number, label?: string }` — `filePath` for a single selected
 *     file, `count` for a marquee multi-select, `label` for the page name;
 *   - a plain folder-scope string (e.g. `'social-media/'`);
 *   - the legacy `{ type: 'project' | 'selection', selectionLabel? }` object.
 * The Memory node derives the anchoring folder via `deriveTargetScope`
 * (orchestrator/agents/memory.js); unknown shapes degrade to global-only
 * anchoring, never an error.
 *
 * @param {{
 *   prompt: string,
 *   scope?: string
 *     | { kind?: 'file' | 'artboards' | 'page' | null, filePath?: string, count?: number, label?: string }
 *     | { type?: 'project' | 'selection', selectionLabel?: string },
 *   signal?: AbortSignal,
 *   providerOverride?: string,
 *   onVisionDecision?: (ev: object) => Promise<{ accept: boolean, providerOverride?: string }>,
 *   onContinueDecision?: (info: { turnsUsed: number, spentTokens: number }) => Promise<boolean>,
 *   attachments?: Array<{ type: string }>,
 *   mode?: 'ask' | 'inspect',
 *   currentPage?: string,   // the page the user is viewing — default location for NEW assets (Epic 9 follow-up)
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
    onContinueDecision,
    attachments,
    mode,
    currentPage,
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
    //    Worker mutation (AC-9). INSPECT turns (Story 8.9 AC group C) skip
    //    the manifest entirely — they mutate nothing, so the snapshot store
    //    is never touched and the revert timeline does not grow. `turnId`
    //    stays undefined for inspect, so the terminal events carry no
    //    revert target.
    const isInspect = mode === 'inspect';
    const sandbox = createSandbox({ projectRoot, fs });
    let turnId;
    let manifest;
    if (!isInspect) {
        turnId =
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `turn-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
        manifest = snapshot.createManifest({
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
        onContinueDecision,
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
                currentPage,
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
    //
    // INSPECT turns short-circuit after the status computation: there is no
    // manifest to finalize and no snapshot writes to clean up, and this skip
    // holds on EVERY terminal path (done / error / stopped / early-break) —
    // an inspect turn leaves `.lerret/.state/history` untouched.
    let finalized = false;
    let finalStatus;
    const finalize = async () => {
        if (finalized) return finalStatus;
        finalized = true;
        // A user stop can abort an IN-FLIGHT provider fetch (the signal is
        // threaded into fetch), which surfaces as a thrown AbortError-shaped
        // graphError. That is the stop WORKING, not a failure — on an aborted
        // turn an abort-shaped error resolves to 'stopped', never 'error'
        // (found by the Epic 8 close live session: Esc mid-call showed
        // "Error — see thread" instead of "Stopped").
        const abortShaped =
            graphError &&
            typeof graphError === 'object' &&
            (graphError.name === 'AbortError' ||
                graphError.name === 'TurnAborted' ||
                /\babort/i.test(String(graphError.message ?? '')));
        finalStatus =
            graphError && !(effectiveSignal.aborted && abortShaped)
                ? 'error'
                : effectiveSignal.aborted
                  ? 'stopped-mid-turn'
                  : 'applied';
        if (isInspect) return finalStatus;
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
            // Terminal events carry the manifest id so the dock can target
            // revert at THIS turn without out-of-band correlation. For an
            // INSPECT turn `turnId` is undefined, so the event factories omit
            // the key — nothing to revert (Story 8.9 AC group C).
            yield events.stopped(turnId);
        } else {
            // An inspect turn's done is ALWAYS `files: []` — read-only by
            // construction, never a file-outcome summary. Ask turns carry the
            // loop's closing summary (Epic 9) so the thread can show WHAT was
            // done, not just which files changed.
            yield events.done(
                isInspect ? [] : (finalState?.writtenFiles ?? []),
                turnId,
                isInspect ? undefined : finalState?.answer || undefined,
            );
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
