// Worker agent — the ONLY mutator in the orchestrator graph. Receives a
// sandbox-factory product from the orchestrator at construction time; all
// file ops route through it. Story 8.4 shipped the dispatch stub
// (createWorker / executeStep); Story 8.3 adds the full graph node
// (createWorkerNode) with snapshot pre-capture + abort-before-write.
//
// CRITICAL: this file MUST NOT import from `node:*` (no `node:fs`, no
// `node:child_process`, no `node:net`/`http`/`https`) and MUST NOT call a
// provider directly (no top-level network call). The CI grep guard at
// ./worker-no-direct-fs.test.js enforces this. The sandbox is the EXCLUSIVE
// write surface for the Worker. Sibling imports (the event factories, the
// snapshot helpers passed in) are NOT forbidden — only node:* / shell / net /
// fetch are. The Worker's narrowness is the architectural enactment of FR51's
// "AI is sandboxed to `.lerret/`."

import { writing, deleting, mkdir as mkdirEvent } from '../events.js';

/**
 * The minimal sandbox shape this Worker needs. Matches the return type of
 * `createSandbox` from `@lerret/core`'s `core/fs/sandbox.js`. Documented here
 * (instead of imported) so this file stays import-free.
 *
 * @typedef {{
 *   writeFile: (path: string, data: string | Uint8Array, options?: object) => Promise<void>,
 *   deleteFile: (path: string) => Promise<void>,
 *   mkdir: (path: string) => Promise<void>,
 *   readFile: (path: string, options?: object) => Promise<string | Uint8Array>,
 *   exists: (path: string) => Promise<boolean>,
 * }} Sandbox
 */

/**
 * A single step the Worker can execute. Story 8.3's Planner will produce
 * arrays of these; this stub handles one at a time.
 *
 * @typedef {{ op: 'write', path: string, content: string | Uint8Array }
 *           | { op: 'delete', path: string }
 *           | { op: 'mkdir', path: string }
 *           | { op: string, [key: string]: unknown }
 *          } WorkerStep
 */

/**
 * A turn event yielded by `executeStep`. Mirrors the orchestrator's
 * discriminated-union shape (Story 8.3 will move this typedef to
 * `orchestrator/events.js`).
 *
 * @typedef {{ type: 'writing', file: string }
 *           | { type: 'deleting', file: string }
 *           | { type: 'mkdir', dir: string }
 *           | { type: 'error', error: string, op?: string }
 *          } WorkerEvent
 */

/**
 * Create a Worker bound to a sandbox. The orchestrator passes one sandbox
 * per turn (constructed from the active `FilesystemAccess` backend and
 * `projectRoot`).
 *
 * @param {{ sandbox: Sandbox }} args
 * @returns {{ executeStep: (step: WorkerStep) => AsyncGenerator<WorkerEvent> }}
 */
export function createWorker({ sandbox } = {}) {
    if (
        !sandbox ||
        typeof sandbox.writeFile !== 'function' ||
        typeof sandbox.deleteFile !== 'function' ||
        typeof sandbox.mkdir !== 'function' ||
        typeof sandbox.readFile !== 'function' ||
        typeof sandbox.exists !== 'function'
    ) {
        throw new Error(
            'createWorker: sandbox must be a sandbox object with writeFile / deleteFile / mkdir / readFile / exists methods',
        );
    }

    return {
        /**
         * Execute a single step. Yields turn events. Story 8.3 will wrap
         * this in a graph-node interface; for now it's a flat async
         * generator.
         *
         * @param {WorkerStep} step
         * @returns {AsyncGenerator<WorkerEvent>}
         */
        async *executeStep(step) {
            // Guard step is an object — null / undefined / non-object input
            // is a programming error in the orchestrator, but the Worker's
            // discriminated-union event contract should still hold instead
            // of throwing a raw TypeError.
            if (step === null || step === undefined || typeof step !== 'object') {
                yield { type: 'error', error: 'invalid-step', op: undefined };
                return;
            }
            switch (step.op) {
                case 'write':
                    // Guard: step.content must be a string or Uint8Array.
                    // Passing undefined silently corrupts the file (Node writes
                    // the literal 'undefined') or opaquely throws — neither
                    // matches the Worker's event contract.
                    if (
                        typeof step.content !== 'string' &&
                        !(step.content instanceof Uint8Array)
                    ) {
                        yield {
                            type: 'error',
                            error: 'invalid-content',
                            op: 'write',
                        };
                        return;
                    }
                    await sandbox.writeFile(step.path, step.content);
                    yield { type: 'writing', file: step.path };
                    return;
                case 'delete':
                    await sandbox.deleteFile(step.path);
                    yield { type: 'deleting', file: step.path };
                    return;
                case 'mkdir':
                    await sandbox.mkdir(step.path);
                    yield { type: 'mkdir', dir: step.path };
                    return;
                default:
                    yield { type: 'error', error: 'unsupported-op', op: step.op };
                    return;
            }
        },
    };
}

/**
 * Create the Worker graph node — the full Story 8.3 integration. Executes the
 * planned WorkerSteps against the sandbox with:
 *   - snapshot PRE-capture before the first touch of any file (AC-10),
 *   - an abort check BEFORE each write, never mid-write (AC-13 — NFR18 wins:
 *     an in-flight write finishes, then the Worker halts),
 *   - post-write content capture for redo,
 *   - a `writing`/`deleting`/`mkdir` event per step via the out-of-band emit.
 *
 * The snapshot helpers are PASSED IN (not imported) so the Worker stays
 * testable in isolation and import-light; `fs` is the unwrapped backend the
 * snapshot store reads blobs through, `sandbox` is the exclusive write surface.
 *
 * @param {{
 *   sandbox: Sandbox,
 *   fs: object,
 *   projectRoot: string,
 *   emit: (ev: unknown) => void,
 *   snapshot: {
 *     isAlreadyCapturedInTurn: (m: object, p: string) => boolean,
 *     captureBeforeImage: (a: object) => Promise<object>,
 *     capturePostImage: (a: object) => Promise<{ sha256: string }>,
 *     updateFileEntry: (m: object, p: string, patch: object) => object,
 *   },
 * }} deps
 * @returns {(state: object) => Promise<{ manifest: object, writtenFiles: Array<{path: string, op: string}> }>}
 */
export function createWorkerNode({ sandbox, fs, projectRoot, emit, snapshot }) {
    return async function workerNode(state) {
        let manifest = state.manifest;
        const signal = state.signal;
        const plan = Array.isArray(state.plan) ? state.plan : [];
        /** @type {Array<{ path: string, op: string }>} */
        const writtenFiles = [];

        for (const step of plan) {
            // AC-13: check BEFORE each write, never mid-write. If aborted
            // between steps, halt — the pre-mutation snapshot makes the
            // partial turn fully revertible.
            if (signal?.aborted) break;
            if (!step || typeof step.op !== 'string' || typeof step.path !== 'string') continue;

            if (step.op === 'write') {
                if (typeof step.content !== 'string' && !(step.content instanceof Uint8Array)) {
                    continue; // guard: a malformed step is skipped, not crashed
                }
                const existed = await sandbox.exists(step.path);
                const op = existed ? 'edit' : 'create';
                if (!snapshot.isAlreadyCapturedInTurn(manifest, step.path)) {
                    manifest = await snapshot.captureBeforeImage({
                        projectRoot,
                        fs,
                        sandbox,
                        manifest,
                        filePath: step.path,
                        op,
                    });
                }
                // The in-flight write FINISHES even if `signal` fires now
                // (NFR18) — the next step's pre-check is where the halt lands.
                await sandbox.writeFile(step.path, step.content);
                const { sha256 } = await snapshot.capturePostImage({
                    sandbox,
                    content: step.content,
                });
                manifest = snapshot.updateFileEntry(manifest, step.path, { sha256 });
                emit(writing(step.path));
                writtenFiles.push({ path: step.path, op });
            } else if (step.op === 'delete') {
                const existed = await sandbox.exists(step.path);
                if (existed && !snapshot.isAlreadyCapturedInTurn(manifest, step.path)) {
                    manifest = await snapshot.captureBeforeImage({
                        projectRoot,
                        fs,
                        sandbox,
                        manifest,
                        filePath: step.path,
                        op: 'delete',
                    });
                }
                await sandbox.deleteFile(step.path);
                emit(deleting(step.path));
                writtenFiles.push({ path: step.path, op: 'delete' });
            } else if (step.op === 'mkdir') {
                await sandbox.mkdir(step.path);
                emit(mkdirEvent(step.path));
            }
            // Unknown ops are silently skipped — the Planner is trusted to
            // emit only write/delete/mkdir; a stray op does not fail the turn.
        }

        return { manifest, writtenFiles };
    };
}
