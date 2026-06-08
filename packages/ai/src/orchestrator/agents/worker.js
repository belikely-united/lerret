// Worker agent — the ONLY mutator in the orchestrator graph. Receives a
// sandbox-factory product from the orchestrator at construction time; all
// file ops route through it. Story 8.4 ships this stub (dispatch only);
// Story 8.3 adds LLM-driven step generation and the full graph integration.
//
// CRITICAL: this file MUST NOT import from `node:*` (no `node:fs`, no
// `node:child_process`, no `node:net`/`http`/`https`). The CI grep guard at
// ./worker-no-direct-fs.test.js enforces this. The sandbox is the EXCLUSIVE
// write surface for the Worker — no shell exec, no network fetch, no package
// install. The Worker's narrowness is the architectural enactment of FR51's
// "AI is sandboxed to `.lerret/`."
//
// This file has ZERO imports by design. The sandbox is passed in by the
// orchestrator. Sibling agent modules under packages/ai/src/orchestrator/
// MAY be imported here when Story 8.3 lands; for the stub, no siblings exist.

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
